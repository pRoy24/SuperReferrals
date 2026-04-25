import { NextResponse } from "next/server";
import { handleSamsarWebhook } from "@/lib/orchestrator";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const result = await handleSamsarWebhook(payload);
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, message: error instanceof Error ? error.message : "Webhook failed" },
      { status: 400 }
    );
  }
}
