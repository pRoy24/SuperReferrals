import { NextResponse } from "next/server";
import { createSamsarProcessorCreditCheckout } from "@/lib/samsar-processor";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const checkout = await createSamsarProcessorCreditCheckout({
      amountCents: body.amountCents ?? body.amount_cents,
      metadata: body.metadata
    });
    return NextResponse.json({ checkout });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to create processor checkout" },
      { status: 400 }
    );
  }
}
