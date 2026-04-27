import { NextResponse } from "next/server";
import { syncGeneration } from "@/lib/orchestrator";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const generation = await syncGeneration(id);
    return NextResponse.json({ generation });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to sync generation";
    return NextResponse.json(
      { message },
      { status: message.toLowerCase().includes("not found") ? 404 : 500 }
    );
  }
}
