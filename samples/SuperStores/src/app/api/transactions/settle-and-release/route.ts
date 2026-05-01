import { NextRequest, NextResponse } from "next/server";
import { settleAndReleaseSuperStoresSale } from "@/lib/transactions";
import type { SuperStoresTransactionRequest } from "@/lib/superstores";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const payload = await request.json() as SuperStoresTransactionRequest;
    const result = await settleAndReleaseSuperStoresSale({
      ...payload,
      platformTreasuryWallet: payload.platformTreasuryWallet || process.env.SUPERSTORES_PLATFORM_TREASURY_WALLET || "",
      environment: payload.environment || process.env.NEXT_PUBLIC_SUPERSTORES_ENV || process.env.VERCEL_ENV || "staging"
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 202 });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "SuperStores transaction failed."
    }, { status: 400 });
  }
}
