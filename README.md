## ProofRails – USDT0 Checkout on Flare (Coston2)

This project is a reference implementation of a blockchain-based checkout platform for merchants.

- **Smart Contract**: Receives **USDT0** (an OFT/ERC‑20 stablecoin on Flare) payments and emits on-chain events for order confirmation.
- **Backend**: Manages orders, API keys, and listens for contract events.
- **Frontend SDK**: Lightweight JavaScript widget merchants embed in their sites to trigger payments.
- **Network**: Flare testnet **Coston2**.
- **Stablecoin**: **USDT0** (OFT/ERC‑20 token on Coston2, configured when deploying the checkout contract).

### High-Level Flow

1. **Merchant creates an order** via the backend (`POST /api/orders`).
2. **Merchant site loads the SDK widget**, passing the `orderId`, `amount`, and `merchantAddress`.
3. **Customer connects a wallet** (e.g. MetaMask) and approves **USDT0** if needed.
4. **SDK calls the checkout contract** `payOrder`, which pulls **USDT0** from the customer and sends it to the merchant.
5. **Contract emits `OrderPaid` event**; the backend listener confirms the order and updates its status.

### Structure

- `contracts/` – Solidity checkout contract.
- `backend/` – Node/TypeScript API + event listener.
- `sdk/` – Embeddable JavaScript SDK for merchants.


