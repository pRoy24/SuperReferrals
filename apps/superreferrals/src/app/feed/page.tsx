import { headers } from "next/headers";
import { redirect } from "next/navigation";
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

export default async function PublicFeedPage() {
  const store = await readStore();
  const requestHeaders = await headers();
  const requestHost = requestHostFromHeaders(requestHeaders);
  const match = resolveStorefrontEnsPathMatch(store.customers, requestHost, "/feed");
  const hostMatch = findStorefrontEnsHostMatch(store.customers, requestHost);
  if (hostMatch && match?.surface !== "feed") {
    redirect(storefrontProxyPath(hostMatch.customer, "feed"));
  }
  const customer = match?.surface === "feed" ? match.customer : undefined;
  return <FeedPage {...storefrontFeedPageProps(customer)} />;
}
