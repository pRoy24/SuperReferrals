import { createPublicClient, http, namehash, parseAbi } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { env } from "./env";

const ENS_REGISTRY_ADDRESS = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const ENS_REGISTRY_ABI = parseAbi([
  "function resolver(bytes32 node) view returns (address)"
]);

const SUPERREFERRALS_ENS_TEXT_KEYS = [
  "url",
  "description",
  "avatar",
  "header",
  "com.superreferrals.storefront",
  "com.superreferrals.feed",
  "com.superreferrals.gallery",
  "com.superreferrals.proxy"
];

export async function resolveEnsName(name: string, options: { network?: string; chainId?: number } = {}) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new Error("ENS name is required");
  }
  const chainId = options.chainId || ensChainIdForNetwork(options.network) || Number(env("ENS_CHAIN_ID", "1"));
  const chain = chainId === sepolia.id ? sepolia : mainnet;
  const node = namehash(normalized);
  const defaultRpcUrl = chain.id === sepolia.id
    ? "https://ethereum-sepolia-rpc.publicnode.com"
    : "https://eth.llamarpc.com";
  const client = createPublicClient({
    chain,
    transport: http(env("ENS_RPC_URL", defaultRpcUrl))
  });
  const [address, contentHash, avatar, description, resolverAddress, textEntries] = await Promise.all([
    client.getEnsAddress({ name: normalized }).catch(() => null),
    client.getEnsText({ name: normalized, key: "contenthash" }).catch(() => null),
    client.getEnsAvatar({ name: normalized }).catch(() => null),
    client.getEnsText({ name: normalized, key: "description" }).catch(() => null),
    client.readContract({
      address: ENS_REGISTRY_ADDRESS,
      abi: ENS_REGISTRY_ABI,
      functionName: "resolver",
      args: [node]
    }).then((resolver) => resolver === ZERO_ADDRESS ? null : resolver).catch(() => null),
    Promise.all(SUPERREFERRALS_ENS_TEXT_KEYS.map(async (key) => [
      key,
      await client.getEnsText({ name: normalized, key }).catch(() => null)
    ] as const))
  ]);
  const texts = Object.fromEntries(textEntries.filter(([, value]) => Boolean(value)));
  return {
    name: normalized,
    node,
    chainId: chain.id,
    address,
    contentHash,
    resolverAddress,
    avatar,
    description,
    texts
  };
}

function ensChainIdForNetwork(network: unknown) {
  const normalized = typeof network === "string" ? network.trim().toLowerCase() : "";
  if (normalized === "sepolia" || normalized === "testnet") {
    return sepolia.id;
  }
  if (normalized === "mainnet" || normalized === "ethereum" || normalized === "base") {
    return mainnet.id;
  }
  return undefined;
}
