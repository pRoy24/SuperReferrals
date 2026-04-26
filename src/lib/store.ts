import fs from "node:fs/promises";
import path from "node:path";
import { appBaseUrl, env } from "./env";
import { createId, makeReferrerCode, nowIso, normalizeWallet } from "./ids";
import { findPaymentToken, getTransactionChainId, settlementTokenForCurrency } from "./payment-tokens";
import { defaultModelPricingConfigurations, defaultPricing } from "./pricing";
import type {
  AgentJob,
  AgentProfile,
  AgentTownEvent,
  Customer,
  Generation,
  INFTRecord,
  PaymentQuote,
  SubAccount,
  SuperReferralsStore
} from "./types";

const STORE_FILE = "data.json";
let storeMutationQueue: Promise<unknown> = Promise.resolve();

function dataDir() {
  const configured = env("SUPERREFERRALS_DATA_DIR");
  if (configured && path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(process.cwd(), ".superreferrals");
}

function dataPath() {
  return path.join(dataDir(), STORE_FILE);
}

export function emptyStore(): SuperReferralsStore {
  return {
    version: 2,
    customers: [],
    subAccounts: [],
    quotes: [],
    generations: [],
    infts: [],
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
      const store = { ...emptyStore(), ...parsed, version: parsed.version || 2 };
      const normalized = normalizeStoreForRuntime(store);
      if (normalized.changed) {
        await writeStore(normalized.store);
      }
      return normalized.store;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        const seeded = seedStore();
        await writeStore(seeded);
        return seeded;
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
  }
  return { store, changed };
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

export function seedStore(): SuperReferralsStore {
  const timestamp = nowIso();
  const customerId = "cus_demo";
  const ownerWallet = normalizeWallet("0x1111111111111111111111111111111111111111");
  const subAccountId = "sub_demo";
  const referrerCode = makeReferrerCode(`${customerId}:${subAccountId}`);
  const customer: Customer = {
    id: customerId,
    name: "Demo Customer",
    ownerWallet,
    pricing: defaultPricing,
    referrerBaseUrl: appBaseUrl(),
    ensName: "demo.eth",
    subscription: {
      status: "active",
      creditsRemaining: 5000
    },
    createdAt: timestamp,
    updatedAt: timestamp
  };
  const subAccount: SubAccount = {
    id: subAccountId,
    customerId,
    wallet: normalizeWallet("0x2222222222222222222222222222222222222222"),
    email: "creator@example.com",
    username: "demo-creator",
    referrerCode,
    externalUser: {
      provider: "superreferrals",
      external_user_id: subAccountId,
      external_app_id: customerId,
      username: "demo-creator"
    },
    externalApiKey: "mock_external_api_key",
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return {
    ...emptyStore(),
    customers: [customer],
    subAccounts: [subAccount]
  };
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

export function upsertCustomer(store: SuperReferralsStore, input: Partial<Customer>) {
  const timestamp = nowIso();
  const id = input.id || createId("cus");
  const existing = store.customers.find((customer) => customer.id === id);
  const next: Customer = {
    id,
    name: input.name?.trim() || existing?.name || "Customer",
    ownerWallet: normalizeWallet(input.ownerWallet || existing?.ownerWallet),
    samsarApiKeyAlias: input.samsarApiKeyAlias || existing?.samsarApiKeyAlias,
    pricing: {
      ...(existing?.pricing || defaultPricing),
      ...(input.pricing || {}),
      modelConfigurations: input.pricing?.modelConfigurations ||
        existing?.pricing.modelConfigurations ||
        defaultModelPricingConfigurations
    },
    referrerBaseUrl: (input.referrerBaseUrl || existing?.referrerBaseUrl || appBaseUrl()).replace(/\/$/, ""),
    ensName: input.ensName ?? existing?.ensName,
    subscription: {
      status: input.subscription?.status || existing?.subscription.status || "active",
      streamId: input.subscription?.streamId || existing?.subscription.streamId,
      creditsRemaining: input.subscription?.creditsRemaining ?? existing?.subscription.creditsRemaining
    },
    createdAt: existing?.createdAt || timestamp,
    updatedAt: timestamp
  };
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
      username
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
  store.infts.unshift(inft);
  return inft;
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
