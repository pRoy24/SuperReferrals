export type Currency = "ETH" | "USDC";
export type PaymentChain = "eth-sepolia" | "base-mainnet";
export type CollectiblesChain = "0g-galileo" | "0g-mainnet";
export type FileType = "image" | "video" | "book" | "pdf" | "audio" | "model" | "archive";
export type TemplateId = "obsidian" | "chromium" | "signal";
export type RoutingMode = "cname-ens" | "ens-subdomain" | "path";
export type WalletRole = "buyer" | "seller" | "partner";
export type CollectibleStandard = "erc721" | "erc1155" | "inft";
export type CollectionMode = "database" | "onchain";
export type SaleMechanism = "fixed" | "dutch" | "offer";

export type WalletAccount = {
  address: string;
  role: WalletRole;
  registeredAt: string;
};

export type StoreRouting = {
  mode: RoutingMode;
  cnameDomain: string;
  ensTarget: string;
  ensSubdomain: string;
  path: string;
  status: "draft" | "pending" | "verified";
};

export type StoreSettings = {
  name: string;
  tagline: string;
  description: string;
  ownerWallet: string;
  treasuryWallet: string;
  template: TemplateId;
  routing: StoreRouting;
  webhookUrl: string;
  acceptedCurrencies: Currency[];
};

export type MetadataAttribute = {
  trait_type: string;
  value: string;
};

export type Listing = {
  id: string;
  marketplaceListingId?: string;
  title: string;
  description: string;
  sellerWallet: string;
  amount: number;
  currency: Currency;
  collectionMode: CollectionMode;
  tokenStandard: CollectibleStandard;
  quantityAvailable: number;
  saleMechanism: SaleMechanism;
  auctionStartAmount?: number;
  auctionStartsAt?: string;
  auctionEndsAt?: string;
  acceptsOffers: boolean;
  fileType: FileType;
  mediaUrl: string;
  metadata: MetadataAttribute[];
  rights: string;
  chain: CollectiblesChain;
  createdAt: string;
  status: "listed" | "sold";
};

export type ReferralPartner = {
  id: string;
  wallet: string;
  code: string;
  joinedAt: string;
  sales: number;
  commission: number;
};

export type Sale = {
  id: string;
  listingId: string;
  buyerWallet: string;
  sellerWallet: string;
  currency: Currency;
  settlementCurrency: Currency;
  sellerAmount: number;
  platformFee: number;
  referrerFee: number;
  finalAmount: number;
  referrerCode?: string;
  collectionMode: CollectionMode;
  tokenStandard: CollectibleStandard;
  saleMechanism: SaleMechanism;
  paymentChain: PaymentChain;
  paymentChainId: number;
  collectiblesChain: CollectiblesChain;
  keeperHubExecutionIds: string[];
  marketplaceReleaseTxHash?: string;
  settlementStatus: "mock_completed" | "completed" | "pending" | "failed";
  releaseStatus: "not_required" | "mock_released" | "released" | "pending" | "failed";
  keeperHubRoute: string;
  createdAt: string;
};

export type SaleBreakdown = {
  sellerAmount: number;
  platformFee: number;
  referrerFee: number;
  finalAmount: number;
  platformRate: number;
  referrerRate: number;
};

export type PaymentChainConfig = {
  id: number;
  key: PaymentChain;
  network: "sepolia" | "base";
  name: string;
  nativeCurrency: "ETH";
  usdcAddress: string;
  explorerUrl: string;
};

export type KeeperHubAllocation = {
  label: "seller" | "platform" | "referrer";
  recipientAddress: string;
  amount: number;
  currency: Currency;
};

export type SuperStoresTransactionRequest = {
  saleId: string;
  listingId: string;
  marketplaceListingId?: string;
  buyerWallet: string;
  sellerWallet: string;
  platformTreasuryWallet: string;
  referrerWallet?: string;
  referrerCode?: string;
  buyerCurrency: Currency;
  settlementCurrency: Currency;
  sellerAmount: number;
  platformFee: number;
  referrerFee: number;
  finalAmount: number;
  collectionMode: CollectionMode;
  tokenStandard: CollectibleStandard;
  saleMechanism: SaleMechanism;
  quantity: number;
  environment: string;
};

export type SuperStoresTransactionResult = {
  ok: boolean;
  saleId: string;
  paymentChain: PaymentChain;
  paymentChainId: number;
  collectiblesChain: CollectiblesChain;
  keeperHub: {
    status: "mock_completed" | "completed" | "pending" | "failed";
    network: "sepolia" | "base";
    executionIds: string[];
    allocations: KeeperHubAllocation[];
  };
  release: {
    status: "not_required" | "mock_released" | "released" | "pending" | "failed";
    marketplaceAddress?: string;
    txHash?: string;
    gasEstimate?: string;
  };
  error?: string;
};

export const FILE_TYPES: FileType[] = ["image", "video", "book", "pdf", "audio", "model", "archive"];
export const CURRENCIES: Currency[] = ["ETH", "USDC"];
export const COLLECTIBLE_STANDARDS: CollectibleStandard[] = ["erc721", "erc1155", "inft"];
export const COLLECTION_MODES: CollectionMode[] = ["database", "onchain"];
export const SALE_MECHANISMS: SaleMechanism[] = ["fixed", "dutch", "offer"];

export const templates: Array<{
  id: TemplateId;
  name: string;
  description: string;
  signal: string;
}> = [
  {
    id: "obsidian",
    name: "Obsidian",
    description: "Dense trading surface with high-contrast cards and compact controls.",
    signal: "Carbon, mint, graphite"
  },
  {
    id: "chromium",
    name: "Chromium",
    description: "Sharper storefront with metallic panels and larger media previews.",
    signal: "Chrome, ink, amber"
  },
  {
    id: "signal",
    name: "Signal",
    description: "Minimal gallery with lower chrome and stronger collectible metadata.",
    signal: "Black, ivory, electric green"
  }
];

export const initialStoreSettings: StoreSettings = {
  name: "Nebula Objects",
  tagline: "Digital collectibles settled in crypto.",
  description: "A storefront framework for limited media, books, video drops, files, and other onchain digital goods.",
  ownerWallet: "0xA17bF7c91DaAec0f6C0d6E6Dd0F6f6Dd9E117421",
  treasuryWallet: "0x58B1f43D3b29C9f7b4a48e6fC0901b7Ac1902b10",
  template: "obsidian",
  routing: {
    mode: "path",
    cnameDomain: "collect.nebula.example",
    ensTarget: "nebula-store.eth",
    ensSubdomain: "collect.nebula-store.eth",
    path: "/nebula",
    status: "pending"
  },
  webhookUrl: "https://merchant.example/api/superstores/sales",
  acceptedCurrencies: ["ETH", "USDC"]
};

export const seedListings: Listing[] = [
  {
    id: "lst_nebula_001",
    marketplaceListingId: "1",
    title: "Zero Garden Loop",
    description: "A 12-second collectible video loop with commercial display rights.",
    sellerWallet: "0x392F9a725c9341E7BA2184c097A6c32dD3010E02",
    amount: 0.18,
    currency: "ETH",
    collectionMode: "onchain",
    tokenStandard: "erc1155",
    quantityAvailable: 25,
    saleMechanism: "dutch",
    auctionStartAmount: 0.24,
    auctionStartsAt: "2026-05-01T08:00:00.000Z",
    auctionEndsAt: "2026-05-08T08:00:00.000Z",
    acceptsOffers: true,
    fileType: "video",
    mediaUrl: "ipfs://zero-garden-loop",
    metadata: [
      { trait_type: "Collection", value: "Zero Garden" },
      { trait_type: "Edition", value: "1/25" },
      { trait_type: "Motion", value: "Loop" }
    ],
    rights: "Display and resale rights. Source project retained by creator.",
    chain: "0g-galileo",
    createdAt: "2026-05-01T08:00:00.000Z",
    status: "listed"
  },
  {
    id: "lst_nebula_002",
    title: "Sovereign Interface Fieldbook",
    description: "Encrypted PDF fieldbook for marketplace operators and agent storefront builders.",
    sellerWallet: "0x63838b34dB62289b53bB32f2692Ce7e557F00391",
    amount: 240,
    currency: "USDC",
    collectionMode: "database",
    tokenStandard: "erc721",
    quantityAvailable: 1,
    saleMechanism: "fixed",
    acceptsOffers: false,
    fileType: "pdf",
    mediaUrl: "0g://fieldbook-sovereign-interface",
    metadata: [
      { trait_type: "Format", value: "PDF" },
      { trait_type: "Pages", value: "84" },
      { trait_type: "Access", value: "Encrypted" }
    ],
    rights: "Personal reading and resale rights. Redistribution restricted.",
    chain: "0g-galileo",
    createdAt: "2026-05-01T08:30:00.000Z",
    status: "listed"
  },
  {
    id: "lst_nebula_003",
    title: "Blackbox Product Pack",
    description: "Layered image set, product stills, and prompt metadata for AI storefront launches.",
    sellerWallet: "0x82cA46e3bC45Cd63fA2Ed5f7bD6F23d3d1a70016",
    amount: 80,
    currency: "USDC",
    collectionMode: "database",
    tokenStandard: "erc1155",
    quantityAvailable: 40,
    saleMechanism: "offer",
    acceptsOffers: true,
    fileType: "image",
    mediaUrl: "0g://blackbox-product-pack",
    metadata: [
      { trait_type: "Collection", value: "Blackbox" },
      { trait_type: "Files", value: "18" },
      { trait_type: "License", value: "Builder" }
    ],
    rights: "Commercial use for one storefront, resale allowed.",
    chain: "0g-galileo",
    createdAt: "2026-05-01T09:00:00.000Z",
    status: "listed"
  },
  {
    id: "lst_nebula_004",
    marketplaceListingId: "2",
    title: "Encrypted Audio Relic",
    description: "Lossless audio artifact with unlockable transcript and cover image.",
    sellerWallet: "0xAE7A795383dFa21CfBAd10E413c6C8fA82aB2C09",
    amount: 0.055,
    currency: "ETH",
    collectionMode: "onchain",
    tokenStandard: "inft",
    quantityAvailable: 1,
    saleMechanism: "fixed",
    acceptsOffers: false,
    fileType: "audio",
    mediaUrl: "0g://encrypted-audio-relic",
    metadata: [
      { trait_type: "Duration", value: "3:24" },
      { trait_type: "Unlockable", value: "Transcript" },
      { trait_type: "Mood", value: "Nocturne" }
    ],
    rights: "Listening, resale, and private remix rights.",
    chain: "0g-galileo",
    createdAt: "2026-05-01T09:30:00.000Z",
    status: "listed"
  }
];

export const seedPartners: ReferralPartner[] = [
  {
    id: "partner_orbit",
    wallet: "0x557046E75b9B60A77b761ce0A81D82a8Ae84E71f",
    code: "ORBIT10",
    joinedAt: "2026-05-01T07:30:00.000Z",
    sales: 2,
    commission: 34
  }
];

export function calculateSaleBreakdown(amount: number, hasReferrer: boolean): SaleBreakdown {
  const sellerAmount = roundMoney(amount);
  const platformRate = hasReferrer ? 0.1 : 0.2;
  const referrerRate = hasReferrer ? 0.1 : 0;
  const platformFee = roundMoney(sellerAmount * platformRate);
  const referrerFee = roundMoney(sellerAmount * referrerRate);
  const finalAmount = roundMoney(sellerAmount + platformFee + referrerFee);
  return {
    sellerAmount,
    platformFee,
    referrerFee,
    finalAmount,
    platformRate,
    referrerRate
  };
}

export function formatCurrency(amount: number, currency: Currency) {
  const maximumFractionDigits = currency === "ETH" ? 4 : 2;
  return `${new Intl.NumberFormat("en-US", {
    minimumFractionDigits: currency === "ETH" ? 3 : 2,
    maximumFractionDigits
  }).format(amount)} ${currency}`;
}

export function shortWallet(address: string) {
  if (!address) return "Not connected";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export function makeWallet(seed = Math.random()) {
  const chars = "0123456789abcdef";
  let output = "0x";
  let value = Math.abs(Math.sin(seed) * 1_000_000_000);
  for (let index = 0; index < 40; index += 1) {
    value = (value * 9301 + 49297) % 233280;
    output += chars[Math.floor((value / 233280) * chars.length)];
  }
  return output;
}

export function makeReferralCode(address: string) {
  const compact = address.replace(/^0x/i, "").slice(0, 6).toUpperCase();
  return `SS-${compact || "PARTNER"}`;
}

export function marketplaceUrl(settings: StoreSettings, referrerCode?: string) {
  const suffix = referrerCode ? `?ref=${encodeURIComponent(referrerCode)}` : "";
  if (settings.routing.mode === "cname-ens") {
    return `https://${settings.routing.cnameDomain}${suffix}`;
  }
  if (settings.routing.mode === "ens-subdomain") {
    return `https://${settings.routing.ensSubdomain}${suffix}`;
  }
  return `${settings.routing.path || "/store"}${suffix}`;
}

export function routingInstruction(settings: StoreSettings) {
  if (settings.routing.mode === "cname-ens") {
    return `Create CNAME ${settings.routing.cnameDomain} -> ${settings.routing.ensTarget}`;
  }
  if (settings.routing.mode === "ens-subdomain") {
    return `Resolve storefront from ENS subdomain ${settings.routing.ensSubdomain}`;
  }
  return `Serve storefront at path ${settings.routing.path || "/store"}`;
}

export function paymentChainForEnvironment(environment: string): PaymentChain {
  return environment === "production" ? "base-mainnet" : "eth-sepolia";
}

export function collectiblesChainForEnvironment(environment: string): CollectiblesChain {
  return environment === "production" ? "0g-mainnet" : "0g-galileo";
}

export function paymentChainConfigForEnvironment(environment: string): PaymentChainConfig {
  if (paymentChainForEnvironment(environment) === "base-mainnet") {
    return {
      id: 8453,
      key: "base-mainnet",
      network: "base",
      name: "Base Mainnet",
      nativeCurrency: "ETH",
      usdcAddress: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      explorerUrl: "https://basescan.org"
    };
  }
  return {
    id: 11155111,
    key: "eth-sepolia",
    network: "sepolia",
    name: "Ethereum Sepolia",
    nativeCurrency: "ETH",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorerUrl: "https://sepolia.etherscan.io"
  };
}

export function buildKeeperHubAllocations(input: Pick<
  SuperStoresTransactionRequest,
  "sellerWallet" | "platformTreasuryWallet" | "referrerWallet" | "sellerAmount" | "platformFee" | "referrerFee" | "settlementCurrency"
>): KeeperHubAllocation[] {
  const allocations: KeeperHubAllocation[] = [
    {
      label: "seller",
      recipientAddress: input.sellerWallet,
      amount: roundMoney(input.sellerAmount),
      currency: input.settlementCurrency
    },
    {
      label: "platform",
      recipientAddress: input.platformTreasuryWallet,
      amount: roundMoney(input.platformFee),
      currency: input.settlementCurrency
    },
    ...(input.referrerWallet && input.referrerFee > 0
      ? [{
          label: "referrer" as const,
          recipientAddress: input.referrerWallet,
          amount: roundMoney(input.referrerFee),
          currency: input.settlementCurrency
        }]
      : [])
  ];
  return allocations.filter((allocation) => allocation.amount > 0);
}

export function metadataSummary(listing: Pick<Listing, "metadata">) {
  return listing.metadata.map((item) => `${item.trait_type}: ${item.value}`).join(" / ");
}

export function currentListingAmount(listing: Pick<Listing, "amount" | "auctionStartAmount" | "auctionStartsAt" | "auctionEndsAt" | "saleMechanism">, now = Date.now()) {
  if (listing.saleMechanism !== "dutch" || !listing.auctionStartAmount || !listing.auctionStartsAt || !listing.auctionEndsAt) {
    return roundMoney(listing.amount);
  }
  const startsAt = new Date(listing.auctionStartsAt).getTime();
  const endsAt = new Date(listing.auctionEndsAt).getTime();
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || startsAt >= endsAt) {
    return roundMoney(listing.amount);
  }
  if (now <= startsAt) {
    return roundMoney(listing.auctionStartAmount);
  }
  if (now >= endsAt) {
    return roundMoney(listing.amount);
  }
  const progress = (now - startsAt) / (endsAt - startsAt);
  return roundMoney(listing.auctionStartAmount - ((listing.auctionStartAmount - listing.amount) * progress));
}

export function collectionModeLabel(mode: CollectionMode) {
  return mode === "database" ? "Database-only gasless" : "On-chain";
}

export function saleMechanismLabel(mechanism: SaleMechanism) {
  if (mechanism === "dutch") return "Dutch auction";
  if (mechanism === "offer") return "Offers enabled";
  return "Fixed price";
}

export function standardLabel(standard: CollectibleStandard) {
  if (standard === "erc721") return "ERC-721";
  if (standard === "erc1155") return "ERC-1155";
  return "iNFT";
}

export function roundMoney(value: number) {
  return Math.round((Number.isFinite(value) ? value : 0) * 1_000_000) / 1_000_000;
}
