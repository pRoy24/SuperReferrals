import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import FeedPage from "@/components/FeedPage";
import { readStore } from "@/lib/store";
import {
  findStorefrontEnsHostMatch,
  requestHostFromHeaders,
  resolveStorefrontEnsPathMatch,
  storefrontFeedPageProps,
  storefrontProxyPath
} from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function FocusedDeviceFeedPage({
  params
}: {
  params: Promise<{ generationId: string; viewMode: string }>;
}) {
  const { generationId, viewMode } = await params;
  if (viewMode !== "mobile" && viewMode !== "desktop") {
    notFound();
  }
  const store = await readStore();
  const requestHeaders = await headers();
  const requestHost = requestHostFromHeaders(requestHeaders);
  const decodedGenerationId = decodeURIComponent(generationId);
  const match = resolveStorefrontEnsPathMatch(
    store.customers,
    requestHost,
    `/feed/${encodeURIComponent(decodedGenerationId)}/${viewMode}`
  );
  const hostMatch = findStorefrontEnsHostMatch(store.customers, requestHost);
  if (hostMatch && match?.surface !== "video") {
    redirect(storefrontProxyPath(hostMatch.customer, "video", {
      generationId: decodedGenerationId,
      viewMode
    }));
  }
  const customer = match?.surface === "video" ? match.customer : undefined;
  return (
    <FeedPage
      initialGenerationId={decodedGenerationId}
      initialViewMode={viewMode}
      {...storefrontFeedPageProps(customer)}
    />
  );
}
