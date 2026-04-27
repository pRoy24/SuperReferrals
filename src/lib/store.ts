import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appBaseUrl, env } from "./env";
import { createId, makeReferrerCode, nowIso, normalizeWallet } from "./ids";
import { findPaymentToken, getTransactionChainId, settlementTokenForCurrency } from "./payment-tokens";
import { defaultModelPricingConfigurations, defaultPricing } from "./pricing";
import { normalizeWalletList } from "./storefront-access";
import { isUsableEvmAddress } from "./wallet-address";
import type {
  AgentJob,
  AgentProfile,
  AgentTownEvent,
  Customer,
  CustomerStorefrontConditions,
  Generation,
  INFTRecord,
  PaymentQuote,
  StorefrontRating,
  SubAccount,
  SuperReferralsStore
} from "./types";

const STORE_FILE = "data.json";
const DEFAULT_DATA_DIR = ".superreferrals";
const LEGACY_DEMO_CUSTOMER_ID = "cus_demo";
const LEGACY_DEMO_SUB_ACCOUNT_ID = "sub_demo";
const LEGACY_DEMO_OWNER_WALLET = "0x1111111111111111111111111111111111111111";
let storeMutationQueue: Promise<unknown> = Promise.resolve();

function dataDir() {
  const configured = env("SUPERREFERRALS_DATA_DIR", DEFAULT_DATA_DIR);
  if (isServerlessRuntime() && !isTmpPath(configured)) {
    const tempRelativeDir = path.isAbsolute(configured) ? path.basename(configured) : configured;
    return path.join(os.tmpdir(), tempRelativeDir);
  }
  return path.isAbsolute(configured)
    ? configured
    : path.join(/*turbopackIgnore: true*/ process.cwd(), configured);
}

function dataPath() {
  return path.join(dataDir(), STORE_FILE);
}

function isServerlessRuntime() {
  const cwd = process.cwd();
  return Boolean(
    process.env.VERCEL
    || process.env.VERCEL_ENV
    || process.env.NOW_REGION
    || process.env.AWS_LAMBDA_FUNCTION_NAME
    || process.env.LAMBDA_TASK_ROOT
    || process.env.AWS_EXECUTION_ENV?.includes("AWS_Lambda")
    || cwd === "/var/task"
    || cwd.startsWith("/var/task/")
  );
}

function isTmpPath(filePath: string) {
  const resolved = path.resolve(filePath);
  const tmpDir = path.resolve(os.tmpdir());
  return resolved === tmpDir || resolved.startsWith(`${tmpDir}${path.sep}`);
}

export function emptyStore(): SuperReferralsStore {
  return {
    version: 4,
    customers: [],
    subAccounts: [],
    quotes: [],
    generations: [],
    infts: [],
    storefrontRatings: [],
    feedLikes: [],
    feedComments: [],
    feedViews: [],
    agents: [],
    agentJobs: [],
    agentTownEvents: []
  };
}

export async function readStore(): Promise<SuperReferralsStore> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const raw = await fs.readFile(dataPath(), "utf8");
      const parsed = JSON.parse(raw) as SuperReferralsStore;
      const store = { ...emptyStore(), ...parsed, version: 4 as const };
      const normalized = normalizeStoreForRuntime(store);
      if (normalized.changed) {
        await writeStore(normalized.store);
      }
      return normalized.store;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        const empty = emptyStore();
        await writeStore(empty);
        return empty;
      }
      if (error instanceof SyntaxError && attempt < 4) {
        await delay(25 * (attempt + 1));
        continue;
      }
      if (error instanceof SyntaxError) {
        throw new Error(`Store file ${dataPath()} contains invalid JSON. Stop the dev server and inspect or restore the file before continuing.`);
      }
      throw error;
    }
  }
  throw new Error("Unable to read store");
}

function normalizeStoreForRuntime(store: SuperReferralsStore) {
  const runtimeChainId = getTransactionChainId();
  let changed = false;
  changed = removeLegacyDemoStorefront(store) || changed;
  for (const customer of store.customers) {
    const pricing = customer.pricing || defaultPricing;
    const previousChainId = pricing.chainId;
    const existingToken = findPaymentToken(pricing.settlementTokenAddress || "", runtimeChainId);
    const settlementToken = existingToken || settlementTokenForCurrency(pricing.currency || "USDC", runtimeChainId);
    if (previousChainId !== runtimeChainId) {
      pricing.chainId = runtimeChainId;
      changed = true;
    }
    if (settlementToken && pricing.settlementTokenAddress !== settlementToken.address) {
      pricing.settlementTokenAddress = settlementToken.address;
      changed = true;
    }
    if (!customer.pricing) {
      customer.pricing = pricing;
      changed = true;
    }
    const hasSamsarSession = Boolean(
      customer.samsarAccount?.authToken ||
      customer.samsarAccount?.apiKey ||
      (customer.samsarAccount?.externalUserId && env("SAMSAR_API_KEY"))
    );
    if (!hasSamsarSession && Number(customer.subscription?.creditsRemaining || 0) > 0) {
      customer.subscription = {
        ...(customer.subscription || { status: "not_started" }),
        status: "not_started",
        creditsRemaining: 0
      };
      changed = true;
    }
  }
  return { store, changed };
}

function removeLegacyDemoStorefront(store: SuperReferralsStore) {
  const demoCustomer = store.customers.find(isLegacyDemoCustomer);
  if (!demoCustomer) {
    return false;
  }
  const demoSubAccountIds = new Set(
    store.subAccounts
      .filter((account) => account.customerId === demoCustomer.id || account.id === LEGACY_DEMO_SUB_ACCOUNT_ID)
      .map((account) => account.id)
  );
  const demoGenerationIds = new Set(
    store.generations
      .filter((generation) => generation.customerId === demoCustomer.id || demoSubAccountIds.has(generation.subAccountId))
      .map((generation) => generation.id)
  );
  const demoInftIds = new Set(
    store.infts
      .filter((inft) =>
        inft.customerId === demoCustomer.id ||
        demoSubAccountIds.has(inft.subAccountId) ||
        demoGenerationIds.has(inft.generationId)
      )
      .map((inft) => inft.id)
  );

  store.customers = store.customers.filter((customer) => customer.id !== demoCustomer.id);
  store.subAccounts = store.subAccounts.filter((account) => account.customerId !== demoCustomer.id && account.id !== LEGACY_DEMO_SUB_ACCOUNT_ID);
  store.quotes = store.quotes.filter((quote) => quote.customerId !== demoCustomer.id && !demoSubAccountIds.has(quote.subAccountId || ""));
  store.generations = store.generations.filter((generation) => !demoGenerationIds.has(generation.id));
  store.infts = store.infts.filter((inft) => !demoInftIds.has(inft.id));
  store.storefrontRatings = store.storefrontRatings.filter((rating) =>
    rating.customerId !== demoCustomer.id &&
    !demoSubAccountIds.has(rating.subAccountId || "") &&
    !demoGenerationIds.has(rating.generationId || "") &&
    !demoInftIds.has(rating.inftId || "")
  );
  store.feedLikes = store.feedLikes.filter((like) => !demoGenerationIds.has(like.generationId));
  store.feedComments = store.feedComments.filter((comment) => !demoGenerationIds.has(comment.generationId));
  store.feedViews = store.feedViews.filter((view) => !demoGenerationIds.has(view.generationId));
  store.agents = store.agents.filter((agent) => agent.customerId !== demoCustomer.id);
  store.agentJobs = store.agentJobs.filter((job) =>
    job.customerId !== demoCustomer.id &&
    !demoSubAccountIds.has(job.subAccountId || "") &&
    !demoGenerationIds.has(job.generationId || "") &&
    !demoInftIds.has(job.inftId || "")
  );
  return true;
}

function isLegacyDemoCustomer(customer: Customer) {
  return (
    customer.id === LEGACY_DEMO_CUSTOMER_ID &&
    normalizeWallet(customer.ownerWallet) === normalizeWallet(LEGACY_DEMO_OWNER_WALLET)
  );
}

export async function writeStore(store: SuperReferralsStore) {
  const dir = dataDir();
  await fs.mkdir(dir, { recursive: true });
  const targetPath = dataPath();
  const tempPath = path.join(dir, `.${STORE_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, targetPath);
}

export async function mutateStore<T>(mutator: (store: SuperReferralsStore) => T | Promise<T>) {
  const run = storeMutationQueue.then(async () => {
    const store = await readStore();
    const result = await mutator(store);
    await writeStore(store);
    return result;
  });
  storeMutationQueue = run.catch(() => undefined);
  return run;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getCustomer(id?: string) {
  const store = await readStore();
  return id ? store.customers.find((customer) => customer.id === id) : store.customers[0];
}

export async function getSubAccount(id?: string) {
  const store = await readStore();
  return id ? store.subAccounts.find((account) => account.id === id) : store.subAccounts[0];
}

export async function getGeneration(id: string) {
  const store = await readStore();
  return store.generations.find((generation) => generation.id === id);
}

export async function getINFT(id: string) {
  const store = await readStore();
  return store.infts.find((inft) => inft.id === id);
}

export function publicStore(store: SuperReferralsStore): SuperReferralsStore {
  return {
    ...store,
    customers: store.customers.map(publicCustomer),
    subAccounts: store.subAccounts.map(publicSubAccount)
  };
}

export function publicCustomer(customer: Customer): Customer {
  const hasInternalApiKeySession = Boolean(customer.samsarAccount?.externalUserId && env("SAMSAR_API_KEY"));
  const samsarAccount = customer.samsarAccount
    ? {
      email: customer.samsarAccount.email,
      username: customer.samsarAccount.username,
      userId: customer.samsarAccount.userId,
      hasSession: Boolean(customer.samsarAccount.authToken || customer.samsarAccount.apiKey || hasInternalApiKeySession),
      hasApiKey: Boolean(customer.samsarAccount.apiKey || hasInternalApiKeySession),
      externalProvider: customer.samsarAccount.externalProvider,
      externalUserId: customer.samsarAccount.externalUserId,
      walletAddress: customer.samsarAccount.walletAddress,
      checkoutSessionId: customer.samsarAccount.checkoutSessionId,
      checkoutUrl: customer.samsarAccount.checkoutUrl,
      paymentStatusEndpoint: customer.samsarAccount.paymentStatusEndpoint,
      externalPaymentId: customer.samsarAccount.externalPaymentId,
      loginUrl: customer.samsarAccount.loginUrl,
      passwordSetupUrl: customer.samsarAccount.passwordSetupUrl,
      updatedAt: customer.samsarAccount.updatedAt
    }
    : undefined;
  return {
    ...customer,
    samsarAccount
  };
}

export function publicSubAccount(account: SubAccount): SubAccount {
  return {
    ...account,
    externalApiKey: undefined
  };
}

export function isPublicStorefrontCustomer(customer: Customer) {
  const hasAccountSession = Boolean(
    customer.samsarAccount?.authToken ||
    customer.samsarAccount?.apiKey ||
    (customer.samsarAccount?.externalUserId && env("SAMSAR_API_KEY"))
  );
  return Boolean(customer.storefront) &&
    hasAccountSession &&
    Number(customer.subscription.creditsRemaining || 0) > 0 &&
    isUsableEvmAddress(customer.ownerWallet);
}

export function upsertCustomer(store: SuperReferralsStore, input: Partial<Customer>) {
  const timestamp = nowIso();
  const id = input.id || createId("cus");
  const existing = store.customers.find((customer) => customer.id === id);
  const next: Customer = {
    id,
    name: input.name?.trim() || existing?.name || "Customer",
    ownerWallet: normalizeWallet(input.ownerWallet || existing?.ownerWallet),
    samsarApiKeyAlias: input.samsarApiKeyAlias || existing?.samsarApiKeyAlias,
    samsarAccount: {
      ...(existing?.samsarAccount || {}),
      ...(input.samsarAccount || {})
    },
    pricing: {
      ...(existing?.pricing || defaultPricing),
      ...(input.pricing || {}),
      modelConfigurations: input.pricing?.modelConfigurations ||
        existing?.pricing.modelConfigurations ||
        defaultModelPricingConfigurations
    },
    referrerBaseUrl: (input.referrerBaseUrl || existing?.referrerBaseUrl || appBaseUrl()).replace(/\/$/, ""),
    ensName: input.ensName ?? existing?.ensName,
    storefront: normalizeStorefrontDetails(input.storefront, existing?.storefront),
    subscription: {
      status: input.subscription?.status || existing?.subscription.status || "not_started",
      streamId: input.subscription?.streamId || existing?.subscription.streamId,
      creditsRemaining: input.subscription?.creditsRemaining ?? existing?.subscription.creditsRemaining ?? 0
    },
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  if (!next.samsarAccount || Object.values(next.samsarAccount).every((value) => value === undefined || value === "")) {
    next.samsarAccount = undefined;
  }
  if (existing) {
    Object.assign(existing, next);
    return existing;
  }
  store.customers.unshift(next);
  return next;
}

export function addSubAccount(store: SuperReferralsStore, input: {
  customerId: string;
  wallet: string;
  email?: string;
  username?: string;
  externalApiKey?: string;
}) {
  const timestamp = nowIso();
  const id = createId("sub");
  const username = input.username?.trim() || input.email?.split("@")[0] || id;
  const referrerCode = makeReferrerCode(`${input.customerId}:${id}:${input.wallet}`);
  const account: SubAccount = {
    id,
    customerId: input.customerId,
    wallet: normalizeWallet(input.wallet),
    email: input.email?.trim() || undefined,
    username,
    referrerCode,
    externalUser: {
      provider: "superreferrals",
      external_user_id: id,
      external_app_id: input.customerId,
      external_company_id: input.customerId,
      external_account_id: input.customerId,
      email: input.email?.trim() || undefined,
      username,
      display_name: username,
      user_type: "storefront_user"
    },
    externalApiKey: input.externalApiKey,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  store.subAccounts.unshift(account);
  return account;
}

export function addQuote(store: SuperReferralsStore, quote: PaymentQuote) {
  store.quotes.unshift(quote);
  return quote;
}

export function addGeneration(store: SuperReferralsStore, generation: Generation) {
  store.generations.unshift(generation);
  return generation;
}

export function updateGeneration(store: SuperReferralsStore, id: string, patch: Partial<Generation>) {
  const generation = store.generations.find((item) => item.id === id);
  if (!generation) {
    return null;
  }
  Object.assign(generation, patch, { updatedAt: nowIso() });
  return generation;
}

export function addINFT(store: SuperReferralsStore, inft: INFTRecord) {
  const existingIndex = store.infts.findIndex((item) =>
    item.id === inft.id || item.generationId === inft.generationId
  );
  if (existingIndex >= 0) {
    store.infts[existingIndex] = {
      ...store.infts[existingIndex],
      ...inft,
      updatedAt: nowIso()
    };
    return store.infts[existingIndex];
  }
  store.infts.unshift(inft);
  return inft;
}

export function upsertStorefrontRating(store: SuperReferralsStore, input: {
  customerId: string;
  subAccountId?: string;
  generationId?: string;
  inftId?: string;
  operation?: string;
  wallet?: string;
  score: number;
  comment?: string;
}) {
  const timestamp = nowIso();
  const normalizedWallet = input.wallet ? normalizeWallet(input.wallet) : undefined;
  const normalizedOperation = input.operation?.trim() || undefined;
  const existing = store.storefrontRatings.find((rating) =>
    rating.customerId === input.customerId &&
    (rating.wallet || "") === (normalizedWallet || "") &&
    (rating.generationId || "") === (input.generationId || "") &&
    (rating.inftId || "") === (input.inftId || "") &&
    (rating.operation || "") === (normalizedOperation || "")
  );
  const next: StorefrontRating = {
    id: existing?.id || createId("rating"),
    customerId: input.customerId,
    subAccountId: input.subAccountId,
    generationId: input.generationId,
    inftId: input.inftId,
    operation: normalizedOperation,
    wallet: normalizedWallet,
    score: input.score,
    comment: input.comment?.trim() || undefined,
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
  if (existing) {
    Object.assign(existing, next);
    return existing;
  }
  store.storefrontRatings.unshift(next);
  return next;
}

export function upsertAgent(store: SuperReferralsStore, agent: AgentProfile) {
  const existing = store.agents.find((item) => item.id === agent.id);
  if (existing) {
    Object.assign(existing, agent);
    return existing;
  }
  store.agents.push(agent);
  return agent;
}

export function addAgentJob(store: SuperReferralsStore, job: AgentJob) {
  store.agentJobs.unshift(job);
  return job;
}

export function updateAgentJob(store: SuperReferralsStore, id: string, patch: Partial<AgentJob>) {
  const job = store.agentJobs.find((item) => item.id === id);
  if (!job) {
    return null;
  }
  Object.assign(job, patch, { updatedAt: nowIso() });
  return job;
}

export function addAgentTownEvent(store: SuperReferralsStore, event: AgentTownEvent) {
  store.agentTownEvents.unshift(event);
  return event;
}

function normalizeStorefrontDetails(
  input?: Customer["storefront"],
  existing?: Customer["storefront"]
): Customer["storefront"] {
  const source = input || existing;
  if (!source) {
    return undefined;
  }
  return {
    description: cleanOptionalString(input?.description ?? existing?.description),
    websiteUrl: cleanOptionalString(input?.websiteUrl ?? existing?.websiteUrl),
    supportEmail: cleanOptionalString(input?.supportEmail ?? existing?.supportEmail),
    category: cleanOptionalString(input?.category ?? existing?.category),
    tags: normalizeStorefrontTags(input?.tags ?? existing?.tags),
    conditions: normalizeStorefrontConditions(input?.conditions, existing?.conditions)
  };
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeStorefrontTags(value: unknown) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item).trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8);
  }
  return undefined;
}

function normalizeStorefrontConditions(
  input?: CustomerStorefrontConditions,
  existing?: CustomerStorefrontConditions
): CustomerStorefrontConditions | undefined {
  const source = input || existing;
  if (!source) {
    return undefined;
  }
  const enabled = input?.enabled ?? existing?.enabled ?? false;
  return {
    enabled,
    allowedModels: normalizeEnumList(input?.allowedModels ?? existing?.allowedModels, ["VEO3.1I2V", "SEEDANCEI2V", "KLING3.0", "RUNWAYML"]),
    allowedAspectRatios: normalizeEnumList(input?.allowedAspectRatios ?? existing?.allowedAspectRatios, ["16:9", "9:16"]),
    maxImages: normalizePositiveInteger(input?.maxImages ?? existing?.maxImages),
    dailyWalletRenderLimit: normalizePositiveInteger(input?.dailyWalletRenderLimit ?? existing?.dailyWalletRenderLimit),
    walletAccessMode: normalizeWalletAccessMode(input?.walletAccessMode ?? existing?.walletAccessMode),
    walletWhitelist: normalizeWalletList(input?.walletWhitelist ?? existing?.walletWhitelist)
  };
}

function normalizeEnumList<T extends string>(value: unknown, allowed: T[]) {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const allowedSet = new Set<string>(allowed);
  const normalized = value
    .map((item) => String(item).trim())
    .filter((item): item is T => allowedSet.has(item));
  return Array.from(new Set(normalized));
}

function normalizePositiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;
}

function normalizeWalletAccessMode(value: unknown) {
  return value === "whitelist" ? "whitelist" : "open";
}
