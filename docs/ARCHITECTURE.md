# SuperReferrer Architecture

## Runtime Shape

SuperReferrer is a customer-owned NextJS app. The customer configures pricing and a Samsar parent API key. Sub-accounts are mapped to Samsar external users, so every generation is attributed to a sub-account while the parent account remains the billing and model owner.

The generation path is:

1. Create or select customer and sub-account.
2. Quote the customer-defined per-image price and optional Uniswap route.
3. Confirm payment or run in local mock mode.
4. Call Samsar `external_users/image_list_to_video` with `image_urls`, JSON metadata, prompt, model, aspect ratio, and optional outro/CTA fields.
5. Poll or receive webhook status.
6. On completion, fetch the video URL, persist a copy to 0G Storage, upload INFT metadata to 0G Storage, then mint `SuperReferrerINFT`.
7. On failure, compute the customer refund policy and submit a KeeperHub direct transfer.

## Live Adapters

- Samsar: `src/lib/samsar.ts`
- Uniswap Trading API: `src/lib/uniswap.ts`
- KeeperHub direct execution: `src/lib/keeperhub.ts`
- 0G Storage: `src/lib/zero-g.ts`
- 0G Chain INFT mint: `src/lib/inft.ts`
- ENS lookup: `src/lib/ens.ts`
- Gensyn AXL peer messaging: `src/lib/axl.ts`

All adapters return deterministic mock results when `SUPERREFERRER_MOCKS=true`, which keeps local development usable without keys.

## On-Chain Contracts

`SuperReferrerPaymentEscrow.sol` stores generation payment intents and supports settlement, partial refund, and cancel-and-refund flows.

`SuperReferrerINFT.sol` is an ERC-7857-inspired ERC-721 wrapper that stores encrypted metadata URI, metadata hash, agent wallet, referrer code, and per-token executor permissions.

## Protocol References

- 0G Storage TypeScript SDK supports `@0gfoundation/0g-ts-sdk`, `ethers`, `Indexer`, `MemData`, and Node-side uploads.
- 0G INFT docs describe ERC-7857, encrypted metadata, secure metadata transfer, and 0G Storage/Chain/Compute roles.
- KeeperHub API exposes direct transfer and contract-call endpoints, plus automatic gas estimation and multipliers.
- Uniswap Trading API quote flow uses `/v1/quote`, API-key auth, Permit2, router version headers, slippage, and routing preferences.
- Gensyn AXL exposes a local API on `localhost:9002` with `/send`, `/recv`, `/topology`, and protocol-aware MCP/A2A routing.
- ENS resolver docs support addresses, text records, contenthashes, and subname routing patterns.
