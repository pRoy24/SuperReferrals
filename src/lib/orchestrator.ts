import { appBaseUrl } from "./env";
import { askZeroGCompute } from "./compute";
import { buildINFTAssistantSystemPrompt } from "./assistant-prompt";
import { deriveAgentWallet, mintINFT } from "./inft";
import { bytes32From, createId, nowIso, normalizeWallet } from "./ids";
import { executeKeeperRefund } from "./keeperhub";
import { countImages, priceGeneration, refundAmountForFailure } from "./pricing";
import {
  addGeneration,
  addINFT,
  addQuote,
  addSubAccount,
  getGeneration,
  getINFT,
  mutateStore,
  readStore,
  updateGeneration,
  upsertCustomer
} from "./store";
import {
  createExternalImageListVideo,
  ensureExternalUserSession,
  fetchLatestVideoUrl,
  getSamsarStatus,
  runSamsarSessionAction
} from "./samsar";
import { createUniswapQuote } from "./uniswap";
import { persistJsonToZeroG, persistRemoteVideoToZeroG } from "./zero-g";
import { sendAxlMessage } from "./axl";
import type {
  Customer,
  Generation,
  GenerationInput,
  GenerationPayment,
  INFTAttribute,
  INFTRecord,
  PaymentQuote,
  SubAccount
} from "./types";

export async function bootstrap() {
  return readStore();
}

export async function createOrUpdateCustomer(input: Partial<Customer>) {
  return mutateStore((store) => upsertCustomer(store, input));
}

export async function createSubAccountForCustomer(input: {
  customerId: string;
  wallet: string;
  email?: string;
  username?: string;
}) {
  const existingStore = await readStore();
  const customer = existingStore.customers.find((item) => item.id === input.customerId);
  if (!customer) {
    throw new Error("customerId was not found");
  }
  const account = await mutateStore((store) => addSubAccount(store, input));
  const samsarSession = await ensureExternalUserSession(account.externalUser);
  return mutateStore((store) => {
    const current = store.subAccounts.find((item) => item.id === account.id);
    if (!current) {
      throw new Error("sub-account disappeared while creating Samsar session");
    }
    current.externalApiKey = samsarSession.externalApiKey;
    current.updatedAt = nowIso();
    return current;
  });
}

export async function quotePayment(input: {
  customerId: string;
  subAccountId?: string;
  imageCount: number;
  tokenIn?: string;
  tokenOut?: string;
  swapper?: string;
  chainId?: number;
}) {
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === input.customerId);
  if (!customer) {
    throw new Error("customerId was not found");
  }
  const pricing = priceGeneration(customer, input.imageCount);
  const tokenAmount = String(Math.round(pricing.totalUsd * 1_000_000));
  const route = input.tokenIn && input.tokenOut && input.swapper
    ? await createUniswapQuote({
      amount: tokenAmount,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      tokenInChainId: input.chainId || customer.pricing.chainId,
      tokenOutChainId: input.chainId || customer.pricing.chainId,
      swapper: input.swapper
    })
    : { quote: { routing: "DIRECT_USDC", amount: tokenAmount } };
  const quote: PaymentQuote = {
    id: createId("quote"),
    customerId: customer.id,
    subAccountId: input.subAccountId,
    imageCount: input.imageCount,
    amountUsd: pricing.amountUsd,
    platformFeeUsd: pricing.platformFeeUsd,
    totalUsd: pricing.totalUsd,
    tokenIn: input.tokenIn,
    tokenOut: input.tokenOut,
    chainId: input.chainId || customer.pricing.chainId,
    route,
    createdAt: nowIso()
  };
  return mutateStore((mutableStore) => addQuote(mutableStore, quote));
}

export async function createGeneration(input: {
  customerId: string;
  subAccountId?: string;
  subAccount?: {
    wallet: string;
    email?: string;
    username?: string;
  };
  generation: GenerationInput;
  payment?: Partial<GenerationPayment>;
}) {
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === input.customerId);
  if (!customer) {
    throw new Error("customerId was not found");
  }

  let subAccount = input.subAccountId
    ? store.subAccounts.find((item) => item.id === input.subAccountId)
    : undefined;
  if (!subAccount) {
    subAccount = await createSubAccountForCustomer({
      customerId: customer.id,
      wallet: input.subAccount?.wallet || customer.ownerWallet,
      email: input.subAccount?.email,
      username: input.subAccount?.username
    });
  }

  const imageCount = countImages(input.generation);
  if (imageCount === 0) {
    throw new Error("image_urls must contain at least one image");
  }
  const priced = priceGeneration(customer, imageCount);
  const generationId = createId("gen");
  const timestamp = nowIso();
  const payment: GenerationPayment = {
    amountUsd: priced.totalUsd,
    payerWallet: input.payment?.payerWallet || subAccount.wallet,
    txHash: input.payment?.txHash,
    quoteId: input.payment?.quoteId,
    tokenAddress: input.payment?.tokenAddress || customer.pricing.settlementTokenAddress,
    chainId: input.payment?.chainId || customer.pricing.chainId,
    status: input.payment?.txHash ? "confirmed" : "mock_confirmed"
  };
  const generation: Generation = {
    id: generationId,
    customerId: customer.id,
    subAccountId: subAccount.id,
    referrerCode: subAccount.referrerCode,
    status: "QUEUED",
    input: normalizeGenerationInput(input.generation),
    payment,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await mutateStore((mutableStore) => addGeneration(mutableStore, generation));

  try {
    const response = await createExternalImageListVideo({
      externalUser: subAccount.externalUser,
      input: generation.input,
      externalApiKey: subAccount.externalApiKey,
      generationId
    });
    return mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
      status: "PROCESSING",
      samsarRequestId: response.requestId,
      samsarSessionId: response.sessionId,
      payment: {
        ...payment,
        status: input.payment?.txHash ? "confirmed" : "mock_confirmed"
      }
    }));
  } catch (error) {
    await mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "Samsar request failed"
    }));
    throw error;
  }
}

export async function syncGeneration(id: string) {
  const store = await readStore();
  const generation = store.generations.find((item) => item.id === id);
  if (!generation) {
    throw new Error("generation was not found");
  }
  const customer = store.customers.find((item) => item.id === generation.customerId);
  const subAccount = store.subAccounts.find((item) => item.id === generation.subAccountId);
  if (!customer || !subAccount) {
    throw new Error("generation is missing customer or sub-account");
  }

  const requestId = generation.samsarRequestId || generation.samsarSessionId;
  if (!requestId) {
    return generation;
  }
  const status = await getSamsarStatus(requestId, subAccount.externalUser, subAccount.externalApiKey);
  const normalizedStatus = String(status.status || "").toUpperCase();
  if (normalizedStatus === "COMPLETED" || status.result_url || status.remoteURL) {
    const resultUrl = String(status.result_url || status.remoteURL || await fetchLatestVideoUrl(generation.samsarSessionId || requestId));
    return finalizeGeneration(generation, customer, subAccount, resultUrl);
  }
  if (normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED") {
    return failGeneration(generation, customer, normalizedStatus, String(status.message || status.error || "Samsar generation failed"));
  }
  return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
    status: "PROCESSING",
    errorMessage: undefined
  }));
}

export async function handleSamsarWebhook(payload: Record<string, unknown>) {
  const requestId = String(
    payload.request_id ||
    payload.requestId ||
    payload.session_id ||
    payload.sessionID ||
    payload.external_request_id ||
    ""
  );
  if (!requestId) {
    throw new Error("Webhook payload did not include a request id");
  }
  const store = await readStore();
  const generation = store.generations.find((item) =>
    item.samsarRequestId === requestId ||
    item.samsarSessionId === requestId ||
    item.id === requestId
  );
  if (!generation) {
    return { ignored: true, requestId };
  }
  return syncGeneration(generation.id);
}

async function finalizeGeneration(
  generation: Generation,
  customer: Customer,
  subAccount: SubAccount,
  resultUrl: string
) {
  if (generation.inftId) {
    return getGeneration(generation.id);
  }

  const videoArtifact = await persistRemoteVideoToZeroG(resultUrl);
  const attributes = buildINFTAttributes(generation, customer, subAccount);
  const metadata = {
    name: `SuperReferrer Video ${generation.id}`,
    description: "Marketing video INFT generated from a referrer image-list-to-video request.",
    animation_url: resultUrl,
    external_url: `${appBaseUrl()}/inft/${generation.id}`,
    image: firstImageUrl(generation.input),
    attributes,
    superreferrer: {
      generationId: generation.id,
      samsarSessionId: generation.samsarSessionId,
      referrerCode: subAccount.referrerCode,
      referrerUrl: `${customer.referrerBaseUrl}/r/${subAccount.referrerCode}`,
      metadata: generation.input.metadata || {}
    },
    storage: {
      video: videoArtifact
    }
  };
  const metadataArtifact = await persistJsonToZeroG(metadata);
  const agentWallet = deriveAgentWallet(generation.id);
  const ownerWallet = normalizeWallet(subAccount.wallet) as `0x${string}`;
  const mint = await mintINFT({
    ownerWallet,
    metadataUri: metadataArtifact.uri,
    metadataHash: bytes32From(JSON.stringify(metadata)),
    agentWallet,
    referrerCode: subAccount.referrerCode
  });
  const timestamp = nowIso();
  const inft: INFTRecord = {
    id: generation.id,
    generationId: generation.id,
    customerId: customer.id,
    subAccountId: subAccount.id,
    ownerWallet,
    title: String(generation.input.metadata?.title || `Video INFT ${generation.id}`),
    description: String(generation.input.prompt || "Generated marketing video"),
    videoUrl: resultUrl,
    storageRootHash: videoArtifact.rootHash,
    metadataRootHash: metadataArtifact.rootHash,
    metadataUri: metadataArtifact.uri,
    tokenId: mint.tokenId,
    contractAddress: mint.contractAddress,
    mintTxHash: mint.txHash,
    agentWalletAddress: agentWallet,
    referrer: {
      code: subAccount.referrerCode,
      url: `${customer.referrerBaseUrl}/r/${subAccount.referrerCode}`,
      ensName: customer.ensName
    },
    attributes,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  return mutateStore((mutableStore) => {
    addINFT(mutableStore, inft);
    return updateGeneration(mutableStore, generation.id, {
      status: "COMPLETED",
      resultUrl,
      storage: {
        video: videoArtifact,
        metadata: metadataArtifact
      },
      inftId: inft.id
    });
  });
}

async function failGeneration(
  generation: Generation,
  customer: Customer,
  status: string,
  errorMessage: string
) {
  const refundAmount = refundAmountForFailure(customer, generation.payment.amountUsd);
  let refund = generation.refund;
  if (refundAmount > 0 && !refund) {
    try {
      const keeper = await executeKeeperRefund({
        recipientAddress: generation.payment.payerWallet || customer.ownerWallet,
        amount: String(refundAmount),
        reason: errorMessage
      });
      refund = {
        amountUsd: refundAmount,
        reason: errorMessage,
        keeperExecutionId: String(keeper.executionId || ""),
        status: keeper.status === "mock_completed" ? "mock_completed" : "completed",
        createdAt: nowIso()
      };
    } catch (error) {
      refund = {
        amountUsd: refundAmount,
        reason: error instanceof Error ? error.message : errorMessage,
        status: "failed",
        createdAt: nowIso()
      };
    }
  }
  return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
    status: status === "CANCELLED" ? "CANCELLED" : "FAILED",
    errorMessage,
    refund
  }));
}

export async function askINFT(id: string, question: string) {
  const inft = await getINFT(id);
  if (!inft) {
    throw new Error("INFT was not found");
  }
  const prompt = buildINFTAssistantSystemPrompt(inft);
  return askZeroGCompute(prompt, question);
}

export async function runINFTAction(id: string, action: string, payload: Record<string, unknown>) {
  const store = await readStore();
  const inft = store.infts.find((item) => item.id === id);
  if (!inft) {
    throw new Error("INFT was not found");
  }
  const generation = store.generations.find((item) => item.id === inft.generationId);
  if (!generation) {
    throw new Error("INFT generation was not found");
  }

  if (action === "message_peer") {
    const peerId = String(payload.peerId || payload.peer_id || "");
    if (!peerId) {
      throw new Error("peerId is required");
    }
    return sendAxlMessage(peerId, {
      fromInft: inft.id,
      agentWallet: inft.agentWalletAddress,
      message: payload.message || "hello",
      referrer: inft.referrer
    });
  }

  if (action === "update_outro") {
    return {
      status: "QUEUED",
      note: "Use Samsar add_outro_image/update_outro_image with the source session in a live extension.",
      sourceSessionId: generation.samsarSessionId,
      payload
    };
  }

  if (action === "translate") {
    return runSamsarSessionAction("translate", {
      videoSessionId: generation.samsarSessionId,
      language: payload.language || "es"
    });
  }

  if (action === "join") {
    const sessionIds = [generation.samsarSessionId, payload.sessionId || payload.session_id].filter(Boolean);
    return runSamsarSessionAction("join", {
      session_ids: sessionIds,
      blend_scenes: payload.blendScenes === true
    });
  }

  if (action === "remove_subtitles") {
    return runSamsarSessionAction("remove_subtitles", {
      videoSessionId: generation.samsarSessionId
    });
  }

  throw new Error(`Unsupported INFT action: ${action}`);
}

function normalizeGenerationInput(input: GenerationInput): GenerationInput {
  return {
    ...input,
    video_model: input.video_model || "VEO3.1I2V",
    aspect_ratio: input.aspect_ratio || "16:9",
    enable_subtitles: input.enable_subtitles ?? true,
    image_urls: input.image_urls || []
  };
}

function buildINFTAttributes(
  generation: Generation,
  customer: Customer,
  subAccount: SubAccount
): INFTAttribute[] {
  return [
    { trait_type: "customer", value: customer.name },
    { trait_type: "sub_account", value: subAccount.username || subAccount.id },
    { trait_type: "referrer_code", value: subAccount.referrerCode },
    { trait_type: "referrer_url", value: `${customer.referrerBaseUrl}/r/${subAccount.referrerCode}` },
    { trait_type: "ens_name", value: customer.ensName || "" },
    { trait_type: "video_model", value: generation.input.video_model },
    { trait_type: "aspect_ratio", value: generation.input.aspect_ratio },
    { trait_type: "image_count", value: countImages(generation.input) },
    { trait_type: "payment_amount_usd", value: generation.payment.amountUsd },
    { trait_type: "samsar_session_id", value: generation.samsarSessionId || "" }
  ];
}

function firstImageUrl(input: GenerationInput) {
  const first = input.image_urls[0];
  if (typeof first === "string") {
    return first;
  }
  return String(first?.image_url || first?.url || first?.src || "");
}
