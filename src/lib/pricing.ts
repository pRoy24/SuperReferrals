import type { Customer, CustomerPricing, GenerationInput } from "./types";

export const defaultPricing: CustomerPricing = {
  currency: "USDC",
  pricePerImageUsd: 1.25,
  platformFeeBps: 500,
  refundOnFailureBps: 5000,
  chainId: 1
};

export function countImages(input: Pick<GenerationInput, "image_urls">) {
  return Array.isArray(input.image_urls) ? input.image_urls.length : 0;
}

export function priceGeneration(customer: Customer, imageCount: number) {
  const amountUsd = roundMoney(customer.pricing.pricePerImageUsd * imageCount);
  const platformFeeUsd = roundMoney((amountUsd * customer.pricing.platformFeeBps) / 10_000);
  return {
    amountUsd,
    platformFeeUsd,
    totalUsd: roundMoney(amountUsd + platformFeeUsd)
  };
}

export function refundAmountForFailure(customer: Customer, paidUsd: number) {
  return roundMoney((paidUsd * customer.pricing.refundOnFailureBps) / 10_000);
}

export function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}
