import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, isProviderMock } from "./env";
import { createId, shortHash } from "./ids";
import { getZeroGChainConfig } from "./zero-g-chain";

const inftAbi = parseAbi([
  "function nextTokenId() view returns (uint256)",
  "function mintAgent(address to, string encryptedURI, bytes32 metadataHash, address agentWallet, string referrerCode) returns (uint256)"
]);

function getINFTChain() {
  const configuredChainId = Number(env("INFT_CHAIN_ID") || env("OG_CHAIN_ID") || "");
  const chain = getZeroGChainConfig(Number.isFinite(configuredChainId) && configuredChainId > 0 ? configuredChainId : undefined);
  const rpcUrl = env("INFT_RPC_URL") || chain.rpcUrl;
  return {
    id: chain.id,
    name: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: [rpcUrl] }
    }
  } as const;
}

export async function mintINFT({
  ownerWallet,
  metadataUri,
  metadataHash,
  agentWallet,
  referrerCode
}: {
  ownerWallet: `0x${string}`;
  metadataUri: string;
  metadataHash: `0x${string}`;
  agentWallet: `0x${string}`;
  referrerCode: string;
}) {
  const contractAddress = env("INFT_CONTRACT_ADDRESS") as `0x${string}`;
  const privateKey = (env("INFT_MINTER_PRIVATE_KEY") || env("OG_PRIVATE_KEY")) as `0x${string}`;
  const chain = getINFTChain();
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (isProviderMock("INFT") || !contractAddress || !privateKey) {
    return {
      tokenId: String(BigInt(`0x${shortHash(`${ownerWallet}:${metadataUri}`)}`)),
      contractAddress: contractAddress || "0x0000000000000000000000000000000000000000",
      txHash: createId("mock_mint"),
      mock: true
    };
  }

  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({
    chain,
    transport: http(rpcUrl)
  });
  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl)
  });
  const nextTokenId = await publicClient.readContract({
    address: contractAddress,
    abi: inftAbi,
    functionName: "nextTokenId"
  });
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: inftAbi,
    functionName: "mintAgent",
    args: [ownerWallet, metadataUri, metadataHash, agentWallet, referrerCode]
  });
  return {
    tokenId: String(nextTokenId),
    contractAddress,
    txHash,
    mock: false
  };
}

export function deriveAgentWallet(seed: string) {
  return `0x${shortHash(seed).padEnd(40, "0")}` as `0x${string}`;
}
