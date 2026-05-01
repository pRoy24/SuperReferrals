import { NextRequest, NextResponse } from "next/server";
import {
  calculateSaleBreakdown,
  type CollectionMode,
  type CollectibleStandard,
  type Currency,
  type SaleMechanism
} from "@/lib/superstores";

type ReferralSalePayload = {
  listingId?: string;
  sellerAmount?: number;
  currency?: Currency;
  settlementCurrency?: Currency;
  buyerWallet?: string;
  sellerWallet?: string;
  referrerCode?: string;
  collectionMode?: CollectionMode;
  tokenStandard?: CollectibleStandard;
  saleMechanism?: SaleMechanism;
};

export async function POST(request: NextRequest) {
  const configuredSecret = process.env.SUPERSTORES_WEBHOOK_SECRET;
  const providedSecret = request.headers.get("x-superstores-webhook-secret");
  if (configuredSecret && providedSecret !== configuredSecret) {
    return NextResponse.json({ ok: false, error: "Invalid webhook secret." }, { status: 401 });
  }

  const payload = await request.json() as ReferralSalePayload;
  const sellerAmount = Number(payload.sellerAmount || 0);
  if (!payload.listingId || !sellerAmount || !payload.currency) {
    return NextResponse.json({
      ok: false,
      error: "listingId, sellerAmount, and currency are required."
    }, { status: 400 });
  }

  const breakdown = calculateSaleBreakdown(sellerAmount, Boolean(payload.referrerCode));
  return NextResponse.json({
    ok: true,
    event: "superstores.sale.distribution",
    listingId: payload.listingId,
    buyerWallet: payload.buyerWallet,
    sellerWallet: payload.sellerWallet,
    referrerCode: payload.referrerCode || null,
    collectionMode: payload.collectionMode || "database",
    tokenStandard: payload.tokenStandard || "erc721",
    saleMechanism: payload.saleMechanism || "fixed",
    currency: payload.currency,
    settlementCurrency: payload.settlementCurrency || payload.currency,
    distribution: breakdown,
    feesAppliedToSaleMechanism: true,
    keeperHub: {
      conversion: "internal",
      sourcePaymentRail: "USDC or ETH",
      supportedStagingChain: "eth-sepolia",
      supportedProductionChain: "base-mainnet"
    }
  });
}
