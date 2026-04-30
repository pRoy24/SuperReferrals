import { NextResponse } from "next/server";
import { quotePayment } from "@/lib/orchestrator";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const quote = await quotePayment(body);
    return NextResponse.json({ quote });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to quote payment" },
      { status: 400 }
    );
  }
}
