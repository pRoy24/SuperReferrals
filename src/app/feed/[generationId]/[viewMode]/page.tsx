import { headers } from "next/headers";
import { notFound } from "next/navigation";
import FeedPage from "@/components/FeedPage";
import { readStore } from "@/lib/store";
import { findStorefrontByEnsHost, requestHostFromHeaders, storefrontFeedPageProps } from "@/lib/storefront-routing";

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
  const customer = findStorefrontByEnsHost(store.customers, requestHostFromHeaders(requestHeaders));
  return <FeedPage initialGenerationId={decodeURIComponent(generationId)} initialViewMode={viewMode} {...storefrontFeedPageProps(customer)} />;
}
