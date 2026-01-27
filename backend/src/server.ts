import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "crypto";

dotenv.config();

type OrderStatus = "pending" | "confirmed" | "failed";

interface Order {
  id: string;
  merchantAddress: string;
  amountUSDC: string; // string to avoid JS float issues, in 6-decimal units
  status: OrderStatus;
  createdAt: string;
}

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const API_KEY = process.env.API_KEY || "dev-api-key";

// In-memory store for demo purposes.
const orders = new Map<string, Order>();

function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = req.header("x-api-key");
  if (!key || key !== API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }
  next();
}

app.post("/api/orders", authenticate, (req, res) => {
  const { merchantAddress, amountUSDC } = req.body as {
    merchantAddress?: string;
    amountUSDC?: string;
  };

  if (!merchantAddress || !amountUSDC) {
    return res.status(400).json({ error: "merchantAddress and amountUSDC are required" });
  }

  const id = randomUUID();
  const order: Order = {
    id,
    merchantAddress,
    amountUSDC,
    status: "pending",
    createdAt: new Date().toISOString()
  };

  orders.set(id, order);

  return res.json({
    orderId: id,
    merchantAddress,
    amountUSDC
  });
});

app.get("/api/orders/:id", authenticate, (req, res) => {
  const { id } = req.params;
  const order = orders.get(id);
  if (!order) {
    return res.status(404).json({ error: "Order not found" });
  }
  return res.json(order);
});

// This would be called by the blockchain listener when it sees OrderPaid.
export function markOrderConfirmed(orderId: string) {
  const order = orders.get(orderId);
  if (order) {
    order.status = "confirmed";
    orders.set(orderId, order);
  }
}

app.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});


