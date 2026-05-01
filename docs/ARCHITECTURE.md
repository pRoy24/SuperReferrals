# SuperReferrals Architecture

## Runtime Shape

SuperReferrals is a customer-owned NextJS app with three user levels and separate route intent. The customer is the Samsar One/Samsar JS account owner; they use `/` to register or top up the Samsar Processor account through Stripe credits, connect store/account details, and set USDC pricing per model configuration. The user is the wallet-backed buyer on `/r/:referrerCode`; they pay the customer-defined price, start render tasks with their own CTA URLs, images, prompt, metadata, model, and aspect ratio, then view prior tasks for that wallet. The public INFT viewer uses `/inft/:id` to open a unique render URL, watch or download the video, share it to social forums, and inspect the persisted 0G, wallet, referrer, and agent metadata.

The customer console also contains Agent Town, a multi-agent simulation and execution console. It seeds customer-scoped agents with wallets, AXL peer IDs, personalities, Samsar capabilities, KeeperHub workflow listings, and service marketplace metadata. Each Agent Town job creates receipts for all five 0G pillars: Chain, Storage, DA, Compute, and Service Marketplace.

Wallet-backed user sub-accounts are mapped to Samsar external users and anchored on 0G. On wallet connect, the app creates or reuses the sub-account, stores a user profile manifest on 0G Storage, and writes the profile root/referrer code to `SuperReferralsUserRegistry` on 0G Chain so later payment and render transactions can look up the wallet profile.

The generation path is:

1. Configure the customer charge currency, global user multiplier, referrer domain, and refund policy.
2. Configure enabled model/aspect pricing rows from actual processor credits per second, with optional per-model USDC/sec overrides.
3. Connect or enter a user wallet on the customer-specific user page; switch the wallet to the configured payment transaction chain, then create or reuse the wallet-backed sub-account.
4. Quote the customer-defined model/aspect price against a selected payment currency and rail on the customer account's configured payment chain.
5. Confirm payment from the external user's wallet to the customer owner wallet through KeeperHub or direct transfer, or run in local mock mode.
6. Submit the render through the storefront owner's server-managed Samsar APP_KEY and `SAMSAR_APP_SECRET` on `/v2/image_list_to_video` with user-specific `image_urls`, JSON metadata, prompt, model, aspect ratio, and optional outro/CTA fields.
7. Poll or receive webhook status through the same storefront credential.
8. On completion, fetch the video URL, persist a copy to 0G Storage, upload INFT metadata to 0G Storage, mint `SuperReferralsINFT`, and expose the unique `/inft/:id` URL for download and sharing.
9. On failure, compute the customer refund policy and submit a KeeperHub direct transfer.

## Live Adapters

- Samsar: `app/src/lib/samsar.ts`
- Uniswap Trading API: `app/src/lib/uniswap.ts`
- KeeperHub direct execution: `app/src/lib/keeperhub.ts`
- 0G Storage: `app/src/lib/zero-g.ts`
- INFT contract mint: `app/src/lib/inft.ts`
- 0G Agent application: `app/src/lib/agent-framework.ts`
- ENS lookup: `app/src/lib/ens.ts`
- Gensyn AXL peer messaging: `app/src/lib/axl.ts`

All adapters return deterministic mock results when `SUPERREFERRALS_MOCKS=true`, which keeps local development usable without keys. Staging and production set `SUPERREFERRALS_MOCKS=false` once the live provider keys and contract addresses are configured. For Samsar, each storefront owner connects through the storefront portal, then the backend provisions a long-lived APP_KEY using `SAMSAR_APP_SECRET`.

Wallet payment prompts and payment adapters default from `TRANSACTION_CHAIN_ID` plus the matching `NEXT_PUBLIC_TRANSACTION_CHAIN_ID`, but the customer account's `pricing.chainId` is the source of truth for user render payments. Dev/staging customers should be saved with Ethereum Sepolia (`11155111`) so wallet prompts, Uniswap quotes, and KeeperHub transfers stay off mainnet. Production customers can use Ethereum mainnet (`1`) or Base mainnet (`8453`) only when `NODE_ENV=production` and `DEPLOYMENT_ENV=production`; non-production runtime maps those production chain ids back to Sepolia. Renders do not start until the server verifies a mined wallet payment transaction against the expected sender, customer or KeeperHub payment recipient, chain, payment token, and quote amount unless `ALLOW_MOCK_RENDER_PAYMENT=true` is explicitly set for local-only demos. Live non-stable token render payments use a KeeperHub payment workflow: the quote event records the expected payment, and the payment-confirmed event is sent only after the server verifies the mined wallet transaction.

0G records are controlled by `OG_CHAIN_ID` and related contract-specific overrides. Dev/staging use 0G Galileo (`16602`) for user registry, INFT, agent registry, storage, and DA. Production uses 0G mainnet (`16661`).

## On-Chain Contracts

`SuperReferralsPaymentEscrow.sol` stores generation payment intents and supports settlement, partial refund, and cancel-and-refund flows.

`SuperReferralsUserRegistry.sol` stores wallet sub-account profile roots, 0G profile URIs, and referrer codes for later lookup.

`SuperReferralsINFT.sol` is an ERC-7857-inspired ERC-721 wrapper that stores encrypted metadata URI, metadata hash, agent wallet, referrer code, and per-token executor permissions.

`SuperReferralsAgentRegistry.sol` stores agent manifests and emits agent job requested, completed, and rollback events for 0G Chain anchoring.

## Agent Application

Agent jobs are created through `POST /api/agents` and shown in the customer console. The flow is:

1. Store the input manifest on 0G Storage.
2. Ask 0G Compute for an execution plan and QA/rollback gates.
3. Request a Uniswap charge signal for the customer settlement currency.
4. Build a KeeperHub distribution record for customer revenue, agent operator fees, and platform coordination fees.
5. Publish a DA commitment over the input, plan, price, and settlement roots.
6. Anchor the job through `SuperReferralsAgentRegistry` on the configured transaction chain.
7. Select or publish a 0G service marketplace intent.
8. Send Gensyn AXL messages between the seeded agents and persist the timeline.

See `docs/AGENT_APPLICATION.md` for details.

## Protocol References

- 0G Storage TypeScript SDK supports `@0gfoundation/0g-ts-sdk`, `ethers`, `Indexer`, `MemData`, and Node-side uploads.
- Ethereum Sepolia is the staging transaction network for wallet/payment/contract adapters: `TRANSACTION_CHAIN_ID=11155111`.
- Ethereum mainnet is the default production transaction network: `TRANSACTION_CHAIN_ID=1`.
- Base mainnet is also supported for production payment deployments: `TRANSACTION_NETWORK=base`, `TRANSACTION_CHAIN_ID=8453`.
- 0G Galileo testnet defaults are `OG_CHAIN_ID=16602`, `OG_RPC_URL=https://evmrpc-testnet.0g.ai`, and turbo indexer `https://indexer-storage-testnet-turbo.0g.ai`.
- 0G mainnet defaults are `OG_CHAIN_ID=16661`, `OG_RPC_URL=https://evmrpc.0g.ai`, and turbo indexer `https://indexer-storage-turbo.0g.ai`.
- 0G INFT docs describe ERC-7857, encrypted metadata, secure metadata transfer, and 0G Storage/Chain/Compute roles.
- KeeperHub API exposes workflow, execution, direct execution, and wallet-management endpoints under `https://app.keeperhub.com/api`; use `X-API-Key` auth for programmatic access.
- KeeperHub CLI uses `kh`, supports login plus `KH_API_KEY` for CI/CD, and exposes workflow, run, execute, wallet, project, and billing commands.
- Uniswap API quote flow uses `/quote` for routing data; the app must handle user approvals, Permit2 signatures when returned, and wallet-signed `/swap` or `/order` submission.
- Uniswap AI provides `swap-integration` and `pay-with-any-token` skills for future agent-assisted integration work.
- Gensyn AXL exposes a local API on `localhost:9002` with `/send`, `/recv`, `/topology`, and protocol-aware MCP/A2A routing.
- ENS resolver docs support addresses, text records, contenthashes, and subname routing patterns. Production resolution starts from Ethereum mainnet; test names can use Sepolia by setting `ENS_CHAIN_ID=11155111`.
