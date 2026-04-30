import { NextResponse } from "next/server";
import { runINFTAction } from "@/lib/orchestrator";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const result = await runINFTAction(id, String(body.action || ""), body.payload || body);
    return NextResponse.json({ result });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "INFT action failed" },
      { status: actionErrorStatus(error) }
    );
  }
}

function actionErrorStatus(error: unknown) {
  if (error && typeof error === "object") {
    const status = Number((error as { status?: unknown }).status);
    const url = String((error as { url?: unknown }).url || "");
    if (Number.isFinite(status) && status >= 400 && /api\.samsar\.one|\/v[12]\//i.test(url)) {
      return 502;
    }
  }
  return 400;
}
