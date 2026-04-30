import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appBaseUrl, env } from "./env";
import { createId, makeReferrerCode, nowIso, normalizeWallet } from "./ids";
import { isINFTTokenMissing, recoverINFTFromChain } from "./inft";
import { normalizeAppLanguage } from "./localization";
import {
  findPaymentToken,
  getTransactionChainId,
  normalizePaymentCurrencySymbol,
  settlementTokenForCurrency
} from "./payment-tokens";
import { defaultINFTActionPricesUsd, defaultModelPricingConfigurations, defaultPricing } from "./pricing";
import {
  DEFAULT_RENDITION_LANGUAGE_CODE,
  resolveRenditionLanguageCode
} from "./rendition-language";
import {
  extractSamsarVideoSessionIdFromUrl,
  normalizeSamsarVideoSessionId
} from "./samsar";
import { normalizeWalletList } from "./storefront-access";
import { isUsableEvmAddress } from "./wallet-address";
import type {
  AgentJob,
  AgentProfile,
  AgentTownEvent,
  Customer,
  CustomerPreferences,
  CustomerStorefrontConditions,
  DeletedVideoReference,
  Generation,
  INFTRecord,
  PaymentQuote,
  SamsarVideoRenderMetadata,
  StorefrontRating,
  SubAccount,
  SubAccountPreferences,
  SuperReferralsStore
} from "./types";

const STORE_FILE = "data.json";
const LOCAL_KV_FILE = "kv.json";
const DEFAULT_DATA_DIR = ".superreferrals";
const DEFAULT_REDIS_STORE_KEY_PREFIX = "superreferrals:store";
const DEFAULT_REDIS_LOCK_TTL_MS = 15_000;
const DEFAULT_REDIS_LOCK_RETRIES = 40;
const DEFAULT_SCOPED_LOCK_TTL_MS = 600_000;
const DEFAULT_SCOPED_LOCK_RETRIES = 120;
const REDIS_LOCK_RELEASE_SCRIPT = "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";
const LEGACY_DEMO_CUSTOMER_ID = "cus_demo";
const LEGACY_DEMO_SUB_ACCOUNT_ID = "sub_demo";
const LEGACY_DEMO_OWNER_WALLET = "0x1111111111111111111111111111111111111111";

type CustomerUpsertInput = Partial<Omit<Customer, "preferences">> & {
  preferences?: Partial<CustomerPreferences>;
};
type RedisRestConfig = {
  url: string;
  token: string;
};

type StoreBackendMode = "auto" | "redis" | "file";
type StoreBackend = "redis" | "file";
type LocalKvEntry = {
  value: unknown;
  expiresAt?: number;
};
type LocalKvDocument = Record<string, LocalKvEntry>;
const localLocks = ((globalThis as typeof globalThis & {
  __superReferralsStoreScopedLocks?: Map<string, Promise<void>>;
}).__superReferralsStoreScopedLocks ??= new Map<string, Promise<void>>());

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

function localKvPath() {
  return path.join(dataDir(), LOCAL_KV_FILE);
}

function requireRedisRestConfig(): RedisRestConfig {
  const config = optionalRedisRestConfig();
  if (!config) {
    throw missingRedisConfigError();
  }
  return config;
}

function optionalRedisRestConfig(): RedisRestConfig | undefined {
  const url = env("KV_REST_API_URL") || env("UPSTASH_REDIS_REST_URL");
  const token = env("KV_REST_API_TOKEN") || env("UPSTASH_REDIS_REST_TOKEN");
  if (!url || !token) {
    return undefined;
  }
  return {
    url: url.replace(/\/+$/, ""),
    token
  };
}

function missingRedisConfigError() {
  return new Error([
    "SuperReferrals needs durable Redis KV in deployed/serverless runtimes.",
    "`./deploy.sh` configures the Vercel Upstash Redis integration by default, or run `npm run deploy:setup:staging` / `npm run deploy:setup:production` directly.",
    "Vercel should inject KV_REST_API_URL and KV_REST_API_TOKEN after the integration is linked; set those env vars manually only when overriding the managed Redis resource."
  ].join(" "));
}

function configuredStoreBackend(): StoreBackendMode {
  const value = env("SUPERREFERRALS_STORE_BACKEND", "auto").toLowerCase();
  if (value === "auto" || value === "redis" || value === "file") {
    return value;
  }
  throw new Error("SUPERREFERRALS_STORE_BACKEND must be one of: auto, redis, file.");
}

function storeBackend(): StoreBackend {
  const mode = configuredStoreBackend();
  if (mode === "redis") {
    requireRedisRestConfig();
    return "redis";
  }
  if (mode === "file") {
    ensureLocalFileStoreAllowed();
    return "file";
  }
  if (optionalRedisRestConfig()) {
    return "redis";
  }
  if (!isServerlessRuntime()) {
    return "file";
  }
  throw missingRedisConfigError();
}

function shouldUseLocalKvFallback() {
  const mode = configuredStoreBackend();
  if (mode === "redis") {
    return false;
  }
  if (mode === "file") {
    ensureLocalFileStoreAllowed();
    return true;
  }
  return !optionalRedisRestConfig() && !isServerlessRuntime();
}

function ensureLocalFileStoreAllowed() {
  if (!isServerlessRuntime()) {
    return;
  }
  throw new Error([
    "SUPERREFERRALS_STORE_BACKEND=file is only supported for local development.",
    "Use the default deploy bootstrap to link Vercel Upstash Redis before deploying, or provide KV_REST_API_URL and KV_REST_API_TOKEN."
  ].join(" "));
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
    deletedVideoReferences: [],
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
  return storeBackend() === "redis" ? readRedisStore() : readFileStore();
}

async function readLegacyFileStoreForRedisSeed(): Promise<SuperReferralsStore | undefined> {
  return readFileStoreDocument();
}

async function readFileStore(): Promise<SuperReferralsStore> {
  const store = await readFileStoreDocument() || emptyStore();
  const normalized = normalizeStoreForRuntime(store);
  if (normalized.changed) {
    await writeFileStoreDocument(normalized.store);
  }
  return normalized.store;
}

async function readFileStoreDocument(): Promise<SuperReferralsStore | undefined> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const raw = await fs.readFile(dataPath(), "utf8");
      const store = parseStoreDocument(raw, `Store file ${dataPath()}`);
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
  throw new Error(`Unable to read store file ${dataPath()}`);
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
  if (!Array.isArray(store.deletedVideoReferences)) {
    store.deletedVideoReferences = [];
    changed = true;
  }
  changed = removeLegacyDemoStorefront(store) || changed;
  changed = backfillVideoMetadata(store) || changed;
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
    if (!pricing.inftActionPricesUsd) {
      pricing.inftActionPricesUsd = defaultINFTActionPricesUsd;
      changed = true;
    }
    const hasSamsarSession = Boolean(
      customer.samsarAccount?.appKeyHash ||
      customer.samsarAccount?.authToken ||
      customer.samsarAccount?.apiKey
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

function backfillVideoMetadata(store: SuperReferralsStore) {
  let changed = false;
  const generationMetadata = new Map<string, SamsarVideoRenderMetadata>();
  const generationsById = new Map(store.generations.map((generation) => [generation.id, generation]));

  for (const generation of store.generations) {
    if (!isVideoGeneration(generation)) {
      continue;
    }

    changed = backfillGenerationSamsarSessionId(generation) || changed;
    const metadata = resolveBackfilledVideoMetadata(generation);
    generationMetadata.set(generation.id, metadata);
    changed = applyVideoMetadata(generation, metadata) || changed;
  }

  for (const inft of store.infts) {
    const generation = generationsById.get(inft.generationId) || generationsById.get(inft.id);
    changed = backfillINFTSamsarSessionId(inft, generation) || changed;
    const metadata = resolveBackfilledVideoMetadata(
      generation,
      inft,
      generationMetadata.get(inft.generationId) || generationMetadata.get(inft.id)
    );
    changed = applyVideoMetadata(inft, metadata) || changed;
  }

  return changed;
}

function backfillGenerationSamsarSessionId(generation: Generation) {
  const sessionId = resolveBackfilledSamsarSessionId(generation);
  if (!sessionId) {
    return false;
  }

  let changed = false;
  const existingRequestId = cleanString(generation.samsarRequestId);
  const existingSessionId = cleanString(generation.samsarSessionId);

  if (!existingRequestId && existingSessionId && existingSessionId.startsWith("extreq_")) {
    generation.samsarRequestId = existingSessionId;
    changed = true;
  }
  if (shouldReplaceSamsarSessionId(existingSessionId, sessionId)) {
    generation.samsarSessionId = sessionId;
    changed = true;
  }

  const metadata = isPlainObject(generation.input?.metadata) ? generation.input.metadata as Record<string, unknown> : undefined;
  if (metadata) {
    const actionSessionId = cleanString(metadata.samsarActionSessionId);
    const generationRequestId = cleanString(generation.samsarRequestId);
    const externalRequestId = generationRequestId.startsWith("extreq_")
      ? generationRequestId
      : actionSessionId.startsWith("extreq_")
        ? actionSessionId
        : "";
    if (externalRequestId && !cleanString(metadata.samsarExternalRequestId)) {
      metadata.samsarExternalRequestId = externalRequestId;
      changed = true;
    }
    if (actionSessionId && shouldReplaceSamsarSessionId(actionSessionId, sessionId)) {
      metadata.samsarActionSessionId = sessionId;
      changed = true;
    }
  }

  if (isPlainObject(generation.samsarVideoMetadata)) {
    const metadata = generation.samsarVideoMetadata as Record<string, unknown>;
    if (metadata.samsar_session_id !== sessionId) {
      metadata.samsar_session_id = sessionId;
      changed = true;
    }
  }

  return changed;
}

function backfillINFTSamsarSessionId(inft: INFTRecord, generation?: Generation) {
  const sessionId = resolveBackfilledSamsarSessionId(generation, inft);
  if (!sessionId) {
    return false;
  }

  let changed = false;
  const attributes = inft.attributes || (inft.attributes = []);
  const existingSessionAttribute = getINFTAttributeValue(attributes, "samsar_session_id");
  const existingRequestAttribute = getINFTAttributeValue(attributes, "samsar_request_id");
  const requestId =
    cleanString(generation?.samsarRequestId) ||
    existingRequestAttribute ||
    (existingSessionAttribute.startsWith("extreq_") ? existingSessionAttribute : "");

  if (requestId) {
    changed = upsertINFTAttribute(attributes, "samsar_request_id", requestId) || changed;
  }
  if (shouldReplaceSamsarSessionId(existingSessionAttribute, sessionId)) {
    changed = upsertINFTAttribute(attributes, "samsar_session_id", sessionId) || changed;
  }

  if (!isPlainObject(inft.samsarVideoMetadata)) {
    inft.samsarVideoMetadata = {};
    changed = true;
  }
  const metadata = inft.samsarVideoMetadata as Record<string, unknown>;
  if (metadata.samsar_session_id !== sessionId) {
    metadata.samsar_session_id = sessionId;
    changed = true;
  }

  return changed;
}

function resolveBackfilledSamsarSessionId(generation?: Generation, inft?: INFTRecord) {
  const existingSessionId = firstNonExternalSamsarSessionId(
    generation?.samsarSessionId,
    generation?.input?.metadata?.samsarActionSessionId,
    getINFTAttributeValue(inft?.attributes, "samsar_session_id")
  );
  if (existingSessionId) {
    return existingSessionId;
  }
  return extractSamsarVideoSessionIdFromUrl(generation?.resultUrl, inft?.videoUrl);
}

function firstNonExternalSamsarSessionId(...values: unknown[]) {
  for (const value of values) {
    const sessionId = cleanString(value);
    if (sessionId && !sessionId.startsWith("extreq_")) {
      return normalizeSamsarVideoSessionId(sessionId);
    }
  }
  return "";
}

function shouldReplaceSamsarSessionId(current: unknown, next: string) {
  const currentSessionId = cleanString(current);
  if (!currentSessionId) {
    return true;
  }
  if (currentSessionId.startsWith("extreq_")) {
    return true;
  }
  return normalizeSamsarVideoSessionId(currentSessionId) !== next;
}

function getINFTAttributeValue(attributes: INFTRecord["attributes"] | undefined, traitType: string) {
  const normalizedTraitType = traitType.trim().toLowerCase();
  const attribute = attributes?.find((item) => item.trait_type.trim().toLowerCase() === normalizedTraitType);
  return cleanString(attribute?.value);
}

function upsertINFTAttribute(attributes: INFTRecord["attributes"], traitType: string, value: string) {
  const existing = attributes.find((item) => item.trait_type.trim().toLowerCase() === traitType);
  if (existing) {
    if (existing.value === value) {
      return false;
    }
    existing.value = value;
    return true;
  }
  attributes.push({ trait_type: traitType, value });
  return true;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isVideoGeneration(generation: Generation) {
  return Boolean(
    generation.status === "COMPLETED" ||
    generation.resultUrl ||
    generation.inftId ||
    generation.storage?.video
  );
}

function resolveBackfilledVideoMetadata(
  generation?: Generation,
  inft?: INFTRecord,
  generationMetadata?: SamsarVideoRenderMetadata
): SamsarVideoRenderMetadata {
  const existing = {
    ...(isPlainObject(generation?.samsarVideoMetadata) ? generation?.samsarVideoMetadata : {}),
    ...(generationMetadata || {}),
    ...(isPlainObject(inft?.samsarVideoMetadata) ? inft?.samsarVideoMetadata : {})
  } as SamsarVideoRenderMetadata;
  const attributes = inftAttributeMap(inft);
  const metadata: SamsarVideoRenderMetadata = { ...existing };
  const languageCode = resolveRenditionLanguageCode(
    inft?.languageCode,
    inft?.samsarVideoMetadata,
    generationMetadata,
    generation?.languageCode,
    generation?.samsarVideoMetadata,
    generation?.input?.language,
    attributes.get("language_code"),
    attributes.get("result_language"),
    attributes.get("languages"),
    DEFAULT_RENDITION_LANGUAGE_CODE
  );

  if (languageCode) {
    metadata.result_language = languageCode;
    metadata.languageCode = languageCode;
    metadata.language_code = languageCode;
    metadata.languages = mergeLanguageCodes(metadata.languages, languageCode);
  }

  const hasSubtitles = firstBooleanLike(
    derivedActionBoolean(generation?.input?.metadata, {
      trueActions: ["add_subtitles"],
      falseActions: ["remove_subtitles"]
    }),
    generation?.input?.enable_subtitles,
    firstKnownMetadataValue(existing, "has_subtitles", "hasSubtitles", "enable_subtitles", "enableSubtitles"),
    attributes.get("has_subtitles")
  );
  if (hasSubtitles !== undefined) {
    metadata.has_subtitles = hasSubtitles;
  }

  const hasOutro = firstBooleanLike(
    derivedActionBoolean(generation?.input?.metadata, {
      trueActions: ["add_outro", "update_outro"]
    }),
    generation?.input?.generate_outro_image,
    presentStringAsTrue(generation?.input?.outro_image_url),
    presentStringAsTrue(generation?.input?.cta_url),
    generation?.input?.add_outro_animation === true ? true : undefined,
    firstKnownMetadataValue(
      existing,
      "has_outro",
      "hasOutro",
      "has_outro_image",
      "hasOutroImage",
      "generate_outro_image",
      "generateOutroImage"
    ),
    attributes.get("has_outro")
  );
  if (hasOutro !== undefined) {
    metadata.has_outro = hasOutro;
  }

  const hasFooter = firstBooleanLike(
    derivedActionBoolean(generation?.input?.metadata, {
      falseActions: ["remove_footer"]
    }),
    generation?.input?.add_footer_animation,
    arrayHasItems(generation?.input?.footer_metadata),
    firstKnownMetadataValue(existing, "has_footer", "hasFooter", "add_footer_animation", "addFooterAnimation"),
    attributes.get("has_footer")
  );
  if (hasFooter !== undefined) {
    metadata.has_footer = hasFooter;
  }

  return metadata;
}

function applyVideoMetadata(
  record: Pick<Generation | INFTRecord, "languageCode" | "samsarVideoMetadata">,
  metadataPatch: SamsarVideoRenderMetadata
) {
  const languageCode = resolveRenditionLanguageCode(metadataPatch);
  if (!languageCode) {
    return false;
  }

  let changed = false;
  if (record.languageCode !== languageCode) {
    record.languageCode = languageCode;
    changed = true;
  }

  if (!isPlainObject(record.samsarVideoMetadata)) {
    record.samsarVideoMetadata = {};
    changed = true;
  }

  const metadata = record.samsarVideoMetadata as Record<string, unknown>;
  for (const key of ["result_language", "languageCode", "language_code"]) {
    if (resolveRenditionLanguageCode(metadata[key]) !== languageCode) {
      metadata[key] = languageCode;
      changed = true;
    }
  }

  const languages = Array.isArray(metadata.languages)
    ? metadata.languages
      .map((value) => resolveRenditionLanguageCode(value))
      .filter(Boolean)
    : [];
  if (!languages.includes(languageCode)) {
    languages.push(languageCode);
  }
  if (!Array.isArray(metadata.languages) || languages.join(",") !== metadata.languages.join(",")) {
    metadata.languages = languages;
    changed = true;
  }

  for (const key of ["has_subtitles", "has_outro", "has_footer"] as const) {
    if (metadataPatch[key] !== undefined && metadata[key] !== metadataPatch[key]) {
      metadata[key] = metadataPatch[key];
      changed = true;
    }
  }

  return changed;
}

function firstKnownMetadataValue(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(record, key)) {
      return record[key];
    }
  }
  return undefined;
}

function firstBooleanLike(...values: unknown[]): boolean | null | undefined {
  for (const value of values) {
    if (value === null) {
      return null;
    }
    if (typeof value === "boolean") {
      return value;
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes"].includes(normalized)) {
        return true;
      }
      if (["false", "0", "no"].includes(normalized)) {
        return false;
      }
    }
  }
  return undefined;
}

function mergeLanguageCodes(existing: unknown, languageCode: string) {
  const languages = Array.isArray(existing)
    ? existing
      .map((value) => resolveRenditionLanguageCode(value))
      .filter(Boolean)
    : [];
  if (!languages.includes(languageCode)) {
    languages.push(languageCode);
  }
  return languages;
}

function inftAttributeMap(inft?: INFTRecord) {
  const attributes = new Map<string, unknown>();
  for (const attribute of inft?.attributes || []) {
    attributes.set(attribute.trait_type.trim().toLowerCase(), attribute.value);
  }
  return attributes;
}

function presentStringAsTrue(value: unknown) {
  return typeof value === "string" && value.trim() ? true : undefined;
}

function arrayHasItems(value: unknown) {
  return Array.isArray(value) ? value.length > 0 : undefined;
}

function derivedActionBoolean(
  metadata: unknown,
  options: { trueActions?: string[]; falseActions?: string[] }
) {
  if (!isPlainObject(metadata)) {
    return undefined;
  }
  const action = String(metadata.derivedFromAction || metadata.action || "").trim().toLowerCase();
  if (!action) {
    return undefined;
  }
  if (options.trueActions?.includes(action)) {
    return true;
  }
  if (options.falseActions?.includes(action)) {
    return false;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
  if (storeBackend() === "redis") {
    await writeRedisStoreDocument(store);
    return;
  }
  await writeFileStoreDocument(store);
}

async function writeFileStoreDocument(store: SuperReferralsStore) {
  await writeJsonFile(dataPath(), store);
}

async function writeRedisStoreDocument(store: SuperReferralsStore) {
  await redisCommand<string>(["SET", redisStoreKey(), JSON.stringify(store)]);
}

export async function mutateStore<T>(mutator: (store: SuperReferralsStore) => T | Promise<T>) {
  return storeBackend() === "redis" ? mutateRedisStore(mutator) : mutateFileStore(mutator);
}

async function mutateFileStore<T>(mutator: (store: SuperReferralsStore) => T | Promise<T>) {
  const store = normalizeStoreForRuntime(await readFileStoreDocument() || emptyStore()).store;
  const result = await mutator(store);
  await writeFileStoreDocument(store);
  return result;
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
  return withRedisLock(redisStoreLockKey(), operation, {
    ttlMs: parsePositiveIntegerEnv("SUPERREFERRALS_REDIS_LOCK_TTL_MS", DEFAULT_REDIS_LOCK_TTL_MS),
    retries: parsePositiveIntegerEnv("SUPERREFERRALS_REDIS_LOCK_RETRIES", DEFAULT_REDIS_LOCK_RETRIES)
  });
}

export async function withStoreScopedLock<T>(
  scope: string,
  operation: () => Promise<T>,
  options: { ttlMs?: number; retries?: number } = {}
) {
  const lockScope = normalizeLockScope(scope);
  if (storeBackend() === "redis") {
    const ttlMs = options.ttlMs || parsePositiveIntegerEnv("SUPERREFERRALS_SCOPED_LOCK_TTL_MS", DEFAULT_SCOPED_LOCK_TTL_MS);
    const retries = options.retries || parsePositiveIntegerEnv("SUPERREFERRALS_SCOPED_LOCK_RETRIES", DEFAULT_SCOPED_LOCK_RETRIES);
    return withRedisLock(`${redisStoreKey()}:lock:${lockScope}`, operation, { ttlMs, retries });
  }
  return withLocalScopedLock(lockScope, operation);
}

async function withRedisLock<T>(
  lockKey: string,
  operation: () => Promise<T>,
  options: { ttlMs: number; retries: number }
) {
  const token = createId("lock");
  const ttlMs = options.ttlMs;
  const retries = options.retries;
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

async function withLocalScopedLock<T>(scope: string, operation: () => Promise<T>) {
  const previous = localLocks.get(scope) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(operation);
  const settled = run.then(() => undefined, () => undefined);
  localLocks.set(scope, settled);

  try {
    return await run;
  } finally {
    if (localLocks.get(scope) === settled) {
      localLocks.delete(scope);
    }
  }
}

function normalizeLockScope(scope: string) {
  return scope
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 160) || "default";
}

export async function redisCommand<T>(command: Array<string | number>) {
  const config = optionalRedisRestConfig();
  if (!config) {
    if (shouldUseLocalKvFallback()) {
      return localKvCommand<T>(command);
    }
    throw missingRedisConfigError();
  }
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

async function localKvCommand<T>(command: Array<string | number>) {
  const operation = String(command[0] || "").toUpperCase();
  switch (operation) {
    case "GET":
      return localKvGet<T>(String(command[1] || ""));
    case "SET":
      return localKvSet<T>(command);
    case "DEL":
      return localKvDel<T>(command.slice(1).map(String));
    case "EVAL":
      return localKvEval<T>(command);
    default:
      throw new Error(`Local KV fallback does not support Redis command ${operation || "(empty)"}.`);
  }
}

async function localKvGet<T>(key: string) {
  const document = await readLocalKvDocument();
  const entry = document[key];
  if (!entry || isLocalKvEntryExpired(entry)) {
    if (entry) {
      delete document[key];
      await writeLocalKvDocument(document);
    }
    return null as T;
  }
  return entry.value as T;
}

async function localKvSet<T>(command: Array<string | number>) {
  const key = String(command[1] || "");
  const value = command[2];
  const options = command.slice(3).map((item) => String(item));
  const document = await readLocalKvDocument();
  const existing = document[key];
  const existingActive = Boolean(existing && !isLocalKvEntryExpired(existing));
  if (hasRedisOption(options, "NX") && existingActive) {
    return null as T;
  }
  if (existing && !existingActive) {
    delete document[key];
  }
  const expiresAt = localKvExpiresAt(options);
  document[key] = expiresAt ? { value, expiresAt } : { value };
  await writeLocalKvDocument(document);
  return "OK" as T;
}

async function localKvDel<T>(keys: string[]) {
  const document = await readLocalKvDocument();
  let deleted = 0;
  for (const key of keys) {
    if (document[key]) {
      delete document[key];
      deleted += 1;
    }
  }
  if (deleted > 0) {
    await writeLocalKvDocument(document);
  }
  return deleted as T;
}

async function localKvEval<T>(command: Array<string | number>) {
  const script = String(command[1] || "");
  if (script !== REDIS_LOCK_RELEASE_SCRIPT) {
    throw new Error("Local KV fallback only supports the Redis lock release EVAL script.");
  }
  const keyCount = Number(command[2]);
  if (keyCount !== 1) {
    throw new Error("Local KV fallback only supports one Redis EVAL key.");
  }
  const key = String(command[3] || "");
  const token = String(command[4] || "");
  const document = await readLocalKvDocument();
  const entry = document[key];
  if (entry && !isLocalKvEntryExpired(entry) && String(entry.value) === token) {
    delete document[key];
    await writeLocalKvDocument(document);
    return 1 as T;
  }
  return 0 as T;
}

async function readLocalKvDocument(): Promise<LocalKvDocument> {
  try {
    const raw = await fs.readFile(localKvPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new SyntaxError("Local KV document is not a JSON object");
    }
    const document = parsed as LocalKvDocument;
    let changed = false;
    for (const [key, entry] of Object.entries(document)) {
      if (!entry || typeof entry !== "object" || isLocalKvEntryExpired(entry)) {
        delete document[key];
        changed = true;
      }
    }
    if (changed) {
      await writeLocalKvDocument(document);
    }
    return document;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    if (error instanceof SyntaxError) {
      throw new Error(`Local KV file ${localKvPath()} contains invalid JSON. Stop the dev server and inspect or restore the file before continuing.`);
    }
    throw error;
  }
}

async function writeLocalKvDocument(document: LocalKvDocument) {
  await writeJsonFile(localKvPath(), document);
}

function isLocalKvEntryExpired(entry: LocalKvEntry) {
  return typeof entry.expiresAt === "number" && entry.expiresAt <= Date.now();
}

function localKvExpiresAt(options: string[]) {
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index].toUpperCase();
    if (option === "EX") {
      const seconds = Number(options[index + 1]);
      return Number.isFinite(seconds) && seconds > 0 ? Date.now() + Math.floor(seconds * 1000) : undefined;
    }
    if (option === "PX") {
      const milliseconds = Number(options[index + 1]);
      return Number.isFinite(milliseconds) && milliseconds > 0 ? Date.now() + Math.floor(milliseconds) : undefined;
    }
  }
  return undefined;
}

function hasRedisOption(options: string[], name: string) {
  return options.some((option) => option.toUpperCase() === name);
}

async function writeJsonFile(filePath: string, value: unknown) {
  const directory = path.dirname(filePath);
  const basename = path.basename(filePath);
  await fs.mkdir(directory, { recursive: true });
  const tempPath = path.join(directory, `.${basename}.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
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
  if (isDeletedVideoReference(store, id)) {
    return undefined;
  }
  const existing = store.infts.find((inft) => inft.id === id || inft.generationId === id || inft.tokenId === id);
  if (existing) {
    if (await isStoredINFTMissingOnChain(existing)) {
      await mutateStore((mutableStore) => removeGenerationVideoReferences(mutableStore, {
        generationId: existing.generationId,
        inftId: existing.id,
        tokenId: existing.tokenId,
        contractAddress: existing.contractAddress,
        reason: "burned"
      })).catch(() => undefined);
      return undefined;
    }
    return existing;
  }
  const recovered = await recoverINFTFromChain(id).catch(() => undefined);
  if (!recovered) {
    return undefined;
  }
  if (isDeletedVideoReference(store, recovered.id) || isDeletedVideoReference(store, recovered.generationId) || isDeletedVideoReference(store, recovered.tokenId || "")) {
    return undefined;
  }
  await mutateStore((mutableStore) => {
    if (isDeletedVideoReference(mutableStore, recovered.id) || isDeletedVideoReference(mutableStore, recovered.generationId) || isDeletedVideoReference(mutableStore, recovered.tokenId || "")) {
      return undefined;
    }
    return addINFT(mutableStore, recovered);
  }).catch(() => undefined);
  return recovered;
}

async function isStoredINFTMissingOnChain(inft: INFTRecord) {
  if (!inft.tokenId || !inft.contractAddress) {
    return false;
  }
  return isINFTTokenMissing({
    tokenId: inft.tokenId,
    contractAddress: inft.contractAddress
  }).catch(() => false);
}

export function publicStore(store: SuperReferralsStore): SuperReferralsStore {
  return {
    ...store,
    customers: store.customers.map(publicCustomer),
    subAccounts: store.subAccounts.map(publicSubAccount)
  };
}

export function publicCustomer(customer: Customer): Customer {
  const samsarAccount = customer.samsarAccount
    ? {
      email: customer.samsarAccount.email,
      username: customer.samsarAccount.username,
      userId: customer.samsarAccount.userId,
      hasSession: Boolean(customer.samsarAccount.appKeyHash || customer.samsarAccount.authToken || customer.samsarAccount.apiKey),
      hasAppKey: Boolean(customer.samsarAccount.appKeyHash),
      hasApiKey: Boolean(customer.samsarAccount.apiKey),
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

export function upsertCustomer(store: SuperReferralsStore, input: CustomerUpsertInput) {
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
      inftActionPricesUsd: input.pricing?.inftActionPricesUsd ||
        existing?.pricing.inftActionPricesUsd ||
        defaultINFTActionPricesUsd,
      modelConfigurations: input.pricing?.modelConfigurations ||
        existing?.pricing.modelConfigurations ||
        defaultModelPricingConfigurations
    },
    referrerBaseUrl: (input.referrerBaseUrl || existing?.referrerBaseUrl || appBaseUrl()).replace(/\/$/, ""),
    ensName: input.ensName ?? existing?.ensName,
    storefront: normalizeStorefrontDetails(input.storefront, existing?.storefront),
    preferences: normalizeCustomerPreferences(input.preferences, existing?.preferences),
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
  preferences?: Partial<SubAccountPreferences>;
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
    preferences: input.preferences ? normalizeSubAccountPreferences(input.preferences) : undefined,
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

export function removeINFT(store: SuperReferralsStore, id: string) {
  const existingIndex = store.infts.findIndex((item) =>
    item.id === id || item.generationId === id || item.tokenId === id
  );
  if (existingIndex < 0) {
    return null;
  }
  const [removed] = store.infts.splice(existingIndex, 1);
  return removed || null;
}

export function removeGenerationVideoReferences(store: SuperReferralsStore, input: {
  generationId: string;
  inftId?: string;
  tokenId?: string;
  contractAddress?: string;
  reason?: DeletedVideoReference["reason"];
  txHash?: string;
}) {
  const generationIds = new Set([input.generationId].filter(Boolean));
  const inftIds = new Set([input.inftId].filter(Boolean));
  const tokenIds = new Set([input.tokenId].filter(Boolean));
  const contractAddresses = new Set([normalizeStoreKey(input.contractAddress)].filter(Boolean));
  const quoteIds = new Set<string>();

  for (const inft of store.infts) {
    if (generationIds.has(inft.generationId) || inftIds.has(inft.id)) {
      inftIds.add(inft.id);
      generationIds.add(inft.generationId);
      if (inft.tokenId) {
        tokenIds.add(inft.tokenId);
      }
      const contractAddress = normalizeStoreKey(inft.contractAddress);
      if (contractAddress) {
        contractAddresses.add(contractAddress);
      }
    }
  }
  for (const generation of store.generations) {
    if (generationIds.has(generation.id) || (generation.inftId && inftIds.has(generation.inftId))) {
      generationIds.add(generation.id);
      if (generation.payment.quoteId) {
        quoteIds.add(generation.payment.quoteId);
      }
      if (generation.inftId) {
        inftIds.add(generation.inftId);
      }
    }
  }

  const removedGenerationCount = store.generations.length;
  store.generations = store.generations.filter((generation) => !generationIds.has(generation.id));
  const removedInftCount = store.infts.length;
  store.infts = store.infts.filter((inft) => !inftIds.has(inft.id) && !generationIds.has(inft.generationId));

  addDeletedVideoReference(store, {
    generationId: [...generationIds][0],
    inftId: [...inftIds][0],
    tokenId: [...tokenIds][0],
    contractAddress: [...contractAddresses][0],
    reason: input.reason || "deleted",
    txHash: input.txHash,
    deletedAt: nowIso()
  });

  store.feedLikes = store.feedLikes.filter((like) => !generationIds.has(like.generationId));
  store.feedComments = store.feedComments.filter((comment) => !generationIds.has(comment.generationId));
  store.feedViews = store.feedViews.filter((view) => !generationIds.has(view.generationId));
  store.storefrontRatings = store.storefrontRatings.filter((rating) =>
    !generationIds.has(rating.generationId || "") &&
    !inftIds.has(rating.inftId || "")
  );
  store.quotes = store.quotes.filter((quote) => !inftIds.has(quote.inftId || "") && !quoteIds.has(quote.id));

  const removedJobIds = new Set(
    store.agentJobs
      .filter((job) =>
        generationIds.has(job.generationId || "") ||
        inftIds.has(job.inftId || "")
      )
      .map((job) => job.id)
  );
  store.agentJobs = store.agentJobs.filter((job) => !removedJobIds.has(job.id));
  store.agentTownEvents = store.agentTownEvents.filter((event) => !removedJobIds.has(event.jobId || ""));

  return {
    generationIds: [...generationIds],
    inftIds: [...inftIds],
    tokenIds: [...tokenIds],
    removedGenerations: removedGenerationCount - store.generations.length,
    removedInfts: removedInftCount - store.infts.length
  };
}

export function isDeletedVideoReference(store: SuperReferralsStore, id?: string) {
  const normalized = normalizeStoreKey(id);
  if (!normalized) {
    return false;
  }
  return store.deletedVideoReferences.some((reference) =>
    normalizeStoreKey(reference.generationId) === normalized ||
    normalizeStoreKey(reference.inftId) === normalized ||
    normalizeStoreKey(reference.tokenId) === normalized
  );
}

function addDeletedVideoReference(store: SuperReferralsStore, reference: DeletedVideoReference) {
  const nextReference = {
    ...reference,
    generationId: reference.generationId || undefined,
    inftId: reference.inftId || undefined,
    tokenId: reference.tokenId || undefined,
    contractAddress: reference.contractAddress || undefined,
    txHash: reference.txHash || undefined
  };
  const matchesReference = (item: DeletedVideoReference) =>
    Boolean(nextReference.generationId && item.generationId === nextReference.generationId) ||
    Boolean(nextReference.inftId && item.inftId === nextReference.inftId) ||
    Boolean(nextReference.tokenId && item.tokenId === nextReference.tokenId);
  store.deletedVideoReferences = [
    nextReference,
    ...store.deletedVideoReferences.filter((item) => !matchesReference(item))
  ];
}

function normalizeStoreKey(value?: string) {
  return String(value || "").trim().toLowerCase();
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
  const inputHasLanguage = Object.prototype.hasOwnProperty.call(input, "language");
  const inputHasPaymentCurrency = Object.prototype.hasOwnProperty.call(input, "paymentCurrency");
  const renderForm = input.renderForm && typeof input.renderForm === "object" && !Array.isArray(input.renderForm)
    ? input.renderForm
    : existing?.renderForm;
  const renderFormMode = input.renderFormMode === "simple" || input.renderFormMode === "advanced"
    ? input.renderFormMode
    : existing?.renderFormMode;
  const paymentCurrency = inputHasPaymentCurrency
    ? normalizePaymentCurrencySymbol(input.paymentCurrency)
    : existing?.paymentCurrency;
  const language = inputHasLanguage
    ? normalizeAppLanguage(input.language)
    : existing?.language;
  return {
    renderForm,
    renderFormMode,
    paymentCurrency,
    language,
    updatedAt: nowIso()
  };
}

function normalizeCustomerPreferences(
  input?: Partial<CustomerPreferences>,
  existing?: CustomerPreferences
): CustomerPreferences | undefined {
  const inputHasLanguage = Boolean(input && Object.prototype.hasOwnProperty.call(input, "language"));
  const nextLanguage = inputHasLanguage
    ? normalizeAppLanguage(input?.language)
    : existing?.language;
  if (!nextLanguage) {
    return undefined;
  }
  const languageChanged = inputHasLanguage && nextLanguage !== existing?.language;
  return {
    language: nextLanguage,
    updatedAt: languageChanged ? nowIso() : existing?.updatedAt || nowIso()
  };
}

function firstUsableWallet(...values: Array<string | undefined | null>) {
  return values.find((value) => isUsableEvmAddress(value));
}
