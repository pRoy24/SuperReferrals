import { NextResponse } from "next/server";
import { startGenerationPolling } from "@/lib/generation-poller";
import { createGeneration } from "@/lib/orchestrator";
import { readStore } from "@/lib/store";

export async function GET() {
  const store = await readStore();
  return NextResponse.json({ generations: store.generations });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const generation = await createGeneration(body);
    if (generation && ["QUEUED", "PROCESSING"].includes(generation.status)) {
      startGenerationPolling(generation.id);
    }
    return NextResponse.json({ generation });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to create generation" },
      { status: 400 }
    );
  }
}
