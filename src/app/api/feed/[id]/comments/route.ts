import { NextResponse } from "next/server";
import { addFeedComment } from "@/lib/feed";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json();
    const result = await addFeedComment({
      generationId: id,
      viewerId: body.viewerId,
      authorName: body.authorName,
      body: body.body
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { message: error instanceof Error ? error.message : "Unable to add comment" },
      { status: 400 }
    );
  }
}
