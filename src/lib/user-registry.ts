import { createWalletClient, encodePacked, getAddress, http, isAddress, keccak256, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, isProviderMock } from "./env";
import { createId } from "./ids";
import { getZeroGChainConfig } from "./zero-g-chain";
import type { SubAccountBlockchainRegistration } from "./types";

const userRegistryAbi = parseAbi([
  "function registerUser(string customerId, address wallet, bytes32 profileRoot, string profileUri, string referrerCode) returns (bytes32)",
  "function userProfile(bytes32 profileId) view returns ((string customerId, address wallet, bytes32 profileRoot, string profileUri, string referrerCode, uint256 registeredAt, bool active))"
]);

export function zeroGUserProfileId(customerId: string, wallet: string) {
  const normalizedWallet = normalizeAddress(wallet);
  return keccak256(encodePacked(["string", "address"], [customerId, normalizedWallet]));
}

export async function registerZeroGUserProfile(input: {
  customerId: string;
  wallet: string;
  referrerCode: string;
  profileRootHash: `0x${string}`;
  profileUri: string;
  storageRootHash?: string;
}): Promise<SubAccountBlockchainRegistration> {
  const wallet = normalizeAddress(input.wallet);
  const configuredChainId = Number(env("USER_REGISTRY_CHAIN_ID") || env("OG_CHAIN_ID") || "");
  const chain = getZeroGChainConfig(Number.isFinite(configuredChainId) && configuredChainId > 0 ? configuredChainId : undefined);
  const contractAddress = env("USER_REGISTRY_CONTRACT_ADDRESS") as `0x${string}`;
  const privateKey = env("OG_PRIVATE_KEY") as `0x${string}`;
  const profileId = zeroGUserProfileId(input.customerId, wallet);
  const registeredAt = new Date().toISOString();

  if (isProviderMock("USER_REGISTRY")) {
    return {
      profileId,
      chainId: chain.id,
      chainName: chain.name,
      contractAddress: contractAddress || "0x0000000000000000000000000000000000000000",
      txHash: createId("mock_0g_user"),
      profileRootHash: input.profileRootHash,
      profileUri: input.profileUri,
      storageRootHash: input.storageRootHash,
      registeredAt,
      mock: true
    };
  }
  if (!contractAddress || !privateKey) {
    throw new Error("USER_REGISTRY_CONTRACT_ADDRESS and OG_PRIVATE_KEY are required when USER_REGISTRY_MOCKS=false");
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    account,
    chain: {
      id: chain.id,
      name: chain.name,
      nativeCurrency: chain.nativeCurrency,
      rpcUrls: { default: { http: [chain.rpcUrl] } }
    },
    transport: http(chain.rpcUrl)
  });
  const txHash = await walletClient.writeContract({
    address: contractAddress,
    abi: userRegistryAbi,
    functionName: "registerUser",
    args: [input.customerId, wallet, input.profileRootHash, input.profileUri, input.referrerCode]
  });

  return {
    profileId,
    chainId: chain.id,
    chainName: chain.name,
    contractAddress,
    txHash,
    profileRootHash: input.profileRootHash,
    profileUri: input.profileUri,
    storageRootHash: input.storageRootHash,
    registeredAt,
    mock: false
  };
}

function normalizeAddress(wallet: string) {
  if (!isAddress(wallet)) {
    throw new Error("wallet must be a valid EVM address");
  }
  return getAddress(wallet);
}
