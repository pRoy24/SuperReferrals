import { NextResponse } from "next/server";
import { listPublicFeedItems } from "@/lib/feed";
import { findStorefrontByEnsHost, requestHostFromHeaders } from "@/lib/storefront-routing";
import { readStore } from "@/lib/store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 40);
  const customerId = url.searchParams.get("customerId") || await customerIdFromRequestHost(request, url.host);
  const result = await listPublicFeedItems({
    search: url.searchParams.get("q") || undefined,
    tag: url.searchParams.get("tag") || undefined,
    sort: url.searchParams.get("sort") || undefined,
    language: url.searchParams.get("language") || undefined,
    viewerId: url.searchParams.get("viewerId") || undefined,
    focusId: url.searchParams.get("focusId") || undefined,
    customerId,
    limit
  });
  return NextResponse.json(result);
}

async function customerIdFromRequestHost(request: Request, fallbackHost: string) {
  const store = await readStore();
  return findStorefrontByEnsHost(
    store.customers,
    requestHostFromHeaders(request.headers, fallbackHost)
  )?.id;
}
