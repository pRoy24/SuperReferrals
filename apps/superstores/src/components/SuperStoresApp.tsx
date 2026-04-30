"use client";

import {
  BadgeCheck,
  Boxes,
  Brush,
  Check,
  ChevronRight,
  CircleDollarSign,
  Copy,
  ExternalLink,
  Filter,
  GalleryHorizontalEnd,
  Globe2,
  HandCoins,
  Link2,
  ListPlus,
  LockKeyhole,
  Network,
  PanelsTopLeft,
  RadioTower,
  ReceiptText,
  Search,
  ShieldCheck,
  ShoppingBag,
  SlidersHorizontal,
  Sparkles,
  Store,
  UserPlus,
  Wallet
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  calculateSaleBreakdown,
  CURRENCIES,
  FILE_TYPES,
  formatCurrency,
  initialStoreSettings,
  makeReferralCode,
  marketplaceUrl,
  makeWallet,
  metadataSummary,
  paymentChainForEnvironment,
  collectiblesChainForEnvironment,
  routingInstruction,
  seedListings,
  seedPartners,
  shortWallet,
  templates,
  type Currency,
  type FileType,
  type Listing,
  type MetadataAttribute,
  type ReferralPartner,
  type RoutingMode,
  type Sale,
  type StoreSettings,
  type TemplateId,
  type WalletAccount,
  type WalletRole
} from "@/lib/superstores";

type View = "market" | "admin" | "seller" | "partners" | "checkout";
type AdminStep = "store" | "routing" | "commerce" | "template";
type ListingDraft = {
  title: string;
  description: string;
  amount: string;
  currency: Currency;
  fileType: FileType;
  mediaUrl: string;
  metadata: string;
  rights: string;
};

const environment = process.env.NEXT_PUBLIC_SUPERSTORES_ENV || "staging";
const configuredPaymentChain = process.env.NEXT_PUBLIC_SUPERSTORES_PAYMENT_CHAIN || paymentChainForEnvironment(environment);
const configuredCollectiblesChain = process.env.NEXT_PUBLIC_SUPERSTORES_COLLECTIBLES_CHAIN || collectiblesChainForEnvironment(environment);

const viewItems: Array<{ id: View; label: string; icon: typeof Store }> = [
  { id: "market", label: "Storefront", icon: Store },
  { id: "admin", label: "Admin", icon: PanelsTopLeft },
  { id: "seller", label: "Sell", icon: ListPlus },
  { id: "partners", label: "Partners", icon: UserPlus },
  { id: "checkout", label: "Checkout", icon: ReceiptText }
];

const adminSteps: Array<{ id: AdminStep; label: string; icon: typeof Store }> = [
  { id: "store", label: "Store", icon: Store },
  { id: "routing", label: "Routing", icon: Globe2 },
  { id: "commerce", label: "Commerce", icon: HandCoins },
  { id: "template", label: "Template", icon: Brush }
];

const emptyListingDraft: ListingDraft = {
  title: "Signal Archive Drop",
  description: "Encrypted digital collectible with resale rights and 0G storage metadata.",
  amount: "120",
  currency: "USDC",
  fileType: "book",
  mediaUrl: "0g://signal-archive-drop",
  metadata: "Collection: Signal Archive, Edition: 1/40, Access: Encrypted",
  rights: "Buyer receives access, display, and resale rights."
};

export function SuperStoresApp() {
  const [settings, setSettings] = useState<StoreSettings>(initialStoreSettings);
  const [wallet, setWallet] = useState<WalletAccount | null>(null);
  const [view, setView] = useState<View>("market");
  const [adminStep, setAdminStep] = useState<AdminStep>("store");
  const [listings, setListings] = useState<Listing[]>(seedListings);
  const [partners, setPartners] = useState<ReferralPartner[]>(seedPartners);
  const [sales, setSales] = useState<Sale[]>([]);
  const [selectedListingId, setSelectedListingId] = useState(seedListings[0]?.id || "");
  const [activeReferrer, setActiveReferrer] = useState("");
  const [buyerCurrency, setBuyerCurrency] = useState<Currency>("USDC");
  const [listingDraft, setListingDraft] = useState<ListingDraft>(emptyListingDraft);
  const [typeFilters, setTypeFilters] = useState<FileType[]>([]);
  const [currencyFilter, setCurrencyFilter] = useState<Currency | "all">("all");
  const [metadataFilter, setMetadataFilter] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref) {
      setActiveReferrer(ref);
    }
  }, []);

  const selectedListing = useMemo(
    () => listings.find((listing) => listing.id === selectedListingId) || listings.find((listing) => listing.status === "listed") || listings[0],
    [listings, selectedListingId]
  );
  const selectedPartner = useMemo(
    () => partners.find((partner) => partner.code.toLowerCase() === activeReferrer.toLowerCase()),
    [activeReferrer, partners]
  );
  const visibleListings = useMemo(() => {
    const needle = metadataFilter.trim().toLowerCase();
    return listings.filter((listing) => {
      if (listing.status !== "listed") return false;
      if (typeFilters.length && !typeFilters.includes(listing.fileType)) return false;
      if (currencyFilter !== "all" && listing.currency !== currencyFilter) return false;
      if (!needle) return true;
      return `${listing.title} ${listing.description} ${metadataSummary(listing)}`
        .toLowerCase()
        .includes(needle);
    });
  }, [currencyFilter, listings, metadataFilter, typeFilters]);
  const selectedBreakdown = selectedListing
    ? calculateSaleBreakdown(selectedListing.amount, Boolean(activeReferrer))
    : null;
  const grossVolume = sales.reduce((sum, sale) => sum + sale.finalAmount, 0);
  const platformRevenue = sales.reduce((sum, sale) => sum + sale.platformFee, 0);

  function connectWallet(role: WalletRole) {
    const nextWallet = {
      address: makeWallet(Date.now() + role.length),
      role,
      registeredAt: new Date().toISOString()
    };
    setWallet(nextWallet);
    setNotice(`${roleLabel(role)} wallet registered: ${shortWallet(nextWallet.address)}`);
  }

  function updateSettings(patch: Partial<StoreSettings>) {
    setSettings((current) => ({ ...current, ...patch }));
  }

  function updateRouting(patch: Partial<StoreSettings["routing"]>) {
    setSettings((current) => ({
      ...current,
      routing: {
        ...current.routing,
        ...patch,
        status: patch.status || "pending"
      }
    }));
  }

  function toggleCurrency(currency: Currency) {
    setSettings((current) => {
      const hasCurrency = current.acceptedCurrencies.includes(currency);
      const nextCurrencies = hasCurrency
        ? current.acceptedCurrencies.filter((item) => item !== currency)
        : [...current.acceptedCurrencies, currency];
      return {
        ...current,
        acceptedCurrencies: nextCurrencies.length ? nextCurrencies : [currency]
      };
    });
  }

  function toggleFileType(fileType: FileType) {
    setTypeFilters((current) => current.includes(fileType)
      ? current.filter((item) => item !== fileType)
      : [...current, fileType]);
  }

  function submitListing(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!wallet || wallet.role !== "seller") {
      connectWallet("seller");
      return;
    }
    const amount = Number(listingDraft.amount);
    if (!listingDraft.title.trim() || !amount || amount <= 0) {
      setNotice("Listing needs a title and positive seller amount.");
      return;
    }
    const listing: Listing = {
      id: `lst_${Date.now()}`,
      title: listingDraft.title.trim(),
      description: listingDraft.description.trim(),
      sellerWallet: wallet.address,
      amount,
      currency: listingDraft.currency,
      fileType: listingDraft.fileType,
      mediaUrl: listingDraft.mediaUrl.trim() || "0g://pending-upload",
      metadata: parseMetadata(listingDraft.metadata),
      rights: listingDraft.rights.trim(),
      chain: configuredCollectiblesChain === "0g-mainnet" ? "0g-mainnet" : "0g-galileo",
      createdAt: new Date().toISOString(),
      status: "listed"
    };
    setListings((current) => [listing, ...current]);
    setSelectedListingId(listing.id);
    setView("checkout");
    setNotice("Listing staged with 20% buyer-side fee distribution.");
  }

  function registerPartner() {
    if (!wallet || wallet.role !== "partner") {
      connectWallet("partner");
      return;
    }
    const existing = partners.find((partner) => partner.wallet.toLowerCase() === wallet.address.toLowerCase());
    if (existing) {
      setActiveReferrer(existing.code);
      setNotice("Referral partner already registered.");
      return;
    }
    const partner: ReferralPartner = {
      id: `partner_${Date.now()}`,
      wallet: wallet.address,
      code: makeReferralCode(wallet.address),
      joinedAt: new Date().toISOString(),
      sales: 0,
      commission: 0
    };
    setPartners((current) => [partner, ...current]);
    setActiveReferrer(partner.code);
    setNotice("Referral partner registered with a unique link.");
  }

  function simulateSale() {
    if (!selectedListing || !selectedBreakdown) return;
    if (!wallet || wallet.role !== "buyer") {
      connectWallet("buyer");
      return;
    }
    const sale: Sale = {
      id: `sale_${Date.now()}`,
      listingId: selectedListing.id,
      buyerWallet: wallet.address,
      sellerWallet: selectedListing.sellerWallet,
      currency: buyerCurrency,
      settlementCurrency: selectedListing.currency,
      sellerAmount: selectedBreakdown.sellerAmount,
      platformFee: selectedBreakdown.platformFee,
      referrerFee: selectedBreakdown.referrerFee,
      finalAmount: selectedBreakdown.finalAmount,
      referrerCode: activeReferrer || undefined,
      paymentChain: configuredPaymentChain === "base-mainnet" ? "base-mainnet" : "eth-sepolia",
      collectiblesChain: configuredCollectiblesChain === "0g-mainnet" ? "0g-mainnet" : "0g-galileo",
      keeperHubRoute: `${buyerCurrency}->${selectedListing.currency}->seller/platform${activeReferrer ? "/referrer" : ""}`,
      createdAt: new Date().toISOString()
    };
    setSales((current) => [sale, ...current]);
    setListings((current) => current.map((listing) => listing.id === selectedListing.id
      ? { ...listing, status: "sold" }
      : listing));
    if (activeReferrer) {
      setPartners((current) => current.map((partner) => partner.code.toLowerCase() === activeReferrer.toLowerCase()
        ? {
            ...partner,
            sales: partner.sales + 1,
            commission: partner.commission + selectedBreakdown.referrerFee
          }
        : partner));
    }
    setNotice("Sale simulated. KeeperHub distribution and webhook payload are ready.");
  }

  return (
    <main className={`app-shell template-${settings.template}`}>
      <section className="workspace">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark"><Boxes size={22} /></div>
            <div>
              <p className="eyebrow">SuperStores framework</p>
              <h1>{settings.name}</h1>
            </div>
          </div>
          <div className="network-strip" aria-label="Deployment networks">
            <span><RadioTower size={15} /> {configuredCollectiblesChain}</span>
            <span><CircleDollarSign size={15} /> {configuredPaymentChain}</span>
            <span><ShieldCheck size={15} /> KeeperHub conversion</span>
          </div>
          <div className="wallet-panel">
            <span className="wallet-address"><Wallet size={15} /> {shortWallet(wallet?.address || "")}</span>
            <button type="button" onClick={() => connectWallet(wallet?.role || "buyer")}>
              <Wallet size={16} /> Connect
            </button>
          </div>
        </header>

        <aside className="sidebar" aria-label="Main navigation">
          <div className="store-card">
            <p className="eyebrow">Active storefront</p>
            <h2>{settings.tagline}</h2>
            <p>{settings.description}</p>
            <div className="route-box">
              <Globe2 size={16} />
              <span>{marketplaceUrl(settings, activeReferrer || undefined)}</span>
            </div>
          </div>
          <nav className="nav-list">
            {viewItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={view === item.id ? "active" : ""}
                  onClick={() => setView(item.id)}
                >
                  <Icon size={17} />
                  <span>{item.label}</span>
                  <ChevronRight size={15} />
                </button>
              );
            })}
          </nav>
          <div className="metric-grid">
            <Metric label="Listings" value={String(listings.filter((item) => item.status === "listed").length)} />
            <Metric label="Sales" value={String(sales.length)} />
            <Metric label="Volume" value={grossVolume ? grossVolume.toFixed(2) : "0"} />
            <Metric label="Fees" value={platformRevenue ? platformRevenue.toFixed(2) : "0"} />
          </div>
        </aside>

        <section className="content-panel">
          <div className="role-switcher" aria-label="Wallet role registration">
            {(["buyer", "seller", "partner"] as WalletRole[]).map((role) => (
              <button
                key={role}
                type="button"
                className={wallet?.role === role ? "selected" : ""}
                onClick={() => connectWallet(role)}
              >
                {roleIcon(role)}
                {roleLabel(role)}
              </button>
            ))}
          </div>
          {notice ? (
            <div className="notice" role="status">
              <BadgeCheck size={17} />
              <span>{notice}</span>
            </div>
          ) : null}

          {view === "market" && (
            <MarketplaceView
              settings={settings}
              visibleListings={visibleListings}
              typeFilters={typeFilters}
              currencyFilter={currencyFilter}
              metadataFilter={metadataFilter}
              onToggleFileType={toggleFileType}
              onCurrencyFilter={setCurrencyFilter}
              onMetadataFilter={setMetadataFilter}
              onSelect={(listing) => {
                setSelectedListingId(listing.id);
                setView("checkout");
              }}
            />
          )}

          {view === "admin" && (
            <AdminView
              settings={settings}
              adminStep={adminStep}
              onStep={setAdminStep}
              onSettings={updateSettings}
              onRouting={updateRouting}
              onCurrency={toggleCurrency}
            />
          )}

          {view === "seller" && (
            <SellerView
              wallet={wallet}
              draft={listingDraft}
              onDraft={setListingDraft}
              onSubmit={submitListing}
            />
          )}

          {view === "partners" && (
            <PartnerView
              settings={settings}
              wallet={wallet}
              partners={partners}
              activeReferrer={activeReferrer}
              onRegister={registerPartner}
              onReferrer={setActiveReferrer}
            />
          )}

          {view === "checkout" && (
            <CheckoutView
              listing={selectedListing}
              settings={settings}
              activeReferrer={activeReferrer}
              selectedPartner={selectedPartner}
              breakdown={selectedBreakdown}
              wallet={wallet}
              sales={sales}
              buyerCurrency={buyerCurrency}
              onBuyerCurrency={setBuyerCurrency}
              onReferrer={setActiveReferrer}
              onSimulateSale={simulateSale}
            />
          )}
        </section>
      </section>
    </main>
  );
}

function MarketplaceView(props: {
  settings: StoreSettings;
  visibleListings: Listing[];
  typeFilters: FileType[];
  currencyFilter: Currency | "all";
  metadataFilter: string;
  onToggleFileType: (fileType: FileType) => void;
  onCurrencyFilter: (currency: Currency | "all") => void;
  onMetadataFilter: (value: string) => void;
  onSelect: (listing: Listing) => void;
}) {
  return (
    <div className="view-stack">
      <section className="section-header">
        <div>
          <p className="eyebrow">OpenSea-like storefront</p>
          <h2>Digital collectibles marketplace</h2>
        </div>
        <div className="status-pill"><Sparkles size={15} /> {props.settings.template} template</div>
      </section>

      <section className="filter-panel">
        <label className="search-field">
          <Search size={16} />
          <input
            value={props.metadataFilter}
            onChange={(event) => props.onMetadataFilter(event.target.value)}
            placeholder="Filter metadata, collection, license, format"
          />
        </label>
        <div className="filter-row">
          <span><Filter size={15} /> File type</span>
          {FILE_TYPES.map((fileType) => (
            <button
              key={fileType}
              type="button"
              className={props.typeFilters.includes(fileType) ? "chip active" : "chip"}
              onClick={() => props.onToggleFileType(fileType)}
            >
              {fileType}
            </button>
          ))}
        </div>
        <div className="filter-row">
          <span><SlidersHorizontal size={15} /> Currency</span>
          <button
            type="button"
            className={props.currencyFilter === "all" ? "chip active" : "chip"}
            onClick={() => props.onCurrencyFilter("all")}
          >
            all
          </button>
          {CURRENCIES.map((currency) => (
            <button
              key={currency}
              type="button"
              className={props.currencyFilter === currency ? "chip active" : "chip"}
              onClick={() => props.onCurrencyFilter(currency)}
            >
              {currency}
            </button>
          ))}
        </div>
      </section>

      <section className="listing-grid" aria-label="Marketplace listings">
        {props.visibleListings.map((listing) => (
          <ListingCard key={listing.id} listing={listing} onSelect={props.onSelect} />
        ))}
      </section>
    </div>
  );
}

function AdminView(props: {
  settings: StoreSettings;
  adminStep: AdminStep;
  onStep: (step: AdminStep) => void;
  onSettings: (patch: Partial<StoreSettings>) => void;
  onRouting: (patch: Partial<StoreSettings["routing"]>) => void;
  onCurrency: (currency: Currency) => void;
}) {
  return (
    <div className="view-stack">
      <section className="section-header">
        <div>
          <p className="eyebrow">Admin wizard</p>
          <h2>Configure the storefront</h2>
        </div>
        <div className="status-pill"><LockKeyhole size={15} /> wallet-only onboarding</div>
      </section>

      <div className="wizard-layout">
        <div className="wizard-rail">
          {adminSteps.map((step) => {
            const Icon = step.icon;
            return (
              <button
                key={step.id}
                type="button"
                className={props.adminStep === step.id ? "active" : ""}
                onClick={() => props.onStep(step.id)}
              >
                <Icon size={17} />
                {step.label}
              </button>
            );
          })}
        </div>

        <div className="wizard-card">
          {props.adminStep === "store" && (
            <div className="form-grid">
              <TextField label="Store name" value={props.settings.name} onChange={(name) => props.onSettings({ name })} />
              <TextField label="Tagline" value={props.settings.tagline} onChange={(tagline) => props.onSettings({ tagline })} />
              <TextField label="Owner wallet" value={props.settings.ownerWallet} onChange={(ownerWallet) => props.onSettings({ ownerWallet })} />
              <TextField label="Treasury wallet" value={props.settings.treasuryWallet} onChange={(treasuryWallet) => props.onSettings({ treasuryWallet })} />
              <label className="field wide">
                <span>Description</span>
                <textarea value={props.settings.description} onChange={(event) => props.onSettings({ description: event.target.value })} />
              </label>
            </div>
          )}

          {props.adminStep === "routing" && (
            <div className="form-grid">
              <label className="field">
                <span>Routing mode</span>
                <select
                  value={props.settings.routing.mode}
                  onChange={(event) => props.onRouting({ mode: event.target.value as RoutingMode })}
                >
                  <option value="cname-ens">CNAME to ENS</option>
                  <option value="ens-subdomain">ENS subdomain</option>
                  <option value="path">Path</option>
                </select>
              </label>
              {props.settings.routing.mode === "cname-ens" && (
                <>
                  <TextField label="CNAME source" value={props.settings.routing.cnameDomain} onChange={(cnameDomain) => props.onRouting({ cnameDomain })} />
                  <TextField label="ENS target" value={props.settings.routing.ensTarget} onChange={(ensTarget) => props.onRouting({ ensTarget })} />
                </>
              )}
              {props.settings.routing.mode === "ens-subdomain" && (
                <TextField label="ENS subdomain" value={props.settings.routing.ensSubdomain} onChange={(ensSubdomain) => props.onRouting({ ensSubdomain })} />
              )}
              {props.settings.routing.mode === "path" && (
                <TextField label="Storefront path" value={props.settings.routing.path} onChange={(path) => props.onRouting({ path })} />
              )}
              <div className="routing-preview wide">
                <span><Network size={16} /> Verification</span>
                <strong>{routingInstruction(props.settings)}</strong>
                <p>{marketplaceUrl(props.settings)}</p>
              </div>
            </div>
          )}

          {props.adminStep === "commerce" && (
            <div className="form-grid">
              <TextField label="Sale webhook URL" value={props.settings.webhookUrl} onChange={(webhookUrl) => props.onSettings({ webhookUrl })} />
              <div className="fee-panel wide">
                <div>
                  <span>Seller amount</span>
                  <strong>100%</strong>
                </div>
                <div>
                  <span>Platform fee with referrer</span>
                  <strong>10%</strong>
                </div>
                <div>
                  <span>Referrer commission</span>
                  <strong>10%</strong>
                </div>
                <div>
                  <span>Platform fee without referrer</span>
                  <strong>20%</strong>
                </div>
              </div>
              <div className="toggle-group wide">
                <span>Accepted listing currencies</span>
                {CURRENCIES.map((currency) => (
                  <button
                    key={currency}
                    type="button"
                    className={props.settings.acceptedCurrencies.includes(currency) ? "chip active" : "chip"}
                    onClick={() => props.onCurrency(currency)}
                  >
                    {currency}
                  </button>
                ))}
              </div>
              <div className="routing-preview wide">
                <span><HandCoins size={16} /> Settlement</span>
                <strong>KeeperHub converts internally when buyer and seller rails differ.</strong>
                <p>Staging payments settle on Ethereum Sepolia. Production payments settle on Base mainnet.</p>
              </div>
            </div>
          )}

          {props.adminStep === "template" && (
            <div className="template-grid">
              {templates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  className={props.settings.template === template.id ? "template-card active" : "template-card"}
                  onClick={() => props.onSettings({ template: template.id as TemplateId })}
                >
                  <span>{template.name}</span>
                  <strong>{template.signal}</strong>
                  <p>{template.description}</p>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SellerView(props: {
  wallet: WalletAccount | null;
  draft: ListingDraft;
  onDraft: (draft: ListingDraft) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const amount = Number(props.draft.amount || 0);
  const breakdown = calculateSaleBreakdown(amount, true);
  return (
    <div className="view-stack">
      <section className="section-header">
        <div>
          <p className="eyebrow">Seller console</p>
          <h2>List any digital collectible good</h2>
        </div>
        <div className="status-pill"><Wallet size={15} /> {props.wallet?.role === "seller" ? shortWallet(props.wallet.address) : "seller wallet required"}</div>
      </section>

      <form className="seller-layout" onSubmit={props.onSubmit}>
        <div className="form-grid">
          <TextField label="Title" value={props.draft.title} onChange={(title) => props.onDraft({ ...props.draft, title })} />
          <label className="field">
            <span>File type</span>
            <select value={props.draft.fileType} onChange={(event) => props.onDraft({ ...props.draft, fileType: event.target.value as FileType })}>
              {FILE_TYPES.map((fileType) => <option key={fileType} value={fileType}>{fileType}</option>)}
            </select>
          </label>
          <TextField label="Seller amount" value={props.draft.amount} onChange={(nextAmount) => props.onDraft({ ...props.draft, amount: nextAmount })} />
          <label className="field">
            <span>Listing currency</span>
            <select value={props.draft.currency} onChange={(event) => props.onDraft({ ...props.draft, currency: event.target.value as Currency })}>
              {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
            </select>
          </label>
          <TextField label="Media or storage URI" value={props.draft.mediaUrl} onChange={(mediaUrl) => props.onDraft({ ...props.draft, mediaUrl })} />
          <TextField label="Metadata attributes" value={props.draft.metadata} onChange={(metadata) => props.onDraft({ ...props.draft, metadata })} />
          <label className="field wide">
            <span>Description</span>
            <textarea value={props.draft.description} onChange={(event) => props.onDraft({ ...props.draft, description: event.target.value })} />
          </label>
          <label className="field wide">
            <span>Rights</span>
            <textarea value={props.draft.rights} onChange={(event) => props.onDraft({ ...props.draft, rights: event.target.value })} />
          </label>
        </div>

        <aside className="distribution-card">
          <p className="eyebrow">Buyer-facing distribution</p>
          <h3>{formatCurrency(breakdown.sellerAmount, props.draft.currency)}</h3>
          <div className="distribution-line">
            <span>Amount seller wants</span>
            <strong>{formatCurrency(breakdown.sellerAmount, props.draft.currency)}</strong>
          </div>
          <div className="distribution-line">
            <span>Platform fees 20% added</span>
            <strong>{formatCurrency(breakdown.platformFee + breakdown.referrerFee, props.draft.currency)}</strong>
          </div>
          <div className="distribution-total">
            <span>Final amount customer pays</span>
            <strong>{formatCurrency(breakdown.finalAmount, props.draft.currency)}</strong>
          </div>
          <button type="submit"><ListPlus size={16} /> List collectible</button>
        </aside>
      </form>
    </div>
  );
}

function PartnerView(props: {
  settings: StoreSettings;
  wallet: WalletAccount | null;
  partners: ReferralPartner[];
  activeReferrer: string;
  onRegister: () => void;
  onReferrer: (code: string) => void;
}) {
  const walletPartner = props.partners.find((partner) => props.wallet && partner.wallet.toLowerCase() === props.wallet.address.toLowerCase());
  const activeCode = walletPartner?.code || props.activeReferrer;
  const link = marketplaceUrl(props.settings, activeCode || "YOURCODE");
  return (
    <div className="view-stack">
      <section className="section-header">
        <div>
          <p className="eyebrow">Referral partners</p>
          <h2>Register wallet, share link, earn 10%</h2>
        </div>
        <button type="button" onClick={props.onRegister}><UserPlus size={16} /> Register partner</button>
      </section>
      <section className="partner-card">
        <div>
          <span>Partner link</span>
          <strong>{link}</strong>
        </div>
        <button type="button" onClick={() => void navigator.clipboard?.writeText(link)}><Copy size={16} /> Copy</button>
      </section>
      <label className="field referral-field">
        <span>Apply referral code to checkout simulator</span>
        <input value={props.activeReferrer} onChange={(event) => props.onReferrer(event.target.value)} placeholder="ORBIT10" />
      </label>
      <section className="partner-grid">
        {props.partners.map((partner) => (
          <article key={partner.id} className="partner-row">
            <div>
              <strong>{partner.code}</strong>
              <span>{shortWallet(partner.wallet)}</span>
            </div>
            <div>
              <strong>{partner.sales}</strong>
              <span>sales</span>
            </div>
            <div>
              <strong>{partner.commission.toFixed(2)}</strong>
              <span>commission</span>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}

function CheckoutView(props: {
  listing?: Listing;
  settings: StoreSettings;
  activeReferrer: string;
  selectedPartner?: ReferralPartner;
  breakdown: ReturnType<typeof calculateSaleBreakdown> | null;
  wallet: WalletAccount | null;
  sales: Sale[];
  buyerCurrency: Currency;
  onBuyerCurrency: (currency: Currency) => void;
  onReferrer: (code: string) => void;
  onSimulateSale: () => void;
}) {
  if (!props.listing || !props.breakdown) {
    return (
      <div className="empty-state">
        <ShoppingBag size={28} />
        <h2>Select a listed collectible to run checkout.</h2>
      </div>
    );
  }
  return (
    <div className="checkout-layout">
      <ListingCard listing={props.listing} onSelect={() => undefined} compact />
      <section className="checkout-card">
        <p className="eyebrow">Checkout distribution</p>
        <h2>{formatCurrency(props.breakdown.finalAmount, props.listing.currency)}</h2>
        <div className="distribution-line">
          <span>Seller receives</span>
          <strong>{formatCurrency(props.breakdown.sellerAmount, props.listing.currency)}</strong>
        </div>
        <div className="distribution-line">
          <span>Platform receives</span>
          <strong>{formatCurrency(props.breakdown.platformFee, props.listing.currency)}</strong>
        </div>
        <div className="distribution-line">
          <span>Referrer receives</span>
          <strong>{formatCurrency(props.breakdown.referrerFee, props.listing.currency)}</strong>
        </div>
        <div className="distribution-total">
          <span>Customer pays</span>
          <strong>{formatCurrency(props.breakdown.finalAmount, props.listing.currency)}</strong>
        </div>
        <label className="field">
          <span>Buyer pays in</span>
          <select value={props.buyerCurrency} onChange={(event) => props.onBuyerCurrency(event.target.value as Currency)}>
            {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Referral code</span>
          <input value={props.activeReferrer} onChange={(event) => props.onReferrer(event.target.value)} placeholder="No referrer" />
        </label>
        <div className="routing-preview">
          <span><ExternalLink size={16} /> KeeperHub route</span>
          <strong>{props.buyerCurrency} buyer payment to {props.listing.currency} seller settlement on {configuredPaymentChain}</strong>
          <p>{props.activeReferrer ? "10% platform, 10% referrer" : "20% platform, no referrer"}; KeeperHub handles conversion internally; collectible anchoring on {configuredCollectiblesChain}.</p>
        </div>
        <button type="button" onClick={props.onSimulateSale}>
          <CircleDollarSign size={16} /> Simulate crypto sale
        </button>
      </section>
      <section className="checkout-card">
        <p className="eyebrow">Webhook payload</p>
        <pre>{JSON.stringify({
          event: "superstores.sale.distribution",
          listingId: props.listing.id,
          buyerWallet: props.wallet?.address || "connect buyer wallet",
          sellerWallet: props.listing.sellerWallet,
          buyerCurrency: props.buyerCurrency,
          settlementCurrency: props.listing.currency,
          referrerCode: props.activeReferrer || null,
          webhookUrl: props.settings.webhookUrl,
          distribution: props.breakdown
        }, null, 2)}</pre>
        <div className="sales-list">
          {props.sales.slice(0, 3).map((sale) => (
            <div key={sale.id}>
              <strong>{sale.id}</strong>
              <span>{formatCurrency(sale.finalAmount, sale.settlementCurrency)} settled / {sale.currency} paid / {sale.referrerCode || "no referrer"}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ListingCard({ listing, onSelect, compact = false }: { listing: Listing; onSelect: (listing: Listing) => void; compact?: boolean }) {
  const breakdown = calculateSaleBreakdown(listing.amount, true);
  return (
    <article className={compact ? "listing-card compact" : "listing-card"}>
      <div className={`asset-frame asset-${listing.fileType}`}>
        {assetIcon(listing.fileType)}
        <span>{listing.fileType}</span>
      </div>
      <div className="listing-body">
        <div className="listing-title">
          <h3>{listing.title}</h3>
          <span>{listing.currency}</span>
        </div>
        <p>{listing.description}</p>
        <div className="metadata-list">
          {listing.metadata.slice(0, 3).map((item) => (
            <span key={`${listing.id}-${item.trait_type}`}>{item.trait_type}: {item.value}</span>
          ))}
        </div>
        <div className="listing-footer">
          <div>
            <span>Seller ask</span>
            <strong>{formatCurrency(listing.amount, listing.currency)}</strong>
          </div>
          <div>
            <span>Customer pays</span>
            <strong>{formatCurrency(breakdown.finalAmount, listing.currency)}</strong>
          </div>
        </div>
        {!compact && (
          <button type="button" onClick={() => onSelect(listing)}>
            <ShoppingBag size={16} /> Buy
          </button>
        )}
      </div>
    </article>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function parseMetadata(input: string): MetadataAttribute[] {
  return input.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [traitType, ...rest] = part.split(":");
      return {
        trait_type: (traitType || "Property").trim(),
        value: (rest.join(":") || "Unspecified").trim()
      };
    });
}

function roleLabel(role: WalletRole) {
  return role === "buyer" ? "Buyer" : role === "seller" ? "Seller" : "Partner";
}

function roleIcon(role: WalletRole) {
  if (role === "seller") return <ListPlus size={16} />;
  if (role === "partner") return <Link2 size={16} />;
  return <ShoppingBag size={16} />;
}

function assetIcon(fileType: FileType) {
  if (fileType === "video") return <GalleryHorizontalEnd size={26} />;
  if (fileType === "image") return <Sparkles size={26} />;
  if (fileType === "book" || fileType === "pdf") return <ReceiptText size={26} />;
  if (fileType === "audio") return <RadioTower size={26} />;
  return <Boxes size={26} />;
}
