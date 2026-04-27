import { appBaseUrl, env, isProviderMock } from "./env";
import { samsarApiRootUrl, samsarApiV1Url } from "./samsar-api";
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

type SamsarSdkResult = { data: unknown };

type SamsarSdkClient = {
  createExternalUserSession(externalUser: SamsarJsExternalUserIdentity): Promise<SamsarSdkResult>;
  getExternalCreditsBalance(externalUser: SamsarJsExternalUserIdentity): Promise<SamsarSdkResult>;
  createExternalUserLoginToken(
    externalUser: SamsarJsExternalUserIdentity,
    options?: { redirect?: string }
  ): Promise<SamsarSdkResult>;
  createExternalCreditsRecharge(
    externalUser: SamsarJsExternalUserIdentity,
    credits: number
  ): Promise<SamsarSdkResult>;
};

export interface SamsarProcessorCreditCheckoutInput {
  amountCents: number;
  authToken?: string;
  customerEmail?: string;
  externalUser?: SamsarJsExternalUserIdentity;
  metadata?: Record<string, string | number | boolean>;
}

export interface SamsarProcessorCreditCheckout {
  url: string;
  checkoutSessionId: string;
  amountCents: number;
  credits: number;
  currency: string;
  paymentStatusEndpoint?: string;
  paymentIntentId?: string | null;
}

export async function createSamsarProcessorCreditCheckout(input: SamsarProcessorCreditCheckoutInput) {
  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("amountCents must be greater than zero");
  }

  if (input.authToken) {
    return createAuthenticatedCreditRecharge(input.authToken, amountCents);
  }

  if (input.externalUser) {
    return createExternalCreditRecharge(input.externalUser, amountCents);
  }

  return createAnonymousCreditCheckout(input, amountCents);
}

export interface SamsarProcessorAccountSession {
  authToken: string;
  userId: string;
  email: string;
  username: string;
  apiKey?: string;
  creditsRemaining: number;
  raw: Record<string, unknown>;
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
    throw new Error("Email and password are required to login to an existing Samsar account.");
  }

  const data = await requestSamsarJson(`${samsarApiRootUrl()}/users/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: trimmedEmail, password })
  }, "Unable to login to Samsar account");
  const authToken = String(data.authToken || data.token || "");
  if (!authToken) {
    throw new Error("Samsar login did not return an auth token.");
  }
  const credits = await fetchSamsarProcessorCredits(authToken);
  return {
    authToken,
    userId: String(data._id || data.id || data.userId || ""),
    email: String(data.email || trimmedEmail),
    username: String(data.username || data.displayName || trimmedEmail.split("@")[0] || "customer"),
    apiKey: extractSamsarApiKey(data),
    creditsRemaining: credits.remainingCredits,
    raw: data
  };
}

export async function fetchSamsarProcessorCredits(authToken: string) {
  const data = await requestSamsarJson(`${samsarApiV1Url()}/credits`, {
    method: "GET",
    headers: { authorization: `Bearer ${authToken}` }
  }, "Unable to fetch Samsar credits");
  return {
    remainingCredits: Number(data.remainingCredits || data.remaining_credits || data.generationCredits || 0),
    lastTopUp: data.lastTopUp
  };
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
      storefrontName: customer.name
    }
  };
}

export async function ensureSamsarProcessorSubAccount(externalUser: SamsarJsExternalUserIdentity) {
  if (isProviderMock("SAMSAR")) {
    return {
      externalApiKey: `mock_external_${externalUser.external_user_id || externalUser.externalUserId || "customer"}`,
      creditsRemaining: 0,
      raw: { mock: true }
    };
  }
  const response = await (await samsarSdkClient()).createExternalUserSession(externalUser);
  const data = response.data as Record<string, unknown>;
  return {
    externalApiKey: String(data.external_api_key || data.externalApiKey || ""),
    creditsRemaining: extractSamsarCredits(data),
    raw: data
  };
}

export async function refreshSamsarProcessorSubAccountCredits(externalUser: SamsarJsExternalUserIdentity) {
  if (isProviderMock("SAMSAR")) {
    return {
      creditsRemaining: 0,
      raw: { mock: true }
    };
  }
  const response = await (await samsarSdkClient()).getExternalCreditsBalance(externalUser);
  const data = response.data as Record<string, unknown>;
  return {
    creditsRemaining: extractSamsarCredits(data),
    raw: data
  };
}

export async function createSamsarProcessorSubAccountLoginLink(
  externalUser: SamsarJsExternalUserIdentity,
  options: { redirect?: string } = {}
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
  const response = await (await samsarSdkClient()).createExternalUserLoginToken(externalUser, {
    redirect: options.redirect || "/external/studio"
  });
  const data = response.data as Record<string, unknown>;
  return {
    loginToken: String(data.loginToken || ""),
    loginUrl: String(data.loginUrl || ""),
    expiresInSeconds: typeof data.expiresInSeconds === "number" ? data.expiresInSeconds : undefined,
    raw: data
  };
}

async function createAuthenticatedCreditRecharge(authToken: string, amountCents: number) {
  const data = await requestSamsarJson(`${samsarApiV1Url()}/credits/recharge`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${authToken}`
    },
    body: JSON.stringify({ credits: amountCents })
  }, "Unable to create Samsar credit recharge checkout");
  return normalizeCheckoutResponse(data, amountCents);
}

async function createExternalCreditRecharge(externalUser: SamsarJsExternalUserIdentity, amountCents: number) {
  if (isProviderMock("SAMSAR")) {
    return {
      url: `${appBaseUrl()}/payment_success?mock=1`,
      checkoutSessionId: `mock_external_checkout_${Date.now()}`,
      amountCents,
      credits: amountCents,
      currency: "USD",
      paymentStatusEndpoint: undefined,
      paymentIntentId: null
    };
  }
  const response = await (await samsarSdkClient()).createExternalCreditsRecharge(externalUser, amountCents);
  return normalizeCheckoutResponse(response.data as Record<string, unknown>, amountCents);
}

async function createAnonymousCreditCheckout(input: SamsarProcessorCreditCheckoutInput, amountCents: number) {
  const apiRootUrl = samsarApiRootUrl();
  let response: Response;
  try {
    response = await fetch(`${apiRootUrl}/payments/anonymous_credit_checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        amountCents,
        customerEmail: input.customerEmail,
        appBaseUrl: appBaseUrl(),
        successPath: "/payment_success",
        cancelPath: "/payment_cancel",
        metadata: {
          sourceProject: "superreferrals",
          ...(input.metadata || {})
        }
      })
    });
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`Unable to reach Samsar API at ${apiRootUrl}. Set SAMSAR_API_URL to the production Samsar API origin.${detail}`);
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || "Unable to create Samsar Processor checkout session");
  }

  return normalizeCheckoutResponse(data, amountCents);
}

async function requestSamsarJson(url: string, init: RequestInit, fallback: string) {
  let response: Response;
  try {
    response = await fetch(url, { ...init, cache: "no-store" });
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : "";
    throw new Error(`${fallback}: unable to reach Samsar API at ${samsarApiRootUrl()}.${detail}`);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || fallback);
  }
  return data as Record<string, unknown>;
}

function normalizeCheckoutResponse(data: Record<string, unknown>, amountCents: number): SamsarProcessorCreditCheckout {
  return {
    url: String(data.url || data.checkoutUrl || ""),
    checkoutSessionId: String(data.checkoutSessionId || data.checkout_session_id || data.sessionId || data.id || ""),
    amountCents: Number(data.amountCents || data.amount_cents || amountCents),
    credits: Number(data.credits || amountCents),
    currency: String(data.currency || "USD"),
    paymentStatusEndpoint: typeof data.paymentStatusEndpoint === "string" ? data.paymentStatusEndpoint : undefined,
    paymentIntentId: typeof data.paymentIntentId === "string" ? data.paymentIntentId : null
  };
}

async function samsarSdkClient() {
  const apiKey = env("SAMSAR_API_KEY");
  if (!apiKey) {
    throw new Error("SAMSAR_API_KEY is required for samsar-js sub-account actions.");
  }
  const dynamicImport = new Function("specifier", "return import(specifier)") as (
    specifier: string
  ) => Promise<{ default: new (options: { apiKey: string; baseUrl: string }) => SamsarSdkClient }>;
  const { default: SamsarClient } = await dynamicImport("samsar-js");
  return new SamsarClient({
    apiKey,
    baseUrl: samsarApiV1Url()
  });
}

function extractSamsarCredits(data: Record<string, unknown>) {
  return (
    extractNumber(data.remainingCredits) ??
    extractNumber(data.remaining_credits) ??
    extractNumber(data.generationCredits) ??
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
