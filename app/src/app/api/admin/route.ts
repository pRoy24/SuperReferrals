import { NextResponse } from "next/server";
import {
  applyAdminFeedOrder,
  assertAdminSecret,
  buildAdminDashboardPayload,
  unpublishAdminFeedItem
} from "@/lib/admin";
import { mutateStore, readStore, removeGenerationVideoReferences } from "@/lib/store";

type AdminAction = "dashboard" | "reorder" | "unpublish" | "delete";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    assertAdminSecret(body.secret);
    const action = normalizeAdminAction(body.action);

    if (action === "dashboard") {
      return NextResponse.json(buildAdminDashboardPayload(await readStore()));
    }

    const payload = await mutateStore((store) => {
      if (action === "reorder") {
        applyAdminFeedOrder(store, body.order);
      } else if (action === "unpublish") {
        unpublishAdminFeedItem(store, normalizeGenerationId(body.generationId));
      } else if (action === "delete") {
        const generationId = normalizeGenerationId(body.generationId);
        const generation = store.generations.find((item) => item.id === generationId);
        if (!generation || generation.status !== "COMPLETED" || generation.feed?.published !== true) {
          throw Object.assign(new Error("Published video was not found."), { status: 404 });
        }
        removeGenerationVideoReferences(store, {
          generationId,
          inftId: generation.inftId,
          reason: "deleted"
        });
      }
      return buildAdminDashboardPayload(store);
    });

    return NextResponse.json(payload);
  } catch (error) {
    const status = readErrorStatus(error);
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Admin request failed." },
      { status }
    );
  }
}

function normalizeAdminAction(value: unknown): AdminAction {
  if (value === "reorder" || value === "unpublish" || value === "delete") {
    return value;
  }
  return "dashboard";
}

function normalizeGenerationId(value: unknown) {
  const generationId = String(value || "").trim();
  if (!generationId) {
    throw Object.assign(new Error("generationId is required."), { status: 400 });
  }
  return generationId;
}

function readErrorStatus(error: unknown) {
  const status = Number((error as { status?: unknown })?.status);
  return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 400;
}
