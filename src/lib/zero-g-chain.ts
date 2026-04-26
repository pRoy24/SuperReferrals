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

function defaultZeroGChainId() {
  return env("NODE_ENV") === "production" ? "16661" : "16602";
}
