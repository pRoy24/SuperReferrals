import { NextResponse } from "next/server";
import { normalizeWallet, nowIso } from "@/lib/ids";
import { getGeneration, mutateStore, readStore, removeGenerationVideoReferences, updateGeneration } from "@/lib/store";
import type { Generation } from "@/lib/types";

type GenerationAction = "publish" | "unpublish" | "delete";

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
    const action = String(body.action || "").trim() as GenerationAction;
    if (action !== "publish" && action !== "unpublish" && action !== "delete") {
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

    const result = await mutateStore((store) => {
      const current = store.generations.find((item) => item.id === id);
      if (!current) {
        throw new Error("generation not found");
      }
      if (action === "delete") {
        const cleanup = removeGenerationVideoReferences(store, {
          generationId: id,
          inftId: current.inftId,
          reason: "deleted"
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

    return NextResponse.json(result);
  } catch (error) {
    console.error("Generation mutation failed", error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to update video" },
      { status: 400 }
    );
  }
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
