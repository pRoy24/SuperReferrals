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
export type PaymentRail = "direct" | "uniswap" | "keeperhub";
export type PaymentCurrencySymbol = "USD" | "USDC" | "USDT" | "ETH" | "WETH";
export type VideoAspectRatio = "16:9" | "9:16";

export interface ModelPricingConfiguration {
  id: string;
  label: string;
  videoModel: VideoModel;
  aspectRatio: VideoAspectRatio;
  baseCreditsPerSecond: number;
  maxSecondsPerImage: number;
  basePricePerSecondUsd?: number;
  customPricePerSecondUsd?: number;
  pricePerImageUsd?: number;
  enabled: boolean;
}

export interface CustomerPricing {
  currency: PaymentCurrencySymbol;
  pricePerImageUsd?: number;
  pricePerSecondUsd?: number;
  creditUnitUsd?: number;
  customerMultiplier?: number;
  modelConfigurations?: ModelPricingConfiguration[];
  platformFeeBps: number;
  refundOnFailureBps: number;
  chainId: number;
  settlementTokenAddress?: string;
}

export interface CustomerStorefrontDetails {
  description?: string;
  websiteUrl?: string;
  supportEmail?: string;
  category?: string;
  tags?: string[];
  conditions?: CustomerStorefrontConditions;
}

export interface CustomerStorefrontConditions {
  enabled: boolean;
  allowedModels?: VideoModel[];
  allowedAspectRatios?: VideoAspectRatio[];
  maxImages?: number;
  dailyWalletRenderLimit?: number;
  walletAccessMode?: "open" | "whitelist";
  walletWhitelist?: string[];
}

export interface Customer {
  id: string;
  name: string;
  ownerWallet: string;
  samsarApiKeyAlias?: string;
  samsarAccount?: {
    email?: string;
    username?: string;
    userId?: string;
    authToken?: string;
    apiKey?: string;
    hasSession?: boolean;
    hasApiKey?: boolean;
    externalProvider?: string;
    externalUserId?: string;
    walletAddress?: string;
    checkoutSessionId?: string;
    checkoutUrl?: string;
    paymentStatusEndpoint?: string;
    externalPaymentId?: string;
    processedCheckoutSessionIds?: string[];
    loginUrl?: string;
    passwordSetupUrl?: string;
    updatedAt?: string;
  };
  pricing: CustomerPricing;
  referrerBaseUrl: string;
  ensName?: string;
  storefront?: CustomerStorefrontDetails;
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
  external_company_id?: string;
  external_account_id?: string;
  email?: string;
  username?: string;
  display_name?: string;
  user_type?: string;
  metadata?: Record<string, unknown>;
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
  blockchainRegistration?: SubAccountBlockchainRegistration;
  preferences?: SubAccountPreferences;
  createdAt: string;
  updatedAt: string;
}

export interface SubAccountPreferences {
  renderForm?: Record<string, unknown>;
  renderFormMode?: "simple" | "advanced";
  updatedAt: string;
}

export interface SubAccountBlockchainRegistration {
  profileId: string;
  chainId: number;
  chainName: string;
  contractAddress?: string;
  txHash?: string;
  profileRootHash: string;
  profileUri: string;
  storageRootHash?: string;
  registeredAt: string;
  mock: boolean;
}

export interface PaymentQuote {
  id: string;
  customerId: string;
  subAccountId?: string;
  imageCount: number;
  durationSeconds?: number;
  amountUsd: number;
  platformFeeUsd: number;
  totalUsd: number;
  pricePerSecondUsd?: number;
  baseCreditsPerSecond?: number;
  creditUnitUsd?: number;
  customerMultiplier?: number;
  videoModel?: VideoModel;
  aspectRatio?: VideoAspectRatio;
  pricingConfigurationId?: string;
  tokenIn?: string;
  tokenOut?: string;
  paymentCurrency?: PaymentCurrencySymbol;
  settlementCurrency?: PaymentCurrencySymbol;
  paymentRail?: PaymentRail;
  paymentTokenAddress?: string;
  paymentAmountAtomic?: string;
  paymentRecipientAddress?: string;
  settlementTokenAddress?: string;
  settlementAmountAtomic?: string;
  checkoutUrl?: string;
  chainId?: number;
  route?: unknown;
  createdAt: string;
}

export interface GenerationInput {
  image_urls: Array<string | Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  prompt?: string;
  video_model: VideoModel;
  aspect_ratio: VideoAspectRatio;
  duration_seconds?: number;
  language?: string;
  enable_subtitles?: boolean;
  outro_image_url?: string;
  add_outro_animation?: boolean;
  add_outro_focus_area?: boolean;
  outro_focust_area?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  generate_outro_image?: boolean;
  cta_url?: string;
  cta_text_top?: string;
  cta_text_bottom?: string;
  cta_logo?: string;
  add_footer_animation?: boolean;
  footer_metadata?: Array<{
    url: string;
    title?: string;
  }>;
}

export interface GenerationFeedSettings {
  published: boolean;
  tags: string[];
  publishedAt?: string;
}

export interface GenerationPayment {
  quoteId?: string;
  txHash?: string;
  payerWallet?: string;
  amountUsd: number;
  tokenAddress?: string;
  tokenSymbol?: PaymentCurrencySymbol;
  paymentAmountAtomic?: string;
  settlementTokenAddress?: string;
  settlementTokenSymbol?: PaymentCurrencySymbol;
  settlementAmountAtomic?: string;
  paymentRail?: PaymentRail;
  chainId?: number;
  status: "mock_confirmed" | "quoted" | "pending" | "confirmed" | "refunded" | "failed";
  keeperExecutionId?: string;
  route?: unknown;
  verification?: {
    txHash: string;
    chainId: number;
    blockNumber: string;
    tokenAddress: string;
    recipientWallet: string;
    amountAtomic: string;
  };
  samsarCreditGrant?: ExternalCreditGrant;
}

export interface ExternalCreditGrant {
  credits: number;
  creditsGranted: number;
  remainingCredits: number;
  status: "mock_confirmed" | "confirmed";
  source: "samsar_external_grant";
  raw?: unknown;
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
  feed?: GenerationFeedSettings;
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

export type FeedSortOption = "ranked" | "newest" | "most_liked" | "most_commented" | "most_viewed";

export interface FeedLike {
  id: string;
  generationId: string;
  viewerId: string;
  createdAt: string;
}

export interface FeedComment {
  id: string;
  generationId: string;
  viewerId: string;
  authorName: string;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface FeedView {
  id: string;
  generationId: string;
  viewerId: string;
  count: number;
  createdAt: string;
  updatedAt: string;
}

export interface FeedMetrics {
  likes: number;
  comments: number;
  views: number;
  score: number;
}

export interface PublicFeedItem {
  id: string;
  generationId: string;
  inftId?: string;
  customerId: string;
  customerName: string;
  subAccountId: string;
  authorName: string;
  referrerCode: string;
  title: string;
  description: string;
  videoUrl: string;
  posterUrl?: string;
  aspectRatio: VideoAspectRatio;
  videoModel: VideoModel;
  tags: string[];
  metrics: FeedMetrics;
  comments: FeedComment[];
  likedByViewer: boolean;
  createdAt: string;
  publishedAt: string;
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

export interface StorefrontRating {
  id: string;
  customerId: string;
  subAccountId?: string;
  generationId?: string;
  inftId?: string;
  operation?: string;
  wallet?: string;
  score: number;
  comment?: string;
  createdAt: string;
  updatedAt: string;
}

export type ZeroGPillar = "chain" | "storage" | "da" | "compute" | "service_marketplace";

export type AgentJobType =
  | "generate_video"
  | "remix_inft"
  | "translate"
  | "join"
  | "brand_review"
  | "simulation";

export type AgentJobStatus =
  | "PLANNING"
  | "APPROVED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "ROLLED_BACK";

export interface AgentCapability {
  id: string;
  label: string;
  description: string;
  samsarEndpoint?: string;
  requiredPillars: ZeroGPillar[];
}

export interface AgentServiceListing {
  marketplaceId?: string;
  keeperhubWorkflowId?: string;
  priceUsd?: number;
  paidWorkflow?: boolean;
}

export interface AgentProfile {
  id: string;
  customerId?: string;
  name: string;
  role: string;
  personality: string;
  walletAddress: string;
  axlPeerId: string;
  capabilities: string[];
  serviceListing?: AgentServiceListing;
  createdAt: string;
  updatedAt: string;
}

export interface AgentPillarReceipt {
  pillar: ZeroGPillar;
  status: "mocked" | "planned" | "submitted" | "completed" | "failed";
  label: string;
  detail: string;
  rootHash?: string;
  uri?: string;
  txHash?: string;
  executionId?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

export interface AgentPriceSignal {
  source: "uniswap";
  chargeUsd: number;
  settlementToken: string;
  paymentToken: string;
  route?: unknown;
  confidence: number;
  createdAt: string;
}

export interface KeeperSettlementRecord {
  mode: "distribution" | "refund" | "rollback";
  status: "mock_completed" | "completed" | "failed" | "planned";
  executionIds: string[];
  allocations: Array<{
    label: string;
    recipientAddress: string;
    amountUsd: number;
  }>;
  rollbackPolicy: string;
  createdAt: string;
}

export interface AgentTownEvent {
  id: string;
  jobId?: string;
  fromAgentId: string;
  toAgentId?: string;
  channel: "axl" | "system" | "keeperhub" | "0g";
  eventType: "message" | "decision" | "receipt" | "handoff" | "rollback";
  content: string;
  payload?: Record<string, unknown>;
  axlMessageId?: string;
  createdAt: string;
}

export interface AgentJob {
  id: string;
  customerId: string;
  subAccountId?: string;
  generationId?: string;
  inftId?: string;
  requestedByAgentId: string;
  assignedAgentIds: string[];
  type: AgentJobType;
  status: AgentJobStatus;
  objective: string;
  input: Record<string, unknown>;
  plan?: Record<string, unknown>;
  priceSignal?: AgentPriceSignal;
  keeperSettlement?: KeeperSettlementRecord;
  receipts: AgentPillarReceipt[];
  output?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SuperReferralsStore {
  version: 1 | 2 | 3 | 4;
  customers: Customer[];
  subAccounts: SubAccount[];
  quotes: PaymentQuote[];
  generations: Generation[];
  infts: INFTRecord[];
  storefrontRatings: StorefrontRating[];
  feedLikes: FeedLike[];
  feedComments: FeedComment[];
  feedViews: FeedView[];
  agents: AgentProfile[];
  agentJobs: AgentJob[];
  agentTownEvents: AgentTownEvent[];
}
