import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, isProviderMock } from "./env";
import { createId, shortHash } from "./ids";
import {
  delay,
  isReplacementTransactionError,
  withSerializedZeroGTransaction,
  zeroGTransactionRetryDelayMs,
  getZeroGChainConfig
} from "./zero-g-chain";

const inftAbi = parseAbi([
  "function nextTokenId() view returns (uint256)",
  "function mintAgent(address to, string encryptedURI, bytes32 metadataHash, address agentWallet, string referrerCode) returns (uint256)"
]);
const INFT_TRANSACTION_RETRY_COUNT = 3;

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
  const privateKey = env("OG_PRIVATE_KEY") as `0x${string}`;
  const chain = getINFTChain();
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (isProviderMock("INFT")) {
    return {
      tokenId: String(BigInt(`0x${shortHash(`${ownerWallet}:${metadataUri}`)}`)),
      contractAddress: contractAddress || "0x0000000000000000000000000000000000000000",
      txHash: createId("mock_mint"),
      mock: true
    };
  }
  if (!contractAddress || !privateKey) {
    throw new Error("INFT_CONTRACT_ADDRESS and OG_PRIVATE_KEY are required when INFT_MOCKS=false");
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
  const mint = await withSerializedZeroGTransaction(`0g-inft:${account.address.toLowerCase()}:${rpcUrl}`, async () => {
    const nextTokenId = await publicClient.readContract({
      address: contractAddress,
      abi: inftAbi,
      functionName: "nextTokenId"
    });
    const txHash = await writeMintWithRetry({
      accountAddress: account.address,
      agentWallet,
      contractAddress,
      metadataHash,
      metadataUri,
      ownerWallet,
      publicClient,
      referrerCode,
      walletClient
    });
    return {
      tokenId: String(nextTokenId),
      txHash
    };
  });
  return {
    tokenId: mint.tokenId,
    contractAddress,
    txHash: mint.txHash,
    mock: false
  };
}

export function deriveAgentWallet(seed: string) {
  return `0x${shortHash(seed).padEnd(40, "0")}` as `0x${string}`;
}

async function writeMintWithRetry({
  accountAddress,
  agentWallet,
  contractAddress,
  metadataHash,
  metadataUri,
  ownerWallet,
  publicClient,
  referrerCode,
  walletClient
}: {
  accountAddress: `0x${string}`;
  agentWallet: `0x${string}`;
  contractAddress: `0x${string}`;
  metadataHash: `0x${string}`;
  metadataUri: string;
  ownerWallet: `0x${string}`;
  publicClient: any;
  referrerCode: string;
  walletClient: any;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= INFT_TRANSACTION_RETRY_COUNT; attempt += 1) {
    try {
      const nonce = await publicClient.getTransactionCount({
        address: accountAddress,
        blockTag: "pending"
      }).catch(() => undefined);
      const feeOverrides = await buildViemFeeOverrides(publicClient, attempt);
      return await walletClient.writeContract({
        address: contractAddress,
        abi: inftAbi,
        functionName: "mintAgent",
        args: [ownerWallet, metadataUri, metadataHash, agentWallet, referrerCode],
        ...(nonce === undefined ? {} : { nonce }),
        ...feeOverrides
      });
    } catch (error) {
      lastError = error;
      if (attempt < INFT_TRANSACTION_RETRY_COUNT && isReplacementTransactionError(error)) {
        await delay(zeroGTransactionRetryDelayMs(attempt));
        continue;
      }
      throw error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function buildViemFeeOverrides(publicClient: any, attempt: number) {
  const fees = await publicClient.estimateFeesPerGas().catch(() => null);
  if (fees?.maxFeePerGas && fees?.maxPriorityFeePerGas) {
    return {
      maxFeePerGas: bumpGasPrice(fees.maxFeePerGas, attempt),
      maxPriorityFeePerGas: bumpGasPrice(fees.maxPriorityFeePerGas, attempt)
    };
  }

  const gasPrice = await publicClient.getGasPrice().catch(() => null);
  return gasPrice ? { gasPrice: bumpGasPrice(gasPrice, attempt) } : {};
}

function bumpGasPrice(value: bigint, attempt: number) {
  const multiplier = BigInt(100 + attempt * 25);
  return (value * multiplier) / 100n + BigInt(attempt + 1);
}
