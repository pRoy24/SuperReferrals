import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import LandingPageClient from "@/components/LandingPageClient";
import FeedPage from "@/components/FeedPage";
import StorefrontPublicGalleryPage from "@/components/StorefrontPublicGalleryPage";
import UserLandingPage from "@/components/UserLandingPage";
import { appBaseUrl } from "@/lib/env";
import { getLandingEnvDiagnostics } from "@/lib/env-diagnostics";
import { listPublicFeedItems } from "@/lib/feed";
import { landingCopy } from "@/lib/landing-localization";
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

const landingOgImagePath = "/landing/superreferrals-video-mosaic-og.jpg";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const appLanguage = landingRouteLanguageFromHeaders(requestHeaders);
  const pageCopy = landingCopy[appLanguage];
  const title = pageCopy.hero.title;
  const description = pageCopy.metadata.description;
  const baseUrl = appBaseUrl();
  const routePath = appLanguage === "zh" ? "/zh" : "/";
  const routeUrl = new URL(routePath, baseUrl).toString();
  const imageUrl = new URL(landingOgImagePath, baseUrl).toString();

  return {
    title,
    description,
    alternates: {
      canonical: routeUrl,
      languages: {
        en: new URL("/", baseUrl).toString(),
        "zh-CN": new URL("/zh", baseUrl).toString()
      }
    },
    openGraph: {
      title,
      description,
      type: "website",
      siteName: "SuperReferrals",
      url: routeUrl,
      locale: appLanguage === "zh" ? "zh_CN" : "en_US",
      alternateLocale: appLanguage === "zh" ? ["en_US"] : ["zh_CN"],
      images: [
        {
          url: imageUrl,
          width: 1200,
          height: 630,
          alt: "SuperReferrals video mosaic"
        }
      ]
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [imageUrl]
    }
  };
}

export default async function Home() {
  const requestHeaders = await headers();
  const initialLanguage = landingDisplayLanguageFromHeaders(requestHeaders);
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

function landingRouteLanguageFromHeaders(requestHeaders: Headers) {
  return requestHeaders.get("x-superreferrals-locale-prefix") === "zh" ? "zh" : DEFAULT_APP_LANGUAGE;
}

function landingDisplayLanguageFromHeaders(requestHeaders: Headers) {
  return normalizeAppLanguage(requestHeaders.get("x-superreferrals-app-language")) ||
    appLanguageFromCookieHeader(requestHeaders.get("cookie")) ||
    DEFAULT_APP_LANGUAGE;
}
