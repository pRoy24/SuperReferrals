# KeeperHub Payment Workflow

Create one KeeperHub workflow per payment network:

| Network | Chain id | Workflow id | Status |
| --- | ---: | --- | --- |
| Sepolia | 11155111 | `replace_with_keeperhub_sepolia_workflow_id` | private draft until enabled |
| Ethereum mainnet | 1 | `replace_with_keeperhub_ethereum_workflow_id` | private draft until enabled |
| Base mainnet | 8453 | `replace_with_keeperhub_base_workflow_id` | private draft until enabled |

All three workflows use a webhook trigger. Do not enable production traffic until the action nodes are configured and each workflow has passed a dry run on its target network. The API accepted the draft graph and labels, but KeeperHub's public REST docs do not expose the full executable action-node schema for swap/transfer nodes, so the final action configuration must be completed in the KeeperHub builder or AI workflow assistant.

## Target Flow

1. `quote_created`
   - Validate quote input.
   - Record the expected payer, payment recipient, payment token, payment amount, settlement token, customer recipient, network, and chain id.
   - Do not transfer funds in this event.
2. User wallet transfer
   - The browser asks the user to send ETH/WETH/USDC on the configured payment chain.
   - The server verifies the mined transaction sender, recipient, chain, token, and amount before render start.
3. `payment_confirmed`
   - KeeperHub receives the verified `paymentTxHash`.
   - For ETH/WETH payments, convert the received value to the chain's USDC.
   - Transfer USDC to the customer `recipientAddress`.
   - Return execution/run ids and settlement tx hashes.
4. Render execution
   - Only after the payment tx is verified and KeeperHub settlement starts successfully, the app grants Samsar credits and starts the render.
5. `render_failed` or `refund_requested`
   - Run rollback/refund logic according to the customer refund policy.
   - Send status metadata back to the app if a callback URL is configured.

## Webhook Payload

The app sends this shape to `POST /api/workflow/{workflowId}/execute` with the existing `KEEPERHUB_API_KEY`:

```json
{
  "event": "payment_confirmed",
  "network": "sepolia",
  "chainId": 11155111,
  "payerAddress": "0xUserWallet",
  "recipientAddress": "0xCustomerWallet",
  "paymentRecipientAddress": "0xKeeperHubOrPlatformWallet",
  "paymentTxHash": "0x...",
  "paymentTokenAddress": "0x0000000000000000000000000000000000000000",
  "tokenAddress": "0x0000000000000000000000000000000000000000",
  "settlementTokenAddress": "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  "paymentAmountAtomic": "1096666666666666",
  "settlementAmountAtomic": "3290000",
  "amount": "3.29",
  "amountUsd": 3.29,
  "quoteId": "quote_...",
  "generationId": "gen_...",
  "reason": "Settle SuperReferrals render gen_...",
  "metadata": {
    "verification": {
      "txHash": "0x...",
      "chainId": 11155111,
      "blockNumber": "123",
      "tokenAddress": "0x0000000000000000000000000000000000000000",
      "recipientWallet": "0xKeeperHubOrPlatformWallet",
      "amountAtomic": "1096666666666666"
    }
  }
}
```

## KeeperHub Builder Nodes

Configure the draft nodes as:

1. `Render payment webhook`
   - Trigger type: manual/API execution.
   - Auth: `KEEPERHUB_API_KEY`.
2. `Validate payload`
   - Code or condition node.
   - Fail closed unless `chainId == 11155111`, `network == "sepolia"`, `paymentTxHash` exists for `payment_confirmed`, and amount fields are positive.
3. `Settle customer in USDC`
   - For `payment_confirmed`.
   - If payment token is native ETH/WETH, swap to the target-chain USDC using the supported KeeperHub swap path or a contract-call route approved by the KeeperHub wallet.
   - Transfer target-chain USDC to `recipientAddress`.
4. `Rollback or refund`
   - For `render_failed` or `refund_requested`.
   - Refund `payerAddress` using the original payment token where possible; otherwise transfer USDC equivalent and mark manual review if slippage or balance is insufficient.
5. `Notify SuperReferrals`
   - Optional webhook action back to the application with run id, settlement tx hash, refund tx hash, and final status.

## Environment

Local/dev/staging:

```bash
SUPERREFERRALS_MOCKS=false
KEEPERHUB_API_KEY=<keeperhub_api_key>
TRANSACTION_CHAIN_ID=11155111
NEXT_PUBLIC_TRANSACTION_CHAIN_ID=11155111
KEEPERHUB_PAYMENT_WORKFLOW_ID_SEPOLIA=replace_with_keeperhub_sepolia_workflow_id
KEEPERHUB_WALLET_ADDRESS=<funded KeeperHub organization wallet>
```

Production Ethereum mainnet:

```bash
NODE_ENV=production
DEPLOYMENT_ENV=production
TRANSACTION_CHAIN_ID=1
NEXT_PUBLIC_TRANSACTION_CHAIN_ID=1
KEEPERHUB_PAYMENT_WORKFLOW_ID_ETHEREUM=replace_with_keeperhub_ethereum_workflow_id
KEEPERHUB_WALLET_ADDRESS=<funded KeeperHub organization wallet>
```

Production Base mainnet:

```bash
NODE_ENV=production
DEPLOYMENT_ENV=production
TRANSACTION_NETWORK=base
TRANSACTION_CHAIN_ID=8453
NEXT_PUBLIC_TRANSACTION_NETWORK=base
NEXT_PUBLIC_TRANSACTION_CHAIN_ID=8453
KEEPERHUB_PAYMENT_WORKFLOW_ID_BASE=replace_with_keeperhub_base_workflow_id
KEEPERHUB_WALLET_ADDRESS=<funded KeeperHub organization wallet>
```

KeeperHub wallet creation is not exposed by the public REST API used here. The docs describe creating a shared organization wallet from the KeeperHub Organization Wallet dialog with Turnkey. Keep one `KEEPERHUB_WALLET_ADDRESS`; balances and funding are still per network.

## References

- KeeperHub workflow API: https://docs.keeperhub.com/api/workflows
- KeeperHub authentication: https://docs.keeperhub.com/api/authentication
- KeeperHub overview and Sepolia support: https://docs.keeperhub.com/
- KeeperHub Web3 transfer actions: https://docs.keeperhub.com/plugins/web3
