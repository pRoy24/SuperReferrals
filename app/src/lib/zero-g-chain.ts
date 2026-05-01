import { env } from "./env";

export interface ZeroGChainConfig {
  id: number;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrl: string;
  blockExplorerUrl: string;
}

export function getZeroGChainConfig(chainId = Number(env("OG_CHAIN_ID", defaultZeroGChainId()))): ZeroGChainConfig {
  const id = Number.isFinite(chainId) && chainId > 0 ? chainId : Number(defaultZeroGChainId());
  const production = id === 16661;
  return {
    id,
    name: production ? "0G Mainnet" : "0G Galileo Testnet",
    nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
    rpcUrl: env("OG_RPC_URL", production ? "https://evmrpc.0g.ai" : "https://evmrpc-testnet.0g.ai"),
    blockExplorerUrl: env("OG_BLOCK_EXPLORER_URL", production ? "https://chainscan.0g.ai" : "https://chainscan-galileo.0g.ai")
  };
}

const transactionQueues = ((globalThis as typeof globalThis & {
  __superReferralsZeroGTransactionQueues?: Map<string, Promise<void>>;
}).__superReferralsZeroGTransactionQueues ??= new Map<string, Promise<void>>());

export async function withSerializedZeroGTransaction<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = transactionQueues.get(key) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const settled = run.then(() => undefined, () => undefined);
  transactionQueues.set(key, settled);

  try {
    return await run;
  } finally {
    if (transactionQueues.get(key) === settled) {
      transactionQueues.delete(key);
    }
  }
}

export function isReplacementTransactionError(error: unknown) {
  const message = errorToSearchText(error).toLowerCase();
  return (
    message.includes("replacement_underpriced") ||
    message.includes("replacement transaction underpriced") ||
    message.includes("replacement fee too low") ||
    message.includes("transaction underpriced") ||
    message.includes("nonce too low")
  );
}

export function zeroGTransactionRetryDelayMs(attempt: number) {
  return 1500 * (attempt + 1);
}

export function errorToSearchText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message} ${error.stack || ""}`;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function defaultZeroGChainId() {
  const network = normalizeEnvironmentValue(env("OG_NETWORK") || env("NEXT_PUBLIC_OG_NETWORK"));
  if (["mainnet", "production", "prod"].includes(network)) {
    return "16661";
  }
  if (["galileo", "testnet", "staging", "preview", "development", "dev", "local"].includes(network)) {
    return "16602";
  }

  const deploymentEnvironment = normalizeEnvironmentValue(
    env("DEPLOYMENT_ENV") ||
    env("NEXT_PUBLIC_DEPLOYMENT_ENV") ||
    env("VERCEL_ENV") ||
    env("APP_ENV") ||
    env("NEXT_PUBLIC_APP_ENV")
  );
  return deploymentEnvironment === "production" ? "16661" : "16602";
}

function normalizeEnvironmentValue(value: string) {
  return value.trim().toLowerCase();
}
