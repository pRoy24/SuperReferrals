import { createPublicClient, http, namehash, parseAbi } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { env } from "./env";
import { isUsableEvmAddress } from "./wallet-address";

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
  const chain = ensChainForOptions(options);
  const node = namehash(normalized);
  const client = createEnsClient(chain);
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

export async function reverseResolveEnsAddress(address: string, options: { network?: string; chainId?: number } = {}) {
  const normalized = address.trim();
  if (!isUsableEvmAddress(normalized)) {
    throw new Error("A valid wallet address is required for reverse ENS lookup");
  }
  const chain = ensChainForOptions(options);
  const client = createEnsClient(chain);
  const name = await client.getEnsName({ address: normalized as `0x${string}` }).catch(() => null);
  return {
    address: normalized,
    chainId: chain.id,
    name
  };
}

function ensChainForOptions(options: { network?: string; chainId?: number }) {
  const chainId = options.chainId || ensChainIdForNetwork(options.network) || Number(env("ENS_CHAIN_ID", "1"));
  return chainId === sepolia.id ? sepolia : mainnet;
}

function createEnsClient(chain: typeof mainnet | typeof sepolia) {
  return createPublicClient({
    chain,
    transport: http(ensRpcUrl(chain.id))
  });
}

function ensRpcUrl(chainId: number) {
  const networkOverride = chainId === sepolia.id
    ? env("ENS_SEPOLIA_RPC_URL")
    : env("ENS_MAINNET_RPC_URL");
  if (networkOverride) {
    return networkOverride;
  }
  const genericChainId = Number(env("ENS_CHAIN_ID"));
  const genericOverride = env("ENS_RPC_URL");
  if (genericOverride && (!Number.isFinite(genericChainId) || genericChainId === chainId)) {
    return genericOverride;
  }
  return defaultEnsRpcUrl(chainId);
}

function defaultEnsRpcUrl(chainId: number) {
  return chainId === sepolia.id
    ? "https://ethereum-sepolia-rpc.publicnode.com"
    : "https://ethereum-rpc.publicnode.com";
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
