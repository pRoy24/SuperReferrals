import {
  Clapperboard,
  Coins,
  Cpu,
  Database,
  ExternalLink,
  Film,
  GitBranch,
  KeyRound,
  Link2,
  Network,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
} from "lucide-react";
import LanguageSelector from "@/components/LanguageSelector";
import VideoMosaic from "@/components/VideoMosaic";
import { listPublicFeedItems } from "@/lib/feed";
import { readStore } from "@/lib/store";

export const dynamic = "force-dynamic";

const productPillars = [
  {
    icon: Database,
    title: "Catalog-ready",
    copy: "Use the simple or advanced video creator wizard to pull product images, prices, CTA URLs, and campaign metadata into each render."
  },
  {
    icon: SlidersHorizontal,
    title: "Flexible video styles",
    copy: "Create explainers, launch edits, anime promos, futuristic ads, or brand-specific videos from product or listing metadata in both landscape and portrait formats."
  },
  {
    icon: Film,
    title: "Referral pages that convert",
    copy: "Turn every ref link into an editable marketing video page with product attributes, creator context, share actions, and a clear CTA."
  }
];

const valuePoints = [
  "Connect catalog data once for every campaign.",
  "Turn product images and details into audience-ready videos.",
  "Give buyers context before they purchase.",
  "Replace bare tracking URLs with useful media."
];

const blockchainPoints = [
  {
    icon: Coins,
    copy: "Launch storefronts with model menus, pricing, and checkout in the cryptocurrency you choose, so customers can pay you directly."
  },
  {
    icon: Film,
    copy: "Every customer receives a completed video render and a tradable iNFT record powered by 0G blockchain and KeeperHub."
  },
  {
    icon: Cpu,
    copy: "Choose the generation models, aspect ratios, and prices your storefront offers instead of exposing every backend option."
  },
  {
    icon: KeyRound,
    copy: "Public discovery does not have to mean open rendering. Use address whitelists to decide who can create videos on your store."
  },
  {
    icon: GitBranch,
    copy: "Every iNFT can be purchased as a deep clone. Buyers can replace scenes, retranslate, update outros and CTA links, or join their copy with other videos they own while your original remains yours."
  },
  {
    icon: ShieldCheck,
    copy: "Every child purchase, edit, join, and downstream operation can be audited onchain, preserving a clear history for every derivative video."
  }
];

export default async function Home() {
  const store = await readStore();
  const featuredFeed = await listPublicFeedItems({ sort: "newest", limit: 100 });
  const customer = store.customers[0];
  const demoReferrer = customer ? store.subAccounts.find((account) => account.customerId === customer.id) : null;
  const latestInft = store.infts[0];
  const referrerHref = demoReferrer ? `/r/${demoReferrer.referrerCode}` : "/dashboard";
  const inftHref = latestInft ? `/inft/${latestInft.id}` : "/feed";

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label="Primary">
        <div className="landing-nav-left">
          <a className="landing-logo-link" href="/" aria-label="SuperReferrals home">
            <img
              alt="SuperReferrals"
              className="landing-logo-image"
              height={48}
              src="/superreferrals-logo.png"
              width={238}
            />
          </a>
        </div>
        <div className="landing-nav-actions">
          <LanguageSelector />
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
            SuperReferrals turns your product links or marketing ref links into unstoppable promo videos
            with scannable QR codes, drawing data and images straight from your product catalog.
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
          <h2>Your ref links showcase your product and your vision.</h2>
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
              <div className="landing-card-heading">
                <span className="landing-card-icon"><Icon size={20} /></span>
                <h2>{pillar.title}</h2>
              </div>
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

      <section className="landing-section landing-split blockchain-section">
        <div>
          <div className="eyebrow">Powered by blockchain</div>
          <h2>Programmable storefronts for crypto-native video referrals.</h2>
          <p className="blockchain-note">0G blockchain · KeeperHub · Auditable iNFT lineage</p>
        </div>
        <div className="value-list">
          {blockchainPoints.map((point) => {
            const Icon = point.icon;
            return (
              <div className="value-item blockchain-value-item" key={point.copy}>
                <Icon size={16} />
                <span>{point.copy}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="landing-section landing-video-section">
        <div className="landing-video-header">
          <div>
            <div className="eyebrow">Featured Renditions</div>
            <h2>Latest storefront videos.</h2>
          </div>
          <a className="btn" href="/feed" target="_blank" rel="noreferrer">
            <Film size={16} /> Open feed
          </a>
        </div>
        <VideoMosaic
          items={featuredFeed.items}
          emptyText="No published storefront videos yet."
          limit={10}
          maxRows={3}
          moreHref="/feed"
          moreLabel="More videos"
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
