import { env, isMockMode } from "./env";
import { bytes32From, sha256Hex } from "./ids";
import type { ZeroGArtifact } from "./types";

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

export async function uploadBufferToZeroG(
  buffer: Buffer,
  contentType: string,
  fileName: string
): Promise<ZeroGArtifact> {
  const rootHash = bytes32From(buffer);
  const rpcUrl = env("OG_RPC_URL");
  const indexerRpc = env("OG_STORAGE_INDEXER_RPC");
  const privateKey = env("OG_PRIVATE_KEY");

  if (isMockMode() || !rpcUrl || !indexerRpc || !privateKey) {
    return {
      rootHash,
      uri: `0g://mock/${sha256Hex(buffer).slice(0, 32)}/${encodeURIComponent(fileName)}`,
      sizeBytes: buffer.byteLength,
      contentType,
      mock: true
    };
  }

  const sdk = await import("@0gfoundation/0g-ts-sdk") as Record<string, any>;
  const ethers = await import("ethers");
  const signer = new ethers.Wallet(privateKey, new ethers.JsonRpcProvider(rpcUrl));
  const indexer = new sdk.Indexer(indexerRpc);
  const data = new sdk.MemData(new Uint8Array(buffer));
  const [, treeErr] = await data.merkleTree();
  if (treeErr) {
    throw new Error(`0G merkle tree error: ${String(treeErr)}`);
  }
  const [tx, uploadErr] = await indexer.upload(data, rpcUrl, signer);
  if (uploadErr) {
    throw new Error(`0G upload error: ${String(uploadErr)}`);
  }
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
