import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "./env";
import { nowIso } from "./ids";
import type { Customer } from "./types";

export const PROCESSOR_ACCOUNT_SESSION_COOKIE = "superreferrals_account_session";
export const PENDING_CREDIT_CHECKOUT_COOKIE = "superreferrals_pending_credit_checkout";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const CHECKOUT_MAX_AGE_SECONDS = 60 * 60 * 24;

export type ProcessorAccountCookieSession = {
  customerId: string;
  customerName?: string;
  ownerWallet?: string;
  email: string;
  username?: string;
  userId?: string;
  authToken?: string;
  refreshToken?: string;
  expiryDate?: string;
  refreshTokenExpiresAt?: string;
  appKeyHash?: string;
  appKeyPrefix?: string;
  appKeyLast4?: string;
  apiKey?: string;
  externalProvider?: string;
  externalUserId?: string;
  walletAddress?: string;
  pricing?: Customer["pricing"];
  referrerBaseUrl?: string;
  ensName?: string;
  storefront?: Customer["storefront"];
  creditsRemaining?: number;
  updatedAt?: string;
  expiresAt: string;
};

export type PendingCreditCheckoutCookie = {
  checkoutSessionId?: string;
  paymentIntentId?: string | null;
  externalPaymentId?: string | null;
  paymentStatusEndpoint?: string;
  customerId?: string;
  email?: string;
  amountCents: number;
  credits: number;
  checkoutUrl?: string;
  createdAt: string;
  expiresAt: string;
};

export function processorSessionFromCustomer(
  customer: Customer,
  patch: Partial<ProcessorAccountCookieSession> = {}
): ProcessorAccountCookieSession | undefined {
  const email = patch.email || customer.samsarAccount?.email;
  if (!email) {
    return undefined;
  }
  return {
    customerId: customer.id,
    customerName: customer.name,
    ownerWallet: patch.ownerWallet || customer.ownerWallet,
    email,
    username: patch.username || customer.samsarAccount?.username,
    userId: patch.userId || customer.samsarAccount?.userId,
    authToken: patch.authToken || customer.samsarAccount?.authToken,
    refreshToken: patch.refreshToken || customer.samsarAccount?.refreshToken,
    expiryDate: patch.expiryDate || customer.samsarAccount?.expiryDate,
    refreshTokenExpiresAt: patch.refreshTokenExpiresAt || customer.samsarAccount?.refreshTokenExpiresAt,
    appKeyHash: patch.appKeyHash || customer.samsarAccount?.appKeyHash,
    appKeyPrefix: patch.appKeyPrefix || customer.samsarAccount?.appKeyPrefix,
    appKeyLast4: patch.appKeyLast4 || customer.samsarAccount?.appKeyLast4,
    apiKey: patch.apiKey || customer.samsarAccount?.apiKey,
    externalProvider: patch.externalProvider || customer.samsarAccount?.externalProvider,
    externalUserId: patch.externalUserId || customer.samsarAccount?.externalUserId,
    walletAddress: patch.walletAddress || customer.samsarAccount?.walletAddress,
    pricing: patch.pricing || customer.pricing,
    referrerBaseUrl: patch.referrerBaseUrl || customer.referrerBaseUrl,
    ensName: patch.ensName ?? customer.ensName,
    storefront: patch.storefront || customer.storefront,
    creditsRemaining: patch.creditsRemaining ?? customer.subscription.creditsRemaining,
    updatedAt: nowIso(),
    expiresAt: new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000).toISOString()
  };
}

export function pendingCheckoutCookie(input: Omit<PendingCreditCheckoutCookie, "createdAt" | "expiresAt">): PendingCreditCheckoutCookie {
  return {
    ...input,
    createdAt: nowIso(),
    expiresAt: new Date(Date.now() + CHECKOUT_MAX_AGE_SECONDS * 1000).toISOString()
  };
}

export function readProcessorAccountSessionCookie(cookieHeader: string | null | undefined) {
  return decryptCookie<ProcessorAccountCookieSession>(cookieHeader, PROCESSOR_ACCOUNT_SESSION_COOKIE);
}

export function readPendingCreditCheckoutCookie(cookieHeader: string | null | undefined) {
  return decryptCookie<PendingCreditCheckoutCookie>(cookieHeader, PENDING_CREDIT_CHECKOUT_COOKIE);
}

export function processorAuthTokenFromRequest(request: Request) {
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  return (
    bearerToken ||
    request.headers.get("x-samsar-auth-token")?.trim() ||
    request.headers.get("x-superreferrals-auth-token")?.trim() ||
    ""
  );
}

export function setProcessorAccountSessionCookie(response: NextResponse, session: ProcessorAccountCookieSession | undefined) {
  if (!session) {
    return;
  }
  response.cookies.set(PROCESSOR_ACCOUNT_SESSION_COOKIE, encryptPayload(session), {
    httpOnly: true,
    maxAge: SESSION_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookie()
  });
}

export function setPendingCreditCheckoutCookie(response: NextResponse, checkout: PendingCreditCheckoutCookie) {
  response.cookies.set(PENDING_CREDIT_CHECKOUT_COOKIE, encryptPayload(checkout), {
    httpOnly: true,
    maxAge: CHECKOUT_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookie()
  });
}

export function clearPendingCreditCheckoutCookie(response: NextResponse) {
  response.cookies.set(PENDING_CREDIT_CHECKOUT_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: shouldUseSecureCookie()
  });
}

function decryptCookie<T extends { expiresAt?: string }>(cookieHeader: string | null | undefined, name: string): T | undefined {
  const cookieValue = cookieValueFromHeader(cookieHeader, name);
  if (!cookieValue) {
    return undefined;
  }
  try {
    const payload = decryptPayload<T>(cookieValue);
    if (payload.expiresAt && Date.parse(payload.expiresAt) <= Date.now()) {
      return undefined;
    }
    return payload;
  } catch {
    return undefined;
  }
}

function cookieValueFromHeader(cookieHeader: string | null | undefined, name: string) {
  return (cookieHeader || "")
    .split(";")
    .map((part) => part.trim())
    .map((part) => {
      const separator = part.indexOf("=");
      return separator >= 0 ? [part.slice(0, separator), part.slice(separator + 1)] : [part, ""];
    })
    .find(([key]) => key === name)?.[1];
}

function encryptPayload(payload: unknown) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", sessionKey(), iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final()
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url")
  ].join(".");
}

function decryptPayload<T>(value: string): T {
  const [version, iv, encrypted, authTag] = value.split(".");
  if (version !== "v1" || !iv || !encrypted || !authTag) {
    throw new Error("unsupported account session cookie");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", sessionKey(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8")) as T;
}

function sessionKey() {
  return crypto.createHash("sha256").update(sessionSecret()).digest();
}

function sessionSecret() {
  return env("SUPERREFERRALS_SESSION_SECRET") ||
    env("AUTH_SECRET") ||
    env("NEXTAUTH_SECRET") ||
    env("SAMSAR_WEBHOOK_SECRET") ||
    "superreferrals-local-development-session-secret";
}

function shouldUseSecureCookie() {
  return process.env.NODE_ENV === "production" || env("APP_BASE_URL").startsWith("https://");
}
