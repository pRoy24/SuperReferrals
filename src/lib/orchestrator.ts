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
  getKeeperHubWalletAddress
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
import {
  assertRenderConditions,
  countImages,
  defaultINFTActionPricesUsd,
  normalizeINFTPaidAction,
  priceGeneration,
  priceINFTAction,
  refundAmountForFailure
} from "./pricing";
import { assertStorefrontRenderAccess, assertStorefrontWalletAllowed } from "./storefront-access";
import { hasStoredSamsarAppKey, samsarAppClientCredentials } from "./samsar-app-credentials";
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
  normalizeSamsarActionSessionId,
  normalizeSamsarVideoSessionId,
  publishSamsarSessionPublication,
  runSamsarSessionAction
} from "./samsar";
import {
  fetchSamsarProcessorCredits,
  provisionSamsarProcessorAppKeyIfMissing,
  verifySamsarProcessorAuthToken
} from "./samsar-processor";
import { createUniswapQuote } from "./uniswap";
import { assertUsableEvmAddress, isUsableEvmAddress } from "./wallet-address";
import { buildZeroGStorageGatewayUrl, persistJsonToZeroG, persistRemoteVideoToZeroG } from "./zero-g";
import { withSerializedZeroGTransaction } from "./zero-g-chain";
import { sendAxlMessage } from "./axl";
import { registerZeroGUserProfile } from "./user-registry";
import type {
  Customer,
  Generation,
  GenerationInput,
  GenerationPayment,
  INFTPaidAction,
  INFTAttribute,
  INFTRecord,
  PaymentQuote,
  SubAccount,
  VideoAspectRatio,
  VideoModel
} from "./types";
import type { ProcessorAccountCookieSession } from "./account-session";

const sampleImageUrlBases = new Set([
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
  "https://images.unsplash.com/photo-1460353581641-37baddab0fa2",
  "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77"
]);

export async function bootstrap() {
  await getAgentConsoleSnapshot();
  return publicStore(await readStore());
}

export async function restoreProcessorAccountSession(session?: ProcessorAccountCookieSession) {
  if (!session?.email) {
    return undefined;
  }
  let creditsRemaining = Number(session.creditsRemaining || 0);
  const store = await readStore();
  const existing = findProcessorSessionCustomer(store.customers, session);
  let existingCredential: string | ReturnType<typeof samsarAppClientCredentials> | undefined = session.authToken;
  if (existing && hasStoredSamsarAppKey(existing)) {
    try {
      existingCredential = samsarAppClientCredentials(existing);
    } catch {
      existingCredential = session.authToken;
    }
  }
  if (existingCredential) {
    try {
      const credits = await fetchSamsarProcessorCredits(existingCredential);
      creditsRemaining = credits.remainingCredits;
    } catch {
      // Keep the last known balance so the browser session can still restore.
    }
  }
  const existingOwnerWallet = isUsableEvmAddress(existing?.ownerWallet) ? existing?.ownerWallet : undefined;
  const restored = await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
    id: existing?.id || session.customerId,
    name: existing?.name || session.customerName || session.username || session.email.split("@")[0] || "SuperReferrals Account",
    ownerWallet: existingOwnerWallet || session.ownerWallet || session.walletAddress,
    samsarApiKeyAlias: existing?.samsarApiKeyAlias || (session.appKeyHash ? "samsar-user-app-key" : session.apiKey ? "samsar-user-api-key" : undefined),
    samsarAccount: {
      ...(existing?.samsarAccount || {}),
      email: session.email,
      username: session.username || existing?.samsarAccount?.username,
      userId: session.userId || existing?.samsarAccount?.userId,
      authToken: session.authToken || existing?.samsarAccount?.authToken,
      refreshToken: session.refreshToken || existing?.samsarAccount?.refreshToken,
      expiryDate: session.expiryDate || existing?.samsarAccount?.expiryDate,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt || existing?.samsarAccount?.refreshTokenExpiresAt,
      appKeyHash: existing?.samsarAccount?.appKeyHash || session.appKeyHash,
      appKeyPrefix: existing?.samsarAccount?.appKeyPrefix || session.appKeyPrefix,
      appKeyLast4: existing?.samsarAccount?.appKeyLast4 || session.appKeyLast4,
      apiKey: session.apiKey || existing?.samsarAccount?.apiKey,
      externalProvider: session.externalProvider || existing?.samsarAccount?.externalProvider,
      externalUserId: session.externalUserId || existing?.samsarAccount?.externalUserId,
      walletAddress: session.walletAddress || existing?.samsarAccount?.walletAddress,
      updatedAt: nowIso()
    },
    pricing: existing?.pricing || session.pricing,
    referrerBaseUrl: existing?.referrerBaseUrl || session.referrerBaseUrl,
    ensName: existing?.ensName ?? session.ensName,
    storefront: existing?.storefront || session.storefront,
    subscription: {
      status: creditsRemaining > 0 ? "active" : "not_started",
      creditsRemaining
    }
  }));
  const appKey = await provisionSamsarProcessorAppKeyIfMissing(restored, session.authToken);
  if (!appKey) {
    return restored;
  }
  return mutateStore((mutableStore) => upsertCustomer(mutableStore, {
    id: restored.id,
    samsarApiKeyAlias: "samsar-user-app-key",
    samsarAccount: {
      ...(restored.samsarAccount || {}),
      ...appKey,
      updatedAt: nowIso()
    },
    subscription: restored.subscription
  }));
}

export async function restoreProcessorAuthTokenSession(authToken?: string) {
  const cleanAuthToken = authToken?.trim();
  if (!cleanAuthToken) {
    return undefined;
  }
  const session = await verifySamsarProcessorAuthToken(cleanAuthToken);
  return restoreProcessorAccountSession({
    customerId: session.userId || createId("cus"),
    email: session.email,
    username: session.username,
    userId: session.userId,
    authToken: session.authToken,
    refreshToken: session.refreshToken,
    expiryDate: session.expiryDate,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    apiKey: session.apiKey,
    creditsRemaining: session.creditsRemaining,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  });
}

export async function createOrUpdateCustomer(input: Partial<Customer> & { createNewStorefront?: boolean }) {
  const existingStore = await readStore();
  const existingCustomer = input.id
    ? existingStore.customers.find((item) => item.id === input.id)
    : existingStore.customers[0];
  if (!existingCustomer) {
    throw new Error("Create a SuperReferrals account through Stripe checkout or sign in to an existing credited account before setting up a storefront.");
  }
  assertCustomerProcessorReady(existingCustomer);
  if (input.storefront) {
    input.ownerWallet = assertUsableEvmAddress(
      input.ownerWallet || existingCustomer.ownerWallet || existingCustomer.samsarAccount?.walletAddress,
      "Store owner wallet"
    );
  }
  if (input.createNewStorefront) {
    const ownerWallet = input.ownerWallet || existingCustomer.ownerWallet || existingCustomer.samsarAccount?.walletAddress;
    return mutateStore((store) => upsertCustomer(store, {
      ...input,
      id: undefined,
      ownerWallet,
      samsarAccount: existingCustomer.samsarAccount,
      samsarApiKeyAlias: existingCustomer.samsarApiKeyAlias,
      subscription: existingCustomer.subscription
    }));
  }
  return mutateStore((store) => upsertCustomer(store, {
    ...input,
    id: existingCustomer.id,
    samsarAccount: existingCustomer.samsarAccount,
    samsarApiKeyAlias: existingCustomer.samsarApiKeyAlias,
    subscription: existingCustomer.subscription
  }));
}

function findProcessorSessionCustomer(customers: Customer[], session: ProcessorAccountCookieSession) {
  const exact = customers.find((customer) => customer.id === session.customerId);
  if (exact) {
    return exact;
  }
  const userIdMatches = session.userId
    ? customers.filter((customer) => customer.samsarAccount?.userId === session.userId)
    : [];
  if (userIdMatches.length) {
    return oldestCustomer(userIdMatches);
  }
  const emailMatches = session.email
    ? customers.filter((customer) => customer.samsarAccount?.email?.toLowerCase() === session.email.toLowerCase())
    : [];
  return emailMatches.length ? oldestCustomer(emailMatches) : undefined;
}

function oldestCustomer(customers: Customer[]) {
  return [...customers].sort((left, right) =>
    Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "")
  )[0];
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
  const normalizedWallet = assertUsableEvmAddress(input.wallet, "Wallet");
  assertStorefrontWalletAllowed(customer, normalizedWallet);
  const existingAccount = existingStore.subAccounts.find((item) =>
    item.customerId === input.customerId && normalizeWallet(item.wallet) === normalizedWallet
  );
  if (existingAccount) {
    const blockchainRegistration = existingAccount.blockchainRegistration ||
      await tryCreateZeroGUserRegistration(customer, existingAccount);
    return mutateStore((store) => {
      const current = store.subAccounts.find((item) => item.id === existingAccount.id);
      if (!current) {
        throw new Error("wallet user record disappeared while provisioning");
      }
      current.blockchainRegistration = blockchainRegistration;
      current.updatedAt = nowIso();
      return current;
    });
  }
  const account = await mutateStore((store) => addSubAccount(store, input));
  const blockchainRegistration = await tryCreateZeroGUserRegistration(customer, account);
  return mutateStore((store) => {
    const current = store.subAccounts.find((item) => item.id === account.id);
    if (!current) {
      throw new Error("wallet user record disappeared while provisioning");
    }
    current.blockchainRegistration = blockchainRegistration;
    current.updatedAt = nowIso();
    return current;
  });
}

async function tryCreateZeroGUserRegistration(customer: Customer, account: SubAccount) {
  try {
    return await createZeroGUserRegistration(customer, account);
  } catch (error) {
    console.warn("Skipping optional 0G wallet user registration", {
      customerId: customer.id,
      subAccountId: account.id,
      error: error instanceof Error ? error.message : error
    });
    return undefined;
  }
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
  inftId?: string;
  action?: string;
  operation?: string;
  imageCount?: number;
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
  await ensureCustomerSamsarAppCredentials(customer);
  const inftAction = normalizeINFTPaidAction(input.action || input.operation || "");
  const quoteINFT = input.inftId
    ? store.infts.find((item) => item.id === input.inftId && item.customerId === customer.id)
    : undefined;
  if (input.inftId && !quoteINFT) {
    throw new Error("INFT does not belong to this storefront.");
  }
  if ((input.inftId || input.action || input.operation) && !inftAction) {
    throw new Error("Unsupported paid INFT action.");
  }
  const quoteSubAccount = input.subAccountId
    ? store.subAccounts.find((item) => item.id === input.subAccountId && item.customerId === customer.id)
    : undefined;
  const quoteWallet = input.swapper || quoteSubAccount?.wallet;
  if (!isUsableEvmAddress(quoteWallet)) {
    throw new Error("Connect a valid wallet before requesting a payment quote.");
  }
  assertStorefrontRenderAccess(customer, store, {
    wallet: quoteWallet
  });
  const imageCount = Number(input.imageCount || 0);
  const pricing = inftAction
    ? priceINFTAction(customer, inftAction)
    : (() => {
      if (!imageCount || imageCount < 1) {
        throw new Error("imageCount must be greater than zero");
      }
      assertRenderConditions(customer, {
        imageCount,
        videoModel: input.videoModel,
        aspectRatio: input.aspectRatio
      });
      return priceGeneration(customer, imageCount, {
        video_model: input.videoModel,
        aspect_ratio: input.aspectRatio,
        duration_seconds: input.durationSeconds
      });
    })();
  const chainId = normalizeTransactionChainIdForEnvironment(customer.pricing.chainId || getTransactionChainId());
  if (input.chainId && input.chainId !== chainId) {
    throw new Error(`Payment chain must match the customer account chain ${getTransactionChainConfig(chainId).name}.`);
  }
  const customerSettlementWallet = resolveRenderPaymentRecipientWallet(customer);
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
  const keeperHubWallet = getKeeperHubWalletAddress();
  if (
    paymentRail === "keeperhub" &&
    !sameToken &&
    !isUsableEvmAddress(keeperHubWallet) &&
    !isMockMode() &&
    !isProviderMock("KEEPERHUB")
  ) {
    throw new Error(`ETH payments are not configured for this deployment. Set KEEPERHUB_WALLET_ADDRESS to a valid non-zero EVM address so KeeperHub can receive ${paymentToken.symbol} and settle ${settlementToken.symbol}.`);
  }
  const keeperPaymentRecipient = paymentRail === "keeperhub" && !sameToken
    ? isUsableEvmAddress(keeperHubWallet)
      ? assertUsableEvmAddress(keeperHubWallet, "KEEPERHUB_WALLET_ADDRESS")
      : customerSettlementWallet
    : "";
  const conversionQuote = paymentRail === "uniswap" && !sameToken && input.swapper
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
      amountUsd: pricing.totalUsd,
      allowPriceHintFallback: paymentRail === "keeperhub"
    });
  const paymentRecipientAddress = paymentRail === "keeperhub" && !sameToken
    ? keeperPaymentRecipient
    : customerSettlementWallet;
  const keeperIntent = paymentRail === "keeperhub"
    ? await createKeeperPaymentIntent({
      payerAddress: input.swapper || "",
      recipientAddress: customerSettlementWallet,
      amount: pricing.totalUsd.toFixed(2),
      paymentAmountAtomic,
      paymentRecipientAddress,
      amountUsd: pricing.totalUsd,
      tokenAddress: paymentToken.address,
      settlementTokenAddress: settlementToken.address,
      settlementAmountAtomic,
      chainId,
      reason: inftAction
        ? `SuperReferrals INFT ${inftAction.replaceAll("_", " ")} action`
        : `SuperReferrals quote for ${pricing.durationSeconds} second render`
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
    subAccountId: input.subAccountId || quoteINFT?.subAccountId,
    inftId: quoteINFT?.id,
    operation: inftAction || undefined,
    imageCount,
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
  amountUsd,
  allowPriceHintFallback = false
}: {
  conversionQuote?: unknown;
  paymentToken: PaymentToken;
  amountUsd: number;
  allowPriceHintFallback?: boolean;
}) {
  const quotedAmount = atomicAmountFromConversionQuote(conversionQuote);
  if (quotedAmount) {
    return quotedAmount;
  }
  if (!allowPriceHintFallback && !isProviderMock("UNISWAP") && !isMockMode()) {
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
    samsarGalleryPublished?: boolean;
    tags?: unknown;
  };
  payment?: Partial<GenerationPayment>;
}) {
  const store = await readStore();
  const customer = store.customers.find((item) => item.id === input.customerId);
  if (!customer) {
    throw new Error("customerId was not found");
  }
  const customerCredentials = await ensureCustomerSamsarAppCredentials(customer);

  let subAccount = input.subAccountId
    ? store.subAccounts.find((item) => item.id === input.subAccountId && item.customerId === customer.id)
    : undefined;
  if (input.subAccountId && !subAccount) {
    throw new Error("Wallet user record was not found for this storefront.");
  }
  if (!subAccount) {
    const payerWallet = input.subAccount?.wallet || input.payment?.payerWallet;
    if (!payerWallet) {
      throw new Error("Connect a wallet before starting a render.");
    }
    const normalizedPayerWallet = assertUsableEvmAddress(payerWallet, "Render wallet");
    subAccount = await createSubAccountForCustomer({
      customerId: customer.id,
      wallet: normalizedPayerWallet,
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
  const customerSettlementWallet = resolveRenderPaymentRecipientWallet(customer);
  const expectedPaymentRecipient = assertUsableEvmAddress(
    quote?.paymentRecipientAddress || customerSettlementWallet,
    "Payment recipient wallet"
  );
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
      recipientAddress: customerSettlementWallet,
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
    assertPaidRenderProviderCanFulfill(paymentConfirmation.status);
    const response = await createExternalImageListVideo({
      ...customerCredentials,
      input: generation.input,
      generationId
    });
    const remainingCredits = firstNumber(response.raw, ["remainingCredits", "remaining_credits", "creditsRemaining"]);
    if (remainingCredits !== null) {
      await updateCustomerSamsarCreditBalance(customer.id, remainingCredits);
    }
    return mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
      status: "PROCESSING",
      samsarRequestId: response.requestId,
      samsarSessionId: response.sessionId,
      payment
    }));
  } catch (error) {
    await mutateStore((mutableStore) => updateGeneration(mutableStore, generationId, {
      status: "FAILED",
      errorMessage: error instanceof Error ? error.message : "SuperReferrals request failed"
    }));
    throw error;
  }
}

function assertPaidRenderProviderCanFulfill(paymentStatus: GenerationPayment["status"]) {
  if (paymentStatus === "mock_confirmed" || !isProviderMock("SAMSAR")) {
    return;
  }
  throw new Error("SUPERREFERRALS_MOCKS must be false before accepting real render payments. The paid render was not submitted to Samsar.");
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
  const samsarCredential = await ensureCustomerSamsarAppCredentials(customer);

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
    status = await getSamsarStatus(requestId, undefined, undefined, samsarCredential);
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
        resultUrl = await fetchLatestVideoUrl(fallbackSessionId, samsarCredential);
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
      !generation.storage?.metadata ||
      needsSamsarGalleryPublication(generation)
    )
  );
}

function needsSamsarGalleryPublication(generation: Generation) {
  if (!generation.feed || generation.feed.samsarGalleryPublished === false) {
    return false;
  }
  return !isSuccessfulSamsarPublication(
    generation.feed.samsarPublication,
    resolveGenerationVideoSessionId(generation)
  );
}

function isSuccessfulSamsarPublication(
  publication: { status?: string; sessionId?: string } | undefined,
  sessionId?: string
) {
  if (!publication || !["published", "mock_published"].includes(publication.status || "")) {
    return false;
  }
  return !sessionId || normalizeSamsarVideoSessionId(publication.sessionId) === sessionId;
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
    status.sessionId,
    status.sessionID
  );
}

function firstInternalSamsarSessionId(...values: unknown[]) {
  let externalRequestFallback = "";
  for (const value of values) {
    const candidate = typeof value === "string" ? value.trim() : "";
    if (!candidate) {
      continue;
    }
    const normalizedCandidate = normalizeSamsarVideoSessionId(candidate);
    if (!candidate.startsWith("extreq_")) {
      return normalizedCandidate;
    }
    externalRequestFallback ||= normalizedCandidate;
  }
  return externalRequestFallback;
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
  const requestId = extractSamsarWebhookRequestId(payload);
  if (!requestId) {
    return {
      ignored: true,
      reason: "missing_request_id"
    };
  }
  const normalizedRequestId = normalizeSamsarVideoSessionId(requestId);
  const store = await readStore();
  const generation = store.generations.find((item) =>
    item.samsarRequestId === requestId ||
    item.samsarSessionId === requestId ||
    (normalizedRequestId && (
      item.samsarRequestId === normalizedRequestId ||
      item.samsarSessionId === normalizedRequestId
    )) ||
    item.id === requestId
  );
  if (!generation) {
    return { ignored: true, requestId };
  }
  return syncGeneration(generation.id);
}

const samsarWebhookRequestIdKeys = [
  "request_id",
  "requestId",
  "global_status_id",
  "globalStatusId",
  "session_id",
  "sessionId",
  "sessionID",
  "video_session_id",
  "videoSessionId",
  "videoSessionID",
  "upstream_session_id",
  "upstreamSessionId",
  "upstream_request_id",
  "upstreamRequestId",
  "external_request_id",
  "externalRequestId",
  "external_session_id",
  "externalSessionId"
];

function extractSamsarWebhookRequestId(payload: Record<string, unknown>): string {
  const direct = firstString(payload, samsarWebhookRequestIdKeys);
  if (direct) {
    return direct;
  }
  for (const key of ["data", "result", "input", "session", "request", "payload", "event", "video", "output"]) {
    const nested = payload[key];
    if (isRecord(nested)) {
      const nestedRequestId = extractSamsarWebhookRequestId(nested);
      if (nestedRequestId) {
        return nestedRequestId;
      }
    }
  }
  return "";
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
    const feed = await publishGenerationToSamsarGalleryIfNeeded(
      latestGeneration,
      customer,
      subAccount,
      existingInft?.title
    );
    return markGenerationFinalizedFromExistingINFT(latestGeneration, resultUrl, existingInft, feed);
  }

  const videoArtifact = latestGeneration.storage?.video || await persistRemoteVideoToZeroG(resultUrl);
  const generationWithVideo = await saveGenerationFinalizationProgress(latestGeneration.id, resultUrl, {
    video: videoArtifact,
    metadata: latestGeneration.storage?.metadata
  });
  const generationForMetadata = generationWithVideo || latestGeneration;
  const attributes = buildINFTAttributes(generationForMetadata, customer, subAccount);
  const inftTitle = resolveINFTTitle(generationForMetadata, subAccount);
  const metadata = {
    name: inftTitle,
    description: "Marketing video INFT generated from a referrer image-list-to-video request.",
    animation_url: resultUrl,
    external_url: `${appBaseUrl()}/inft/${generationForMetadata.id}`,
    image: firstImageUrl(generationForMetadata.input),
    attributes,
    superreferrals: {
      generationId: generationForMetadata.id,
      customerId: customer.id,
      subAccountId: subAccount.id,
      title: inftTitle,
      samsarRequestId: generationForMetadata.samsarRequestId,
      samsarSessionId: generationForMetadata.samsarSessionId,
      referrerCode: subAccount.referrerCode,
      referrerUrl: `${customer.referrerBaseUrl}/r/${subAccount.referrerCode}`,
      ownerWallet: subAccount.wallet,
      userProfile: subAccount.blockchainRegistration,
      metadata: generationForMetadata.input.metadata || {}
    },
    storage: {
      video: videoArtifact
    }
  };
  const metadataArtifact = await persistJsonToZeroG(metadata);
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
    title: inftTitle,
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
  const feed = await publishGenerationToSamsarGalleryIfNeeded(
    generationForMetadata,
    customer,
    subAccount,
    inftTitle
  );

  return mutateStore((mutableStore) => {
    addINFT(mutableStore, inft);
    const patch: Partial<Generation> = {
      status: "COMPLETED",
      resultUrl,
      storage: {
        video: videoArtifact,
        metadata: metadataArtifact
      },
      inftId: inft.id,
      errorMessage: undefined
    };
    if (feed) {
      patch.feed = feed;
    }
    return updateGeneration(mutableStore, generationForMetadata.id, patch);
  });
}

async function publishGenerationToSamsarGalleryIfNeeded(
  generation: Generation,
  customer: Customer,
  subAccount: SubAccount,
  title?: string
) {
  if (!generation.feed || generation.feed.samsarGalleryPublished === false) {
    return undefined;
  }
  const sessionId = resolveGenerationVideoSessionId(generation);
  if (!sessionId) {
    return {
      ...generation.feed,
      samsarPublication: {
        status: "failed" as const,
        sessionId: "",
        submittedAt: nowIso(),
        errorMessage: "Completed generation does not have a Samsar session id to publish."
      }
    };
  }
  if (isSuccessfulSamsarPublication(generation.feed.samsarPublication, sessionId)) {
    return generation.feed;
  }

  try {
    const publication = await publishGenerationSamsarPublication({
      sessionId,
      title: title || resolveINFTTitle(generation, subAccount),
      description: String(generation.input.prompt || "Generated marketing video"),
      tags: generation.feed.tags,
      creatorHandle: subAccount.username || subAccount.referrerCode,
      aspectRatio: generation.input.aspect_ratio,
      videoModel: generation.input.video_model,
      prompt: generation.input.prompt,
      language: generation.input.language,
      customer,
      idempotencyKey: `superreferrals:${generation.id}:samsar-publication`
    });
    return {
      ...generation.feed,
      samsarPublication: publication
    };
  } catch (error) {
    console.warn("Unable to publish Samsar feed publication", {
      generationId: generation.id,
      sessionId,
      error: formatErrorText(error)
    });
    return {
      ...generation.feed,
      samsarPublication: {
        status: "failed" as const,
        sessionId,
        submittedAt: nowIso(),
        errorMessage: formatErrorText(error)
      }
    };
  }
}

async function publishGenerationSamsarPublication(input: {
  sessionId: string;
  title: string;
  description: string;
  tags: string[];
  creatorHandle: string;
  aspectRatio: VideoAspectRatio;
  videoModel: VideoModel;
  prompt?: string;
  language?: string;
  customer: Customer;
  idempotencyKey: string;
}) {
  const credential = await ensureCustomerSamsarAppCredentials(input.customer);
  return publishSamsarSessionPublication({
    sessionId: input.sessionId,
    title: input.title,
    description: input.description,
    tags: input.tags,
    creatorHandle: input.creatorHandle,
    aspectRatio: input.aspectRatio,
    videoModel: input.videoModel,
    prompt: input.prompt,
    language: input.language,
    ...credential,
    idempotencyKey: input.idempotencyKey
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
  inft?: INFTRecord,
  feed?: Generation["feed"]
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

  return mutateStore((mutableStore) => {
    const patch: Partial<Generation> = {
      status: "COMPLETED",
      resultUrl,
      storage,
      inftId: generation.inftId || inft?.id,
      errorMessage: undefined
    };
    if (feed) {
      patch.feed = feed;
    }
    return updateGeneration(mutableStore, generation.id, patch);
  });
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
  const inft = await getINFT(id);
  if (!inft) {
    throw new Error("INFT was not found");
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

  const generation = store.generations.find((item) => item.id === inft.generationId);
  if (!generation) {
    throw new Error("INFT generation was not found in the local runtime store. The public view can be recovered from 0G/onchain metadata, but video mutation actions need the live generation session index.");
  }
  const customer = store.customers.find((item) => item.id === generation.customerId);
  if (!customer) {
    throw new Error("INFT storefront customer was not found.");
  }
  const subAccount = store.subAccounts.find((item) => item.id === generation.subAccountId);
  if (!subAccount) {
    throw new Error("INFT generation is missing its sub-account.");
  }
  if (action === "action_status") {
    const requestId = String(payload.requestId || payload.request_id || payload.sessionId || payload.session_id || "");
    if (!requestId) {
      throw new Error("requestId is required");
    }
    const statusContext = await ensureCustomerSamsarActionSession(customer);
    const status = await getSamsarStatus(
      requestId,
      undefined,
      undefined,
      statusContext
    );
    const normalizedStatus = String(status.status || "").toUpperCase();
    let resultUrl = extractSamsarResultUrl(status);
    if (!resultUrl && normalizedStatus === "COMPLETED") {
      const fallbackSessionId = firstInternalSamsarSessionId(extractSamsarInternalSessionId(status), requestId);
      if (fallbackSessionId) {
        resultUrl = await fetchLatestVideoUrl(fallbackSessionId, statusContext).catch(() => "");
      }
    }
    const finalized = normalizedStatus === "COMPLETED" && resultUrl
      ? await finalizeINFTActionResult({
        action: firstString(payload, ["sourceAction", "source_action", "operation", "action"]),
        customer,
        generation,
        inft,
        requestId,
        resultUrl,
        status,
        subAccount
      }).catch((error) => ({
        errorMessage: `Video completed but new INFT creation failed: ${formatErrorText(error)}`
      }))
      : undefined;
    return {
      ...status,
      status: normalizedStatus || status.status || "PROCESSING",
      resultUrl: resultUrl || undefined,
      finalization: finalized,
      inft: finalized && "inft" in finalized ? finalized.inft : undefined,
      generation: finalized && "generation" in finalized ? finalized.generation : undefined
    };
  }

  if (action === "update_outro") {
    const videoSessionId = resolveGenerationVideoActionSessionId(generation);
    if (!videoSessionId) {
      throw new Error("Current INFT generation does not have a SuperReferrals video session id.");
    }
    const outroImageUrl = firstString(payload, ["outroImageUrl", "outro_image_url", "newOutroImageUrl", "new_outro_image_url"]);
    const ctaUrl = firstString(payload, ["ctaUrl", "cta_url"]);
    if (outroImageUrl && ctaUrl) {
      throw new Error("Use either an outro image URL or CTA URL, not both.");
    }
    if (!outroImageUrl && !ctaUrl) {
      throw new Error("An outro image URL or CTA URL is required.");
    }

    const updateInput: Record<string, unknown> = {
      videoSessionId,
      ...optionalBooleanField("add_outro_animation", payload.addOutroAnimation, payload.add_outro_animation)
    };
    if (ctaUrl) {
      updateInput.generate_outro_image = true;
      updateInput.cta_url = ctaUrl;
      const ctaTextTop = firstString(payload, ["ctaTextTop", "cta_text_top"]);
      const ctaTextBottom = firstString(payload, ["ctaTextBottom", "cta_text_bottom"]);
      const ctaLogo = firstString(payload, ["ctaLogo", "cta_logo"]);
      if (ctaTextTop) updateInput.cta_text_top = ctaTextTop;
      if (ctaTextBottom) updateInput.cta_text_bottom = ctaTextBottom;
      if (ctaLogo) updateInput.cta_logo = ctaLogo;
    } else {
      updateInput.outro_image_url = outroImageUrl;
      Object.assign(updateInput, optionalBooleanField("add_outro_focus_area", payload.addOutroFocusArea, payload.add_outro_focus_area));
      const outroFocusArea = payload.outroFocusArea || payload.outro_focus_area || payload.outroFocustArea || payload.outro_focust_area;
      if (outroFocusArea) {
        updateInput.outro_focust_area = outroFocusArea;
      }
    }
    return runPaidINFTSamsarAction({
      inft,
      customer,
      action: "update_outro",
      actionInput: updateInput,
      paymentPayload: paymentPayloadFromINFTAction(payload)
    });
  }

  if (action === "add_outro") {
    const videoSessionId = resolveGenerationVideoActionSessionId(generation);
    if (!videoSessionId) {
      throw new Error("Current INFT generation does not have a SuperReferrals video session id.");
    }
    const outroImageUrl = String(payload.outroImageUrl || payload.outro_image_url || payload.newOutroImageUrl || payload.new_outro_image_url || "");
    if (!outroImageUrl) {
      throw new Error("outroImageUrl is required");
    }
    return runPaidINFTSamsarAction({
      inft,
      customer,
      action: "add_outro",
      actionInput: {
        videoSessionId,
        outro_image_url: outroImageUrl,
        add_outro_animation: typeof payload.add_outro_animation === "boolean"
          ? payload.add_outro_animation
          : payload.addOutroAnimation !== false,
        add_outro_focus_area: payload.addOutroFocusArea === true || payload.add_outro_focus_area === true,
        outro_focust_area: payload.outroFocusArea || payload.outro_focus_area || payload.outroFocustArea || payload.outro_focust_area
      },
      paymentPayload: paymentPayloadFromINFTAction(payload)
    });
  }

  if (action === "cancel_render") {
    const videoSessionId = resolveGenerationVideoActionSessionId(generation);
    if (!videoSessionId) {
      throw new Error("Current INFT generation does not have a SuperReferrals video session id.");
    }
    const samsarSession = await ensureCustomerSamsarActionSession(customer);
    return runSamsarSessionAction("cancel_render", {
      videoSessionId
    }, samsarSession);
  }

  if (action === "translate") {
    const videoSessionId = resolveGenerationVideoActionSessionId(generation);
    if (!videoSessionId) {
      throw new Error("Current INFT generation does not have a SuperReferrals video session id.");
    }
    return runPaidINFTSamsarAction({
      inft,
      customer,
      action: "translate",
      actionInput: {
        videoSessionId,
        language: payload.language || "es"
      },
      paymentPayload: paymentPayloadFromINFTAction(payload)
    });
  }

  if (action === "join") {
    const videoSessionId = resolveGenerationVideoActionSessionId(generation);
    if (!videoSessionId) {
      throw new Error("Current INFT generation does not have a SuperReferrals video session id.");
    }
    const sessionIds = [
      videoSessionId,
      normalizeSamsarActionSessionId(payload.sessionId || payload.session_id)
    ].filter(Boolean);
    return runPaidINFTSamsarAction({
      inft,
      customer,
      action: "join",
      actionInput: {
        session_ids: sessionIds,
        blend_scenes: payload.blendScenes === true || payload.blend_scenes === true
      },
      paymentPayload: paymentPayloadFromINFTAction(payload)
    });
  }

  if (action === "remove_subtitles") {
    const videoSessionId = resolveGenerationVideoActionSessionId(generation);
    if (!videoSessionId) {
      throw new Error("Current INFT generation does not have a SuperReferrals video session id.");
    }
    return runPaidINFTSamsarAction({
      inft,
      customer,
      action: "remove_subtitles",
      actionInput: {
      videoSessionId
      },
      paymentPayload: paymentPayloadFromINFTAction(payload)
    });
  }

  throw new Error(`Unsupported INFT action: ${action}`);
}

async function finalizeINFTActionResult({
  action,
  customer,
  generation,
  inft,
  requestId,
  resultUrl,
  status,
  subAccount
}: {
  action: string;
  customer: Customer;
  generation: Generation;
  inft: INFTRecord;
  requestId: string;
  resultUrl: string;
  status: Record<string, unknown>;
  subAccount: SubAccount;
}) {
  return withSerializedZeroGTransaction(`inft-action-finalize:${inft.id}:${requestId}`, async () => {
    const latestStore = await readStore();
    const normalizedRequestId = normalizeSamsarVideoSessionId(requestId);
    const latestGeneration = latestStore.generations.find((item) => item.id === generation.id) || generation;
    const latestInft = latestStore.infts.find((item) => item.id === inft.id) || inft;
    const existingGeneration = latestStore.generations.find((item) =>
      item.id !== latestGeneration.id &&
      generationMatchesActionRequest(item, requestId, normalizedRequestId)
    );
    const existingInft = existingGeneration
      ? latestStore.infts.find((item) => item.id === existingGeneration.inftId || item.generationId === existingGeneration.id)
      : undefined;
    if (existingGeneration && existingInft) {
      return {
        mode: "already_created",
        action: action || "video_session_edit",
        inft: existingInft,
        generation: existingGeneration
      };
    }

    const actionSessionId = firstInternalSamsarSessionId(
      extractSamsarInternalSessionId(status),
      requestId
    );
    const videoArtifact = await persistRemoteVideoToZeroG(resultUrl);
    const timestamp = nowIso();
    const derivativeGenerationId = createId("gen");
    const actionName = action || "video_session_edit";
    const metadataTitle = buildDerivativeINFTTitle(latestInft, actionName);
    const sourceMetadata = isRecord(latestGeneration.input.metadata) ? latestGeneration.input.metadata : {};
    const derivativeInput: GenerationInput = {
      ...latestGeneration.input,
      metadata: {
        ...sourceMetadata,
        sourceInftId: latestInft.id,
        sourceGenerationId: latestGeneration.id,
        sourceTokenId: latestInft.tokenId,
        sourceVideoUrl: latestInft.videoUrl,
        derivedFromAction: actionName,
        samsarActionRequestId: requestId,
        samsarActionSessionId: actionSessionId || requestId
      }
    };
    const derivativeGeneration: Generation = {
      id: derivativeGenerationId,
      customerId: latestGeneration.customerId,
      subAccountId: latestGeneration.subAccountId,
      referrerCode: latestGeneration.referrerCode,
      status: "COMPLETED",
      input: derivativeInput,
      payment: buildDerivativeActionPayment(latestGeneration.payment, customer, actionName),
      samsarRequestId: requestId,
      samsarSessionId: actionSessionId || requestId,
      resultUrl,
      inftId: derivativeGenerationId,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    const attributes = [
      ...buildINFTAttributes(derivativeGeneration, customer, subAccount),
      { trait_type: "source_inft_id", value: latestInft.id },
      { trait_type: "source_generation_id", value: latestGeneration.id },
      { trait_type: "video_action", value: actionName }
    ] satisfies INFTAttribute[];
    const metadata = {
      name: metadataTitle,
      description: latestInft.description || String(derivativeGeneration.input.prompt || "Generated marketing video"),
      animation_url: resultUrl,
      external_url: `${appBaseUrl()}/inft/${derivativeGenerationId}`,
      image: firstImageUrl(derivativeGeneration.input),
      attributes,
      superreferrals: {
        generationId: derivativeGenerationId,
        customerId: customer.id,
        subAccountId: subAccount.id,
        title: metadataTitle,
        samsarRequestId: requestId,
        samsarSessionId: actionSessionId || requestId,
        sourceInftId: latestInft.id,
        sourceGenerationId: latestGeneration.id,
        sourceTokenId: latestInft.tokenId,
        action: actionName,
        referrerCode: subAccount.referrerCode,
        referrerUrl: `${customer.referrerBaseUrl}/r/${subAccount.referrerCode}`,
        ownerWallet: subAccount.wallet,
        userProfile: subAccount.blockchainRegistration,
        metadata: derivativeInput.metadata || {}
      },
      storage: {
        video: videoArtifact
      }
    };
    const metadataArtifact = await persistJsonToZeroG(metadata);
    const tokenMetadataUri =
      buildZeroGStorageGatewayUrl(metadataArtifact.rootHash) ||
      metadataArtifact.uri;
    const agentWallet = deriveAgentWallet(derivativeGenerationId);
    const ownerWallet = normalizeWallet(subAccount.wallet) as `0x${string}`;
    const mint = await mintINFT({
      ownerWallet,
      metadataUri: tokenMetadataUri,
      metadataHash: bytes32From(JSON.stringify(metadata)),
      agentWallet,
      referrerCode: subAccount.referrerCode
    });
    const derivativeInft: INFTRecord = {
      id: derivativeGenerationId,
      generationId: derivativeGenerationId,
      customerId: customer.id,
      subAccountId: subAccount.id,
      ownerWallet,
      title: metadataTitle,
      description: latestInft.description || String(derivativeGeneration.input.prompt || "Generated marketing video"),
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
    const derivativeGenerationWithStorage: Generation = {
      ...derivativeGeneration,
      storage: {
        video: videoArtifact,
        metadata: metadataArtifact
      }
    };
    const saved = await mutateStore((mutableStore) => {
      const savedGeneration = addGeneration(mutableStore, derivativeGenerationWithStorage);
      const savedInft = addINFT(mutableStore, derivativeInft);
      return {
        generation: savedGeneration,
        inft: savedInft
      };
    });

    return {
      mode: "created_derivative_inft",
      action: actionName,
      chainTxHash: mint.txHash,
      inft: saved.inft,
      generation: saved.generation
    };
  });
}

function generationMatchesActionRequest(generation: Generation, requestId: string, normalizedRequestId: string) {
  return [generation.samsarRequestId, generation.samsarSessionId].some((value) => {
    if (!value) {
      return false;
    }
    return value === requestId || Boolean(normalizedRequestId && normalizeSamsarVideoSessionId(value) === normalizedRequestId);
  });
}

function buildDerivativeINFTTitle(inft: INFTRecord, action: string) {
  const suffix = formatActionTitle(action);
  return `${inft.title || "SuperReferrals Video"} - ${suffix}`;
}

function formatActionTitle(action: string) {
  return action
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function buildDerivativeActionPayment(
  sourcePayment: GenerationPayment,
  customer: Customer,
  action: string
): GenerationPayment {
  const paidAction = normalizeINFTPaidAction(action);
  const actionAmountUsd = paidAction
    ? customer.pricing.inftActionPricesUsd?.[paidAction] ?? defaultINFTActionPricesUsd[paidAction]
    : undefined;
  return {
    ...sourcePayment,
    amountUsd: Number.isFinite(actionAmountUsd) && Number(actionAmountUsd) > 0
      ? Number(actionAmountUsd)
      : sourcePayment.amountUsd,
    status: sourcePayment.status === "mock_confirmed" ? "mock_confirmed" : "confirmed"
  };
}

function paymentPayloadFromINFTAction(payload: Record<string, unknown>) {
  return isRecord(payload.payment) ? payload.payment : payload;
}

async function runPaidINFTSamsarAction({
  inft,
  customer,
  action,
  actionInput,
  paymentPayload
}: {
  inft: INFTRecord;
  customer: Customer;
  action: INFTPaidAction;
  actionInput: Record<string, unknown>;
  paymentPayload: Record<string, unknown>;
}) {
  const payment = await confirmINFTActionPayment({
    inft,
    customer,
    action,
    paymentPayload
  });
  if (payment.status === "pending") {
    return {
      status: "PAYMENT_PENDING",
      action,
      payment
    };
  }

  assertPaidRenderProviderCanFulfill(payment.status);
  const samsarSession = await ensureCustomerSamsarActionSession(customer);
  const result = await runSamsarSessionAction(action, actionInput, {
    appKey: samsarSession.appKey,
    appSecret: samsarSession.appSecret,
    idempotencyKey: `superreferrals:${inft.id}:${action}:${payment.quoteId || payment.txHash || "paid"}`
  });
  const remainingCredits = actionCreditsRemaining(result);
  if (remainingCredits !== null) {
    await updateCustomerSamsarCreditBalance(customer.id, remainingCredits);
  }
  return {
    ...result,
    action,
    payment
  };
}

async function confirmINFTActionPayment({
  inft,
  customer,
  action,
  paymentPayload
}: {
  inft: INFTRecord;
  customer: Customer;
  action: INFTPaidAction;
  paymentPayload: Record<string, unknown>;
}) {
  const store = await readStore();
  const quoteId = firstString(paymentPayload, ["quoteId", "quote_id"]);
  const quote = quoteId ? store.quotes.find((item) => item.id === quoteId) : undefined;
  if (!quote) {
    throw new Error("Create and pay an INFT action quote before running this operation.");
  }
  if (quote.customerId !== customer.id || quote.inftId !== inft.id || quote.operation !== action) {
    throw new Error("Payment quote does not match this INFT operation.");
  }
  const paymentChainId = normalizeTransactionChainIdForEnvironment(customer.pricing.chainId || quote.chainId || getTransactionChainId());
  const expectedSettlementToken =
    findPaymentToken(quote.settlementTokenAddress || customer.pricing.settlementTokenAddress || "", paymentChainId) ||
    settlementTokenForCurrency(quote.settlementCurrency || customer.pricing.currency, paymentChainId);
  if (!expectedSettlementToken) {
    throw new Error("Unable to resolve INFT action settlement token for payment verification");
  }
  const expectedPaymentToken =
    findPaymentToken(quote.paymentTokenAddress || firstString(paymentPayload, ["tokenAddress", "token_address"]) || "", paymentChainId) ||
    expectedSettlementToken;
  const expectedPaymentAmountAtomic = quote.paymentAmountAtomic ||
    quote.settlementAmountAtomic ||
    amountToAtomic(quote.totalUsd, expectedPaymentToken.decimals);
  const expectedPaymentRecipient = assertUsableEvmAddress(
    quote.paymentRecipientAddress || resolveRenderPaymentRecipientWallet(customer),
    "Payment recipient wallet"
  );
  const payerWallet = assertUsableEvmAddress(
    firstString(paymentPayload, ["payerWallet", "payer_wallet"]) || inft.ownerWallet,
    "Action payer wallet"
  );
  const paymentRail = (firstString(paymentPayload, ["paymentRail", "payment_rail"]) || quote.paymentRail || "keeperhub") as GenerationPayment["paymentRail"];
  const paymentConfirmation = await resolvePaymentConfirmation({
    paymentRail,
    txHash: firstString(paymentPayload, ["txHash", "tx_hash"]),
    route: quote.route,
    expectedPayment: {
      chainId: paymentChainId,
      payerWallet,
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
      payerAddress: payerWallet,
      recipientAddress: resolveRenderPaymentRecipientWallet(customer),
      amount: quote.totalUsd.toFixed(2),
      amountUsd: quote.totalUsd,
      paymentAmountAtomic: expectedPaymentAmountAtomic,
      paymentRecipientAddress: expectedPaymentRecipient,
      paymentTxHash: paymentConfirmation.txHash,
      tokenAddress: expectedPaymentToken.address,
      settlementTokenAddress: expectedSettlementToken.address,
      settlementAmountAtomic: quote.settlementAmountAtomic || amountToAtomic(quote.totalUsd, expectedSettlementToken.decimals),
      chainId: paymentChainId,
      quoteId: quote.id,
      generationId: inft.generationId,
      reason: `Settle SuperReferrals INFT ${action.replaceAll("_", " ")} action`,
      metadata: {
        verification: paymentConfirmation.verification,
        customerId: customer.id,
        subAccountId: inft.subAccountId,
        inftId: inft.id,
        action
      }
    })
    : undefined;
  const keeperExecutionId = paymentConfirmation.keeperExecutionId ||
    firstString(isRecord(keeperSettlement) ? keeperSettlement : undefined, ["executionId", "execution_id", "id", "runId"]);
  return {
    amountUsd: quote.totalUsd,
    payerWallet,
    txHash: firstString(paymentPayload, ["txHash", "tx_hash"]) || paymentConfirmation.txHash,
    quoteId: quote.id,
    tokenAddress: expectedPaymentToken.address,
    tokenSymbol: quote.paymentCurrency || expectedPaymentToken.symbol,
    paymentAmountAtomic: expectedPaymentAmountAtomic,
    settlementTokenAddress: expectedSettlementToken.address,
    settlementTokenSymbol: quote.settlementCurrency || customer.pricing.currency || expectedSettlementToken.symbol,
    settlementAmountAtomic: quote.settlementAmountAtomic || amountToAtomic(quote.totalUsd, expectedSettlementToken.decimals),
    paymentRail,
    chainId: paymentChainId,
    status: paymentConfirmation.status,
    keeperExecutionId,
    route: keeperSettlement
      ? {
        ...(isRecord(quote.route) ? quote.route : { route: quote.route }),
        keeperSettlement
      }
      : quote.route,
    verification: paymentConfirmation.verification
  } satisfies GenerationPayment;
}

async function ensureCustomerSamsarActionSession(customer: Customer): Promise<{
  appKey?: string;
  appSecret?: string;
}> {
  return ensureCustomerSamsarAppCredentials(customer);
}

async function updateCustomerSamsarCreditBalance(customerId: string, creditsRemaining: number) {
  return mutateStore((mutableStore) => {
    const current = mutableStore.customers.find((item) => item.id === customerId);
    if (!current) {
      return null;
    }
    current.subscription = {
      ...(current.subscription || { status: "not_started" }),
      status: creditsRemaining > 0 ? "active" : "not_started",
      creditsRemaining
    };
    current.samsarAccount = {
      ...(current.samsarAccount || {}),
      updatedAt: nowIso()
    };
    current.updatedAt = nowIso();
    return current;
  });
}

function actionCreditsRemaining(result: Record<string, unknown>) {
  return firstNumber(result, ["remainingCredits", "remaining_credits", "creditsRemaining"]);
}

function resolveGenerationVideoSessionId(generation: Pick<Generation, "samsarRequestId" | "samsarSessionId">) {
  return firstInternalSamsarSessionId(generation.samsarSessionId, generation.samsarRequestId);
}

function resolveGenerationVideoActionSessionId(generation: Pick<Generation, "samsarRequestId" | "samsarSessionId">) {
  const sessionId = normalizeSamsarActionSessionId(generation.samsarSessionId);
  const requestId = normalizeSamsarActionSessionId(generation.samsarRequestId);
  if (requestId.startsWith("extreq_") && sessionId === normalizeSamsarVideoSessionId(requestId)) {
    return requestId;
  }
  return sessionId || requestId;
}

function resolveINFTTitle(generation: Generation, subAccount: SubAccount) {
  const metadata = isRecord(generation.input.metadata) ? generation.input.metadata : undefined;
  return cleanTitle(firstString(metadata, ["title", "name", "inftTitle", "inft_title"])) ||
    titleFromSlug(firstString(metadata, ["slug", "campaignSlug", "campaign_slug", "referrerSlug", "referrer_slug"])) ||
    titleFromSlug(subAccount.referrerCode) ||
    "SuperReferrals Video";
}

function cleanTitle(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function titleFromSlug(value: string) {
  const slug = value
    .trim()
    .split(/[/?#]/)[0]
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!slug) {
    return "";
  }
  return slug
    .split(" ")
    .map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function normalizeGenerationInput(input: GenerationInput): GenerationInput {
  const hasProvidedOutro = Boolean(input.outro_image_url);
  const generatesOutroFromUrl = !hasProvidedOutro && (input.generate_outro_image === true || Boolean(input.cta_url));
  const addOutroAnimation = input.add_outro_animation ?? generatesOutroFromUrl;
  const addOutroFocusArea = input.add_outro_focus_area ?? generatesOutroFromUrl;
  const addFooterAnimation = !hasProvidedOutro && input.add_footer_animation === true;
  const aspectRatio = input.aspect_ratio || "16:9";
  const normalizedInput: GenerationInput = {
    ...input,
    video_model: input.video_model || "VEO3.1I2V",
    aspect_ratio: aspectRatio,
    enable_subtitles: input.enable_subtitles ?? true,
    outro_image_url: input.outro_image_url,
    add_outro_animation: addOutroAnimation === true,
    add_outro_focus_area: addOutroFocusArea === true,
    outro_focust_area: input.outro_focust_area,
    generate_outro_image: hasProvidedOutro ? false : input.generate_outro_image ?? Boolean(input.cta_url),
    cta_url: hasProvidedOutro ? undefined : input.cta_url,
    cta_text_top: hasProvidedOutro ? undefined : input.cta_text_top,
    cta_text_bottom: hasProvidedOutro ? undefined : input.cta_text_bottom,
    cta_logo: hasProvidedOutro ? undefined : input.cta_logo,
    add_footer_animation: addFooterAnimation,
    footer_metadata: addFooterAnimation ? normalizeFooterMetadata(input.footer_metadata, input.cta_url) : undefined,
    image_urls: normalizeGenerationImageInputs(input.image_urls || [], aspectRatio)
  };
  return normalizedInput;
}

function normalizeFooterMetadata(
  footerMetadata: GenerationInput["footer_metadata"],
  fallbackUrl?: string
): GenerationInput["footer_metadata"] {
  if (Array.isArray(footerMetadata) && footerMetadata.length > 0) {
    return footerMetadata
      .map((item) => ({
        url: String(item?.url || fallbackUrl || "").trim(),
        ...(item?.title ? { title: String(item.title).trim() } : {})
      }))
      .filter((item) => item.url);
  }
  const ctaUrl = String(fallbackUrl || "").trim();
  return ctaUrl ? [{ url: ctaUrl }] : undefined;
}

function normalizeGenerationImageInputs(imageUrls: GenerationInput["image_urls"], aspectRatio: VideoAspectRatio): GenerationInput["image_urls"] {
  return imageUrls.map((item) => {
    if (typeof item === "string") {
      const isSample = isSampleImageUrl(item);
      return {
        image_url: isSample ? buildAspectSizedSampleImageUrl(item, aspectRatio) : item
      };
    }

    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return item;
    }

    const record = item as Record<string, unknown>;
    const imageUrl = getGenerationImageUrl(record);
    const isSample = isSampleImageUrl(imageUrl);
    const normalizedRecord = withoutEnhancementSkipFlags(record);

    return {
      ...normalizedRecord,
      ...(record.image_url && !isSample ? {} : { image_url: isSample ? buildAspectSizedSampleImageUrl(imageUrl, aspectRatio) : imageUrl })
    };
  });
}

function withoutEnhancementSkipFlags(item: Record<string, unknown>) {
  const next = { ...item };
  delete next.skip_enhancement;
  delete next.skipEnhancement;
  delete next.resize_image;
  delete next.resizeImage;
  return next;
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
  if (input.cta_url) {
    assertReachableUrlShape(input.cta_url, "cta_url");
  }
  for (const [index, item] of (input.footer_metadata || []).entries()) {
    if (item?.url) {
      assertReachableUrlShape(item.url, `footer_metadata item ${index + 1}`);
    }
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

function customerSamsarAuthToken(customer: Customer) {
  const authToken = customer.samsarAccount?.authToken?.trim();
  return authToken || undefined;
}

function customerSamsarAppCredentials(customer: Customer) {
  return hasStoredSamsarAppKey(customer) ? samsarAppClientCredentials(customer) : {};
}

async function ensureCustomerSamsarAppCredentials(customer: Customer): Promise<{
  appKey?: string;
  appSecret?: string;
}> {
  if (isProviderMock("SAMSAR")) {
    return {};
  }

  const existingCredentials = customerSamsarAppCredentials(customer);
  if (existingCredentials.appKey) {
    return existingCredentials;
  }

  const provisioned = await provisionSamsarProcessorAppKeyIfMissing(customer, customerSamsarAuthToken(customer));
  if (!provisioned) {
    throw new Error("Connect a Samsar account before running storefront video operations. Storefront operations require a generated APP_KEY and APP_SECRET.");
  }

  const updated = await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
    id: customer.id,
    samsarApiKeyAlias: "samsar-user-app-key",
    samsarAccount: {
      ...(customer.samsarAccount || {}),
      ...provisioned,
      updatedAt: nowIso()
    },
    subscription: customer.subscription
  }));
  const credentials = customerSamsarAppCredentials(updated);
  if (!credentials.appKey || !credentials.appSecret) {
    throw new Error("Stored Samsar APP_KEY could not be loaded for storefront video operations.");
  }
  return credentials;
}

function assertCustomerProcessorReady(customer: Customer) {
  const hasProcessorAccountSession = Boolean(
    customer.samsarAccount?.appKeyHash ||
    customer.samsarAccount?.authToken ||
    customer.samsarAccount?.apiKey
  );
  if (!hasProcessorAccountSession || Number(customer.subscription.creditsRemaining || 0) <= 0) {
    throw new Error("Sign in to a credited SuperReferrals account before using storefront setup.");
  }
}

function resolveRenderPaymentRecipientWallet(customer: Customer) {
  if (isUsableEvmAddress(customer.ownerWallet)) {
    return assertUsableEvmAddress(customer.ownerWallet, "Customer owner wallet");
  }
  const keeperHubWallet = getKeeperHubWalletAddress();
  if (isUsableEvmAddress(keeperHubWallet)) {
    return assertUsableEvmAddress(keeperHubWallet, "KEEPERHUB_WALLET_ADDRESS");
  }
  throw new Error("Payment recipient wallet is not configured. Connect a merchant payout wallet or set KEEPERHUB_WALLET_ADDRESS before accepting render payments.");
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
  const settlementRecipientWallet = resolveRenderPaymentRecipientWallet(customer);
  const paymentHeldByKeeper = normalizeWallet(expectedPaymentRecipient) !== normalizeWallet(settlementRecipientWallet);
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

function firstNumber(record: Record<string, unknown> | undefined, keys: string[]) {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const value = record[key];
    if (value === undefined || value === null || value === "") {
      continue;
    }
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function optionalBooleanField(key: string, ...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "boolean") {
      return { [key]: value };
    }
  }
  return {};
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
    { trait_type: "samsar_request_id", value: generation.samsarRequestId || "" },
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
