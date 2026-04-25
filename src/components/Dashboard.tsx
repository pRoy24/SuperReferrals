"use client";

import {
  Bot,
  Boxes,
  CircleDollarSign,
  Database,
  ExternalLink,
  KeyRound,
  Link2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Wallet
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Customer, Generation, INFTRecord, PaymentQuote, SubAccount, SuperReferrerStore, VideoModel } from "@/lib/types";

const starterImages = [
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
  "https://images.unsplash.com/photo-1460353581641-37baddab0fa2",
  "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77"
].join("\n");

export default function Dashboard({ initialReferrerCode }: { initialReferrerCode?: string }) {
  const [store, setStore] = useState<SuperReferrerStore | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [customerForm, setCustomerForm] = useState({
    id: "cus_demo",
    name: "Demo Customer",
    ownerWallet: "0x1111111111111111111111111111111111111111",
    pricePerImageUsd: 1.25,
    platformFeeBps: 500,
    refundOnFailureBps: 5000,
    referrerBaseUrl: "http://localhost:3000",
    ensName: "demo.eth"
  });
  const [subForm, setSubForm] = useState({
    wallet: "0x2222222222222222222222222222222222222222",
    email: "creator@example.com",
    username: "demo-creator"
  });
  const [generationForm, setGenerationForm] = useState({
    imageUrls: starterImages,
    metadata: JSON.stringify({ title: "Runner launch", product: "Road shoe", campaign: "spring-drop" }, null, 2),
    prompt: "Create a premium 12 second product teaser with clean motion and a clear final CTA.",
    videoModel: "RUNWAYML" as VideoModel,
    aspectRatio: "9:16" as "16:9" | "9:16",
    language: "en",
    ctaUrl: "https://example.com/buy",
    txHash: ""
  });
  const [selectedSubAccountId, setSelectedSubAccountId] = useState("sub_demo");
  const [quote, setQuote] = useState<PaymentQuote | null>(null);

  async function load() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const data = await response.json();
    setStore(data);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    if (!store) return;
    const customer = store.customers[0];
    if (customer) {
      setCustomerForm({
        id: customer.id,
        name: customer.name,
        ownerWallet: customer.ownerWallet,
        pricePerImageUsd: customer.pricing.pricePerImageUsd,
        platformFeeBps: customer.pricing.platformFeeBps,
        refundOnFailureBps: customer.pricing.refundOnFailureBps,
        referrerBaseUrl: customer.referrerBaseUrl,
        ensName: customer.ensName || ""
      });
    }
    const matchingReferrer = initialReferrerCode
      ? store.subAccounts.find((account) => account.referrerCode === initialReferrerCode)
      : null;
    const selected = matchingReferrer || store.subAccounts[0];
    if (selected) {
      setSelectedSubAccountId(selected.id);
    }
  }, [store, initialReferrerCode]);

  const customer = store?.customers[0];
  const selectedSubAccount = useMemo(
    () => store?.subAccounts.find((account) => account.id === selectedSubAccountId) || store?.subAccounts[0],
    [store, selectedSubAccountId]
  );
  const imageCount = parseImageUrls(generationForm.imageUrls).length;
  const completedInfts = store?.infts || [];
  const processingCount = store?.generations.filter((item) => ["QUEUED", "PROCESSING"].includes(item.status)).length || 0;

  async function saveCustomer() {
    setBusy("customer");
    setMessage("");
    try {
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: customerForm.id,
          name: customerForm.name,
          ownerWallet: customerForm.ownerWallet,
          referrerBaseUrl: customerForm.referrerBaseUrl,
          ensName: customerForm.ensName,
          pricing: {
            currency: "USDC",
            pricePerImageUsd: Number(customerForm.pricePerImageUsd),
            platformFeeBps: Number(customerForm.platformFeeBps),
            refundOnFailureBps: Number(customerForm.refundOnFailureBps),
            chainId: 1
          },
          subscription: { status: "active" }
        })
      });
      await assertOk(response);
      await load();
      setMessage("Customer configuration saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function createSubAccount() {
    if (!customer) return;
    setBusy("sub");
    setMessage("");
    try {
      const response = await fetch("/api/subaccounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          ...subForm
        })
      });
      const data = await assertOk(response);
      setSelectedSubAccountId(data.account.id);
      await load();
      setMessage("Sub-account created and mapped to Samsar external-user scope.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sub-account failed");
    } finally {
      setBusy("");
    }
  }

  async function createQuote() {
    if (!customer) return;
    setBusy("quote");
    setMessage("");
    try {
      const response = await fetch("/api/payments/quote", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          subAccountId: selectedSubAccount?.id,
          imageCount,
          swapper: selectedSubAccount?.wallet
        })
      });
      const data = await assertOk(response);
      setQuote(data.quote);
      await load();
      setMessage("Payment quote created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote failed");
    } finally {
      setBusy("");
    }
  }

  async function runGeneration() {
    if (!customer || !selectedSubAccount) return;
    setBusy("generation");
    setMessage("");
    try {
      const metadata = parseJsonObject(generationForm.metadata);
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          subAccountId: selectedSubAccount.id,
          generation: {
            image_urls: parseImageUrls(generationForm.imageUrls),
            metadata,
            prompt: generationForm.prompt,
            video_model: generationForm.videoModel,
            aspect_ratio: generationForm.aspectRatio,
            language: generationForm.language,
            enable_subtitles: true,
            generate_outro_image: Boolean(generationForm.ctaUrl),
            cta_url: generationForm.ctaUrl,
            cta_text_top: "Scan to buy",
            cta_text_bottom: selectedSubAccount.referrerCode
          },
          payment: {
            quoteId: quote?.id,
            txHash: generationForm.txHash || undefined,
            payerWallet: selectedSubAccount.wallet,
            amountUsd: quote?.totalUsd
          }
        })
      });
      const data = await assertOk(response);
      await load();
      setMessage(`Generation ${data.generation?.id || ""} queued.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Generation failed");
    } finally {
      setBusy("");
    }
  }

  async function syncGeneration(id: string) {
    setBusy(id);
    setMessage("");
    try {
      const response = await fetch(`/api/generations/${id}/sync`, { method: "POST" });
      await assertOk(response);
      await load();
      setMessage("Generation synced.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setBusy("");
    }
  }

  if (!store) {
    return <main className="main">Loading SuperReferrer...</main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={18} /></span>
          SuperReferrer
        </div>
        <p className="sidebar-copy">
          On-chain wrapper for Samsar image-list-to-video, 0G persistence, INFT minting, and referrer-driven sub-accounts.
        </p>
        <nav className="nav-list">
          <span className="nav-item"><ShieldCheck size={16} /> Customer controls</span>
          <span className="nav-item"><UserPlus size={16} /> Sub-account billing</span>
          <span className="nav-item"><CircleDollarSign size={16} /> Uniswap payment</span>
          <span className="nav-item"><Database size={16} /> 0G storage</span>
          <span className="nav-item"><Bot size={16} /> INFT agents</span>
        </nav>
      </aside>

      <main className="main">
        <div className="topbar">
          <div>
            <div className="eyebrow">Operational Console</div>
            <h1>Image-list video service with on-chain settlement</h1>
            <p className="subtle">
              Configure a customer instance, issue sub-accounts, price per image, run Samsar generation, and mint the resulting video as a 0G-backed INFT.
            </p>
          </div>
          <button className="btn" onClick={() => load()} title="Refresh data">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {message && <p className="notice">{message}</p>}

        <section className="stat-row">
          <div className="stat"><strong>{store.customers.length}</strong><span className="subtle">customers</span></div>
          <div className="stat"><strong>{store.subAccounts.length}</strong><span className="subtle">sub-accounts</span></div>
          <div className="stat"><strong>{processingCount}</strong><span className="subtle">active jobs</span></div>
          <div className="stat"><strong>{completedInfts.length}</strong><span className="subtle">INFTs minted</span></div>
        </section>

        <div className="grid">
          <section className="stack">
            <div className="panel">
              <div className="panel-header">
                <h2>Customer Instance</h2>
                <KeyRound size={18} />
              </div>
              <div className="form-grid">
                <TextField label="Customer name" value={customerForm.name} onChange={(name) => setCustomerForm({ ...customerForm, name })} />
                <TextField label="Owner wallet" value={customerForm.ownerWallet} onChange={(ownerWallet) => setCustomerForm({ ...customerForm, ownerWallet })} />
                <TextField label="Price per image USD" type="number" value={customerForm.pricePerImageUsd} onChange={(pricePerImageUsd) => setCustomerForm({ ...customerForm, pricePerImageUsd: Number(pricePerImageUsd) })} />
                <TextField label="Platform fee bps" type="number" value={customerForm.platformFeeBps} onChange={(platformFeeBps) => setCustomerForm({ ...customerForm, platformFeeBps: Number(platformFeeBps) })} />
                <TextField label="Failure refund bps" type="number" value={customerForm.refundOnFailureBps} onChange={(refundOnFailureBps) => setCustomerForm({ ...customerForm, refundOnFailureBps: Number(refundOnFailureBps) })} />
                <TextField label="ENS name" value={customerForm.ensName} onChange={(ensName) => setCustomerForm({ ...customerForm, ensName })} />
                <TextField label="Referrer base URL" value={customerForm.referrerBaseUrl} onChange={(referrerBaseUrl) => setCustomerForm({ ...customerForm, referrerBaseUrl })} full />
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={saveCustomer} disabled={busy === "customer"}>
                  <Save size={16} /> Save customer
                </button>
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>Sub-Accounts</h2>
                <Wallet size={18} />
              </div>
              <div className="form-grid">
                <TextField label="User wallet" value={subForm.wallet} onChange={(wallet) => setSubForm({ ...subForm, wallet })} />
                <TextField label="Email" value={subForm.email} onChange={(email) => setSubForm({ ...subForm, email })} />
                <TextField label="Username" value={subForm.username} onChange={(username) => setSubForm({ ...subForm, username })} full />
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={createSubAccount} disabled={busy === "sub"}>
                  <UserPlus size={16} /> Create sub-account
                </button>
              </div>
              <div className="list" style={{ marginTop: 14 }}>
                {store.subAccounts.map((account) => (
                  <button
                    className="item"
                    key={account.id}
                    onClick={() => setSelectedSubAccountId(account.id)}
                    style={{ textAlign: "left", borderColor: selectedSubAccountId === account.id ? "var(--accent)" : undefined }}
                  >
                    <div className="item-title">
                      <strong>{account.username || account.email || account.id}</strong>
                      <span className="badge">{account.referrerCode}</span>
                    </div>
                    <div className="mono">{account.wallet}</div>
                    <div className="subtle">{customer?.referrerBaseUrl}/r/{account.referrerCode}</div>
                  </button>
                ))}
              </div>
            </div>
          </section>

          <section className="stack">
            <div className="panel">
              <div className="panel-header">
                <h2>Generate Marketing Video</h2>
                <Play size={18} />
              </div>
              {initialReferrerCode && <p className="notice">Referrer route active: {initialReferrerCode}</p>}
              <div className="form-grid">
                <div className="field full">
                  <label>Image URL list</label>
                  <textarea value={generationForm.imageUrls} onChange={(event) => setGenerationForm({ ...generationForm, imageUrls: event.target.value })} />
                </div>
                <div className="field full">
                  <label>JSON payload metadata</label>
                  <textarea value={generationForm.metadata} onChange={(event) => setGenerationForm({ ...generationForm, metadata: event.target.value })} />
                </div>
                <div className="field full">
                  <label>Prompt</label>
                  <textarea value={generationForm.prompt} onChange={(event) => setGenerationForm({ ...generationForm, prompt: event.target.value })} />
                </div>
                <SelectField
                  label="Video model"
                  value={generationForm.videoModel}
                  options={["RUNWAYML", "VEO3.1I2V", "SEEDANCEI2V", "KLING3.0"]}
                  onChange={(videoModel) => setGenerationForm({ ...generationForm, videoModel: videoModel as VideoModel })}
                />
                <SelectField
                  label="Aspect ratio"
                  value={generationForm.aspectRatio}
                  options={["9:16", "16:9"]}
                  onChange={(aspectRatio) => setGenerationForm({ ...generationForm, aspectRatio: aspectRatio as "16:9" | "9:16" })}
                />
                <TextField label="Language" value={generationForm.language} onChange={(language) => setGenerationForm({ ...generationForm, language })} />
                <TextField label="CTA URL" value={generationForm.ctaUrl} onChange={(ctaUrl) => setGenerationForm({ ...generationForm, ctaUrl })} />
                <TextField label="Payment tx hash" value={generationForm.txHash} onChange={(txHash) => setGenerationForm({ ...generationForm, txHash })} full />
              </div>
              <div className="button-row">
                <button className="btn" onClick={createQuote} disabled={busy === "quote" || imageCount === 0}>
                  <CircleDollarSign size={16} /> Quote {imageCount} images
                </button>
                <button className="btn primary" onClick={runGeneration} disabled={busy === "generation" || imageCount === 0}>
                  <Play size={16} /> Run generation
                </button>
                {quote && <span className="badge ok">${quote.totalUsd.toFixed(2)} total</span>}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>Generation Queue</h2>
                <Boxes size={18} />
              </div>
              <div className="list">
                {store.generations.length === 0 && <p className="subtle">No generations yet.</p>}
                {store.generations.map((generation) => (
                  <GenerationItem key={generation.id} generation={generation} busy={busy === generation.id} onSync={() => syncGeneration(generation.id)} />
                ))}
              </div>
            </div>

            <div className="panel">
              <div className="panel-header">
                <h2>Minted INFTs</h2>
                <Bot size={18} />
              </div>
              <div className="list">
                {completedInfts.length === 0 && <p className="subtle">Completed generations will appear here after 0G persistence and minting.</p>}
                {completedInfts.map((inft) => (
                  <div className="item" key={inft.id}>
                    <div className="item-title">
                      <strong>{inft.title}</strong>
                      <a href={`/inft/${inft.id}`}><ExternalLink size={16} /></a>
                    </div>
                    <div className="mono">token #{inft.tokenId} · {inft.agentWalletAddress}</div>
                    <div className="subtle"><Link2 size={12} /> {inft.referrer.url}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

function GenerationItem({ generation, busy, onSync }: { generation: Generation; busy: boolean; onSync: () => void }) {
  const badgeClass = generation.status === "COMPLETED" ? "badge ok" : generation.status === "FAILED" ? "badge fail" : "badge";
  return (
    <div className="item">
      <div className="item-title">
        <strong>{generation.id}</strong>
        <span className={badgeClass}>{generation.status}</span>
      </div>
      <div className="subtle">{generation.input.image_urls.length} images · {generation.input.video_model} · ${generation.payment.amountUsd.toFixed(2)}</div>
      <div className="mono">{generation.samsarSessionId || "pending Samsar session"}</div>
      {generation.errorMessage && <p className="subtle">{generation.errorMessage}</p>}
      {generation.refund && <p className="subtle">Refund: ${generation.refund.amountUsd.toFixed(2)} · {generation.refund.status}</p>}
      <div className="button-row">
        <button className="btn" onClick={onSync} disabled={busy || generation.status === "COMPLETED"}>
          <RefreshCw size={16} /> Sync
        </button>
        {generation.inftId && <a className="btn" href={`/inft/${generation.inftId}`}><Bot size={16} /> Open INFT</a>}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  full = false
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  full?: boolean;
}) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => <option value={option} key={option}>{option}</option>)}
      </select>
    </div>
  );
}

async function assertOk(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function parseImageUrls(raw: string) {
  return raw
    .split(/\n|,/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function parseJsonObject(raw: string) {
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("metadata must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}
