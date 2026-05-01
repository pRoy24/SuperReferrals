# SuperStores Samples

<p align="center">
  <img src="../app/public/superreferrals-logo.png" alt="SuperReferrals" width="290" />
</p>

<p align="center">
  <strong>Sample web3-native e-commerce platform ideas with verifiable referral commerce.</strong>
</p>

<p align="center">
  Explore storefront patterns that combine wallet-native checkout, referral attribution, proof of purchase, collectible ownership, and auditable settlement.
</p>

<p align="center">
  <a href="#what-this-folder-contains">What this folder contains</a>
  · <a href="#superstores">SuperStores</a>
  · <a href="#commerce-patterns">Commerce patterns</a>
  · <a href="#run-locally">Run locally</a>
</p>

The `samples` folder contains reference ideas for web3-native commerce experiences built around SuperReferrals-style trust signals. These samples show how an e-commerce platform can make referrals, proof of purchase, payout routing, item ownership, and buyer receipts visible instead of hiding them behind opaque affiliate links or private marketplace records.

## What This Folder Contains

| Path | Sample | Focus |
| --- | --- | --- |
| `SuperStores/` | SuperStores | A wallet-first storefront framework for digital goods, collectibles, iNFTs, and referral-aware checkout. |

Future samples can use this folder to explore additional storefront concepts such as creator shops, gated product drops, buyer-owned media libraries, onchain marketplace releases, and merchant dashboards for referral settlement.

## SuperStores

SuperStores is a sample web3-native e-commerce project for selling digital goods through storefronts that understand wallets, referrals, and verifiable purchase outcomes.

The sample includes a public storefront, merchant/admin controls, seller listing tools, referral partner registration, and checkout settlement flows. A listing can represent database-only goods or onchain collectibles, including ERC-721, ERC-1155, and iNFT-style assets. Purchases track the buyer wallet, seller wallet, optional referrer, sale mechanism, settlement route, proof-of-purchase record, and release status.

## Commerce Patterns

| Pattern | What it demonstrates |
| --- | --- |
| Referral verifiability | Referral codes are tied to partner wallets and included in sale breakdowns, fee allocation, and checkout records. |
| Proof of purchase | Completed sales create a durable buyer-facing record with listing, wallet, currency, chain, settlement, and release details. |
| Wallet-native checkout | Buyers connect a wallet, select a listing, choose an accepted currency, and settle through configured payment rails. |
| Flexible ownership | Listings can stay database-backed for gasless delivery or release onchain collectibles after settlement. |
| Merchant control | Store owners configure routing, templates, accepted currencies, treasury wallets, webhooks, and storefront details. |
| Auditable payouts | Seller, platform, and referrer allocations are modeled explicitly so settlement can be inspected and verified. |

## Why It Matters

- Referral commerce becomes inspectable instead of relying on hidden tracking systems.
- Buyers can prove they purchased a digital good and understand what rights or ownership they received.
- Sellers can list media, books, files, audio, product packs, and collectible drops with wallet-aware checkout.
- Storefront owners can test payment routing, partner commissions, onchain releases, and webhook-based commerce operations.
- Developers can use the sample as a starting point for web3 e-commerce interfaces that need attribution, proof, and settlement transparency.

## Run Locally

From this repository:

```bash
cd samples/SuperStores
npm install
npm run dev
```

The SuperStores app runs as a standalone Next.js sample. Configure environment variables from `.env.example`, `.env.staging.example`, or `.env.production.example` when testing live payment, KeeperHub, or onchain release flows.
