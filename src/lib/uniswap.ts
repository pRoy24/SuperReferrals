import { env, isMockMode } from "./env";
import { createId } from "./ids";

export interface UniswapQuoteInput {
  amount: string;
  tokenIn: string;
  tokenOut: string;
  tokenInChainId: number;
  tokenOutChainId: number;
  swapper: string;
  slippageTolerance?: number;
}

export async function createUniswapQuote(input: UniswapQuoteInput) {
  const apiKey = env("UNISWAP_API_KEY");
  if (isMockMode() || !apiKey) {
    return {
      requestId: createId("mock_uni_quote"),
      quote: {
        routing: "MOCK",
        input,
        output: input.amount,
        warning: "Set UNISWAP_API_KEY and SUPERREFERRER_MOCKS=false for live quotes."
      }
    };
  }

  const response = await fetch(`${env("UNISWAP_BASE_URL", "https://trade-api.gateway.uniswap.org/v1")}/quote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "x-universal-router-version": "2.0",
      "x-permit2-enabled": "true"
    },
    body: JSON.stringify({
      type: "EXACT_INPUT",
      amount: input.amount,
      tokenInChainId: input.tokenInChainId,
      tokenOutChainId: input.tokenOutChainId,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      swapper: input.swapper,
      slippageTolerance: input.slippageTolerance ?? 1,
      routingPreference: "BEST_PRICE"
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "Uniswap quote failed");
  }
  return data;
}
