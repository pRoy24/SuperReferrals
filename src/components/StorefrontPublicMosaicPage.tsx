"use client";

import { ExternalLink, LayoutGrid, Radio, Store } from "lucide-react";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import LanguageSelector from "@/components/LanguageSelector";
import VideoMosaic from "@/components/VideoMosaic";
import {
  feedViewModeForAspectRatio,
  storefrontPublicHref
} from "@/lib/storefront-routing";
import { storefrontThemeStyle } from "@/lib/storefront-themes";
import type { Customer, PublicFeedItem } from "@/lib/types";

export default function StorefrontPublicMosaicPage({
  customer,
  items
}: {
  customer?: Customer;
  items: PublicFeedItem[];
}) {
  const storefrontHref = customer ? storefrontPublicHref(customer, "storefront") : "/storefronts";
  const feedHref = customer ? storefrontPublicHref(customer, "feed") : "/feed";
  const title = customer ? `${customer.name} video mosaic` : "Video mosaic";
  const description = customer?.storefront?.description || "Published SuperReferrals videos arranged for scanning and playback.";

  return (
    <main
      className="public-main storefront-mosaic-main storefront-theme"
      style={storefrontThemeStyle(customer?.storefront?.themeId)}
    >
      <section className="hero-band public-hero storefront-branded-hero">
        <div className="public-hero-copy">
          <div className="topbar-title-row">
            <BreadcrumbNav />
            <div className="eyebrow">{customer?.storefront?.category || "Published videos"}</div>
          </div>
          <div className="storefront-hero-title-row">
            {customer?.storefront?.logoUrl && (
              <span className="storefront-logo-frame">
                <img alt="" src={customer.storefront.logoUrl} />
              </span>
            )}
            <h1>{title}</h1>
          </div>
          <p className="subtle">{description}</p>
        </div>
        <div className="landing-hero-actions">
          <LanguageSelector />
          <a className="btn" href={storefrontHref}>
            <Store size={16} /> Storefront
          </a>
          <a className="btn primary" href={feedHref}>
            <Radio size={16} /> Feed
          </a>
        </div>
      </section>

      <section className="panel storefront-public-mosaic-panel">
        <div className="panel-header">
          <div>
            <h2>Published videos</h2>
            <p className="subtle">{items.length} video{items.length === 1 ? "" : "s"}</p>
          </div>
          <LayoutGrid size={18} />
        </div>
        <VideoMosaic
          emptyText="No published videos for this storefront yet."
          feedHrefForItem={(item) => customer
            ? storefrontPublicHref(customer, "video", {
              generationId: item.generationId,
              viewMode: feedViewModeForAspectRatio(item.aspectRatio)
            })
            : `/feed/${encodeURIComponent(item.generationId)}/${feedViewModeForAspectRatio(item.aspectRatio)}`}
          items={items}
          moreHref={feedHref}
          moreLabel="Open feed"
          showFeedLink
          showInftLink
        />
      </section>

      <div className="button-row storefront-public-bottom-actions">
        <a className="btn" href={feedHref}>
          <ExternalLink size={16} /> Open feed
        </a>
        <a className="btn" href={storefrontHref}>
          <ExternalLink size={16} /> Open storefront
        </a>
      </div>
    </main>
  );
}
