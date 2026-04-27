# SuperReferrals

SuperReferrals is an ETHGlobal Open Agents hackathon project for agentic, on-chain referral video campaigns.

Customers configure a Samsar-powered referral page, set per-second render pricing, and share the page with users. Users connect a wallet, pay on-chain, generate a personalized `image_list_to_video` ad through Samsar, and receive a public INFT page backed by 0G records and storage.

The project is built to show how agents can coordinate real commerce, media generation, storage, settlement, and rollback workflows across Samsar, 0G, Uniswap, KeeperHub, and Gensyn AXL.

## What To Review

- `/`: customer console for Samsar Processor credits, store setup, pricing, render history, and Agent Town.
- `/r/:referrerCode`: public user referral page for wallet signup, payment, image-to-video generation, and prior renders.
- `/feed`: public feed for generated referral videos.
- `/inft/:id`: public INFT page with video playback, 0G metadata, wallet/referrer attribution, assistant actions, and AXL messaging.
- `Agent Town`: multi-agent console that produces receipts for 0G Chain, 0G Storage, 0G DA, 0G Compute, 0G Service Marketplace, Uniswap charge signals, KeeperHub settlement, and AXL messages.

## Core Flow

1. A customer creates or tops up a Samsar Processor account.
2. The customer configures a public referral page, pricing, wallet, currency, and refund policy.
3. A user connects a wallet on the referral page and gets a wallet-backed Samsar external-user profile.
4. The profile manifest is stored on 0G Storage and anchored in `SuperReferralsUserRegistry` on 0G Chain.
5. The user submits image URLs, prompt, metadata, CTA URL, model, and aspect ratio.
6. The app quotes payment, verifies a mined transaction, and grants Samsar render credits.
7. Samsar generates the video.
8. Completion persists video metadata to 0G Storage and mints an ERC-7857-inspired INFT through `SuperReferralsINFT`.
9. The public INFT page exposes the video, attribution, agent metadata, and post-render actions.

## Network Constraints

Staging uses 0G staging/Galileo and Ethereum Sepolia.

- Payment chain: Ethereum Sepolia, `TRANSACTION_CHAIN_ID=11155111`.
- Sepolia USDC: `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
- 0G chain: Galileo, `OG_CHAIN_ID=16602`.
- 0G RPC: `https://evmrpc-testnet.0g.ai`.
- 0G Storage indexer: `https://indexer-storage-testnet-turbo.0g.ai`.

Mainnet uses 0G mainnet plus Ethereum mainnet and Base mainnet payment deployments.

- Default payment chain: Ethereum mainnet, `TRANSACTION_NETWORK=mainnet`, `TRANSACTION_CHAIN_ID=1`.
- Optional Base payment chain: `TRANSACTION_NETWORK=base`, `TRANSACTION_CHAIN_ID=8453`.
- Base USDC: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.
- 0G chain: mainnet, `OG_CHAIN_ID=16661`.
- 0G RPC: `https://evmrpc.0g.ai`.
- 0G Storage indexer: `https://indexer-storage-turbo.0g.ai`.

Important runtime guardrails:

- Non-production runtime maps Ethereum mainnet and Base mainnet transaction configs back to Sepolia unless `NODE_ENV=production` and `DEPLOYMENT_ENV=production`.
- `pricing.chainId` on the customer account is the source of truth for render payment quotes.
- Renders do not start until the server verifies payment sender, recipient, chain, token, and amount.
- `ALLOW_MOCK_RENDER_PAYMENT=true` is only for local demos.
- 0G records, INFT minting, and agent registry use the configured 0G network, not the payment network.
- Live non-stable-token payments require Uniswap quote data and a KeeperHub payment workflow.

## Local Run

Install note: `package.json` currently references `samsar-js` as a local sibling package at `../samsar_one/samsar-js`. Keep that workspace present, or replace it with the published Samsar JS package before installing.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For a no-key demo, set the mock flags in `.env.local`:

```bash
SUPERREFERRALS_MOCKS=true
SAMSAR_MOCKS=true
UNISWAP_MOCKS=true
KEEPERHUB_MOCKS=true
ZERO_G_MOCKS=true
AGENT_REGISTRY_MOCKS=true
USER_REGISTRY_MOCKS=true
OG_SERVICE_MARKETPLACE_MOCKS=true
INFT_MOCKS=true
OG_COMPUTE_MOCKS=true
AXL_MOCKS=true
```

To test one live service at a time, leave global mocks on and set only that provider to live, for example:

```bash
SUPERREFERRALS_MOCKS=true
SAMSAR_MOCKS=false
SAMSAR_API_KEY=replace_with_samsar_api_key
```

For staging with live Samsar, KeeperHub Sepolia payments, and 0G Galileo records:

```bash
cp .env.staging.example .env.local
```

For production:

```bash
cp .env.production.example .env.local
```

Use private RPC providers for production reliability.

## Key Environment Variables

- `SUPERREFERRALS_MOCKS`: global mock switch. Defaults to mocked behavior when unset.
- `<PROVIDER>_MOCKS`: per-provider overrides such as `SAMSAR_MOCKS`, `KEEPERHUB_MOCKS`, `ZERO_G_MOCKS`, `INFT_MOCKS`, `OG_COMPUTE_MOCKS`, and `AXL_MOCKS`.
- `SAMSAR_API_KEY`: required for live Samsar generation.
- `TRANSACTION_NETWORK`, `TRANSACTION_CHAIN_ID`, `TRANSACTION_RPC_URL`: payment and wallet network.
- `NEXT_PUBLIC_TRANSACTION_NETWORK`, `NEXT_PUBLIC_TRANSACTION_CHAIN_ID`, `NEXT_PUBLIC_TRANSACTION_RPC_URL`: browser wallet prompts.
- `KEEPERHUB_API_KEY`, `KEEPERHUB_PAYMENT_WORKFLOW_ID`, `KEEPERHUB_PLATFORM_WALLET_ADDRESS`: live KeeperHub settlement.
- `UNISWAP_API_KEY`: live Uniswap quote and swap transaction data.
- `OG_NETWORK`, `OG_CHAIN_ID`, `OG_RPC_URL`, `OG_STORAGE_INDEXER_RPC`, `OG_PRIVATE_KEY`: 0G Chain and Storage.
- `USER_REGISTRY_CONTRACT_ADDRESS`: deployed `SuperReferralsUserRegistry` address.
- `INFT_CONTRACT_ADDRESS`, `INFT_MINTER_PRIVATE_KEY`: deployed INFT collection and mint signer.
- `AXL_BASE_URL`: local Gensyn AXL node API, default `http://localhost:9002`.

## Contracts

Contracts live in `contracts/`.

- `SuperReferralsUserRegistry.sol`: wallet sub-account profile roots and referrer lookup.
- `SuperReferralsINFT.sol`: ERC-7857-inspired INFT with encrypted metadata URI, metadata hash, agent wallet, referrer code, and executor permissions.
- `SuperReferralsAgentRegistry.sol`: agent manifests and job lifecycle receipts for 0G Chain.
- `SuperReferralsPaymentEscrow.sol`: generation payment intents, settlement, partial refund, and cancellation flows.

Compile contracts:

```bash
npm run contracts:compile
```

Deploy one INFT collection per 0G network, then set `INFT_CONTRACT_ADDRESS`:

```bash
npm run contracts:deploy:inft:testnet
npm run contracts:deploy:inft:mainnet
```

The deploy script uses `INFT_DEPLOYER_PRIVATE_KEY`, `INFT_MINTER_PRIVATE_KEY`, or `OG_PRIVATE_KEY` as the signer. It uses the same signer as owner unless `INFT_INITIAL_OWNER` is set.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Agent application](docs/AGENT_APPLICATION.md)
- [KeeperHub workflow](docs/KEEPERHUB_WORKFLOW.md)
- [Project skills and integration notes](SKILLS.md)
