import { createId, nowIso } from "./ids";
import { hasStoredSamsarAppKey } from "./samsar-app-credentials";
import { provisionSamsarProcessorAppKeyIfMissing } from "./samsar-processor";
import { mutateStore, upsertCustomer } from "./store";
import type { Customer, SuperReferralsStore } from "./types";

type WebhookDetails = {
  eventType?: string;
  status?: string;
  checkoutSessionId?: string;
  paymentIntentId?: string;
  externalPaymentId?: string;
  paymentStatusEndpoint?: string;
  checkoutUrl?: string;
  customerId?: string;
  email?: string;
  username?: string;
  userId?: string;
  authToken?: string;
  refreshToken?: string;
  expiryDate?: string;
  refreshTokenExpiresAt?: string;
  apiKey?: string;
  loginUrl?: string;
  passwordSetupUrl?: string;
  returnOrigin?: string;
  authRedirectUrl?: string;
  storefrontPortalUrl?: string;
  creditsPurchased: number;
  remainingCredits?: number;
};

export type ProcessorCreditWebhookResult = {
  processed: boolean;
  ignored?: boolean;
  message?: string;
  customer?: Customer;
  createdCustomer?: boolean;
  linkedExternalUser?: boolean;
  firstClassUser?: boolean;
  email?: string;
  checkoutSessionId?: string;
  creditsRemaining?: number;
  authRedirectUrl?: string;
  storefrontPortalUrl?: string;
  warning?: string;
};

export async function reconcileProcessorCreditWebhook(payload: Record<string, unknown>): Promise<ProcessorCreditWebhookResult> {
  const details = extractWebhookDetails(payload);
  if (!isSuccessfulCheckout(details)) {
    return {
      processed: false,
      ignored: true,
      message: "Webhook did not describe a completed credit checkout.",
      email: details.email,
      checkoutSessionId: details.checkoutSessionId
    };
  }

  if (!details.email) {
    throw new Error("Credit checkout webhook did not include the Stripe checkout email required to create or update a SuperReferrals account.");
  }

  const paymentRecordId = getPaymentRecordId(details);
  if (!paymentRecordId) {
    throw new Error("Credit checkout webhook did not include a checkout session or payment id.");
  }

  if (details.creditsPurchased <= 0 && details.remainingCredits === undefined) {
    throw new Error("Credit checkout webhook did not include a positive paid credit amount.");
  }

  let createdCustomer = false;
  const customer = await mutateStore((store) => {
    const target = findTargetCustomer(store, details);
    createdCustomer = !target;
    const customerId = target?.id || details.customerId || createId("cus");
    const storedAccountApiKey = details.apiKey || target?.samsarAccount?.apiKey;
    const currentCredits = Number(target?.subscription.creditsRemaining || 0);
    return upsertCustomer(store, {
      id: customerId,
      name: target?.name || deriveAccountName(details.email) || "SuperReferrals Account",
      ownerWallet: target?.ownerWallet,
      samsarApiKeyAlias: storedAccountApiKey
        ? target?.samsarApiKeyAlias || "samsar-user-api-key"
        : target?.samsarApiKeyAlias,
      samsarAccount: {
        ...(target?.samsarAccount || {}),
        email: details.email || target?.samsarAccount?.email,
        username: details.username || target?.samsarAccount?.username || deriveAccountName(details.email),
        userId: details.userId || target?.samsarAccount?.userId || customerId,
        authToken: details.authToken || target?.samsarAccount?.authToken,
        refreshToken: details.refreshToken || target?.samsarAccount?.refreshToken,
        expiryDate: details.expiryDate || target?.samsarAccount?.expiryDate,
        refreshTokenExpiresAt: details.refreshTokenExpiresAt || target?.samsarAccount?.refreshTokenExpiresAt,
        apiKey: storedAccountApiKey,
        checkoutSessionId: details.checkoutSessionId || target?.samsarAccount?.checkoutSessionId,
        checkoutUrl: details.checkoutUrl || target?.samsarAccount?.checkoutUrl,
        paymentStatusEndpoint: details.paymentStatusEndpoint || target?.samsarAccount?.paymentStatusEndpoint,
        externalPaymentId: details.externalPaymentId || target?.samsarAccount?.externalPaymentId,
        processedCheckoutSessionIds: target?.samsarAccount?.processedCheckoutSessionIds || [],
        updatedAt: nowIso()
      },
      subscription: {
        status: currentCredits > 0 ? "active" : "not_started",
        creditsRemaining: currentCredits
      }
    });
  });

  let linkResult = await creditFirstClassCheckoutCustomer(customer, details);
  if (details.authToken && !hasStoredSamsarAppKey(linkResult.customer)) {
    const appKey = await provisionSamsarProcessorAppKeyIfMissing(linkResult.customer, details.authToken);
    if (appKey) {
      const updated = await mutateStore((store) => upsertCustomer(store, {
        id: linkResult.customer.id,
        samsarApiKeyAlias: "samsar-user-app-key",
        samsarAccount: {
          ...(linkResult.customer.samsarAccount || {}),
          ...appKey,
          updatedAt: nowIso()
        },
        subscription: linkResult.customer.subscription
      }));
      linkResult = { ...linkResult, customer: updated };
    }
  }

  return {
    processed: true,
    customer: linkResult.customer,
    createdCustomer,
    linkedExternalUser: linkResult.linkedExternalUser,
    firstClassUser: "firstClassUser" in linkResult ? linkResult.firstClassUser === true : false,
    warning: "warning" in linkResult ? linkResult.warning : undefined,
    email: details.email || linkResult.customer.samsarAccount?.email,
    checkoutSessionId: details.checkoutSessionId,
    creditsRemaining: linkResult.customer.subscription.creditsRemaining,
    authRedirectUrl: buildStorefrontAuthRedirectUrl(details),
    storefrontPortalUrl: details.storefrontPortalUrl || buildStorefrontPortalUrl(details.returnOrigin)
  };
}

async function creditFirstClassCheckoutCustomer(customer: Customer, details: WebhookDetails) {
  const updated = await mutateStore((store) => {
    const current = store.customers.find((item) => item.id === customer.id);
    if (!current) {
      throw new Error("customer disappeared while crediting the account");
    }
    const currentCredits = Number(current.subscription.creditsRemaining || 0);
    const existingProcessedIds = current.samsarAccount?.processedCheckoutSessionIds || [];
    const paymentRecordId = getPaymentRecordId(details);
    const alreadyProcessed = Boolean(paymentRecordId && existingProcessedIds.includes(paymentRecordId));
    const checkoutSessionIds = paymentRecordId && !existingProcessedIds.includes(paymentRecordId)
      ? [...existingProcessedIds, paymentRecordId]
      : existingProcessedIds;
    const creditedBalance = alreadyProcessed
      ? currentCredits
      : currentCredits + details.creditsPurchased;
    const nextCredits = details.remainingCredits ?? creditedBalance;
    return upsertCustomer(store, {
      id: current.id,
      samsarApiKeyAlias: details.apiKey
        ? current.samsarApiKeyAlias || "samsar-user-api-key"
        : current.samsarApiKeyAlias,
      samsarAccount: {
        ...(current.samsarAccount || {}),
        email: details.email || current.samsarAccount?.email,
        username: details.username || current.samsarAccount?.username || deriveAccountName(details.email),
        userId: details.userId || current.samsarAccount?.userId || current.id,
        authToken: details.authToken || current.samsarAccount?.authToken,
        refreshToken: details.refreshToken || current.samsarAccount?.refreshToken,
        expiryDate: details.expiryDate || current.samsarAccount?.expiryDate,
        refreshTokenExpiresAt: details.refreshTokenExpiresAt || current.samsarAccount?.refreshTokenExpiresAt,
        apiKey: details.apiKey || current.samsarAccount?.apiKey,
        checkoutSessionId: details.checkoutSessionId || current.samsarAccount?.checkoutSessionId,
        checkoutUrl: details.checkoutUrl || current.samsarAccount?.checkoutUrl,
        paymentStatusEndpoint: details.paymentStatusEndpoint || current.samsarAccount?.paymentStatusEndpoint,
        externalPaymentId: details.externalPaymentId || current.samsarAccount?.externalPaymentId,
        processedCheckoutSessionIds: checkoutSessionIds,
        loginUrl: details.loginUrl || current.samsarAccount?.loginUrl,
        passwordSetupUrl: details.passwordSetupUrl || current.samsarAccount?.passwordSetupUrl,
        updatedAt: nowIso()
      },
      subscription: {
        status: nextCredits > 0 ? "active" : "not_started",
        creditsRemaining: nextCredits
      }
    });
  });
  return {
    customer: updated,
    linkedExternalUser: false,
    firstClassUser: true,
    warning: undefined
  };
}

function findTargetCustomer(store: SuperReferralsStore, details: WebhookDetails) {
  const email = details.email;
  const byCustomerEmail = email
    ? store.customers.find((customer) => sameEmail(customer.samsarAccount?.email, email))
    : undefined;
  if (byCustomerEmail) {
    return byCustomerEmail;
  }

  const bySubAccountEmail = email
    ? store.subAccounts.find((account) => sameEmail(account.email, email))
    : undefined;
  if (bySubAccountEmail) {
    const parent = store.customers.find((customer) => customer.id === bySubAccountEmail.customerId);
    if (parent) {
      return parent;
    }
  }

  const byCheckout = details.checkoutSessionId
    ? store.customers.find((customer) => customer.samsarAccount?.checkoutSessionId === details.checkoutSessionId)
    : undefined;
  if (byCheckout) {
    return byCheckout;
  }

  return details.customerId
    ? store.customers.find((customer) => customer.id === details.customerId)
    : undefined;
}

function extractWebhookDetails(payload: Record<string, unknown>): WebhookDetails {
  const metadata = extractMetadata(payload);
  const amountCents = firstNumber(payload, [
    ["amountCents"],
    ["amount_cents"],
    ["amount_total"],
    ["data", "object", "amount_total"],
    ["data", "object", "amount"],
    ["checkout", "amountCents"],
    ["checkout", "amount_cents"]
  ]) ?? numberFromUnknown(metadata.amountCents) ?? numberFromUnknown(metadata.amount_cents);
  const creditsPurchased = firstNumber(payload, [
    ["credits"],
    ["creditsPurchased"],
    ["credits_purchased"],
    ["creditsGranted"],
    ["credits_granted"],
    ["data", "object", "credits"],
    ["data", "object", "creditsGranted"]
  ]) ?? numberFromUnknown(metadata.credits) ?? numberFromUnknown(metadata.creditsGranted) ?? amountCents ?? 0;

  return {
    eventType: firstString(payload, [["type"], ["event"], ["eventType"], ["event_type"]]),
    status: firstString(payload, [
      ["status"],
      ["paymentStatus"],
      ["payment_status"],
      ["sessionStatus"],
      ["session_status"],
      ["checkout", "status"],
      ["data", "object", "status"],
      ["data", "object", "payment_status"]
    ]),
    checkoutSessionId: firstString(payload, [
      ["checkoutSessionId"],
      ["checkout_session_id"],
      ["sessionId"],
      ["session_id"],
      ["checkout", "checkoutSessionId"],
      ["checkout", "checkout_session_id"],
      ["checkout", "id"],
      ["data", "object", "checkoutSessionId"],
      ["data", "object", "checkout_session_id"],
      ["data", "object", "id"]
    ]) || stringFromUnknown(metadata.checkoutSessionId || metadata.checkout_session_id),
    paymentIntentId: firstString(payload, [
      ["paymentIntentId"],
      ["payment_intent_id"],
      ["paymentIntent"],
      ["payment_intent"],
      ["data", "object", "payment_intent"]
    ]),
    externalPaymentId: firstString(payload, [
      ["externalPaymentId"],
      ["external_payment_id"],
      ["data", "object", "externalPaymentId"],
      ["data", "object", "external_payment_id"]
    ]),
    paymentStatusEndpoint: firstString(payload, [["paymentStatusEndpoint"], ["payment_status_endpoint"]]),
    checkoutUrl: firstString(payload, [["checkoutUrl"], ["checkout_url"], ["url"], ["data", "object", "url"]]),
    customerId: firstString(payload, [
      ["customerId"],
      ["customer_id"],
      ["metadata", "superreferralsCustomerId"],
      ["data", "object", "metadata", "superreferralsCustomerId"]
    ]) || stringFromUnknown(metadata.superreferralsCustomerId || metadata.customerId || metadata.customer_id),
    email: normalizeEmail(firstString(payload, [
      ["customerEmail"],
      ["customer_email"],
      ["email"],
      ["account", "email"],
      ["user", "email"],
      ["checkout", "customerEmail"],
      ["checkout", "customer_email"],
      ["checkout", "customer_details", "email"],
      ["data", "object", "customer_email"],
      ["data", "object", "customer_details", "email"],
      ["data", "object", "metadata", "superreferralsAccountEmail"]
    ]) || stringFromUnknown(metadata.superreferralsAccountEmail || metadata.customerEmail || metadata.email)),
    username: firstString(payload, [["username"], ["user", "username"], ["account", "username"]]),
    userId: firstString(payload, [["userId"], ["user_id"], ["user", "id"], ["account", "id"]]),
    authToken: firstString(payload, [["authToken"], ["auth_token"], ["accessToken"], ["access_token"], ["token"], ["account", "authToken"]]),
    refreshToken: firstString(payload, [["refreshToken"], ["refresh_token"], ["account", "refreshToken"], ["account", "refresh_token"]]),
    expiryDate: firstString(payload, [["expiryDate"], ["expiry_date"], ["expiresAt"], ["expires_at"], ["account", "expiryDate"], ["account", "expiresAt"]]),
    refreshTokenExpiresAt: firstString(payload, [
      ["refreshTokenExpiresAt"],
      ["refresh_token_expires_at"],
      ["account", "refreshTokenExpiresAt"],
      ["account", "refresh_token_expires_at"]
    ]),
    apiKey: extractApiKey(payload),
    loginUrl: firstString(payload, [["loginUrl"], ["login_url"], ["account", "loginUrl"], ["data", "object", "loginUrl"]]),
    passwordSetupUrl: firstString(payload, [
      ["passwordSetupUrl"],
      ["password_setup_url"],
      ["passwordSetupURL"],
      ["account", "passwordSetupUrl"],
      ["data", "object", "passwordSetupUrl"],
      ["data", "object", "password_setup_url"]
    ]),
    returnOrigin: firstString(payload, [
      ["returnOrigin"],
      ["return_origin"],
      ["metadata", "returnOrigin"],
      ["data", "object", "metadata", "returnOrigin"]
    ]) || stringFromUnknown(metadata.returnOrigin || metadata.return_origin),
    authRedirectUrl: firstString(payload, [
      ["authRedirectUrl"],
      ["auth_redirect_url"],
      ["welcomeRedirectUrl"],
      ["welcome_redirect_url"],
      ["metadata", "authRedirectUrl"],
      ["metadata", "welcomeRedirectUrl"],
      ["data", "object", "metadata", "authRedirectUrl"],
      ["data", "object", "metadata", "welcomeRedirectUrl"]
    ]) || stringFromUnknown(metadata.authRedirectUrl || metadata.auth_redirect_url || metadata.welcomeRedirectUrl || metadata.welcome_redirect_url),
    storefrontPortalUrl: firstString(payload, [
      ["storefrontPortalUrl"],
      ["storefront_portal_url"],
      ["metadata", "storefrontPortalUrl"],
      ["data", "object", "metadata", "storefrontPortalUrl"]
    ]) || stringFromUnknown(metadata.storefrontPortalUrl),
    creditsPurchased: Math.max(0, Math.round(creditsPurchased)),
    remainingCredits: firstNumber(payload, [
      ["remainingCredits"],
      ["remaining_credits"],
      ["generationCredits"],
      ["data", "object", "remainingCredits"],
      ["data", "object", "generationCredits"]
    ]) ?? numberFromUnknown(metadata.remainingCredits || metadata.remaining_credits)
  };
}

function buildStorefrontAuthRedirectUrl(details: WebhookDetails) {
  if (!details.authToken) {
    return undefined;
  }
  const portalUrl = details.authRedirectUrl || buildStorefrontAuthCallbackUrl(details.returnOrigin);
  if (!portalUrl) {
    return undefined;
  }
  try {
    const url = new URL(portalUrl);
    url.searchParams.set("authToken", details.authToken);
    if (details.refreshToken) {
      url.searchParams.set("refreshToken", details.refreshToken);
    }
    if (details.expiryDate) {
      url.searchParams.set("expiryDate", details.expiryDate);
    }
    if (details.refreshTokenExpiresAt) {
      url.searchParams.set("refreshTokenExpiresAt", details.refreshTokenExpiresAt);
    }
    if (details.checkoutSessionId) {
      url.searchParams.set("checkoutSessionId", details.checkoutSessionId);
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function buildStorefrontAuthCallbackUrl(returnOrigin?: string) {
  const origin = returnOrigin?.replace(/\/+$/, "");
  if (!origin) {
    return undefined;
  }
  try {
    return new URL("/samsar/callback", origin).toString();
  } catch {
    return undefined;
  }
}

function buildStorefrontPortalUrl(returnOrigin?: string) {
  const origin = returnOrigin?.replace(/\/+$/, "");
  if (!origin) {
    return undefined;
  }
  try {
    return new URL("/dashboard", origin).toString();
  } catch {
    return undefined;
  }
}

function isSuccessfulCheckout(details: WebhookDetails) {
  const eventType = `${details.eventType || ""}`.toLowerCase();
  const status = `${details.status || ""}`.toLowerCase();
  const eventStatus = `${eventType} ${status}`;
  if (!eventStatus.trim()) {
    return false;
  }
  if (/(fail|failed|cancel|canceled|cancelled|expired|unpaid|pending|requires|open|incomplete)/.test(eventStatus)) {
    return false;
  }
  if (/payment_intent\.succeeded/.test(eventType)) {
    return true;
  }
  return /(success|succeed|succeeded|paid|complete|completed)/.test(status);
}

function getPaymentRecordId(details: WebhookDetails) {
  return details.checkoutSessionId || details.paymentIntentId || details.externalPaymentId;
}

function extractMetadata(payload: Record<string, unknown>) {
  return [
    payload.metadata,
    valueAtPath(payload, ["data", "object", "metadata"]),
    valueAtPath(payload, ["checkout", "metadata"])
  ].reduce<Record<string, unknown>>((merged, value) => {
    if (isRecord(value)) {
      return { ...merged, ...value };
    }
    return merged;
  }, {});
}

function extractApiKey(payload: Record<string, unknown>) {
  const direct = firstString(payload, [
    ["apiKey"],
    ["api_key"],
    ["parentApiKey"],
    ["parent_api_key"],
    ["account", "apiKey"],
    ["account", "api_key"],
    ["user", "apiKey"],
    ["user", "api_key"],
    ["data", "object", "apiKey"],
    ["data", "object", "api_key"]
  ]);
  if (direct) {
    return direct;
  }
  for (const path of [["userApiKeys"], ["account", "userApiKeys"], ["data", "object", "userApiKeys"]]) {
    const value = valueAtPath(payload, path);
    if (Array.isArray(value)) {
      const apiKey = value
        .map((item) => isRecord(item) ? stringFromUnknown(item.apiKey || item.api_key) : undefined)
        .find(Boolean);
      if (apiKey) {
        return apiKey;
      }
    }
  }
  return undefined;
}

function firstString(record: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    const value = stringFromUnknown(valueAtPath(record, path));
    if (value) {
      return value;
    }
  }
  return undefined;
}

function firstNumber(record: Record<string, unknown>, paths: string[][]) {
  for (const path of paths) {
    const value = numberFromUnknown(valueAtPath(record, path));
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function valueAtPath(record: Record<string, unknown>, path: string[]) {
  let current: unknown = record;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringFromUnknown(value: unknown) {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function numberFromUnknown(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

function normalizeEmail(value?: string) {
  const normalized = value?.trim().toLowerCase();
  return normalized && normalized.includes("@") ? normalized : undefined;
}

function sameEmail(left?: string, right?: string) {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function deriveAccountName(email?: string) {
  const localPart = email?.split("@")[0]?.trim();
  if (!localPart) {
    return undefined;
  }
  return localPart
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || localPart;
}
