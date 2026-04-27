"use client";

import { Bot, CircleDollarSign, Code2, ExternalLink, ListChecks, Play, Plus, RefreshCw, ShieldCheck, Store, Trash2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import StorefrontRatingForm from "@/components/StorefrontRatingForm";
import { type EthereumProvider } from "@/lib/browser-wallets";
import {
  findPaymentToken,
  getPaymentTokens,
  getTransactionChainConfig,
  normalizeTransactionChainIdForEnvironment,
  settlementTokenForCurrency,
  type PaymentToken,
  type TransactionChainConfig
} from "@/lib/payment-tokens";
import {
  estimateDurationSeconds,
  getAllowedModelPricingConfigurations,
  getRenderConditionError,
  getStorefrontConditionTiles,
  getStorefrontMaxImages,
  resolveModelPriceDetails
} from "@/lib/pricing";
import { getStorefrontAccessError } from "@/lib/storefront-access";
import { isUsableEvmAddress } from "@/lib/wallet-address";
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

type RenderFormMode = "simple" | "advanced";
type RenderFormPatch = Partial<GenerationFormState>;

type ImageWizardItem = {
  image_url: string;
  title: string;
  image_text: string;
  skip_enhancement?: boolean;
};

type MetadataWizardItem = {
  key: string;
  value: string;
};

type FooterWizardItem = {
  url: string;
  title: string;
};

type OutroFocusAreaWizard = {
  x: string;
  y: string;
  width: string;
  height: string;
};

type RenderFlowState = {
  status: "idle" | "payment" | "confirming" | "starting" | "started" | "completed" | "failed";
  message: string;
  txHash?: string;
  generationId?: string;
};

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

const starterCampaignMetadata = JSON.stringify({ title: "New launch", campaign: "customer-store" }, null, 2);
const defaultOutroFocusArea = JSON.stringify({ x: 680, y: 296, width: 432, height: 432 }, null, 2);

export default function UserLandingPage({ referrerCode = "", customerId = "" }: { referrerCode?: string; customerId?: string }) {
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
    metadata: starterCampaignMetadata,
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
  const [renderFormMode, setRenderFormMode] = useState<RenderFormMode>("simple");
  const [imageWizardItems, setImageWizardItems] = useState<ImageWizardItem[]>(() => parseImageWizardItems(starterImageMetadata));
  const [metadataWizardItems, setMetadataWizardItems] = useState<MetadataWizardItem[]>(() => parseMetadataWizardItems(starterCampaignMetadata));
  const [footerWizardItems, setFooterWizardItems] = useState<FooterWizardItem[]>(() => parseFooterWizardItems(starterFooterMetadata));
  const [outroFocusAreaWizard, setOutroFocusAreaWizard] = useState<OutroFocusAreaWizard>(() => parseOutroFocusAreaWizard(defaultOutroFocusArea));
  const [paymentCurrency, setPaymentCurrency] = useState<PaymentCurrencySymbol>("USDC");
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
    if (routeAccount) {
      return store.customers.find((item) => item.id === routeAccount.customerId) || null;
    }
    if (customerId) {
      return store.customers.find((item) => item.id === customerId) || null;
    }
    return store.customers[0] || null;
  }, [store, routeAccount, customerId]);
  const pricingOptions = useMemo(
    () => getAllowedModelPricingConfigurations(customer),
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
  const maxImages = getStorefrontMaxImages(customer);
  const conditionTiles = getStorefrontConditionTiles(customer);
  const renderConditionError = getRenderConditionError(customer, {
    imageCount,
    videoModel: generationForm.videoModel,
    aspectRatio: generationForm.aspectRatio
  });
  const renderAccessError = getStorefrontAccessError(customer, store, {
    wallet: walletAddress || connectedSubAccount?.wallet
  });
  const paymentSetupError = customer && !isUsableEvmAddress(customer.ownerWallet)
    ? "This storefront is waiting for an owner wallet before payments can start."
    : "";
  const renderGateError = renderConditionError || renderAccessError || paymentSetupError;
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
  const sessionStorageKey = useMemo(
    () => `superreferrals:user-session:${routeAccount?.referrerCode || customer?.id || referrerCode || customerId || "default"}`,
    [routeAccount?.referrerCode, customer?.id, referrerCode, customerId]
  );
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
    () => previewGenerationPayload(generationForm, connectedSubAccount?.referrerCode || referrerCode || customer?.id || "storefront"),
    [generationForm, connectedSubAccount?.referrerCode, referrerCode, customer?.id]
  );

  function updateGenerationForm(patch: RenderFormPatch) {
    setGenerationForm((current) => ({ ...current, ...patch }));
  }

  function openRenderFormMode(mode: RenderFormMode) {
    if (mode === "simple") {
      setImageWizardItems(parseImageWizardItems(generationForm.imageUrls));
      setMetadataWizardItems(parseMetadataWizardItems(generationForm.metadata));
      setFooterWizardItems(parseFooterWizardItems(generationForm.footerMetadata));
      setOutroFocusAreaWizard(parseOutroFocusAreaWizard(generationForm.outroFocusArea));
    }
    setRenderFormMode(mode);
  }

  function commitImageWizardItems(nextImages: ImageWizardItem[], nextFooters = footerWizardItems) {
    setImageWizardItems(nextImages);
    setGenerationForm((current) => ({
      ...current,
      imageUrls: serializeImageWizardItems(nextImages),
      footerMetadata: serializeFooterWizardItems(nextFooters)
    }));
  }

  function updateImageWizardItem(index: number, patch: Partial<ImageWizardItem>) {
    const previousItem = imageWizardItems[index];
    const nextImages = imageWizardItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    );
    let nextFooters = footerWizardItems;

    if (patch.image_url !== undefined && footerWizardItems[index]) {
      const previousUrl = previousItem?.image_url || "";
      const footerItem = footerWizardItems[index];
      if (!footerItem.url.trim() || footerItem.url === previousUrl) {
        nextFooters = footerWizardItems.map((item, itemIndex) =>
          itemIndex === index ? { ...item, url: patch.image_url || "" } : item
        );
        setFooterWizardItems(nextFooters);
      }
    }

    commitImageWizardItems(nextImages, nextFooters);
  }

  function addImageWizardItem() {
    if (maxImages && imageWizardItems.length >= maxImages) {
      setMessage(`This storefront allows up to ${maxImages} image${maxImages === 1 ? "" : "s"} per render.`);
      return;
    }
    const nextImages = [...imageWizardItems, { image_url: "", title: "", image_text: "" }];
    const nextFooters = [...footerWizardItems, { url: "", title: "" }];
    setFooterWizardItems(nextFooters);
    commitImageWizardItems(nextImages, nextFooters);
  }

  function removeImageWizardItem(index: number) {
    const nextImages = imageWizardItems.filter((_, itemIndex) => itemIndex !== index);
    const nextFooters = footerWizardItems.filter((_, itemIndex) => itemIndex !== index);
    setFooterWizardItems(nextFooters);
    commitImageWizardItems(nextImages, nextFooters);
  }

  function commitMetadataWizardItems(nextItems: MetadataWizardItem[]) {
    setMetadataWizardItems(nextItems);
    updateGenerationForm({ metadata: serializeMetadataWizardItems(nextItems) });
  }

  function updateMetadataWizardItem(index: number, patch: Partial<MetadataWizardItem>) {
    commitMetadataWizardItems(metadataWizardItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    ));
  }

  function addMetadataWizardItem() {
    commitMetadataWizardItems([...metadataWizardItems, { key: "", value: "" }]);
  }

  function removeMetadataWizardItem(index: number) {
    commitMetadataWizardItems(metadataWizardItems.filter((_, itemIndex) => itemIndex !== index));
  }

  function commitFooterWizardItems(nextItems: FooterWizardItem[]) {
    setFooterWizardItems(nextItems);
    updateGenerationForm({ footerMetadata: serializeFooterWizardItems(nextItems) });
  }

  function updateFooterWizardItem(index: number, patch: Partial<FooterWizardItem>) {
    commitFooterWizardItems(footerWizardItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    ));
  }

  function addFooterWizardItem() {
    commitFooterWizardItems([...footerWizardItems, { url: "", title: "" }]);
  }

  function removeFooterWizardItem(index: number) {
    commitFooterWizardItems(footerWizardItems.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateOutroFocusAreaWizard(field: keyof OutroFocusAreaWizard, value: string) {
    const nextFocusArea = { ...outroFocusAreaWizard, [field]: value };
    setOutroFocusAreaWizard(nextFocusArea);
    updateGenerationForm({ outroFocusArea: serializeOutroFocusAreaWizard(nextFocusArea) });
  }

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
  }, [generationForm.imageUrls, generationForm.videoModel, generationForm.aspectRatio, paymentCurrency, transactionChain.id, walletAddress]);

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
    if (existingAccount?.blockchainRegistration) {
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
      if (renderConditionError) {
        throw new Error(renderConditionError);
      }
      if (renderAccessError) {
        throw new Error(renderAccessError);
      }
      if (paymentSetupError) {
        throw new Error(paymentSetupError);
      }
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
    if (!isUsableEvmAddress(paymentRecipient)) {
      throw new Error("Quote did not include a valid non-zero payment recipient. Ask the storefront owner to link an owner wallet or configure KeeperHub settlement.");
    }

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
      if (renderConditionError) {
        throw new Error(renderConditionError);
      }
      if (renderAccessError) {
        throw new Error(renderAccessError);
      }
      if (paymentSetupError) {
        throw new Error(paymentSetupError);
      }
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
          message: `Payment is pending for render task ${created.id}. Confirm the payment before the render starts.`,
          txHash: paymentTxHash,
          generationId: created.id
        });
      } else {
        updateRenderFlow({
          status: "started",
          message: `Payment transaction ${shortHash(paymentTxHash)} accepted and render task ${created?.id || ""} started. Auto-polling is active until completion.`,
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
            {customer.storefront?.description || "Connect your wallet, choose a render configuration, pay the store price, and track your previous render tasks."}
          </p>
          <div className="storefront-landing-meta">
            <span><Wallet size={15} /> owner {isUsableEvmAddress(customer.ownerWallet) ? shortWallet(customer.ownerWallet) : "not connected"}</span>
            {customer.storefront?.category && <span><Store size={15} /> {customer.storefront.category}</span>}
            {customer.ensName && <span>{customer.ensName}</span>}
          </div>
        </div>
        <div className="landing-hero-actions">
          <a className="btn" href="/storefronts">
            <Store size={16} /> Directory
          </a>
          <button className="btn" onClick={() => load()} title="Refresh data">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
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
              <div className="storefront-condition-tiles">
                {conditionTiles.map((tile) => <span key={tile}>{tile}</span>)}
              </div>
              {pricingOptions.map((item) => (
                <PricingOption
                  item={item}
                  key={item.id}
                  customer={customer}
                  selected={selectedPricing?.id === item.id}
                  onSelect={() => setGenerationForm({ ...generationForm, videoModel: item.videoModel, aspectRatio: item.aspectRatio })}
                />
              ))}
              {pricingOptions.length === 0 && <p className="subtle">This storefront has no enabled pricing options.</p>}
            </div>
          </div>
        </section>

        <section className="stack">
          <div className="panel panel-strong">
            <div className="panel-header">
              <h2>Render Task</h2>
              <Play size={18} />
            </div>
            <div className="render-mode-toolbar">
              <span className="subtle">Input mode</span>
              <div className="mode-toggle" role="group" aria-label="Render input mode">
                <button
                  type="button"
                  className={renderFormMode === "simple" ? "active" : ""}
                  onClick={() => openRenderFormMode("simple")}
                >
                  <ListChecks size={16} /> Simple wizard
                </button>
                <button
                  type="button"
                  className={renderFormMode === "advanced" ? "active" : ""}
                  onClick={() => openRenderFormMode("advanced")}
                >
                  <Code2 size={16} /> Advanced JSON
                </button>
              </div>
            </div>
            {renderFormMode === "simple" ? (
              <SimpleRenderForm
                form={generationForm}
                imageWizardItems={imageWizardItems}
                metadataWizardItems={metadataWizardItems}
                footerWizardItems={footerWizardItems}
                outroFocusAreaWizard={outroFocusAreaWizard}
                imageCount={imageCount}
                paymentTokens={paymentTokens}
                paymentCurrency={paymentCurrency}
                settlementToken={settlementToken}
                onPatch={updateGenerationForm}
                onPaymentCurrencySelect={setPaymentCurrency}
                onImageChange={updateImageWizardItem}
                onImageAdd={addImageWizardItem}
                onImageRemove={removeImageWizardItem}
                onMetadataChange={updateMetadataWizardItem}
                onMetadataAdd={addMetadataWizardItem}
                onMetadataRemove={removeMetadataWizardItem}
                onFooterChange={updateFooterWizardItem}
                onFooterAdd={addFooterWizardItem}
                onFooterRemove={removeFooterWizardItem}
                onFocusAreaChange={updateOutroFocusAreaWizard}
              />
            ) : (
              <AdvancedRenderForm
                form={generationForm}
                imageCount={imageCount}
                generationPayloadPreview={generationPayloadPreview}
                paymentTokens={paymentTokens}
                paymentCurrency={paymentCurrency}
                settlementToken={settlementToken}
                onPatch={updateGenerationForm}
                onPaymentCurrencySelect={setPaymentCurrency}
              />
            )}
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
              <button className="btn" onClick={createQuote} disabled={busy === "quote" || imageCount === 0 || Boolean(renderGateError)}>
                <CircleDollarSign size={16} /> Quote {paymentCurrency}
              </button>
              <button className="btn primary" onClick={runGeneration} disabled={busy === "generation" || imageCount === 0 || Boolean(renderGateError)}>
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
            {renderGateError && imageCount > 0 && <p className="notice">{renderGateError}</p>}
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
                <GenerationItem
                  key={generation.id}
                  generation={generation}
                  quote={store?.quotes.find((quote) => quote.id === generation.payment.quoteId) || null}
                  busy={busy === generation.id}
                  wallet={connectedSubAccount?.wallet || walletAddress}
                  onSync={() => syncGeneration(generation.id)}
                />
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SimpleRenderForm({
  form,
  imageWizardItems,
  metadataWizardItems,
  footerWizardItems,
  outroFocusAreaWizard,
  imageCount,
  paymentTokens,
  paymentCurrency,
  settlementToken,
  onPatch,
  onPaymentCurrencySelect,
  onImageChange,
  onImageAdd,
  onImageRemove,
  onMetadataChange,
  onMetadataAdd,
  onMetadataRemove,
  onFooterChange,
  onFooterAdd,
  onFooterRemove,
  onFocusAreaChange
}: {
  form: GenerationFormState;
  imageWizardItems: ImageWizardItem[];
  metadataWizardItems: MetadataWizardItem[];
  footerWizardItems: FooterWizardItem[];
  outroFocusAreaWizard: OutroFocusAreaWizard;
  imageCount: number;
  paymentTokens: PaymentToken[];
  paymentCurrency: PaymentCurrencySymbol;
  settlementToken: PaymentToken;
  onPatch: (patch: RenderFormPatch) => void;
  onPaymentCurrencySelect: (currency: PaymentCurrencySymbol) => void;
  onImageChange: (index: number, patch: Partial<ImageWizardItem>) => void;
  onImageAdd: () => void;
  onImageRemove: (index: number) => void;
  onMetadataChange: (index: number, patch: Partial<MetadataWizardItem>) => void;
  onMetadataAdd: () => void;
  onMetadataRemove: (index: number) => void;
  onFooterChange: (index: number, patch: Partial<FooterWizardItem>) => void;
  onFooterAdd: () => void;
  onFooterRemove: (index: number) => void;
  onFocusAreaChange: (field: keyof OutroFocusAreaWizard, value: string) => void;
}) {
  const footerCardCount = countCompletedFooterWizardItems(footerWizardItems);

  return (
    <div className="form-grid render-wizard-grid">
      <WizardSection
        title="Image scenes"
        badge={`${imageCount} ready`}
        actionLabel="Add image"
        onAction={onImageAdd}
      >
        <div className="wizard-list">
          {imageWizardItems.map((item, index) => (
            <div className="wizard-entry" key={`image-${index}`}>
              <div className="wizard-entry-title">
                <strong>Image {index + 1}</strong>
                <button type="button" className="icon-btn danger" onClick={() => onImageRemove(index)} title="Remove image">
                  <Trash2 size={16} />
                </button>
              </div>
              <div className="wizard-image-grid">
                <div className="field full">
                  <label>Image URL</label>
                  <input
                    value={item.image_url}
                    onChange={(event) => onImageChange(index, { image_url: event.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <TextField
                  label="Title"
                  value={item.title}
                  onChange={(title) => onImageChange(index, { title })}
                />
                <TextField
                  label="Image text"
                  value={item.image_text}
                  onChange={(image_text) => onImageChange(index, { image_text })}
                />
              </div>
            </div>
          ))}
        </div>
      </WizardSection>

      <div className="field full">
        <label>Prompt</label>
        <textarea value={form.prompt} onChange={(event) => onPatch({ prompt: event.target.value })} />
      </div>

      <WizardSection title="Campaign metadata" actionLabel="Add field" onAction={onMetadataAdd}>
        <div className="wizard-list">
          {metadataWizardItems.map((item, index) => (
            <div className="wizard-key-value" key={`metadata-${index}`}>
              <div className="field">
                <label>Field</label>
                <input
                  value={item.key}
                  onChange={(event) => onMetadataChange(index, { key: event.target.value })}
                  placeholder="campaign"
                />
              </div>
              <div className="field">
                <label>Value</label>
                <input
                  value={item.value}
                  onChange={(event) => onMetadataChange(index, { value: event.target.value })}
                  placeholder="customer-store"
                />
              </div>
              <button type="button" className="icon-btn danger" onClick={() => onMetadataRemove(index)} title="Remove field">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </WizardSection>

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.publishToFeed}
          onChange={(event) => onPatch({ publishToFeed: event.target.checked })}
        />
        Publish video to feed
      </label>
      <TextField label="Feed tags" value={form.feedTags} onChange={(feedTags) => onPatch({ feedTags })} />

      <PaymentMethodSelector
        tokens={paymentTokens}
        selectedSymbol={paymentCurrency}
        settlementToken={settlementToken}
        onSelect={onPaymentCurrencySelect}
      />

      <TextField label="CTA outro URL" value={form.ctaUrl} onChange={(ctaUrl) => onPatch({ ctaUrl })} />
      <TextField label="CTA top text" value={form.ctaTextTop} onChange={(ctaTextTop) => onPatch({ ctaTextTop })} />
      <TextField label="CTA bottom text" value={form.ctaTextBottom} onChange={(ctaTextBottom) => onPatch({ ctaTextBottom })} />
      <TextField label="CTA logo URL" value={form.ctaLogo} onChange={(ctaLogo) => onPatch({ ctaLogo })} />

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.addOutroAnimation}
          onChange={(event) => onPatch({ addOutroAnimation: event.target.checked })}
        />
        Server-generated outro animation
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.addOutroFocusArea}
          onChange={(event) => onPatch({ addOutroFocusArea: event.target.checked })}
        />
        Server-generated outro focus area
      </label>

      {form.addOutroFocusArea && (
        <WizardSection title="Outro focus area">
          <div className="focus-area-grid">
            {(["x", "y", "width", "height"] as Array<keyof OutroFocusAreaWizard>).map((field) => (
              <div className="field" key={field}>
                <label>{field}</label>
                <input
                  type="number"
                  min="0"
                  value={outroFocusAreaWizard[field]}
                  onChange={(event) => onFocusAreaChange(field, event.target.value)}
                />
              </div>
            ))}
          </div>
        </WizardSection>
      )}

      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.addFooterAnimation}
          onChange={(event) => onPatch({ addFooterAnimation: event.target.checked })}
        />
        Bottom CTA footer cards
      </label>

      {form.addFooterAnimation && (
        <WizardSection
          title="Footer cards"
          badge={`${footerCardCount}/${imageCount} ready`}
          actionLabel="Add card"
          onAction={onFooterAdd}
        >
          <div className="wizard-list">
            {footerWizardItems.map((item, index) => (
              <div className="wizard-key-value" key={`footer-${index}`}>
                <div className="field">
                  <label>URL</label>
                  <input
                    value={item.url}
                    onChange={(event) => onFooterChange(index, { url: event.target.value })}
                    placeholder="https://..."
                  />
                </div>
                <div className="field">
                  <label>Title</label>
                  <input
                    value={item.title}
                    onChange={(event) => onFooterChange(index, { title: event.target.value })}
                    placeholder="Launch Shoe"
                  />
                </div>
                <button type="button" className="icon-btn danger" onClick={() => onFooterRemove(index)} title="Remove card">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </WizardSection>
      )}

      <TextField label="Payment tx hash (manual fallback)" value={form.txHash} onChange={(txHash) => onPatch({ txHash })} full />
    </div>
  );
}

function AdvancedRenderForm({
  form,
  imageCount,
  generationPayloadPreview,
  paymentTokens,
  paymentCurrency,
  settlementToken,
  onPatch,
  onPaymentCurrencySelect
}: {
  form: GenerationFormState;
  imageCount: number;
  generationPayloadPreview: string;
  paymentTokens: PaymentToken[];
  paymentCurrency: PaymentCurrencySymbol;
  settlementToken: PaymentToken;
  onPatch: (patch: RenderFormPatch) => void;
  onPaymentCurrencySelect: (currency: PaymentCurrencySymbol) => void;
}) {
  return (
    <div className="form-grid">
      <div className="field full">
        <label>Image URL metadata JSON array</label>
        <textarea value={form.imageUrls} onChange={(event) => onPatch({ imageUrls: event.target.value })} />
      </div>
      <div className="field full">
        <label>JSON payload metadata</label>
        <textarea value={form.metadata} onChange={(event) => onPatch({ metadata: event.target.value })} />
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.publishToFeed}
          onChange={(event) => onPatch({ publishToFeed: event.target.checked })}
        />
        Publish video to feed
      </label>
      <TextField label="Feed tags" value={form.feedTags} onChange={(feedTags) => onPatch({ feedTags })} />
      <div className="field full">
        <label>Prompt</label>
        <textarea value={form.prompt} onChange={(event) => onPatch({ prompt: event.target.value })} />
      </div>
      <PaymentMethodSelector
        tokens={paymentTokens}
        selectedSymbol={paymentCurrency}
        settlementToken={settlementToken}
        onSelect={onPaymentCurrencySelect}
      />
      <TextField label="CTA outro URL" value={form.ctaUrl} onChange={(ctaUrl) => onPatch({ ctaUrl })} />
      <TextField label="CTA top text" value={form.ctaTextTop} onChange={(ctaTextTop) => onPatch({ ctaTextTop })} />
      <TextField label="CTA bottom text" value={form.ctaTextBottom} onChange={(ctaTextBottom) => onPatch({ ctaTextBottom })} />
      <TextField label="CTA logo URL" value={form.ctaLogo} onChange={(ctaLogo) => onPatch({ ctaLogo })} />
      <TextField label="Payment tx hash (manual fallback)" value={form.txHash} onChange={(txHash) => onPatch({ txHash })} full />
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.addOutroAnimation}
          onChange={(event) => onPatch({ addOutroAnimation: event.target.checked })}
        />
        Server-generated outro animation
      </label>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.addOutroFocusArea}
          onChange={(event) => onPatch({ addOutroFocusArea: event.target.checked })}
        />
        Server-generated outro focus area
      </label>
      <div className="field full">
        <label>Outro focus area JSON</label>
        <textarea
          value={form.outroFocusArea}
          onChange={(event) => onPatch({ outroFocusArea: event.target.value })}
        />
      </div>
      <label className="toggle-row">
        <input
          type="checkbox"
          checked={form.addFooterAnimation}
          onChange={(event) => onPatch({ addFooterAnimation: event.target.checked })}
        />
        Bottom CTA footer cards
      </label>
      <div className="field full">
        <label>Footer metadata JSON array ({imageCount} items)</label>
        <textarea
          value={form.footerMetadata}
          onChange={(event) => onPatch({ footerMetadata: event.target.value })}
        />
      </div>
      <div className="field full">
        <label>Generated SuperReferrals payload preview</label>
        <textarea className="payload-preview" value={generationPayloadPreview} readOnly />
      </div>
    </div>
  );
}

function WizardSection({
  title,
  badge,
  actionLabel,
  onAction,
  children
}: {
  title: string;
  badge?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="wizard-section full">
      <div className="wizard-section-header">
        <div>
          <label>{title}</label>
          {badge && <span className="badge">{badge}</span>}
        </div>
        {actionLabel && onAction && (
          <button type="button" className="btn small" onClick={onAction}>
            <Plus size={15} /> {actionLabel}
          </button>
        )}
      </div>
      {children}
    </div>
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
    USDC: 0,
    ETH: 1,
    WETH: 2,
    USDT: 3
  };
  return preferredOrder[token.symbol] ?? 10;
}

function resolveUserPaymentRail(paymentToken: PaymentToken, settlementToken: PaymentToken): PaymentRail {
  return paymentToken.address.toLowerCase() === settlementToken.address.toLowerCase() ? "direct" : "keeperhub";
}

function GenerationItem({
  generation,
  quote,
  busy,
  wallet,
  onSync
}: {
  generation: Generation;
  quote?: PaymentQuote | null;
  busy: boolean;
  wallet?: string;
  onSync: () => void;
}) {
  const badgeClass = generation.status === "COMPLETED" ? "badge ok" : generation.status === "FAILED" ? "badge fail" : "badge";
  const paymentSummary = formatGenerationPaymentSummary(generation, quote);
  return (
    <div className="item">
      <div className="item-title">
        <strong>{generation.id}</strong>
        <span className={badgeClass}>{generation.status}</span>
      </div>
      <p className="subtle">
        {generation.input.image_urls.length} images · {generation.input.video_model} · {generation.input.aspect_ratio} · {paymentSummary}
      </p>
      <div className="mono">{generation.samsarSessionId || "pending SuperReferrals session"}</div>
      {generation.payment.keeperExecutionId && <div className="mono">keeper {generation.payment.keeperExecutionId}</div>}
      {generation.errorMessage && <p className="subtle">{generation.errorMessage}</p>}
      <div className="button-row">
        <button className="btn" onClick={onSync} disabled={busy || generation.status === "COMPLETED"}>
          <RefreshCw size={16} /> Sync
        </button>
        {generation.inftId && <a className="btn" href={`/inft/${generation.inftId}`}><ExternalLink size={16} /> Open INFT</a>}
        {generation.feed?.published && generation.status === "COMPLETED" && <a className="btn" href="/feed"><ExternalLink size={16} /> View in feed</a>}
      </div>
      {generation.status === "COMPLETED" && (
        <StorefrontRatingForm
          customerId={generation.customerId}
          subAccountId={generation.subAccountId}
          generationId={generation.id}
          inftId={generation.inftId}
          wallet={wallet}
          operation="video_render"
          title="Rate this storefront after your render"
        />
      )}
    </div>
  );
}

function formatGenerationPaymentSummary(generation: Generation, quote?: PaymentQuote | null) {
  const settlementSymbol = quote?.settlementCurrency || generation.payment.settlementTokenSymbol || "USDC";
  const quoteSummary = `${generation.payment.amountUsd.toFixed(2)} ${settlementSymbol} quote`;
  const paymentSymbol = quote?.paymentCurrency || generation.payment.tokenSymbol;
  const paymentAmountAtomic =
    generation.payment.verification?.amountAtomic ||
    generation.payment.paymentAmountAtomic ||
    quote?.paymentAmountAtomic;
  const paymentToken = resolveGenerationPaymentToken(generation, quote);
  const paidAmount = formatAtomicAmountString(paymentAmountAtomic, paymentToken?.decimals);

  if (!paymentSymbol || !paidAmount || paymentSymbol === settlementSymbol) {
    return quoteSummary;
  }

  return `${quoteSummary} · ${paidAmount} ${paymentSymbol} paid`;
}

function resolveGenerationPaymentToken(generation: Generation, quote?: PaymentQuote | null) {
  const chainId = quote?.chainId || generation.payment.chainId || getTransactionChainConfig().id;
  return (
    findPaymentToken(quote?.paymentTokenAddress || generation.payment.tokenAddress || "", chainId) ||
    getPaymentTokens(chainId).find((token) => token.symbol === (quote?.paymentCurrency || generation.payment.tokenSymbol))
  );
}

function formatAtomicAmountString(amountAtomic?: string, decimals?: number) {
  if (!amountAtomic || decimals === undefined) {
    return "";
  }
  try {
    return formatAtomicAmount(BigInt(amountAtomic), decimals);
  } catch {
    return "";
  }
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
  if (!isUsableEvmAddress(recipient)) {
    throw new Error(`${label} recipient is missing, invalid, or the zero address. No wallet transaction was submitted.`);
  }
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

function parseImageWizardItems(raw: string): ImageWizardItem[] {
  try {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [emptyImageWizardItem()];
    }
    const parsed = trimmed.startsWith("[") ? JSON.parse(trimmed) as unknown[] : parseImageInputs(trimmed);
    if (!Array.isArray(parsed)) {
      return [emptyImageWizardItem()];
    }
    const items = parsed.map((item) => {
      if (typeof item === "string") {
        return {
          image_url: item,
          title: "",
          image_text: ""
        };
      }
      const record = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      return {
        image_url: getImageInputUrl(record),
        title: String(record.title || ""),
        image_text: String(record.image_text || record.imageText || ""),
        skip_enhancement: Boolean(record.skip_enhancement || record.skipEnhancement)
      };
    });
    return items.length > 0 ? items : [emptyImageWizardItem()];
  } catch {
    return [emptyImageWizardItem()];
  }
}

function emptyImageWizardItem(): ImageWizardItem {
  return { image_url: "", title: "", image_text: "" };
}

function serializeImageWizardItems(items: ImageWizardItem[]) {
  const payload = items
    .map((item) => ({
      image_url: item.image_url.trim(),
      title: item.title.trim(),
      image_text: item.image_text.trim(),
      skip_enhancement: item.skip_enhancement
    }))
    .filter((item) => item.image_url)
    .map((item) => {
      const output: Record<string, unknown> = { image_url: item.image_url };
      if (item.title) {
        output.title = item.title;
      }
      if (item.image_text) {
        output.image_text = item.image_text;
      }
      if (item.skip_enhancement) {
        output.skip_enhancement = true;
      }
      return output;
    });
  return JSON.stringify(payload, null, 2);
}

function parseMetadataWizardItems(raw: string): MetadataWizardItem[] {
  try {
    const parsed = parseJsonObject(raw);
    const items = Object.entries(parsed).map(([key, value]) => ({
      key,
      value: formatWizardValue(value)
    }));
    return items.length > 0 ? items : [emptyMetadataWizardItem()];
  } catch {
    return [emptyMetadataWizardItem()];
  }
}

function emptyMetadataWizardItem(): MetadataWizardItem {
  return { key: "", value: "" };
}

function serializeMetadataWizardItems(items: MetadataWizardItem[]) {
  const metadata: Record<string, unknown> = {};
  for (const item of items) {
    const key = item.key.trim();
    if (key) {
      metadata[key] = coerceWizardValue(item.value);
    }
  }
  return JSON.stringify(metadata, null, 2);
}

function parseFooterWizardItems(raw: string): FooterWizardItem[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [emptyFooterWizardItem()];
    }
    const items = parsed.map((item) => {
      const record = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      return {
        url: String(record.url || ""),
        title: String(record.title || "")
      };
    });
    return items.length > 0 ? items : [emptyFooterWizardItem()];
  } catch {
    return [emptyFooterWizardItem()];
  }
}

function emptyFooterWizardItem(): FooterWizardItem {
  return { url: "", title: "" };
}

function serializeFooterWizardItems(items: FooterWizardItem[]) {
  const payload = items
    .map((item) => ({
      url: item.url.trim(),
      title: item.title.trim()
    }))
    .filter((item) => item.url)
    .map((item) => item.title ? item : { url: item.url });
  return JSON.stringify(payload, null, 2);
}

function countCompletedFooterWizardItems(items: FooterWizardItem[]) {
  return items.filter((item) => item.url.trim()).length;
}

function parseOutroFocusAreaWizard(raw: string): OutroFocusAreaWizard {
  try {
    const parsed = parseOutroFocusArea(raw);
    return {
      x: String(parsed.x),
      y: String(parsed.y),
      width: String(parsed.width),
      height: String(parsed.height)
    };
  } catch {
    return { x: "", y: "", width: "", height: "" };
  }
}

function serializeOutroFocusAreaWizard(focusArea: OutroFocusAreaWizard) {
  return JSON.stringify({
    x: parseWizardNumber(focusArea.x),
    y: parseWizardNumber(focusArea.y),
    width: parseWizardNumber(focusArea.width),
    height: parseWizardNumber(focusArea.height)
  }, null, 2);
}

function parseWizardNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatWizardValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function coerceWizardValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "true" || trimmed === "false" || trimmed === "null" || /^-?\d+(\.\d+)?$/.test(trimmed) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
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
