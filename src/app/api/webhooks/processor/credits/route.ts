import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { reconcileProcessorCreditWebhook } from "@/lib/processor-credit-webhook";
import { publicCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
    if (!isAuthorizedProcessorWebhook(request)) {
      return NextResponse.json(
        { message: "Invalid credit checkout webhook signature." },
        { status: 401 }
      );
    }
    const payload = await request.json();
    const result = await reconcileProcessorCreditWebhook(payload as Record<string, unknown>);
    return NextResponse.json({
      ...result,
      customer: result.customer ? publicCustomer(result.customer) : undefined
    });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to process credit checkout webhook" },
      { status: 400 }
    );
  }
}

function isAuthorizedProcessorWebhook(request: Request) {
  const webhookSecret = env("SAMSAR_WEBHOOK_SECRET");
  if (!webhookSecret) {
    return true;
  }
  const authHeader = request.headers.get("authorization") || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const providedSecret =
    request.headers.get("x-samsar-webhook-secret") ||
    request.headers.get("x-superreferrals-webhook-secret") ||
    bearerToken;
  return providedSecret === webhookSecret;
}
