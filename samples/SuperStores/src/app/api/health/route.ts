import { NextResponse } from "next/server";
import {
  collectiblesChainForEnvironment,
  paymentChainConfigForEnvironment,
  paymentChainForEnvironment
} from "@/lib/superstores";

export function GET() {
  const environment = process.env.NEXT_PUBLIC_SUPERSTORES_ENV || process.env.VERCEL_ENV || "local";
  const paymentChain = paymentChainConfigForEnvironment(environment);
  return NextResponse.json({
    ok: true,
    app: "superstores",
    environment,
    collectiblesChain: process.env.NEXT_PUBLIC_SUPERSTORES_COLLECTIBLES_CHAIN || collectiblesChainForEnvironment(environment),
    paymentChain: process.env.NEXT_PUBLIC_SUPERSTORES_PAYMENT_CHAIN || paymentChainForEnvironment(environment),
    paymentChainId: paymentChain.id,
    keeperHubNetwork: paymentChain.network,
    keeperHubConfigured: Boolean(process.env.KEEPERHUB_API_KEY),
    treasuryConfigured: Boolean(process.env.SUPERSTORES_PLATFORM_TREASURY_WALLET),
    marketplaceConfigured: Boolean(process.env.SUPERSTORES_MARKETPLACE_ADDRESS),
    releaseExecutorConfigured: Boolean(process.env.SUPERSTORES_MARKETPLACE_EXECUTOR_PRIVATE_KEY || process.env.OG_PRIVATE_KEY),
    mockTransactions: process.env.SUPERSTORES_MOCK_TRANSACTIONS !== "false"
  });
}
