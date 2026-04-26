# SuperReferrals Skills

## User-Facing Theme

- Match the Samsar user-facing theme used by `../samsar_one/landing` and `../samsar_one/samsar_blog`.
- Use the dark Samsar surface treatment: Space Grotesk, IBM Plex Mono for code and wallet data, cyan/green accents, subtle grid backgrounds, translucent panels, and compact operational layouts.
- Customer interfaces should stay configuration-focused. Users should self-sign up from the customer landing page by connecting a wallet.
- Keep route intent separate: `/` is for the customer account owner, `/r/:referrerCode` is for the wallet-backed user, and `/inft/:id` is the public render/INFT viewer.

## Role Terms

- Customer: entity that creates or tops up a Samsar One/Samsar JS account, connects store/account details, and sets global multiplier or per-model USDC/sec pricing for render configurations.
- User: wallet-backed entity that pays the customer-defined render price and generates videos with their own CTA URL, images, prompt, model, aspect ratio, and metadata.
- INFT viewer: public holder or visitor of a unique render URL who can watch, download, and share the rendered video while viewing 0G/referrer/agent metadata.

## Wallet Payment References

### KeeperHub

- KeeperHub app: https://app.keeperhub.com/
- KeeperHub API docs: https://docs.keeperhub.com/api
- KeeperHub CLI docs: https://docs.keeperhub.com/cli

Implementation notes:

- API base URL is `https://app.keeperhub.com/api`.
- API requests require session auth or API-key auth.
- The CLI command is `kh`; use `KH_API_KEY` in CI/CD or scripted environments.
- KeeperHub is the preferred automation rail for direct execution, payment workflow automation, and refunds.

### Uniswap

- Uniswap developer docs: https://developers.uniswap.org/docs
- Uniswap AI repository: https://github.com/Uniswap/uniswap-ai

Implementation notes:

- Use the Uniswap API for quotes, routes, and transaction calldata; users still sign and submit wallet transactions.
- Quote flow starts with `/quote`; swap execution proceeds through `/swap` or `/order` depending on the route.
- Permit2 may require an approval and an EIP-712 signature before swap submission.
- The Uniswap AI repo includes the `swap-integration` and `pay-with-any-token` skills for future deeper integration work.

## Adjacent Project Paths

- Samsar Processor backend: `/Users/pritamroy/Documents/others/workspace/samsar_one/samsar_processor`
