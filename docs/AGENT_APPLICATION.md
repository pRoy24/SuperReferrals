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
  "customerId": "cus_demo",
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

- `external_users/image_list_to_video`
- `video/translate_video`
- `video/join_videos`
- `video/remove_subtitles`
- `video/add_outro_image`
- `video/update_outro_image`
- `video/cancel_render`
- `assistant/completion`
- `chat/generate_embeddings_from_plain_text`
- `image/enhance`
- `image/remove_branding`
- `image/replace_branding`
- `image/create_rollup_banner`

The INFT action route now exposes add/update outro and cancel render in addition to translate, join, remove subtitles, and AXL messaging.

## Payment And Rollback

Uniswap is used as the price signal source through `createUniswapChargeSignal`. KeeperHub is used for payment distribution and rollback records through `executeKeeperDistribution` and `executeKeeperRollback`.

Local mock mode creates realistic settlement receipts without moving funds. Live mode requires:

```env
UNISWAP_MOCKS=false
KEEPERHUB_MOCKS=false
KEEPERHUB_API_KEY=
KEEPERHUB_PLATFORM_WALLET_ADDRESS=
```

## Live 0G Configuration

```env
ZERO_G_MOCKS=false
AGENT_REGISTRY_MOCKS=false
AGENT_REGISTRY_CONTRACT_ADDRESS=
AGENT_REGISTRY_PRIVATE_KEY=
OG_DA_URL=
OG_SERVICE_MARKETPLACE_MOCKS=false
OG_SERVICE_MARKETPLACE_URL=
OG_COMPUTE_MOCKS=false
OG_COMPUTE_URL=
```

The app remains mock-first. A local run should exercise the full agent path without external keys, then each provider can be made live independently.
