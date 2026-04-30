import { headers } from "next/headers";
import LandingPageClient from "@/components/LandingPageClient";
import { getLandingEnvDiagnostics } from "@/lib/env-diagnostics";
import { listPublicFeedItems } from "@/lib/feed";
import {
  appLanguageFromCookieHeader,
  DEFAULT_APP_LANGUAGE,
  normalizeAppLanguage
} from "@/lib/localization";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Home() {
  const requestHeaders = await headers();
  const initialLanguage =
    normalizeAppLanguage(requestHeaders.get("x-superreferrals-app-language")) ||
    appLanguageFromCookieHeader(requestHeaders.get("cookie")) ||
    DEFAULT_APP_LANGUAGE;
  const store = await readStore();
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
