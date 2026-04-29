import { NextResponse } from "next/server";
import { processorAuthTokenFromRequest, processorSessionFromCustomer, setProcessorAccountSessionCookie } from "@/lib/account-session";
import { restoreConsoleCustomer } from "@/lib/console-auth";
import { normalizeWallet, nowIso } from "@/lib/ids";
import {
  customersShareProcessorAccount
} from "@/lib/orchestrator";
import { hasStoredSamsarAppKey, samsarAppClientCredentials } from "@/lib/samsar-app-credentials";
import { fetchSamsarProcessorCredits } from "@/lib/samsar-processor";
import { mutateStore, publicCustomer, readStore, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const requestAuthToken = processorAuthTokenFromRequest(request);
    const sessionCustomer = await restoreConsoleCustomer(request);
    const store = await readStore();
    const requestedCustomer = body.customerId
      ? store.customers.find((item) => item.id === String(body.customerId))
      : undefined;
    if (!sessionCustomer) {
      throw new Error("Sign in with your Samsar account before changing account settings.");
    }
    if (body.customerId && (!requestedCustomer || !customersShareProcessorAccount(requestedCustomer, sessionCustomer))) {
      return NextResponse.json(
        { message: "That storefront does not belong to the signed-in Samsar account." },
        { status: 403 }
      );
    }
    const customer = requestedCustomer || sessionCustomer;
    if (!customer) {
      throw new Error("Customer account was not found");
    }

    const action = String(body.action || "");
    if (action === "refresh_credits") {
      let storedAppCredentials: ReturnType<typeof samsarAppClientCredentials> | undefined;
      if (hasStoredSamsarAppKey(customer)) {
        try {
          storedAppCredentials = samsarAppClientCredentials(customer);
        } catch {
          storedAppCredentials = undefined;
        }
      }
      const samsarCredential = storedAppCredentials?.appKey
        ? storedAppCredentials
        : requestAuthToken || customer.samsarAccount?.authToken || customer.samsarAccount?.apiKey;
      if (!samsarCredential || (typeof samsarCredential === "string" ? !samsarCredential : !samsarCredential.appKey)) {
        throw new Error("Sign in with a Samsar account before refreshing credits.");
      }
      const session = await fetchSamsarProcessorCredits(samsarCredential);
      const creditsRemaining = Number(session.remainingCredits) || 0;
      const updated = await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
        id: customer.id,
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          authToken: requestAuthToken || customer.samsarAccount?.authToken,
          updatedAt: nowIso()
        },
        subscription: {
          status: creditsRemaining > 0 ? "active" : "not_started",
          creditsRemaining
        }
      }));
      const response = NextResponse.json({ customer: publicCustomer(updated), creditsRemaining });
      setProcessorAccountSessionCookie(response, processorSessionFromCustomer(updated));
      return response;
    }

    if (action === "create_login_link" || action === "create_password_link") {
      throw new Error("Use password sign-in or Stripe checkout to connect a Samsar account.");
    }

    if (action === "link_wallet") {
      const rawWallet = String(body.wallet || "").trim();
      if (!rawWallet) {
        throw new Error("wallet is required");
      }
      const walletAddress = normalizeWallet(rawWallet);
      if (!hasStoredSamsarAppKey(customer) && !requestAuthToken && !customer.samsarAccount?.authToken && !customer.samsarAccount?.apiKey) {
        throw new Error("Sign in before linking a wallet to your SuperReferrals account.");
      }
      const updated = await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
        id: customer.id,
        ownerWallet: walletAddress,
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          walletAddress,
          updatedAt: nowIso()
        },
        subscription: {
          status: Number(customer.subscription.creditsRemaining || 0) > 0 ? "active" : "not_started",
          creditsRemaining: customer.subscription.creditsRemaining ?? 0
        }
      }));
      const response = NextResponse.json({ customer: publicCustomer(updated), walletAddress });
      setProcessorAccountSessionCookie(response, processorSessionFromCustomer(updated));
      return response;
    }

    throw new Error("Unsupported processor account action");
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to run processor account action" },
      { status: 400 }
    );
  }
}
