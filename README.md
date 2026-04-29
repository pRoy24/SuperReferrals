# SuperReferrals

Turn referral links into product marketing videos.

SuperReferrals helps product teams and creators turn a plain referral URL into a guided campaign page with product images, product details, video generation, CTA actions, and shareable output.

Instead of sending buyers through a bare tracking URL, a creator shares a page that explains the product, shows the offer, and can generate a tailored marketing video before or after purchase. Customers get enough context to feel good about the recommendation, while referrers and brands get reusable product media instead of another passive link.

Built for the ETHGlobal Open Agents hackathon, SuperReferrals focuses on practical referral commerce: connect product data, generate campaign videos, route users through a branded referral experience, and keep the operational workflow auditable.

## ETHGlobal Hackathon Judging

For hackathon testing and judging, use the staging website:

[https://super-referrals-git-develop-proy24s-projects.vercel.app](https://super-referrals-git-develop-proy24s-projects.vercel.app)

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
- Completed public INFT pages recover from the configured INFT collection and 0G token metadata when the server runtime index is missing. Keep `INFT_CONTRACT_ADDRESS`, `INFT_RPC_URL`, and `OG_STORAGE_INDEXER_RPC` configured in staging and production.
- Live ETH-to-USDC render payments require KeeperHub platform wallet and payment workflow configuration; the app quotes a buffered ETH amount and KeeperHub settles the storefront's USDC amount to the merchant payout wallet.

## Local Run

Install note: `package.json` uses the published `samsar-js` package. Run `npm install` to install the locked client version.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For a no-key demo, keep the global mock switch on:

```bash
SUPERREFERRALS_MOCKS=true
```

For staging with live Samsar, KeeperHub Sepolia payments, 0G Galileo records, and live 0G Compute:

```bash
cp .env.staging.example .env.local
```

For production:

```bash
cp .env.production.example .env.local
```

Use private RPC providers for production reliability.

Vercel KV/Upstash env vars are normally injected by the deploy setup. Only put `KV_REST_API_URL` and `KV_REST_API_TOKEN` in a local env file when deliberately running against local or manually managed Redis.

0G Compute does not require endpoint, model, or API-key env vars. The server uses the 0G serving broker with the deployed platform signer from `OG_PRIVATE_KEY` by default, discovers live inference providers, and selects the top documented chatbot model for the current 0G environment: `qwen-2.5-7b-instruct` on Galileo/testnet and `GLM-5-FP8` on mainnet. Set `OG_COMPUTE_PRIVATE_KEY` only when assistant compute should use a separate platform-funded wallet. If the platform wallet is funded with a specific provider, set `OG_COMPUTE_PROVIDER_ADDRESS`. On testnet, `OG_COMPUTE_AUTO_FUND` defaults on and will initialize the 0G Compute ledger and provider sub-account from the platform wallet when the selected provider has no sub-account yet. The default provider sub-account transfer is `0.1` 0G.

```bash
cp .env.production.example .env.local
```

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

For a project-specific Vercel token, either export `VERCEL_TOKEN` for the current shell or put the token in `.vercel-token` and run `chmod 600 .vercel-token`. If the project belongs to a different Vercel account than the globally logged-in CLI account, create the token from the account that owns the project and do not use `--use-global-token`. The script defaults to scope `proy24s-projects`; override with `--scope <vercel-account-or-team-slug>` if the owner scope differs.

Preview what would change without touching Vercel:

```bash
npm run vercel:env:sync -- staging --dry-run
npm run vercel:env:staging:local -- --dry-run
npm run vercel:env:sync -- production --dry-run
```

Dry runs warn about placeholder values. Actual sync runs fail until placeholders are replaced with real values.

Apply changes only when you intentionally run the script:

```bash
npm run vercel:env:staging
npm run vercel:env:staging:local
npm run vercel:env:production
```

The sync stores local hashes under `.vercel-env-sync/` so later runs update only changed keys. It does not print env values, refuses obvious placeholder values, blocks `VERCEL_*` control credentials from upload, and only removes remote keys when run with `--delete-removed`.

By default staging maps to Vercel `preview` for branch `develop`, and production maps to Vercel `production`. Override with `VERCEL_STAGING_ENVIRONMENT`, `VERCEL_STAGING_BRANCH`, `VERCEL_PRODUCTION_ENVIRONMENT`, or command flags such as `--environment` and `--branch`.

Vercel env changes apply to new deployments only; redeploy or push after syncing if the running deployment needs the new values. See the [Vercel env CLI docs](https://vercel.com/docs/cli/env) and [environment variable docs](https://vercel.com/docs/environment-variables).

## Deploy Storage Bootstrap

`deploy.json` describes the Vercel project, required Upstash Redis resource, disabled-by-default Blob store, staging/production env files, and required 0G storage variables. A new operator can run the bootstrap script to validate 0G env, launch Vercel login/link flows when needed, and create the free Upstash Redis resource:

```bash
npm run deploy:setup:staging
npm run deploy:setup:production
```

Use `--dry-run` to preview actions:

```bash
npm run deploy:setup:staging -- --dry-run
```

The script can use `VERCEL_TOKEN`, `.vercel-token`, or an active Vercel CLI login. If Vercel asks for an auth challenge, complete the browser/email flow and rerun the command. Upstash Redis provisioning first checks for an existing linked Redis resource, accepts Marketplace terms by default when provisioning is needed, and should add `KV_REST_API_URL` and `KV_REST_API_TOKEN` to the linked project. Pass `--no-accept-marketplace-terms` only if you want to complete Marketplace terms manually. Environment sync is intentionally not run by default; pass `--sync-env` when the target env file is ready to upload.

Upstash Redis is required for mutable app state: authenticated user/session state, Samsar account/session cache, credits, checkout state, quotes, render hot indexes, storefront ratings, and webhook/polling state. The application fails fast with setup instructions if `KV_REST_API_URL` and `KV_REST_API_TOKEN` are missing. Vercel Blob is disabled by default because Redis holds mutable app state and 0G Storage holds render artifacts/metadata. Blob is only useful later for encrypted private object snapshots/backups or private non-KV files. Keep 0G Storage for public generation artifacts and durable public render metadata; do not put auth tokens or private user secrets into public 0G metadata.

The legacy local JSON store is only read once to seed an empty Redis key during migration. Runtime reads and writes go to Redis. Completed INFT views should still be recoverable through the onchain INFT token URI and 0G metadata when live 0G/INFT env vars are configured.

For staging previews, Vercel needs a Git event it can deploy. Push a new commit to `develop` or open a PR from `develop`; a local branch or a branch pointer that matches an already deployed `main` commit may not create a new Preview Deployment by itself.

## Key Environment Variables

- `SUPERREFERRALS_MOCKS`: global mock switch. Defaults to mocked behavior when unset.
- `SUPERREFERRALS_MOCKS=false`: live mode for all providers. Provider-specific mock overrides are no longer needed in the minimal staging/production env files.
- `KV_REST_API_URL`, `KV_REST_API_TOKEN`: injected by Vercel/Upstash setup. Add them manually only for local Redis testing.
- `SAMSAR_APP_SECRET`: server-only secret, at least 32 characters, used to generate Samsar long-lived storefront APP_KEY credentials and to encrypt/hash stored APP_KEY values.
- Samsar credentials are connected per storefront owner through Stripe checkout or account sign-in. The app uses the returned auth token only to provision a long-lived APP_KEY, stores an HMAC hash plus encrypted APP_KEY server-side, and sends APP_KEY + `SAMSAR_APP_SECRET` to `/v2` Samsar routes for generation and edit operations.
- `TRANSACTION_NETWORK`, `TRANSACTION_CHAIN_ID`, `TRANSACTION_RPC_URL`: payment and wallet network.
- `NEXT_PUBLIC_TRANSACTION_NETWORK`, `NEXT_PUBLIC_TRANSACTION_CHAIN_ID`, `NEXT_PUBLIC_TRANSACTION_RPC_URL`: browser wallet prompts.
- `KEEPERHUB_API_KEY`, `KEEPERHUB_WALLET_ADDRESS`, `KEEPERHUB_PAYMENT_WORKFLOW_ID_<NETWORK>`: live KeeperHub payment and settlement.
- `UNISWAP_API_KEY`: live Uniswap quote and swap transaction data.
- `OG_NETWORK`, `OG_CHAIN_ID`, `OG_RPC_URL`, `OG_STORAGE_INDEXER_RPC`, `OG_PRIVATE_KEY`: 0G Chain, Storage, registry, INFT signer, and default platform 0G Compute signer.
- `OG_COMPUTE_PRIVATE_KEY`, `OG_COMPUTE_PROVIDER_ADDRESS`: optional platform 0G Compute signer override and optional funded provider address for the embedded assistant. Runtime also accepts scoped variants such as `OG_COMPUTE_PRIVATE_KEY_STAGING_QWEN_2_5_7B_INSTRUCT` or `OG_COMPUTE_PRIVATE_KEY_MAINNET_GLM_5_FP8`.
- `OG_COMPUTE_AUTO_FUND`, `OG_COMPUTE_AUTO_FUND_AMOUNT`, `OG_COMPUTE_AUTO_DEPOSIT_AMOUNT`: optional automatic 0G Compute ledger and provider sub-account initialization. Defaults to enabled on testnet and disabled on mainnet.
- `OG_DA_URL`, `OG_SERVICE_MARKETPLACE_URL`: live 0G DA and service marketplace endpoints.
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
