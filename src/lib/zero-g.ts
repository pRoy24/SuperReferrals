import { env, isProviderMock } from "./env";
import { bytes32From, sha256Hex } from "./ids";
import type { ZeroGArtifact } from "./types";
import {
  delay,
  errorToSearchText,
  isReplacementTransactionError,
  withSerializedZeroGTransaction,
  zeroGTransactionRetryDelayMs
} from "./zero-g-chain";

type ZeroGUploadSignerState = {
  provider: any;
  signer: any;
  address: string;
};

const uploadSigners = ((globalThis as typeof globalThis & {
  __superReferralsZeroGUploadSigners?: Map<string, ZeroGUploadSignerState>;
}).__superReferralsZeroGUploadSigners ??= new Map<string, ZeroGUploadSignerState>());

const ZERO_G_TRANSACTION_RETRY_COUNT = 3;

export async function persistRemoteVideoToZeroG(videoUrl: string): Promise<ZeroGArtifact> {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`Unable to fetch video for 0G persistence: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  return uploadBufferToZeroG(buffer, "video/mp4", "generation.mp4");
}

export async function persistJsonToZeroG(value: unknown): Promise<ZeroGArtifact> {
  const body = Buffer.from(JSON.stringify(value, null, 2));
  return uploadBufferToZeroG(body, "application/json", "metadata.json");
}

export function buildZeroGStorageGatewayUrl(rootHash: string) {
  const gatewayBase = env("OG_STORAGE_GATEWAY_URL") || env("OG_STORAGE_INDEXER_RPC");
  if (!gatewayBase || rootHash.startsWith("mock/")) {
    return "";
  }
  const url = new URL("/file", gatewayBase.replace(/\/$/, ""));
  url.searchParams.set("root", rootHash);
  return url.toString();
}

export async function publishDataAvailabilityCommitment(value: unknown): Promise<ZeroGArtifact> {
  const body = Buffer.from(JSON.stringify(value, null, 2));
  const rootHash = bytes32From(body);
  const daEndpoint = env("OG_DA_URL");

  if (isProviderMock("ZERO_G")) {
    return {
      rootHash,
      uri: `0g-da://mock/${sha256Hex(body).slice(0, 32)}`,
      sizeBytes: body.byteLength,
      contentType: "application/json",
      mock: true
    };
  }
  if (!daEndpoint) {
    throw new Error("OG_DA_URL is required when ZERO_G_MOCKS=false");
  }

  const response = await fetch(daEndpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env("OG_DA_API_KEY") ? { authorization: `Bearer ${env("OG_DA_API_KEY")}` } : {})
    },
    body
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || `0G DA publish failed: ${response.status}`);
  }
  return {
    rootHash: String(data.rootHash || data.root_hash || rootHash),
    txHash: data.txHash || data.tx_hash,
    uri: String(data.uri || data.url || `0g-da://${data.rootHash || rootHash}`),
    sizeBytes: body.byteLength,
    contentType: "application/json",
    mock: false
  };
}

export async function uploadBufferToZeroG(
  buffer: Buffer,
  contentType: string,
  fileName: string
): Promise<ZeroGArtifact> {
  const rootHash = bytes32From(buffer);
  const rpcUrl = env("OG_RPC_URL");
  const indexerRpc = env("OG_STORAGE_INDEXER_RPC");
  const privateKey = env("OG_PRIVATE_KEY");

  if (isProviderMock("ZERO_G")) {
    return {
      rootHash,
      uri: `0g://mock/${sha256Hex(buffer).slice(0, 32)}/${encodeURIComponent(fileName)}`,
      sizeBytes: buffer.byteLength,
      contentType,
      mock: true
    };
  }
  if (!rpcUrl || !indexerRpc || !privateKey) {
    const missing = [
      !rpcUrl ? "OG_RPC_URL" : "",
      !indexerRpc ? "OG_STORAGE_INDEXER_RPC" : "",
      !privateKey ? "OG_PRIVATE_KEY" : ""
    ].filter(Boolean);
    throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required when ZERO_G_MOCKS=false`);
  }

  const sdk = await import("@0gfoundation/0g-ts-sdk") as Record<string, any>;
  const ethers = await import("ethers");
  const signerState = getZeroGUploadSigner(ethers, rpcUrl, privateKey);
  const indexer = new sdk.Indexer(indexerRpc);
  const data = new sdk.MemData(new Uint8Array(buffer));
  const [, treeErr] = await data.merkleTree();
  if (treeErr) {
    throw new Error(`0G merkle tree error: ${String(treeErr)}`);
  }

  const tx = await withSerializedZeroGTransaction(
    `0g-storage:${signerState.address}:${rpcUrl}`,
    async () => uploadDataWithRetry({
      data,
      ethers,
      indexer,
      privateKey,
      rpcUrl
    })
  );
  const txHash = tx?.txHash || tx?.txHashes?.[0];
  const uploadedRoot = tx?.rootHash || tx?.rootHashes?.[0] || rootHash;
  return {
    rootHash: uploadedRoot,
    txHash,
    uri: `0g://${uploadedRoot}`,
    sizeBytes: buffer.byteLength,
    contentType,
    mock: false
  };
}

function getZeroGUploadSigner(ethers: any, rpcUrl: string, privateKey: string): ZeroGUploadSignerState {
  const key = `${rpcUrl}:${privateKey}`;
  const existing = uploadSigners.get(key);
  if (existing) {
    return existing;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(privateKey, provider);
  const signer = new ethers.NonceManager(wallet);
  const state = {
    provider,
    signer,
    address: String(wallet.address || "").toLowerCase()
  };
  uploadSigners.set(key, state);
  return state;
}

function resetZeroGUploadSigner(ethers: any, rpcUrl: string, privateKey: string) {
  const signerState = getZeroGUploadSigner(ethers, rpcUrl, privateKey);
  signerState.signer.reset?.();
}

async function uploadDataWithRetry({
  data,
  ethers,
  indexer,
  privateKey,
  rpcUrl
}: {
  data: any;
  ethers: any;
  indexer: any;
  privateKey: string;
  rpcUrl: string;
}) {
  let lastError: unknown;
  for (let attempt = 0; attempt <= ZERO_G_TRANSACTION_RETRY_COUNT; attempt += 1) {
    const signerState = getZeroGUploadSigner(ethers, rpcUrl, privateKey);
    try {
      const transactionOptions = await buildZeroGUploadTransactionOptions(signerState.provider, attempt);
      const [tx, uploadErr] = await indexer.upload(
        data,
        rpcUrl,
        signerState.signer,
        buildZeroGUploadOptions(),
        undefined,
        transactionOptions
      );
      if (uploadErr) {
        throw uploadErr;
      }
      return tx;
    } catch (error) {
      lastError = error;
      if (attempt < ZERO_G_TRANSACTION_RETRY_COUNT && isReplacementTransactionError(error)) {
        resetZeroGUploadSigner(ethers, rpcUrl, privateKey);
        await delay(zeroGTransactionRetryDelayMs(attempt));
        continue;
      }
      throw new Error(`0G upload error: ${formatZeroGError(error)}`);
    }
  }

  throw new Error(`0G upload error: ${formatZeroGError(lastError)}`);
}

function buildZeroGUploadOptions() {
  return {
    finalityRequired: parseBooleanEnv("OG_STORAGE_FINALITY_REQUIRED", false)
  };
}

async function buildZeroGUploadTransactionOptions(provider: any, attempt: number) {
  const configuredGasPrice = parseBigIntEnv("OG_GAS_PRICE_WEI");
  const feeData = configuredGasPrice ? null : await provider.getFeeData().catch(() => null);
  const gasPrice = configuredGasPrice || feeData?.gasPrice;
  return gasPrice
    ? { gasPrice: bumpGasPrice(gasPrice, attempt) }
    : undefined;
}

function parseBigIntEnv(name: string) {
  const raw = env(name);
  if (!raw) {
    return null;
  }
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function parseBooleanEnv(name: string, fallback: boolean) {
  const raw = env(name);
  if (!raw) {
    return fallback;
  }
  const normalized = raw.toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function bumpGasPrice(value: bigint, attempt: number) {
  const multiplier = BigInt(100 + attempt * 25);
  return (value * multiplier) / 100n + BigInt(attempt + 1);
}

function formatZeroGError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return errorToSearchText(error);
}
