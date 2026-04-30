import { headers } from "next/headers";
import FeedPage from "@/components/FeedPage";
import { readStore } from "@/lib/store";
import { findStorefrontByEnsHost, requestHostFromHeaders, storefrontFeedPageProps } from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function PublicFeedPage() {
  const store = await readStore();
  const requestHeaders = await headers();
  const customer = findStorefrontByEnsHost(store.customers, requestHostFromHeaders(requestHeaders));
  return <FeedPage {...storefrontFeedPageProps(customer)} />;
}
