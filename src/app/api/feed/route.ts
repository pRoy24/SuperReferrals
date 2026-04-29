import { NextResponse } from "next/server";
import { listPublicFeedItems } from "@/lib/feed";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 40);
  const result = await listPublicFeedItems({
    search: url.searchParams.get("q") || undefined,
    tag: url.searchParams.get("tag") || undefined,
    sort: url.searchParams.get("sort") || undefined,
    viewerId: url.searchParams.get("viewerId") || undefined,
    focusId: url.searchParams.get("focusId") || undefined,
    limit
  });
  return NextResponse.json(result);
}
