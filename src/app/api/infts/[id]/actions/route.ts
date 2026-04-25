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
      { status: 400 }
    );
  }
}
