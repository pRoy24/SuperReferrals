# SuperReferrer

SuperReferrer is a NextJS on-chain adapter for Samsar `image_list_to_video`. It lets a customer configure pricing, create sub-accounts, collect on-chain payment, generate marketing videos through Samsar, persist the completed video and metadata to 0G Storage, and mint an ERC-7857-style INFT with referrer attributes.

The app runs immediately in deterministic mock mode. Add keys in `.env.local` and set `SUPERREFERRER_MOCKS=false` to use live Samsar, Uniswap, KeeperHub, 0G, ENS, and AXL integrations.

## Run

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

## Main Flows

- Customer configures account pricing, referrer domain, optional ENS name, and refund policy.
- Sub-account gets a Samsar external-user session under the customer API key.
- User submits image URLs, JSON metadata, and prompt for `image_list_to_video`.
- Payment quote can be created through the Uniswap Trading API.
- Generation completion triggers 0G Storage persistence, INFT metadata upload, and INFT mint.
- Each INFT page exposes assistant actions: retranslate, join, remove subtitles, update outro, send AXL peer messages, and inspect callable capabilities.

## Important Environment Variables

- `SAMSAR_API_KEY`: parent customer/platform Samsar API key.
- `UNISWAP_API_KEY`: quote and swap integration.
- `KEEPERHUB_API_KEY`: partial refund and rollback execution.
- `OG_PRIVATE_KEY`, `OG_RPC_URL`, `OG_STORAGE_INDEXER_RPC`: 0G Storage upload signer.
- `INFT_CONTRACT_ADDRESS`, `INFT_MINTER_PRIVATE_KEY`: deployed INFT contract and minter.
- `AXL_BASE_URL`: local Gensyn AXL node, default `http://localhost:9002`.

## Contracts

Contracts are in `contracts/`:

- `SuperReferrerINFT.sol`: ERC-7857-inspired INFT with encrypted metadata URI, metadata hash, usage authorization, and agent wallet metadata.
- `SuperReferrerPaymentEscrow.sol`: escrowed generation payments with settlement and partial refund events.

Compile with:

```bash
npm run contracts:compile
```

## Docs

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for implementation notes, live integration behavior, and source references.
