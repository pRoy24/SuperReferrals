import { headers } from "next/headers";
import { redirect } from "next/navigation";
import LandingPageClient from "@/components/LandingPageClient";
import FeedPage from "@/components/FeedPage";
import StorefrontPublicGalleryPage from "@/components/StorefrontPublicGalleryPage";
import UserLandingPage from "@/components/UserLandingPage";
import { getLandingEnvDiagnostics } from "@/lib/env-diagnostics";
import { listPublicFeedItems } from "@/lib/feed";
import {
  appLanguageFromCookieHeader,
  DEFAULT_APP_LANGUAGE,
  normalizeAppLanguage
} from "@/lib/localization";
import { readStore } from "@/lib/store";
import {
  findStorefrontEnsHostMatch,
  requestHostFromHeaders,
  resolveStorefrontEnsPathMatch,
  storefrontFeedPageProps,
  storefrontProxyPath
} from "@/lib/storefront-routing";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const initialLanguage =
    normalizeAppLanguage(requestHeaders.get("x-superreferrals-app-language")) ||
    appLanguageFromCookieHeader(requestHeaders.get("cookie")) ||
    DEFAULT_APP_LANGUAGE;
  const store = await readStore();
  const requestHost = requestHostFromHeaders(requestHeaders);
  const customHostMatch = resolveStorefrontEnsPathMatch(store.customers, requestHost, "/");
  if (customHostMatch?.surface === "feed") {
    return <FeedPage {...storefrontFeedPageProps(customHostMatch.customer)} />;
  }
  if (customHostMatch?.surface === "mosaic") {
    const feed = await listPublicFeedItems({ customerId: customHostMatch.customer.id, sort: "newest", limit: 100 });
    return <StorefrontPublicGalleryPage customer={customHostMatch.customer} items={feed.items} />;
  }
  if (customHostMatch?.customer) {
    return <UserLandingPage customerId={customHostMatch.customer.id} />;
  }
  const ensHostMatch = findStorefrontEnsHostMatch(store.customers, requestHost);
  if (ensHostMatch) {
    redirect(storefrontProxyPath(ensHostMatch.customer, "storefront"));
  }
  const featuredFeed = await listPublicFeedItems({ sort: "newest", limit: 100 });
  const customer = store.customers[0];
  const demoReferrer = customer ? store.subAccounts.find((account) => account.customerId === customer.id) : null;
  const latestInft = store.infts[0];
  const referrerHref = demoReferrer ? `/r/${demoReferrer.referrerCode}` : "/dashboard";
  const inftHref = latestInft ? `/inft/${latestInft.id}` : "/feed";

  return (
    <LandingPageClient
      envDiagnostics={getLandingEnvDiagnostics()}
      featuredFeedItems={featuredFeed.items}
      inftHref={inftHref}
      initialLanguage={initialLanguage}
      referrerHref={referrerHref}
    />
  );
}
