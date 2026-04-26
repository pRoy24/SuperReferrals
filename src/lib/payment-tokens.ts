export type PaymentRail = "direct" | "uniswap" | "keeperhub";
export type PaymentCurrencySymbol = "USD" | "USDC" | "USDT" | "ETH" | "WETH";

export interface TransactionChainConfig {
  id: number;
  key: "mainnet" | "sepolia";
  name: string;
  hexChainId: `0x${string}`;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls: string[];
  uniswapChain: string;
  keeperHubNetwork: string;
}

export interface PaymentToken {
  symbol: Exclude<PaymentCurrencySymbol, "USD">;
  name: string;
  chainId: number;
  address: string;
  decimals: number;
  native?: boolean;
}

export const NATIVE_TOKEN_ADDRESS = "0x0000000000000000000000000000000000000000";

export const TRANSACTION_CHAINS: TransactionChainConfig[] = [
  {
    id: 1,
    key: "mainnet",
    name: "Ethereum Mainnet",
    hexChainId: "0x1",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://eth.llamarpc.com"],
    blockExplorerUrls: ["https://etherscan.io"],
    uniswapChain: "mainnet",
    keeperHubNetwork: "ethereum"
  },
  {
    id: 11155111,
    key: "sepolia",
    name: "Sepolia",
    hexChainId: "0xaa36a7",
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    blockExplorerUrls: ["https://sepolia.etherscan.io"],
    uniswapChain: "sepolia",
    keeperHubNetwork: "sepolia"
  }
];

export const PAYMENT_TOKENS: PaymentToken[] = [
  {
    symbol: "USDC",
    name: "USD Coin",
    chainId: 1,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    decimals: 6
  },
  {
    symbol: "USDT",
    name: "Tether USD",
    chainId: 1,
    address: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    decimals: 6
  },
  {
    symbol: "ETH",
    name: "Ether",
    chainId: 1,
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    native: true
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    chainId: 1,
    address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
    decimals: 18
  },
  {
    symbol: "USDC",
    name: "USD Coin",
    chainId: 11155111,
    address: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    decimals: 6
  },
  {
    symbol: "ETH",
    name: "Sepolia Ether",
    chainId: 11155111,
    address: NATIVE_TOKEN_ADDRESS,
    decimals: 18,
    native: true
  },
  {
    symbol: "WETH",
    name: "Wrapped Ether",
    chainId: 11155111,
    address: "0xfff9976782d46cc05630d1f6ebab18b2324d6b14",
    decimals: 18
  }
];

export function getTransactionChainId() {
  const configuredChainId = numberFromEnv("NEXT_PUBLIC_TRANSACTION_CHAIN_ID") ||
    numberFromEnv("TRANSACTION_CHAIN_ID") ||
    numberFromEnv("NEXT_PUBLIC_PAYMENT_CHAIN_ID") ||
    numberFromEnv("PAYMENT_CHAIN_ID");
  if (configuredChainId) {
    return allowMainnetTransactions() ? configuredChainId : forceNonProductionChain(configuredChainId);
  }

  const configuredNetwork = stringFromEnv("NEXT_PUBLIC_TRANSACTION_NETWORK") ||
    stringFromEnv("TRANSACTION_NETWORK") ||
    stringFromEnv("NEXT_PUBLIC_PAYMENT_NETWORK") ||
    stringFromEnv("PAYMENT_NETWORK");
  const networkMatch = TRANSACTION_CHAINS.find((chain) => chain.key === configuredNetwork?.toLowerCase());
  if (networkMatch) {
    return allowMainnetTransactions() ? networkMatch.id : forceNonProductionChain(networkMatch.id);
  }

  return allowMainnetTransactions() ? 1 : 11155111;
}

export function getTransactionChainConfig(chainId = getTransactionChainId()): TransactionChainConfig {
  const chain = TRANSACTION_CHAINS.find((item) => item.id === chainId) || TRANSACTION_CHAINS[1];
  const rpcUrl = stringFromEnv("NEXT_PUBLIC_TRANSACTION_RPC_URL") || stringFromEnv("TRANSACTION_RPC_URL");
  const explorerUrl = stringFromEnv("NEXT_PUBLIC_TRANSACTION_EXPLORER_URL") || stringFromEnv("TRANSACTION_EXPLORER_URL");
  return {
    ...chain,
    rpcUrls: rpcUrl ? [rpcUrl] : chain.rpcUrls,
    blockExplorerUrls: explorerUrl ? [explorerUrl] : chain.blockExplorerUrls
  };
}

export function getPaymentTokens(chainId = getTransactionChainId()) {
  return PAYMENT_TOKENS.filter((token) => token.chainId === chainId);
}

export function findPaymentToken(symbolOrAddress = "USDC", chainId = getTransactionChainId()) {
  const normalized = symbolOrAddress.trim().toLowerCase();
  return PAYMENT_TOKENS.find((token) =>
    token.chainId === chainId &&
    (token.symbol.toLowerCase() === normalized || token.address.toLowerCase() === normalized)
  );
}

export function settlementTokenForCurrency(currency: PaymentCurrencySymbol | string | undefined, chainId = getTransactionChainId()) {
  if (!currency || currency === "USD") {
    return findPaymentToken("USDC", chainId);
  }
  return findPaymentToken(currency, chainId) || findPaymentToken("USDC", chainId);
}

export function amountToAtomic(value: number, decimals: number) {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  const [whole, fraction = ""] = safeValue.toFixed(Math.min(decimals, 8)).split(".");
  const paddedFraction = fraction.padEnd(decimals, "0").slice(0, decimals);
  const multiplier = 10n ** BigInt(decimals);
  return String(BigInt(whole || "0") * multiplier + BigInt(paddedFraction || "0"));
}

function numberFromEnv(name: string) {
  const value = stringFromEnv(name);
  const parsed = value ? Number(value) : 0;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function stringFromEnv(name: string) {
  return typeof process !== "undefined" ? process.env[name]?.trim() : "";
}

function allowMainnetTransactions() {
  const deploymentEnv = String(
    stringFromEnv("NEXT_PUBLIC_DEPLOYMENT_ENV") ||
    stringFromEnv("DEPLOYMENT_ENV") ||
    stringFromEnv("NEXT_PUBLIC_APP_ENV") ||
    stringFromEnv("APP_ENV") ||
    stringFromEnv("VERCEL_ENV")
  ).toLowerCase();
  return stringFromEnv("NODE_ENV") === "production" && deploymentEnv === "production";
}

function forceNonProductionChain(chainId: number) {
  return chainId === 1 ? 11155111 : chainId;
}
