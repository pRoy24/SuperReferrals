# SuperReferrals Agent Application

## Goal

The agent application turns the current SuperReferrals video flow into a multi-agent operating surface. Each job produces explicit receipts across the five 0G pillars while staying aligned with Samsar JS video, assistant, embedding, and image APIs.

## 0G Pillar Mapping

| Pillar | Implementation |
| --- | --- |
| 0G Chain | `SuperReferralsAgentRegistry.sol` records agent manifests and job lifecycle events. INFT minting remains in `SuperReferralsINFT.sol`. |
| 0G Storage | Agent job manifests, compute plans, video metadata, and receipts are uploaded through `persistJsonToZeroG` and existing video persistence. |
| 0G DA | `publishDataAvailabilityCommitment` publishes job root bundles. In local mode it returns deterministic `0g-da://mock` receipts. |
| 0G Compute | `askZeroGCompute` plans jobs, QA gates, rollback policies, and agent handoffs. Local mock mode still returns deterministic plans. |
| 0G Service Marketplace | Agent profiles expose service listings and KeeperHub workflow IDs; `OG_SERVICE_MARKETPLACE_URL` can publish live service intents. |

## Agent Town

Agent Town is a Gensyn AXL-first simulation layer. The seeded agents are:

- Deployer: coordinates 0G receipts and registry work.
- Samsar Director: chooses Samsar video actions.
- Brand Guardian: checks prompt, CTA, and customer policy.
- Pricing Oracle: produces Uniswap charge signals.
- Settlement Keeper: creates KeeperHub distribution and rollback records.
- AXL Mayor: routes free-form inter-agent chatter.

Run it from the customer dashboard under `Agent Town`, or call:

```http
POST /api/agents
```

with:

```json
{
  "customerId": "cus_from_checkout_or_login",
  "objective": "Plan a referrer video workflow with full 0G receipts.",
  "payload": {
    "image_urls": ["https://images.unsplash.com/photo-1542291026-7eec264c27ff"],
    "video_model": "RUNWAYML",
    "aspect_ratio": "9:16",
    "prompt": "Create a launch video."
  }
}
```

## Samsar Alignment

The agent capability catalog is grounded in the local `samsar-js` client:

- `/v2/image_list_to_video`
- `/v2/translate_video`
- `/v2/join_videos`
- `/v2/remove_subtitles`
- `/v2/add_outro_image`
- `/v2/update_outro_image`
- `/v2/cancel_render`
- `/v2/assistant/completion`
- `chat/generate_embeddings_from_plain_text`
- `image/enhance`
- `image/remove_branding`
- `image/replace_branding`
- `image/create_rollup_banner`

The INFT action route now exposes add/update outro and cancel render in addition to translate, join, remove subtitles, and AXL messaging.

## Payment And Rollback

Uniswap is used as the price signal source through `createUniswapChargeSignal`. KeeperHub is used for payment distribution and rollback records through `executeKeeperDistribution` and `executeKeeperRollback`.

Local mock mode creates realistic settlement receipts without moving funds. Live mode uses `SUPERREFERRALS_MOCKS=false` and requires:

```env
KEEPERHUB_API_KEY=
KEEPERHUB_WALLET_ADDRESS=
```

## Live 0G Configuration

```env
AGENT_REGISTRY_CONTRACT_ADDRESS=
OG_DA_URL=
OG_SERVICE_MARKETPLACE_URL=
```

The app remains mock-first when `SUPERREFERRALS_MOCKS` is unset or true. In live mode, 0G Compute uses the 0G serving broker and the platform compute signer from `OG_COMPUTE_PRIVATE_KEY` to discover inference providers. Deployed assistant requests do not fall back to customer/project `OG_PRIVATE_KEY`. Set `OG_COMPUTE_PROVIDER_ADDRESS` when the platform wallet is funded with a specific provider for the current environment/model.
