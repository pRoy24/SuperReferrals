import { NextResponse } from "next/server";
import { getAddress, verifyMessage } from "viem";
import { createId, normalizeWallet, nowIso } from "@/lib/ids";
import { buildINFTBurnRequest, burnINFT, getINFTTokenOwner, preflightINFTBurn, verifyINFTBurnTransaction } from "@/lib/inft";
import { persistJsonToZeroG } from "@/lib/zero-g";
import { addAgentTownEvent, getGeneration, mutateStore, readStore, removeGenerationVideoReferences, updateGeneration } from "@/lib/store";
import type { Generation, INFTRecord, ZeroGArtifact } from "@/lib/types";

type BurnAuthorization = {
  message?: string;
  signature?: string;
  signer?: string;
  nonce?: string;
  issuedAt?: string;
  expiresAt?: string;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const generation = await getGeneration(id);
  if (!generation) {
    return NextResponse.json({ message: "generation not found" }, { status: 404 });
  }
  return NextResponse.json({ generation });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = String(body.action || "").trim();
    if (
      action !== "publish" &&
      action !== "unpublish" &&
      action !== "burn" &&
      action !== "unpublish_and_burn" &&
      action !== "prepare_burn"
    ) {
      return NextResponse.json({ message: "Unsupported generation action" }, { status: 400 });
    }

    const existing = await getGeneration(id);
    if (!existing) {
      return NextResponse.json({ message: "generation not found" }, { status: 404 });
    }
    const store = await readStore();
    if (!isAuthorizedGenerationMutation(existing, body, store)) {
      return NextResponse.json({ message: "Not authorized to update this video" }, { status: 403 });
    }

    if (action === "prepare_burn") {
      const prepared = await prepareGenerationINFTBurn(id, body);
      return NextResponse.json(prepared);
    }

    const isBurnAction = action === "burn" || action === "unpublish_and_burn";
    const burnResult = isBurnAction
      ? await burnGenerationINFT(existing, body)
      : undefined;

    const result = await mutateStore((store) => {
      const current = store.generations.find((item) => item.id === id);
      if (!current) {
        throw new Error("generation not found");
      }
      if (burnResult?.burned) {
        if (burnResult.audit) {
          addAgentTownEvent(store, {
            id: createId("evt"),
            fromAgentId: "superreferrals-platform",
            channel: "0g",
            eventType: "receipt",
            content: `INFT ${burnResult.inftId || current.inftId || id} burn authorized by token owner and executed by platform contract owner.`,
            payload: {
              generationId: id,
              inftId: burnResult.inftId || current.inftId,
              tokenId: burnResult.tokenId,
              txHash: burnResult.txHash,
              audit: burnResult.audit
            },
            createdAt: nowIso()
          });
        }
        const cleanup = removeGenerationVideoReferences(store, {
          generationId: id,
          inftId: burnResult.inftId || current.inftId,
          tokenId: burnResult.tokenId,
          contractAddress: burnResult.contractAddress,
          reason: "burned",
          txHash: burnResult.txHash
        });
        return {
          generation: null,
          cleanup
        };
      }
      const nextFeed = action === "publish"
        ? {
          ...(current.feed || { tags: [] }),
          published: true,
          publishedAt: current.feed?.publishedAt || nowIso()
        }
        : {
          ...(current.feed || { tags: [] }),
          published: false
        };
      return {
        generation: updateGeneration(store, id, { feed: nextFeed })
      };
    });

    return NextResponse.json({ ...result, burn: burnResult });
  } catch (error) {
    console.error("Generation mutation failed", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to update video" },
      { status: 400 }
    );
  }
}

async function prepareGenerationINFTBurn(id: string, body: Record<string, unknown>) {
  const store = await readStore();
  const generation = store.generations.find((item) => item.id === id);
  if (!generation) {
    throw new Error("generation not found");
  }
  const inft = findGenerationINFT(store, generation);
  if (!inft) {
    throw new Error("INFT was not found in the local store.");
  }
  const burnRequest = buildINFTBurnRequest({
    tokenId: inft.tokenId,
    contractAddress: inft.contractAddress
  });
  const authorization = buildBurnAuthorization({
    requestedWallet: cleanOptionalString(body.wallet),
    generation,
    inft,
    burnRequest
  });
  return {
    generation,
    burn: {
      prepared: true,
      inftId: inft.id,
      tokenId: inft.tokenId,
      mock: burnRequest.mock
    },
    burnRequest,
    burnAuthorization: authorization
  };
}

async function burnGenerationINFT(generation: Generation, body: Record<string, unknown>) {
  const store = await readStore();
  const inft = findGenerationINFT(store, generation);
  const burnTxHash = cleanOptionalString(body.burnTxHash || body.txHash);
  if (!inft) {
    if (burnTxHash) {
      return {
        burned: true,
        inftId: generation.inftId,
        txHash: burnTxHash,
        recorded: true
      };
    }
    return { burned: false, inftId: generation.inftId, reason: "INFT was not found in the local store." };
  }
  if (burnTxHash) {
    await verifyINFTBurnTransaction({
      txHash: burnTxHash,
      tokenId: inft.tokenId,
      contractAddress: inft.contractAddress
    });
    return {
      burned: true,
      inftId: inft.id,
      tokenId: inft.tokenId,
      contractAddress: inft.contractAddress,
      txHash: burnTxHash,
      recorded: true
    };
  }
  const preflight = await preflightINFTBurn({ tokenId: inft.tokenId, contractAddress: inft.contractAddress });
  const authorization = await verifyBurnAuthorization(body.burnAuthorization, generation, inft);
  const audit = await persistBurnAuditToZeroG({
    generation,
    inft,
    authorization
  });
  const result = await burnINFT({
    tokenId: inft.tokenId,
    contractAddress: inft.contractAddress,
    burnFunctionName: preflight.burnFunctionName,
    skipPreflight: true
  });
  return {
    burned: true,
    inftId: inft.id,
    tokenId: inft.tokenId,
    contractAddress: inft.contractAddress,
    txHash: result.txHash,
    mock: result.mock,
    authorizedBy: authorization.signer,
    audit
  };
}

function buildBurnAuthorization({
  requestedWallet,
  generation,
  inft,
  burnRequest
}: {
  requestedWallet?: string;
  generation: Generation;
  inft: INFTRecord;
  burnRequest: ReturnType<typeof buildINFTBurnRequest>;
}) {
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const nonce = createId("burn_auth");
  const payload = {
    action: "burn_inft_with_platform_contract_owner",
    generationId: generation.id,
    inftId: inft.id,
    tokenId: inft.tokenId || "",
    contractAddress: inft.contractAddress || burnRequest.contractAddress || "",
    chainId: burnRequest.chain?.id || 0,
    tokenOwner: normalizeWallet(inft.ownerWallet),
    requestedWallet: normalizeWallet(requestedWallet || ""),
    nonce,
    issuedAt,
    expiresAt
  };
  return {
    ...payload,
    message: burnAuthorizationMessage(payload)
  };
}

function burnAuthorizationMessage(payload: {
  action: string;
  generationId: string;
  inftId: string;
  tokenId: string;
  contractAddress: string;
  chainId: number;
  tokenOwner: string;
  requestedWallet: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
}) {
  return [
    "SuperReferrals INFT Burn Authorization",
    "",
    "You authorize SuperReferrals to use the platform contract-owner key to burn the INFT listed below.",
    "The platform will first verify that this signature belongs to the current token owner, preflight an on-chain burn call with the platform key, write this authorization to 0G Storage, then execute the burn.",
    "",
    `Action: ${payload.action}`,
    `Generation ID: ${payload.generationId}`,
    `INFT ID: ${payload.inftId}`,
    `Token ID: ${payload.tokenId}`,
    `Contract: ${payload.contractAddress}`,
    `0G Chain ID: ${payload.chainId}`,
    `Token owner: ${payload.tokenOwner}`,
    `Requested wallet: ${payload.requestedWallet}`,
    `Nonce: ${payload.nonce}`,
    `Issued At: ${payload.issuedAt}`,
    `Expires At: ${payload.expiresAt}`
  ].join("\n");
}

async function verifyBurnAuthorization(input: unknown, generation: Generation, inft: INFTRecord) {
  const authorization = parseBurnAuthorization(input);
  const now = Date.now();
  const expiresAt = Date.parse(authorization.expiresAt || "");
  if (!Number.isFinite(expiresAt) || expiresAt < now) {
    throw new Error("Burn authorization has expired. Start the burn again.");
  }
  const burnRequest = buildINFTBurnRequest({
    tokenId: inft.tokenId,
    contractAddress: inft.contractAddress
  });
  const expected = buildBurnAuthorization({
    requestedWallet: authorization.requestedWallet,
    generation,
    inft,
    burnRequest
  });
  const expectedMessage = burnAuthorizationMessage({
    action: expected.action,
    generationId: expected.generationId,
    inftId: expected.inftId,
    tokenId: expected.tokenId,
    contractAddress: expected.contractAddress,
    chainId: expected.chainId,
    tokenOwner: expected.tokenOwner,
    requestedWallet: expected.requestedWallet,
    nonce: authorization.nonce || "",
    issuedAt: authorization.issuedAt || "",
    expiresAt: authorization.expiresAt || ""
  });
  if (authorization.message !== expectedMessage) {
    throw new Error("Burn authorization details do not match this INFT.");
  }
  const storedOwner = normalizeEvmAddressForCompare(inft.ownerWallet);
  const valid = await verifyMessage({
    address: getAddress(inft.ownerWallet) as `0x${string}`,
    message: authorization.message,
    signature: authorization.signature as `0x${string}`
  }).catch(() => false);
  if (!valid) {
    throw new Error("Burn authorization was not signed by the INFT owner wallet.");
  }
  const currentOwner = await getINFTTokenOwner({
    tokenId: inft.tokenId,
    contractAddress: inft.contractAddress
  }).catch((error) => {
    throw new Error(`Unable to verify current INFT owner before platform burn: ${error instanceof Error ? error.message : String(error)}`);
  });
  const normalizedCurrentOwner = currentOwner ? normalizeEvmAddressForCompare(currentOwner) : storedOwner;
  if (normalizedCurrentOwner !== storedOwner) {
    throw new Error(`Current on-chain INFT owner ${currentOwner} (${normalizedCurrentOwner}) does not match the stored owner ${inft.ownerWallet} (${storedOwner}).`);
  }
  return {
    ...authorization,
    signer: storedOwner,
    currentOwner: normalizedCurrentOwner
  };
}

function normalizeEvmAddressForCompare(value?: string) {
  if (!value) {
    return "";
  }
  try {
    return getAddress(value).toLowerCase();
  } catch {
    return value.trim().toLowerCase();
  }
}

function parseBurnAuthorization(input: unknown): BurnAuthorization & {
  action?: string;
  generationId?: string;
  inftId?: string;
  tokenId?: string;
  contractAddress?: string;
  chainId?: number;
  tokenOwner?: string;
  requestedWallet?: string;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Token owner burn authorization is required.");
  }
  const record = input as Record<string, unknown>;
  const authorization = {
    action: cleanOptionalString(record.action),
    generationId: cleanOptionalString(record.generationId),
    inftId: cleanOptionalString(record.inftId),
    tokenId: cleanOptionalString(record.tokenId),
    contractAddress: cleanOptionalString(record.contractAddress),
    chainId: Number(record.chainId),
    tokenOwner: cleanOptionalString(record.tokenOwner),
    requestedWallet: cleanOptionalString(record.requestedWallet),
    nonce: cleanOptionalString(record.nonce),
    issuedAt: cleanOptionalString(record.issuedAt),
    expiresAt: cleanOptionalString(record.expiresAt),
    message: cleanOptionalString(record.message),
    signature: cleanOptionalString(record.signature),
    signer: cleanOptionalString(record.signer)
  };
  if (!authorization.message || !authorization.signature || !authorization.nonce || !authorization.issuedAt || !authorization.expiresAt) {
    throw new Error("Burn authorization is incomplete.");
  }
  return authorization;
}

async function persistBurnAuditToZeroG({
  generation,
  inft,
  authorization
}: {
  generation: Generation;
  inft: INFTRecord;
  authorization: ReturnType<typeof parseBurnAuthorization> & { signer?: string; currentOwner?: string };
}): Promise<ZeroGArtifact> {
  return persistJsonToZeroG({
    type: "superreferrals.inft_burn_authorization",
    version: 1,
    createdAt: nowIso(),
    generationId: generation.id,
    inftId: inft.id,
    tokenId: inft.tokenId,
    contractAddress: inft.contractAddress,
    customerId: generation.customerId,
    subAccountId: generation.subAccountId,
    tokenOwner: inft.ownerWallet,
    verifiedCurrentOwner: authorization.currentOwner,
    platformBurner: "contract_owner",
    authorization: {
      message: authorization.message,
      signature: authorization.signature,
      signer: authorization.signer,
      nonce: authorization.nonce,
      issuedAt: authorization.issuedAt,
      expiresAt: authorization.expiresAt
    }
  });
}

function findGenerationINFT(store: Awaited<ReturnType<typeof readStore>>, generation: Generation) {
  return store.infts.find((item) =>
    item.id === generation.inftId || item.generationId === generation.id
  );
}

function cleanOptionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isAuthorizedGenerationMutation(generation: Generation, body: Record<string, unknown>, store: Awaited<ReturnType<typeof readStore>>) {
  const actor = String(body.actor || "").trim();
  const customerId = String(body.customerId || body.ownerCustomerId || "").trim();
  if (actor === "owner") {
    return customerId === generation.customerId;
  }

  const subAccountId = String(body.subAccountId || "").trim();
  const wallet = normalizeWallet(String(body.wallet || ""));
  if (!wallet) {
    return false;
  }
  const subAccount = store.subAccounts.find((item) => item.id === generation.subAccountId);
  if (subAccountId && subAccountId !== generation.subAccountId) {
    return false;
  }
  return Boolean(subAccount && wallet === normalizeWallet(subAccount.wallet));
}
