// Minimal browser SDK for merchants to embed a USDT0 checkout button on Flare (Coston2).
// Usage:
// <script src="/path/to/proofrails-checkout.js"></script>
// <script>
//   ProofRailsCheckout.renderButton({
//     containerId: "checkout-container",
//     orderId: "uuid-from-backend",
//     merchantAddress: "0xMerchant...",
//     amountUSDT0: "1000000", // 1 USDT0 with 6 decimals (example)
//     usdt0TokenAddress: "0xUSDT0TokenOnCoston2",
//     checkoutContractAddress: "0xYourDeployedCheckoutContract",
//     onSuccess: () => console.log("Payment success"),
//     onError: (err) => console.error(err)
//   });
// </script>

(function () {
  const ORDER_ABI = [
    "function payOrder(bytes32 orderId, address merchant, uint256 amount, string calldata metadata) external",
    "function transferFrom(address from, address to, uint256 value) external returns (bool)"
  ];

  async function ensureWallet() {
    if (!window.ethereum) {
      throw new Error("No injected wallet found (window.ethereum not available).");
    }
    const [account] = await window.ethereum.request({ method: "eth_requestAccounts" });
    return account;
  }

  async function payWithUSDT0(opts) {
    const {
      orderId,
      merchantAddress,
      amountUSDT0,
      usdt0TokenAddress,
      checkoutContractAddress,
      metadata = ""
    } = opts;

    const account = await ensureWallet();

    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();

    if (!usdt0TokenAddress) {
      throw new Error("usdt0TokenAddress is required");
    }

    const usdt0 = new ethers.Contract(usdt0TokenAddress, ["function approve(address spender, uint256 value) external returns (bool)"], signer);
    const checkout = new ethers.Contract(checkoutContractAddress, ORDER_ABI, signer);

    const amount = ethers.toBigInt(amountUSDT0);

    // 1) Approve the checkout contract to spend USDT0
    const approveTx = await usdt0.approve(checkoutContractAddress, amount);
    await approveTx.wait();

    // 2) Call payOrder on the checkout contract
    const orderIdBytes32 = ethers.id(orderId); // keccak256 hash of the order id string
    const payTx = await checkout.payOrder(orderIdBytes32, merchantAddress, amount, metadata);
    await payTx.wait();

    return { txHash: payTx.hash, from: account };
  }

  function renderButton(config) {
    const {
      containerId,
      buttonText = "Pay with USDT0",
      onSuccess,
      onError
    } = config;

    const container = document.getElementById(containerId);
    if (!container) {
      throw new Error(`Container with id ${containerId} not found`);
    }

    const button = document.createElement("button");
    button.textContent = buttonText;
    button.onclick = async () => {
      button.disabled = true;
      try {
        const result = await payWithUSDT0(config);
        if (onSuccess) onSuccess(result);
      } catch (err) {
        console.error("Checkout error:", err);
        if (onError) onError(err);
      } finally {
        button.disabled = false;
      }
    };

    container.innerHTML = "";
    container.appendChild(button);
  }

  window.ProofRailsCheckout = {
    renderButton
  };
})();


