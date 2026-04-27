import { NextResponse } from "next/server";
import { processorSessionFromCustomer, setProcessorAccountSessionCookie } from "@/lib/account-session";
import { nowIso } from "@/lib/ids";
import { loginSamsarProcessorAccount } from "@/lib/samsar-processor";
import { mutateStore, publicCustomer, upsertCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const session = await loginSamsarProcessorAccount({
      email: String(body.email || ""),
      password: String(body.password || "")
    });
    const customer = await mutateStore((store) => upsertCustomer(store, {
      id: String(body.customerId || "") || undefined,
      name: String(body.customerName || "") || session.username || session.email.split("@")[0] || "SuperReferrals Account",
      samsarApiKeyAlias: session.apiKey ? "samsar-user-api-key" : undefined,
      samsarAccount: {
        email: session.email,
        username: session.username,
        userId: session.userId,
        authToken: session.authToken,
        apiKey: session.apiKey,
        updatedAt: nowIso()
      },
      subscription: {
        status: session.creditsRemaining > 0 ? "active" : "not_started",
        creditsRemaining: session.creditsRemaining
      }
    }));
    const response = NextResponse.json({
      account: {
        email: session.email,
        username: session.username,
        userId: session.userId,
        creditsRemaining: session.creditsRemaining,
        hasApiKey: Boolean(session.apiKey)
      },
      customer: publicCustomer(customer)
    });
    setProcessorAccountSessionCookie(response, processorSessionFromCustomer(customer, {
      authToken: session.authToken,
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
