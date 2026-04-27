import { env, isProviderMock } from "./env";
import { createId } from "./ids";
import { amountToAtomic, findPaymentToken, getTransactionChainId, settlementTokenForCurrency } from "./payment-tokens";
import type { AgentPriceSignal, PaymentCurrencySymbol } from "./types";

export interface UniswapQuoteInput {
  amount: string;
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  swapper: string;
  type?: "EXACT_INPUT" | "EXACT_OUTPUT";
  slippageTolerance?: number;
  nativeEthInput?: boolean;
}

export interface UniswapSwapInput {
  quote: unknown;
  permitData?: unknown;
  signature?: string;
}

export async function createUniswapQuote(input: UniswapQuoteInput) {
  const apiKey = env("UNISWAP_API_KEY");
  if (isProviderMock("UNISWAP")) {
    return {
      requestId: createId("mock_uni_quote"),
      quote: {
        routing: "MOCK",
        type: input.type || "EXACT_OUTPUT",
        input,
        output: input.amount,
        permitData: null,
        warning: "Set UNISWAP_API_KEY and UNISWAP_MOCKS=false for live quotes."
      }
    };
  }
  if (!apiKey) {
    throw new Error("UNISWAP_API_KEY is required when UNISWAP_MOCKS=false");
  }

  const response = await fetch(`${env("UNISWAP_BASE_URL", "https://trade-api.gateway.uniswap.org/v1")}/quote`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": "2.0",
      "x-permit2-disabled": "false",
      "x-erc20eth-enabled": input.nativeEthInput ? "true" : "false"
    },
    body: JSON.stringify({
      type: input.type || "EXACT_OUTPUT",
      amount: input.amount,
      tokenInChainId: input.tokenInChainId,
      tokenOutChainId: input.tokenOutChainId,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      swapper: input.swapper,
      ...(input.slippageTolerance !== undefined ? { slippageTolerance: input.slippageTolerance } : { autoSlippage: "DEFAULT" }),
      routingPreference: "BEST_PRICE",
      protocols: ["V2", "V3", "V4"],
      urgency: "normal",
      generatePermitAsTransaction: false,
      permitAmount: "FULL"
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "Uniswap quote failed");
  }
  return data;
}

export async function createUniswapSwap(input: UniswapSwapInput) {
  const apiKey = env("UNISWAP_API_KEY");
  if (isProviderMock("UNISWAP") || !apiKey) {
    throw new Error("UNISWAP_API_KEY is required and UNISWAP_MOCKS must be false for wallet swap transactions.");
  }

  const body: Record<string, unknown> = {
    quote: input.quote,
    simulateTransaction: true,
    refreshGasPrice: true,
    safetyMode: "SAFE",
    urgency: "normal"
  };
  if (input.permitData && input.signature) {
    body.permitData = input.permitData;
    body.signature = input.signature;
  }

  const response = await fetch(`${env("UNISWAP_BASE_URL", "https://trade-api.gateway.uniswap.org/v1")}/swap`, {
    method: "POST",
    headers: {
      "accept": "application/json",
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": "2.0",
      "x-permit2-disabled": "false"
    },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "Uniswap swap transaction creation failed");
  }
  return data;
}

export async function createUniswapChargeSignal(input: {
  chargeUsd: number;
  chainId: number;
  paymentCurrency?: PaymentCurrencySymbol | string;
  settlementCurrency?: PaymentCurrencySymbol | string;
  swapper?: string;
}): Promise<AgentPriceSignal> {
  const chainId = input.chainId || getTransactionChainId();
  const settlementToken = settlementTokenForCurrency(input.settlementCurrency || "USDC", chainId);
  const paymentToken = findPaymentToken(input.paymentCurrency || settlementToken?.symbol || "USDC", chainId);
  if (!settlementToken || !paymentToken) {
    throw new Error("Unsupported payment or settlement token for Uniswap price signal");
  }

  const amount = amountToAtomic(input.chargeUsd, settlementToken.decimals);
  const sameToken = paymentToken.address.toLowerCase() === settlementToken.address.toLowerCase();
  const route = !sameToken && input.swapper
    ? await createUniswapQuote({
      type: "EXACT_OUTPUT",
      amount,
      tokenIn: paymentToken.address,
      tokenOut: settlementToken.address,
      tokenInChainId: chainId,
      tokenOutChainId: chainId,
      swapper: input.swapper,
      nativeEthInput: paymentToken.native
    })
    : {
      requestId: createId("mock_uni_oracle"),
      quote: {
        routing: sameToken ? "DIRECT_TOKEN_ORACLE" : "MISSING_SWAPPER_ORACLE",
        amount,
        tokenIn: paymentToken.address,
        tokenOut: settlementToken.address
      }
    };

  return {
    source: "uniswap",
    chargeUsd: input.chargeUsd,
    settlementToken: settlementToken.symbol,
    paymentToken: paymentToken.symbol,
    route,
    confidence: isProviderMock("UNISWAP") ? 0.72 : 0.94,
    createdAt: new Date().toISOString()
  };
}
