"use client";

import { Clapperboard, ExternalLink, Film, RefreshCw, Search, ShieldCheck, SlidersHorizontal, Star, Store, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import LanguageSelector from "@/components/LanguageSelector";
import {
  getAllowedModelPricingConfigurations,
  getStorefrontConditionTiles,
  resolveModelPriceDetails
} from "@/lib/pricing";
import { storefrontThemeStyle } from "@/lib/storefront-themes";
import type { Customer, StorefrontRating, SuperReferralsStore } from "@/lib/types";
import { isUsableEvmAddress } from "@/lib/wallet-address";

type OwnerEnsNetwork = "sepolia" | "mainnet";
type OwnerEnsLookup = {
  name: string | null;
};

export default function StorefrontDirectory() {
  const [store, setStore] = useState<SuperReferralsStore | null>(null);
  const [message, setMessage] = useState("");
  const [ownerEnsLookups, setOwnerEnsLookups] = useState<Record<string, OwnerEnsLookup>>({});

  async function load() {
    setMessage("");
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unable to load storefront directory");
    }
    const data = await response.json() as SuperReferralsStore;
    setStore(data);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error instanceof Error ? error.message : "Unable to load storefront directory"));
  }, []);

  const storefronts = useMemo(
    () => store?.customers
      .filter(isDirectoryStorefrontCustomer)
      .map((customer) => buildStorefrontDirectoryItem(store, customer)) || [],
    [store]
  );

  useEffect(() => {
    let cancelled = false;
    const targets = uniqueOwnerEnsTargets(storefronts);
    if (targets.length === 0) {
      setOwnerEnsLookups({});
      return () => {
        cancelled = true;
      };
    }
    setOwnerEnsLookups((current) => {
      const keys = new Set(targets.map((target) => target.key));
      const next = Object.fromEntries(
        Object.entries(current).filter(([key]) => keys.has(key))
      ) as Record<string, OwnerEnsLookup>;
      for (const target of targets) {
        next[target.key] ||= { name: null };
      }
      return next;
    });
    Promise.all(targets.map(async (target) => {
      const name = await resolveOwnerEnsName(target.wallet, target.network);
      return [target.key, { name }] as const;
    })).then((entries) => {
      if (cancelled) {
        return;
      }
      setOwnerEnsLookups((current) => ({ ...current, ...Object.fromEntries(entries) }));
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [storefronts]);

  return (
    <main className="public-main storefront-directory">
      <nav className="landing-nav storefront-directory-nav" aria-label="Primary">
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
          <a className="btn primary" href="/dashboard" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Open Console
          </a>
        </div>
      </nav>

      <section className="hero-band public-hero">
        <div>
          <div className="eyebrow">Storefront Directory</div>
          <h1>Choose a storefront to create videos and INFTs.</h1>
          <p className="subtle">
            Browse created storefronts, compare reputation and pricing, then open the store that matches your render constraints.
          </p>
        </div>
        <div className="landing-hero-actions">
          <BreadcrumbNav />
          <button className="btn" onClick={() => load()} title="Refresh storefronts">
            <RefreshCw size={16} /> Refresh
          </button>
          <a className="btn" href="/dashboard">
            <Store size={16} /> Add storefront
          </a>
        </div>
      </section>

      {message && <p className="notice">{message}</p>}

      <section className="storefront-search-strip">
        <Search size={18} />
        <span>{store ? storefronts.length : 0} created storefront{storefronts.length === 1 ? "" : "s"} available</span>
      </section>

      <section className="storefront-grid" aria-label="Created storefronts">
        {!store && (
          <div className="panel">
            <p className="subtle">Loading storefronts...</p>
          </div>
        )}
        {store && storefronts.length === 0 && (
          <div className="panel">
            <p className="subtle">No storefronts have been created yet.</p>
          </div>
        )}
        {storefronts.map((item) => {
          const ownerEnsName = ownerEnsLookups[item.ownerEnsLookupKey]?.name;
          return (
          <article className="storefront-card storefront-theme" key={item.customer.id} style={storefrontThemeStyle(item.customer.storefront?.themeId)}>
            <div className="storefront-card-header">
              <div>
                <span className="eyebrow">{item.customer.storefront?.category || "Customer store"}</span>
                <h2>{item.customer.name}</h2>
                {item.routeCodes.length > 0 && <p className="mono route-code">{item.routeCodes.length} existing route{item.routeCodes.length === 1 ? "" : "s"}</p>}
              </div>
              {item.customer.storefront?.logoUrl ? (
                <span className="storefront-logo-frame compact"><img alt="" src={item.customer.storefront.logoUrl} /></span>
              ) : (
                <span className="storefront-icon"><Store size={20} /></span>
              )}
            </div>

            <p className="storefront-description">
              {item.customer.storefront?.description || "Product video storefront ready for wallet users and referral render tasks."}
            </p>

            {ownerEnsName && (
              <div className="storefront-owner" aria-label={`Store owner ENS ${ownerEnsName}`}>
                <Wallet size={16} />
                <span>
                  <span className="sr-only">Store owner ENS</span>
                  <span className="storefront-owner-ens">{ownerEnsName}</span>
                </span>
              </div>
            )}

            <div className="storefront-meta-row">
              <span><Film size={15} /> {item.renderCount} renders</span>
              <span><ShieldCheck size={15} /> {item.subAccountCount} wallet users</span>
              <span><Star size={15} /> {formatRating(item.ratingSummary.average, item.ratingSummary.count)}</span>
              <span><SlidersHorizontal size={15} /> {item.pricingSummary}</span>
            </div>

            <div className="storefront-condition-tiles" aria-label="Storefront pricing and render conditions">
              {item.conditionTiles.map((tile) => <span key={tile}>{tile}</span>)}
              {item.pricingTiles.map((tile) => <span className="price" key={tile}>{tile}</span>)}
            </div>

            {item.customer.storefront?.tags?.length ? (
              <div className="storefront-tags">
                {item.customer.storefront.tags.map((tag) => <span key={tag}>{tag}</span>)}
              </div>
            ) : null}

            {item.routeCodes.length > 0 && (
              <div className="storefront-route-row" aria-label="Existing storefront routes">
                {item.routeCodes.slice(0, 4).map((referrerCode) => (
                  <a href={`/r/${referrerCode}`} key={referrerCode}>/r/{referrerCode}</a>
                ))}
              </div>
            )}

            <div className="button-row">
              <a className="btn primary" href={`/storefronts/${item.customer.id}`}>
                <ExternalLink size={16} /> Open storefront
              </a>
              {item.customer.storefront?.websiteUrl && (
                <a className="btn" href={item.customer.storefront.websiteUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Store site
                </a>
              )}
            </div>
          </article>
          );
        })}
      </section>
    </main>
  );
}

function buildStorefrontDirectoryItem(store: SuperReferralsStore, customer: Customer) {
  const ratings = store.storefrontRatings.filter((rating) => rating.customerId === customer.id);
  const routeAccounts = store.subAccounts.filter((account) => account.customerId === customer.id);
  const pricing = getAllowedModelPricingConfigurations(customer);
  const pricedOptions = pricing.map((item) => ({
    item,
    details: resolveModelPriceDetails(customer, item)
  }));
  const priceValues = pricedOptions.map((option) => option.details.pricePerSecondUsd);
  const minPrice = priceValues.length ? Math.min(...priceValues) : 0;
  const maxPrice = priceValues.length ? Math.max(...priceValues) : 0;
  return {
    customer,
    ownerWallet: customer.ownerWallet,
    ownerEnsNetwork: ownerEnsNetworkForCustomer(customer),
    ownerEnsLookupKey: ownerEnsLookupKey(customer),
    routeCodes: routeAccounts.map((account) => account.referrerCode),
    subAccountCount: routeAccounts.length,
    renderCount: store.generations.filter((generation) => generation.customerId === customer.id).length,
    ratingSummary: summarizeRatings(ratings),
    pricingSummary: priceValues.length
      ? minPrice === maxPrice
        ? `${minPrice.toFixed(2)} USDC/sec`
        : `${minPrice.toFixed(2)}-${maxPrice.toFixed(2)} USDC/sec`
      : "No enabled pricing",
    conditionTiles: getStorefrontConditionTiles(customer),
    pricingTiles: pricedOptions.slice(0, 4).map(({ item, details }) =>
      `${item.videoModel} ${item.aspectRatio}: ${details.pricePerSecondUsd.toFixed(2)} USDC/sec`
    )
  };
}

function uniqueOwnerEnsTargets(items: ReturnType<typeof buildStorefrontDirectoryItem>[]) {
  const targets = new Map<string, { key: string; wallet: string; network: OwnerEnsNetwork }>();
  for (const item of items) {
    if (!isUsableEvmAddress(item.ownerWallet)) {
      continue;
    }
    targets.set(item.ownerEnsLookupKey, {
      key: item.ownerEnsLookupKey,
      wallet: item.ownerWallet,
      network: item.ownerEnsNetwork
    });
  }
  return [...targets.values()];
}

async function resolveOwnerEnsName(wallet: string, network: OwnerEnsNetwork) {
  const response = await fetch("/api/ens/resolve", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address: wallet, network })
  });
  if (!response.ok) {
    return null;
  }
  const data = await response.json() as { result?: { name?: unknown } };
  return typeof data.result?.name === "string" && data.result.name
    ? data.result.name
    : null;
}

function ownerEnsLookupKey(customer: Customer) {
  return `${ownerEnsNetworkForCustomer(customer)}:${customer.ownerWallet.trim().toLowerCase()}`;
}

function ownerEnsNetworkForCustomer(customer: Customer): OwnerEnsNetwork {
  return customer.pricing.chainId === 11155111 ? "sepolia" : "mainnet";
}

function summarizeRatings(ratings: StorefrontRating[]) {
  const count = ratings.length;
  const average = count
    ? ratings.reduce((sum, rating) => sum + rating.score, 0) / count
    : 0;
  return { count, average };
}

function formatRating(average: number, count: number) {
  if (!count) {
    return "No ratings";
  }
  return `${average.toFixed(1)} (${count})`;
}

function isDirectoryStorefrontCustomer(customer: Customer) {
  return Boolean(customer.storefront) && isUsableEvmAddress(customer.ownerWallet);
}
