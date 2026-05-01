import { headers } from "next/headers";
import { redirect } from "next/navigation";
import FeedPage from "@/components/FeedPage";
import { readStore } from "@/lib/store";
import {
  findStorefrontEnsHostMatch,
  requestHostFromHeaders,
  storefrontProxyPath
} from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function FocusedFeedPage({ params }: { params: Promise<{ generationId: string }> }) {
  const { generationId } = await params;
  const store = await readStore();
  const requestHeaders = await headers();
  const requestHost = requestHostFromHeaders(requestHeaders);
  const hostMatch = findStorefrontEnsHostMatch(store.customers, requestHost);
  const decodedGenerationId = decodeURIComponent(generationId);
  if (hostMatch) {
    redirect(storefrontProxyPath(hostMatch.customer, "video", {
      generationId: decodedGenerationId,
      viewMode: "mobile"
    }));
  }
  return <FeedPage initialGenerationId={decodedGenerationId} />;
}
