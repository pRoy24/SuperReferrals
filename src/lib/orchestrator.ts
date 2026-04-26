import { appBaseUrl, env, isMockMode, isProviderMock } from "./env";
import { getAgentConsoleSnapshot } from "./agent-framework";
import { askZeroGCompute } from "./compute";
import { buildINFTAssistantSystemPrompt } from "./assistant-prompt";
import { deriveAgentWallet, mintINFT } from "./inft";
import { bytes32From, createId, nowIso, normalizeWallet } from "./ids";
import { createKeeperPaymentIntent, executeKeeperRefund } from "./keeperhub";
import { amountToAtomic, findPaymentToken, getTransactionChainConfig, getTransactionChainId, settlementTokenForCurrency } from "./payment-tokens";
import { verifyRenderPaymentTransaction } from "./payment-verification";
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
  grantExternalUserCredits,
  getSamsarStatus,
  runSamsarSessionAction
} from "./samsar";
import { createUniswapQuote } from "./uniswap";
import { persistJsonToZeroG, persistRemoteVideoToZeroG } from "./zero-g";
import { sendAxlMessage } from "./axl";
import { registerZeroGUserProfile } from "./user-registry";
import type {
  Customer,
  Generation,
  GenerationInput,
  GenerationPayment,
  INFTAttribute,
  INFTRecord,
  PaymentQuote,
  SubAccount,
  VideoAspectRatio,
  VideoModel
} from "./types";

export async function bootstrap() {
  await getAgentConsoleSnapshot();
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
  const normalizedWallet = normalizeWallet(input.wallet);
  const existingAccount = existingStore.subAccounts.find((item) =>
    item.customerId === input.customerId && normalizeWallet(item.wallet) === normalizedWallet
  );
  if (existingAccount) {
    let externalApiKey = existingAccount.externalApiKey;
    if (!externalApiKey) {
      const samsarSession = await ensureExternalUserSession(existingAccount.externalUser);
      externalApiKey = samsarSession.externalApiKey;
    }
    const blockchainRegistration = existingAccount.blockchainRegistration ||
      await createZeroGUserRegistration(customer, { ...existingAccount, externalApiKey });
    return mutateStore((store) => {
      const current = store.subAccounts.find((item) => item.id === existingAccount.id);
      if (!current) {
        throw new Error("sub-account disappeared while provisioning wallet profile");
      }
      current.externalApiKey = externalApiKey;
      current.blockchainRegistration = blockchainRegistration;
      current.updatedAt = nowIso();
      return current;
    });
  }
  const account = await mutateStore((store) => addSubAccount(store, input));
  const samsarSession = await ensureExternalUserSession(account.externalUser);
  const accountWithSession = { ...account, externalApiKey: samsarSession.externalApiKey };
  const blockchainRegistration = await createZeroGUserRegistration(customer, accountWithSession);
  return mutateStore((store) => {
    const current = store.subAccounts.find((item) => item.id === account.id);
    if (!current) {
      throw new Error("sub-account disappeared while provisioning wallet profile");
    }
    current.externalApiKey = samsarSession.externalApiKey;
    current.blockchainRegistration = blockchainRegistration;
    current.updatedAt = nowIso();
    return current;
  });
}

async function createZeroGUserRegistration(customer: Customer, account: SubAccount) {
  const manifest = {
    type: "superreferrals.user-profile",
    version: 1,
    customer: {
      id: customer.id,
      name: customer.name,
      ownerWallet: customer.ownerWallet
    },
    user: {
      subAccountId: account.id,
      wallet: account.wallet,
      username: account.username,
      email: account.email,
      referrerCode: account.referrerCode,
      externalUser: account.externalUser
    },
    referrerUrl: `${customer.referrerBaseUrl}/r/${account.referrerCode}`,
    createdAt: account.createdAt
  };
  const profileRootHash = bytes32From(JSON.stringify(manifest));
  const storage = await persistJsonToZeroG(manifest);
  return registerZeroGUserProfile({
    customerId: customer.id,
    wallet: account.wallet,
    referrerCode: account.referrerCode,
    profileRootHash,
    profileUri: storage.uri,
    storageRootHash: storage.rootHash
  });
}

export async function quotePayment(input: {
  customerId: string;
  subAccountId?: string;
  imageCount: number;
  durationSeconds?: number;
  videoModel?: VideoModel;
  aspectRatio?: VideoAspectRatio;
  tokenIn?: string;
  tokenOut?: string;
  paymentCurrency?: string;
  settlementCurrency?: string;
  paymentRail?: "direct" | "uniswap" | "keeperhub";
  swapper?: string;
  chainId?: number;
}) {
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === input.customerId);
  if (!customer) {
    throw new Error("customerId was not found");
  }
  if (!input.imageCount || input.imageCount < 1) {
    throw new Error("imageCount must be greater than zero");
  }
  const pricing = priceGeneration(customer, input.imageCount, {
    video_model: input.videoModel,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds
  });
  const chainId = customer.pricing.chainId || getTransactionChainId();
  if (input.chainId && input.chainId !== chainId) {
    throw new Error(`Payment chain must match the customer account chain ${getTransactionChainConfig(chainId).name}.`);
  }
  const settlementToken =
    findPaymentToken(customer.pricing.settlementTokenAddress || "", chainId) ||
    findPaymentToken(input.tokenOut || "", chainId) ||
    settlementTokenForCurrency(input.settlementCurrency || customer.pricing.currency, chainId);
  const paymentToken =
    findPaymentToken(input.tokenIn || "", chainId) ||
    findPaymentToken(input.paymentCurrency || settlementToken?.symbol || "USDC", chainId);
  if (!settlementToken || !paymentToken) {
    throw new Error("Unsupported payment or settlement token");
  }
  const settlementAmountAtomic = amountToAtomic(pricing.totalUsd, settlementToken.decimals);
  const sameToken = paymentToken.address.toLowerCase() === settlementToken.address.toLowerCase();
  const requestedRail = input.paymentRail || (sameToken ? "direct" : "uniswap");
  const paymentRail = requestedRail === "direct" && !sameToken ? "uniswap" : requestedRail;
  if (
    paymentRail === "keeperhub" &&
    !env("KEEPERHUB_PAYMENT_WORKFLOW_ID") &&
    !isMockMode() &&
    !isProviderMock("KEEPERHUB") &&
    !["USDC", "USDT"].includes(paymentToken.symbol)
  ) {
    throw new Error("KEEPERHUB_PAYMENT_WORKFLOW_ID is required for non-stable token payments so KeeperHub can run the swap before settlement.");
  }
  const route = paymentRail === "keeperhub"
    ? await createKeeperPaymentIntent({
      payerAddress: input.swapper || "",
      recipientAddress: customer.ownerWallet,
      amount: pricing.totalUsd.toFixed(2),
      amountUsd: pricing.totalUsd,
      tokenAddress: paymentToken.native ? undefined : paymentToken.address,
      settlementTokenAddress: settlementToken.address,
      chainId,
      reason: `SuperReferrals quote for ${pricing.durationSeconds} second render`
    })
    : paymentRail === "uniswap" && !sameToken && input.swapper
    ? await createUniswapQuote({
      type: "EXACT_OUTPUT",
      amount: settlementAmountAtomic,
      tokenIn: paymentToken.address,
      tokenOut: settlementToken.address,
      tokenInChainId: chainId,
      tokenOutChainId: chainId,
      swapper: input.swapper,
      nativeEthInput: paymentToken.native
    })
    : {
      quote: {
        routing: sameToken ? "DIRECT_TOKEN" : "PENDING_SWAPPER",
        amount: settlementAmountAtomic,
        token: settlementToken.address
      }
    };
  const quote: PaymentQuote = {
    id: createId("quote"),
    customerId: customer.id,
    subAccountId: input.subAccountId,
    imageCount: input.imageCount,
    durationSeconds: pricing.durationSeconds,
    amountUsd: pricing.amountUsd,
    platformFeeUsd: pricing.platformFeeUsd,
    totalUsd: pricing.totalUsd,
    pricePerSecondUsd: pricing.pricePerSecondUsd,
    baseCreditsPerSecond: pricing.baseCreditsPerSecond,
    creditUnitUsd: pricing.creditUnitUsd,
    customerMultiplier: pricing.customerMultiplier,
    videoModel: input.videoModel,
    aspectRatio: input.aspectRatio,
    pricingConfigurationId: pricing.pricingConfigurationId,
    tokenIn: paymentToken.address,
    tokenOut: settlementToken.address,
    paymentCurrency: paymentToken.symbol,
    settlementCurrency: settlementToken.symbol,
    paymentRail,
    paymentTokenAddress: paymentToken.address,
    settlementTokenAddress: settlementToken.address,
    settlementAmountAtomic,
    checkoutUrl: paymentRail === "uniswap"
      ? buildUniswapCheckoutUrl(paymentToken.address, settlementToken.address, pricing.totalUsd, chainId)
      : undefined,
    chainId,
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
  const priced = priceGeneration(customer, imageCount, input.generation);
  const quote = input.payment?.quoteId
    ? store.quotes.find((item) => item.id === input.payment?.quoteId)
    : undefined;
  const requestedPaymentRail = input.payment?.paymentRail || quote?.paymentRail || "keeperhub";
  const paymentRail = requestedPaymentRail;
  const paymentRoute = quote?.route;
  const paymentChainId = customer.pricing.chainId || quote?.chainId || getTransactionChainId();
  const expectedSettlementToken =
    findPaymentToken(quote?.settlementTokenAddress || customer.pricing.settlementTokenAddress || "", paymentChainId) ||
    settlementTokenForCurrency(quote?.settlementCurrency || customer.pricing.currency, paymentChainId);
  if (!expectedSettlementToken) {
    throw new Error("Unable to resolve render settlement token for payment verification");
  }
  const expectedSettlementAmountAtomic = quote?.settlementAmountAtomic ||
    amountToAtomic(priced.totalUsd, expectedSettlementToken.decimals);
  const paymentConfirmation = await resolvePaymentConfirmation({
    paymentRail,
    txHash: input.payment?.txHash,
    route: paymentRoute,
    expectedPayment: {
      chainId: paymentChainId,
      payerWallet: input.payment?.payerWallet || subAccount.wallet,
      recipientWallet: customer.ownerWallet,
      tokenAddress: expectedSettlementToken.address,
      amountAtomic: expectedSettlementAmountAtomic
    }
  });
  const generationId = createId("gen");
  const timestamp = nowIso();
  const payment: GenerationPayment = {
    amountUsd: priced.totalUsd,
    payerWallet: input.payment?.payerWallet || subAccount.wallet,
    txHash: input.payment?.txHash || paymentConfirmation.txHash,
    quoteId: input.payment?.quoteId || quote?.id,
    tokenAddress: expectedSettlementToken.address,
    tokenSymbol: quote?.settlementCurrency || expectedSettlementToken.symbol,
    paymentRail,
    chainId: paymentChainId,
    status: paymentConfirmation.status,
    keeperExecutionId: paymentConfirmation.keeperExecutionId,
    route: paymentRoute,
    verification: paymentConfirmation.verification
  };
  const generation: Generation = {
    id: generationId,
    customerId: customer.id,
    subAccountId: subAccount.id,
    referrerCode: subAccount.referrerCode,
    status: paymentConfirmation.status === "pending" ? "PAYMENT_PENDING" : "QUEUED",
    input: normalizeGenerationInput(input.generation),
    payment,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await mutateStore((mutableStore) => addGeneration(mutableStore, generation));

  if (paymentConfirmation.status === "pending") {
    return generation;
  }

  try {
    subAccount = await ensureSubAccountExternalSession(subAccount);
    const creditsToGrant = estimateExternalCredits(priced);
    const creditGrant = await grantExternalUserCredits({
      externalUser: subAccount.externalUser,
      externalApiKey: subAccount.externalApiKey,
      credits: creditsToGrant,
      metadata: {
        generationId,
        customerId: customer.id,
        subAccountId: subAccount.id,
        quoteId: payment.quoteId,
        paymentRail,
        paymentAmountUsd: payment.amountUsd,
        paymentToken: payment.tokenSymbol,
        paymentChainId: payment.chainId,
        paymentTxHash: payment.txHash,
        keeperExecutionId: payment.keeperExecutionId
      }
    });
    const fundedPayment: GenerationPayment = {
      ...payment,
      samsarCreditGrant: creditGrant
    };
    await mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
      payment: fundedPayment
    }));
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
        ...fundedPayment,
        status: fundedPayment.status
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
    name: `SuperReferrals Video ${generation.id}`,
    description: "Marketing video INFT generated from a referrer image-list-to-video request.",
    animation_url: resultUrl,
    external_url: `${appBaseUrl()}/inft/${generation.id}`,
    image: firstImageUrl(generation.input),
    attributes,
    superreferrals: {
      generationId: generation.id,
      samsarSessionId: generation.samsarSessionId,
      referrerCode: subAccount.referrerCode,
      referrerUrl: `${customer.referrerBaseUrl}/r/${subAccount.referrerCode}`,
      userProfile: subAccount.blockchainRegistration,
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
    const outroImageUrl = String(payload.outroImageUrl || payload.outro_image_url || payload.newOutroImageUrl || payload.new_outro_image_url || "");
    if (!outroImageUrl) {
      throw new Error("outroImageUrl is required");
    }
    return runSamsarSessionAction("update_outro", {
      videoSessionId: generation.samsarSessionId,
      outro_image_url: outroImageUrl
    });
  }

  if (action === "add_outro") {
    const outroImageUrl = String(payload.outroImageUrl || payload.outro_image_url || payload.newOutroImageUrl || payload.new_outro_image_url || "");
    if (!outroImageUrl) {
      throw new Error("outroImageUrl is required");
    }
    return runSamsarSessionAction("add_outro", {
      videoSessionId: generation.samsarSessionId,
      outro_image_url: outroImageUrl,
      add_outro_animation: payload.addOutroAnimation !== false,
      add_outro_focus_area: payload.addOutroFocusArea === true,
      outro_focust_area: payload.outroFocusArea || payload.outro_focust_area
    });
  }

  if (action === "cancel_render") {
    return runSamsarSessionAction("cancel_render", {
      videoSessionId: generation.samsarSessionId
    });
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
  const hasProvidedOutro = Boolean(input.outro_image_url);
  const addOutroAnimation = input.add_outro_animation ?? Boolean(input.cta_url);
  return {
    ...input,
    video_model: input.video_model || "VEO3.1I2V",
    aspect_ratio: input.aspect_ratio || "16:9",
    enable_subtitles: input.enable_subtitles ?? true,
    outro_image_url: input.outro_image_url,
    add_outro_animation: addOutroAnimation === true,
    add_outro_focus_area: input.add_outro_focus_area === true,
    outro_focust_area: input.outro_focust_area,
    generate_outro_image: hasProvidedOutro ? false : input.generate_outro_image ?? Boolean(input.cta_url),
    cta_url: hasProvidedOutro ? undefined : input.cta_url,
    cta_text_top: hasProvidedOutro ? undefined : input.cta_text_top,
    cta_text_bottom: hasProvidedOutro ? undefined : input.cta_text_bottom,
    cta_logo: hasProvidedOutro ? undefined : input.cta_logo,
    add_footer_animation: input.add_footer_animation === true,
    footer_metadata: Array.isArray(input.footer_metadata) ? input.footer_metadata : undefined,
    image_urls: input.image_urls || []
  };
}

async function ensureSubAccountExternalSession(account: SubAccount) {
  if (account.externalApiKey) {
    return account;
  }
  const samsarSession = await ensureExternalUserSession(account.externalUser);
  return mutateStore((store) => {
    const current = store.subAccounts.find((item) => item.id === account.id);
    if (!current) {
      throw new Error("sub-account disappeared while preparing Samsar credits");
    }
    current.externalApiKey = samsarSession.externalApiKey;
    current.updatedAt = nowIso();
    return current;
  });
}

function estimateExternalCredits(priced: ReturnType<typeof priceGeneration>) {
  return Math.max(1, Math.ceil(priced.baseCreditsPerSecond * priced.durationSeconds));
}

async function resolvePaymentConfirmation({
  paymentRail,
  txHash,
  route,
  expectedPayment
}: {
  paymentRail?: GenerationPayment["paymentRail"];
  txHash?: string;
  route?: unknown;
  expectedPayment: {
    chainId: number;
    payerWallet?: string;
    recipientWallet: string;
    tokenAddress: string;
    amountAtomic: string;
  };
}): Promise<{
  status: GenerationPayment["status"];
  txHash?: string;
  keeperExecutionId?: string;
  verification?: GenerationPayment["verification"];
}> {
  const routeRecord = isRecord(route) ? route : undefined;
  const routeStatus = firstString(routeRecord, ["status", "state", "resultStatus"]).toLowerCase();
  const nestedRouteRecord = isRecord(routeRecord?.result) ? routeRecord.result : undefined;
  const routeTxHash =
    firstString(routeRecord, ["txHash", "transactionHash", "hash"]) ||
    firstString(nestedRouteRecord, ["txHash", "transactionHash", "hash"]);
  const keeperExecutionId =
    firstString(routeRecord, ["executionId", "execution_id", "id"]) ||
    firstString(nestedRouteRecord, ["executionId", "execution_id", "id"]);

  if (txHash || routeTxHash) {
    const paymentTxHash = txHash || routeTxHash;
    if (!allowMockRenderPayment()) {
      const verification = await verifyRenderPaymentTransaction({
        ...expectedPayment,
        txHash: paymentTxHash
      });
      return { status: "confirmed", txHash: paymentTxHash, keeperExecutionId, verification };
    }
    return { status: "confirmed", txHash: paymentTxHash, keeperExecutionId };
  }

  if (paymentRail === "keeperhub") {
    if ((isMockMode() || isProviderMock("KEEPERHUB") || routeStatus.startsWith("mock")) && allowMockRenderPayment()) {
      return { status: "mock_confirmed", keeperExecutionId };
    }
    if (["completed", "complete", "confirmed", "succeeded", "success", "executed"].includes(routeStatus)) {
      return { status: "confirmed", keeperExecutionId };
    }
    if (["failed", "failure", "reverted", "cancelled", "canceled", "error"].includes(routeStatus)) {
      throw new Error("KeeperHub payment failed; render credits were not granted.");
    }
    return { status: "pending", keeperExecutionId };
  }

  if (isMockMode()) {
    return allowMockRenderPayment() ? { status: "mock_confirmed" } : { status: "pending" };
  }
  return { status: "pending" };
}

function allowMockRenderPayment() {
  const value = env("ALLOW_MOCK_RENDER_PAYMENT", "false").toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function firstString(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) {
    return "";
  }
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
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
    { trait_type: "user_profile_id", value: subAccount.blockchainRegistration?.profileId || "" },
    { trait_type: "user_profile_chain", value: subAccount.blockchainRegistration?.chainName || "" },
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

function buildUniswapCheckoutUrl(tokenIn: string, tokenOut: string, value: number, chainId: number) {
  const chain = getTransactionChainConfig(chainId);
  const params = new URLSearchParams({
    chain: chain.uniswapChain,
    field: "output",
    value: String(value),
    inputCurrency: tokenIn,
    outputCurrency: tokenOut
  });
  return `https://app.uniswap.org/#/swap?${params.toString()}`;
}
