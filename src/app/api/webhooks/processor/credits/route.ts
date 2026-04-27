import { NextResponse } from "next/server";
import { reconcileProcessorCreditWebhook } from "@/lib/processor-credit-webhook";
import { publicCustomer } from "@/lib/store";

export async function POST(request: Request) {
  try {
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
