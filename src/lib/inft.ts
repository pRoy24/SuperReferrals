import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env, isProviderMock } from "./env";
import { createId, shortHash } from "./ids";
import { buildZeroGStorageGatewayUrl } from "./zero-g";
import {
  delay,
  isReplacementTransactionError,
  withSerializedZeroGTransaction,
  zeroGTransactionRetryDelayMs,
  getZeroGChainConfig
} from "./zero-g-chain";
import type { INFTAttribute, INFTRecord } from "./types";

const inftAbi = parseAbi([
  "function nextTokenId() view returns (uint256)",
  "function mintAgent(address to, string encryptedURI, bytes32 metadataHash, address agentWallet, string referrerCode) returns (uint256)",
  "function updateAgentMetadata(uint256 tokenId, string encryptedURI, bytes32 metadataHash)",
  "function burnAgent(uint256 tokenId)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function agentData(uint256 tokenId) view returns ((string encryptedURI, bytes32 metadataHash, address agentWallet, string referrerCode))"
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
    throw new Error("INFT_CONTRACT_ADDRESS and OG_PRIVATE_KEY are required for live INFT minting.");
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

export async function updateINFTMetadata({
  tokenId,
  metadataUri,
  metadataHash
}: {
  tokenId: string;
  metadataUri: string;
  metadataHash: `0x${string}`;
}) {
  const contractAddress = env("INFT_CONTRACT_ADDRESS") as `0x${string}`;
  const privateKey = env("OG_PRIVATE_KEY") as `0x${string}`;
  const chain = getINFTChain();
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (isProviderMock("INFT")) {
    return {
      txHash: createId("mock_update_inft"),
      mock: true
    };
  }
  if (!contractAddress || !privateKey) {
    throw new Error("INFT_CONTRACT_ADDRESS and OG_PRIVATE_KEY are required for live INFT metadata updates.");
  }
  if (!/^\d+$/.test(tokenId)) {
    throw new Error("A numeric token id is required for INFT metadata updates.");
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
  const txHash = await withSerializedZeroGTransaction(`0g-inft:${account.address.toLowerCase()}:${rpcUrl}`, () =>
    writeMetadataUpdateWithRetry({
      accountAddress: account.address,
      contractAddress,
      metadataHash,
      metadataUri,
      publicClient,
      tokenId: BigInt(tokenId),
      walletClient
    })
  );
  return {
    txHash,
    mock: false
  };
}

export async function burnINFT({ tokenId }: { tokenId?: string }) {
  const contractAddress = env("INFT_CONTRACT_ADDRESS") as `0x${string}`;
  const privateKey = env("OG_PRIVATE_KEY") as `0x${string}`;
  const chain = getINFTChain();
  const rpcUrl = chain.rpcUrls.default.http[0];

  if (isProviderMock("INFT")) {
    return {
      txHash: createId("mock_burn_inft"),
      mock: true
    };
  }
  if (!contractAddress || !privateKey) {
    throw new Error("INFT_CONTRACT_ADDRESS and OG_PRIVATE_KEY are required for live INFT burns.");
  }
  if (!tokenId || !/^\d+$/.test(tokenId)) {
    throw new Error("A numeric token id is required to burn this INFT.");
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
  const txHash = await withSerializedZeroGTransaction(`0g-inft:${account.address.toLowerCase()}:${rpcUrl}`, () =>
    writeBurnWithRetry({
      accountAddress: account.address,
      contractAddress,
      publicClient,
      tokenId: BigInt(tokenId),
      walletClient
    })
  );
  return {
    txHash,
    mock: false
  };
}

export async function recoverINFTFromChain(id: string): Promise<INFTRecord | undefined> {
  const contractAddress = env("INFT_CONTRACT_ADDRESS") as `0x${string}`;
  if (isProviderMock("INFT") || !contractAddress) {
    return undefined;
  }

  const chain = getINFTChain();
  const publicClient = createPublicClient({
    chain,
    transport: http(chain.rpcUrls.default.http[0])
  });

  const tokenIds = await resolveRecoveryTokenIds(publicClient, contractAddress, id);
  for (const tokenId of tokenIds) {
    const recovered = await recoverINFTToken(publicClient, contractAddress, tokenId).catch(() => undefined);
    if (recovered && (recovered.id === id || recovered.generationId === id || recovered.tokenId === id)) {
      return recovered;
    }
  }
  return undefined;
}

async function resolveRecoveryTokenIds(publicClient: ReturnType<typeof createPublicClient>, contractAddress: `0x${string}`, id: string) {
  if (/^\d+$/.test(id)) {
    return [BigInt(id)];
  }

  const nextTokenId = await publicClient.readContract({
    address: contractAddress,
    abi: inftAbi,
    functionName: "nextTokenId"
  }) as bigint;
  const latestTokenId = nextTokenId > 1n ? nextTokenId - 1n : 0n;
  const scanLimit = Math.max(1, Number(env("INFT_RECOVERY_SCAN_LIMIT", "250")) || 250);
  const tokenIds: bigint[] = [];
  for (let tokenId = latestTokenId; tokenId >= 1n && tokenIds.length < scanLimit; tokenId -= 1n) {
    tokenIds.push(tokenId);
  }
  return tokenIds;
}

async function recoverINFTToken(
  publicClient: ReturnType<typeof createPublicClient>,
  contractAddress: `0x${string}`,
  tokenId: bigint
): Promise<INFTRecord | undefined> {
  const [ownerWallet, tokenUri, rawAgentData] = await Promise.all([
    publicClient.readContract({
      address: contractAddress,
      abi: inftAbi,
      functionName: "ownerOf",
      args: [tokenId]
    }) as Promise<string>,
    publicClient.readContract({
      address: contractAddress,
      abi: inftAbi,
      functionName: "tokenURI",
      args: [tokenId]
    }) as Promise<string>,
    publicClient.readContract({
      address: contractAddress,
      abi: inftAbi,
      functionName: "agentData",
      args: [tokenId]
    }) as Promise<{
      encryptedURI: string;
      metadataHash: `0x${string}`;
      agentWallet: string;
      referrerCode: string;
    }>
  ]);
  const agentData = normalizeAgentData(rawAgentData);
  const metadata = await fetchTokenMetadata(tokenUri);
  const superreferrals = recordValue(metadata.superreferrals);
  const generationId = stringValue(superreferrals.generationId) || stringValue(superreferrals.generation_id);
  if (!generationId) {
    return undefined;
  }

  const storage = recordValue(metadata.storage);
  const videoStorage = recordValue(storage.video);
  const metadataRootHash =
    rootHashFromUri(tokenUri) ||
    stringValue(superreferrals.metadataRootHash) ||
    stringValue(superreferrals.metadata_root_hash);
  const videoRootHash =
    stringValue(videoStorage.rootHash) ||
    stringValue(videoStorage.root_hash) ||
    stringValue(superreferrals.videoRootHash) ||
    stringValue(superreferrals.video_root_hash);
  const attributes = Array.isArray(metadata.attributes)
    ? metadata.attributes.filter(isINFTAttribute)
    : [];
  const timestamp = new Date().toISOString();
  const title = stringValue(metadata.name) ||
    titleFromSlug(stringValue(superreferrals.referrerCode) || stringValue(superreferrals.referrer_code)) ||
    "SuperReferrals Video";

  return {
    id: generationId,
    generationId,
    customerId: stringValue(superreferrals.customerId) || stringValue(superreferrals.customer_id),
    subAccountId: stringValue(superreferrals.subAccountId) || stringValue(superreferrals.sub_account_id),
    ownerWallet,
    title,
    description: stringValue(metadata.description) || "Generated marketing video",
    videoUrl: stringValue(metadata.animation_url) || stringValue(metadata.animationUrl) || stringValue(videoStorage.uri),
    storageRootHash: videoRootHash,
    metadataRootHash,
    metadataUri: tokenUri,
    tokenId: tokenId.toString(),
    contractAddress,
    agentWalletAddress: agentData.agentWallet,
    referrer: {
      code: agentData.referrerCode || stringValue(superreferrals.referrerCode) || stringValue(superreferrals.referrer_code),
      url: stringValue(superreferrals.referrerUrl) || stringValue(superreferrals.referrer_url)
    },
    attributes,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

function normalizeAgentData(value: unknown) {
  if (Array.isArray(value)) {
    return {
      encryptedURI: stringValue(value[0]),
      metadataHash: stringValue(value[1]),
      agentWallet: stringValue(value[2]),
      referrerCode: stringValue(value[3])
    };
  }
  const record = recordValue(value);
  return {
    encryptedURI: stringValue(record.encryptedURI),
    metadataHash: stringValue(record.metadataHash),
    agentWallet: stringValue(record.agentWallet),
    referrerCode: stringValue(record.referrerCode)
  };
}

async function fetchTokenMetadata(uri: string) {
  const metadataUrl = uriToFetchUrl(uri);
  if (!metadataUrl) {
    throw new Error(`Unsupported INFT metadata URI: ${uri}`);
  }
  const response = await fetch(metadataUrl, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch INFT metadata from ${metadataUrl}: ${response.status}`);
  }
  const metadata = await response.json();
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("INFT metadata was not a JSON object");
  }
  return metadata as Record<string, unknown>;
}

function uriToFetchUrl(uri: string) {
  if (/^https?:\/\//i.test(uri)) {
    return uri;
  }
  const rootHash = rootHashFromUri(uri);
  return rootHash ? buildZeroGStorageGatewayUrl(rootHash) : "";
}

function rootHashFromUri(uri: string) {
  if (uri.startsWith("0g://")) {
    return uri.slice("0g://".length).split(/[/?#]/)[0];
  }
  try {
    const url = new URL(uri);
    return url.searchParams.get("root") || "";
  } catch {
    return "";
  }
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function titleFromSlug(value: string) {
  const slug = value
    .trim()
    .split(/[/?#]/)[0]
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!slug) {
    return "";
  }
  return slug
    .split(" ")
    .map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function isINFTAttribute(value: unknown): value is INFTAttribute {
  const item = recordValue(value);
  return Boolean(stringValue(item.trait_type) && ["string", "number", "boolean"].includes(typeof item.value));
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

async function writeMetadataUpdateWithRetry({
  accountAddress,
  contractAddress,
  metadataHash,
  metadataUri,
  publicClient,
  tokenId,
  walletClient
}: {
  accountAddress: `0x${string}`;
  contractAddress: `0x${string}`;
  metadataHash: `0x${string}`;
  metadataUri: string;
  publicClient: any;
  tokenId: bigint;
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
        functionName: "updateAgentMetadata",
        args: [tokenId, metadataUri, metadataHash],
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

async function writeBurnWithRetry({
  accountAddress,
  contractAddress,
  publicClient,
  tokenId,
  walletClient
}: {
  accountAddress: `0x${string}`;
  contractAddress: `0x${string}`;
  publicClient: any;
  tokenId: bigint;
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
        functionName: "burnAgent",
        args: [tokenId],
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
