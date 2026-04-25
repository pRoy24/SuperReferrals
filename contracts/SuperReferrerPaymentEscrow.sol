// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract SuperReferrerPaymentEscrow is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct PaymentIntent {
        address customer;
        address payer;
        address beneficiary;
        address token;
        uint256 amount;
        uint256 refunded;
        bool nativeToken;
        bool settled;
        bool cancelled;
        string generationId;
    }

    mapping(bytes32 => PaymentIntent) public intents;

    event PaymentCreated(
        bytes32 indexed intentId,
        string generationId,
        address indexed customer,
        address indexed payer,
        address token,
        uint256 amount
    );
    event PaymentSettled(bytes32 indexed intentId, address indexed beneficiary, uint256 amount);
    event PaymentRefunded(bytes32 indexed intentId, address indexed recipient, uint256 amount, string reason);
    event PaymentCancelled(bytes32 indexed intentId, string reason);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function createERC20Payment(
        bytes32 intentId,
        string calldata generationId,
        address customer,
        address beneficiary,
        address token,
        uint256 amount
    ) external nonReentrant {
        require(intents[intentId].payer == address(0), "intent exists");
        require(customer != address(0) && beneficiary != address(0), "invalid recipient");
        require(token != address(0), "token required");
        require(amount > 0, "amount required");

        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        intents[intentId] = PaymentIntent({
            customer: customer,
            payer: msg.sender,
            beneficiary: beneficiary,
            token: token,
            amount: amount,
            refunded: 0,
            nativeToken: false,
            settled: false,
            cancelled: false,
            generationId: generationId
        });

        emit PaymentCreated(intentId, generationId, customer, msg.sender, token, amount);
    }

    function createNativePayment(
        bytes32 intentId,
        string calldata generationId,
        address customer,
        address beneficiary
    ) external payable nonReentrant {
        require(intents[intentId].payer == address(0), "intent exists");
        require(customer != address(0) && beneficiary != address(0), "invalid recipient");
        require(msg.value > 0, "amount required");

        intents[intentId] = PaymentIntent({
            customer: customer,
            payer: msg.sender,
            beneficiary: beneficiary,
            token: address(0),
            amount: msg.value,
            refunded: 0,
            nativeToken: true,
            settled: false,
            cancelled: false,
            generationId: generationId
        });

        emit PaymentCreated(intentId, generationId, customer, msg.sender, address(0), msg.value);
    }

    function settle(bytes32 intentId) external nonReentrant {
        PaymentIntent storage intent = intents[intentId];
        require(_canManage(intent), "not authorized");
        require(!intent.settled && !intent.cancelled, "closed");

        intent.settled = true;
        uint256 payout = intent.amount - intent.refunded;
        _transfer(intent, intent.beneficiary, payout);
        emit PaymentSettled(intentId, intent.beneficiary, payout);
    }

    function partialRefund(bytes32 intentId, uint256 amount, string calldata reason) external nonReentrant {
        PaymentIntent storage intent = intents[intentId];
        require(_canManage(intent), "not authorized");
        require(!intent.settled && !intent.cancelled, "closed");
        require(amount > 0, "amount required");
        require(intent.refunded + amount <= intent.amount, "refund too high");

        intent.refunded += amount;
        _transfer(intent, intent.payer, amount);
        emit PaymentRefunded(intentId, intent.payer, amount, reason);
    }

    function cancelAndRefund(bytes32 intentId, string calldata reason) external nonReentrant {
        PaymentIntent storage intent = intents[intentId];
        require(_canManage(intent), "not authorized");
        require(!intent.settled && !intent.cancelled, "closed");

        intent.cancelled = true;
        uint256 amount = intent.amount - intent.refunded;
        intent.refunded = intent.amount;
        _transfer(intent, intent.payer, amount);
        emit PaymentCancelled(intentId, reason);
        emit PaymentRefunded(intentId, intent.payer, amount, reason);
    }

    function _canManage(PaymentIntent storage intent) internal view returns (bool) {
        return intent.customer == msg.sender || owner() == msg.sender;
    }

    function _transfer(PaymentIntent storage intent, address recipient, uint256 amount) internal {
        if (amount == 0) {
            return;
        }
        if (intent.nativeToken) {
            (bool ok, ) = recipient.call{value: amount}("");
            require(ok, "native transfer failed");
        } else {
            IERC20(intent.token).safeTransfer(recipient, amount);
        }
    }
}
