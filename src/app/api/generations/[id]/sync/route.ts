import { NextResponse } from "next/server";
import { syncGeneration } from "@/lib/orchestrator";

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const generation = await syncGeneration(id);
    return NextResponse.json({ generation });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to sync generation" },
      { status: 400 }
    );
  }
}
