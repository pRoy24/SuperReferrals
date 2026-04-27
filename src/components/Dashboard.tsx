"use client";

import {
  Bot,
  CircleDollarSign,
  Database,
  ExternalLink,
  KeyRound,
  Network,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Store,
  Undo2,
  Users,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getPaymentTokens, getTransactionChainConfig, settlementTokenForCurrency } from "@/lib/payment-tokens";
import {
  CREDIT_UNIT_USD,
  DEFAULT_CUSTOMER_MULTIPLIER,
  defaultModelPricingConfigurations,
  getCreditUnitUsd,
  getCustomerMultiplier,
  getModelPricingConfigurations,
  resolveModelPriceDetails
} from "@/lib/pricing";
import type { ModelPricingConfiguration, PaymentCurrencySymbol, SuperReferralsStore, VideoAspectRatio, VideoModel } from "@/lib/types";

const processorCreditAmounts = [10, 25, 50, 100];
const conditionModelOptions: VideoModel[] = ["RUNWAYML", "VEO3.1I2V", "SEEDANCEI2V", "KLING3.0"];
const conditionAspectOptions: VideoAspectRatio[] = ["9:16", "16:9"];

export default function Dashboard() {
  const [store, setStore] = useState<SuperReferralsStore | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [processorAmountUsd, setProcessorAmountUsd] = useState(25);
  const [agentObjective, setAgentObjective] = useState(
    "Let the Agent Town plan a referrer video workflow, price it, route settlement, and publish all 0G receipts."
  );
  const [agentPayload, setAgentPayload] = useState(JSON.stringify({
    image_urls: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
      "https://images.unsplash.com/photo-1460353581641-37baddab0fa2"
    ],
    video_model: "RUNWAYML",
    aspect_ratio: "9:16",
    prompt: "Create a short launch video with a crisp CTA outro."
  }, null, 2));
  const [customerForm, setCustomerForm] = useState({
    id: "cus_demo",
    name: "Demo Customer",
    ownerWallet: "0x1111111111111111111111111111111111111111",
    platformFeeBps: 500,
    refundOnFailureBps: 5000,
    customerMultiplier: DEFAULT_CUSTOMER_MULTIPLIER,
    creditUnitUsd: CREDIT_UNIT_USD,
    referrerBaseUrl: "http://localhost:3000",
    ensName: "demo.eth",
    storefrontDescription: "Product video storefront for SuperReferrals render tasks.",
    storefrontWebsiteUrl: "",
    storefrontSupportEmail: "",
    storefrontCategory: "Product videos",
    storefrontTags: "launch, product, referral",
    conditionalsEnabled: false,
    allowedModels: conditionModelOptions,
    allowedAspectRatios: conditionAspectOptions,
    maxImages: 6,
    modelConfigurations: defaultModelPricingConfigurations
  });

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
    if (!customer) return;
    setCustomerForm({
      id: customer.id,
      name: customer.name,
      ownerWallet: customer.ownerWallet,
      platformFeeBps: customer.pricing.platformFeeBps,
      refundOnFailureBps: customer.pricing.refundOnFailureBps,
      customerMultiplier: getCustomerMultiplier(customer),
      creditUnitUsd: getCreditUnitUsd(customer),
      referrerBaseUrl: customer.referrerBaseUrl,
      ensName: customer.ensName || "",
      storefrontDescription: customer.storefront?.description || "",
      storefrontWebsiteUrl: customer.storefront?.websiteUrl || "",
      storefrontSupportEmail: customer.storefront?.supportEmail || "",
      storefrontCategory: customer.storefront?.category || "",
      storefrontTags: customer.storefront?.tags?.join(", ") || "",
      conditionalsEnabled: customer.storefront?.conditions?.enabled || false,
      allowedModels: customer.storefront?.conditions?.allowedModels?.length
        ? customer.storefront.conditions.allowedModels
        : conditionModelOptions,
      allowedAspectRatios: customer.storefront?.conditions?.allowedAspectRatios?.length
        ? customer.storefront.conditions.allowedAspectRatios
        : conditionAspectOptions,
      maxImages: customer.storefront?.conditions?.maxImages || 6,
      modelConfigurations: getModelPricingConfigurations(customer)
    });
  }, [store]);

  const customer = store?.customers[0];
  const activeJobs = store?.generations.filter((item) => ["QUEUED", "PROCESSING"].includes(item.status)).length || 0;
  const completedJobs = store?.generations.filter((item) => item.status === "COMPLETED").length || 0;
  const agentJobs = store?.agentJobs || [];
  const latestAgentJob = agentJobs[0];
  const transactionChain = getTransactionChainConfig();
  const settlementToken = settlementTokenForCurrency("USDC", transactionChain.id) || getPaymentTokens(transactionChain.id)[0];
  const customerLanding = useMemo(() => {
    const seedAccount = customer
      ? store?.subAccounts.find((account) => account.customerId === customer.id)
      : null;
    return seedAccount ? `/r/${seedAccount.referrerCode}` : customer ? `/storefronts/${customer.id}` : "";
  }, [customer, store?.subAccounts]);

  function updatePricingRow(id: string, patch: Partial<ModelPricingConfiguration>) {
    setCustomerForm((current) => ({
      ...current,
      modelConfigurations: current.modelConfigurations.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      )
    }));
  }

  function toggleAllowedModel(model: VideoModel) {
    setCustomerForm((current) => ({
      ...current,
      allowedModels: current.allowedModels.includes(model)
        ? current.allowedModels.filter((item) => item !== model)
        : [...current.allowedModels, model]
    }));
  }

  function toggleAllowedAspectRatio(aspectRatio: VideoAspectRatio) {
    setCustomerForm((current) => ({
      ...current,
      allowedAspectRatios: current.allowedAspectRatios.includes(aspectRatio)
        ? current.allowedAspectRatios.filter((item) => item !== aspectRatio)
        : [...current.allowedAspectRatios, aspectRatio]
    }));
  }

  async function saveCustomer() {
    setBusy("customer");
    setMessage("");
    try {
      const enabledPricing = customerForm.modelConfigurations.find((item) => item.enabled) ||
        customerForm.modelConfigurations[0];
      const enabledDetails = resolveModelPriceDetails(
        { pricing: { customerMultiplier: customerForm.customerMultiplier, creditUnitUsd: customerForm.creditUnitUsd } },
        enabledPricing
      );
      const response = await fetch("/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: customerForm.id,
          name: customerForm.name,
          ownerWallet: customerForm.ownerWallet,
          referrerBaseUrl: customerForm.referrerBaseUrl,
          ensName: customerForm.ensName,
          storefront: {
            description: customerForm.storefrontDescription,
            websiteUrl: customerForm.storefrontWebsiteUrl,
            supportEmail: customerForm.storefrontSupportEmail,
            category: customerForm.storefrontCategory,
            tags: customerForm.storefrontTags,
            conditions: {
              enabled: customerForm.conditionalsEnabled,
              allowedModels: customerForm.allowedModels,
              allowedAspectRatios: customerForm.allowedAspectRatios,
              maxImages: Number(customerForm.maxImages) || undefined
            }
          },
          pricing: {
            currency: "USDC" as PaymentCurrencySymbol,
            pricePerImageUsd: Number(enabledDetails.pricePerSecondUsd * (enabledPricing?.maxSecondsPerImage || 1)),
            pricePerSecondUsd: enabledDetails.pricePerSecondUsd,
            customerMultiplier: Number(customerForm.customerMultiplier) || DEFAULT_CUSTOMER_MULTIPLIER,
            creditUnitUsd: Number(customerForm.creditUnitUsd) || CREDIT_UNIT_USD,
            modelConfigurations: customerForm.modelConfigurations.map((item) => ({
              ...item,
              baseCreditsPerSecond: Number(item.baseCreditsPerSecond) || 0,
              maxSecondsPerImage: Number(item.maxSecondsPerImage) || 0,
              basePricePerSecondUsd: Number(item.baseCreditsPerSecond || 0) * Number(customerForm.creditUnitUsd || CREDIT_UNIT_USD),
              customPricePerSecondUsd: Number(item.customPricePerSecondUsd) > 0 ? Number(item.customPricePerSecondUsd) : undefined,
              enabled: item.enabled !== false
            })),
            platformFeeBps: Number(customerForm.platformFeeBps),
            refundOnFailureBps: Number(customerForm.refundOnFailureBps),
            chainId: settlementToken.chainId,
            settlementTokenAddress: settlementToken.address
          },
          subscription: { status: "active" }
        })
      });
      await assertOk(response);
      await load();
      setMessage("Customer store configuration saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    } finally {
      setBusy("");
    }
  }

  async function addProcessorCredits(amountUsd = processorAmountUsd) {
    const parsedAmountUsd = Number(amountUsd);
    if (!Number.isFinite(parsedAmountUsd) || parsedAmountUsd <= 0) {
      setMessage("Enter a valid dollar amount for processor credits.");
      return;
    }

    setBusy("processor-credits");
    setMessage("");
    try {
      const response = await fetch("/api/processor/credits/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents: Math.round(parsedAmountUsd * 100),
          metadata: {
            superreferralsCustomerId: customer?.id || customerForm.id,
            superreferralsCustomerName: customer?.name || customerForm.name
          }
        })
      });
      const data = await assertOk(response);
      if (!data.checkout?.url) {
        throw new Error("Processor checkout did not return a URL");
      }
      window.location.href = data.checkout.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start processor checkout");
    } finally {
      setBusy("");
    }
  }

  async function runAgentTown() {
    setBusy("agent-town");
    setMessage("");
    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer?.id || customerForm.id,
          objective: agentObjective,
          payload: parseJsonObject(agentPayload)
        })
      });
      const data = await assertOk(response);
      await load();
      setMessage(`Agent Town job ${data.job?.id || ""} completed with full 0G receipts.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent Town run failed");
    } finally {
      setBusy("");
    }
  }

  async function rollbackAgentJob(id: string) {
    setBusy(`rollback-${id}`);
    setMessage("");
    try {
      const response = await fetch(`/api/agents/${id}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Operator requested rollback from customer console" })
      });
      await assertOk(response);
      await load();
      setMessage(`Agent job ${id} rollback recorded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rollback failed");
    } finally {
      setBusy("");
    }
  }

  if (!store) {
    return <main className="main loading-main">Loading SuperReferrals customer console...</main>;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={18} /></span>
          SuperReferrals
        </div>
        <p className="sidebar-copy">
          Customer console for Samsar Processor credits, store setup, per-second USDC pricing, and render operations.
        </p>
        <nav className="nav-list">
          <a className="nav-item" href="#processor-credits"><CircleDollarSign size={16} /> Processor credits</a>
          <a className="nav-item" href="#store-setup"><KeyRound size={16} /> Store setup</a>
          <a className="nav-item" href="#usdc-pricing"><ShieldCheck size={16} /> USDC pricing</a>
          <a className="nav-item" href="#render-history"><Bot size={16} /> Render history</a>
          <a className="nav-item" href="#agent-town"><Network size={16} /> Agent Town</a>
          <a className="nav-item" href="/storefronts"><Store size={16} /> Storefront directory</a>
        </nav>
      </aside>

      <main className="main">
        <div className="topbar hero-band">
          <div>
            <div className="eyebrow">Customer Console</div>
            <h1>Configure your customer store</h1>
            <p className="subtle">
              Register or top up your Samsar One processor account, set public per-second render prices in USDC, and share your customer landing page.
            </p>
          </div>
          <button className="btn" onClick={() => load()} title="Refresh data">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>

        {message && <p className="notice">{message}</p>}

        <section className="stat-row">
          <div className="stat"><strong>{store.subAccounts.length}</strong><span className="subtle">wallet users</span></div>
          <div className="stat"><strong>{store.generations.length}</strong><span className="subtle">render tasks</span></div>
          <div className="stat"><strong>{activeJobs}</strong><span className="subtle">active jobs</span></div>
          <div className="stat"><strong>{completedJobs}</strong><span className="subtle">completed jobs</span></div>
          <div className="stat"><strong>{store.agents.length}</strong><span className="subtle">agent citizens</span></div>
          <div className="stat"><strong>{agentJobs.length}</strong><span className="subtle">agent jobs</span></div>
        </section>

        <div className="grid">
          <section className="stack">
            <div className="panel panel-strong" id="processor-credits">
              <div className="panel-header">
                <h2>Samsar Processor Credits</h2>
                <CircleDollarSign size={18} />
              </div>
              <div className="amount-grid">
                {processorCreditAmounts.map((amount) => (
                  <button
                    className={`amount-choice ${processorAmountUsd === amount ? "active" : ""}`}
                    key={amount}
                    onClick={() => setProcessorAmountUsd(amount)}
                  >
                    <span>${amount}</span>
                    <strong>{amount * 100} credits</strong>
                  </button>
                ))}
              </div>
              <div className="form-grid processor-checkout">
                <TextField
                  label="Custom amount USD"
                  type="number"
                  value={processorAmountUsd}
                  onChange={(amount) => setProcessorAmountUsd(Number(amount))}
                />
                <div className="field">
                  <label>Credits after payment</label>
                  <div className="readonly-value">{Math.max(0, Math.round(Number(processorAmountUsd || 0) * 100))}</div>
                </div>
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={() => addProcessorCredits()} disabled={busy === "processor-credits"}>
                  <CircleDollarSign size={16} /> Add
                </button>
              </div>
            </div>

            <div className="panel" id="store-setup">
              <div className="panel-header">
                <h2>Store Setup</h2>
                <KeyRound size={18} />
              </div>
              <div className="form-grid">
                <TextField label="Store name" value={customerForm.name} onChange={(name) => setCustomerForm({ ...customerForm, name })} />
                <TextField label="Owner wallet" value={customerForm.ownerWallet} onChange={(ownerWallet) => setCustomerForm({ ...customerForm, ownerWallet })} />
                <TextField label="Platform fee bps" type="number" value={customerForm.platformFeeBps} onChange={(platformFeeBps) => setCustomerForm({ ...customerForm, platformFeeBps: Number(platformFeeBps) })} />
                <TextField label="Failure refund bps" type="number" value={customerForm.refundOnFailureBps} onChange={(refundOnFailureBps) => setCustomerForm({ ...customerForm, refundOnFailureBps: Number(refundOnFailureBps) })} />
                <TextField label="ENS name" value={customerForm.ensName} onChange={(ensName) => setCustomerForm({ ...customerForm, ensName })} />
                <TextField label="Referrer base URL" value={customerForm.referrerBaseUrl} onChange={(referrerBaseUrl) => setCustomerForm({ ...customerForm, referrerBaseUrl })} full />
                <TextField label="Storefront category" value={customerForm.storefrontCategory} onChange={(storefrontCategory) => setCustomerForm({ ...customerForm, storefrontCategory })} />
                <TextField label="Storefront website URL" value={customerForm.storefrontWebsiteUrl} onChange={(storefrontWebsiteUrl) => setCustomerForm({ ...customerForm, storefrontWebsiteUrl })} />
                <TextField label="Support email" value={customerForm.storefrontSupportEmail} onChange={(storefrontSupportEmail) => setCustomerForm({ ...customerForm, storefrontSupportEmail })} />
                <TextField label="Storefront tags" value={customerForm.storefrontTags} onChange={(storefrontTags) => setCustomerForm({ ...customerForm, storefrontTags })} />
                <div className="field full">
                  <label>Storefront description</label>
                  <textarea value={customerForm.storefrontDescription} onChange={(event) => setCustomerForm({ ...customerForm, storefrontDescription: event.target.value })} />
                </div>
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={saveCustomer} disabled={busy === "customer"}>
                  <Save size={16} /> Save setup
                </button>
                {customerLanding && <a className="btn" href={customerLanding}><ExternalLink size={16} /> Open user landing</a>}
                <a className="btn" href="/storefronts"><Store size={16} /> Directory</a>
              </div>
            </div>
          </section>

          <section className="stack">
            <div className="panel panel-strong" id="usdc-pricing">
              <div className="panel-header">
                <h2>Public Render Pricing</h2>
                <Database size={18} />
              </div>
              <div className="form-grid">
                <TextField
                  label="Global user multiplier"
                  type="number"
                  value={customerForm.customerMultiplier}
                  onChange={(customerMultiplier) => setCustomerForm({ ...customerForm, customerMultiplier: Number(customerMultiplier) })}
                />
                <div className="field">
                  <label>Processor credit value</label>
                  <div className="readonly-value">{customerForm.creditUnitUsd.toFixed(3)} USDC / credit</div>
                </div>
              </div>

              <div className="render-conditions-editor">
                <div className="item-title">
                  <div>
                    <strong>Storefront render conditions</strong>
                    <p className="subtle">Restrict which render choices are available on this storefront route.</p>
                  </div>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={customerForm.conditionalsEnabled}
                      onChange={(event) => setCustomerForm({ ...customerForm, conditionalsEnabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
                {customerForm.conditionalsEnabled && (
                  <div className="conditions-editor-grid">
                    <div className="field full">
                      <label>Enabled models</label>
                      <div className="condition-chip-grid">
                        {conditionModelOptions.map((model) => (
                          <label className="toggle-chip" key={model}>
                            <input
                              type="checkbox"
                              checked={customerForm.allowedModels.includes(model)}
                              onChange={() => toggleAllowedModel(model)}
                            />
                            {model}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <label>Enabled aspect ratios</label>
                      <div className="condition-chip-grid compact">
                        {conditionAspectOptions.map((aspectRatio) => (
                          <label className="toggle-chip" key={aspectRatio}>
                            <input
                              type="checkbox"
                              checked={customerForm.allowedAspectRatios.includes(aspectRatio)}
                              onChange={() => toggleAllowedAspectRatio(aspectRatio)}
                            />
                            {aspectRatio}
                          </label>
                        ))}
                      </div>
                    </div>
                    <TextField
                      label="Max images per render"
                      type="number"
                      value={customerForm.maxImages}
                      onChange={(maxImages) => setCustomerForm({ ...customerForm, maxImages: Number(maxImages) })}
                    />
                  </div>
                )}
              </div>

              <div className="pricing-table">
                {customerForm.modelConfigurations.map((config) => {
                  const details = resolveModelPriceDetails(
                    { pricing: { customerMultiplier: customerForm.customerMultiplier, creditUnitUsd: customerForm.creditUnitUsd } },
                    config
                  );
                  return (
                    <div className="pricing-row" key={config.id}>
                      <div>
                        <strong>{config.label}</strong>
                        <p className="subtle">{config.videoModel} · {config.aspectRatio} · up to {config.maxSecondsPerImage}s/image</p>
                      </div>
                      <div className="readonly-value pricing-readonly">
                        <span>{details.baseCreditsPerSecond}</span>
                        <small>credits/sec</small>
                      </div>
                      <div className="readonly-value pricing-readonly">
                        <span>{details.basePricePerSecondUsd.toFixed(2)}</span>
                        <small>base USDC/sec</small>
                      </div>
                      <TextField
                        label="Custom USDC/sec"
                        type="number"
                        value={config.customPricePerSecondUsd ?? ""}
                        onChange={(customPricePerSecondUsd) => {
                          const parsed = Number(customPricePerSecondUsd);
                          updatePricingRow(config.id, {
                            customPricePerSecondUsd: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
                          });
                        }}
                      />
                      <div className="readonly-value pricing-readonly">
                        <span>{details.pricePerSecondUsd.toFixed(2)}</span>
                        <small>user USDC/sec</small>
                      </div>
                      <label className="toggle-row">
                        <input
                          type="checkbox"
                          checked={config.enabled}
                          onChange={(event) => updatePricingRow(config.id, { enabled: event.target.checked })}
                        />
                        Enabled
                      </label>
                    </div>
                  );
                })}
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={saveCustomer} disabled={busy === "customer"}>
                  <Save size={16} /> Save pricing
                </button>
                <button
                  className="btn"
                  onClick={() => setCustomerForm({
                    ...customerForm,
                    modelConfigurations: customerForm.modelConfigurations.map((item) => ({
                      ...item,
                      customPricePerSecondUsd: undefined
                    }))
                  })}
                >
                  Clear model overrides
                </button>
              </div>
            </div>

            <div className="panel" id="render-history">
              <div className="panel-header">
                <h2>Recent Render Tasks</h2>
                <Bot size={18} />
              </div>
              <div className="list">
                {store.generations.length === 0 && <p className="subtle">No render tasks yet.</p>}
                {store.generations.slice(0, 8).map((generation) => (
                  <div className="item" key={generation.id}>
                    <div className="item-title">
                      <strong>{generation.id}</strong>
                      <span className={generation.status === "COMPLETED" ? "badge ok" : generation.status === "FAILED" ? "badge fail" : "badge"}>{generation.status}</span>
                    </div>
                    <p className="subtle">
                      {generation.input.image_urls.length} images · {generation.input.video_model} · {generation.input.aspect_ratio} · {generation.payment.amountUsd.toFixed(2)} USDC
                    </p>
                    {generation.inftId && <a className="btn" href={`/inft/${generation.inftId}`}><ExternalLink size={16} /> Open INFT</a>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>

        <section className="panel agent-town-panel" id="agent-town">
          <div className="panel-header">
            <div>
              <h2>Agent Town</h2>
              <p className="subtle">
                Multi-agent sandbox for 0G Chain, Storage, DA, Compute, service discovery, Samsar actions, Uniswap price signals, KeeperHub settlement, and Gensyn AXL chatter.
              </p>
            </div>
            <Network size={20} />
          </div>

          <div className="form-grid">
            <div className="field full">
              <label>Agent objective</label>
              <textarea value={agentObjective} onChange={(event) => setAgentObjective(event.target.value)} />
            </div>
            <div className="field full">
              <label>Agent payload JSON</label>
              <textarea value={agentPayload} onChange={(event) => setAgentPayload(event.target.value)} />
            </div>
          </div>
          <div className="button-row">
            <button className="btn primary" onClick={runAgentTown} disabled={busy === "agent-town"}>
              <Zap size={16} /> Run Agent Town
            </button>
            <button className="btn" onClick={() => load()} title="Refresh agents">
              <RefreshCw size={16} /> Refresh agents
            </button>
            {latestAgentJob && (
              <button className="btn warn" onClick={() => rollbackAgentJob(latestAgentJob.id)} disabled={busy === `rollback-${latestAgentJob.id}`}>
                <Undo2 size={16} /> Roll back latest
              </button>
            )}
          </div>

          <div className="agent-town-grid">
            <div>
              <div className="section-title">
                <Users size={16} />
                <h3>Agents</h3>
              </div>
              <div className="list">
                {store.agents.map((agent) => (
                  <div className="item" key={agent.id}>
                    <div className="item-title">
                      <strong>{agent.name}</strong>
                      <span className="badge ok">{agent.role}</span>
                    </div>
                    <p className="subtle">{agent.personality}</p>
                    <p className="mono">{agent.axlPeerId}</p>
                    <p className="mono">{agent.walletAddress}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="section-title">
                <Database size={16} />
                <h3>0G Receipts</h3>
              </div>
              <div className="list">
                {!latestAgentJob && <p className="subtle">Run Agent Town to generate pillar receipts.</p>}
                {latestAgentJob?.receipts.map((receipt) => (
                  <div className="item" key={`${latestAgentJob.id}-${receipt.pillar}`}>
                    <div className="item-title">
                      <strong>{receipt.label}</strong>
                      <span className="badge">{receipt.pillar}</span>
                    </div>
                    <p className="subtle">{receipt.detail}</p>
                    <p className="mono">{receipt.rootHash || receipt.txHash || receipt.uri}</p>
                  </div>
                ))}
                {latestAgentJob?.priceSignal && (
                  <div className="item">
                    <div className="item-title">
                      <strong>Uniswap price signal</strong>
                      <span className="badge ok">{latestAgentJob.priceSignal.confidence.toFixed(2)}</span>
                    </div>
                    <p className="subtle">
                      {latestAgentJob.priceSignal.chargeUsd.toFixed(2)} {latestAgentJob.priceSignal.settlementToken} charged from {latestAgentJob.priceSignal.paymentToken}.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="section-title">
                <Radio size={16} />
                <h3>AXL Timeline</h3>
              </div>
              <div className="list">
                {store.agentTownEvents.length === 0 && <p className="subtle">No agent events yet.</p>}
                {store.agentTownEvents.slice(0, 8).map((event) => {
                  const fromAgent = store.agents.find((agent) => agent.id === event.fromAgentId);
                  const toAgent = store.agents.find((agent) => agent.id === event.toAgentId);
                  return (
                    <div className="item" key={event.id}>
                      <div className="item-title">
                        <strong>{fromAgent?.name || event.fromAgentId}</strong>
                        <span className="badge">{event.channel}</span>
                      </div>
                      <p className="subtle">
                        {toAgent ? `to ${toAgent.name}: ` : ""}{event.content}
                      </p>
                      {event.axlMessageId && <p className="mono">{event.axlMessageId}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>
      </main>
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

async function assertOk(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid JSON payload");
  }
}
