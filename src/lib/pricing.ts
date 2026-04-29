import type { Customer, CustomerPricing, GenerationInput, INFTPaidAction, ModelPricingConfiguration, VideoAspectRatio, VideoModel } from "./types";
import { getTransactionChainId, settlementTokenForCurrency } from "./payment-tokens";
import {
  getStorefrontDailyWalletRenderLimit,
  getStorefrontWalletAccessMode,
  getStorefrontWalletWhitelist
} from "./storefront-access";

export const CREDIT_UNIT_USD = 0.01;
export const DEFAULT_CUSTOMER_MULTIPLIER = 1.25;
type PricingOwner = { pricing?: Partial<CustomerPricing> };
const allVideoModels: VideoModel[] = ["VEO3.1I2V", "SEEDANCEI2V", "KLING3.0", "RUNWAYML"];
const allAspectRatios: VideoAspectRatio[] = ["16:9", "9:16"];

export const paidINFTActions: INFTPaidAction[] = [
  "translate",
  "join",
  "add_subtitles",
  "remove_subtitles",
  "add_outro",
  "update_outro",
  "update_footer"
];

export const defaultINFTActionPricesUsd: Record<INFTPaidAction, number> = {
  translate: 0.75,
  join: 0.75,
  add_subtitles: 0.2,
  remove_subtitles: 0.2,
  add_outro: 0.35,
  update_outro: 0.35,
  update_footer: 0.35
};

export const defaultModelPricingConfigurations: ModelPricingConfiguration[] = [
  {
    id: "runwayml-9-16",
    label: "RUNWAYML vertical",
    videoModel: "RUNWAYML",
    aspectRatio: "9:16",
    baseCreditsPerSecond: 25,
    maxSecondsPerImage: 10,
    enabled: true
  },
  {
    id: "runwayml-16-9",
    label: "RUNWAYML landscape",
    videoModel: "RUNWAYML",
    aspectRatio: "16:9",
    baseCreditsPerSecond: 25,
    maxSecondsPerImage: 10,
    enabled: true
  },
  {
    id: "veo31-9-16",
    label: "VEO 3.1 vertical",
    videoModel: "VEO3.1I2V",
    aspectRatio: "9:16",
    baseCreditsPerSecond: 75,
    maxSecondsPerImage: 8,
    enabled: true
  },
  {
    id: "veo31-16-9",
    label: "VEO 3.1 landscape",
    videoModel: "VEO3.1I2V",
    aspectRatio: "16:9",
    baseCreditsPerSecond: 75,
    maxSecondsPerImage: 8,
    enabled: true
  },
  {
    id: "seedance-9-16",
    label: "Seedance vertical",
    videoModel: "SEEDANCEI2V",
    aspectRatio: "9:16",
    baseCreditsPerSecond: 75,
    maxSecondsPerImage: 10,
    enabled: true
  },
  {
    id: "seedance-16-9",
    label: "Seedance landscape",
    videoModel: "SEEDANCEI2V",
    aspectRatio: "16:9",
    baseCreditsPerSecond: 75,
    maxSecondsPerImage: 10,
    enabled: true
  },
  {
    id: "kling-9-16",
    label: "Kling 3.0 vertical",
    videoModel: "KLING3.0",
    aspectRatio: "9:16",
    baseCreditsPerSecond: 50,
    maxSecondsPerImage: 10,
    enabled: true
  },
  {
    id: "kling-16-9",
    label: "Kling 3.0 landscape",
    videoModel: "KLING3.0",
    aspectRatio: "16:9",
    baseCreditsPerSecond: 50,
    maxSecondsPerImage: 10,
    enabled: true
  }
];

export const defaultPricing: CustomerPricing = {
  currency: "USDC",
  pricePerImageUsd: 1.25,
  pricePerSecondUsd: 0.31,
  inftActionPricesUsd: defaultINFTActionPricesUsd,
  creditUnitUsd: CREDIT_UNIT_USD,
  customerMultiplier: DEFAULT_CUSTOMER_MULTIPLIER,
  modelConfigurations: defaultModelPricingConfigurations,
  platformFeeBps: 500,
  refundOnFailureBps: 5000,
  chainId: getTransactionChainId(),
  settlementTokenAddress: settlementTokenForCurrency("USDC", getTransactionChainId())?.address
};

export function countImages(input: Pick<GenerationInput, "image_urls">) {
  return Array.isArray(input.image_urls) ? input.image_urls.length : 0;
}

export function priceGeneration(customer: Customer, imageCount: number, input?: Partial<GenerationInput>) {
  const modelPricing = resolveModelPricing(customer, input?.video_model, input?.aspect_ratio);
  const durationSeconds = estimateDurationSeconds(imageCount, modelPricing, input);
  const details = resolveModelPriceDetails(customer, modelPricing);
  const amountUsd = roundMoney(details.pricePerSecondUsd * durationSeconds);
  const platformFeeUsd = roundMoney((amountUsd * customer.pricing.platformFeeBps) / 10_000);
  const perImageEquivalent = imageCount > 0 ? roundMoney(amountUsd / imageCount) : details.pricePerSecondUsd;
  return {
    amountUsd,
    platformFeeUsd,
    totalUsd: roundMoney(amountUsd + platformFeeUsd),
    pricePerImageUsd: perImageEquivalent,
    pricePerSecondUsd: details.pricePerSecondUsd,
    durationSeconds,
    baseCreditsPerSecond: details.baseCreditsPerSecond,
    creditUnitUsd: details.creditUnitUsd,
    customerMultiplier: details.customerMultiplier,
    pricingConfigurationId: modelPricing?.id
  };
}

export function normalizeINFTPaidAction(action: string): INFTPaidAction | "" {
  const normalized = action.trim().toLowerCase();
  return paidINFTActions.includes(normalized as INFTPaidAction)
    ? normalized as INFTPaidAction
    : "";
}

export function getINFTActionPricesUsd(customer?: PricingOwner | null): Record<INFTPaidAction, number> {
  const configured = customer?.pricing?.inftActionPricesUsd || {};
  return paidINFTActions.reduce((prices, action) => {
    prices[action] = roundMoney(positiveNumber(configured[action], defaultINFTActionPricesUsd[action]));
    return prices;
  }, {} as Record<INFTPaidAction, number>);
}

export function priceINFTAction(customer: Customer, action: INFTPaidAction) {
  const prices = getINFTActionPricesUsd(customer);
  const amountUsd = roundMoney(prices[action]);
  const platformFeeUsd = roundMoney((amountUsd * customer.pricing.platformFeeBps) / 10_000);
  return {
    action,
    amountUsd,
    platformFeeUsd,
    totalUsd: roundMoney(amountUsd + platformFeeUsd),
    durationSeconds: undefined,
    pricePerSecondUsd: undefined,
    baseCreditsPerSecond: undefined,
    creditUnitUsd: getCreditUnitUsd(customer),
    customerMultiplier: getCustomerMultiplier(customer),
    pricingConfigurationId: `inft-action-${action}`
  };
}

export function getAllowedModelPricingConfigurations(customer?: Customer | null) {
  const configurations = getModelPricingConfigurations(customer).filter((item) => item.enabled !== false);
  if (!customer?.storefront?.conditions?.enabled) {
    return configurations;
  }
  const allowedModels = getAllowedStorefrontModels(customer);
  const allowedAspectRatios = getAllowedStorefrontAspectRatios(customer);
  return configurations.filter((item) =>
    allowedModels.includes(item.videoModel) &&
    allowedAspectRatios.includes(item.aspectRatio)
  );
}

export function getAllowedStorefrontModels(customer?: Customer | null): VideoModel[] {
  if (!customer?.storefront?.conditions?.enabled) {
    return allVideoModels;
  }
  const configured = customer.storefront.conditions.allowedModels;
  if (!Array.isArray(configured)) {
    return allVideoModels;
  }
  return configured.filter((item): item is VideoModel =>
    allVideoModels.includes(item as VideoModel)
  );
}

export function getAllowedStorefrontAspectRatios(customer?: Customer | null): VideoAspectRatio[] {
  if (!customer?.storefront?.conditions?.enabled) {
    return allAspectRatios;
  }
  const configured = customer.storefront.conditions.allowedAspectRatios;
  if (!Array.isArray(configured)) {
    return allAspectRatios;
  }
  return configured.filter((item): item is VideoAspectRatio =>
    allAspectRatios.includes(item as VideoAspectRatio)
  );
}

export function getStorefrontMaxImages(customer?: Customer | null) {
  if (!customer?.storefront?.conditions?.enabled) {
    return undefined;
  }
  const maxImages = Number(customer.storefront.conditions.maxImages);
  return Number.isFinite(maxImages) && maxImages > 0 ? Math.floor(maxImages) : undefined;
}

export function getStorefrontConditionTiles(customer?: Customer | null) {
  if (!customer?.storefront?.conditions?.enabled) {
    return ["Standard render rules"];
  }
  const allowedModels = getAllowedStorefrontModels(customer);
  const allowedAspectRatios = getAllowedStorefrontAspectRatios(customer);
  const tiles = [
    `Models: ${allowedModels.length ? allowedModels.join(", ") : "none"}`,
    `Aspects: ${allowedAspectRatios.length ? allowedAspectRatios.join(", ") : "none"}`
  ];
  const maxImages = getStorefrontMaxImages(customer);
  if (maxImages) {
    tiles.push(`Max ${maxImages} image${maxImages === 1 ? "" : "s"}`);
  }
  const dailyLimit = getStorefrontDailyWalletRenderLimit(customer);
  if (dailyLimit) {
    tiles.push(`${dailyLimit} render${dailyLimit === 1 ? "" : "s"} / wallet / day`);
  }
  if (getStorefrontWalletAccessMode(customer) === "whitelist") {
    const walletCount = getStorefrontWalletWhitelist(customer).length;
    tiles.push(`${walletCount} whitelisted wallet${walletCount === 1 ? "" : "s"}`);
  }
  return tiles;
}

export function getRenderConditionError(
  customer: Customer | null | undefined,
  input: {
    imageCount?: number;
    videoModel?: VideoModel;
    aspectRatio?: VideoAspectRatio;
  }
) {
  if (!customer) {
    return "Customer store is not available";
  }
  const imageCount = Number(input.imageCount || 0);
  const maxImages = getStorefrontMaxImages(customer);
  if (maxImages && imageCount > maxImages) {
    return `This storefront allows up to ${maxImages} image${maxImages === 1 ? "" : "s"} per render.`;
  }
  if (input.videoModel && !getAllowedStorefrontModels(customer).includes(input.videoModel)) {
    return `${input.videoModel} is not enabled for this storefront.`;
  }
  if (input.aspectRatio && !getAllowedStorefrontAspectRatios(customer).includes(input.aspectRatio)) {
    return `${input.aspectRatio} is not enabled for this storefront.`;
  }
  if (input.videoModel && input.aspectRatio) {
    const pricing = getAllowedModelPricingConfigurations(customer).find((item) =>
      item.videoModel === input.videoModel &&
      item.aspectRatio === input.aspectRatio
    );
    if (!pricing) {
      return `${input.videoModel} ${input.aspectRatio} is not priced or enabled for this storefront.`;
    }
  }
  if (getAllowedModelPricingConfigurations(customer).length === 0) {
    return "This storefront has no enabled render models.";
  }
  return "";
}

export function assertRenderConditions(
  customer: Customer,
  input: {
    imageCount?: number;
    videoModel?: VideoModel;
    aspectRatio?: VideoAspectRatio;
  }
) {
  const error = getRenderConditionError(customer, input);
  if (error) {
    throw new Error(error);
  }
}

export function getModelPricingConfigurations(customer?: Customer | null) {
  const configured = customer?.pricing?.modelConfigurations;
  if (!Array.isArray(configured) || configured.length === 0) {
    return defaultModelPricingConfigurations;
  }
  const configuredById = new Map(configured.map((item) => [item.id, item]));
  return defaultModelPricingConfigurations.map((fallback) => {
    const configuredItem = configuredById.get(fallback.id);
    if (!configuredItem) {
      return fallback;
    }
    return {
      ...fallback,
      ...configuredItem,
      baseCreditsPerSecond: positiveNumber(configuredItem.baseCreditsPerSecond, fallback.baseCreditsPerSecond),
      maxSecondsPerImage: positiveNumber(configuredItem.maxSecondsPerImage, fallback.maxSecondsPerImage),
      customPricePerSecondUsd: optionalPositiveNumber(configuredItem.customPricePerSecondUsd),
      enabled: configuredItem.enabled !== false
    };
  });
}

export function resolveModelPricing(
  customer: Customer,
  videoModel?: VideoModel,
  aspectRatio?: VideoAspectRatio
) {
  if (!videoModel || !aspectRatio) {
    return null;
  }
  return getAllowedModelPricingConfigurations(customer).find((item) =>
    item.videoModel === videoModel &&
    item.aspectRatio === aspectRatio
  ) || null;
}

export function resolveModelPriceDetails(customer?: PricingOwner | null, modelPricing?: ModelPricingConfiguration | null) {
  const creditUnitUsd = getCreditUnitUsd(customer);
  const customerMultiplier = getCustomerMultiplier(customer);
  const baseCreditsPerSecond = positiveNumber(modelPricing?.baseCreditsPerSecond, 75);
  const basePricePerSecondUsd = roundRate(baseCreditsPerSecond * creditUnitUsd);
  const customPricePerSecondUsd = optionalPositiveNumber(modelPricing?.customPricePerSecondUsd);
  const pricePerSecondUsd = roundRate(customPricePerSecondUsd ?? basePricePerSecondUsd * customerMultiplier);
  return {
    baseCreditsPerSecond,
    basePricePerSecondUsd,
    creditUnitUsd,
    customerMultiplier,
    customPricePerSecondUsd,
    pricePerSecondUsd
  };
}

export function estimateDurationSeconds(
  imageCount: number,
  modelPricing?: ModelPricingConfiguration | null,
  input?: Partial<GenerationInput>
) {
  const explicitDuration = positiveNumber(input?.duration_seconds, 0);
  if (explicitDuration > 0) {
    return roundDuration(explicitDuration);
  }
  const secondsPerImage = positiveNumber(modelPricing?.maxSecondsPerImage, 10);
  return roundDuration(Math.max(0, imageCount) * secondsPerImage);
}

export function getCustomerMultiplier(customer?: PricingOwner | null) {
  return positiveNumber(customer?.pricing?.customerMultiplier, DEFAULT_CUSTOMER_MULTIPLIER);
}

export function getCreditUnitUsd(customer?: PricingOwner | null) {
  return positiveNumber(customer?.pricing?.creditUnitUsd, CREDIT_UNIT_USD);
}

export function refundAmountForFailure(customer: Customer, paidUsd: number) {
  return roundMoney((paidUsd * customer.pricing.refundOnFailureBps) / 10_000);
}

export function roundMoney(value: number) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function roundRate(value: number) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function roundDuration(value: number) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function positiveNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalPositiveNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
