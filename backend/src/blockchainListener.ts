import dotenv from "dotenv";
import { ethers } from "ethers";
import { markOrderConfirmed } from "./server";

dotenv.config();

// ABI fragment for the OrderPaid event
const CHECKOUT_ABI = [
  "event OrderPaid(bytes32 indexed orderId, address indexed payer, address indexed merchant, uint256 amount, uint256 timestamp, string metadata)"
];

const RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const CHECKOUT_CONTRACT_ADDRESS = process.env.CHECKOUT_CONTRACT_ADDRESS || "";

if (!RPC_URL || !CHECKOUT_CONTRACT_ADDRESS) {
  console.warn("SEPOLIA_RPC_URL or CHECKOUT_CONTRACT_ADDRESS not set. Blockchain listener is disabled.");
  process.exit(0);
}

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const contract = new ethers.Contract(CHECKOUT_CONTRACT_ADDRESS, CHECKOUT_ABI, provider);

  console.log(`Listening for OrderPaid events on ${CHECKOUT_CONTRACT_ADDRESS}...`);

  contract.on("OrderPaid", (orderId: string, payer: string, merchant: string, amount: bigint) => {
    console.log("OrderPaid event:", { orderId, payer, merchant, amount: amount.toString() });

    // Convert bytes32 ID to string; in a real system you'd ensure a consistent encoding.
    const decodedOrderId = ethers.toBeHex(orderId);
    markOrderConfirmed(decodedOrderId);
  });
}

main().catch((err) => {
  console.error("Blockchain listener error:", err);
});


