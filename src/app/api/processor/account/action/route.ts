import { NextResponse } from "next/server";
import { processorSessionFromCustomer, setProcessorAccountSessionCookie } from "@/lib/account-session";
import { env } from "@/lib/env";
import { normalizeWallet, nowIso } from "@/lib/ids";
import {
  buildCustomerSamsarExternalUser,
  createSamsarProcessorSubAccountLoginLink,
  ensureSamsarProcessorSubAccount,
  fetchSamsarProcessorCredits,
  refreshSamsarProcessorSubAccountCredits
} from "@/lib/samsar-processor";
import { mutateStore, publicCustomer, readStore, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const store = await readStore();
    const customer = body.customerId
      ? store.customers.find((item) => item.id === body.customerId)
      : store.customers[0];
    if (!customer) {
      throw new Error("Customer account was not found");
    }

    const action = String(body.action || "");
    const parentApiKey = env("SAMSAR_API_KEY") || customer.samsarAccount?.apiKey;
    if (action === "refresh_credits") {
      const externalUser = buildCustomerSamsarExternalUser(customer, customer.samsarAccount?.email);
      const session = customer.samsarAccount?.authToken
        ? await fetchSamsarProcessorCredits(customer.samsarAccount.authToken)
        : await refreshSamsarProcessorSubAccountCredits(externalUser, parentApiKey);
      const creditsRemaining = Number(
        "remainingCredits" in session ? session.remainingCredits : session.creditsRemaining
      ) || 0;
      const updated = await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
        id: customer.id,
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          externalProvider: externalUser.provider,
          externalUserId: String(externalUser.external_user_id || externalUser.externalUserId || customer.id),
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
      const externalUser = buildCustomerSamsarExternalUser(customer, customer.samsarAccount?.email);
      await ensureSamsarProcessorSubAccount(externalUser, parentApiKey);
      const login = await createSamsarProcessorSubAccountLoginLink(externalUser, {
        redirect: action === "create_password_link"
          ? "/external/studio/account/security"
          : "/external/studio",
        apiKey: parentApiKey
      });
      const updated = await mutateStore((mutableStore) => upsertCustomer(mutableStore, {
        id: customer.id,
        samsarAccount: {
          ...(customer.samsarAccount || {}),
          username: customer.samsarAccount?.username || customer.name,
          userId: customer.samsarAccount?.userId || customer.id,
          externalProvider: externalUser.provider,
          externalUserId: String(externalUser.external_user_id || externalUser.externalUserId || customer.id),
          apiKey: customer.samsarAccount?.apiKey,
          loginUrl: action === "create_login_link" ? login.loginUrl : customer.samsarAccount?.loginUrl,
          passwordSetupUrl: action === "create_password_link" ? login.loginUrl : customer.samsarAccount?.passwordSetupUrl,
          updatedAt: nowIso()
        },
        subscription: {
          status: Number(customer.subscription.creditsRemaining || 0) > 0 ? "active" : "not_started",
          creditsRemaining: customer.subscription.creditsRemaining ?? 0
        }
      }));
      const response = NextResponse.json({
        customer: publicCustomer(updated),
        loginUrl: login.loginUrl,
        expiresInSeconds: login.expiresInSeconds
      });
      setProcessorAccountSessionCookie(response, processorSessionFromCustomer(updated));
      return response;
    }

    if (action === "link_wallet") {
      const rawWallet = String(body.wallet || "").trim();
      if (!rawWallet) {
        throw new Error("wallet is required");
      }
      const walletAddress = normalizeWallet(rawWallet);
      if (!customer.samsarAccount?.authToken && !customer.samsarAccount?.apiKey) {
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
