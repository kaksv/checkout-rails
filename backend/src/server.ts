import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
import { Pool } from "pg";

dotenv.config();

type OrderStatus = "pending" | "confirmed" | "failed";

interface Order {
  id: string;
  merchantAddress: string;
  amount: string; // smallest units (e.g. 6 decimals)
  status: OrderStatus;
  createdAt: string;
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const API_KEY = process.env.API_KEY || "dev-api-key";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn("DATABASE_URL is not set. Backend will not be able to persist orders.");
}

// Postgres connection pool (Render provides DATABASE_URL env var)
export const pool = new Pool({
  connectionString: DATABASE_URL,
  // For Render's PostgreSQL SSL requirement:
  ssl: DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      merchant_address TEXT NOT NULL,
      amount TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

ensureSchema().catch((err) => {
  console.error("Failed to ensure database schema", err);
});

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.header("x-api-key");
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

app.post("/api/orders", authenticate, async (req, res) => {
  const { merchantAddress, amount } = req.body as {
    merchantAddress?: string;
    amount?: string;
  };

  if (!merchantAddress || !amount) {
    return res.status(400).json({ error: "merchantAddress and amount are required" });
  }

  const id = randomUUID();

  try {
    await pool.query(
      `INSERT INTO orders (id, merchant_address, amount, status) VALUES ($1, $2, $3, $4)`,
      [id, merchantAddress, amount, "pending"]
    );

    return res.json({
      orderId: id,
      merchantAddress,
      amount
    });
  } catch (err) {
    console.error("Error creating order:", err);
    return res.status(500).json({ error: "Failed to create order" });
  }
});

app.get("/api/orders/:id", authenticate, async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `SELECT id, merchant_address AS "merchantAddress", amount, status, created_at AS "createdAt" FROM orders WHERE id = $1`,
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Order not found" });
    }

    const row = result.rows[0] as Order;
    return res.json(row);
  } catch (err) {
    console.error("Error fetching order:", err);
    return res.status(500).json({ error: "Failed to fetch order" });
  }
});

// This is called by the blockchain listener when it sees OrderPaid.
export async function markOrderConfirmed(orderId: string) {
  try {
    await pool.query(`UPDATE orders SET status = 'confirmed' WHERE id = $1`, [orderId]);
  } catch (err) {
    console.error("Error marking order confirmed:", err);
  }
}

app.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});

