import SamsarClient from "samsar-js";
import { appBaseUrl, isProviderMock } from "./env";
import { nowIso } from "./ids";
import {
  hasStoredSamsarAppKey,
  requireSamsarAppSecret,
  secureSamsarAppKey,
  type StoredSamsarAppKeyCredential
} from "./samsar-app-credentials";
import { samsarApiRootUrl } from "./samsar-api";
import type { Customer } from "./types";

type SamsarJsExternalUserIdentity = {
  provider: string;
  external_user_id?: string;
  externalUserId?: string;
  external_app_id?: string;
  externalAppId?: string;
  external_company_id?: string;
  externalCompanyId?: string;
  external_account_id?: string;
  externalAccountId?: string;
  email?: string;
  username?: string;
  display_name?: string;
  displayName?: string;
  user_type?: string;
  userType?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

type SamsarSdkResult = {
  data: unknown;
  creditsRemaining?: number;
  headers?: Record<string, string>;
};

type SamsarSdkClient = {
  createV2UserRechargeCredits(
    payload: {
      amount: number;
      email: string;
      redirect_url: string;
      metadata?: Record<string, string | number | boolean>;
      webhookUrl?: string;
    }
  ): Promise<SamsarSdkResult>;
  refreshV2UserToken(payload: string | { refreshToken: string }): Promise<SamsarSdkResult>;
  createV2UserAppKey(payload: {
    secret: string;
    metadata?: Record<string, unknown>;
  }): Promise<SamsarSdkResult>;
  getV2UserCredits(): Promise<SamsarSdkResult>;
  getV2Credits(): Promise<SamsarSdkResult>;
  verifyClientSession(payload: { authToken: string }): Promise<SamsarSdkResult>;
  createExternalUserSession(externalUser: SamsarJsExternalUserIdentity): Promise<SamsarSdkResult>;
  getExternalCreditsBalance(externalUser: SamsarJsExternalUserIdentity): Promise<SamsarSdkResult>;
  createExternalUserLoginToken(
    externalUser: SamsarJsExternalUserIdentity,
    options?: { redirect?: string }
  ): Promise<SamsarSdkResult>;
};

export interface SamsarProcessorCreditCheckoutInput {
  amountCents: number;
  apiKey?: string;
  authToken?: string;
  appBaseUrl?: string;
  customerEmail?: string;
  externalUser?: SamsarJsExternalUserIdentity;
  metadata?: Record<string, string | number | boolean>;
  redirectUrl?: string;
  webhookUrl?: string;
}

export interface SamsarProcessorCreditCheckout {
  url: string;
  checkoutSessionId: string;
  amountCents: number;
  credits: number;
  currency: string;
  paymentStatusEndpoint?: string;
  paymentIntentId?: string | null;
  externalPaymentId?: string | null;
}

export interface SamsarProcessorAccountSession {
  authToken: string;
  refreshToken?: string;
  expiryDate?: string;
  refreshTokenExpiresAt?: string;
  userId: string;
  email: string;
  username: string;
  apiKey?: string;
  appKey?: StoredSamsarAppKeyCredential;
  creditsRemaining: number;
  raw: Record<string, unknown>;
}

type SamsarClientCredentialOptions = {
  apiKey?: string;
  appKey?: string;
  appSecret?: string;
};

export async function createSamsarProcessorCreditCheckout(input: SamsarProcessorCreditCheckoutInput) {
  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("amountCents must be greater than zero");
  }

  const email = input.customerEmail?.trim().toLowerCase();
  if (!email) {
    throw new Error("Email is required to purchase SuperReferrals credits.");
  }

  const returnBaseUrl = (input.appBaseUrl || appBaseUrl()).replace(/\/+$/, "");
  const redirectUrl = input.redirectUrl || `${returnBaseUrl}/samsar/callback`;
  if (isProviderMock("SAMSAR")) {
    return mockCreditCheckout(input, amountCents, redirectUrl);
  }

  const response = await (await samsarSdkClient()).createV2UserRechargeCredits({
    amount: amountCents / 100,
    email,
    redirect_url: redirectUrl,
    metadata: {
      sourceProject: "superreferrals",
      returnOrigin: returnBaseUrl,
      storefrontPortalUrl: `${returnBaseUrl}/dashboard`,
      authRedirectUrl: redirectUrl,
      ...(input.metadata || {})
    },
    webhookUrl: input.webhookUrl
  });
  return normalizeCheckoutResponse(recordValue(response.data), amountCents);
}

export async function loginSamsarProcessorAccount({
  email,
  password
}: {
  email: string;
  password: string;
}): Promise<SamsarProcessorAccountSession> {
  const trimmedEmail = email.trim().toLowerCase();
  if (!trimmedEmail || !password.trim()) {
    throw new Error("Email and password are required to sign in to an existing SuperReferrals account.");
  }

  if (isProviderMock("SAMSAR")) {
    return mockAccountSession({ email: trimmedEmail });
  }

  const data = await requestSamsarJson(`${samsarApiRootUrl()}/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: trimmedEmail, password })
  }, "Unable to sign in to SuperReferrals account");
  const tokenFields = extractTokenFields(data);
  if (!tokenFields.authToken) {
    throw new Error("SuperReferrals sign-in did not return an auth token.");
  }
  const credits = await fetchSamsarProcessorCredits(tokenFields.authToken);
  return {
    ...tokenFields,
    userId: firstStringValue(data._id, data.id, data.userId, data.user_id),
    email: firstStringValue(data.email, trimmedEmail),
    username: firstStringValue(data.username, data.displayName) ||
      trimmedEmail.split("@")[0] ||
      "customer",
    apiKey: extractSamsarApiKey(data),
    creditsRemaining: credits.remainingCredits,
    raw: data
  };
}

export async function verifySamsarProcessorAuthToken(
  input: string | {
    authToken?: string;
    refreshToken?: string;
    expiryDate?: string;
    refreshTokenExpiresAt?: string;
  }
): Promise<SamsarProcessorAccountSession> {
  const cleanAuthToken = typeof input === "string" ? input.trim() : input.authToken?.trim() || "";
  if (!cleanAuthToken) {
    throw new Error("authToken is required to restore a SuperReferrals account session.");
  }

  if (isProviderMock("SAMSAR")) {
    return mockAccountSession({
      authToken: cleanAuthToken,
      refreshToken: typeof input === "string" ? undefined : input.refreshToken,
      expiryDate: typeof input === "string" ? undefined : input.expiryDate,
      refreshTokenExpiresAt: typeof input === "string" ? undefined : input.refreshTokenExpiresAt
    });
  }

  const response = await (await samsarSdkClient(cleanAuthToken)).verifyClientSession({ authToken: cleanAuthToken });
  const data = recordValue(response.data);
  const account = recordValue(data.account);
  const user = recordValue(data.user);
  const tokenFields = extractTokenFields(data, {
    authToken: cleanAuthToken,
    refreshToken: typeof input === "string" ? undefined : input.refreshToken,
    expiryDate: typeof input === "string" ? undefined : input.expiryDate,
    refreshTokenExpiresAt: typeof input === "string" ? undefined : input.refreshTokenExpiresAt
  });
  const email = firstStringValue(data.email, account.email, user.email);
  if (!email) {
    throw new Error("SuperReferrals auth token verification did not return an account email.");
  }

  let creditsRemaining = extractSamsarCredits(data);
  try {
    const credits = await fetchSamsarProcessorCredits(tokenFields.authToken);
    creditsRemaining = credits.remainingCredits;
  } catch {
    // Keep the verified-token payload balance when the dedicated credits route is temporarily unavailable.
  }

  return {
    ...tokenFields,
    userId: firstStringValue(data._id, data.id, data.userId, data.user_id, account._id, account.id, user._id, user.id),
    email,
    username: firstStringValue(data.username, data.displayName, account.username, account.displayName, user.username, user.displayName) ||
      email.split("@")[0] ||
      "customer",
    apiKey: extractSamsarApiKey(data),
    creditsRemaining,
    raw: data
  };
}

export async function refreshSamsarProcessorAuthToken(refreshToken: string): Promise<SamsarProcessorAccountSession> {
  const cleanRefreshToken = refreshToken.trim();
  if (!cleanRefreshToken) {
    throw new Error("refreshToken is required to refresh SuperReferrals account credentials.");
  }
  if (isProviderMock("SAMSAR")) {
    return mockAccountSession({ refreshToken: cleanRefreshToken });
  }
  const response = await (await samsarSdkClient()).refreshV2UserToken(cleanRefreshToken);
  const tokenFields = extractTokenFields(recordValue(response.data), { refreshToken: cleanRefreshToken });
  return verifySamsarProcessorAuthToken(tokenFields);
}

export async function createSamsarProcessorAppKeyCredential(
  authToken: string,
  metadata: Record<string, unknown> = {}
): Promise<StoredSamsarAppKeyCredential> {
  const cleanAuthToken = authToken.trim();
  if (!cleanAuthToken) {
    throw new Error("authToken is required to generate a Samsar APP_KEY.");
  }
  if (isProviderMock("SAMSAR")) {
    return secureSamsarAppKey(`mock_samsar_app_key_${Date.now()}`, {
      appKeyPrefix: "mock",
      appKeyLast4: String(Date.now()).slice(-4),
      appKeyCreatedAt: nowIso(),
      appKeyUpdatedAt: nowIso()
    });
  }
  const response = await (await samsarSdkClient({ apiKey: cleanAuthToken })).createV2UserAppKey({
    secret: requireSamsarAppSecret(),
    metadata
  });
  const data = recordValue(response.data);
  const appKey = firstStringValue(data.appKey, data.app_key);
  if (!appKey) {
    throw new Error("Samsar APP_KEY generation did not return an app key.");
  }
  const record = recordValue(data.appKeyRecord || data.app_key_record);
  return secureSamsarAppKey(appKey, {
    appKeyPrefix: firstStringValue(record.appKeyPrefix, record.app_key_prefix),
    appKeyLast4: firstStringValue(record.appKeyLast4, record.app_key_last4) || appKey.slice(-4),
    appKeyCreatedAt: firstStringValue(record.createdAt, record.created_at) || nowIso(),
    appKeyUpdatedAt: firstStringValue(record.updatedAt, record.updated_at) || nowIso(),
    appKeyExpiresAt: firstStringValue(data.expiresAt, data.expires_at, record.expiresAt, record.expires_at)
  });
}

export async function provisionSamsarProcessorAppKeyIfMissing(
  customer: Pick<Customer, "id" | "name" | "samsarAccount">,
  authToken?: string
) {
  if (hasStoredSamsarAppKey(customer)) {
    return undefined;
  }
  const cleanAuthToken = authToken?.trim() || customer.samsarAccount?.authToken?.trim();
  if (!cleanAuthToken) {
    return undefined;
  }
  return createSamsarProcessorAppKeyCredential(cleanAuthToken, {
    sourceProject: "superreferrals",
    superreferralsCustomerId: customer.id,
    storefrontName: customer.name,
    samsarUserId: customer.samsarAccount?.userId,
    email: customer.samsarAccount?.email
  });
}

export async function fetchSamsarProcessorCredits(credential: string | SamsarClientCredentialOptions) {
  const credentialOptions = typeof credential === "string" ? { apiKey: credential.trim() } : credential;
  if (!credentialOptions.apiKey && !credentialOptions.appKey) {
    throw new Error("A Samsar auth token, API key, or APP_KEY is required to fetch SuperReferrals credits.");
  }
  if (isProviderMock("SAMSAR")) {
    return {
      remainingCredits: 5000,
      lastTopUp: undefined
    };
  }
  const client = await samsarSdkClient(credentialOptions);
  const response = await client.getV2UserCredits().catch(() => client.getV2Credits());
  const data = recordValue(response.data);
  return {
    remainingCredits: response.creditsRemaining ?? extractSamsarCredits(data),
    lastTopUp: data.lastTopUp
  };
}

export async function fetchSamsarProcessorCreditCheckoutStatus(paymentStatusEndpoint: string) {
  const endpoint = absoluteSamsarUrl(paymentStatusEndpoint);
  return requestSamsarJson(endpoint, {
    method: "GET"
  }, "Unable to verify SuperReferrals checkout status");
}

export function buildCustomerSamsarExternalUser(customer: Customer, email?: string): SamsarJsExternalUserIdentity {
  const account = customer.samsarAccount;
  return {
    provider: account?.externalProvider || "superreferrals",
    external_user_id: account?.externalUserId || customer.id,
    external_app_id: "superreferrals",
    external_company_id: customer.id,
    external_account_id: customer.id,
    email: email || account?.email,
    username: account?.username || customer.name || customer.id,
    display_name: customer.name,
    user_type: "storefront_customer",
    metadata: {
      superreferralsCustomerId: customer.id,
      superreferralsParentCustomerId: customer.id,
      superreferralsAccountEmail: email || account?.email || "",
      storefrontName: customer.name
    }
  };
}

export async function ensureSamsarProcessorSubAccount(externalUser: SamsarJsExternalUserIdentity, apiKey?: string) {
  if (isProviderMock("SAMSAR")) {
    return {
      externalApiKey: `mock_external_${externalUser.external_user_id || externalUser.externalUserId || "customer"}`,
      creditsRemaining: 0,
      raw: { mock: true }
    };
  }
  const response = await (await samsarSdkClient(requireExplicitSamsarCredential(apiKey, "external-user session"))).createExternalUserSession(externalUser);
  const data = recordValue(response.data);
  return {
    externalApiKey: String(data.external_api_key || data.externalApiKey || ""),
    creditsRemaining: extractSamsarCredits(data),
    raw: data
  };
}

export async function refreshSamsarProcessorSubAccountCredits(externalUser: SamsarJsExternalUserIdentity, apiKey?: string) {
  if (isProviderMock("SAMSAR")) {
    return {
      creditsRemaining: 0,
      raw: { mock: true }
    };
  }
  const response = await (await samsarSdkClient(requireExplicitSamsarCredential(apiKey, "external-user credit refresh"))).getExternalCreditsBalance(externalUser);
  const data = recordValue(response.data);
  return {
    creditsRemaining: extractSamsarCredits(data),
    raw: data
  };
}

export async function createSamsarProcessorSubAccountLoginLink(
  externalUser: SamsarJsExternalUserIdentity,
  options: { redirect?: string; apiKey?: string } = {}
) {
  if (isProviderMock("SAMSAR")) {
    const loginToken = `mock_login_${externalUser.external_user_id || externalUser.externalUserId || "customer"}`;
    return {
      loginToken,
      loginUrl: `${samsarApiRootUrl()}/external/studio?loginToken=${encodeURIComponent(loginToken)}`,
      expiresInSeconds: 900,
      raw: { mock: true }
    };
  }
  const response = await (await samsarSdkClient(requireExplicitSamsarCredential(options.apiKey, "external-user login link"))).createExternalUserLoginToken(externalUser, {
    redirect: options.redirect || "/external/studio"
  });
  const data = recordValue(response.data);
  return {
    loginToken: String(data.loginToken || ""),
    loginUrl: String(data.loginUrl || ""),
    expiresInSeconds: typeof data.expiresInSeconds === "number" ? data.expiresInSeconds : undefined,
    raw: data
  };
}

async function requestSamsarJson(url: string, init: RequestInit, fallback: string) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`${fallback}: unable to reach the production SuperReferrals API at ${samsarApiRootUrl()}.${detail}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || fallback);
  }
  return data as Record<string, unknown>;
}

function absoluteSamsarUrl(pathOrUrl: string) {
  try {
    return new URL(pathOrUrl).toString();
  } catch {
    const path = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
    return `${samsarApiRootUrl()}${path}`;
  }
}

function normalizeCheckoutResponse(data: Record<string, unknown>, amountCents: number): SamsarProcessorCreditCheckout {
  return {
    url: String(data.url || data.checkoutUrl || ""),
    checkoutSessionId: String(data.checkoutSessionId || data.checkout_session_id || data.sessionId || data.id || ""),
    amountCents: Number(data.amountCents || data.amount_cents || amountCents),
    credits: Number(data.credits || amountCents),
    currency: String(data.currency || "USD"),
    paymentStatusEndpoint: typeof data.paymentStatusEndpoint === "string"
      ? data.paymentStatusEndpoint
      : typeof data.payment_status_endpoint === "string"
        ? data.payment_status_endpoint
        : undefined,
    paymentIntentId: typeof data.paymentIntentId === "string" ? data.paymentIntentId : null,
    externalPaymentId: typeof data.external_payment_id === "string"
      ? data.external_payment_id
      : typeof data.externalPaymentId === "string"
        ? data.externalPaymentId
        : null
  };
}

async function samsarSdkClient(credential: string | SamsarClientCredentialOptions = {}) {
  const options = typeof credential === "string"
    ? { apiKey: credential.trim() }
    : credential;
  return new SamsarClient({
    apiKey: options.apiKey?.trim() || undefined,
    appKey: options.appKey?.trim() || undefined,
    appSecret: options.appSecret?.trim() || undefined,
    baseUrl: samsarApiRootUrl()
  });
}

function mockCreditCheckout(input: SamsarProcessorCreditCheckoutInput, amountCents: number, redirectUrl: string): SamsarProcessorCreditCheckout {
  const authToken = `mock_samsar_auth_${Date.now()}`;
  const refreshToken = `mock_samsar_refresh_${Date.now()}`;
  const callbackUrl = new URL(redirectUrl);
  callbackUrl.searchParams.set("authToken", authToken);
  callbackUrl.searchParams.set("refreshToken", refreshToken);
  callbackUrl.searchParams.set("expiryDate", new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString());
  if (input.customerEmail) {
    callbackUrl.searchParams.set("email", input.customerEmail);
  }
  return {
    url: callbackUrl.toString(),
    checkoutSessionId: `mock_checkout_${Date.now()}`,
    amountCents,
    credits: amountCents,
    currency: "USD",
    paymentStatusEndpoint: undefined,
    paymentIntentId: null,
    externalPaymentId: null
  };
}

function mockAccountSession(input: {
  authToken?: string;
  refreshToken?: string;
  expiryDate?: string;
  refreshTokenExpiresAt?: string;
  email?: string;
} = {}): SamsarProcessorAccountSession {
  const email = input.email || "mock-storefront@samsar.local";
  return {
    authToken: input.authToken || `mock_samsar_auth_${Date.now()}`,
    refreshToken: input.refreshToken || `mock_samsar_refresh_${Date.now()}`,
    expiryDate: input.expiryDate || new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: input.refreshTokenExpiresAt,
    userId: `mock_user_${email.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`,
    email,
    username: email.split("@")[0] || "customer",
    creditsRemaining: 5000,
    raw: { mock: true }
  };
}

function extractTokenFields(
  data: Record<string, unknown>,
  fallback: Partial<Pick<SamsarProcessorAccountSession, "authToken" | "refreshToken" | "expiryDate" | "refreshTokenExpiresAt">> = {}
) {
  const account = recordValue(data.account);
  const user = recordValue(data.user);
  const authToken = firstStringValue(
    data.authToken,
    data.auth_token,
    data.accessToken,
    data.access_token,
    data.token,
    account.authToken,
    account.auth_token,
    account.token,
    user.authToken,
    user.auth_token,
    fallback.authToken
  );
  if (!authToken) {
    throw new Error("SuperReferrals did not return an auth token.");
  }
  return {
    authToken,
    refreshToken: firstStringValue(
      data.refreshToken,
      data.refresh_token,
      account.refreshToken,
      account.refresh_token,
      user.refreshToken,
      user.refresh_token,
      fallback.refreshToken
    ) || undefined,
    expiryDate: firstStringValue(
      data.expiryDate,
      data.expiry_date,
      data.expiresAt,
      data.expires_at,
      account.expiryDate,
      account.expiresAt,
      user.expiryDate,
      user.expiresAt,
      fallback.expiryDate
    ) || undefined,
    refreshTokenExpiresAt: firstStringValue(
      data.refreshTokenExpiresAt,
      data.refresh_token_expires_at,
      account.refreshTokenExpiresAt,
      account.refresh_token_expires_at,
      user.refreshTokenExpiresAt,
      user.refresh_token_expires_at,
      fallback.refreshTokenExpiresAt
    ) || undefined
  };
}

function extractSamsarCredits(data: Record<string, unknown>) {
  return (
    extractNumber(data.remainingCredits) ??
    extractNumber(data.remaining_credits) ??
    extractNumber(data.creditsRemaining) ??
    extractNumber(data.credits_remaining) ??
    extractNumber(data.generationCredits) ??
    extractNumber(data.credits) ??
    extractExternalUserCredits(data.externalUser) ??
    extractExternalUserCredits(data.external_user) ??
    0
  );
}

function extractExternalUserCredits(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  return (
    extractNumber(record.generation_credits) ??
    extractNumber(record.generationCredits) ??
    extractNumber(record.creditsRemaining) ??
    extractNumber(record.remainingCredits) ??
    extractNumber(record.remaining_credits)
  );
}

function extractNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function extractSamsarApiKey(data: Record<string, unknown>) {
  const userApiKeys = Array.isArray(data.userApiKeys) ? data.userApiKeys : [];
  for (const item of userApiKeys) {
    if (item && typeof item === "object" && "apiKey" in item) {
      const apiKey = String((item as { apiKey?: unknown }).apiKey || "");
      if (apiKey) {
        return apiKey;
      }
    }
  }
  return undefined;
}

function requireExplicitSamsarCredential(value: string | undefined, action: string) {
  const clean = value?.trim();
  if (!clean) {
    throw new Error(`A storefront Samsar auth token or API key is required for ${action}.`);
  }
  return clean;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstStringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return "";
}
