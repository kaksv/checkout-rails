// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @dev Minimal ERC‑20 interface – OFT tokens on Flare/Coston2 should implement this.
 */
interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}

/**
 * @title Checkout
 * @notice Minimal checkout contract for merchants on Flare (Coston2) using an ERC‑20 compatible OFT token.
 *         Users call `payOrder` after approving the OFT token to this contract.
 *         The contract pulls tokens from the payer and forwards them to the merchant.
 */
contract Checkout {
    /// @notice ERC‑20 compatible OFT token used for payments.
    IERC20 public immutable paymentToken;

    /// @notice Contract owner (can be used for future admin controls if needed).
    address public immutable owner;

    /// @notice Prevents duplicate order processing.
    mapping(bytes32 => bool) public orderPaid;

    event OrderPaid(
        bytes32 indexed orderId,
        address indexed payer,
        address indexed merchant,
        uint256 amount,
        uint256 timestamp,
        string metadata
    );

    /**
     * @param tokenAddress Address of the OFT/ERC‑20 token contract on Coston2.
     */
    constructor(address tokenAddress) {
        require(tokenAddress != address(0), "Token address required");
        paymentToken = IERC20(tokenAddress);
        owner = msg.sender;
    }

    /**
     * @notice Pay an order in the configured OFT token.
     * @param orderId   Unique order identifier (off-chain generated, e.g. keccak256/UUID).
     * @param merchant  Merchant wallet address receiving tokens.
     * @param amount    Amount of tokens in smallest units (token decimals).
     * @param metadata  Optional metadata (JSON string or reference ID).
     */
    function payOrder(
        bytes32 orderId,
        address merchant,
        uint256 amount,
        string calldata metadata
    ) external {
        require(!orderPaid[orderId], "Order already paid");
        require(merchant != address(0), "Merchant required");
        require(amount > 0, "Amount must be > 0");

        orderPaid[orderId] = true;

        bool ok = paymentToken.transferFrom(msg.sender, merchant, amount);
        require(ok, "Token transfer failed");

        emit OrderPaid(orderId, msg.sender, merchant, amount, block.timestamp, metadata);
    }
}

// Deployed Coston2 Contract Address: 0x62212802924AEe885E148049d3F3355298aEDf69



