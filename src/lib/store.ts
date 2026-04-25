import fs from "node:fs/promises";
import path from "node:path";
import { appBaseUrl, env } from "./env";
import { createId, makeReferrerCode, nowIso, normalizeWallet } from "./ids";
import { defaultPricing } from "./pricing";
import type {
  Customer,
  Generation,
  INFTRecord,
  PaymentQuote,
  SubAccount,
  SuperReferrerStore
} from "./types";

const STORE_FILE = "data.json";

function dataDir() {
  const configured = env("SUPERREFERRER_DATA_DIR");
  if (configured && path.isAbsolute(configured)) {
    return configured;
  }
  return path.join(process.cwd(), ".superreferrer");
}

function dataPath() {
  return path.join(dataDir(), STORE_FILE);
}

export function emptyStore(): SuperReferrerStore {
  return {
    version: 1,
    customers: [],
    subAccounts: [],
    quotes: [],
    generations: [],
    infts: []
  };
}

export async function readStore(): Promise<SuperReferrerStore> {
  try {
    const raw = await fs.readFile(dataPath(), "utf8");
    const parsed = JSON.parse(raw) as SuperReferrerStore;
    return { ...emptyStore(), ...parsed };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      throw error;
    }
    const seeded = seedStore();
    await writeStore(seeded);
    return seeded;
  }
}

export async function writeStore(store: SuperReferrerStore) {
  await fs.mkdir(dataDir(), { recursive: true });
  await fs.writeFile(dataPath(), `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function mutateStore<T>(mutator: (store: SuperReferrerStore) => T | Promise<T>) {
  const store = await readStore();
  const result = await mutator(store);
  await writeStore(store);
  return result;
}

export function seedStore(): SuperReferrerStore {
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
      provider: "superreferrer",
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

export function upsertCustomer(store: SuperReferrerStore, input: Partial<Customer>) {
  const timestamp = nowIso();
  const id = input.id || createId("cus");
  const existing = store.customers.find((customer) => customer.id === id);
  const next: Customer = {
    id,
    name: input.name?.trim() || existing?.name || "Customer",
    ownerWallet: normalizeWallet(input.ownerWallet || existing?.ownerWallet),
    samsarApiKeyAlias: input.samsarApiKeyAlias || existing?.samsarApiKeyAlias,
    pricing: { ...(existing?.pricing || defaultPricing), ...(input.pricing || {}) },
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

export function addSubAccount(store: SuperReferrerStore, input: {
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
      provider: "superreferrer",
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

export function addQuote(store: SuperReferrerStore, quote: PaymentQuote) {
  store.quotes.unshift(quote);
  return quote;
}

export function addGeneration(store: SuperReferrerStore, generation: Generation) {
  store.generations.unshift(generation);
  return generation;
}

export function updateGeneration(store: SuperReferrerStore, id: string, patch: Partial<Generation>) {
  const generation = store.generations.find((item) => item.id === id);
  if (!generation) {
    return null;
  }
  Object.assign(generation, patch, { updatedAt: nowIso() });
  return generation;
}

export function addINFT(store: SuperReferrerStore, inft: INFTRecord) {
  store.infts.unshift(inft);
  return inft;
}
