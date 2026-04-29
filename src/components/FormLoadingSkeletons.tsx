import {
  Bot,
  CircleDollarSign,
  Code2,
  Database,
  ExternalLink,
  KeyRound,
  ListChecks,
  Network,
  Play,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Store,
  Wallet,
  Zap
} from "lucide-react";
import type { ReactNode } from "react";
import BreadcrumbNav from "@/components/BreadcrumbNav";

export function CustomerStoreCreatorSkeleton() {
  return (
    <div className="app-shell skeleton-shell" aria-busy="true" aria-label="Loading customer store setup">
      <span className="sr-only">Loading customer store setup</span>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={18} /></span>
          <SkeletonLine className="skeleton-w-md" />
        </div>
        <div className="skeleton-copy-stack">
          <SkeletonLine className="skeleton-w-full" />
          <SkeletonLine className="skeleton-w-lg" />
          <SkeletonLine className="skeleton-w-sm" />
        </div>
        <nav className="nav-list">
          <SkeletonNavItem icon={<CircleDollarSign size={16} />} />
          <SkeletonNavItem icon={<KeyRound size={16} />} />
          <SkeletonNavItem icon={<ShieldCheck size={16} />} />
          <SkeletonNavItem icon={<Bot size={16} />} />
          <SkeletonNavItem icon={<Network size={16} />} />
          <SkeletonNavItem icon={<Store size={16} />} />
        </nav>
      </aside>

      <main className="main loading-main">
        <div className="topbar hero-band">
          <div className="skeleton-heading-group">
            <SkeletonLine className="skeleton-w-xs" />
            <SkeletonLine className="skeleton-title" />
            <SkeletonLine className="skeleton-copy-line" />
            <SkeletonLine className="skeleton-w-xl" />
          </div>
          <div className="page-top-actions">
            <BreadcrumbNav />
            <SkeletonButton icon={<RefreshCw size={16} />} />
          </div>
        </div>

        <section className="stat-row">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="stat skeleton-stat" key={`customer-stat-${index}`}>
              <SkeletonLine className="skeleton-number" />
              <SkeletonLine className="skeleton-w-sm" />
            </div>
          ))}
        </section>

        <div className="grid">
          <section className="stack">
            <div className="panel panel-strong">
              <SkeletonPanelHeader icon={<CircleDollarSign size={18} />} withCopy />
              <div className="account-status-strip">
                <SkeletonControl />
                <SkeletonBadge />
              </div>
              <div className="amount-grid">
                {Array.from({ length: 4 }).map((_, index) => <SkeletonAmountChoice key={`credit-${index}`} />)}
              </div>
              <div className="form-grid processor-checkout">
                <SkeletonField />
                <SkeletonField />
                <SkeletonField />
              </div>
              <div className="button-row">
                <SkeletonButton icon={<CircleDollarSign size={16} />} primary />
              </div>
              <div className="button-row">
                <SkeletonButton icon={<RefreshCw size={16} />} />
                <SkeletonButton icon={<KeyRound size={16} />} className="skeleton-button-wide" />
                <SkeletonButton icon={<ExternalLink size={16} />} className="skeleton-button-wide" />
              </div>
              <div className="account-wallet-link">
                <SkeletonField />
                <SkeletonButton icon={<Wallet size={16} />} />
              </div>
              <SkeletonAdvancedSection />
            </div>

            <div className="panel">
              <SkeletonPanelHeader icon={<KeyRound size={18} />} />
              <div className="form-grid">
                <SkeletonField />
                <SkeletonField />
                <SkeletonField />
                <SkeletonField full multiline />
              </div>
              <div className="setup-wallet-strip">
                <SkeletonField />
                <div className="wallet-provider-grid">
                  <SkeletonChip />
                  <SkeletonChip />
                </div>
              </div>
              <SkeletonAdvancedSection />
              <div className="button-row">
                <SkeletonButton icon={<KeyRound size={16} />} primary />
                <SkeletonButton icon={<ExternalLink size={16} />} />
                <SkeletonButton icon={<Store size={16} />} />
              </div>
            </div>
          </section>

          <section className="stack">
            <div className="panel panel-strong">
              <SkeletonPanelHeader icon={<Database size={18} />} />
              <div className="form-grid">
                <SkeletonField />
                <SkeletonField />
              </div>
              <div className="render-conditions-editor">
                <div className="item-title">
                  <div>
                    <SkeletonLine className="skeleton-w-md" />
                    <SkeletonLine className="skeleton-w-xl skeleton-line-small" />
                  </div>
                  <SkeletonChip />
                </div>
                <div className="conditions-editor-grid">
                  <SkeletonField full />
                  <SkeletonField />
                  <SkeletonField />
                </div>
              </div>
              <div className="pricing-table">
                {Array.from({ length: 3 }).map((_, index) => <SkeletonPricingRow key={`pricing-${index}`} />)}
              </div>
              <div className="button-row">
                <SkeletonButton icon={<ShieldCheck size={16} />} primary />
                <SkeletonButton className="skeleton-button-wide" />
              </div>
            </div>

            <div className="panel">
              <SkeletonPanelHeader icon={<Bot size={18} />} />
              <div className="list">
                {Array.from({ length: 3 }).map((_, index) => <SkeletonListItem key={`render-${index}`} />)}
              </div>
            </div>
          </section>
        </div>

        <section className="panel agent-town-panel">
          <SkeletonPanelHeader icon={<Network size={20} />} withCopy />
          <div className="form-grid">
            <SkeletonField full multiline />
            <SkeletonField full multiline />
          </div>
          <div className="button-row">
            <SkeletonButton icon={<Zap size={16} />} primary />
            <SkeletonButton icon={<RefreshCw size={16} />} />
          </div>
        </section>
      </main>
    </div>
  );
}

export function UserStoreCreatorSkeleton() {
  return (
    <main className="public-main storefront-user-main skeleton-shell" aria-busy="true" aria-label="Loading customer store">
      <span className="sr-only">Loading customer store</span>
      <section className="hero-band public-hero">
        <div className="skeleton-heading-group">
          <SkeletonLine className="skeleton-w-sm" />
          <SkeletonLine className="skeleton-title" />
          <SkeletonLine className="skeleton-copy-line" />
          <div className="storefront-landing-meta">
            <SkeletonMetaPill icon={<Wallet size={15} />} />
            <SkeletonMetaPill icon={<Store size={15} />} />
            <SkeletonMetaPill />
          </div>
        </div>
        <div className="landing-hero-actions">
          <BreadcrumbNav />
          <SkeletonButton icon={<Store size={16} />} />
          <SkeletonButton icon={<RefreshCw size={16} />} />
        </div>
      </section>

      <div className="grid public-grid">
        <section className="stack storefront-setup-stack">
          <div className="panel storefront-wallet-panel">
            <SkeletonPanelHeader icon={<Wallet size={18} />} />
            <div className="form-grid">
              <SkeletonField full />
              <SkeletonField />
              <SkeletonField />
            </div>
            <div className="wallet-provider-grid">
              <SkeletonChip />
              <SkeletonChip />
            </div>
            <div className="button-row">
              <SkeletonButton icon={<Wallet size={16} />} primary />
              <SkeletonButton icon={<ShieldCheck size={16} />} />
              <SkeletonBadge />
            </div>
          </div>

          <div className="panel storefront-pricing-panel">
            <SkeletonPanelHeader icon={<CircleDollarSign size={18} />} />
            <div className="list">
              <div className="storefront-condition-tiles">
                <SkeletonChip />
                <SkeletonChip />
                <SkeletonChip />
              </div>
              <SkeletonListItem />
              <SkeletonListItem />
            </div>
          </div>
        </section>

        <section className="stack storefront-workflow-stack">
          <div className="panel panel-strong storefront-render-panel">
            <SkeletonPanelHeader icon={<Play size={18} />} />
            <div className="render-mode-toolbar">
              <SkeletonLine className="skeleton-w-xs" />
              <div className="mode-toggle">
                <span><ListChecks size={16} /><SkeletonLine className="skeleton-w-sm" /></span>
                <span><Code2 size={16} /><SkeletonLine className="skeleton-w-sm" /></span>
              </div>
            </div>
            <div className="form-grid render-wizard-grid">
              <div className="wizard-section full">
                <div className="wizard-section-header">
                  <div>
                    <SkeletonLine className="skeleton-w-sm" />
                    <SkeletonBadge />
                  </div>
                  <SkeletonButton className="skeleton-button-small" />
                </div>
                <div className="wizard-list">
                  <div className="wizard-entry">
                    <div className="wizard-entry-title">
                      <SkeletonLine className="skeleton-w-sm" />
                      <SkeletonIconButton />
                    </div>
                    <div className="wizard-image-grid">
                      <SkeletonField full />
                      <SkeletonField />
                      <SkeletonField />
                    </div>
                  </div>
                </div>
              </div>
              <SkeletonField full multiline />
              <div className="wizard-section full">
                <div className="wizard-section-header">
                  <SkeletonLine className="skeleton-w-md" />
                  <SkeletonButton className="skeleton-button-small" />
                </div>
                <div className="wizard-list">
                  <div className="wizard-key-value">
                    <SkeletonField />
                    <SkeletonField />
                    <SkeletonIconButton />
                  </div>
                </div>
              </div>
              <SkeletonField />
              <SkeletonField />
              <div className="field full">
                <SkeletonLine className="skeleton-w-sm" />
                <div className="amount-grid payment-method-grid">
                  <SkeletonAmountChoice />
                  <SkeletonAmountChoice />
                  <SkeletonAmountChoice />
                </div>
              </div>
              <SkeletonField />
              <SkeletonField />
              <SkeletonField />
              <SkeletonField />
            </div>
            <div className="payment-summary">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={`payment-summary-${index}`}>
                  <SkeletonLine className="skeleton-w-sm skeleton-line-small" />
                  <SkeletonLine className="skeleton-w-md" />
                </div>
              ))}
            </div>
            <div className="button-row">
              <SkeletonButton icon={<CircleDollarSign size={16} />} />
              <SkeletonButton icon={<Play size={16} />} primary className="skeleton-button-wide" />
              <SkeletonButton icon={<ExternalLink size={16} />} />
            </div>
          </div>

          <div className="panel">
            <SkeletonPanelHeader icon={<Bot size={18} />} />
            <div className="list">
              <SkeletonListItem />
              <SkeletonListItem />
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SkeletonPanelHeader({ icon, withCopy = false }: { icon: ReactNode; withCopy?: boolean }) {
  return (
    <div className="panel-header">
      <div className="skeleton-heading-group">
        <SkeletonLine className="skeleton-w-md" />
        {withCopy && <SkeletonLine className="skeleton-w-xl skeleton-line-small" />}
      </div>
      <span className="skeleton-static-icon">{icon}</span>
    </div>
  );
}

function SkeletonNavItem({ icon }: { icon: ReactNode }) {
  return (
    <div className="nav-item skeleton-nav-item">
      {icon}
      <SkeletonLine className="skeleton-w-md" />
    </div>
  );
}

function SkeletonField({ full = false, multiline = false }: { full?: boolean; multiline?: boolean }) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <SkeletonLine className="skeleton-label-line" />
      <SkeletonControl multiline={multiline} />
    </div>
  );
}

function SkeletonPricingRow() {
  return (
    <div className="pricing-row">
      <div>
        <SkeletonLine className="skeleton-w-md" />
        <SkeletonLine className="skeleton-w-lg skeleton-line-small" />
      </div>
      <SkeletonControl />
      <SkeletonControl />
      <SkeletonField />
      <SkeletonControl />
      <SkeletonChip />
    </div>
  );
}

function SkeletonListItem() {
  return (
    <div className="item">
      <div className="item-title">
        <SkeletonLine className="skeleton-w-md" />
        <SkeletonBadge />
      </div>
      <SkeletonLine className="skeleton-w-full skeleton-line-small" />
      <SkeletonLine className="skeleton-w-lg skeleton-line-small" />
    </div>
  );
}

function SkeletonAdvancedSection() {
  return (
    <div className="advanced-section skeleton-advanced">
      <SkeletonLine className="skeleton-w-lg" />
    </div>
  );
}

function SkeletonAmountChoice() {
  return (
    <div className="amount-choice skeleton-amount-choice">
      <SkeletonLine className="skeleton-w-xs skeleton-line-small" />
      <SkeletonLine className="skeleton-w-md" />
      <SkeletonLine className="skeleton-w-sm skeleton-line-small" />
    </div>
  );
}

function SkeletonButton({
  icon,
  primary = false,
  className = ""
}: {
  icon?: ReactNode;
  primary?: boolean;
  className?: string;
}) {
  return (
    <span className={`btn ${primary ? "primary" : ""} skeleton-button ${className}`} aria-hidden="true">
      {icon}
      <SkeletonLine className="skeleton-w-sm" />
    </span>
  );
}

function SkeletonControl({ multiline = false }: { multiline?: boolean }) {
  return <span className={`readonly-value skeleton-control ${multiline ? "skeleton-control-multiline" : ""}`} aria-hidden="true" />;
}

function SkeletonBadge() {
  return <span className="badge skeleton-badge" aria-hidden="true" />;
}

function SkeletonChip() {
  return <span className="skeleton-chip" aria-hidden="true" />;
}

function SkeletonMetaPill({ icon }: { icon?: ReactNode }) {
  return (
    <span className="skeleton-meta-pill" aria-hidden="true">
      {icon}
      <SkeletonLine className="skeleton-w-sm" />
    </span>
  );
}

function SkeletonIconButton() {
  return <span className="icon-btn skeleton-icon-button" aria-hidden="true" />;
}

function SkeletonLine({ className = "" }: { className?: string }) {
  return <span className={`skeleton-line ${className}`} aria-hidden="true" />;
}
