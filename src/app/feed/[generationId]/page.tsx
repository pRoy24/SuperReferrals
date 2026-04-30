import { headers } from "next/headers";
import FeedPage from "@/components/FeedPage";
import { readStore } from "@/lib/store";
import { findStorefrontByEnsHost, requestHostFromHeaders, storefrontFeedPageProps } from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function FocusedFeedPage({ params }: { params: Promise<{ generationId: string }> }) {
  const { generationId } = await params;
  const store = await readStore();
  const requestHeaders = await headers();
  const customer = findStorefrontByEnsHost(store.customers, requestHostFromHeaders(requestHeaders));
  return <FeedPage initialGenerationId={decodeURIComponent(generationId)} {...storefrontFeedPageProps(customer)} />;
}
