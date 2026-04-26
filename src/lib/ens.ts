import { createPublicClient, http, namehash } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { env } from "./env";

export async function resolveEnsName(name: string) {
  const normalized = name.trim().toLowerCase();
  if (!normalized) {
    throw new Error("ENS name is required");
  }
  const chainId = Number(env("ENS_CHAIN_ID", "1"));
  const chain = chainId === sepolia.id ? sepolia : mainnet;
  const client = createPublicClient({
    chain,
    transport: http(env("ENS_RPC_URL", "https://eth.llamarpc.com"))
  });
  const [address, contentHash, avatar, description] = await Promise.all([
    client.getEnsAddress({ name: normalized }).catch(() => null),
    client.getEnsText({ name: normalized, key: "contenthash" }).catch(() => null),
    client.getEnsAvatar({ name: normalized }).catch(() => null),
    client.getEnsText({ name: normalized, key: "description" }).catch(() => null)
  ]);
  return {
    name: normalized,
    node: namehash(normalized),
    address,
    contentHash,
    avatar,
    description
  };
}
