import { createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getAxlTopology, sendAxlMessage } from "./axl";
import { askZeroGCompute } from "./compute";
import { env, isProviderMock } from "./env";
import { bytes32From, createId, nowIso, shortHash } from "./ids";
import { deriveAgentWallet } from "./inft";
import { executeKeeperDistribution, executeKeeperRollback } from "./keeperhub";
import { amountToAtomic } from "./payment-tokens";
import { countImages, priceGeneration, roundMoney } from "./pricing";
import {
  addAgentJob,
  addAgentTownEvent,
  mutateStore,
  readStore,
  updateAgentJob,
  upsertAgent
} from "./store";
import { createUniswapChargeSignal } from "./uniswap";
import { persistJsonToZeroG, publishDataAvailabilityCommitment } from "./zero-g";
import { getZeroGChainConfig } from "./zero-g-chain";
import type {
  AgentCapability,
  AgentJob,
  AgentJobType,
  AgentPillarReceipt,
  AgentProfile,
  AgentTownEvent,
  Customer,
  GenerationInput,
  KeeperSettlementRecord,
  ZeroGPillar
} from "./types";

const registryAbi = parseAbi([
  "function requestJob(bytes32 jobId, address targetAgent, bytes32 inputRoot, uint256 maxSpend)",
  "function completeJob(bytes32 jobId, bytes32 outputRoot)",
  "function rollbackJob(bytes32 jobId, string reason)"
]);

export const ZERO_G_PILLARS: Array<{ id: ZeroGPillar; label: string; purpose: string }> = [
  { id: "chain", label: "0G Chain", purpose: "Agent registry, job state, INFT ownership, and event commitments." },
  { id: "storage", label: "0G Storage", purpose: "Prompts, manifests, video roots, memory, and receipts." },
  { id: "da", label: "0G DA", purpose: "Availability commitments for job batches and audit evidence." },
  { id: "compute", label: "0G Compute", purpose: "Planning, QA, routing, moderation, and autonomous decisions." },
  { id: "service_marketplace", label: "0G Service Marketplace", purpose: "Provider discovery for specialist agents and model services." }
];

export const SAMSAR_AGENT_CAPABILITIES: AgentCapability[] = [
  {
    id: "image_list_to_video",
    label: "Image list to video",
    description: "Create a wallet-attributed marketing video from images, prompt, metadata, model, aspect, and CTA outro fields.",
    samsarEndpoint: "external_users/image_list_to_video",
    requiredPillars: ["compute", "storage", "chain", "da", "service_marketplace"]
  },
  {
    id: "translate_video",
    label: "Translate video",
    description: "Clone a completed SuperReferrals video session into a translated session.",
    samsarEndpoint: "video/translate_video",
    requiredPillars: ["compute", "storage", "chain"]
  },
  {
    id: "join_videos",
    label: "Join videos",
    description: "Append multiple completed SuperReferrals sessions into one composed video.",
    samsarEndpoint: "video/join_videos",
    requiredPillars: ["compute", "storage", "chain"]
  },
  {
    id: "outro_mutation",
    label: "Outro mutation",
    description: "Add or update a CTA outro image for an existing video session.",
    samsarEndpoint: "video/add_outro_image | video/update_outro_image",
    requiredPillars: ["compute", "storage", "chain"]
  },
  {
    id: "remove_subtitles",
    label: "Remove subtitles",
    description: "Clone a session without subtitle or transcript overlays.",
    samsarEndpoint: "video/remove_subtitles",
    requiredPillars: ["compute", "storage"]
  },
  {
    id: "assistant_memory",
    label: "Assistant memory",
    description: "Use SuperReferrals assistant and embedding APIs for customer memory, campaign search, and copy generation.",
    samsarEndpoint: "assistant/completion | chat/*embedding*",
    requiredPillars: ["compute", "storage", "service_marketplace"]
  },
  {
    id: "asset_cleanup",
    label: "Asset cleanup",
    description: "Enhance images, remove branding, replace branding, and create rollup banners before video generation.",
    samsarEndpoint: "image/enhance | image/remove_branding | image/replace_branding | image/create_rollup_banner",
    requiredPillars: ["compute", "storage", "service_marketplace"]
  }
];

type AgentBlueprint = Pick<AgentProfile, "name" | "role" | "personality" | "capabilities"> & {
  slug: string;
  priceUsd: number;
};

const AGENT_BLUEPRINTS: AgentBlueprint[] = [
  {
    slug: "deployer",
    name: "Deployer",
    role: "0G stack coordinator",
    personality: "Precise, terse, and obsessed with durable receipts.",
    capabilities: ["image_list_to_video", "assistant_memory"],
    priceUsd: 0.25
  },
  {
    slug: "director",
    name: "SuperReferrals Director",
    role: "video generation director",
    personality: "Commercial, visual, and fast to pick the simplest effective video route.",
    capabilities: ["image_list_to_video", "translate_video", "join_videos", "outro_mutation", "remove_subtitles"],
    priceUsd: 0.75
  },
  {
    slug: "brand_guardian",
    name: "Brand Guardian",
    role: "brand and policy reviewer",
    personality: "Skeptical, calm, and strict about customer rules.",
    capabilities: ["assistant_memory", "asset_cleanup"],
    priceUsd: 0.4
  },
  {
    slug: "pricing_oracle",
    name: "Pricing Oracle",
    role: "Uniswap charge signal analyst",
    personality: "Numerical, cautious, and explicit about confidence.",
    capabilities: ["image_list_to_video"],
    priceUsd: 0.2
  },
  {
    slug: "settlement_keeper",
    name: "Settlement Keeper",
    role: "KeeperHub payment distributor",
    personality: "Conservative, reversible where possible, and audit minded.",
    capabilities: ["image_list_to_video", "translate_video", "join_videos"],
    priceUsd: 0.3
  },
  {
    slug: "axl_mayor",
    name: "AXL Mayor",
    role: "Gensyn Agent Town facilitator",
    personality: "Curious, social, and willing to let agents talk before acting.",
    capabilities: ["assistant_memory", "join_videos", "outro_mutation"],
    priceUsd: 0.35
  }
];

export async function ensureAgentTownSeeded(customerId?: string) {
  const store = await readStore();
  const customer = customerId
    ? store.customers.find((item) => item.id === customerId)
    : store.customers[0];
  if (!customer) {
    return [];
  }
  const timestamp = nowIso();
  return mutateStore((mutableStore) => {
    const agents = AGENT_BLUEPRINTS.map((blueprint) => {
      const id = agentId(customer.id, blueprint.slug);
      const agent: AgentProfile = {
        id,
        customerId: customer.id,
        name: blueprint.name,
        role: blueprint.role,
        personality: blueprint.personality,
        walletAddress: deriveAgentWallet(`${customer.id}:${blueprint.slug}`),
        axlPeerId: `axl-${blueprint.slug}-${shortHash(customer.id)}`,
        capabilities: blueprint.capabilities,
        serviceListing: {
          marketplaceId: `0g-service-${blueprint.slug}-${shortHash(customer.id)}`,
          keeperhubWorkflowId: `kh-${blueprint.slug}-${shortHash(customer.id)}`,
          priceUsd: blueprint.priceUsd,
          paidWorkflow: true
        },
        createdAt: mutableStore.agents.find((item) => item.id === id)?.createdAt || timestamp,
        updatedAt: timestamp
      };
      return upsertAgent(mutableStore, agent);
    });
    return agents;
  });
}

export async function getAgentConsoleSnapshot(customerId?: string) {
  await ensureAgentTownSeeded(customerId);
  const store = await readStore();
  const customer = customerId
    ? store.customers.find((item) => item.id === customerId)
    : store.customers[0];
  const topology = await getAxlTopology().catch((error) => ({
    self: "unavailable",
    peers: [],
    error: error instanceof Error ? error.message : "AXL unavailable",
    updatedAt: nowIso()
  }));
  return {
    pillars: ZERO_G_PILLARS,
    capabilities: SAMSAR_AGENT_CAPABILITIES,
    agents: customer ? store.agents.filter((agent) => agent.customerId === customer.id) : store.agents,
    jobs: store.agentJobs.slice(0, 20),
    events: store.agentTownEvents.slice(0, 50),
    topology
  };
}

export async function runAgentTownSimulation(input: {
  customerId?: string;
  subAccountId?: string;
  generationId?: string;
  inftId?: string;
  objective?: string;
  type?: AgentJobType;
  payload?: Record<string, unknown>;
}) {
  await ensureAgentTownSeeded(input.customerId);
  const store = await readStore();
  const customer = input.customerId
    ? store.customers.find((item) => item.id === input.customerId)
    : store.customers[0];
  if (!customer) {
    throw new Error("A customer is required before running Agent Town");
  }

  const agents = store.agents.filter((agent) => agent.customerId === customer.id);
  const deployer = requireAgent(agents, "deployer");
  const director = requireAgent(agents, "director");
  const guardian = requireAgent(agents, "brand_guardian");
  const pricingOracle = requireAgent(agents, "pricing_oracle");
  const settlementKeeper = requireAgent(agents, "settlement_keeper");
  const mayor = requireAgent(agents, "axl_mayor");
  const assignedAgents = [deployer, director, guardian, pricingOracle, settlementKeeper, mayor];
  const jobId = createId("agent_job");
  const objective = input.objective?.trim() ||
    "Plan and execute a cross-agent SuperReferrals video workflow with full 0G receipts.";
  const jobType = input.type || inferJobType(input.payload);
  const estimatedChargeUsd = estimateAgentCharge(customer, input.payload, jobType);
  const manifest = {
    jobId,
    objective,
    type: jobType,
    customer: {
      id: customer.id,
      name: customer.name,
      ownerWallet: customer.ownerWallet,
      settlementCurrency: customer.pricing.currency
    },
    samsarCapabilities: SAMSAR_AGENT_CAPABILITIES,
    payload: input.payload || {},
    requestedAt: nowIso()
  };

  const storageArtifact = await persistJsonToZeroG(manifest);
  const computeQuestion = [
    `Objective: ${objective}`,
    `Job type: ${jobType}`,
    `Available SuperReferrals endpoints: ${SAMSAR_AGENT_CAPABILITIES.map((capability) => capability.samsarEndpoint).filter(Boolean).join(", ")}`,
    `Input root: ${storageArtifact.rootHash}`,
    "Return a compact execution plan, QA gates, rollback policy, and which agents should talk over AXL."
  ].join("\n");
  const computeAnswer = await askZeroGCompute(buildAgentTownSystemPrompt(assignedAgents), computeQuestion);
  const plan = buildHeuristicPlan({
    objective,
    type: jobType,
    agents: assignedAgents,
    computeAnswer,
    estimatedChargeUsd
  });
  const priceSignal = await createUniswapChargeSignal({
    chargeUsd: estimatedChargeUsd,
    chainId: customer.pricing.chainId,
    paymentCurrency: customer.pricing.currency,
    settlementCurrency: customer.pricing.currency,
    swapper: customer.ownerWallet
  });
  const keeperSettlement = await executeKeeperDistribution({
    allocations: buildKeeperAllocations(customer, assignedAgents, estimatedChargeUsd),
    tokenAddress: customer.pricing.settlementTokenAddress,
    chainId: customer.pricing.chainId,
    reason: `Agent Town ${jobType} job ${jobId}`
  });
  const daArtifact = await publishDataAvailabilityCommitment({
    jobId,
    inputRoot: storageArtifact.rootHash,
    planRoot: bytes32From(JSON.stringify(plan)),
    priceSignalRoot: bytes32From(JSON.stringify(priceSignal)),
    settlementRoot: bytes32From(JSON.stringify(keeperSettlement))
  });
  const serviceReceipt = await publishServiceMarketplaceIntent({
    jobId,
    selectedService: director.serviceListing,
    capabilities: director.capabilities
  });
  const chainReceipt = await anchorAgentJobOnZeroGChain({
    jobId,
    targetAgent: director.walletAddress,
    inputRoot: storageArtifact.rootHash,
    maxSpendUsd: estimatedChargeUsd,
    outputRoot: daArtifact.rootHash
  });
  const receipts: AgentPillarReceipt[] = [
    {
      pillar: "storage",
      status: storageArtifact.mock ? "mocked" : "completed",
      label: "Input manifest stored",
      detail: "The full agent job manifest is persisted before planning.",
      rootHash: storageArtifact.rootHash,
      uri: storageArtifact.uri,
      txHash: storageArtifact.txHash,
      createdAt: nowIso()
    },
    {
      pillar: "compute",
      status: computeAnswer.mock ? "mocked" : "completed",
      label: "0G Compute plan",
      detail: String(computeAnswer.output_text || "Compute returned an execution plan."),
      rootHash: bytes32From(JSON.stringify(plan)),
      data: { plan },
      createdAt: nowIso()
    },
    {
      pillar: "da",
      status: daArtifact.mock ? "mocked" : "completed",
      label: "DA commitment published",
      detail: "Input, plan, price, and settlement roots were bundled as an availability commitment.",
      rootHash: daArtifact.rootHash,
      uri: daArtifact.uri,
      txHash: daArtifact.txHash,
      createdAt: nowIso()
    },
    chainReceipt,
    serviceReceipt
  ];
  const job: AgentJob = {
    id: jobId,
    customerId: customer.id,
    subAccountId: input.subAccountId,
    generationId: input.generationId,
    inftId: input.inftId,
    requestedByAgentId: deployer.id,
    assignedAgentIds: assignedAgents.map((agent) => agent.id),
    type: jobType,
    status: "COMPLETED",
    objective,
    input: manifest,
    plan,
    priceSignal,
    keeperSettlement,
    receipts,
    output: {
      storageRoot: storageArtifact.rootHash,
      daRoot: daArtifact.rootHash,
      selectedSamsarEndpoint: plan.samsarEndpoint,
      nextAction: plan.nextAction
    },
    createdAt: nowIso(),
    updatedAt: nowIso()
  };

  const events = await buildAgentTownEvents(job, assignedAgents, receipts, keeperSettlement);
  await mutateStore((mutableStore) => {
    addAgentJob(mutableStore, job);
    events.forEach((event) => addAgentTownEvent(mutableStore, event));
    return job;
  });

  return {
    job,
    events,
    snapshot: await getAgentConsoleSnapshot(customer.id)
  };
}

export async function rollbackAgentJob(jobId: string, reason: string) {
  const store = await readStore();
  const job = store.agentJobs.find((item) => item.id === jobId);
  if (!job) {
    throw new Error("agent job was not found");
  }
  const customer = store.customers.find((item) => item.id === job.customerId);
  if (!customer) {
    throw new Error("agent job customer was not found");
  }
  const rollback = await executeKeeperRollback({
    recipientAddress: customer.ownerWallet,
    amount: String(job.priceSignal?.chargeUsd || 0),
    reason
  });
  const event: AgentTownEvent = {
    id: createId("agent_event"),
    jobId,
    fromAgentId: job.assignedAgentIds[0] || job.requestedByAgentId,
    channel: "keeperhub",
    eventType: "rollback",
    content: `Rollback executed: ${reason}`,
    payload: rollback,
    createdAt: nowIso()
  };
  return mutateStore((mutableStore) => {
    const updated = updateAgentJob(mutableStore, jobId, {
      status: "ROLLED_BACK",
      keeperSettlement: rollback
    });
    addAgentTownEvent(mutableStore, event);
    return updated;
  });
}

function agentId(customerId: string, slug: string) {
  return `agent_${slug}_${shortHash(customerId)}`;
}

function requireAgent(agents: AgentProfile[], slug: string) {
  const idSuffix = `_${slug}_`;
  const agent = agents.find((item) => item.id.includes(idSuffix));
  if (!agent) {
    throw new Error(`Missing ${slug} agent`);
  }
  return agent;
}

function inferJobType(payload?: Record<string, unknown>): AgentJobType {
  if (payload?.sourceInftId || payload?.source_inft_id) {
    return "remix_inft";
  }
  if (payload?.language && payload?.videoSessionId) {
    return "translate";
  }
  if (payload?.sessionIds || payload?.session_ids) {
    return "join";
  }
  return "generate_video";
}

function estimateAgentCharge(customer: Customer, payload: Record<string, unknown> | undefined, type: AgentJobType) {
  if (type !== "generate_video") {
    return type === "brand_review" ? 0.75 : 1.5;
  }
  const imageUrls = Array.isArray(payload?.image_urls) ? payload?.image_urls : [];
  const input = {
    image_urls: imageUrls,
    video_model: payload?.video_model,
    aspect_ratio: payload?.aspect_ratio,
    duration_seconds: payload?.duration_seconds
  } as Partial<GenerationInput> & Pick<GenerationInput, "image_urls">;
  const imageCount = Math.max(1, countImages(input));
  return priceGeneration(customer, imageCount, input).totalUsd;
}

function buildAgentTownSystemPrompt(agents: AgentProfile[]) {
  return [
    "You are the 0G Deployer Agent coordinating a SuperReferrals Agent Town.",
    "Use 0G Chain, Storage, DA, Compute, and Service Marketplace for every serious job.",
    "Align actions to SuperReferrals video and assistant endpoints, Uniswap charge signals, KeeperHub settlement, and Gensyn AXL messages.",
    "Agents:",
    ...agents.map((agent) => `- ${agent.name}: ${agent.role}. Personality: ${agent.personality}`)
  ].join("\n");
}

function buildHeuristicPlan({
  objective,
  type,
  agents,
  computeAnswer,
  estimatedChargeUsd
}: {
  objective: string;
  type: AgentJobType;
  agents: AgentProfile[];
  computeAnswer: Record<string, unknown>;
  estimatedChargeUsd: number;
}) {
  const samsarEndpointByType: Record<AgentJobType, string> = {
    generate_video: "external_users/image_list_to_video",
    remix_inft: "video/add_outro_image",
    translate: "video/translate_video",
    join: "video/join_videos",
    brand_review: "assistant/completion",
    simulation: "assistant/completion"
  };
  return {
    objective,
    nextAction: type === "generate_video" ? "quote_and_create_generation" : "run_samsar_session_action",
    samsarEndpoint: samsarEndpointByType[type],
    estimatedChargeUsd,
    agents: agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      role: agent.role,
      serviceListing: agent.serviceListing
    })),
    gates: [
      "brand_guardian_approval",
      "uniswap_price_signal",
      "keeperhub_distribution_plan",
      "0g_storage_manifest",
      "0g_da_commitment",
      "0g_chain_anchor"
    ],
    rollbackPolicy: "Cancel incomplete SuperReferrals work, publish rollback event, and use KeeperHub for refunds or compensating transfers.",
    computeSummary: String(computeAnswer.output_text || "0G Compute planned the job.")
  };
}

function buildKeeperAllocations(customer: Customer, agents: AgentProfile[], totalUsd: number) {
  const director = agents.find((agent) => agent.id.includes("_director_")) || agents[0];
  const keeperHubWallet = env("KEEPERHUB_WALLET_ADDRESS", customer.ownerWallet);
  return [
    {
      label: "customer_render_revenue",
      recipientAddress: customer.ownerWallet,
      amountUsd: roundMoney(totalUsd * 0.78)
    },
    {
      label: "agent_operator_fee",
      recipientAddress: director.walletAddress,
      amountUsd: roundMoney(totalUsd * 0.12)
    },
    {
      label: "platform_coordination_fee",
      recipientAddress: keeperHubWallet,
      amountUsd: roundMoney(totalUsd * 0.1)
    }
  ];
}

async function publishServiceMarketplaceIntent(payload: Record<string, unknown>): Promise<AgentPillarReceipt> {
  const endpoint = env("OG_SERVICE_MARKETPLACE_URL");
  if (isProviderMock("OG_SERVICE_MARKETPLACE")) {
    return {
      pillar: "service_marketplace",
      status: "mocked",
      label: "Service listing selected",
      detail: "Selected a paid specialist agent listing for the job. Configure OG_SERVICE_MARKETPLACE_URL for live listing publication.",
      rootHash: bytes32From(JSON.stringify(payload)),
      uri: `0g-service://mock/${shortHash(JSON.stringify(payload))}`,
      data: payload,
      createdAt: nowIso()
    };
  }
  if (!endpoint) {
    throw new Error("OG_SERVICE_MARKETPLACE_URL is required when OG_SERVICE_MARKETPLACE_MOCKS=false");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env("OG_SERVICE_MARKETPLACE_API_KEY") ? { authorization: `Bearer ${env("OG_SERVICE_MARKETPLACE_API_KEY")}` } : {})
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `0G service marketplace publish failed: ${response.status}`);
  }
  return {
    pillar: "service_marketplace",
    status: "completed",
    label: "Service listing selected",
    detail: "A live 0G service marketplace intent was published.",
    rootHash: String(data.rootHash || data.root_hash || bytes32From(JSON.stringify(payload))),
    uri: String(data.uri || data.url || ""),
    txHash: data.txHash || data.tx_hash,
    data,
    createdAt: nowIso()
  };
}

async function anchorAgentJobOnZeroGChain({
  jobId,
  targetAgent,
  inputRoot,
  maxSpendUsd,
  outputRoot
}: {
  jobId: string;
  targetAgent: string;
  inputRoot: string;
  maxSpendUsd: number;
  outputRoot: string;
}): Promise<AgentPillarReceipt> {
  const contractAddress = env("AGENT_REGISTRY_CONTRACT_ADDRESS") as `0x${string}`;
  const privateKey = env("OG_PRIVATE_KEY") as `0x${string}`;
  const configuredChainId = Number(env("AGENT_REGISTRY_CHAIN_ID") || env("OG_CHAIN_ID") || "");
  const configuredChain = getZeroGChainConfig(
    Number.isFinite(configuredChainId) && configuredChainId > 0 ? configuredChainId : undefined
  );
  const rpcUrl = env("AGENT_REGISTRY_RPC_URL") || configuredChain.rpcUrl;
  const chainId = configuredChain.id;
  if (isProviderMock("AGENT_REGISTRY")) {
    return {
      pillar: "chain",
      status: "mocked",
      label: "Agent job anchored",
      detail: "Mock transaction-chain event for AgentJobRequested and AgentJobCompleted.",
      rootHash: outputRoot,
      txHash: createId("mock_0g_chain"),
      uri: `0g-chain://mock/${jobId}`,
      data: { jobId, targetAgent, inputRoot, maxSpendUsd },
      createdAt: nowIso()
    };
  }
  if (!contractAddress || !privateKey) {
    throw new Error("AGENT_REGISTRY_CONTRACT_ADDRESS and OG_PRIVATE_KEY are required when AGENT_REGISTRY_MOCKS=false");
  }

  const account = privateKeyToAccount(privateKey);
  const chain = {
    id: chainId,
    name: configuredChain.name,
    nativeCurrency: configuredChain.nativeCurrency,
    rpcUrls: { default: { http: [rpcUrl] } }
  } as const;
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl)
  });
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: registryAbi,
    functionName: "requestJob",
    args: [
      bytes32From(jobId),
      targetAgent as `0x${string}`,
      inputRoot as `0x${string}`,
      BigInt(amountToAtomic(maxSpendUsd, 6))
    ]
  });
  return {
    pillar: "chain",
    status: "completed",
    label: "Agent job anchored",
    detail: `${configuredChain.name} registry requestJob was submitted.`,
    rootHash: outputRoot,
    txHash,
    uri: `${configuredChain.blockExplorerUrl}/tx/${txHash}`,
    data: { jobId, targetAgent, inputRoot, maxSpendUsd },
    createdAt: nowIso()
  };
}

async function buildAgentTownEvents(
  job: AgentJob,
  agents: AgentProfile[],
  receipts: AgentPillarReceipt[],
  keeperSettlement: KeeperSettlementRecord
) {
  const [deployer, director, guardian, pricingOracle, settlementKeeper, mayor] = agents;
  const specs: Array<{
    from: AgentProfile;
    to?: AgentProfile;
    channel: AgentTownEvent["channel"];
    eventType: AgentTownEvent["eventType"];
    content: string;
    payload?: Record<string, unknown>;
  }> = [
    {
      from: deployer,
      to: mayor,
      channel: "axl",
      eventType: "message",
      content: `New Agent Town job ${job.id}: ${job.objective}`,
      payload: { jobId: job.id, type: job.type }
    },
    {
      from: mayor,
      to: guardian,
      channel: "axl",
      eventType: "handoff",
      content: "Please review brand risk before the director starts SuperReferrals generation.",
      payload: { gate: "brand_guardian_approval" }
    },
    {
      from: guardian,
      to: director,
      channel: "axl",
      eventType: "decision",
      content: "Approved with receipt logging, public CTA checks, and post-render QA.",
      payload: { approved: true }
    },
    {
      from: pricingOracle,
      to: settlementKeeper,
      channel: "axl",
      eventType: "decision",
      content: `Uniswap charge signal: ${job.priceSignal?.chargeUsd.toFixed(2)} ${job.priceSignal?.settlementToken}.`,
      payload: job.priceSignal ? { ...job.priceSignal } : undefined
    },
    {
      from: settlementKeeper,
      channel: "keeperhub",
      eventType: "receipt",
      content: `KeeperHub distribution ${keeperSettlement.status}; rollback policy is attached.`,
      payload: keeperSettlement as unknown as Record<string, unknown>
    },
    {
      from: deployer,
      channel: "0g",
      eventType: "receipt",
      content: `All 0G pillar receipts created: ${receipts.map((receipt) => receipt.pillar).join(", ")}.`,
      payload: { receipts }
    }
  ];

  const events: AgentTownEvent[] = [];
  for (const spec of specs) {
    let axlMessageId: string | undefined;
    if (spec.channel === "axl" && spec.to) {
      try {
        const result = await sendAxlMessage(spec.to.axlPeerId, {
          fromAgent: spec.from.id,
          toAgent: spec.to.id,
          jobId: job.id,
          content: spec.content,
          payload: spec.payload
        });
        axlMessageId = String(result.messageId || result.id || "");
      } catch (error) {
        spec.payload = {
          ...(spec.payload || {}),
          axlError: error instanceof Error ? error.message : "AXL send failed"
        };
      }
    }
    events.push({
      id: createId("agent_event"),
      jobId: job.id,
      fromAgentId: spec.from.id,
      toAgentId: spec.to?.id,
      channel: spec.channel,
      eventType: spec.eventType,
      content: spec.content,
      payload: spec.payload,
      axlMessageId,
      createdAt: nowIso()
    });
  }
  return events;
}
