import { NextResponse } from "next/server";
import { askINFT } from "@/lib/orchestrator";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const answer = await askINFT(id, String(body.question || body.message || ""));
    return NextResponse.json({ answer });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Assistant request failed" },
      { status: 400 }
    );
  }
}
