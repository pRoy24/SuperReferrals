# SuperReferrals

SuperReferrals is a NextJS on-chain adapter for Samsar `image_list_to_video`. It lets a customer create a Samsar JS account, configure render pricing, accept wallet self-signups from users, collect on-chain payment, generate marketing videos through Samsar, persist the completed video and metadata to 0G Storage, and mint an ERC-7857-style INFT with referrer attributes.

The app now includes an Agent Town console: a mock-first multi-agent application that uses 0G Chain, Storage, DA, Compute, and Service Marketplace receipts while coordinating Samsar actions, Uniswap charge signals, KeeperHub settlement, and Gensyn AXL messages.

The app runs immediately in deterministic mock mode. Keep `SUPERREFERRALS_MOCKS=true` and set a provider flag such as `SAMSAR_MOCKS=false` to use only that live service while the rest remain mocked. Set all provider mock flags to `false` when you want fully live Samsar, Uniswap, KeeperHub, 0G, ENS, and AXL integrations.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Main Flows

- Customer configures account pricing, charge currency, referrer domain, optional ENS name, and refund policy.
- Customer page at `/` is for Samsar JS/Samsar Processor account creation through credit purchase/top-up, store setup, global pricing multiplier, and per-model USDC/sec pricing.
- User page at `/r/:referrerCode` is for wallet signup, payment against the customer per-second pricing, render requests, and previous wallet render tasks.
- User connects a wallet from the landing page; the app creates or reuses the wallet-backed sub-account, persists a user profile manifest to 0G Storage, and anchors the profile in `SuperReferralsUserRegistry` on 0G Chain.
- User submits image URLs, JSON metadata, CTA URL, prompt, model, and aspect ratio for `image_list_to_video`.
- Payment quote can be created for the customer account's configured chain and charge currency while the user pays the customer owner wallet through direct transfer or a Uniswap swap plus settlement transfer. The server verifies the mined transaction sender, recipient, chain, token, and amount before granting Samsar external-user credits and starting the render.
- Render requests without a verified payment transaction stay pending or are rejected unless `ALLOW_MOCK_RENDER_PAYMENT=true` is explicitly set for local-only demos.
- Generation completion triggers 0G Storage persistence, INFT metadata upload, and INFT mint.
- Public INFT page at `/inft/:id` exposes the unique render URL, video download/share actions, assistant actions, retranslate, join, remove subtitles, update outro, send AXL peer messages, and inspect callable capabilities.

## Role Model

- Customer: the Samsar One/Samsar JS account owner. They buy or top up Samsar Processor credits, connect store/account details, and set a global pricing multiplier or per-model USDC/sec prices.
- User: the wallet-backed buyer for a customer page. They pay the customer's configured price, start render tasks with their own CTA URLs/images/metadata, and can view their prior renders.
- INFT viewer: any holder or public visitor opening a unique `/inft/:id` URL. They can watch, download, and share the rendered video while viewing its 0G, wallet, referrer, and agent metadata.

## Important Environment Variables

- `SAMSAR_API_KEY`: parent customer/platform Samsar API key.
- `SAMSAR_MOCKS=false`: use live Samsar while other integrations can stay mocked.
- `TRANSACTION_CHAIN_ID` / `NEXT_PUBLIC_TRANSACTION_CHAIN_ID`: wallet prompt and payment transaction chain. Use `11155111` for dev/staging Sepolia and `1` for production mainnet.
- `ALLOW_MOCK_RENDER_PAYMENT`: defaults to `false`; when false, render requests without a payment transaction stay `PAYMENT_PENDING`.
- Customer `pricing.chainId`: source of truth for the user render payment chain; staging customers should be saved with Sepolia and production customers with mainnet.
- `TRANSACTION_RPC_URL` / `NEXT_PUBLIC_TRANSACTION_RPC_URL`: RPC URL used by server-side transaction adapters and wallet network-add prompts.
- `USER_REGISTRY_CONTRACT_ADDRESS`: deployed `SuperReferralsUserRegistry` on 0G Chain. Dev/staging use 0G Galileo (`OG_CHAIN_ID=16602`); production uses 0G mainnet (`OG_CHAIN_ID=16661`).
- `UNISWAP_API_KEY`: quote and swap transaction integration for user pay-with-any-token and agent price signals.
- `KEEPERHUB_API_KEY`: user render payment, partial refund, and rollback execution.
- `KEEPERHUB_PAYMENT_WORKFLOW_ID`: optional KeeperHub workflow for pay-with-any-token swaps before settlement. Required for live non-stable token payments such as ETH/WETH.
- `OG_PRIVATE_KEY`, `OG_RPC_URL`, `OG_STORAGE_INDEXER_RPC`: 0G Storage upload signer.
- `INFT_CONTRACT_ADDRESS`, `INFT_MINTER_PRIVATE_KEY`: deployed INFT contract and minter.
- `AXL_BASE_URL`: local Gensyn AXL node, default `http://localhost:9002`.

## Real Samsar, Mock Everything Else

```bash
cp .env.staging.example .env.local
```

Set:

```bash
SUPERREFERRALS_MOCKS=true
SAMSAR_MOCKS=false
SAMSAR_API_KEY=sk_your_samsar_key
APP_BASE_URL=http://localhost:3000
```

Leave `UNISWAP_MOCKS`, `KEEPERHUB_MOCKS`, `ZERO_G_MOCKS`, `INFT_MOCKS`, `OG_COMPUTE_MOCKS`, and `AXL_MOCKS` as `true` for local smoke tests. Set `KEEPERHUB_MOCKS=false`, `KEEPERHUB_API_KEY`, and `KEEPERHUB_PAYMENT_WORKFLOW_ID` when testing live Sepolia render payments.

Known network defaults:

- Staging transaction network: Ethereum Sepolia, `TRANSACTION_CHAIN_ID=11155111`, USDC `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
- Production transaction network: Ethereum mainnet, `TRANSACTION_CHAIN_ID=1`.
- Dev/staging 0G Galileo for user registry, storage, INFT, and agent registry: `OG_CHAIN_ID=16602`, `OG_RPC_URL=https://evmrpc-testnet.0g.ai`, `OG_STORAGE_INDEXER_RPC=https://indexer-storage-testnet-turbo.0g.ai`.
- Production 0G mainnet for 0G records and storage: `OG_CHAIN_ID=16661`, `OG_RPC_URL=https://evmrpc.0g.ai`, `OG_STORAGE_INDEXER_RPC=https://indexer-storage-turbo.0g.ai`.
- AXL: `AXL_BASE_URL=http://localhost:9002` because AXL exposes a local HTTP API.
- ENS: `ENS_CHAIN_ID=1` and an Ethereum mainnet RPC for production names. For Sepolia tests, use `ENS_CHAIN_ID=11155111` and a Sepolia RPC URL.

## Contracts

Contracts are in `contracts/`:

- `SuperReferralsINFT.sol`: ERC-7857-inspired INFT with encrypted metadata URI, metadata hash, usage authorization, and agent wallet metadata.
- `SuperReferralsUserRegistry.sol`: wallet sub-account profile registry that stores the 0G profile root and referrer code for later lookup.
- `SuperReferralsPaymentEscrow.sol`: escrowed generation payments with settlement and partial refund events.

Compile with:

```bash
npm run contracts:compile
```

## Docs

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation notes, live integration behavior, and source references.

See [SKILLS.md](SKILLS.md) for the project-specific Samsar theme, KeeperHub, and Uniswap references.
See [docs/AGENT_APPLICATION.md](docs/AGENT_APPLICATION.md) for the refined agent framework and Agent Town architecture.
