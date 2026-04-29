import { NextResponse } from "next/server";
import { normalizeWallet, nowIso } from "@/lib/ids";
import { buildINFTBurnRequest, burnINFT, verifyINFTBurnTransaction } from "@/lib/inft";
import { getGeneration, mutateStore, readStore, removeGenerationVideoReferences, updateGeneration } from "@/lib/store";
import type { Generation } from "@/lib/types";

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
      const prepared = await prepareGenerationINFTBurn(id);
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
        const cleanup = removeGenerationVideoReferences(store, {
          generationId: id,
          inftId: burnResult.inftId || current.inftId
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
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to update video" },
      { status: 400 }
    );
  }
}

async function prepareGenerationINFTBurn(id: string) {
  return mutateStore((store) => {
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
    const nextFeed = {
      ...(generation.feed || { tags: [] }),
      published: false
    };
    return {
      generation: updateGeneration(store, id, { feed: nextFeed }),
      burn: {
        prepared: true,
        inftId: inft.id,
        tokenId: inft.tokenId,
        mock: burnRequest.mock
      },
      burnRequest
    };
  });
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
      txHash: burnTxHash,
      recorded: true
    };
  }
  const result = await burnINFT({ tokenId: inft.tokenId });
  return {
    burned: true,
    inftId: inft.id,
    tokenId: inft.tokenId,
    txHash: result.txHash,
    mock: result.mock
  };
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
