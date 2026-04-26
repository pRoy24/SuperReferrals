import { appBaseUrl, env } from "./env";

export interface SamsarProcessorCreditCheckoutInput {
  amountCents: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface SamsarProcessorCreditCheckout {
  url: string;
  checkoutSessionId: string;
  amountCents: number;
  credits: number;
  currency: string;
}

export async function createSamsarProcessorCreditCheckout(input: SamsarProcessorCreditCheckoutInput) {
  const amountCents = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("amountCents must be greater than zero");
  }

  const processorBaseUrl = env("SAMSAR_PROCESSOR_BASE_URL", "http://localhost:3002").replace(/\/$/, "");
  const response = await fetch(`${processorBaseUrl}/payments/anonymous_credit_checkout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify({
      amountCents,
      appBaseUrl: appBaseUrl(),
      successPath: "/payment_success",
      cancelPath: "/payment_cancel",
      metadata: {
        sourceProject: "superreferrals",
        ...(input.metadata || {})
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || data.message || "Unable to create Samsar Processor checkout session");
  }

  return data as SamsarProcessorCreditCheckout;
}
