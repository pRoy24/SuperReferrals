# SuperReferrals

Turn referral links into product marketing videos.

SuperReferrals helps product teams and creators turn a plain referral URL into a guided campaign page with product images, product details, video generation, CTA actions, and shareable output.

Instead of sending buyers through a bare tracking URL, a creator shares a page that explains the product, shows the offer, and can generate a tailored marketing video before or after purchase. Customers get enough context to feel good about the recommendation, while referrers and brands get reusable product media instead of another passive link.

Built for the ETHGlobal Open Agents hackathon, SuperReferrals focuses on practical referral commerce: connect product data, generate campaign videos, route users through a branded referral experience, and keep the operational workflow auditable.

## Unique Offering

- Product/admin integration: plug into merchant dashboards, catalog systems, or admin frameworks to pull product images, descriptions, price points, CTA URLs, and campaign metadata.
- Flexible video styles: generate natural explainers, fast-paced launch ads, anime promos, futuristic edits, product walkthroughs, or brand-specific creative variants.
- Customer-friendly referral pages: buyers see the product story and creator context instead of landing on an opaque tracking URL.
- Creator-ready campaigns: referrers promote with useful product media, not just a code or link.
- Reusable output: generated videos can be viewed, shared, and reused as campaign assets.

## What To Review

- `/`: product landing page with entry points into the demo surfaces.
- `/dashboard`: customer console for store setup, pricing, campaign automation, render history, and Samsar Processor credits.
- `/r/:referrerCode`: public user referral page for wallet connection, ETH/USDC payment, image-to-video generation, and prior renders.
- `/feed`: public feed for generated referral videos.
- `/inft/:id`: public output page with video playback, attribution, assistant actions, and share/download actions.
- `Agent Town`: campaign automation console for planning, pricing, settlement, rollback, and media operations.

## Core Flow

1. A customer configures a public referral page, product context, pricing, wallet, currency, refund policy, and render API access from `/dashboard`.
2. The customer publishes the storefront route.
3. A creator or buyer opens the referral page and connects a wallet.
4. The app creates or reuses an internal wallet user record for that customer/referrer route; the public user does not need a Samsar JS account or subaccount.
5. The user submits or reuses product image URLs, product metadata, CTA URL, prompt, model, style, and aspect ratio.
6. The app quotes ETH or USDC payment on the configured network, verifies the mined transaction, and starts the render with the configured Samsar API key.
7. Samsar generates the video.
8. Completion saves the video metadata, creates the public output record, and exposes the generated campaign asset.
9. The public output page exposes the video, attribution, campaign metadata, and post-render actions.

## Product Data And Creative Styles

SuperReferrals is designed to sit next to existing merchant/admin tooling. A production integration can pull:

- Product images and alternate media.
- Names, descriptions, variants, prices, tags, and availability.
- Brand voice, campaign copy, CTA URLs, and referrer metadata.
- Creative presets such as natural demo, fast-paced launch, anime, futuristic, luxury, educational, or UGC-style explainers.

## Technical Network Notes

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
- Live ETH-to-USDC render payments require KeeperHub platform wallet and payment workflow configuration; the app quotes a buffered ETH amount and KeeperHub settles the storefront's USDC amount to the merchant payout wallet.

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
SAMSAR_API_URL=https://api.samsar.one
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

## Vercel Environment Sync

The Vercel project is `proy24s-projects/super-referrals`. Keep deploy credentials out of app env files:

- `.env.staging` is the local source for Vercel Preview env vars scoped to the `develop` branch.
- `.env.production` is the local source for Vercel Production env vars.
- `.vercel-token` may hold a personal Vercel token for this project and is ignored by Git. You can also set `VERCEL_TOKEN` in your shell.

Create local env files from the examples, then replace placeholders before syncing:

```bash
cp .env.staging.example .env.staging
cp .env.production.example .env.production
chmod 600 .env.staging .env.production
```

For a project-specific Vercel token, either export `VERCEL_TOKEN` for the current shell or put the token in `.vercel-token` and run `chmod 600 .vercel-token`.

Preview what would change without touching Vercel:

```bash
npm run vercel:env:sync -- staging --dry-run
npm run vercel:env:sync -- production --dry-run
```

Dry runs warn about placeholder values. Actual sync runs fail until placeholders are replaced with real values.

Apply changes only when you intentionally run the script:

```bash
npm run vercel:env:staging
npm run vercel:env:production
```

The sync stores local hashes under `.vercel-env-sync/` so later runs update only changed keys. It does not print env values, refuses obvious placeholder values, blocks `VERCEL_*` control credentials from upload, and only removes remote keys when run with `--delete-removed`.

By default staging maps to Vercel `preview` for branch `develop`, and production maps to Vercel `production`. Override with `VERCEL_STAGING_ENVIRONMENT`, `VERCEL_STAGING_BRANCH`, `VERCEL_PRODUCTION_ENVIRONMENT`, or command flags such as `--environment` and `--branch`.

Vercel env changes apply to new deployments only; redeploy or push after syncing if the running deployment needs the new values. See the [Vercel env CLI docs](https://vercel.com/docs/cli/env) and [environment variable docs](https://vercel.com/docs/environment-variables).

On Vercel, set `SUPERREFERRALS_DATA_DIR=/tmp/superreferrals`. The deployed bundle directory is not a writable data directory, and `/tmp` storage is ephemeral, so a production app that must retain customers, ratings, generations, or feed state across cold starts needs a durable database or object store behind `src/lib/store.ts`.

For staging previews, Vercel needs a Git event it can deploy. Push a new commit to `develop` or open a PR from `develop`; a local branch or a branch pointer that matches an already deployed `main` commit may not create a new Preview Deployment by itself.

## Key Environment Variables

- `SUPERREFERRALS_MOCKS`: global mock switch. Defaults to mocked behavior when unset.
- `<PROVIDER>_MOCKS`: per-provider overrides such as `SAMSAR_MOCKS`, `KEEPERHUB_MOCKS`, `ZERO_G_MOCKS`, `INFT_MOCKS`, `OG_COMPUTE_MOCKS`, and `AXL_MOCKS`.
- `SAMSAR_API_URL`: production Samsar API origin. Defaults to `https://api.samsar.one`.
- `SAMSAR_API_KEY`: required for live Samsar generation when a logged-in customer account does not provide its own API key.
- `TRANSACTION_NETWORK`, `TRANSACTION_CHAIN_ID`, `TRANSACTION_RPC_URL`: payment and wallet network.
- `NEXT_PUBLIC_TRANSACTION_NETWORK`, `NEXT_PUBLIC_TRANSACTION_CHAIN_ID`, `NEXT_PUBLIC_TRANSACTION_RPC_URL`: browser wallet prompts.
- `KEEPERHUB_API_KEY`, `KEEPERHUB_WALLET_ADDRESS`, `KEEPERHUB_PAYMENT_WORKFLOW_ID`: live KeeperHub payment and settlement.
- `UNISWAP_API_KEY`: live Uniswap quote and swap transaction data.
- `OG_NETWORK`, `OG_CHAIN_ID`, `OG_RPC_URL`, `OG_STORAGE_INDEXER_RPC`, `OG_PRIVATE_KEY`: 0G Chain, Storage, registry, and INFT signer.
- `USER_REGISTRY_CONTRACT_ADDRESS`: deployed `SuperReferralsUserRegistry` address.
- `INFT_CONTRACT_ADDRESS`: deployed INFT collection. Minting uses `OG_PRIVATE_KEY`.
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

The deploy script uses `OG_PRIVATE_KEY` as the signer and initial owner.

## Docs

- [Architecture](docs/ARCHITECTURE.md)
- [Agent application](docs/AGENT_APPLICATION.md)
- [KeeperHub workflow](docs/KEEPERHUB_WORKFLOW.md)
- [Project skills and integration notes](SKILLS.md)
