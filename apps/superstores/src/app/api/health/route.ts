import { NextResponse } from "next/server";
import {
  collectiblesChainForEnvironment,
  paymentChainForEnvironment
} from "@/lib/superstores";

export function GET() {
  const environment = process.env.NEXT_PUBLIC_SUPERSTORES_ENV || process.env.VERCEL_ENV || "local";
  return NextResponse.json({
    ok: true,
    app: "superstores",
    environment,
    collectiblesChain: process.env.NEXT_PUBLIC_SUPERSTORES_COLLECTIBLES_CHAIN || collectiblesChainForEnvironment(environment),
    paymentChain: process.env.NEXT_PUBLIC_SUPERSTORES_PAYMENT_CHAIN || paymentChainForEnvironment(environment),
    keeperHubConfigured: Boolean(process.env.KEEPERHUB_API_KEY),
    treasuryConfigured: Boolean(process.env.SUPERSTORES_PLATFORM_TREASURY_WALLET)
  });
}
