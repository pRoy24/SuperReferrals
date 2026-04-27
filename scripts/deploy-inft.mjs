import fs from "node:fs";
import path from "node:path";
import { createPublicClient, createWalletClient, defineChain, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";

loadEnvFile(".env.local");
loadEnvFile(".env");

const requestedNetwork = String(process.argv[2] || process.env.OG_NETWORK || "galileo").toLowerCase();
const isMainnet = ["mainnet", "production", "og-mainnet"].includes(requestedNetwork);
const chainId = Number(
  process.env.INFT_CHAIN_ID ||
  process.env.OG_CHAIN_ID ||
  (isMainnet ? 16661 : 16602)
);
const rpcUrl =
  process.env.INFT_RPC_URL ||
  process.env.OG_RPC_URL ||
  (isMainnet ? "https://evmrpc.0g.ai" : "https://evmrpc-testnet.0g.ai");
const explorerUrl =
  process.env.OG_BLOCK_EXPLORER_URL ||
  (isMainnet ? "https://chainscan.0g.ai" : "https://chainscan-galileo.0g.ai");
const privateKey = process.env.OG_PRIVATE_KEY;

if (!privateKey) {
  throw new Error("OG_PRIVATE_KEY is required to deploy SuperReferralsINFT");
}

const artifactPath = path.resolve("artifacts/contracts/SuperReferralsINFT.sol/SuperReferralsINFT.json");
if (!fs.existsSync(artifactPath)) {
  throw new Error("Missing INFT artifact. Run npm run contracts:compile first.");
}

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
const account = privateKeyToAccount(privateKey);
const ownerAddress = account.address;
const chain = defineChain({
  id: chainId,
  name: isMainnet ? "0G Mainnet" : "0G Galileo Testnet",
  nativeCurrency: { name: "0G", symbol: "0G", decimals: 18 },
  rpcUrls: { default: { http: [rpcUrl] } },
  blockExplorers: { default: { name: "0G ChainScan", url: explorerUrl } }
});
const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

console.log(`Deploying SuperReferralsINFT to ${chain.name} (${chain.id})`);
console.log(`Deployer: ${account.address}`);
console.log(`Initial owner: ${ownerAddress}`);

const txHash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  args: [ownerAddress]
});
console.log(`Deploy tx: ${txHash}`);

const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
if (receipt.status !== "success" || !receipt.contractAddress) {
  throw new Error(`INFT deployment failed: ${txHash}`);
}

console.log(`INFT_CONTRACT_ADDRESS=${receipt.contractAddress}`);
console.log(`Explorer: ${explorerUrl.replace(/\/$/, "")}/tx/${txHash}`);

function loadEnvFile(fileName) {
  const envPath = path.resolve(fileName);
  if (!fs.existsSync(envPath)) {
    return;
  }
  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
