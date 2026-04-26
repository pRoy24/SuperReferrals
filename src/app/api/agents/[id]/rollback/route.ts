import { NextResponse } from "next/server";
import { rollbackAgentJob } from "@/lib/agent-framework";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const job = await rollbackAgentJob(id, String(body.reason || "Manual rollback requested"));
    return NextResponse.json({ job });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to roll back agent job" },
      { status: 400 }
    );
  }
}
