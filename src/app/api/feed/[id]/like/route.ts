import { NextResponse } from "next/server";
import { toggleFeedLike } from "@/lib/feed";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const result = await toggleFeedLike(id, body.viewerId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to update feed like" },
      { status: 400 }
    );
  }
}
