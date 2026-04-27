import { NextResponse } from "next/server";
import { recordFeedView } from "@/lib/feed";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const item = await recordFeedView(id, body.viewerId);
    return NextResponse.json({ item });
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to record feed view" },
      { status: 400 }
    );
  }
}
