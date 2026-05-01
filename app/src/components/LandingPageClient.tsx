"use client";

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
  Store
} from "lucide-react";
import { useEffect, useState } from "react";
import LanguageSelector from "@/components/LanguageSelector";
import VideoMosaic from "@/components/VideoMosaic";
import {
  applyDocumentAppLanguage,
  readRouteAppLanguage,
  readStoredAppLanguage,
  subscribeAppLanguage
} from "@/lib/app-language-client";
import { DEFAULT_APP_LANGUAGE, normalizeAppLanguage } from "@/lib/localization";
import { landingCopy } from "@/lib/landing-localization";
import type { EnvDiagnostics } from "@/lib/env-diagnostics";
import type { AppLanguageCode, PublicFeedItem } from "@/lib/types";

type LandingPageClientProps = {
  envDiagnostics: EnvDiagnostics;
  featuredFeedItems: PublicFeedItem[];
  inftHref: string;
  initialLanguage: AppLanguageCode;
  referrerHref: string;
};

const productPillarIcons = [Database, SlidersHorizontal, Film];
const showcaseFlowIcons = [Database, SlidersHorizontal, Clapperboard, Link2];
const blockchainIcons = [Coins, Film, Cpu, KeyRound, GitBranch, ShieldCheck];
const howStepIcons = [Store, Link2, Sparkles, GitBranch, Coins, Database, Cpu];

export default function LandingPageClient({
  envDiagnostics,
  featuredFeedItems,
  inftHref,
  initialLanguage,
  referrerHref
}: LandingPageClientProps) {
  const appLanguage = useLandingLanguage(initialLanguage);
  const t = landingCopy[appLanguage];
  const routeHrefs = ["/dashboard", "/storefronts", "/feed", inftHref];

  return (
    <main className="landing-shell">
      <nav className="landing-nav" aria-label={t.navAria}>
        <div className="landing-nav-left">
          <a className="landing-logo-link" href="/" aria-label={t.homeAria}>
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
          <LanguageSelector initialLanguage={initialLanguage} label={t.nav.language} />
          <a className="btn ghost" href="/feed" target="_blank" rel="noreferrer">
            <Clapperboard size={16} /> {t.nav.feed}
          </a>
          <a className="btn ghost" href="/storefronts" target="_blank" rel="noreferrer">
            <Store size={16} /> {t.nav.storefronts}
          </a>
          <a className="btn primary" href="/dashboard" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> {t.nav.openConsole}
          </a>
        </div>
      </nav>

      {envDiagnostics.issues.length > 0 && (
        <section className="environment-banner landing-env-banner" role="status" aria-label="Deployment environment setup">
          <span>Admin setup</span>
          <div>
            <p>
              {envDiagnostics.environment} configuration needs review. The app can still run, but these values should be set before live storefront creation and payments.
            </p>
            <ul>
              {envDiagnostics.issues.map((issue) => (
                <li key={`${issue.key}:${issue.message}`}>
                  <strong>{issue.key}</strong>: {issue.message} {issue.howToSet}
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      <section className="landing-hero">
        <div className="landing-hero-copy">
          <div className="eyebrow">{t.hero.eyebrow}</div>
          <h1>{t.hero.title}</h1>
          <p className="landing-lede">{t.hero.lede}</p>
          <p className="landing-support">{t.hero.support}</p>
          <div className="landing-actions" aria-label={t.hero.actionsAria}>
            <a className="btn primary large" href={referrerHref} target="_blank" rel="noreferrer">
              <Sparkles size={18} /> {t.hero.createProductVideo}
            </a>
            <a className="btn large" href="/storefronts" target="_blank" rel="noreferrer">
              <Store size={18} /> {t.hero.storefrontDirectory}
            </a>
            <a className="btn large" href="/dashboard" target="_blank" rel="noreferrer">
              <Network size={18} /> {t.hero.manageStorefront}
            </a>
            <a className="btn large" href="/feed" target="_blank" rel="noreferrer">
              <Film size={18} /> {t.hero.viewVideoGallery}
            </a>
          </div>
        </div>
      </section>

      <section className="landing-showcase" aria-label={t.showcase.aria}>
        <div className="showcase-header">
          <div>
            <strong>{t.showcase.header}</strong>
          </div>
          <span className="badge ok">{t.showcase.badge}</span>
        </div>
        <div className="showcase-flow">
          {t.showcase.flow.map((label, index) => {
            const Icon = showcaseFlowIcons[index];
            return (
              <div className="flow-step" key={label}>
                <Icon size={18} />
                <span>{label}</span>
              </div>
            );
          })}
        </div>
        <div className="showcase-outcome">
          <h2>{t.showcase.title}</h2>
          <p>{t.showcase.copy}</p>
        </div>
      </section>

      <section className="landing-section landing-two-row">
        <div>
          <div className="eyebrow">{t.useCase.eyebrow}</div>
          <h2>{t.useCase.title}</h2>
        </div>
        <div className="value-list value-list-grid">
          {t.useCase.points.map((point) => (
            <div className="value-item" key={point}>
              <ShieldCheck size={16} />
              <span>{point}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="landing-card-grid" aria-label={t.productPillarsAria}>
        {t.productPillars.map((pillar, index) => {
          const Icon = productPillarIcons[index];
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
          <div className="eyebrow">{t.routes.eyebrow}</div>
          <h2>{t.routes.title}</h2>
        </div>
        <div className="route-grid">
          {t.routes.items.map((item, index) => (
            <RouteButton
              copy={item.copy}
              href={routeHrefs[index]}
              key={item.title}
              title={item.title}
            />
          ))}
        </div>
      </section>

      <section className="landing-section landing-two-row blockchain-section">
        <div>
          <div className="eyebrow">{t.blockchain.eyebrow}</div>
          <h2>{t.blockchain.title}</h2>
          <p className="blockchain-note">{t.blockchain.note}</p>
        </div>
        <div className="value-list blockchain-list">
          {t.blockchain.points.map((point, index) => {
            const Icon = blockchainIcons[index];
            return (
              <div className="value-item blockchain-value-item" key={point}>
                <Icon size={16} />
                <span>{point}</span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="landing-section how-section">
        <div className="how-section-header">
          <div>
            <div className="eyebrow">{t.how.eyebrow}</div>
            <h2>{t.how.title}</h2>
          </div>
          <p>{t.how.copy}</p>
        </div>
        <div className="how-grid">
          {t.how.steps.map((step, index) => {
            const Icon = howStepIcons[index];
            return (
              <article className="how-step" key={step.title}>
                <div className="how-step-heading">
                  <span className="how-step-icon"><Icon size={18} /></span>
                  <h3>{step.title}</h3>
                </div>
                <p>{step.copy}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="landing-section landing-video-section">
        <div className="landing-video-header">
          <div>
            <div className="eyebrow">{t.video.eyebrow}</div>
            <h2>{t.video.title}</h2>
          </div>
          <a className="btn" href="/feed" target="_blank" rel="noreferrer">
            <Film size={16} /> {t.video.openFeed}
          </a>
        </div>
        <VideoMosaic
          emptyText={t.video.emptyText}
          items={featuredFeedItems}
          labels={t.video.mosaicLabels}
          limit={10}
          maxRows={3}
          moreHref="/feed"
          moreLabel={t.video.moreLabel}
        />
      </section>
    </main>
  );
}

function useLandingLanguage(initialLanguage: AppLanguageCode) {
  const [appLanguage, setAppLanguage] = useState<AppLanguageCode>(initialLanguage);

  useEffect(() => {
    const preferredLanguage =
      readRouteAppLanguage() ||
      readStoredAppLanguage() ||
      normalizeAppLanguage(initialLanguage) ||
      DEFAULT_APP_LANGUAGE;
    setAppLanguage(preferredLanguage);
    applyDocumentAppLanguage(preferredLanguage);
    return subscribeAppLanguage(setAppLanguage);
  }, [initialLanguage]);

  return appLanguage;
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
