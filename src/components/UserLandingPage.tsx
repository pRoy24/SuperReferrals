"use client";

import { Bot, CircleDollarSign, ExternalLink, Play, RefreshCw, ShieldCheck, Sparkles, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  findPaymentToken,
  getPaymentTokens,
  getTransactionChainConfig,
  normalizeTransactionChainIdForEnvironment,
  settlementTokenForCurrency,
  type PaymentToken,
  type TransactionChainConfig
} from "@/lib/payment-tokens";
import { estimateDurationSeconds, getModelPricingConfigurations, resolveModelPriceDetails } from "@/lib/pricing";
import type {
  Customer,
  Generation,
  GenerationInput,
  ModelPricingConfiguration,
  PaymentCurrencySymbol,
  PaymentQuote,
  PaymentRail,
  SubAccount,
  SuperReferralsStore,
  VideoAspectRatio,
  VideoModel
} from "@/lib/types";

type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

type GenerationFormState = {
  imageUrls: string;
  metadata: string;
  prompt: string;
  videoModel: VideoModel;
  aspectRatio: VideoAspectRatio;
  language: string;
  addOutroAnimation: boolean;
  addOutroFocusArea: boolean;
  outroFocusArea: string;
  ctaUrl: string;
  ctaTextTop: string;
  ctaTextBottom: string;
  ctaLogo: string;
  addFooterAnimation: boolean;
  footerMetadata: string;
  publishToFeed: boolean;
  feedTags: string;
  txHash: string;
};

type RenderFlowState = {
  status: "idle" | "payment" | "confirming" | "starting" | "started" | "completed" | "failed";
  message: string;
  txHash?: string;
  generationId?: string;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

const sampleImageUrlBases = new Set([
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
  "https://images.unsplash.com/photo-1460353581641-37baddab0fa2",
  "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77"
]);

const starterImages = [
  {
    image_url: "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
    title: "Launch Shoe",
    image_text: "Lightweight daily trainer",
    skip_enhancement: true
  },
  {
    image_url: "https://images.unsplash.com/photo-1460353581641-37baddab0fa2",
    title: "Lifestyle Bundle",
    image_text: "Built for movement",
    skip_enhancement: true
  },
  {
    image_url: "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77",
    title: "Limited Offer",
    image_text: "Available this week",
    skip_enhancement: true
  }
];

const starterImageMetadata = JSON.stringify(starterImages, null, 2);

const starterFooterMetadata = JSON.stringify([
  { url: "https://unsplash.com/s/photos/running-shoes", title: "Launch Shoe" },
  { url: "https://unsplash.com/s/photos/sneakers", title: "Lifestyle Bundle" },
  { url: "https://unsplash.com/s/photos/product-shoes", title: "Limited Offer" }
], null, 2);

const defaultOutroFocusArea = JSON.stringify({ x: 680, y: 296, width: 432, height: 432 }, null, 2);

export default function UserLandingPage({ referrerCode }: { referrerCode: string }) {
  const [store, setStore] = useState<SuperReferralsStore | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [profileForm, setProfileForm] = useState({
    email: "",
    username: ""
  });
  const [generationForm, setGenerationForm] = useState<GenerationFormState>({
    imageUrls: starterImageMetadata,
    metadata: JSON.stringify({ title: "New launch", campaign: "customer-store" }, null, 2),
    prompt: "Create a concise product marketing video with clean motion and a strong final call to action.",
    videoModel: "RUNWAYML" as VideoModel,
    aspectRatio: "9:16" as VideoAspectRatio,
    language: "en",
    addOutroAnimation: true,
    addOutroFocusArea: true,
    outroFocusArea: defaultOutroFocusArea,
    ctaUrl: "https://unsplash.com/s/photos/running-shoes",
    ctaTextTop: "Scan to buy",
    ctaTextBottom: "Limited availability",
    ctaLogo: "",
    addFooterAnimation: true,
    footerMetadata: starterFooterMetadata,
    publishToFeed: true,
    feedTags: "launch, product, referrer",
    txHash: ""
  });
  const [paymentCurrency, setPaymentCurrency] = useState<PaymentCurrencySymbol>("ETH");
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [autoPolling, setAutoPolling] = useState(false);
  const [renderFlow, setRenderFlow] = useState<RenderFlowState>({ status: "idle", message: "" });

  async function load() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const data = await response.json();
    setStore(data);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  const routeAccount = useMemo(
    () => store?.subAccounts.find((account) => account.referrerCode === referrerCode),
    [store, referrerCode]
  );
  const customer = useMemo(() => {
    if (!store) return null;
    return routeAccount
      ? store.customers.find((item) => item.id === routeAccount.customerId) || store.customers[0]
      : store.customers[0];
  }, [store, routeAccount]);
  const pricingOptions = useMemo(
    () => getModelPricingConfigurations(customer).filter((item) => item.enabled !== false),
    [customer]
  );
  const selectedPricing = pricingOptions.find((item) =>
    item.videoModel === generationForm.videoModel &&
    item.aspectRatio === generationForm.aspectRatio
  ) || pricingOptions[0];
  const connectedSubAccount = useMemo(
    () => store?.subAccounts.find((account) =>
      customer &&
      account.customerId === customer.id &&
      sameWallet(account.wallet, walletAddress)
    ),
    [store, customer, walletAddress]
  );
  const imageCount = countImageInputs(generationForm.imageUrls);
  const selectedPricingDetails = resolveModelPriceDetails(customer, selectedPricing);
  const estimatedDurationSeconds = estimateDurationSeconds(imageCount, selectedPricing);
  const userGenerations = connectedSubAccount
    ? store?.generations.filter((generation) => generation.subAccountId === connectedSubAccount.id) || []
    : [];
  const trackedGeneration = renderFlow.generationId
    ? userGenerations.find((generation) => generation.id === renderFlow.generationId)
    : undefined;
  const pollingGenerationIds = useMemo(
    () => userGenerations
      .filter((generation) => ["QUEUED", "PROCESSING", "PAYMENT_CONFIRMED"].includes(generation.status))
      .map((generation) => generation.id),
    [userGenerations]
  );
  const pollingKey = pollingGenerationIds.join("|");
  const sessionStorageKey = useMemo(() => `superreferrals:user-session:${referrerCode}`, [referrerCode]);
  const transactionChain = useMemo(
    () => getTransactionChainConfig(normalizeTransactionChainIdForEnvironment(customer?.pricing.chainId)),
    [customer?.pricing.chainId]
  );
  const paymentTokens = useMemo(() => getPaymentTokens(transactionChain.id), [transactionChain.id]);
  const selectedPaymentToken = paymentTokens.find((token) => token.symbol === paymentCurrency) || paymentTokens[0]!;
  const settlementToken =
    findPaymentToken(customer?.pricing.settlementTokenAddress || "", transactionChain.id) ||
    settlementTokenForCurrency(customer?.pricing.currency || "USDC", transactionChain.id) ||
    selectedPaymentToken;
  const paymentRail = useMemo(
    () => resolveUserPaymentRail(selectedPaymentToken, settlementToken),
    [selectedPaymentToken, settlementToken]
  );
  const hasWalletAddress = Boolean(walletAddress.trim());
  const generationPayloadPreview = useMemo(
    () => previewGenerationPayload(generationForm, connectedSubAccount?.referrerCode || referrerCode),
    [generationForm, connectedSubAccount?.referrerCode, referrerCode]
  );

  useEffect(() => {
    if (!selectedPricing) return;
    if (
      selectedPricing.videoModel !== generationForm.videoModel ||
      selectedPricing.aspectRatio !== generationForm.aspectRatio
    ) {
      setGenerationForm((current) => ({
        ...current,
        videoModel: selectedPricing.videoModel,
        aspectRatio: selectedPricing.aspectRatio
      }));
    }
  }, [selectedPricing, generationForm.videoModel, generationForm.aspectRatio]);

  useEffect(() => {
    setQuote(null);
  }, [generationForm.imageUrls, generationForm.videoModel, generationForm.aspectRatio, paymentCurrency, transactionChain.id]);

  useEffect(() => {
    const firstToken = paymentTokens[0];
    if (firstToken && !paymentTokens.some((token) => token.symbol === paymentCurrency)) {
      setPaymentCurrency(firstToken.symbol);
    }
  }, [paymentCurrency, paymentTokens]);

  useEffect(() => {
    const rawSession = window.localStorage.getItem(sessionStorageKey);
    if (!rawSession) {
      window.ethereum?.request({ method: "eth_accounts" })
        .then((accounts) => {
          const firstAccount = Array.isArray(accounts) ? String(accounts[0] || "") : "";
          if (firstAccount) {
            setWalletAddress(firstAccount);
            setProfileForm((current) => ({
              ...current,
              username: current.username || `wallet-${shortWallet(firstAccount)}`
            }));
          }
        })
        .catch(() => undefined);
      return;
    }
    try {
      const session = JSON.parse(rawSession) as { walletAddress?: string; email?: string; username?: string };
      if (session.walletAddress) {
        setWalletAddress(session.walletAddress);
      }
      setProfileForm((current) => ({
        email: session.email || current.email,
        username: session.username || current.username
      }));
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, [sessionStorageKey]);

  useEffect(() => {
    if (!walletAddress.trim()) {
      return;
    }
    window.localStorage.setItem(sessionStorageKey, JSON.stringify({
      walletAddress,
      email: profileForm.email,
      username: profileForm.username
    }));
  }, [walletAddress, profileForm.email, profileForm.username, sessionStorageKey]);

  useEffect(() => {
    if (!pollingKey) {
      return;
    }
    let cancelled = false;

    async function pollActiveGenerations() {
      setAutoPolling(true);
      try {
        await Promise.all(pollingGenerationIds.map((id) =>
          fetch(`/api/generations/${id}/sync`, { method: "POST" }).catch(() => null)
        ));
        if (!cancelled) {
          await load();
        }
      } finally {
        if (!cancelled) {
          setAutoPolling(false);
        }
      }
    }

    pollActiveGenerations().catch(() => undefined);
    const interval = window.setInterval(() => {
      pollActiveGenerations().catch(() => undefined);
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollingKey]);

  useEffect(() => {
    if (!trackedGeneration || !renderFlow.generationId) {
      return;
    }
    if (trackedGeneration.status === "COMPLETED" && renderFlow.status !== "completed") {
      updateRenderFlow({
        status: "completed",
        message: `Render task ${trackedGeneration.id} finished and was persisted${trackedGeneration.storage?.video?.uri ? " to 0G storage" : ""}.`,
        txHash: trackedGeneration.payment.txHash,
        generationId: trackedGeneration.id
      });
    }
    if (trackedGeneration.status === "FAILED" && renderFlow.status !== "failed") {
      updateRenderFlow({
        status: "failed",
        message: trackedGeneration.errorMessage
          ? `Render task ${trackedGeneration.id} failed: ${trackedGeneration.errorMessage}`
          : `Render task ${trackedGeneration.id} failed.`,
        txHash: trackedGeneration.payment.txHash,
        generationId: trackedGeneration.id
      });
    }
  }, [trackedGeneration?.status, trackedGeneration?.updatedAt, renderFlow.generationId, renderFlow.status]);

  async function connectWallet() {
    setBusy("wallet");
    setMessage("");
    try {
      if (!window.ethereum) {
        setMessage("No injected wallet detected. Open this page in a wallet-enabled browser or enter a wallet address to continue in mock mode.");
        return;
      }
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const firstAccount = Array.isArray(accounts) ? String(accounts[0] || "") : "";
      if (!firstAccount) {
        throw new Error("Wallet did not return an account");
      }
      await ensureWalletNetwork(window.ethereum, transactionChain);
      const nextProfile = {
        ...profileForm,
        username: profileForm.username || `wallet-${shortWallet(firstAccount)}`
      };
      setWalletAddress(firstAccount);
      setProfileForm(nextProfile);
      const account = await ensureWalletSubAccount(firstAccount, nextProfile);
      const registration = account.blockchainRegistration;
      setMessage(
        registration
          ? `Wallet connected on ${transactionChain.name}. 0G profile ${shortHash(registration.profileId)} is ready on ${registration.chainName}.`
          : `Wallet connected on ${transactionChain.name}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed");
    } finally {
      setBusy("");
    }
  }

  async function ensureWalletSubAccount(
    walletOverride = walletAddress,
    profileOverride = profileForm
  ) {
    if (!customer) {
      throw new Error("Customer store is not available");
    }
    const effectiveWallet = walletOverride.trim();
    if (!effectiveWallet) {
      throw new Error("Connect or enter a wallet address first");
    }
    const existingAccount = store?.subAccounts.find((account) =>
      account.customerId === customer.id &&
      sameWallet(account.wallet, effectiveWallet)
    );
    if (existingAccount?.externalApiKey && existingAccount.blockchainRegistration) {
      return existingAccount;
    }

    const response = await fetch("/api/subaccounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        wallet: effectiveWallet,
        email: profileOverride.email || undefined,
        username: profileOverride.username || `wallet-${shortWallet(effectiveWallet)}`
      })
    });
    const data = await assertOk(response);
    await load();
    return data.account as SubAccount;
  }

  async function requestQuote(account: SubAccount) {
    if (!customer) {
      throw new Error("Customer store is not available");
    }
    const response = await fetch("/api/payments/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        subAccountId: account.id,
        imageCount,
        durationSeconds: estimatedDurationSeconds,
        videoModel: generationForm.videoModel,
        aspectRatio: generationForm.aspectRatio,
        tokenIn: selectedPaymentToken.address,
        tokenOut: settlementToken.address,
        paymentCurrency: selectedPaymentToken.symbol,
        settlementCurrency: settlementToken.symbol,
        paymentRail,
        swapper: account.wallet,
        chainId: transactionChain.id
      })
    });
    const data = await assertOk(response);
    setQuote(data.quote);
    await load();
    return data.quote as PaymentQuote;
  }

  async function createQuote() {
    setBusy("quote");
    setMessage("");
    try {
      const account = await ensureWalletSubAccount();
      const quoted = await requestQuote(account);
      setMessage(`${quoted.totalUsd.toFixed(2)} ${quoted.settlementCurrency || "USDC"} quote created for payment in ${quoted.paymentCurrency || paymentCurrency} on ${transactionChain.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote failed");
    } finally {
      setBusy("");
    }
  }

  function updateRenderFlow(next: RenderFlowState) {
    setRenderFlow(next);
    setMessage(next.message);
  }

  async function executePaymentForRender(activeQuote: PaymentQuote, account: SubAccount) {
    const manualTxHash = generationForm.txHash.trim();
    if (manualTxHash) {
      return manualTxHash;
    }
    if (!customer) {
      throw new Error("Customer store is not available");
    }
    if (!window.ethereum) {
      throw new Error("A wallet transaction is required before rendering. Open this page in a wallet-enabled browser or paste an existing payment transaction hash.");
    }
    if (!activeQuote.settlementAmountAtomic) {
      throw new Error("Quote did not include a settlement amount.");
    }

    await ensureWalletNetwork(window.ethereum, transactionChain);
    const paymentToken = findPaymentToken(activeQuote.paymentTokenAddress || "", transactionChain.id) || selectedPaymentToken;
    const activeSettlementToken =
      findPaymentToken(activeQuote.settlementTokenAddress || "", transactionChain.id) || settlementToken;
    const sameToken = paymentToken.address.toLowerCase() === activeSettlementToken.address.toLowerCase();
    const paymentAmountAtomic = activeQuote.paymentAmountAtomic || activeQuote.settlementAmountAtomic;
    const paymentRecipient = activeQuote.paymentRecipientAddress || customer.ownerWallet;

    if (activeQuote.paymentRail === "uniswap" && !sameToken) {
      updateRenderFlow({ status: "payment", message: "Requesting Uniswap swap transaction from the wallet." });
      const swapTxHash = await requestUniswapSwap(window.ethereum, activeQuote, account.wallet, transactionChain.name);
      updateRenderFlow({
        status: "confirming",
        message: `Swap ${shortHash(swapTxHash)} submitted. Waiting for settlement tokens before transfer.`,
        txHash: swapTxHash
      });
      const swapReceipt = await waitForWalletReceipt(window.ethereum, swapTxHash, 120000);
      if (!swapReceipt) {
        throw new Error("Timed out waiting for the swap transaction to mine. Paste the final settlement transfer hash after the wallet confirms.");
      }
      if (!isSuccessfulReceipt(swapReceipt)) {
        throw new Error("Swap transaction reverted; render was not started.");
      }
      updateRenderFlow({ status: "payment", message: "Swap mined. Requesting settlement transfer.", txHash: swapTxHash });
      const settlementTxHash = await requestTokenTransfer({
        provider: window.ethereum,
        from: account.wallet,
        token: activeSettlementToken,
        recipient: customer.ownerWallet,
        amountAtomic: activeQuote.settlementAmountAtomic,
        label: "Settlement transfer",
        chainName: transactionChain.name
      });
      updateRenderFlow({
        status: "confirming",
        message: `Settlement transfer ${shortHash(settlementTxHash)} submitted. Waiting for confirmation.`,
        txHash: settlementTxHash
      });
      const settlementReceipt = await waitForWalletReceipt(window.ethereum, settlementTxHash, 120000);
      if (!settlementReceipt) {
        throw new Error("Timed out waiting for the settlement transfer to mine. Paste the transfer hash once it confirms.");
      }
      if (!isSuccessfulReceipt(settlementReceipt)) {
        throw new Error("Settlement transfer reverted; render was not started.");
      }
      return settlementTxHash;
    }

    if (activeQuote.paymentRail === "keeperhub" && !sameToken) {
      updateRenderFlow({
        status: "payment",
        message: `Requesting ${paymentToken.symbol} payment for KeeperHub ${activeSettlementToken.symbol} settlement.`
      });
      const keeperPaymentTxHash = await requestTokenTransfer({
        provider: window.ethereum,
        from: account.wallet,
        token: paymentToken,
        recipient: paymentRecipient,
        amountAtomic: paymentAmountAtomic,
        label: "KeeperHub payment",
        chainName: transactionChain.name
      });
      updateRenderFlow({
        status: "confirming",
        message: `KeeperHub payment ${shortHash(keeperPaymentTxHash)} submitted. Waiting for confirmation before starting render.`,
        txHash: keeperPaymentTxHash
      });
      const keeperPaymentReceipt = await waitForWalletReceipt(window.ethereum, keeperPaymentTxHash, 120000);
      if (!keeperPaymentReceipt) {
        throw new Error("Timed out waiting for the KeeperHub payment to mine. Paste the payment transaction hash once it confirms.");
      }
      if (!isSuccessfulReceipt(keeperPaymentReceipt)) {
        throw new Error("KeeperHub payment reverted; render was not started.");
      }
      return keeperPaymentTxHash;
    }

    if (!sameToken) {
      throw new Error("Selected payment token differs from the settlement token. Choose Uniswap for swap payment or pay directly with the settlement token.");
    }

    updateRenderFlow({ status: "payment", message: `Requesting ${activeSettlementToken.symbol} transfer from the wallet.` });
    const transferTxHash = await requestTokenTransfer({
      provider: window.ethereum,
      from: account.wallet,
      token: activeSettlementToken,
      recipient: customer.ownerWallet,
      amountAtomic: activeQuote.settlementAmountAtomic,
      label: "Payment transfer",
      chainName: transactionChain.name
    });
    updateRenderFlow({
      status: "confirming",
      message: `Payment transfer ${shortHash(transferTxHash)} submitted. Waiting for confirmation.`,
      txHash: transferTxHash
    });
    const transferReceipt = await waitForWalletReceipt(window.ethereum, transferTxHash, 120000);
    if (!transferReceipt) {
      throw new Error("Timed out waiting for the payment transfer to mine. Paste the transfer hash once it confirms.");
    }
    if (!isSuccessfulReceipt(transferReceipt)) {
      throw new Error("Payment transfer reverted; render was not started.");
    }
    return transferTxHash;
  }

  async function runGeneration() {
    if (!customer) return;
    setBusy("generation");
    setMessage("");
    setRenderFlow({ status: "payment", message: "Preparing payment before starting the render." });
    try {
      const account = await ensureWalletSubAccount();
      const activeQuote = quote || await requestQuote(account);
      const paymentTxHash = await executePaymentForRender(activeQuote, account);
      updateRenderFlow({
        status: "starting",
        message: `Payment transaction ${shortHash(paymentTxHash)} confirmed. Starting video render task.`,
        txHash: paymentTxHash
      });
      const generationPayload = buildGenerationPayload(generationForm, account.referrerCode);
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          subAccountId: account.id,
          generation: generationPayload,
          feed: {
            published: generationForm.publishToFeed,
            tags: generationForm.feedTags
          },
          payment: {
            quoteId: activeQuote.id,
            txHash: paymentTxHash,
            payerWallet: account.wallet,
            amountUsd: activeQuote.totalUsd,
            tokenAddress: activeQuote.paymentTokenAddress,
            tokenSymbol: activeQuote.paymentCurrency,
            paymentRail: activeQuote.paymentRail,
            chainId: activeQuote.chainId,
            route: activeQuote.route
          }
        })
      });
      const data = await assertOk(response);
      await load();
      const created = data.generation as Generation | undefined;
      if (!created) {
        throw new Error("Render API did not return a render task.");
      }
      if (created?.status === "PAYMENT_PENDING") {
        updateRenderFlow({
          status: "confirming",
          message: `Payment is pending for render task ${created.id}. Confirm the payment before credits are granted.`,
          txHash: paymentTxHash,
          generationId: created.id
        });
      } else {
        const grantedCredits = created?.payment.samsarCreditGrant?.creditsGranted;
        updateRenderFlow({
          status: "started",
          message: `Payment transaction ${shortHash(paymentTxHash)} accepted${grantedCredits ? `, ${grantedCredits} Samsar credits granted` : ""}, and render task ${created?.id || ""} started. Auto-polling is active until completion.`,
          txHash: paymentTxHash,
          generationId: created?.id
        });
      }
    } catch (error) {
      const errorMessage = formatErrorMessage(error, "Render request failed");
      updateRenderFlow({
        status: "failed",
        message: errorMessage.includes("render was not started") || errorMessage.includes("Render was not started")
          ? errorMessage
          : `${errorMessage} Render was not started.`
      });
    } finally {
      setBusy("");
    }
  }

  async function syncGeneration(id: string) {
    setBusy(id);
    setMessage("");
    try {
      const response = await fetch(`/api/generations/${id}/sync`, { method: "POST" });
      const data = await assertOk(response);
      await load();
      const syncedGeneration = data.generation as Generation | undefined;
      setMessage(syncedGeneration?.status === "FAILED"
        ? syncedGeneration.errorMessage || "Render task sync failed."
        : "Render task synced.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setBusy("");
    }
  }

  if (!store) {
    return <main className="public-main">Loading customer store...</main>;
  }

  if (!customer) {
    return <main className="public-main"><div className="notice">Customer store was not found.</div></main>;
  }

  return (
    <main className="public-main">
      <section className="hero-band public-hero">
        <div>
          <div className="eyebrow">{customer.name}</div>
          <h1>Generate a product video</h1>
          <p className="subtle">
            Connect your wallet, choose a render configuration, pay the store price, and track your previous render tasks.
          </p>
        </div>
        <button className="btn" onClick={() => load()} title="Refresh data">
          <RefreshCw size={16} /> Refresh
        </button>
      </section>

      {message && <p className="notice">{message}</p>}

      <div className="grid public-grid">
        <section className="stack">
          <div className="panel">
            <div className="panel-header">
              <h2>Wallet</h2>
              <Wallet size={18} />
            </div>
            <div className="form-grid">
              <TextField label="Wallet address" value={walletAddress} onChange={setWalletAddress} full />
              <TextField label="Email" value={profileForm.email} onChange={(email) => setProfileForm({ ...profileForm, email })} />
              <TextField label="Username" value={profileForm.username} onChange={(username) => setProfileForm({ ...profileForm, username })} />
            </div>
            <div className="button-row">
              <button className="btn primary" onClick={connectWallet} disabled={busy === "wallet"}>
                <Wallet size={16} /> {busy === "wallet" ? "Connecting..." : hasWalletAddress ? "Switch wallet" : "Connect wallet"}
              </button>
              <button className="btn" onClick={() => ensureWalletSubAccount().then((account) => setMessage(account.blockchainRegistration ? "Wallet profile and 0G user record ready." : "Wallet profile ready.")).catch((error) => setMessage(error.message))}>
                <ShieldCheck size={16} /> {connectedSubAccount ? "Update profile" : "Save profile"}
              </button>
              {hasWalletAddress && <span className="badge ok">connected {shortWallet(walletAddress)}</span>}
              {connectedSubAccount && <span className="badge ok">{connectedSubAccount.referrerCode}</span>}
              {connectedSubAccount?.blockchainRegistration && (
                <span className="badge ok">{connectedSubAccount.blockchainRegistration.mock ? "0G mock" : "0G anchored"}</span>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Pricing</h2>
              <CircleDollarSign size={18} />
            </div>
            <div className="list">
              {pricingOptions.map((item) => (
                <PricingOption
                  item={item}
                  key={item.id}
                  customer={customer}
                  selected={selectedPricing?.id === item.id}
                  onSelect={() => setGenerationForm({ ...generationForm, videoModel: item.videoModel, aspectRatio: item.aspectRatio })}
                />
              ))}
            </div>
          </div>
        </section>

        <section className="stack">
          <div className="panel panel-strong">
            <div className="panel-header">
              <h2>Render Task</h2>
              <Play size={18} />
            </div>
            <div className="form-grid">
              <div className="field full">
                <label>Image URL metadata JSON array</label>
                <textarea value={generationForm.imageUrls} onChange={(event) => setGenerationForm({ ...generationForm, imageUrls: event.target.value })} />
              </div>
              <div className="field full">
                <label>JSON payload metadata</label>
                <textarea value={generationForm.metadata} onChange={(event) => setGenerationForm({ ...generationForm, metadata: event.target.value })} />
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={generationForm.publishToFeed}
                  onChange={(event) => setGenerationForm({ ...generationForm, publishToFeed: event.target.checked })}
                />
                Publish video to feed
              </label>
              <TextField label="Feed tags" value={generationForm.feedTags} onChange={(feedTags) => setGenerationForm({ ...generationForm, feedTags })} />
              <div className="field full">
                <label>Prompt</label>
                <textarea value={generationForm.prompt} onChange={(event) => setGenerationForm({ ...generationForm, prompt: event.target.value })} />
              </div>
              <PaymentMethodSelector
                tokens={paymentTokens}
                selectedSymbol={paymentCurrency}
                settlementToken={settlementToken}
                onSelect={(currency) => setPaymentCurrency(currency)}
              />
              <TextField label="CTA outro URL" value={generationForm.ctaUrl} onChange={(ctaUrl) => setGenerationForm({ ...generationForm, ctaUrl })} />
              <TextField label="CTA top text" value={generationForm.ctaTextTop} onChange={(ctaTextTop) => setGenerationForm({ ...generationForm, ctaTextTop })} />
              <TextField label="CTA bottom text" value={generationForm.ctaTextBottom} onChange={(ctaTextBottom) => setGenerationForm({ ...generationForm, ctaTextBottom })} />
              <TextField label="CTA logo URL" value={generationForm.ctaLogo} onChange={(ctaLogo) => setGenerationForm({ ...generationForm, ctaLogo })} />
              <TextField label="Payment tx hash (manual fallback)" value={generationForm.txHash} onChange={(txHash) => setGenerationForm({ ...generationForm, txHash })} full />
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={generationForm.addOutroAnimation}
                  onChange={(event) => setGenerationForm({ ...generationForm, addOutroAnimation: event.target.checked })}
                />
                Server-generated outro animation
              </label>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={generationForm.addOutroFocusArea}
                  onChange={(event) => setGenerationForm({ ...generationForm, addOutroFocusArea: event.target.checked })}
                />
                Server-generated outro focus area
              </label>
              <div className="field full">
                <label>Outro focus area JSON</label>
                <textarea
                  value={generationForm.outroFocusArea}
                  onChange={(event) => setGenerationForm({ ...generationForm, outroFocusArea: event.target.value })}
                />
              </div>
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={generationForm.addFooterAnimation}
                  onChange={(event) => setGenerationForm({ ...generationForm, addFooterAnimation: event.target.checked })}
                />
                Bottom CTA footer cards
              </label>
              <div className="field full">
                <label>Footer metadata JSON array ({imageCount} items)</label>
                <textarea
                  value={generationForm.footerMetadata}
                  onChange={(event) => setGenerationForm({ ...generationForm, footerMetadata: event.target.value })}
                />
              </div>
              <div className="field full">
                <label>Generated Samsar payload preview</label>
                <textarea className="payload-preview" value={generationPayloadPreview} readOnly />
              </div>
            </div>
            <PaymentSummary
              imageCount={imageCount}
              quote={quote}
              transactionChain={transactionChain}
              selectedPaymentToken={selectedPaymentToken}
              settlementToken={settlementToken}
              paymentRail={paymentRail}
              estimatedDurationSeconds={estimatedDurationSeconds}
              selectedPricingDetails={selectedPricingDetails}
            />
            <div className="button-row">
              <button className="btn" onClick={createQuote} disabled={busy === "quote" || imageCount === 0}>
                <CircleDollarSign size={16} /> Quote {paymentCurrency}
              </button>
              <button className="btn primary" onClick={runGeneration} disabled={busy === "generation" || imageCount === 0}>
                <Play size={16} /> Pay {paymentCurrency} & start render
              </button>
              {quote?.checkoutUrl && quote.paymentRail === "uniswap" && (
                <a className="btn" href={quote.checkoutUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Open Uniswap
                </a>
              )}
              <a className="btn" href="/feed">
                <ExternalLink size={16} /> Open feed
              </a>
              {autoPolling && <span className="badge ok">polling renders</span>}
            </div>
            <RenderFlowNotice state={renderFlow} />
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Your Render Tasks</h2>
              <Bot size={18} />
            </div>
            <div className="list">
              {!connectedSubAccount && <p className="subtle">Connect your wallet to view previous render tasks.</p>}
              {connectedSubAccount && userGenerations.length === 0 && <p className="subtle">No render tasks for this wallet yet.</p>}
              {userGenerations.map((generation) => (
                <GenerationItem key={generation.id} generation={generation} busy={busy === generation.id} onSync={() => syncGeneration(generation.id)} />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function RenderFlowNotice({ state }: { state: RenderFlowState }) {
  if (state.status === "idle") {
    return null;
  }
  const failedAfterStart = state.status === "failed" && Boolean(state.generationId);
  const finalizationFailed = state.status === "failed" && state.message.includes("0G persistence");
  const statusLabel =
    state.status === "failed" ? (finalizationFailed ? "Finalization failed" : failedAfterStart ? "Render failed" : "Render not started") :
      state.status === "completed" ? "Render finished" :
        state.status === "started" ? "Render started" :
          state.status === "starting" ? "Starting render" :
            state.status === "confirming" ? "Confirming payment" :
              "Payment required";
  const badgeClass = state.status === "failed" ? "badge fail" : state.status === "completed" || state.status === "started" ? "badge ok" : "badge";
  return (
    <div className={`render-status ${state.status === "failed" ? "fail" : ""}`}>
      <div className="item-title">
        <strong>{statusLabel}</strong>
        <span className={badgeClass}>{state.status}</span>
      </div>
      <p className="subtle">{state.message}</p>
      {state.txHash && <div className="mono">tx {state.txHash}</div>}
      {state.generationId && <div className="mono">task {state.generationId}</div>}
    </div>
  );
}

function PricingOption({
  item,
  customer,
  selected,
  onSelect
}: {
  item: ModelPricingConfiguration;
  customer: Customer;
  selected: boolean;
  onSelect: () => void;
}) {
  const details = resolveModelPriceDetails(customer, item);
  return (
    <button
      className="item"
      onClick={onSelect}
      style={{ textAlign: "left", borderColor: selected ? "var(--accent-cool)" : undefined }}
    >
      <div className="item-title">
        <strong>{item.label}</strong>
        <span className="badge ok">{details.pricePerSecondUsd.toFixed(2)} USDC/sec</span>
      </div>
      <p className="subtle">
        {item.videoModel} · {item.aspectRatio} · {details.baseCreditsPerSecond} credits/sec · up to {item.maxSecondsPerImage}s/image
      </p>
    </button>
  );
}

function PaymentMethodSelector({
  tokens,
  selectedSymbol,
  settlementToken,
  onSelect
}: {
  tokens: PaymentToken[];
  selectedSymbol: PaymentCurrencySymbol;
  settlementToken: PaymentToken;
  onSelect: (symbol: PaymentCurrencySymbol) => void;
}) {
  const orderedTokens = [...tokens].sort((left, right) => paymentTokenRank(left) - paymentTokenRank(right));
  return (
    <div className="field full">
      <label>Payment currency</label>
      <div className="amount-grid payment-method-grid">
        {orderedTokens.map((token) => {
          const active = token.symbol === selectedSymbol;
          const rail = resolveUserPaymentRail(token, settlementToken);
          const settlementLabel = rail === "direct" ? "direct transfer" : `${settlementToken.symbol} settlement`;
          return (
            <button
              type="button"
              className={`amount-choice ${active ? "active" : ""}`}
              onClick={() => onSelect(token.symbol)}
              key={`${token.chainId}:${token.address}`}
            >
              <span className="subtle">{token.native ? "Native token" : "ERC-20 token"}</span>
              <strong>{token.symbol}</strong>
              <span>{settlementLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PaymentSummary({
  imageCount,
  quote,
  transactionChain,
  selectedPaymentToken,
  settlementToken,
  paymentRail,
  estimatedDurationSeconds,
  selectedPricingDetails
}: {
  imageCount: number;
  quote: PaymentQuote | null;
  transactionChain: TransactionChainConfig;
  selectedPaymentToken: PaymentToken;
  settlementToken: PaymentToken;
  paymentRail: PaymentRail;
  estimatedDurationSeconds: number;
  selectedPricingDetails: ReturnType<typeof resolveModelPriceDetails>;
}) {
  return (
    <div className="payment-summary">
      <div>
        <span className="subtle">Images</span>
        <strong>{imageCount}</strong>
      </div>
      <div>
        <span className="subtle">Est. seconds</span>
        <strong>{estimatedDurationSeconds}</strong>
      </div>
      <div>
        <span className="subtle">User price</span>
        <strong>{selectedPricingDetails.pricePerSecondUsd.toFixed(2)} USDC/sec</strong>
      </div>
      <div>
        <span className="subtle">Paying</span>
        <strong>{selectedPaymentToken.symbol}</strong>
      </div>
      <div>
        <span className="subtle">Network</span>
        <strong>{transactionChain.name}</strong>
      </div>
      <div>
        <span className="subtle">Settlement</span>
        <strong>{settlementToken.symbol}</strong>
      </div>
      <div>
        <span className="subtle">Payment path</span>
        <strong>{quote?.paymentRail || paymentRail}</strong>
      </div>
      {quote?.paymentAmountAtomic && (
        <div>
          <span className="subtle">Pay amount</span>
          <strong>{formatAtomicAmount(BigInt(quote.paymentAmountAtomic), selectedPaymentToken.decimals)} {quote.paymentCurrency || selectedPaymentToken.symbol}</strong>
        </div>
      )}
      {quote && (
        <div className="payment-total">
          <span className="subtle">Quote</span>
          <strong>{quote.totalUsd.toFixed(2)} {quote.settlementCurrency || settlementToken.symbol}</strong>
        </div>
      )}
    </div>
  );
}

function paymentTokenRank(token: PaymentToken) {
  const preferredOrder: Record<string, number> = {
    ETH: 0,
    USDC: 1,
    WETH: 2,
    USDT: 3
  };
  return preferredOrder[token.symbol] ?? 10;
}

function resolveUserPaymentRail(paymentToken: PaymentToken, settlementToken: PaymentToken): PaymentRail {
  return paymentToken.address.toLowerCase() === settlementToken.address.toLowerCase() ? "direct" : "keeperhub";
}

function GenerationItem({ generation, busy, onSync }: { generation: Generation; busy: boolean; onSync: () => void }) {
  const badgeClass = generation.status === "COMPLETED" ? "badge ok" : generation.status === "FAILED" ? "badge fail" : "badge";
  return (
    <div className="item">
      <div className="item-title">
        <strong>{generation.id}</strong>
        <span className={badgeClass}>{generation.status}</span>
      </div>
      <p className="subtle">
        {generation.input.image_urls.length} images · {generation.input.video_model} · {generation.input.aspect_ratio} · {generation.payment.amountUsd.toFixed(2)} {generation.payment.tokenSymbol || "USDC"}
      </p>
      <div className="mono">{generation.samsarSessionId || "pending Samsar session"}</div>
      {generation.payment.keeperExecutionId && <div className="mono">keeper {generation.payment.keeperExecutionId}</div>}
      {generation.payment.samsarCreditGrant && (
        <div className="mono">
          samsar +{generation.payment.samsarCreditGrant.creditsGranted} credits, {generation.payment.samsarCreditGrant.remainingCredits} remaining
        </div>
      )}
      {generation.errorMessage && <p className="subtle">{generation.errorMessage}</p>}
      <div className="button-row">
        <button className="btn" onClick={onSync} disabled={busy || generation.status === "COMPLETED"}>
          <RefreshCw size={16} /> Sync
        </button>
        {generation.inftId && <a className="btn" href={`/inft/${generation.inftId}`}><ExternalLink size={16} /> Open INFT</a>}
        {generation.feed?.published && generation.status === "COMPLETED" && <a className="btn" href="/feed"><ExternalLink size={16} /> View in feed</a>}
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

async function requestUniswapSwap(provider: EthereumProvider, quote: PaymentQuote, wallet: string, chainName: string) {
  const route = quote.route && typeof quote.route === "object" ? quote.route as Record<string, unknown> : {};
  const swapQuote = route.quote;
  if (!swapQuote || typeof swapQuote !== "object") {
    throw new Error("Live Uniswap quote data is required for swap payment. Create a quote with Uniswap enabled, or use the Uniswap link and paste the final payment transfer hash.");
  }
  const permitData = route.permitData;
  const signature = permitData
    ? String(await provider.request({
      method: "eth_signTypedData_v4",
      params: [wallet, JSON.stringify(permitData)]
    }))
    : undefined;
  const response = await fetch("/api/payments/uniswap-swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quote: swapQuote,
      permitData,
      signature
    })
  });
  const data = await assertOk(response);
  const swapResponse = data.swap && typeof data.swap === "object" ? data.swap as Record<string, unknown> : {};
  const tx = swapResponse.swap && typeof swapResponse.swap === "object" ? swapResponse.swap as Record<string, unknown> : {};
  if (!tx.to || !tx.data) {
    throw new Error("Uniswap swap response did not include a transaction.");
  }
  const transaction = compactTransaction({
    from: wallet,
    to: String(tx.to),
    data: String(tx.data),
    value: toRpcQuantity(tx.value)
  });
  const gas = await estimateWalletGas(provider, transaction, {
    label: "Uniswap swap",
    chainName,
    recovery: "Try Pay with USDC on the direct rail, or use Open Uniswap and paste the final settlement transfer hash."
  });
  return sendWalletTransaction(provider, { ...transaction, gas }, {
    label: "Uniswap swap",
    chainName,
    recovery: "Try Pay with USDC on the direct rail, or use Open Uniswap and paste the final settlement transfer hash."
  });
}

async function requestTokenTransfer({
  provider,
  from,
  token,
  recipient,
  amountAtomic,
  label,
  chainName
}: {
  provider: EthereumProvider;
  from: string;
  token: PaymentToken;
  recipient: string;
  amountAtomic: string;
  label: string;
  chainName: string;
}) {
  await assertWalletBalance(provider, from, token, amountAtomic);
  const tx = token.native
    ? {
      from,
      to: recipient,
      value: toRpcQuantity(amountAtomic),
      gas: "0x5208"
    }
    : {
      from,
      to: token.address,
      data: buildErc20TransferData(recipient, amountAtomic),
      value: "0x0",
      gas: "0x1d4c0"
    };
  return sendWalletTransaction(provider, tx, { label, chainName });
}

async function sendWalletTransaction(
  provider: EthereumProvider,
  transaction: Record<string, unknown>,
  context: { label: string; chainName: string; recovery?: string }
) {
  try {
    return String(await provider.request({
      method: "eth_sendTransaction",
      params: [compactTransaction(transaction)]
    }));
  } catch (error) {
    console.error(`${context.label} wallet transaction failed`, {
      chainName: context.chainName,
      to: transaction.to,
      value: transaction.value,
      gas: transaction.gas,
      error
    });
    throw new Error(formatWalletTransactionError(error, context));
  }
}

async function estimateWalletGas(
  provider: EthereumProvider,
  transaction: Record<string, unknown>,
  context: { label: string; chainName: string; recovery?: string }
) {
  try {
    const gas = BigInt(String(await provider.request({
      method: "eth_estimateGas",
      params: [compactTransaction(transaction)]
    })));
    const paddedGas = (gas * 12n) / 10n + 1n;
    const maxReasonableSwapGas = 4_000_000n;
    if (paddedGas > maxReasonableSwapGas) {
      throw new Error(`${context.label} estimated an unusually high gas limit (${paddedGas.toString()}) on ${context.chainName}. No transaction was submitted and the render was not started. ${context.recovery || ""}`.trim());
    }
    return toRpcQuantity(paddedGas);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unusually high gas limit")) {
      throw error;
    }
    throw new Error(formatWalletTransactionError(error, context));
  }
}

async function assertWalletBalance(provider: EthereumProvider, owner: string, token: PaymentToken, amountAtomic: string) {
  const requiredAmount = BigInt(amountAtomic || "0");
  const balance = token.native
    ? BigInt(String(await provider.request({ method: "eth_getBalance", params: [owner, "latest"] })))
    : await readErc20Balance(provider, token.address, owner);
  if (balance < requiredAmount) {
    throw new Error(`Insufficient ${token.symbol} balance for payment. Required ${formatAtomicAmount(requiredAmount, token.decimals)} ${token.symbol}, available ${formatAtomicAmount(balance, token.decimals)} ${token.symbol}. Choose another payment currency and create a fresh quote. Render was not started.`);
  }
}

async function readErc20Balance(provider: EthereumProvider, tokenAddress: string, owner: string) {
  const result = await provider.request({
    method: "eth_call",
    params: [{
      to: tokenAddress,
      data: `0x70a08231${encodeAddressWord(owner)}`
    }, "latest"]
  });
  return BigInt(String(result || "0x0"));
}

async function waitForWalletReceipt(provider: EthereumProvider, txHash: string, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash]
    }).catch(() => null);
    if (receipt) {
      return receipt;
    }
    await delay(3000);
  }
  return null;
}

function buildErc20TransferData(recipient: string, amountAtomic: string) {
  const cleanRecipient = encodeAddressWord(recipient);
  const cleanAmount = BigInt(amountAtomic || "0").toString(16).padStart(64, "0");
  return `0xa9059cbb${cleanRecipient}${cleanAmount}`;
}

function encodeAddressWord(address: string) {
  const cleanAddress = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(cleanAddress)) {
    throw new Error("Invalid wallet address");
  }
  return cleanAddress.padStart(64, "0");
}

function formatAtomicAmount(amount: bigint, decimals: number) {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
}

function toRpcQuantity(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && value.startsWith("0x")) {
    return `0x${BigInt(value).toString(16)}`;
  }
  const bigint = BigInt(String(value));
  return `0x${bigint.toString(16)}`;
}

function compactTransaction(tx: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(tx).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function isSuccessfulReceipt(receipt: unknown) {
  if (!receipt || typeof receipt !== "object") {
    return false;
  }
  const status = (receipt as { status?: unknown }).status;
  if (typeof status === "string") {
    return status.toLowerCase() === "0x1" || status === "1";
  }
  if (typeof status === "number") {
    return status === 1;
  }
  if (typeof status === "boolean") {
    return status;
  }
  return false;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function ensureWalletNetwork(provider: EthereumProvider, chain: TransactionChainConfig) {
  const currentChainId = await provider.request({ method: "eth_chainId" }).catch(() => "");
  if (String(currentChainId).toLowerCase() === chain.hexChainId.toLowerCase()) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hexChainId }]
    });
  } catch (error) {
    if (walletErrorCode(error) !== 4902) {
      throw new Error(`Switch wallet to ${chain.name} to continue.`);
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chain.hexChainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls,
        blockExplorerUrls: chain.blockExplorerUrls
      }]
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hexChainId }]
    });
  }
}

function walletErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : 0;
}

function formatWalletTransactionError(
  error: unknown,
  context: { label: string; chainName: string; recovery?: string }
) {
  const message = formatErrorMessage(error, `${context.label} failed`);
  if (/gas limit too high/i.test(message)) {
    return `Wallet rejected ${context.label} before broadcast: gas limit too high on ${context.chainName}. No transaction hash was created and the render was not started. ${context.recovery || "Confirm the wallet is on the expected network and retry."}`.trim();
  }
  if (walletErrorCode(error) === 4001) {
    return `${context.label} was rejected in the wallet. Render was not started.`;
  }
  return `${context.label} failed before the render task could start: ${message}`;
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
    return String(record.message || nested?.message || fallback);
  }
  return fallback;
}

async function assertOk(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
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

function buildGenerationPayload(form: GenerationFormState, fallbackReferrerCode: string): GenerationInput {
  const imageInputs = parseImageInputs(form.imageUrls).map((item) => applySampleImageProcessingFlags(item, form.aspectRatio));
  const ctaUrl = form.ctaUrl.trim();
  if (!ctaUrl) {
    throw new Error("cta_url is required for the server-generated CTA outro image");
  }

  const payload: GenerationInput = {
    image_urls: imageInputs,
    metadata: parseJsonObject(form.metadata),
    prompt: form.prompt,
    video_model: form.videoModel,
    aspect_ratio: form.aspectRatio,
    language: form.language,
    enable_subtitles: true,
    generate_outro_image: true,
    cta_url: ctaUrl,
    cta_text_top: form.ctaTextTop.trim() || "Scan to buy",
    cta_text_bottom: form.ctaTextBottom.trim() || fallbackReferrerCode,
    add_outro_animation: form.addOutroAnimation,
    add_outro_focus_area: form.addOutroFocusArea
  };

  if (form.addOutroFocusArea) {
    payload.outro_focust_area = parseOutroFocusArea(form.outroFocusArea);
  }
  if (form.ctaLogo.trim()) {
    assertUsableImageUrl(form.ctaLogo.trim(), "cta_logo");
    payload.cta_logo = form.ctaLogo.trim();
  }

  if (form.addFooterAnimation) {
    payload.add_footer_animation = true;
    payload.footer_metadata = parseFooterMetadata(form.footerMetadata, imageInputs.length);
  }

  return payload;
}

function applySampleImageProcessingFlags(item: string | Record<string, unknown>, aspectRatio: VideoAspectRatio): string | Record<string, unknown> {
  if (typeof item === "string") {
    return isSampleImageUrl(item)
      ? { image_url: buildAspectSizedSampleImageUrl(item, aspectRatio), skip_enhancement: true }
      : item;
  }

  const hasExplicitSkip =
    Object.prototype.hasOwnProperty.call(item, "skip_enhancement") ||
    Object.prototype.hasOwnProperty.call(item, "skipEnhancement");
  const imageUrl = getImageInputUrl(item);

  return {
    ...item,
    ...(isSampleImageUrl(imageUrl) ? { image_url: buildAspectSizedSampleImageUrl(imageUrl, aspectRatio) } : {}),
    ...(!hasExplicitSkip && isSampleImageUrl(imageUrl) ? { skip_enhancement: true } : {})
  };
}

function isSampleImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return sampleImageUrlBases.has(`${url.origin}${url.pathname}`);
  } catch {
    return false;
  }
}

function buildAspectSizedSampleImageUrl(rawUrl: string, aspectRatio: VideoAspectRatio) {
  const url = new URL(rawUrl);
  const [width, height] = aspectRatio === "9:16" ? [1024, 1792] : [1792, 1024];
  url.search = new URLSearchParams({
    auto: "format",
    fit: "crop",
    w: String(width),
    h: String(height),
    q: "90"
  }).toString();
  return url.toString();
}

function previewGenerationPayload(form: GenerationFormState, fallbackReferrerCode: string) {
  try {
    return JSON.stringify(buildGenerationPayload(form, fallbackReferrerCode), null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Invalid render payload"
    }, null, 2);
  }
}

function countImageInputs(raw: string) {
  try {
    return parseImageInputs(raw).length;
  } catch {
    return 0;
  }
}

function parseImageInputs(raw: string): Array<string | Record<string, unknown>> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("image_urls must be a JSON array");
    }
    return parsed.map((item, index) => normalizeImageInputItem(item, index));
  }
  return trimmed
    .split(/\n|,/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => {
      assertUsableImageUrl(value, `image_urls item ${index + 1}`);
      return value;
    });
}

function normalizeImageInputItem(item: unknown, index: number): string | Record<string, unknown> {
  if (typeof item === "string") {
    const value = item.trim();
    if (!value) {
      throw new Error(`image_urls item ${index + 1} must not be empty`);
    }
    assertUsableImageUrl(value, `image_urls item ${index + 1}`);
    return value;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`image_urls item ${index + 1} must be a URL string or object`);
  }
  const record = item as Record<string, unknown>;
  const imageUrl = getImageInputUrl(record);
  if (!imageUrl) {
    throw new Error(`image_urls item ${index + 1} must include image_url`);
  }
  assertUsableImageUrl(imageUrl, `image_urls item ${index + 1}`);
  return {
    ...record,
    image_url: imageUrl
  };
}

function getImageInputUrl(record: Record<string, unknown>) {
  return String(
    record.image_url ||
    record.imageUrl ||
    record.url ||
    record.src ||
    record.effective_url ||
    record.effectiveUrl ||
    record.enhanced_url ||
    record.enhancedUrl ||
    ""
  ).trim();
}

function assertUsableImageUrl(rawUrl: string, label: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must be an http(s) URL`);
  }
  if (url.hostname === "example.com" || url.hostname.endsWith(".example.com")) {
    throw new Error(`${label} must use a real reachable image URL, not an example.com placeholder`);
  }
}

function parseOutroFocusArea(raw: string) {
  const parsed = parseJsonObject(raw);
  const focusArea = {
    x: Number(parsed.x),
    y: Number(parsed.y),
    width: Number(parsed.width),
    height: Number(parsed.height)
  };
  if (!Object.values(focusArea).every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("outro focus area must include valid x, y, width, and height numbers");
  }
  return focusArea;
}

function parseFooterMetadata(raw: string, expectedCount: number) {
  if (!raw.trim()) {
    if (expectedCount > 0) {
      throw new Error(`footer metadata must contain exactly ${expectedCount} item${expectedCount === 1 ? "" : "s"} to match image_urls`);
    }
    return [];
  }
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("footer metadata must be a JSON array");
  }
  if (parsed.length !== expectedCount) {
    throw new Error(`footer metadata must contain exactly ${expectedCount} item${expectedCount === 1 ? "" : "s"} to match image_urls`);
  }
  return parsed.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`footer metadata item ${index + 1} must be an object`);
    }
    const record = item as Record<string, unknown>;
    const url = String(record.url || "").trim();
    if (!url) {
      throw new Error(`footer metadata item ${index + 1} must include url`);
    }
    const title = String(record.title || "").trim();
    return title ? { url, title } : { url };
  });
}

function sameWallet(left?: string, right?: string) {
  return normalizeWallet(left) === normalizeWallet(right);
}

function normalizeWallet(value = "") {
  return value.trim().toLowerCase();
}

function shortWallet(value = "") {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed || "wallet";
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function shortHash(value = "") {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
