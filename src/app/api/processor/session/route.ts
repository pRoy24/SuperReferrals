import { NextResponse } from "next/server";
import { processorSessionFromCustomer, setProcessorAccountSessionCookie } from "@/lib/account-session";
import { nowIso } from "@/lib/ids";
import { customerMatchesProcessorSession } from "@/lib/orchestrator";
import { loginSamsarProcessorAccount, provisionSamsarProcessorAppKeyIfMissing, verifySamsarProcessorAuthToken } from "@/lib/samsar-processor";
import { mutateStore, publicCustomer, readStore, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const authToken = String(body.authToken || body.auth_token || "").trim();
    const refreshToken = String(body.refreshToken || body.refresh_token || "").trim();
    const expiryDate = String(body.expiryDate || body.expiry_date || body.expiresAt || body.expires_at || "").trim();
    const refreshTokenExpiresAt = String(body.refreshTokenExpiresAt || body.refresh_token_expires_at || "").trim();
    const session = authToken
      ? await verifySamsarProcessorAuthToken({
        authToken,
        refreshToken,
        expiryDate,
        refreshTokenExpiresAt
      })
      : await loginSamsarProcessorAccount({
        email: String(body.email || ""),
        password: String(body.password || "")
      });
    const store = await readStore();
    const requestedCustomer = body.customerId
      ? store.customers.find((item) => item.id === String(body.customerId))
      : undefined;
    const requestedAccountCustomer = customerMatchesProcessorSession(requestedCustomer, session)
      ? requestedCustomer
      : undefined;
    const existingCustomer = requestedAccountCustomer ||
      oldestCustomer(store.customers.filter((item) =>
        item.samsarAccount?.userId === session.userId ||
        item.samsarAccount?.email?.toLowerCase() === session.email.toLowerCase()
      ));
    let customer = await mutateStore((store) => upsertCustomer(store, {
      id: existingCustomer?.id,
      name: existingCustomer?.name || String(body.customerName || "") || session.username || session.email.split("@")[0] || "SuperReferrals Account",
      samsarApiKeyAlias: existingCustomer?.samsarApiKeyAlias || (session.apiKey ? "samsar-user-api-key" : undefined),
      samsarAccount: {
        ...(existingCustomer?.samsarAccount || {}),
        email: session.email,
        username: session.username,
        userId: session.userId,
        authToken: session.authToken,
        refreshToken: session.refreshToken,
        expiryDate: session.expiryDate,
        refreshTokenExpiresAt: session.refreshTokenExpiresAt,
        apiKey: session.apiKey,
        updatedAt: nowIso()
      },
      subscription: {
        status: session.creditsRemaining > 0 ? "active" : "not_started",
        creditsRemaining: session.creditsRemaining
      }
    }));
    const appKey = await provisionSamsarProcessorAppKeyIfMissing(customer, session.authToken);
    if (appKey) {
      customer = await mutateStore((store) => upsertCustomer(store, {
        id: customer.id,
        samsarApiKeyAlias: "samsar-user-app-key",
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          ...appKey,
          updatedAt: nowIso()
        },
        subscription: customer.subscription
      }));
    }
    const response = NextResponse.json({
      account: {
        email: session.email,
        username: session.username,
        userId: session.userId,
        authToken: session.authToken,
        refreshToken: session.refreshToken,
        expiryDate: session.expiryDate,
        refreshTokenExpiresAt: session.refreshTokenExpiresAt,
        creditsRemaining: session.creditsRemaining,
        hasAppKey: Boolean(customer.samsarAccount?.appKeyHash),
        hasApiKey: Boolean(session.apiKey)
      },
      customer: publicCustomer(customer)
    });
    setProcessorAccountSessionCookie(response, processorSessionFromCustomer(customer, {
      authToken: session.authToken,
      refreshToken: session.refreshToken,
      expiryDate: session.expiryDate,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
      appKeyHash: customer.samsarAccount?.appKeyHash,
      appKeyPrefix: customer.samsarAccount?.appKeyPrefix,
      appKeyLast4: customer.samsarAccount?.appKeyLast4,
      apiKey: session.apiKey,
      creditsRemaining: session.creditsRemaining
    }));
    return response;
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to sign in to SuperReferrals account" },
      { status: 400 }
    );
  }
}

function oldestCustomer<T extends { createdAt: string }>(customers: T[]) {
  return [...customers].sort((left, right) =>
    Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "")
  )[0];
}
