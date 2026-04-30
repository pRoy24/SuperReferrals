import { headers } from "next/headers";
import { notFound } from "next/navigation";
import FeedPage from "@/components/FeedPage";
import StorefrontPublicGalleryPage from "@/components/StorefrontPublicGalleryPage";
import UserLandingPage from "@/components/UserLandingPage";
import { listPublicFeedItems } from "@/lib/feed";
import { readStore } from "@/lib/store";
import {
  requestHostFromHeaders,
  resolveStorefrontEnsPathMatch,
  storefrontFeedPageProps
} from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function EnsScopedPathPage({
  params
}: {
  params: Promise<{ ensPath?: string[] }>;
}) {
  const { ensPath = [] } = await params;
  const store = await readStore();
  const requestHeaders = await headers();
  const match = resolveStorefrontEnsPathMatch(
    store.customers,
    requestHostFromHeaders(requestHeaders),
    `/${ensPath.join("/")}`
  );
  if (!match) {
    notFound();
  }
  if (match.surface === "feed") {
    return <FeedPage {...storefrontFeedPageProps(match.customer)} />;
  }
  if (match.surface === "mosaic") {
    const feed = await listPublicFeedItems({ customerId: match.customer.id, sort: "newest", limit: 100 });
    return <StorefrontPublicGalleryPage customer={match.customer} items={feed.items} />;
  }
  if (match.surface === "video" && match.generationId && match.viewMode) {
    return (
      <FeedPage
        initialGenerationId={match.generationId}
        initialViewMode={match.viewMode}
        {...storefrontFeedPageProps(match.customer)}
      />
    );
  }
  return <UserLandingPage customerId={match.customer.id} />;
}
