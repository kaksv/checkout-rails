require('dotenv').config();
const express = require('express');
const app = express();
app.use(express.json());

// NEVER expose this in browser code!
const PLATFORM_API_KEY = process.env.PLATFORM_API_KEY; // From .env
const PLATFORM_URL = "http://localhost:4000"; // Your platform URL
const MERCHANT_WALLET = process.env.MERCHANT_WALLET; // Payout address

// Database of products
const PRODUCTS = {
  "tshirt": { id: "tshirt", name: "T-Shirt", price: 25.00, inventory: 100 },
  "hoodie": { id: "hoodie", name: "Hoodie", price: 45.00, inventory: 50 }
};

// Endpoint: Create checkout session
app.post('/api/create-checkout', async (req, res) => {
  try {
    const { productId, quantity, customerEmail } = req.body;
    
    // 1. Validate product exists
    const product = PRODUCTS[productId];
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    // 2. Check inventory
    if (product.inventory < quantity) {
      return res.status(400).json({ error: "Insufficient inventory" });
    }
    
    // 3. Calculate amount (6 decimal places for blockchain)
    const amount = Math.round(product.price * quantity * 1e6).toString();
    
    // 4. Create order via your platform (API key SERVER-SIDE)
    const orderResponse = await fetch(`${PLATFORM_URL}/api/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PLATFORM_API_KEY}`, // Safe: server-to-server
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        merchantAddress: MERCHANT_WALLET,
        amount,
        metadata: {
          productId,
          productName: product.name,
          quantity,
          customerEmail,
          unitPrice: product.price
        }
      })
    });
    
    if (!orderResponse.ok) {
      const error = await orderResponse.json();
      console.error("Platform error:", error);
      return res.status(orderResponse.status).json({ error: "Failed to create checkout" });
    }
    
    const order = await orderResponse.json();
    
    // 5. Return checkout data to frontend (NO API KEY!)
    res.json({
      success: true,
      checkoutId: order.orderId,
      onChainId: order.onChainId, // For blockchain payment
      amount: order.amount,
      displayAmount: (parseFloat(order.amount) / 1e6).toFixed(2), // For UI
      paymentInstructions: {
        contractAddress: process.env.CHECKOUT_CONTRACT_ADDRESS,
        onChainId: order.onChainId,
        amount: order.amount
      }
    });
    
  } catch (err) {
    console.error("Checkout creation error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Webhook endpoint: Receive order confirmations from your platform
app.post('/webhooks/checkout-platform', express.raw({ type: 'application/json' }), async (req, res) => {
  // 1. Verify webhook signature (security!)
  const signature = req.headers['x-webhook-signature']?.split('=')[1];
  const timestamp = req.headers['x-webhook-timestamp'];
  
  if (!signature || !timestamp) {
    return res.status(401).json({ error: "Missing signature" });
  }
  
  // 2. Validate signature (implement HMAC verification)
  // const expectedSignature = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET)
  //   .update(JSON.stringify(req.body)).digest('hex');
  // if (signature !== expectedSignature) {
  //   return res.status(401).json({ error: "Invalid signature" });
  // }
  
  // 3. Process webhook event
  const event = JSON.parse(req.body.toString());
  
  console.log(`🔔 Webhook received: ${event.type}`, event.data);
  
  if (event.type === 'order.confirmed') {
    // Update order status in merchant's database
    // Send confirmation email to customer
    // Fulfill order (ship product, grant access, etc.)
    console.log(`✅ Order ${event.data.id} confirmed! Fulfilling...`);
    
    // Example: Send email
    // await sendConfirmationEmail(event.data.metadata.customerEmail, event.data);
  }
  
  res.json({ received: true });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🏪 Merchant server running on http://localhost:${PORT}`);
  console.log(`   Webhook endpoint: POST http://localhost:${PORT}/webhooks/checkout-platform`);
});