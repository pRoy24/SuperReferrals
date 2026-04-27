import { appBaseUrl, env, isMockMode, isProviderMock } from "./env";
import { getAgentConsoleSnapshot } from "./agent-framework";
import { askZeroGCompute } from "./compute";
import { buildINFTAssistantSystemPrompt } from "./assistant-prompt";
import { deriveAgentWallet, mintINFT } from "./inft";
import { buildGenerationFeedSettings } from "./feed";
import { bytes32From, createId, nowIso, normalizeWallet } from "./ids";
import {
  confirmKeeperPaymentSettlement,
  createKeeperPaymentIntent,
  executeKeeperRefund,
  getKeeperHubPaymentWorkflowId,
  getKeeperHubPlatformWalletAddress
} from "./keeperhub";
import {
  amountToAtomic,
  findPaymentToken,
  getTransactionChainConfig,
  getTransactionChainId,
  normalizeTransactionChainIdForEnvironment,
  settlementTokenForCurrency,
  type PaymentToken
} from "./payment-tokens";
import { verifyRenderPaymentTransaction } from "./payment-verification";
import { assertRenderConditions, countImages, priceGeneration, refundAmountForFailure } from "./pricing";
import { assertStorefrontRenderAccess, assertStorefrontWalletAllowed } from "./storefront-access";
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
  upsertCustomer,
  publicStore
} from "./store";
import {
  createExternalImageListVideo,
  fetchLatestVideoUrl,
  getSamsarStatus,
  runSamsarSessionAction
} from "./samsar";
import { createUniswapQuote } from "./uniswap";
import { buildZeroGStorageGatewayUrl, persistJsonToZeroG, persistRemoteVideoToZeroG } from "./zero-g";
import { withSerializedZeroGTransaction } from "./zero-g-chain";
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

const sampleImageUrlBases = new Set([
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
  "https://images.unsplash.com/photo-1460353581641-37baddab0fa2",
  "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77"
]);

export async function bootstrap() {
  await getAgentConsoleSnapshot();
  return publicStore(await readStore());
}

export async function createOrUpdateCustomer(input: Partial<Customer>) {
  const existingStore = await readStore();
  const existingCustomer = input.id
    ? existingStore.customers.find((item) => item.id === input.id)
    : existingStore.customers[0];
  if (!existingCustomer) {
    throw new Error("Create a SuperReferrals account through Stripe checkout or sign in to an existing credited account before setting up a storefront.");
  }
  assertCustomerProcessorReady(existingCustomer);
  return mutateStore((store) => upsertCustomer(store, {
    ...input,
    id: existingCustomer.id,
    samsarAccount: existingCustomer.samsarAccount,
    samsarApiKeyAlias: existingCustomer.samsarApiKeyAlias,
    subscription: existingCustomer.subscription
  }));
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
  assertCustomerProcessorReady(customer);
  const normalizedWallet = normalizeWallet(input.wallet);
  assertStorefrontWalletAllowed(customer, normalizedWallet);
  const existingAccount = existingStore.subAccounts.find((item) =>
    item.customerId === input.customerId && normalizeWallet(item.wallet) === normalizedWallet
  );
  if (existingAccount) {
    const blockchainRegistration = existingAccount.blockchainRegistration ||
      await createZeroGUserRegistration(customer, existingAccount);
    return mutateStore((store) => {
      const current = store.subAccounts.find((item) => item.id === existingAccount.id);
      if (!current) {
        throw new Error("sub-account disappeared while provisioning wallet profile");
      }
      current.blockchainRegistration = blockchainRegistration;
      current.updatedAt = nowIso();
      return current;
    });
  }
  const account = await mutateStore((store) => addSubAccount(store, input));
  const blockchainRegistration = await createZeroGUserRegistration(customer, account);
  return mutateStore((store) => {
    const current = store.subAccounts.find((item) => item.id === account.id);
    if (!current) {
      throw new Error("sub-account disappeared while provisioning wallet profile");
    }
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
      referrerCode: account.referrerCode
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
  const quoteSubAccount = input.subAccountId
    ? store.subAccounts.find((item) => item.id === input.subAccountId && item.customerId === customer.id)
    : undefined;
  assertStorefrontRenderAccess(customer, store, {
    wallet: quoteSubAccount?.wallet || input.swapper
  });
  assertRenderConditions(customer, {
    imageCount: input.imageCount,
    videoModel: input.videoModel,
    aspectRatio: input.aspectRatio
  });
  const pricing = priceGeneration(customer, input.imageCount, {
    video_model: input.videoModel,
    aspect_ratio: input.aspectRatio,
    duration_seconds: input.durationSeconds
  });
  const chainId = normalizeTransactionChainIdForEnvironment(customer.pricing.chainId || getTransactionChainId());
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
    !getKeeperHubPaymentWorkflowId(chainId) &&
    !isMockMode() &&
    !isProviderMock("KEEPERHUB") &&
    !["USDC", "USDT"].includes(paymentToken.symbol)
  ) {
    throw new Error("KEEPERHUB_PAYMENT_WORKFLOW_ID is required for non-stable token payments so KeeperHub can run the swap before settlement.");
  }
  if (
    paymentRail === "keeperhub" &&
    !sameToken &&
    !getKeeperHubPlatformWalletAddress() &&
    !isMockMode() &&
    !isProviderMock("KEEPERHUB")
  ) {
    throw new Error(`KEEPERHUB_PLATFORM_WALLET_ADDRESS is required so KeeperHub can receive ${paymentToken.symbol} and settle ${settlementToken.symbol}.`);
  }
  const conversionQuote = !sameToken && input.swapper
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
    : undefined;
  const paymentAmountAtomic = sameToken
    ? settlementAmountAtomic
    : resolvePaymentAmountAtomic({
      conversionQuote,
      paymentToken,
      amountUsd: pricing.totalUsd
    });
  const paymentRecipientAddress = paymentRail === "keeperhub" && !sameToken
    ? normalizeWallet(getKeeperHubPlatformWalletAddress())
    : customer.ownerWallet;
  const keeperIntent = paymentRail === "keeperhub"
    ? await createKeeperPaymentIntent({
      payerAddress: input.swapper || "",
      recipientAddress: customer.ownerWallet,
      amount: pricing.totalUsd.toFixed(2),
      paymentAmountAtomic,
      paymentRecipientAddress,
      amountUsd: pricing.totalUsd,
      tokenAddress: paymentToken.address,
      settlementTokenAddress: settlementToken.address,
      settlementAmountAtomic,
      chainId,
      reason: `SuperReferrals quote for ${pricing.durationSeconds} second render`
    })
    : undefined;
  const route = paymentRail === "keeperhub"
    ? withKeeperConversionMetadata(keeperIntent, {
      conversionQuote,
      paymentAmountAtomic,
      paymentRecipientAddress,
      paymentTokenAddress: paymentToken.address,
      settlementTokenAddress: settlementToken.address
    })
    : paymentRail === "uniswap" && !sameToken && conversionQuote
    ? conversionQuote
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
    paymentAmountAtomic,
    paymentRecipientAddress,
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

function withKeeperConversionMetadata(
  keeperIntent: unknown,
  metadata: {
    conversionQuote?: unknown;
    paymentAmountAtomic: string;
    paymentRecipientAddress: string;
    paymentTokenAddress: string;
    settlementTokenAddress: string;
  }
) {
  return {
    ...(isRecord(keeperIntent) ? keeperIntent : { keeperIntent }),
    conversionQuote: metadata.conversionQuote,
    paymentAmountAtomic: metadata.paymentAmountAtomic,
    paymentRecipientAddress: metadata.paymentRecipientAddress,
    paymentTokenAddress: metadata.paymentTokenAddress,
    settlementTokenAddress: metadata.settlementTokenAddress
  };
}

function resolvePaymentAmountAtomic({
  conversionQuote,
  paymentToken,
  amountUsd
}: {
  conversionQuote?: unknown;
  paymentToken: PaymentToken;
  amountUsd: number;
}) {
  const quotedAmount = atomicAmountFromConversionQuote(conversionQuote);
  if (quotedAmount) {
    return quotedAmount;
  }
  if (!isProviderMock("UNISWAP") && !isMockMode()) {
    throw new Error(`Unable to determine ${paymentToken.symbol} payment amount from Uniswap quote.`);
  }
  return fallbackPaymentAmountAtomic(paymentToken, amountUsd);
}

function atomicAmountFromConversionQuote(conversionQuote: unknown) {
  const route = isRecord(conversionQuote) ? conversionQuote : undefined;
  const quote = isRecord(route?.quote) ? route.quote : route;
  if (!quote || firstString(quote, ["routing"]) === "MOCK") {
    return "";
  }
  const input = isRecord(quote.input) ? quote.input : undefined;
  const rawAmount =
    firstString(input, ["amount", "amountIn", "amountInMaximum", "maximumAmountIn", "value"]) ||
    firstString(quote, ["inputAmount", "amountIn", "amountInMaximum", "maximumAmountIn", "estimatedAmountIn"]);
  if (!/^[0-9]+$/.test(rawAmount) || BigInt(rawAmount) <= 0n) {
    return "";
  }
  return rawAmount;
}

function fallbackPaymentAmountAtomic(paymentToken: PaymentToken, amountUsd: number) {
  if (["USDC", "USDT"].includes(paymentToken.symbol)) {
    return amountToAtomic(amountUsd, paymentToken.decimals);
  }
  const priceUsd = Number(env(`${paymentToken.symbol}_USD_PRICE_HINT`)) ||
    Number(env("KEEPERHUB_ETH_USD_PRICE_HINT")) ||
    Number(env("ETH_USD_PRICE_HINT")) ||
    3000;
  const bufferedTokenAmount = (amountUsd / priceUsd) * 1.03;
  return amountToAtomic(bufferedTokenAmount, paymentToken.decimals);
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
  feed?: {
    published?: boolean;
    tags?: unknown;
  };
  payment?: Partial<GenerationPayment>;
}) {
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === input.customerId);
  if (!customer) {
    throw new Error("customerId was not found");
  }
  assertCustomerProcessorReady(customer);
  const samsarApiKey = customerSamsarApiKey(customer);

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

  assertStorefrontRenderAccess(customer, store, {
    wallet: subAccount.wallet
  });

  const imageCount = countImages(input.generation);
  if (imageCount === 0) {
    throw new Error("image_urls must contain at least one image");
  }
  assertRenderConditions(customer, {
    imageCount,
    videoModel: input.generation.video_model,
    aspectRatio: input.generation.aspect_ratio
  });
  validateGenerationAssetUrls(input.generation);
  const priced = priceGeneration(customer, imageCount, input.generation);
  const normalizedInput = normalizeGenerationInput(input.generation);
  const quote = input.payment?.quoteId
    ? store.quotes.find((item) => item.id === input.payment?.quoteId)
    : undefined;
  const requestedPaymentRail = input.payment?.paymentRail || quote?.paymentRail || "keeperhub";
  const paymentRail = requestedPaymentRail;
  const paymentRoute = quote?.route;
  const paymentChainId = normalizeTransactionChainIdForEnvironment(customer.pricing.chainId || quote?.chainId || getTransactionChainId());
  const expectedSettlementToken =
    findPaymentToken(quote?.settlementTokenAddress || customer.pricing.settlementTokenAddress || "", paymentChainId) ||
    settlementTokenForCurrency(quote?.settlementCurrency || customer.pricing.currency, paymentChainId);
  if (!expectedSettlementToken) {
    throw new Error("Unable to resolve render settlement token for payment verification");
  }
  const expectedSettlementAmountAtomic = quote?.settlementAmountAtomic ||
    amountToAtomic(priced.totalUsd, expectedSettlementToken.decimals);
  const expectedPaymentToken =
    findPaymentToken(quote?.paymentTokenAddress || input.payment?.tokenAddress || "", paymentChainId) ||
    expectedSettlementToken;
  const expectedPaymentAmountAtomic = quote?.paymentAmountAtomic ||
    (expectedPaymentToken.address.toLowerCase() === expectedSettlementToken.address.toLowerCase()
      ? expectedSettlementAmountAtomic
      : amountToAtomic(priced.totalUsd, expectedPaymentToken.decimals));
  const expectedPaymentRecipient = quote?.paymentRecipientAddress || customer.ownerWallet;
  const generationId = createId("gen");
  const timestamp = nowIso();
  const paymentConfirmation = await resolvePaymentConfirmation({
    paymentRail,
    txHash: input.payment?.txHash,
    route: paymentRoute,
    expectedPayment: {
      chainId: paymentChainId,
      payerWallet: input.payment?.payerWallet || subAccount.wallet,
      recipientWallet: expectedPaymentRecipient,
      tokenAddress: expectedPaymentToken.address,
      amountAtomic: expectedPaymentAmountAtomic
    }
  });
  const keeperSettlement = paymentConfirmation.status === "confirmed" && shouldRunKeeperSettlement({
    paymentRail,
    quote,
    expectedPaymentToken,
    expectedSettlementToken,
    expectedPaymentRecipient,
    customer
  })
    ? await confirmKeeperPaymentSettlement({
      payerAddress: input.payment?.payerWallet || subAccount.wallet,
      recipientAddress: customer.ownerWallet,
      amount: priced.totalUsd.toFixed(2),
      amountUsd: priced.totalUsd,
      paymentAmountAtomic: expectedPaymentAmountAtomic,
      paymentRecipientAddress: expectedPaymentRecipient,
      paymentTxHash: paymentConfirmation.txHash,
      tokenAddress: expectedPaymentToken.address,
      settlementTokenAddress: expectedSettlementToken.address,
      settlementAmountAtomic: expectedSettlementAmountAtomic,
      chainId: paymentChainId,
      quoteId: input.payment?.quoteId || quote?.id,
      generationId,
      reason: `Settle SuperReferrals render ${generationId}`,
      metadata: {
        verification: paymentConfirmation.verification,
        referrerCode: subAccount.referrerCode,
        customerId: customer.id,
        subAccountId: subAccount.id
      }
    })
    : undefined;
  const keeperExecutionId = paymentConfirmation.keeperExecutionId ||
    firstString(isRecord(keeperSettlement) ? keeperSettlement : undefined, ["executionId", "execution_id", "id", "runId"]);
  const routeWithSettlement = keeperSettlement
    ? {
      ...(isRecord(paymentRoute) ? paymentRoute : { route: paymentRoute }),
      keeperSettlement
    }
    : paymentRoute;
  const payment: GenerationPayment = {
    amountUsd: priced.totalUsd,
    payerWallet: input.payment?.payerWallet || subAccount.wallet,
    txHash: input.payment?.txHash || paymentConfirmation.txHash,
    quoteId: input.payment?.quoteId || quote?.id,
    tokenAddress: expectedPaymentToken.address,
    tokenSymbol: quote?.paymentCurrency || input.payment?.tokenSymbol || expectedPaymentToken.symbol,
    paymentAmountAtomic: expectedPaymentAmountAtomic,
    settlementTokenAddress: expectedSettlementToken.address,
    settlementTokenSymbol: quote?.settlementCurrency || customer.pricing.currency || expectedSettlementToken.symbol,
    settlementAmountAtomic: expectedSettlementAmountAtomic,
    paymentRail,
    chainId: paymentChainId,
    status: paymentConfirmation.status,
    keeperExecutionId,
    route: routeWithSettlement,
    verification: paymentConfirmation.verification
  };
  const generation: Generation = {
    id: generationId,
    customerId: customer.id,
    subAccountId: subAccount.id,
    referrerCode: subAccount.referrerCode,
    status: paymentConfirmation.status === "pending" ? "PAYMENT_PENDING" : "QUEUED",
    input: normalizedInput,
    feed: buildGenerationFeedSettings(input.feed, normalizedInput.metadata),
    payment,
    createdAt: timestamp,
    updatedAt: timestamp
  };

  await mutateStore((mutableStore) => addGeneration(mutableStore, generation));

  if (paymentConfirmation.status === "pending") {
    return generation;
  }

  try {
    const response = await createExternalImageListVideo({
      input: generation.input,
      apiKey: samsarApiKey,
      generationId
    });
    return mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
      status: "PROCESSING",
      samsarRequestId: response.requestId,
      samsarSessionId: response.sessionId,
      payment: {
        ...payment,
        status: payment.status
      }
    }));
  } catch (error) {
    await mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "SuperReferrals request failed"
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
  const samsarApiKey = customerSamsarApiKey(customer);

  if (shouldRetryStoredResultFinalization(generation)) {
    try {
      return await finalizeGeneration(generation, customer, subAccount, generation.resultUrl || "");
    } catch (error) {
      return markGenerationFinalizationFailed(generation, generation.resultUrl || "", error);
    }
  }

  const requestId = generation.samsarRequestId || generation.samsarSessionId;
  if (!requestId) {
    return generation;
  }
  let status: Record<string, unknown>;
  try {
    status = await getSamsarStatus(requestId, undefined, undefined, samsarApiKey);
  } catch (error) {
    if (generation.resultUrl) {
      try {
        return await finalizeGeneration(generation, customer, subAccount, generation.resultUrl);
      } catch (finalizationError) {
        return markGenerationFinalizationFailed(generation, generation.resultUrl, finalizationError);
      }
    }
    return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
      status: "PROCESSING",
      errorMessage: `Unable to refresh SuperReferrals render status: ${formatErrorText(error)}`
    }));
  }
  const normalizedStatus = String(status.status || "").toUpperCase();
  const statusResultUrl = extractSamsarResultUrl(status) || generation.resultUrl || "";
  if (normalizedStatus === "COMPLETED" || statusResultUrl) {
    const internalSessionId = extractSamsarInternalSessionId(status);
    let resultUrl = statusResultUrl;
    if (!resultUrl) {
      const fallbackSessionId = firstInternalSamsarSessionId(internalSessionId, generation.samsarSessionId, requestId);
      if (!fallbackSessionId) {
        return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
          status: "PROCESSING",
          errorMessage: "SuperReferrals reported completion, but no video URL is available yet. Waiting for the final video URL."
        }));
      }
      try {
        resultUrl = await fetchLatestVideoUrl(fallbackSessionId, samsarApiKey);
      } catch (error) {
        return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
          status: "PROCESSING",
          errorMessage: `SuperReferrals reported completion, but the final video URL could not be fetched yet: ${formatErrorText(error)}`
        }));
      }
    }
    if (!resultUrl) {
      return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
        status: "PROCESSING",
        errorMessage: "SuperReferrals reported completion, but returned an empty video URL."
      }));
    }

    const generationForFinalize = await mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
      samsarSessionId: internalSessionId || generation.samsarSessionId,
      resultUrl,
      errorMessage: undefined
    }));
    if (!generationForFinalize) {
      throw new Error("generation was not found");
    }
    try {
      return await finalizeGeneration(generationForFinalize, customer, subAccount, resultUrl);
    } catch (error) {
      return markGenerationFinalizationFailed(generationForFinalize, resultUrl, error);
    }
  }
  if (normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED") {
    return failGeneration(generation, customer, normalizedStatus, String(status.message || status.error || "SuperReferrals generation failed"));
  }
  return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
    status: "PROCESSING",
    errorMessage: undefined
  }));
}

function shouldRetryStoredResultFinalization(generation: Generation) {
  return Boolean(
    generation.resultUrl &&
    (
      generation.status === "FAILED" ||
      !generation.inftId ||
      !generation.storage?.video ||
      !generation.storage?.metadata
    )
  );
}

function extractSamsarResultUrl(status: Record<string, unknown>) {
  return firstUrlValue(
    status.result_url,
    status.resultUrl,
    status.remoteURL,
    status.remoteUrl,
    status.video_url,
    status.videoUrl,
    status.published_video_url,
    status.publishedVideoUrl,
    status.result_urls,
    status.resultUrls,
    status.output,
    status.result,
    status.data
  );
}

function extractSamsarInternalSessionId(status: Record<string, unknown>) {
  return firstInternalSamsarSessionId(
    status.upstream_session_id,
    status.upstreamSessionId,
    status.upstream_request_id,
    status.upstreamRequestId,
    status.internal_session_id,
    status.internalSessionId,
    status.video_session_id,
    status.videoSessionId,
    status.session_id,
    status.sessionID
  );
}

function firstInternalSamsarSessionId(...values: unknown[]) {
  for (const value of values) {
    const candidate = typeof value === "string" ? value.trim() : "";
    if (candidate && !candidate.startsWith("extreq_")) {
      return candidate;
    }
  }
  return "";
}

function firstUrlValue(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const nested = firstUrlValue(...value);
      if (nested) {
        return nested;
      }
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const nested = firstUrlValue(
        record.url,
        record.uri,
        record.result_url,
        record.resultUrl,
        record.remoteURL,
        record.remoteUrl,
        record.video_url,
        record.videoUrl,
        record.output_url,
        record.outputUrl
      );
      if (nested) {
        return nested;
      }
    }
  }
  return "";
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
  return withSerializedZeroGTransaction(
    `generation-finalize:${generation.id}`,
    () => finalizeGenerationUnlocked(generation, customer, subAccount, resultUrl)
  );
}

async function finalizeGenerationUnlocked(
  generation: Generation,
  customer: Customer,
  subAccount: SubAccount,
  resultUrl: string
) {
  const latestGeneration = await getGeneration(generation.id) || generation;
  const existingInft = await findExistingINFTForGeneration(generation.id);
  if (latestGeneration.inftId || existingInft) {
    return markGenerationFinalizedFromExistingINFT(latestGeneration, resultUrl, existingInft);
  }

  const videoArtifact = latestGeneration.storage?.video || await persistRemoteVideoToZeroG(resultUrl);
  const generationWithVideo = await saveGenerationFinalizationProgress(latestGeneration.id, resultUrl, {
    video: videoArtifact,
    metadata: latestGeneration.storage?.metadata
  });
  const generationForMetadata = generationWithVideo || latestGeneration;
  const attributes = buildINFTAttributes(generationForMetadata, customer, subAccount);
  const metadata = {
    name: `SuperReferrals Video ${generationForMetadata.id}`,
    description: "Marketing video INFT generated from a referrer image-list-to-video request.",
    animation_url: resultUrl,
    external_url: `${appBaseUrl()}/inft/${generationForMetadata.id}`,
    image: firstImageUrl(generationForMetadata.input),
    attributes,
    superreferrals: {
      generationId: generationForMetadata.id,
      samsarSessionId: generationForMetadata.samsarSessionId,
      referrerCode: subAccount.referrerCode,
      referrerUrl: `${customer.referrerBaseUrl}/r/${subAccount.referrerCode}`,
      userProfile: subAccount.blockchainRegistration,
      metadata: generationForMetadata.input.metadata || {}
    },
    storage: {
      video: videoArtifact
    }
  };
  const metadataArtifact = generationForMetadata.storage?.metadata || await persistJsonToZeroG(metadata);
  await saveGenerationFinalizationProgress(generationForMetadata.id, resultUrl, {
    video: videoArtifact,
    metadata: metadataArtifact
  });
  const tokenMetadataUri =
    buildZeroGStorageGatewayUrl(metadataArtifact.rootHash) ||
    metadataArtifact.uri;
  const agentWallet = deriveAgentWallet(generationForMetadata.id);
  const ownerWallet = normalizeWallet(subAccount.wallet) as `0x${string}`;
  const mint = await mintINFT({
    ownerWallet,
    metadataUri: tokenMetadataUri,
    metadataHash: bytes32From(JSON.stringify(metadata)),
    agentWallet,
    referrerCode: subAccount.referrerCode
  });
  const timestamp = nowIso();
  const inft: INFTRecord = {
    id: generationForMetadata.id,
    generationId: generationForMetadata.id,
    customerId: customer.id,
    subAccountId: subAccount.id,
    ownerWallet,
    title: String(generationForMetadata.input.metadata?.title || `Video INFT ${generationForMetadata.id}`),
    description: String(generationForMetadata.input.prompt || "Generated marketing video"),
    videoUrl: resultUrl,
    storageRootHash: videoArtifact.rootHash,
    metadataRootHash: metadataArtifact.rootHash,
    metadataUri: tokenMetadataUri,
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
    return updateGeneration(mutableStore, generationForMetadata.id, {
      status: "COMPLETED",
      resultUrl,
      storage: {
        video: videoArtifact,
        metadata: metadataArtifact
      },
      inftId: inft.id,
      errorMessage: undefined
    });
  });
}

async function saveGenerationFinalizationProgress(
  generationId: string,
  resultUrl: string,
  storage: Generation["storage"]
) {
  return mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
    status: "PROCESSING",
    resultUrl,
    storage,
    errorMessage: undefined
  }));
}

async function findExistingINFTForGeneration(generationId: string) {
  const store = await readStore();
  return store.infts.find((item) => item.generationId === generationId || item.id === generationId);
}

async function markGenerationFinalizedFromExistingINFT(
  generation: Generation,
  resultUrl: string,
  inft?: INFTRecord
) {
  const storage = generation.storage || (inft ? {
    video: {
      rootHash: inft.storageRootHash,
      uri: `0g://${inft.storageRootHash}`,
      sizeBytes: 0,
      contentType: "video/mp4",
      mock: false
    },
    metadata: {
      rootHash: inft.metadataRootHash,
      uri: inft.metadataUri,
      sizeBytes: 0,
      contentType: "application/json",
      mock: false
    }
  } : undefined);

  return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
    status: "COMPLETED",
    resultUrl,
    storage,
    inftId: generation.inftId || inft?.id,
    errorMessage: undefined
  }));
}

async function markGenerationFinalizationFailed(
  generation: Generation,
  resultUrl: string,
  error: unknown
) {
  const message = `Video render completed, but 0G persistence or INFT minting failed: ${formatErrorText(error)}. Fix the 0G configuration and click Sync to retry finalization.`;
  return mutateStore((mutableStore) => updateGeneration(mutableStore, generation.id, {
    status: "FAILED",
    resultUrl,
    errorMessage: message
  }));
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

function formatErrorText(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim()) {
    return error.trim();
  }
  return "Unknown error";
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
  const customer = store.customers.find((item) => item.id === generation.customerId);
  const samsarApiKey = customer ? customerSamsarApiKey(customer) : undefined;

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
    }, samsarApiKey);
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
    }, samsarApiKey);
  }

  if (action === "cancel_render") {
    return runSamsarSessionAction("cancel_render", {
      videoSessionId: generation.samsarSessionId
    }, samsarApiKey);
  }

  if (action === "translate") {
    return runSamsarSessionAction("translate", {
      videoSessionId: generation.samsarSessionId,
      language: payload.language || "es"
    }, samsarApiKey);
  }

  if (action === "join") {
    const sessionIds = [generation.samsarSessionId, payload.sessionId || payload.session_id].filter(Boolean);
    return runSamsarSessionAction("join", {
      session_ids: sessionIds,
      blend_scenes: payload.blendScenes === true
    }, samsarApiKey);
  }

  if (action === "remove_subtitles") {
    return runSamsarSessionAction("remove_subtitles", {
      videoSessionId: generation.samsarSessionId
    }, samsarApiKey);
  }

  throw new Error(`Unsupported INFT action: ${action}`);
}

function normalizeGenerationInput(input: GenerationInput): GenerationInput {
  const hasProvidedOutro = Boolean(input.outro_image_url);
  const addOutroAnimation = input.add_outro_animation ?? Boolean(input.cta_url);
  const aspectRatio = input.aspect_ratio || "16:9";
  return {
    ...input,
    video_model: input.video_model || "VEO3.1I2V",
    aspect_ratio: aspectRatio,
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
    image_urls: normalizeGenerationImageInputs(input.image_urls || [], aspectRatio)
  };
}

function normalizeGenerationImageInputs(imageUrls: GenerationInput["image_urls"], aspectRatio: VideoAspectRatio): GenerationInput["image_urls"] {
  return imageUrls.map((item) => {
    if (typeof item === "string") {
      return isSampleImageUrl(item)
        ? { image_url: buildAspectSizedSampleImageUrl(item, aspectRatio), skip_enhancement: true }
        : item;
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }

    const record = item as Record<string, unknown>;
    const imageUrl = getGenerationImageUrl(record);
    const isSample = isSampleImageUrl(imageUrl);
    const hasExplicitSkip =
      Object.prototype.hasOwnProperty.call(record, "skip_enhancement") ||
      Object.prototype.hasOwnProperty.call(record, "skipEnhancement");

    return {
      ...record,
      ...(record.image_url && !isSample ? {} : { image_url: isSample ? buildAspectSizedSampleImageUrl(imageUrl, aspectRatio) : imageUrl }),
      ...(!hasExplicitSkip && isSample ? { skip_enhancement: true } : {})
    };
  });
}

function getGenerationImageUrl(item: Record<string, unknown>) {
  return String(
    item.image_url ||
    item.imageUrl ||
    item.url ||
    item.src ||
    item.effective_url ||
    item.effectiveUrl ||
    item.enhanced_url ||
    item.enhancedUrl ||
    ""
  ).trim();
}

function isSampleImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return sampleImageUrlBases.has(`${url.origin}${url.pathname}`);
  } catch {
    return false;
  }
}

function buildAspectSizedSampleImageUrl(rawUrl: string, aspectRatio: VideoAspectRatio) {
  const url = new URL(rawUrl);
  const [width, height] = aspectRatio === "9:16" ? [1024, 1792] : [1792, 1024];
  url.search = new URLSearchParams({
    auto: "format",
    fit: "crop",
    w: String(width),
    h: String(height),
    q: "90"
  }).toString();
  return url.toString();
}

function validateGenerationAssetUrls(input: GenerationInput) {
  for (const [index, item] of (input.image_urls || []).entries()) {
    if (typeof item === "string") {
      assertReachableUrlShape(item, `image_urls item ${index + 1}`);
      continue;
    }
    const imageUrl = getGenerationImageUrl(item as Record<string, unknown>);
    if (!imageUrl) {
      throw new Error(`image_urls item ${index + 1} must include image_url`);
    }
    assertReachableUrlShape(imageUrl, `image_urls item ${index + 1}`);
  }
  if (input.outro_image_url) {
    assertReachableUrlShape(input.outro_image_url, "outro_image_url");
  }
  if (input.cta_logo) {
    assertReachableUrlShape(input.cta_logo, "cta_logo");
  }
  for (const [index, item] of (input.footer_metadata || []).entries()) {
    assertReachableUrlShape(item.url, `footer_metadata item ${index + 1} url`);
  }
}

function assertReachableUrlShape(rawUrl: string, label: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must be an http(s) URL`);
  }
  if (url.hostname === "example.com" || url.hostname.endsWith(".example.com")) {
    throw new Error(`${label} must use a real reachable URL, not an example.com placeholder`);
  }
}

function customerSamsarApiKey(customer: Customer) {
  return env("SAMSAR_API_KEY") || customer.samsarAccount?.apiKey || undefined;
}

function assertCustomerProcessorReady(customer: Customer) {
  const hasProcessorAccountSession = Boolean(
    customer.samsarAccount?.authToken ||
    customer.samsarAccount?.apiKey ||
    (customer.samsarAccount?.externalUserId && env("SAMSAR_API_KEY"))
  );
  if (!hasProcessorAccountSession || Number(customer.subscription.creditsRemaining || 0) <= 0) {
    throw new Error("Sign in to a credited SuperReferrals account before using storefront setup.");
  }
}

function shouldRunKeeperSettlement({
  paymentRail,
  quote,
  expectedPaymentToken,
  expectedSettlementToken,
  expectedPaymentRecipient,
  customer
}: {
  paymentRail?: GenerationPayment["paymentRail"];
  quote?: PaymentQuote;
  expectedPaymentToken: PaymentToken;
  expectedSettlementToken: PaymentToken;
  expectedPaymentRecipient: string;
  customer: Customer;
}) {
  if (paymentRail !== "keeperhub" || !quote) {
    return false;
  }
  const tokenConversionRequired = expectedPaymentToken.address.toLowerCase() !== expectedSettlementToken.address.toLowerCase();
  const paymentHeldByKeeper = normalizeWallet(expectedPaymentRecipient) !== normalizeWallet(customer.ownerWallet);
  return tokenConversionRequired || paymentHeldByKeeper;
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
    if (["failed", "failure", "reverted", "cancelled", "canceled", "error"].includes(routeStatus)) {
      throw new Error("KeeperHub payment failed; render was not started.");
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
