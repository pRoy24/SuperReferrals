import { NextResponse } from "next/server";
import {
  processorSessionFromCustomer,
  readProcessorAccountSessionCookie,
  setProcessorAccountSessionCookie
} from "@/lib/account-session";
import { nowIso } from "@/lib/ids";
import { customerMatchesProcessorSession } from "@/lib/orchestrator";
import { provisionSamsarProcessorAppKeyIfMissing, refreshSamsarProcessorAuthToken } from "@/lib/samsar-processor";
import { mutateStore, publicCustomer, readStore, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const cookieSession = readProcessorAccountSessionCookie(request.headers.get("cookie"));
    const refreshToken = String(body.refreshToken || body.refresh_token || cookieSession?.refreshToken || "").trim();
    if (!refreshToken) {
      throw new Error("refreshToken is required to refresh SuperReferrals credentials.");
    }

    const session = await refreshSamsarProcessorAuthToken(refreshToken);
    const store = await readStore();
    const requestedCustomer = body.customerId
      ? store.customers.find((item) => item.id === String(body.customerId))
      : undefined;
    const cookieCustomer = store.customers.find((item) => item.id === cookieSession?.customerId);
    const requestedAccountCustomer = customerMatchesProcessorSession(requestedCustomer, session)
      ? requestedCustomer
      : undefined;
    const cookieAccountCustomer = customerMatchesProcessorSession(cookieCustomer, session)
      ? cookieCustomer
      : undefined;
    const existingCustomer = requestedAccountCustomer ||
      cookieAccountCustomer ||
      oldestCustomer(store.customers.filter((item) =>
        item.samsarAccount?.userId === session.userId ||
        item.samsarAccount?.email?.toLowerCase() === session.email.toLowerCase()
      ));

    let customer = await mutateStore((store) => upsertCustomer(store, {
      id: existingCustomer?.id,
      name: existingCustomer?.name || session.username || session.email.split("@")[0] || "SuperReferrals Account",
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
      { message: error instanceof Error ? error.message : "Unable to refresh SuperReferrals credentials" },
      { status: 400 }
    );
  }
}

function oldestCustomer<T extends { createdAt: string }>(customers: T[]) {
  return [...customers].sort((left, right) =>
    Date.parse(left.createdAt || "") - Date.parse(right.createdAt || "")
  )[0];
}
