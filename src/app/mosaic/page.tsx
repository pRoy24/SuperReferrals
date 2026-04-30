import { headers } from "next/headers";
import StorefrontPublicMosaicPage from "@/components/StorefrontPublicMosaicPage";
import { listPublicFeedItems } from "@/lib/feed";
import { readStore } from "@/lib/store";
import { findStorefrontByEnsHost, requestHostFromHeaders } from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function PublicMosaicPage() {
  const store = await readStore();
  const requestHeaders = await headers();
  const customer = findStorefrontByEnsHost(store.customers, requestHostFromHeaders(requestHeaders));
  const feed = await listPublicFeedItems({
    customerId: customer?.id,
    sort: "newest",
    limit: 100
  });
  return <StorefrontPublicMosaicPage customer={customer} items={feed.items} />;
}
