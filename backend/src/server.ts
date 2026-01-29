import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID, randomBytes } from "crypto";
import { Pool } from "pg";
import { ethers } from "ethers";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cookieParser from "cookie-parser";

dotenv.config();

// ======================
// SECURITY CONFIGURATION
// ======================
const JWT_SECRET = process.env.JWT_SECRET || "midterm-jwt-secret-change-in-production";
const JWT_EXPIRES_IN = "7d";
const API_KEY_PREFIX = "sk_mid_";
const WEBHOOK_SECRET_PREFIX = "whsec_";
const BCRYPT_ROUNDS = process.env.NODE_ENV === "production" ? 12 : 10;
const ALLOWED_EMAIL_DOMAINS = process.env.ALLOWED_EMAIL_DOMAINS?.split(",") || [];
const WEBHOOK_TIMEOUT_MS = 5000; // 5 second timeout for webhook delivery

// Environment validation
const REQUIRED_ENVS = [
  "DATABASE_URL",
  "RPC_URL",
  "CHECKOUT_CONTRACT_ADDRESS",
  "GOOGLE_CLIENT_ID",
  "FRONTEND_URL"
] as const;

const missingEnvs = REQUIRED_ENVS.filter(env => !process.env[env]);
if (missingEnvs.length > 0) {
  console.error("\n❌ MISSING ENVIRONMENT VARIABLES:");
  missingEnvs.forEach(env => console.error(`   • ${env}`));
  console.error("\n📝 SETUP INSTRUCTIONS:");
  console.error("   1. Create .env with all required variables");
  console.error("   2. Get Google OAuth credentials (see README)");
  console.error("   3. Install: npm install bcrypt jsonwebtoken cookie-parser @types/*");
  console.error("   4. Start server\n");
  process.exit(1);
}

// ======================
// TYPE DEFINITIONS
// ======================
type OrderStatus = "pending" | "confirmed" | "failed";
type MerchantStatus = "active" | "suspended";
type WebhookEventType = "order.created" | "order.confirmed" | "order.failed";

interface Merchant {
  id: string;
  name: string;
  email: string;
  googleId: string;
  avatarUrl: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  status: MerchantStatus;
}

interface Order {
  id: string;
  merchantId: string;
  merchantAddress: string;
  amount: string;
  status: OrderStatus;
  onChainId: string;
  metadata: any; // Product info, customer details, etc.
  createdAt: string;
}

interface WebhookEvent {
  id: string;
  type: WebhookEventType;
  data: any;
  createdAt: string;
}

// ======================
// DATABASE SETUP
// ======================
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/**
 * COMPLETE SCHEMA FOR PRODUCTION
 * Includes webhooks, metadata, and audit fields
 */
async function ensureSchema() {
  // Merchants table with webhook configuration
  await pool.query(`
    CREATE TABLE IF NOT EXISTS merchants (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      google_id TEXT UNIQUE NOT NULL,
      avatar_url TEXT,
      webhook_url TEXT, -- For order notifications
      webhook_secret TEXT, -- HMAC secret for webhook signature
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // API keys table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      label TEXT NOT NULL,
      prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL,
      last_used_at TIMESTAMPTZ,
      revoked_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Orders table with metadata support
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      merchant_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'failed')),
      on_chain_id TEXT UNIQUE, -- For blockchain matching
      metadata JSONB DEFAULT '{}'::jsonb, -- Product info, customer details
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Webhook deliveries table (for debugging/resend)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY,
      merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      response_status INTEGER,
      response_body TEXT,
      error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  // Critical indexes
  await pool.query(`
    CREATE INDEX IF NOT EXISTS merchants_google_id_idx ON merchants(google_id) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS api_keys_prefix_idx ON api_keys(prefix) WHERE revoked_at IS NULL;
    CREATE INDEX IF NOT EXISTS orders_merchant_status_idx ON orders(merchant_id, status);
    CREATE INDEX IF NOT EXISTS orders_on_chain_id_idx ON orders(on_chain_id) WHERE on_chain_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS webhook_deliveries_merchant_idx ON webhook_deliveries(merchant_id, created_at DESC);
  `);

  // Security documentation
  await pool.query(`
    COMMENT ON COLUMN merchants.webhook_secret IS 'HMAC secret for signing webhook payloads (never expose)';
    COMMENT ON COLUMN api_keys.key_hash IS 'bcrypt hash of FULL API key (never store plaintext)';
    COMMENT ON COLUMN orders.metadata IS 'JSON metadata: {productId, productName, customerEmail, etc}';
  `);
}

// ======================
// GOOGLE AUTHENTICATION
// ======================

/**
 * Verify Google ID token and extract user profile
 */
async function verifyGoogleIdToken(idToken: string) {
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${idToken}`);
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google token verification failed: ${response.status} ${error}`);
  }

  const payload = await response.json();
  
  // Critical security validations
  if (payload.aud !== process.env.GOOGLE_CLIENT_ID) {
    throw new Error("Invalid token audience");
  }
  
  if (payload.iss !== "accounts.google.com" && payload.iss !== "https://accounts.google.com") {
    throw new Error("Invalid token issuer");
  }
  
  if (payload.email_verified !== "true") {
    throw new Error("Google account email not verified");
  }
  
  // Optional: Restrict to specific email domains
  if (ALLOWED_EMAIL_DOMAINS.length > 0) {
    const emailDomain = payload.email.split("@")[1];
    if (!ALLOWED_EMAIL_DOMAINS.includes(emailDomain)) {
      throw new Error(`Email domain @${emailDomain} is not authorized`);
    }
  }
  
  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name || payload.email.split("@")[0],
    avatarUrl: payload.picture || null,
    emailVerified: payload.email_verified === "true"
  };
}

/**
 * Find or create merchant from Google profile
 */
async function findOrCreateMerchant(googleProfile: {
  googleId: string;
  email: string;
  name: string;
  avatarUrl: string | null;
}) {
  // Try to find existing merchant by Google ID
  let result = await pool.query(
    `SELECT * FROM merchants WHERE google_id = $1 AND status = 'active'`,
    [googleProfile.googleId]
  );

  if (result.rows.length > 0) {
    // Update profile info if changed
    await pool.query(
      `UPDATE merchants 
       SET name = $1, avatar_url = $2, updated_at = NOW() 
       WHERE google_id = $3`,
      [googleProfile.name, googleProfile.avatarUrl, googleProfile.googleId]
    );
    return result.rows[0];
  }

  // Check for existing merchant with same email
  result = await pool.query(
    `SELECT id FROM merchants WHERE email = $1 AND status = 'active'`,
    [googleProfile.email]
  );
  
  if (result.rows.length > 0) {
    // Link Google account to existing merchant
    await pool.query(
      `UPDATE merchants 
       SET google_id = $1, name = $2, avatar_url = $3, updated_at = NOW() 
       WHERE email = $4`,
      [googleProfile.googleId, googleProfile.name, googleProfile.avatarUrl, googleProfile.email]
    );
    
    result = await pool.query(
      `SELECT * FROM merchants WHERE google_id = $1`,
      [googleProfile.googleId]
    );
    return result.rows[0];
  }

  // Create new merchant account
  const merchantId = randomUUID();
  await pool.query(
    `INSERT INTO merchants (id, name, email, google_id, avatar_url, status) 
     VALUES ($1, $2, $3, $4, $5, 'active')`,
    [
      merchantId,
      googleProfile.name,
      googleProfile.email,
      googleProfile.googleId,
      googleProfile.avatarUrl
    ]
  );

  console.log(`✨ New merchant created via Google: ${googleProfile.email}`);
  return {
    id: merchantId,
    name: googleProfile.name,
    email: googleProfile.email,
    google_id: googleProfile.googleId,
    avatar_url: googleProfile.avatarUrl,
    webhook_url: null,
    webhook_secret: null,
    status: "active"
  };
}

// ======================
// WEBHOOK SYSTEM
// ======================

/**
 * Generate HMAC signature for webhook payload
 */
function generateWebhookSignature(payload: string, secret: string): string {
  const crypto = require('crypto');
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Deliver webhook event to merchant's endpoint
 * Stores delivery attempt for debugging/resend capability
 */
async function deliverWebhook(
  merchantId: string,
  eventType: WebhookEventType,
  eventData: any
): Promise<void> {
  try {
    // Get merchant webhook config
    const merchantResult = await pool.query(
      `SELECT webhook_url, webhook_secret FROM merchants WHERE id = $1 AND status = 'active'`,
      [merchantId]
    );

    if (merchantResult.rowCount === 0 || !merchantResult.rows[0].webhook_url) {
      return; // No webhook configured
    }

    const { webhook_url: webhookUrl, webhook_secret: webhookSecret } = merchantResult.rows[0];
    
    // Prepare webhook event
    const eventId = randomUUID();
    const webhookEvent = {
      id: eventId,
      type: eventType,
      data: eventData,
      createdAt: new Date().toISOString()
    };

    const payload = JSON.stringify(webhookEvent);
    const signature = webhookSecret ? generateWebhookSignature(payload, webhookSecret) : null;

    // Deliver webhook with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'MidtermCheckoutPlatform/1.0',
        'X-Webhook-Id': eventId,
        'X-Webhook-Signature': signature ? `sha256=${signature}` : undefined,
        'X-Webhook-Timestamp': Date.now().toString()
      },
      body: payload,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    // Log delivery attempt
    const deliveryId = randomUUID();
    await pool.query(
      `INSERT INTO webhook_deliveries (
        id, merchant_id, event_id, event_type, payload, 
        response_status, response_body, error
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        deliveryId,
        merchantId,
        eventId,
        eventType,
        payload,
        response.status,
        response.status < 300 ? 'Success' : await response.text().catch(() => 'Read error'),
        null
      ]
    );

    if (!response.ok) {
      console.warn(`⚠️  Webhook delivery failed (${response.status}): ${webhookUrl}`);
    } else {
      console.log(`📤 Webhook delivered: ${eventType} to ${merchantId.substring(0, 8)}...`);
    }
  } catch (err: any) {
    console.error(`❌ Webhook delivery error:`, err.message);

    // Log failed delivery
    try {
      const deliveryId = randomUUID();
      await pool.query(
        `INSERT INTO webhook_deliveries (
          id, merchant_id, event_type, payload, error
        ) VALUES ($1, $2, $3, $4, $5)`,
        [
          deliveryId,
          merchantId,
          eventType,
          JSON.stringify({ error: err.message }),
          err.message
        ]
      );
    } catch (logErr) {
      console.error("Failed to log webhook delivery error:", logErr);
    }
  }
}

// ======================
// AUTHENTICATION SYSTEMS
// ======================

/**
 * GOOGLE OAUTH HANDLER
 */
async function handleGoogleAuth(req: express.Request, res: express.Response) {
  const { idToken } = req.body;
  
  if (!idToken || typeof idToken !== "string") {
    return res.status(400).json({ error: "Valid ID token required" });
  }

  try {
    const googleProfile = await verifyGoogleIdToken(idToken);
    const merchant = await findOrCreateMerchant(googleProfile);
    
    if (merchant.status !== "active") {
      return res.status(403).json({ error: "Account suspended" });
    }

    const token = jwt.sign(
      { merchantId: merchant.id, email: merchant.email, googleId: merchant.google_id },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.cookie("merchant_session", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
      domain: process.env.NODE_ENV === "production" ? new URL(process.env.FRONTEND_URL!).hostname : undefined
    });

    res.json({
      merchant: {
        id: merchant.id,
        name: merchant.name,
        email: merchant.email,
        avatarUrl: merchant.avatar_url,
        webhookUrl: merchant.webhook_url,
        status: merchant.status
      },
      message: "Authentication successful"
    });
  } catch (err: any) {
    console.error("Google auth error:", err.message);
    
    if (err.message.includes("domain")) {
      return res.status(403).json({ error: "Unauthorized email domain" });
    }
    
    res.status(401).json({ error: "Google authentication failed" });
  }
}

/**
 * ADMIN UI PROTECTED ROUTE MIDDLEWARE
 */
function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const token = req.cookies?.merchant_session;
    if (!token) {
      return res.status(401).json({ error: "Unauthorized: Login required" });
    }
    
    const decoded = jwt.verify(token, JWT_SECRET) as { 
      merchantId: string; 
      email: string;
      googleId: string 
    };
    
    (req as any).merchant = {
      id: decoded.merchantId,
      email: decoded.email,
      googleId: decoded.googleId
    };
    
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ error: "Session expired. Please login again." });
    }
    console.error("Session verification error:", err);
    return res.status(401).json({ error: "Invalid session" });
  }
}

/**
 * API KEY AUTHENTICATION (For /api/orders)
 */
async function authenticateApiKey(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
) {
  const authHeader = req.header("authorization") || req.header("x-api-key");
  if (!authHeader) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const key = authHeader.startsWith("Bearer ") 
    ? authHeader.slice(7).trim() 
    : authHeader.trim();

  if (!key.startsWith(API_KEY_PREFIX) || key.length < 20) {
    return res.status(401).json({ error: "Invalid API key format" });
  }

  const prefix = `${key.substring(0, API_KEY_PREFIX.length + 4)}...`;
  
  try {
    const result = await pool.query(
      `SELECT id, merchant_id, key_hash 
       FROM api_keys 
       WHERE prefix = $1 AND revoked_at IS NULL`,
      [prefix]
    );

    if (result.rowCount === 0) {
      await new Promise(res => setTimeout(res, 50));
      return res.status(401).json({ error: "Invalid API key" });
    }

    const apiKey = result.rows[0];
    const isValid = await bcrypt.compare(key, apiKey.key_hash);
    
    if (!isValid) {
      await new Promise(res => setTimeout(res, 50));
      return res.status(401).json({ error: "Invalid API key" });
    }

    await pool.query(
      `UPDATE api_keys SET last_used_at = NOW() WHERE id = $1`,
      [apiKey.id]
    );

    (req as any).merchant = { id: apiKey.merchant_id };
    next();
  } catch (err) {
    console.error("API key auth error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
}

// ======================
// API KEY MANAGEMENT
// ======================
async function generateApiKey(merchantId: string, label: string) {
  const randomPart = randomBytes(18).toString("base64url").replace(/=/g, "");
  const fullKey = `${API_KEY_PREFIX}${randomPart}`;
  const prefix = `${API_KEY_PREFIX}${randomPart.substring(0, 4)}`;
  const keyHash = await bcrypt.hash(fullKey, BCRYPT_ROUNDS);
  
  const keyId = randomUUID();
  await pool.query(
    `INSERT INTO api_keys (id, merchant_id, label, prefix, key_hash, created_at) 
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    [keyId, merchantId, label, `${prefix}...`, keyHash]
  );
  
  return { fullKey, prefix };
}

async function revokeApiKey(keyId: string, merchantId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE api_keys 
     SET revoked_at = NOW() 
     WHERE id = $1 AND merchant_id = $2 AND revoked_at IS NULL`,
    [keyId, merchantId]
  );
  return result.rowCount > 0;
}

// ======================
// BLOCKCHAIN INTEGRATION
// ======================
const CHECKOUT_ABI = [
  "event OrderPaid(bytes32 indexed orderId, address indexed payer, address indexed merchant, uint256 amount, uint256 timestamp, string metadata)"
];

/**
 * Update order status and trigger webhooks
 */
async function markOrderConfirmed(onChainId: string, eventMerchantAddress: string) {
  const normalizedId = onChainId.toLowerCase();
  
  try {
    // SECURITY: Verify blockchain event merchant address matches order record
    const result = await pool.query(
      `UPDATE orders 
       SET status = 'confirmed', updated_at = NOW()
       WHERE on_chain_id = $1 
         AND LOWER(merchant_address) = LOWER($2)
         AND status = 'pending'
       RETURNING id, merchant_id, merchant_address, amount, metadata`,
      [normalizedId, eventMerchantAddress]
    );

    if (result.rowCount === 0) {
      console.warn(`⚠️  Blockchain event rejected for ${normalizedId} (wallet mismatch or already confirmed)`);
      return;
    }

    const order = result.rows[0];
    console.log(`✅ ORDER CONFIRMED VIA BLOCKCHAIN: ${order.id}`);

    // Deliver webhook to merchant
    await deliverWebhook(order.merchant_id, "order.confirmed", {
      id: order.id,
      status: "confirmed",
      merchantAddress: order.merchant_address,
      amount: order.amount,
      metadata: order.metadata,
      confirmedAt: new Date().toISOString()
    });
  } catch (err) {
    console.error(`❌ Blockchain confirmation failed for ${normalizedId}:`, err);
  }
}

async function startBlockchainListener() {
  try {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
    await provider.getNetwork();
    
    const contract = new ethers.Contract(
      process.env.CHECKOUT_CONTRACT_ADDRESS!,
      CHECKOUT_ABI,
      provider
    );

    console.log(`✅ Blockchain listener active | Contract: ${process.env.CHECKOUT_CONTRACT_ADDRESS?.slice(0, 10)}...`);
    
    contract.on("OrderPaid", (orderId: string, payer: string, merchant: string, amount: bigint) => {
      console.log(`🔗 OrderPaid: ${orderId.substring(0, 10)}... | Amount: ${ethers.formatUnits(amount, 6)}`);
      markOrderConfirmed(orderId, merchant).catch(console.error);
    });

    contract.on("error", (error: Error) => {
      console.error("❌ Blockchain listener error:", error.message);
    });
  } catch (err) {
    console.error("❌ Blockchain listener init failed:", err);
    console.warn("⚠️  Orders will process but blockchain confirmation disabled");
  }
}

// ======================
// EXPRESS SERVER SETUP
// ======================
const app = express();
app.use(cors({
  origin: process.env.FRONTEND_URL,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: '1mb' })); // Prevent large payload attacks

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ======================
// AUTHENTICATION ENDPOINTS
// ======================

app.post("/auth/google", handleGoogleAuth);

app.get("/admin/session", requireAdminAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const result = await pool.query(
      `SELECT id, name, email, google_id AS "googleId", avatar_url AS "avatarUrl", 
              webhook_url AS "webhookUrl", webhook_secret AS "webhookSecret", 
              status, created_at 
       FROM merchants WHERE id = $1 AND status = 'active'`,
      [merchant.id]
    );
    
    if (result.rowCount === 0) {
      res.clearCookie("merchant_session");
      return res.status(401).json({ error: "Account not found or suspended" });
    }
    
    // Don't expose webhook secret in response
    const merchantData = result.rows[0];
    delete merchantData.webhookSecret;
    
    res.json({ merchant: merchantData });
  } catch (err) {
    console.error("Session error:", err);
    res.status(500).json({ error: "Failed to get session" });
  }
});

app.post("/admin/logout", (req, res) => {
  res.clearCookie("merchant_session", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    domain: process.env.NODE_ENV === "production" ? new URL(process.env.FRONTEND_URL!).hostname : undefined
  });
  res.json({ message: "Logged out successfully" });
});

// ======================
// MERCHANT CONFIGURATION ENDPOINTS
// ======================

// Update webhook URL (for order notifications)
app.put("/admin/webhook-config", requireAdminAuth, async (req, res) => {
  const { webhookUrl } = req.body;
  const merchant = (req as any).merchant;
  
  if (webhookUrl && typeof webhookUrl !== "string") {
    return res.status(400).json({ error: "Invalid webhook URL" });
  }

  try {
    if (webhookUrl) {
      // Validate URL format
      try {
        new URL(webhookUrl);
      } catch {
        return res.status(400).json({ error: "Invalid URL format" });
      }
    }

    // Generate webhook secret if setting URL for first time
    let webhookSecret = null;
    const current = await pool.query(
      `SELECT webhook_secret FROM merchants WHERE id = $1`,
      [merchant.id]
    );

    if (webhookUrl && !current.rows[0]?.webhook_secret) {
      // Generate secure webhook secret
      webhookSecret = WEBHOOK_SECRET_PREFIX + randomBytes(24).toString("hex");
    }

    await pool.query(
      `UPDATE merchants 
       SET webhook_url = $1, 
           webhook_secret = COALESCE($2, webhook_secret),
           updated_at = NOW() 
       WHERE id = $3`,
      [webhookUrl || null, webhookSecret, merchant.id]
    );

    res.json({ 
      message: "Webhook configuration updated", 
      webhookUrl,
      webhookSecret // Return secret ONLY when newly generated
    });
  } catch (err) {
    console.error("Webhook config error:", err);
    res.status(500).json({ error: "Failed to update webhook configuration" });
  }
});

// ======================
// API KEY MANAGEMENT ENDPOINTS
// ======================

app.post("/admin/api-keys", requireAdminAuth, async (req, res) => {
  const { label } = req.body;
  const merchant = (req as any).merchant;
  
  if (!label || typeof label !== "string" || label.length < 3) {
    return res.status(400).json({ error: "Valid label required (min 3 characters)" });
  }

  try {
    const { fullKey, prefix } = await generateApiKey(merchant.id, label.trim());
    
    res.status(201).json({
      id: randomUUID(),
      fullKey,
      prefix: `${prefix}...`,
      label: label.trim(),
      createdAt: new Date().toISOString(),
      warning: "SAVE THIS KEY NOW - it will never be shown again!"
    });
  } catch (err) {
    console.error("API key creation error:", err);
    res.status(500).json({ error: "Failed to create API key" });
  }
});

app.get("/admin/api-keys", requireAdminAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const result = await pool.query(
      `SELECT id, label, prefix, last_used_at AS "lastUsedAt", 
              revoked_at AS "revokedAt", created_at AS "createdAt"
       FROM api_keys 
       WHERE merchant_id = $1 
       ORDER BY created_at DESC`,
      [merchant.id]
    );
    
    res.json({ apiKeys: result.rows });
  } catch (err) {
    console.error("API key list error:", err);
    res.status(500).json({ error: "Failed to fetch API keys" });
  }
});

app.delete("/admin/api-keys/:id", requireAdminAuth, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const success = await revokeApiKey(req.params.id, merchant.id);
    
    if (!success) {
      return res.status(404).json({ error: "API key not found or already revoked" });
    }
    
    res.json({ message: "API key revoked successfully" });
  } catch (err) {
    console.error("API key revoke error:", err);
    res.status(500).json({ error: "Failed to revoke API key" });
  }
});

// ======================
// ORDER API ENDPOINTS (MERCHANT BACKEND INTEGRATION)
// ======================

/**
 * CREATE ORDER
 * Called by MERCHANT'S SERVER (not frontend!)
 * 
 * Example merchant backend integration:
 * 
 * // MERCHANT'S NODE.JS SERVER
 * app.post('/create-checkout', async (req, res) => {
 *   const { productId, quantity, customerEmail } = req.body;
 *   
 *   // 1. Validate product and calculate amount
 *   const product = await getProduct(productId);
 *   const amount = (product.price * quantity * 1e6).toString(); // 6 decimals
 *   
 *   // 2. Create order via your platform (API key in server env)
 *   const orderRes = await fetch('https://your-platform.com/api/orders', {
 *     method: 'POST',
 *     headers: {
 *       'Authorization': `Bearer ${process.env.PLATFORM_API_KEY}`,
 *       'Content-Type': 'application/json'
 *     },
 *     body: JSON.stringify({
 *       merchantAddress: process.env.MERCHANT_WALLET,
 *       amount,
 *       metadata: { productId, quantity, customerEmail }
 *     })
 *   });
 *   
 *   const order = await orderRes.json();
 *   
 *   // 3. Return checkout data to frontend (NO API KEY!)
 *   res.json({
 *     checkoutId: order.orderId,
 *     onChainId: order.onChainId,
 *     amount: order.amount,
 *     paymentUrl: `https://your-platform.com/pay/${order.orderId}`
 *   });
 * });
 */
app.post("/api/orders", authenticateApiKey, async (req, res) => {
  const { merchantAddress, amount, metadata } = req.body;
  const merchant = (req as any).merchant;

  // Validate merchant address (Ethereum wallet)
  if (!merchantAddress || typeof merchantAddress !== "string" || !/^0x[a-fA-F0-9]{40}$/.test(merchantAddress.trim())) {
    return res.status(400).json({ error: "Valid Ethereum address required for merchantAddress" });
  }
  
  // Validate amount (positive integer string)
  if (!amount || isNaN(Number(amount)) || BigInt(amount) <= 0) {
    return res.status(400).json({ error: "Valid positive amount required (in smallest units)" });
  }

  // Validate metadata (optional, must be object)
  if (metadata && (typeof metadata !== "object" || Array.isArray(metadata))) {
    return res.status(400).json({ error: "Metadata must be a JSON object" });
  }

  // Generate order IDs
  const orderId = randomUUID();
  const onChainId = ethers.id(orderId); // Critical for blockchain matching

  try {
    await pool.query(
      `INSERT INTO orders (
        id, merchant_id, merchant_address, amount, status, on_chain_id, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        orderId, 
        merchant.id, 
        merchantAddress.trim(), 
        amount, 
        "pending", 
        onChainId,
        metadata || {}
      ]
    );

    console.log(`🆕 Order created: ${orderId.substring(0, 8)}... | Merchant: ${merchant.id.substring(0, 8)}...`);

    // Deliver webhook to merchant
    await deliverWebhook(merchant.id, "order.created", {
      id: orderId,
      onChainId,
      merchantAddress: merchantAddress.trim(),
      amount,
      metadata: metadata || {},
      status: "pending",
      createdAt: new Date().toISOString()
    });

    res.status(201).json({
      orderId,
      onChainId,
      merchantAddress: merchantAddress.trim(),
      amount,
      status: "pending",
      metadata: metadata || {}
    });
  } catch (err) {
    console.error("Order creation error:", err);
    res.status(500).json({ error: "Failed to create order" });
  }
});

app.get("/api/orders/:id", authenticateApiKey, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const result = await pool.query(
      `SELECT id, merchant_address AS "merchantAddress", amount, status, 
              on_chain_id AS "onChainId", metadata, created_at AS "createdAt"
       FROM orders 
       WHERE id = $1 AND merchant_id = $2`,
      [req.params.id, merchant.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    console.error("Order fetch error:", err);
    res.status(500).json({ error: "Failed to fetch order" });
  }
});

// List merchant's orders (for dashboard)
app.get("/api/orders", authenticateApiKey, async (req, res) => {
  try {
    const merchant = (req as any).merchant;
    const { status, limit = 20, offset = 0 } = req.query;

    // Validate query params
    if (status && !["pending", "confirmed", "failed"].includes(status as string)) {
      return res.status(400).json({ error: "Invalid status filter" });
    }
    if (Number(limit) > 100) {
      return res.status(400).json({ error: "Limit must be <= 100" });
    }

    let query = `
      SELECT id, merchant_address AS "merchantAddress", amount, status, 
             on_chain_id AS "onChainId", metadata, created_at AS "createdAt"
      FROM orders 
      WHERE merchant_id = $1
    `;
    const params: any[] = [merchant.id];

    if (status) {
      query += ` AND status = $${params.length + 1}`;
      params.push(status);
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(Number(limit), Number(offset));

    const result = await pool.query(query, params);
    
    res.json({ orders: result.rows, total: result.rowCount });
  } catch (err) {
    console.error("Orders list error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// ======================
// STARTUP SEQUENCE
// ======================
async function start() {
  try {
    await ensureSchema();
    console.log("✅ Database schema ready (Google OAuth + Webhooks)");
    
    const server = app.listen(process.env.PORT || 4000, () => {
      console.log("\n" + "=".repeat(80));
      console.log("🚀 MIDTERM CHECKOUT PLATFORM READY - OPTION A (BACKEND-MEDIATED)");
      console.log("=".repeat(80));
      console.log(`   Frontend URL    : ${process.env.FRONTEND_URL}`);
      console.log(`   API Endpoint    : POST ${process.env.FRONTEND_URL}/api/orders`);
      console.log(`   Auth Endpoint   : POST ${process.env.FRONTEND_URL}/auth/google`);
      console.log(`   Blockchain      : ${process.env.RPC_URL ? "ACTIVE" : "DISABLED"}`);
      console.log(`\n🔐 MERCHANT INTEGRATION FLOW:`);
      console.log(`   1. Merchant logs in via Google → creates API key`);
      console.log(`   2. Merchant stores API key in THEIR SERVER environment`);
      console.log(`   3. Merchant's backend calls YOUR /api/orders (API key NEVER in browser)`);
      console.log(`   4. Your platform returns {orderId, onChainId, amount}`);
      console.log(`   5. Merchant's frontend initiates blockchain payment`);
      console.log(`   6. Blockchain event → order confirmed → webhook to merchant`);
      console.log(`\n📚 INTEGRATION GUIDE:`);
      console.log(`   See comments in /api/orders endpoint for code example`);
      console.log("=".repeat(80) + "\n");
    });

    server.on("listening", startBlockchainListener);

    const shutdown = async () => {
      console.log("\n🛑 Shutdown signal received");
      server.close(async () => {
        await pool.end();
        console.log("✅ All connections closed");
        process.exit(0);
      });
    };
    
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  } catch (err) {
    console.error("\n❌ FATAL STARTUP ERROR:", err);
    console.error("\n💡 TROUBLESHOOTING:");
    console.error("   • Verify .env has all required variables");
    console.error("   • Google OAuth redirect URI must match FRONTEND_URL");
    console.error("   • Run: npm install bcrypt jsonwebtoken cookie-parser @types/*\n");
    process.exit(1);
  }
}

start();