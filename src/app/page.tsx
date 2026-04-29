import {
  Clapperboard,
  Database,
  ExternalLink,
  Film,
  Link2,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
} from "lucide-react";
import VideoMosaic from "@/components/VideoMosaic";
import { listPublicFeedItems } from "@/lib/feed";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const productPillars = [
  {
    icon: Database,
    title: "Catalog-ready",
    copy: "Use product images, descriptions, prices, CTA URLs, and campaign metadata from your existing tools."
  },
  {
    icon: SlidersHorizontal,
    title: "Flexible video styles",
    copy: "Create explainers, launch edits, anime promos, futuristic ads, or brand-specific videos from one brief."
  },
  {
    icon: Film,
    title: "Referral pages that convert",
    copy: "Each link opens a page with product context, creator attribution, purchase actions, and shareable video output."
  }
];

const valuePoints = [
  "Connect catalog data once for every campaign.",
  "Turn product images and details into audience-ready videos.",
  "Give buyers context before they purchase.",
  "Replace bare tracking URLs with useful media."
];

export default async function Home() {
  const store = await readStore();
  const featuredFeed = await listPublicFeedItems({ sort: "ranked", limit: 10 });
  const customer = store.customers[0];
  const demoReferrer = customer ? store.subAccounts.find((account) => account.customerId === customer.id) : null;
  const latestInft = store.infts[0];
  const referrerHref = demoReferrer ? `/r/${demoReferrer.referrerCode}` : "/dashboard";
  const inftHref = latestInft ? `/inft/${latestInft.id}` : "/feed";

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary">
        <a className="text-logo" href="/" aria-label="SuperReferrals home">
          <span>Super</span>Referrals
        </a>
        <div className="landing-nav-actions">
          <a className="btn ghost" href="/feed" target="_blank" rel="noreferrer">
            <Clapperboard size={16} /> Feed
          </a>
          <a className="btn ghost" href="/storefronts" target="_blank" rel="noreferrer">
            <Store size={16} /> Storefronts
          </a>
          <a className="btn primary" href="/dashboard" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Open Console
          </a>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="eyebrow">Product Video Referrals</div>
          <h1>Turn referral links into videos that convert</h1>
          <p className="landing-lede">
            Give every recommendation a product story, visual style, and clear next step.
          </p>
          <p className="landing-support">
            SuperReferrals turns catalog assets into personalized videos and referral pages for creators,
            affiliates, and storefront teams.
          </p>
          <div className="landing-actions" aria-label="Open project routes">
            <a className="btn primary large" href={referrerHref} target="_blank" rel="noreferrer">
              <Sparkles size={18} /> Create Product Video
            </a>
            <a className="btn large" href="/storefronts" target="_blank" rel="noreferrer">
              <Store size={18} /> Choose Storefront
            </a>
            <a className="btn large" href="/dashboard" target="_blank" rel="noreferrer">
              <Network size={18} /> Manage Storefront
            </a>
            <a className="btn large" href="/feed" target="_blank" rel="noreferrer">
              <Film size={18} /> View Video Gallery
            </a>
          </div>
        </div>
      </section>

      <section className="landing-showcase" aria-label="SuperReferrals product flow">
        <div className="showcase-header">
          <div>
            <span className="mono">superreferrals.link</span>
            <strong>Campaign builder</strong>
          </div>
          <span className="badge ok">Catalog ready</span>
        </div>
        <div className="showcase-flow">
          <div className="flow-step">
            <Database size={18} />
            <span>Product catalog</span>
          </div>
          <div className="flow-step">
            <SlidersHorizontal size={18} />
            <span>Style controls</span>
          </div>
          <div className="flow-step">
            <Clapperboard size={18} />
            <span>Product video</span>
          </div>
          <div className="flow-step">
            <Link2 size={18} />
            <span>Referral page</span>
          </div>
        </div>
        <div className="showcase-outcome">
          <span className="eyebrow">Customer outcome</span>
          <h2>A recommendation that helps buyers decide.</h2>
          <p>
            Buyers see the product, creator context, campaign style, and purchase action in one place.
          </p>
        </div>
      </section>

      <section className="landing-section landing-split">
        <div>
          <div className="eyebrow">Use Case</div>
          <h2>Referrals that show the product and lead to purchase.</h2>
        </div>
        <div className="value-list">
          {valuePoints.map((point) => (
            <div className="value-item" key={point}>
              <ShieldCheck size={16} />
              <span>{point}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-card-grid" aria-label="Unique offerings">
        {productPillars.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <article className="landing-card" key={pillar.title}>
              <span className="landing-card-icon"><Icon size={20} /></span>
              <h2>{pillar.title}</h2>
              <p>{pillar.copy}</p>
            </article>
          );
        })}
      </section>

      <section className="landing-section route-section">
        <div>
          <div className="eyebrow">Marketing Video Creator</div>
          <h2>Start where you need.</h2>
        </div>
        <div className="route-grid">
          <RouteButton href="/dashboard" title="Manage storefront" copy="Set products, pricing, credits, and automation." />
          <RouteButton href="/storefronts" title="Create a product video" copy="Choose a storefront, connect a wallet, and generate." />
          <RouteButton href="/feed" title="View video gallery" copy="Browse completed videos and social actions." />
          <RouteButton href={inftHref} title="Open latest video" copy="Preview the latest render." />
        </div>
      </section>

      <section className="landing-section landing-video-section">
        <div className="landing-video-header">
          <div>
            <div className="eyebrow">Featured Renditions</div>
            <h2>Recent and popular storefront videos.</h2>
          </div>
          <a className="btn" href="/feed" target="_blank" rel="noreferrer">
            <Film size={16} /> Open feed
          </a>
        </div>
        <VideoMosaic
          items={featuredFeed.items}
          emptyText="No published storefront videos yet."
          limit={10}
        />
      </section>
    </main>
  );
}

function RouteButton({ href, title, copy }: { href: string; title: string; copy: string }) {
  return (
    <a className="route-button" href={href} target="_blank" rel="noreferrer">
      <span>
        <strong>{title}</strong>
        <small>{copy}</small>
      </span>
      <ExternalLink size={18} />
    </a>
  );
}
