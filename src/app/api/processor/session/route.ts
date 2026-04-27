import { NextResponse } from "next/server";
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
      id: body.customerId,
      name: body.customerName,
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
    return NextResponse.json({
      account: {
        email: session.email,
        username: session.username,
        userId: session.userId,
        creditsRemaining: session.creditsRemaining,
        hasApiKey: Boolean(session.apiKey)
      },
      customer: publicCustomer(customer)
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to login to Samsar account" },
      { status: 400 }
    );
  }
}
