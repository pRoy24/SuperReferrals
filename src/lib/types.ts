export type GenerationStatus =
  | "DRAFT"
  | "PAYMENT_PENDING"
  | "PAYMENT_CONFIRMED"
  | "QUEUED"
  | "PROCESSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "REFUNDED";

export type VideoModel = "VEO3.1I2V" | "SEEDANCEI2V" | "KLING3.0" | "RUNWAYML";

export interface CustomerPricing {
  currency: "USD" | "USDC";
  pricePerImageUsd: number;
  platformFeeBps: number;
  refundOnFailureBps: number;
  chainId: number;
  settlementTokenAddress?: string;
}

export interface Customer {
  id: string;
  name: string;
  ownerWallet: string;
  samsarApiKeyAlias?: string;
  pricing: CustomerPricing;
  referrerBaseUrl: string;
  ensName?: string;
  subscription: {
    status: "not_started" | "active" | "paused";
    streamId?: string;
    creditsRemaining?: number;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ExternalUserIdentity {
  provider: string;
  external_user_id: string;
  external_app_id: string;
  username?: string;
}

export interface SubAccount {
  id: string;
  customerId: string;
  wallet: string;
  email?: string;
  username?: string;
  referrerCode: string;
  externalUser: ExternalUserIdentity;
  externalApiKey?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentQuote {
  id: string;
  customerId: string;
  subAccountId?: string;
  imageCount: number;
  amountUsd: number;
  platformFeeUsd: number;
  totalUsd: number;
  tokenIn?: string;
  tokenOut?: string;
  chainId?: number;
  route?: unknown;
  createdAt: string;
}

export interface GenerationInput {
  image_urls: Array<string | Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  prompt?: string;
  video_model: VideoModel;
  aspect_ratio: "16:9" | "9:16";
  language?: string;
  enable_subtitles?: boolean;
  outro_image_url?: string;
  generate_outro_image?: boolean;
  cta_url?: string;
  cta_text_top?: string;
  cta_text_bottom?: string;
  cta_logo?: string;
}

export interface GenerationPayment {
  quoteId?: string;
  txHash?: string;
  payerWallet?: string;
  amountUsd: number;
  tokenAddress?: string;
  chainId?: number;
  status: "mock_confirmed" | "quoted" | "confirmed" | "refunded" | "failed";
}

export interface ZeroGArtifact {
  rootHash: string;
  txHash?: string;
  uri: string;
  sizeBytes?: number;
  contentType?: string;
  mock: boolean;
}

export interface RefundRecord {
  amountUsd: number;
  reason: string;
  keeperExecutionId?: string;
  txHash?: string;
  status: "requested" | "completed" | "failed" | "mock_completed";
  createdAt: string;
}

export interface Generation {
  id: string;
  customerId: string;
  subAccountId: string;
  referrerCode: string;
  status: GenerationStatus;
  input: GenerationInput;
  payment: GenerationPayment;
  samsarRequestId?: string;
  samsarSessionId?: string;
  resultUrl?: string;
  storage?: {
    video?: ZeroGArtifact;
    metadata?: ZeroGArtifact;
  };
  inftId?: string;
  refund?: RefundRecord;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
}

export interface INFTAttribute {
  trait_type: string;
  value: string | number | boolean;
}

export interface INFTRecord {
  id: string;
  generationId: string;
  customerId: string;
  subAccountId: string;
  ownerWallet: string;
  title: string;
  description: string;
  videoUrl: string;
  storageRootHash: string;
  metadataRootHash: string;
  metadataUri: string;
  tokenId?: string;
  contractAddress?: string;
  mintTxHash?: string;
  agentWalletAddress: string;
  axlPeerId?: string;
  referrer: {
    code: string;
    url: string;
    ensName?: string;
  };
  attributes: INFTAttribute[];
  createdAt: string;
  updatedAt: string;
}

export interface SuperReferrerStore {
  version: 1;
  customers: Customer[];
  subAccounts: SubAccount[];
  quotes: PaymentQuote[];
  generations: Generation[];
  infts: INFTRecord[];
}
