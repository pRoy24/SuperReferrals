import { headers } from "next/headers";
import { redirect } from "next/navigation";
import StorefrontPublicGalleryPage from "@/components/StorefrontPublicGalleryPage";
import { listPublicFeedItems } from "@/lib/feed";
import { readStore } from "@/lib/store";
import {
  findStorefrontEnsHostMatch,
  requestHostFromHeaders,
  resolveStorefrontEnsPathMatch,
  storefrontProxyPath
} from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function PublicGalleryPage() {
  const store = await readStore();
  const requestHeaders = await headers();
  const requestHost = requestHostFromHeaders(requestHeaders);
  const match = resolveStorefrontEnsPathMatch(store.customers, requestHost, "/gallery");
  const hostMatch = findStorefrontEnsHostMatch(store.customers, requestHost);
  if (hostMatch && match?.surface !== "mosaic") {
    redirect(storefrontProxyPath(hostMatch.customer, "mosaic"));
  }
  const customer = match?.surface === "mosaic" ? match.customer : undefined;
  const feed = await listPublicFeedItems({
    customerId: customer?.id,
    sort: "newest",
    limit: 100
  });
  return <StorefrontPublicGalleryPage customer={customer} items={feed.items} />;
}
