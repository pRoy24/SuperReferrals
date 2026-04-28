import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appBaseUrl, env } from "./env";
import { createId, makeReferrerCode, nowIso, normalizeWallet } from "./ids";
import { recoverINFTFromChain } from "./inft";
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
  SubAccountPreferences,
  SuperReferralsStore
} from "./types";

const STORE_FILE = "data.json";
const DEFAULT_DATA_DIR = ".superreferrals";
const DEFAULT_REDIS_STORE_KEY_PREFIX = "superreferrals:store";
const DEFAULT_REDIS_LOCK_TTL_MS = 15_000;
const DEFAULT_REDIS_LOCK_RETRIES = 40;
const REDIS_LOCK_RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const LEGACY_DEMO_CUSTOMER_ID = "cus_demo";
const LEGACY_DEMO_SUB_ACCOUNT_ID = "sub_demo";
const LEGACY_DEMO_OWNER_WALLET = "0x1111111111111111111111111111111111111111";

type RedisRestConfig = {
  url: string;
  token: string;
};

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

function requireRedisRestConfig(): RedisRestConfig {
  const url = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
  const token = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) {
    throw new Error([
      "SuperReferrals requires a durable Redis KV store.",
      "Run `npm run deploy:setup:staging` or `npm run deploy:setup:production` to create/link Upstash Redis, then redeploy or pull Vercel env locally.",
      "Required runtime env vars: KV_REST_API_URL and KV_REST_API_TOKEN."
    ].join(" "));
  }
  return {
    url: url.replace(/\/+$/, ""),
    token
  };
}

function redisStoreKey() {
  const explicit = env("SUPERREFERRALS_REDIS_STORE_KEY");
  if (explicit) {
    return explicit;
  }
  const prefix = env("SUPERREFERRALS_REDIS_KEY_PREFIX", DEFAULT_REDIS_STORE_KEY_PREFIX).replace(/:+$/, "");
  return `${prefix}:${storeEnvironmentSlug()}`;
}

function redisStoreLockKey() {
  return `${redisStoreKey()}:lock`;
}

function storeEnvironmentSlug() {
  const raw = env("DEPLOYMENT_ENV") || env("VERCEL_ENV") || process.env.NODE_ENV || "local";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "local";
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
  return readRedisStore();
}

async function readLegacyFileStoreForRedisSeed(): Promise<SuperReferralsStore | undefined> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const raw = await fs.readFile(dataPath(), "utf8");
      const parsed = JSON.parse(raw) as SuperReferralsStore;
      const store = { ...emptyStore(), ...parsed, version: 4 as const };
      const normalized = normalizeStoreForRuntime(store);
      return normalized.store;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return undefined;
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
  throw new Error("Unable to read legacy file store");
}

async function readRedisStore(): Promise<SuperReferralsStore> {
  const store = await readRedisStoreDocument();
  const normalized = normalizeStoreForRuntime(store);
  if (normalized.changed) {
    await writeRedisStoreDocument(normalized.store);
  }
  return normalized.store;
}

async function readRedisStoreDocument(): Promise<SuperReferralsStore> {
  const key = redisStoreKey();
  const raw = await redisCommand<unknown>(["GET", key]);
  if (raw === null || raw === undefined) {
    return initializeRedisStoreDocument();
  }
  return parseStoreDocument(raw, `Redis key ${key}`);
}

async function initializeRedisStoreDocument(): Promise<SuperReferralsStore> {
  const key = redisStoreKey();
  const initial = await readLegacyFileStoreForRedisSeed() || emptyStore();
  await redisCommand<string | null>(["SET", key, JSON.stringify(initial), "NX"]);
  const current = await redisCommand<unknown>(["GET", key]);
  if (current === null || current === undefined) {
    return initial;
  }
  return parseStoreDocument(current, `Redis key ${key}`);
}

function parseStoreDocument(raw: unknown, source: string): SuperReferralsStore {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("Store document is not a JSON object");
    }
    return { ...emptyStore(), ...(parsed as Partial<SuperReferralsStore>), version: 4 as const };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`${source} contains invalid JSON. Restore the key before continuing.`);
    }
    throw error;
  }
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
  await writeRedisStoreDocument(store);
}

async function writeRedisStoreDocument(store: SuperReferralsStore) {
  await redisCommand<string>(["SET", redisStoreKey(), JSON.stringify(store)]);
}

export async function mutateStore<T>(mutator: (store: SuperReferralsStore) => T | Promise<T>) {
  return mutateRedisStore(mutator);
}

async function mutateRedisStore<T>(mutator: (store: SuperReferralsStore) => T | Promise<T>) {
  return withRedisStoreLock(async () => {
    const store = await readRedisStoreDocument();
    const normalized = normalizeStoreForRuntime(store).store;
    const result = await mutator(normalized);
    await writeRedisStoreDocument(normalized);
    return result;
  });
}

async function withRedisStoreLock<T>(operation: () => Promise<T>) {
  const lockKey = redisStoreLockKey();
  const token = createId("lock");
  const ttlMs = parsePositiveIntegerEnv("SUPERREFERRALS_REDIS_LOCK_TTL_MS", DEFAULT_REDIS_LOCK_TTL_MS);
  const retries = parsePositiveIntegerEnv("SUPERREFERRALS_REDIS_LOCK_RETRIES", DEFAULT_REDIS_LOCK_RETRIES);
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const acquired = await redisCommand<string | null>(["SET", lockKey, token, "NX", "PX", String(ttlMs)]);
    if (String(acquired || "").toUpperCase() === "OK") {
      try {
        return await operation();
      } finally {
        await redisCommand<number>(["EVAL", REDIS_LOCK_RELEASE_SCRIPT, "1", lockKey, token]).catch(() => undefined);
      }
    }
    await delay(Math.min(1000, 50 + attempt * 25));
  }
  throw new Error(`Timed out waiting for Redis store lock ${lockKey}`);
}

async function redisCommand<T>(command: Array<string | number>) {
  const config = requireRedisRestConfig();
  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(command),
    cache: "no-store"
  });
  const bodyText = await response.text();
  let body: unknown = {};
  if (bodyText) {
    try {
      body = JSON.parse(bodyText);
    } catch {
      body = { error: bodyText };
    }
  }
  const error = extractRedisError(body);
  if (!response.ok || error) {
    throw new Error(error || `Redis command failed with status ${response.status}`);
  }
  if (body && typeof body === "object" && "result" in body) {
    return (body as { result: T }).result;
  }
  return body as T;
}

function extractRedisError(body: unknown) {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return "";
  }
  const value = (body as { error?: unknown }).error;
  return value ? String(value) : "";
}

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
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
  const existing = store.infts.find((inft) => inft.id === id || inft.generationId === id || inft.tokenId === id);
  if (existing) {
    return existing;
  }
  const recovered = await recoverINFTFromChain(id).catch(() => undefined);
  if (!recovered) {
    return undefined;
  }
  await mutateStore((mutableStore) => addINFT(mutableStore, recovered)).catch(() => undefined);
  return recovered;
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
  return Boolean(customer.storefront) &&
    isUsableEvmAddress(customer.ownerWallet);
}

export function upsertCustomer(store: SuperReferralsStore, input: Partial<Customer>) {
  const timestamp = nowIso();
  const id = input.id || createId("cus");
  const existing = store.customers.find((customer) => customer.id === id);
  const ownerWallet = firstUsableWallet(
    input.ownerWallet,
    existing?.ownerWallet,
    input.samsarAccount?.walletAddress,
    existing?.samsarAccount?.walletAddress
  );
  const next: Customer = {
    id,
    name: input.name?.trim() || existing?.name || "Customer",
    ownerWallet: normalizeWallet(ownerWallet),
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

export function updateSubAccountPreferences(store: SuperReferralsStore, input: {
  id?: string;
  customerId?: string;
  wallet?: string;
  preferences: Partial<SubAccountPreferences>;
}) {
  const normalizedWallet = input.wallet ? normalizeWallet(input.wallet) : "";
  const account = store.subAccounts.find((item) =>
    input.id
      ? item.id === input.id
      : Boolean(input.customerId && normalizedWallet && item.customerId === input.customerId && normalizeWallet(item.wallet) === normalizedWallet)
  );
  if (!account) {
    return null;
  }
  account.preferences = normalizeSubAccountPreferences(input.preferences, account.preferences);
  account.updatedAt = nowIso();
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

function normalizeSubAccountPreferences(
  input: Partial<SubAccountPreferences>,
  existing?: SubAccountPreferences
): SubAccountPreferences {
  const renderForm = input.renderForm && typeof input.renderForm === "object" && !Array.isArray(input.renderForm)
    ? input.renderForm
    : existing?.renderForm;
  const renderFormMode = input.renderFormMode === "simple" || input.renderFormMode === "advanced"
    ? input.renderFormMode
    : existing?.renderFormMode;
  return {
    renderForm,
    renderFormMode,
    updatedAt: nowIso()
  };
}

function firstUsableWallet(...values: Array<string | undefined | null>) {
  return values.find((value) => isUsableEvmAddress(value));
}
