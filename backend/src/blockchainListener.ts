import dotenv from "dotenv";
import { ethers } from "ethers";
import { markOrderConfirmed } from "./server";

dotenv.config();

// ABI fragment for the OrderPaid event
const CHECKOUT_ABI = [
  "event OrderPaid(bytes32 indexed orderId, address indexed payer, address indexed merchant, uint256 amount, uint256 timestamp, string metadata)"
];

const RPC_URL = process.env.RPC_URL || process.env.SEPOLIA_RPC_URL || "";
const CHECKOUT_CONTRACT_ADDRESS = process.env.CHECKOUT_CONTRACT_ADDRESS || "";

if (!RPC_URL || !CHECKOUT_CONTRACT_ADDRESS) {
  console.warn("RPC_URL or CHECKOUT_CONTRACT_ADDRESS not set. Blockchain listener is disabled.");
  process.exit(0);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CHECKOUT_CONTRACT_ADDRESS, CHECKOUT_ABI, provider);

  console.log(`Listening for OrderPaid events on ${CHECKOUT_CONTRACT_ADDRESS}...`);

  contract.on("OrderPaid", (orderId: string, payer: string, merchant: string, amount: bigint) => {
    console.log("OrderPaid event:", { orderId, payer, merchant, amount: amount.toString() });

    // In this example we stored the UUID string off-chain and hashed it to bytes32 on-chain with ethers.id(orderId).
    // To map the event back to the same UUID in the database you can:
    //  - store the bytes32 hash alongside the order row, OR
    //  - derive a stable encoding strategy you can reverse/compare.
    //
    // For now we log the raw bytes32 so you can align encoding later.
    void markOrderConfirmed(orderId);
  });
}

main().catch((err) => {
  console.error("Blockchain listener error:", err);
});


