import type { Customer, GenerationStatus, SuperReferralsStore } from "./types";

const countedDailyRenderStatuses = new Set<GenerationStatus>([
  "PAYMENT_CONFIRMED",
  "QUEUED",
  "PROCESSING",
  "COMPLETED",
  "FAILED"
]);

export function getStorefrontDailyWalletRenderLimit(customer?: Customer | null) {
  if (!customer?.storefront?.conditions?.enabled) {
    return undefined;
  }
  const limit = Number(customer.storefront.conditions.dailyWalletRenderLimit);
  return Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : undefined;
}

export function getStorefrontWalletAccessMode(customer?: Customer | null) {
  if (!customer?.storefront?.conditions?.enabled) {
    return "open" as const;
  }
  return customer.storefront.conditions.walletAccessMode === "whitelist" ? "whitelist" as const : "open" as const;
}

export function getStorefrontWalletWhitelist(customer?: Customer | null) {
  if (!customer?.storefront?.conditions?.enabled) {
    return [];
  }
  return normalizeWalletList(customer.storefront.conditions.walletWhitelist);
}

export function isWalletWhitelistedForStorefront(customer: Customer, wallet?: string) {
  if (getStorefrontWalletAccessMode(customer) !== "whitelist") {
    return true;
  }
  const normalizedWallet = normalizeAccessWallet(wallet);
  return Boolean(normalizedWallet && getStorefrontWalletWhitelist(customer).includes(normalizedWallet));
}

export function assertStorefrontWalletAllowed(customer: Customer, wallet?: string) {
  if (!isWalletWhitelistedForStorefront(customer, wallet)) {
    throw new Error("This wallet is not whitelisted for this storefront.");
  }
}

export function getStorefrontAccessError(
  customer: Customer | null | undefined,
  store: SuperReferralsStore | null | undefined,
  input: {
    wallet?: string;
    now?: Date;
  }
) {
  if (!customer) {
    return "Customer store is not available";
  }

  const wallet = normalizeAccessWallet(input.wallet);
  if (getStorefrontWalletAccessMode(customer) === "whitelist") {
    if (!wallet) {
      return "Connect a whitelisted wallet to use this storefront.";
    }
    if (!isWalletWhitelistedForStorefront(customer, wallet)) {
      return "This wallet is not whitelisted for this storefront.";
    }
  }

  const dailyLimit = getStorefrontDailyWalletRenderLimit(customer);
  if (dailyLimit) {
    if (!wallet) {
      return "Connect a wallet to check this storefront's daily render limit.";
    }
    if (store) {
      const renderCount = countStorefrontWalletRendersToday(store, customer.id, wallet, input.now);
      if (renderCount >= dailyLimit) {
        return `This wallet has reached the storefront limit of ${dailyLimit} render${dailyLimit === 1 ? "" : "s"} today.`;
      }
    }
  }

  return "";
}

export function assertStorefrontRenderAccess(
  customer: Customer,
  store: SuperReferralsStore,
  input: {
    wallet?: string;
    now?: Date;
  }
) {
  const error = getStorefrontAccessError(customer, store, input);
  if (error) {
    throw new Error(error);
  }
}

export function countStorefrontWalletRendersToday(
  store: SuperReferralsStore,
  customerId: string,
  wallet?: string,
  now = new Date()
) {
  const normalizedWallet = normalizeAccessWallet(wallet);
  if (!normalizedWallet) {
    return 0;
  }

  const dayStart = startOfUtcDay(now).getTime();
  const subAccountsForWallet = new Set(
    store.subAccounts
      .filter((account) =>
        account.customerId === customerId &&
        normalizeAccessWallet(account.wallet) === normalizedWallet
      )
      .map((account) => account.id)
  );
  const subAccountWallets = new Map(
    store.subAccounts.map((account) => [account.id, normalizeAccessWallet(account.wallet)])
  );

  return store.generations.filter((generation) => {
    if (generation.customerId !== customerId || !countedDailyRenderStatuses.has(generation.status)) {
      return false;
    }
    const createdAt = Date.parse(generation.createdAt);
    if (!Number.isFinite(createdAt) || createdAt < dayStart) {
      return false;
    }
    const generationWallet =
      subAccountWallets.get(generation.subAccountId) ||
      normalizeAccessWallet(generation.payment.payerWallet);
    return (
      subAccountsForWallet.has(generation.subAccountId) ||
      generationWallet === normalizedWallet
    );
  }).length;
}

export function normalizeWalletList(value: unknown) {
  const source = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\n|,|\s+/)
      : [];
  const normalized = source
    .map((item) => normalizeAccessWallet(String(item)))
    .filter(Boolean);
  return Array.from(new Set(normalized));
}

function normalizeAccessWallet(value?: string) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
