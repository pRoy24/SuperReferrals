"use client";

import { Cable, Captions, ChevronDown, Copy, Download, ExternalLink, ImagePlus, Languages, Link2, Loader2, PanelBottom, RefreshCw, Send, Share2, Trash2, UploadCloud, Wallet } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import LanguageSelector from "@/components/LanguageSelector";
import StorefrontRatingForm from "@/components/StorefrontRatingForm";
import {
  detectBrowserWalletProviders,
  requestWalletAccounts,
  type BrowserWalletProvider,
  type EthereumProvider
} from "@/lib/browser-wallets";
import {
  findPaymentToken,
  getPaymentTokens,
  getTransactionChainConfig,
  normalizeTransactionChainIdForEnvironment,
  settlementTokenForCurrency,
  type PaymentToken,
  type TransactionChainConfig
} from "@/lib/payment-tokens";
import { defaultINFTActionPricesUsd } from "@/lib/pricing";
import { renditionLanguageName, resolveRenditionLanguageCode, supportedSamsarProcessorLanguageOptions } from "@/lib/rendition-language";
import { isUsableEvmAddress } from "@/lib/wallet-address";
import type { Customer, Generation, INFTPaidAction, INFTRecord, PaymentCurrencySymbol, PaymentQuote, PaymentRail, SamsarVideoRenderMetadata, SuperReferralsStore } from "@/lib/types";

type ActionPollState = {
  action: string;
  requestId: string;
  status: string;
  resultUrl?: string;
  errorMessage?: string;
  languageCode?: string;
  expectedVideoMetadata?: SamsarVideoRenderMetadata;
  expressGenerationStatus?: Record<string, string>;
};

type ActionPaymentFlow = {
  status: "idle" | "payment" | "confirming" | "starting" | "started" | "completed" | "failed";
  message: string;
  txHash?: string;
};

type VideoEditAction = "translate" | "add_subtitles" | "update_outro" | "update_footer";

const terminalActionStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]);

export default function INFTPage({ inft }: { inft: INFTRecord }) {
  const [activeInft, setActiveInft] = useState(inft);
  const [actionResult, setActionResult] = useState("");
  const [actionResultTone, setActionResultTone] = useState<"neutral" | "error">("neutral");
  const [busy, setBusy] = useState("");
  const [peerId, setPeerId] = useState("mock-peer-video-a");
  const [language, setLanguage] = useState(supportedSamsarProcessorLanguageOptions[1]?.value || "ES");
  const [translateEnableSubtitles, setTranslateEnableSubtitles] = useState(false);
  const [translateOutroText, setTranslateOutroText] = useState(true);
  const [translateFooterText, setTranslateFooterText] = useState(true);
  const [subtitleLanguage, setSubtitleLanguage] = useState("en");
  const [expandedVideoAction, setExpandedVideoAction] = useState<VideoEditAction | "">("");
  const [updateOutroMode, setUpdateOutroMode] = useState<"cta" | "image">("cta");
  const [updateOutroImageUrl, setUpdateOutroImageUrl] = useState("");
  const [updateOutroCtaUrl, setUpdateOutroCtaUrl] = useState("");
  const [updateOutroTextTop, setUpdateOutroTextTop] = useState("Scan to learn more");
  const [updateOutroTextBottom, setUpdateOutroTextBottom] = useState("");
  const [updateOutroCtaLogo, setUpdateOutroCtaLogo] = useState("");
  const [updateOutroAnimation, setUpdateOutroAnimation] = useState(true);
  const [updateOutroFocusArea, setUpdateOutroFocusArea] = useState(false);
  const [updateOutroFocusAreaJson, setUpdateOutroFocusAreaJson] = useState(JSON.stringify({ x: 680, y: 296, width: 432, height: 432 }, null, 2));
  const [updateFooterMode, setUpdateFooterMode] = useState<"update" | "remove">("update");
  const [updateFooterUrl, setUpdateFooterUrl] = useState("");
  const [updateFooterTitle, setUpdateFooterTitle] = useState("");
  const [updateFooterLogo, setUpdateFooterLogo] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [lastVideoOperation, setLastVideoOperation] = useState("");
  const [actionPoll, setActionPoll] = useState<ActionPollState | null>(null);
  const [createdInft, setCreatedInft] = useState<INFTRecord | null>(null);
  const [createdGeneration, setCreatedGeneration] = useState<Generation | null>(null);
  const [renderActionBusy, setRenderActionBusy] = useState<"publish" | "delete" | "">("");
  const [renderActionMessage, setRenderActionMessage] = useState("");
  const [store, setStore] = useState<SuperReferralsStore | null>(null);
  const [walletAddress, setWalletAddress] = useState(activeInft.ownerWallet || "");
  const [walletProviders, setWalletProviders] = useState<BrowserWalletProvider[]>([]);
  const [activeWalletProvider, setActiveWalletProvider] = useState<BrowserWalletProvider | null>(null);
  const [walletConnectedOnTransactionChain, setWalletConnectedOnTransactionChain] = useState(false);
  const [paymentCurrency, setPaymentCurrency] = useState<PaymentCurrencySymbol>("USDC");
  const [actionQuote, setActionQuote] = useState<PaymentQuote | null>(null);
  const [actionPaymentFlow, setActionPaymentFlow] = useState<ActionPaymentFlow>({ status: "idle", message: "" });
  const publicInftPath = `/inft/${activeInft.id}`;
  const updateOutroRequiredValue = updateOutroMode === "cta" ? updateOutroCtaUrl.trim() : updateOutroImageUrl.trim();
  const updateFooterRequiredValue = updateFooterMode === "remove"
    ? "remove"
    : updateFooterUrl.trim() || updateFooterTitle.trim() || updateFooterLogo.trim();

  useEffect(() => {
    setActiveInft(inft);
    setCreatedInft(null);
    setCreatedGeneration(null);
    setRenderActionMessage("");
  }, [inft]);

  async function loadStore() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const data = await response.json();
    setStore(data);
  }

  useEffect(() => {
    loadStore().catch((error) => setActionPaymentFlow({
      status: "failed",
      message: error instanceof Error ? error.message : "Unable to load storefront payment settings."
    }));
  }, []);

  const customer = useMemo(
    () => store?.customers.find((item) => item.id === activeInft.customerId) || null,
    [store, activeInft.customerId]
  );
  const transactionChain = useMemo(
    () => getTransactionChainConfig(normalizeTransactionChainIdForEnvironment(customer?.pricing.chainId)),
    [customer?.pricing.chainId]
  );
  const paymentTokens = useMemo(() => getPaymentTokens(transactionChain.id), [transactionChain.id]);
  const selectablePaymentTokens = useMemo(
    () => [...paymentTokens].sort((left, right) => paymentTokenRank(left) - paymentTokenRank(right)),
    [paymentTokens]
  );
  const selectedPaymentToken = selectablePaymentTokens.find((token) => token.symbol === paymentCurrency) || selectablePaymentTokens[0];
  const settlementToken =
    findPaymentToken(customer?.pricing.settlementTokenAddress || "", transactionChain.id) ||
    settlementTokenForCurrency(customer?.pricing.currency || "USDC", transactionChain.id) ||
    selectedPaymentToken;
  const paymentRail = useMemo(
    () => selectedPaymentToken && settlementToken ? resolveUserPaymentRail(selectedPaymentToken, settlementToken) : "direct",
    [selectedPaymentToken, settlementToken]
  );
  const actionRenderPending = Boolean(actionPoll && !terminalActionStatuses.has(actionPoll.status.toUpperCase()));
  const actionFlowPending = ["payment", "confirming", "starting", "started"].includes(actionPaymentFlow.status);
  const videoOperationPending = actionRenderPending || actionFlowPending;
  const videoActionDisabled = Boolean(busy) || videoOperationPending;
  const walletActionLabel = walletConnectedOnTransactionChain ? "Switch wallet" : "Connect wallet";
  const metadataItems = useMemo(() => buildINFTMetadataItems(activeInft), [activeInft]);
  const showActionReview = Boolean(lastVideoOperation && actionPoll?.status.toUpperCase() === "COMPLETED");

  useEffect(() => {
    const firstToken = selectablePaymentTokens[0];
    if (firstToken && !selectablePaymentTokens.some((token) => token.symbol === paymentCurrency)) {
      setPaymentCurrency(firstToken.symbol);
      setActionQuote(null);
    }
  }, [paymentCurrency, selectablePaymentTokens]);

  useEffect(() => {
    if (!actionPoll?.requestId || terminalActionStatuses.has(actionPoll.status.toUpperCase())) {
      return;
    }
    const pollRequestId = actionPoll.requestId;
    const pollAction = actionPoll.action;
    const pollLanguageCode = actionPoll.languageCode;
    const pollExpectedVideoMetadata = actionPoll.expectedVideoMetadata;
    let cancelled = false;

    async function pollActionStatus() {
      try {
        const response = await fetch(`/api/infts/${activeInft.id}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "action_status",
            payload: {
              requestId: pollRequestId,
              sourceAction: pollAction,
              ...(pollLanguageCode ? { languageCode: pollLanguageCode } : {}),
              ...(pollExpectedVideoMetadata ? { expectedVideoMetadata: pollExpectedVideoMetadata } : {})
            }
          })
        });
        const data = await parseResponse(response);
        const result = data.result as Record<string, unknown>;
        const nextStatus = extractActionStatus(result);
        const nextResultUrl = extractActionResultUrl(result);
        const finalization = isRecord(result.finalization) ? result.finalization : undefined;
        const finalizationError = firstStringValue(finalization, "errorMessage", "message");
        const nextErrorMessage = extractActionError(result) || finalizationError;
        const nextExpressStatus = extractExpressGenerationStatus(result);
        const finalizedInft = isRecord(result.inft) ? result.inft as unknown as INFTRecord : undefined;
        const finalizedGeneration = extractGeneration(result);
        if (!cancelled) {
          if (finalizedInft) {
            setCreatedInft(finalizedInft);
          }
          if (finalizedGeneration) {
            setCreatedGeneration(finalizedGeneration);
          }
          setActionPoll((current) => {
            if (!current || current.requestId !== pollRequestId) {
              return current;
            }
            return {
              ...current,
              status: nextStatus || current.status || "PROCESSING",
              resultUrl: nextResultUrl || current.resultUrl,
              errorMessage: nextErrorMessage,
              expressGenerationStatus: nextExpressStatus || current.expressGenerationStatus
            };
          });
          if (nextStatus === "COMPLETED") {
            setActionPaymentFlow({
              status: finalizationError ? "failed" : "completed",
              message: finalizationError ||
                (nextResultUrl
                ? `${formatActionLabel(pollAction)} completed and a new INFT was created.`
                : `${formatActionLabel(pollAction)} completed.`)
            });
            await loadStore().catch(() => undefined);
          }
          if (nextStatus && terminalActionStatuses.has(nextStatus) && nextStatus !== "COMPLETED") {
            setActionPaymentFlow({
              status: "failed",
              message: nextErrorMessage || `${formatActionLabel(pollAction)} ended with status ${nextStatus}.`
            });
          }
        }
      } catch (error) {
        if (!cancelled) {
          setActionPoll((current) => {
            if (!current || current.requestId !== pollRequestId) {
              return current;
            }
            return {
              ...current,
              errorMessage: error instanceof Error ? error.message : "Unable to poll action status"
            };
          });
        }
      }
    }

    pollActionStatus().catch(() => undefined);
    const interval = window.setInterval(() => {
      pollActionStatus().catch(() => undefined);
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [actionPoll?.action, actionPoll?.expectedVideoMetadata, actionPoll?.languageCode, actionPoll?.requestId, actionPoll?.status, activeInft.id]);

  useEffect(() => {
    let cancelled = false;
    let detectedProviders: BrowserWalletProvider[] = [];
    const cleanups: Array<() => void> = [];

    async function inspectConnectedWallet(providers: BrowserWalletProvider[]) {
      const connected = await findConnectedWalletOnChain(providers, transactionChain);
      if (cancelled) {
        return;
      }
      if (!connected) {
        setWalletConnectedOnTransactionChain(false);
        return;
      }
      setActiveWalletProvider(connected.walletProvider);
      setWalletAddress(connected.account);
      setWalletConnectedOnTransactionChain(true);
    }

    async function initializeWalletState() {
      const detected = await detectBrowserWalletProviders();
      if (cancelled) {
        return;
      }
      detectedProviders = detected;
      setWalletProviders(detected);
      const refreshWalletState = () => {
        inspectConnectedWallet(detectedProviders).catch(() => undefined);
      };
      const listeningProviders = new Set<EthereumProvider>();
      for (const walletProvider of detected) {
        const provider = walletProvider.provider;
        if (listeningProviders.has(provider)) {
          continue;
        }
        listeningProviders.add(provider);
        provider.on?.("accountsChanged", refreshWalletState);
        provider.on?.("chainChanged", refreshWalletState);
        cleanups.push(() => {
          provider.removeListener?.("accountsChanged", refreshWalletState);
          provider.removeListener?.("chainChanged", refreshWalletState);
        });
      }
      await inspectConnectedWallet(detected);
    }

    initializeWalletState().catch(() => undefined);
    return () => {
      cancelled = true;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [transactionChain]);

  function getPublicInftUrl() {
    if (typeof window === "undefined") {
      return publicInftPath;
    }
    return new URL(publicInftPath, window.location.origin).toString();
  }

  async function copyInftUrl() {
    try {
      await navigator.clipboard.writeText(getPublicInftUrl());
      setShareMessage("INFT URL copied.");
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "Unable to copy INFT URL.");
    }
  }

  async function shareInft() {
    const url = getPublicInftUrl();
    try {
      if (navigator.share) {
        await navigator.share({
          title: activeInft.title,
          text: activeInft.description,
          url
        });
        setShareMessage("Share sheet opened.");
        return;
      }
      await navigator.clipboard.writeText(url);
      setShareMessage("INFT URL copied.");
    } catch (error) {
      setShareMessage(error instanceof Error ? error.message : "Unable to share INFT.");
    }
  }

  function shareOnX() {
    if (typeof window === "undefined") {
      return;
    }
    const url = getPublicInftUrl();
    const shareUrl = new URL("https://twitter.com/intent/tweet");
    shareUrl.searchParams.set("text", activeInft.title);
    shareUrl.searchParams.set("url", url);
    window.open(shareUrl.toString(), "_blank", "noopener,noreferrer");
  }

  function selectedEthereumProvider(walletProvider?: BrowserWalletProvider, detectedProviders = walletProviders) {
    const selected = walletProvider || activeWalletProvider || detectedProviders[0] || null;
    return {
      walletProvider: selected,
      provider: selected?.provider || window.ethereum
    };
  }

  function showActionResult(message: string, tone: "neutral" | "error" = "neutral") {
    setActionResult(message);
    setActionResultTone(tone);
  }

  function showActionError(error: unknown, fallback: string) {
    showActionResult(error instanceof Error ? error.message : fallback, "error");
  }

  function clearActionResult() {
    showActionResult("");
  }

  async function connectWallet(walletProvider?: BrowserWalletProvider) {
    setBusy("wallet");
    setActionPaymentFlow({ status: "idle", message: "" });
    let providersForReconnectCheck = walletProvider ? [walletProvider] : walletProviders;
    try {
      const shouldDetectProviders = !walletProvider && walletProviders.length === 0;
      const detectedProviders = shouldDetectProviders
        ? await detectBrowserWalletProviders()
        : walletProviders;
      providersForReconnectCheck = walletProvider ? [walletProvider] : detectedProviders;
      if (shouldDetectProviders && detectedProviders.length > 0) {
        setWalletProviders(detectedProviders);
      }
      const selected = selectedEthereumProvider(walletProvider, detectedProviders);
      if (!selected.provider) {
        throw new Error("No injected wallet detected. Open this page in a wallet-enabled browser or enter a wallet address.");
      }
      const accounts = await requestWalletAccounts(selected.provider, { forceAccountSelection: true });
      const firstAccount = accounts[0] || "";
      if (!firstAccount) {
        throw new Error("Wallet did not return an account.");
      }
      await ensureWalletNetwork(selected.provider, transactionChain);
      setActiveWalletProvider(selected.walletProvider);
      setWalletAddress(firstAccount);
      setWalletConnectedOnTransactionChain(true);
      setActionQuote(null);
      setActionPaymentFlow({
        status: "idle",
        message: `Wallet connected on ${transactionChain.name}.`
      });
    } catch (error) {
      const connected = await findConnectedWalletOnChain(providersForReconnectCheck, transactionChain).catch(() => null);
      if (connected) {
        setActiveWalletProvider(connected.walletProvider);
        setWalletAddress(connected.account);
        setWalletConnectedOnTransactionChain(true);
      } else {
        setWalletConnectedOnTransactionChain(false);
      }
      setActionPaymentFlow({
        status: "failed",
        message: error instanceof Error ? error.message : "Wallet connection failed."
      });
    } finally {
      setBusy("");
    }
  }

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    if (videoOperationPending && action !== "message_peer") {
      showActionResult("Wait for the current video operation to finish before starting another one.", "error");
      return;
    }
    setBusy(action);
    if (action !== "message_peer") {
      setCreatedInft(null);
      setCreatedGeneration(null);
      setRenderActionMessage("");
    }
    try {
      const languageCode = actionLanguageCode(action, payload);
      const response = await fetch(`/api/infts/${activeInft.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload })
      });
      const data = await parseResponse(response);
      if (action === "message_peer") {
        showActionResult(JSON.stringify(data.result, null, 2));
      } else {
        clearActionResult();
      }
      if (action !== "message_peer") {
        setLastVideoOperation(action);
        const requestId = extractActionRequestId(data.result);
        if (requestId) {
          const expectedVideoMetadata = extractExpectedVideoMetadata(data.result) || expectedVideoMetadataForAction(action, payload);
          setActionPoll({
            action,
            requestId,
            status: extractActionStatus(data.result) || "QUEUED",
            resultUrl: extractActionResultUrl(data.result),
            errorMessage: extractActionError(data.result),
            languageCode,
            expectedVideoMetadata,
            expressGenerationStatus: extractExpressGenerationStatus(data.result)
          });
        }
      }
    } catch (error) {
      showActionError(error, "Action failed");
    } finally {
      setBusy("");
    }
  }

  function quoteMatchesAction(activeQuote: PaymentQuote | null, action: INFTPaidAction, paymentToken: PaymentToken) {
    return Boolean(
      activeQuote &&
      activeQuote.inftId === activeInft.id &&
      activeQuote.operation === action &&
      activeQuote.chainId === transactionChain.id &&
      activeQuote.paymentTokenAddress?.toLowerCase() === paymentToken.address.toLowerCase() &&
      activeQuote.settlementTokenAddress?.toLowerCase() === settlementToken?.address.toLowerCase()
    );
  }

  function paymentTokenForCurrency(currency: PaymentCurrencySymbol) {
    return selectablePaymentTokens.find((token) => token.symbol === currency) || selectedPaymentToken;
  }

  async function requestActionQuote(action: INFTPaidAction, paymentToken: PaymentToken) {
    if (!customer || !settlementToken) {
      throw new Error("Storefront payment settings are not available.");
    }
    if (!isUsableEvmAddress(walletAddress)) {
      throw new Error("Connect or enter a valid payer wallet before requesting an action quote.");
    }
    const requestedPaymentRail = resolveUserPaymentRail(paymentToken, settlementToken);
    const response = await fetch("/api/payments/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        subAccountId: activeInft.subAccountId,
        inftId: activeInft.id,
        action,
        tokenIn: paymentToken.address,
        tokenOut: settlementToken.address,
        paymentCurrency: paymentToken.symbol,
        settlementCurrency: settlementToken.symbol,
        paymentRail: requestedPaymentRail,
        swapper: walletAddress,
        chainId: transactionChain.id
      })
    });
    const data = await parseResponse(response);
    setActionQuote(data.quote);
    return data.quote as PaymentQuote;
  }

  async function executePaymentForAction(activeQuote: PaymentQuote) {
    if (!customer || !selectedPaymentToken || !settlementToken) {
      throw new Error("Storefront payment settings are not available.");
    }
    const walletProvider = selectedEthereumProvider();
    if (!walletProvider.provider) {
      throw new Error("A wallet transaction is required before running this INFT operation.");
    }
    if (!activeQuote.settlementAmountAtomic) {
      throw new Error("Quote did not include a settlement amount.");
    }
    await ensureWalletNetwork(walletProvider.provider, transactionChain);
    const paymentToken = findPaymentToken(activeQuote.paymentTokenAddress || "", transactionChain.id) || selectedPaymentToken;
    const activeSettlementToken =
      findPaymentToken(activeQuote.settlementTokenAddress || "", transactionChain.id) || settlementToken;
    const sameToken = paymentToken.address.toLowerCase() === activeSettlementToken.address.toLowerCase();
    const paymentAmountAtomic = activeQuote.paymentAmountAtomic || activeQuote.settlementAmountAtomic;
    const paymentRecipient = activeQuote.paymentRecipientAddress || customer.ownerWallet;
    if (!isUsableEvmAddress(paymentRecipient)) {
      throw new Error("Quote did not include a valid payment recipient.");
    }

    if (activeQuote.paymentRail === "uniswap" && !sameToken) {
      setActionPaymentFlow({ status: "payment", message: "Requesting Uniswap swap transaction from the wallet." });
      const swapTxHash = await requestUniswapSwap(walletProvider.provider, activeQuote, walletAddress, transactionChain.name);
      setActionPaymentFlow({
        status: "confirming",
        message: `Swap ${shortHash(swapTxHash)} submitted. Waiting for settlement tokens before transfer.`,
        txHash: swapTxHash
      });
      const swapReceipt = await waitForWalletReceipt(walletProvider.provider, swapTxHash, 120000);
      if (!swapReceipt) {
        throw new Error("Timed out waiting for the swap transaction to mine.");
      }
      if (!isSuccessfulReceipt(swapReceipt)) {
        throw new Error("Swap transaction reverted; INFT operation was not started.");
      }
      setActionPaymentFlow({ status: "payment", message: "Swap mined. Requesting settlement transfer.", txHash: swapTxHash });
      const settlementTxHash = await requestTokenTransfer({
        provider: walletProvider.provider,
        from: walletAddress,
        token: activeSettlementToken,
        recipient: paymentRecipient,
        amountAtomic: activeQuote.settlementAmountAtomic,
        label: "Settlement transfer",
        chainName: transactionChain.name
      });
      setActionPaymentFlow({
        status: "confirming",
        message: `Settlement transfer ${shortHash(settlementTxHash)} submitted. Waiting for confirmation.`,
        txHash: settlementTxHash
      });
      const settlementReceipt = await waitForWalletReceipt(walletProvider.provider, settlementTxHash, 120000);
      if (!settlementReceipt) {
        throw new Error("Timed out waiting for the settlement transfer to mine.");
      }
      if (!isSuccessfulReceipt(settlementReceipt)) {
        throw new Error("Settlement transfer reverted; INFT operation was not started.");
      }
      return settlementTxHash;
    }

    if (!sameToken && activeQuote.paymentRail !== "keeperhub") {
      throw new Error("Selected payment token differs from the settlement token. Choose a KeeperHub token or pay directly with the settlement token.");
    }

    const transferToken = sameToken ? activeSettlementToken : paymentToken;
    const transferAmount = sameToken ? activeQuote.settlementAmountAtomic : paymentAmountAtomic;
    const label = sameToken ? "Payment transfer" : "KeeperHub payment";
    setActionPaymentFlow({
      status: "payment",
      message: sameToken
        ? `Requesting ${transferToken.symbol} payment for ${formatActionLabel(activeQuote.operation || "operation")}.`
        : `Requesting ${transferToken.symbol} payment for KeeperHub ${activeSettlementToken.symbol} settlement.`
    });
    const txHash = await requestTokenTransfer({
      provider: walletProvider.provider,
      from: walletAddress,
      token: transferToken,
      recipient: paymentRecipient,
      amountAtomic: transferAmount,
      label,
      chainName: transactionChain.name
    });
    setActionPaymentFlow({
      status: "confirming",
      message: `${label} ${shortHash(txHash)} submitted. Waiting for confirmation.`,
      txHash
    });
    const receipt = await waitForWalletReceipt(walletProvider.provider, txHash, 120000);
    if (!receipt) {
      throw new Error("Timed out waiting for the payment transaction to mine.");
    }
    if (!isSuccessfulReceipt(receipt)) {
      throw new Error("Payment transaction reverted; INFT operation was not started.");
    }
    return txHash;
  }

  async function runPaidAction(action: INFTPaidAction, payload: Record<string, unknown> = {}) {
    if (videoOperationPending) {
      setActionPaymentFlow({
        status: "started",
        message: "Wait for the current video operation to finish before starting another one."
      });
      return;
    }
    setBusy(action);
    setActionPoll(null);
    setCreatedInft(null);
    setCreatedGeneration(null);
    setRenderActionMessage("");
    setActionPaymentFlow({ status: "payment", message: "Preparing payment quote." });
    try {
      const languageCode = actionLanguageCode(action, payload);
      if (!selectedPaymentToken) {
        throw new Error("No supported payment token is available.");
      }
      const paymentToken = paymentTokenForCurrency(paymentCurrency);
      if (!paymentToken) {
        throw new Error("No supported payment token is available.");
      }
      setPaymentCurrency(paymentToken.symbol);
      const activeQuote = quoteMatchesAction(actionQuote, action, paymentToken)
        ? actionQuote as PaymentQuote
        : await requestActionQuote(action, paymentToken);
      const txHash = await executePaymentForAction(activeQuote);
      setActionPaymentFlow({
        status: "starting",
        message: `Payment ${shortHash(txHash)} confirmed. Starting ${formatActionLabel(action)}.`,
        txHash
      });
      const response = await fetch(`/api/infts/${activeInft.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          payload: {
            ...payload,
            payment: {
              quoteId: activeQuote.id,
              txHash,
              payerWallet: walletAddress,
              amountUsd: activeQuote.totalUsd,
              tokenAddress: activeQuote.paymentTokenAddress,
              tokenSymbol: activeQuote.paymentCurrency,
              paymentRail: activeQuote.paymentRail,
              paymentAmountAtomic: activeQuote.paymentAmountAtomic,
              paymentRecipientAddress: activeQuote.paymentRecipientAddress,
              settlementTokenAddress: activeQuote.settlementTokenAddress,
              settlementCurrency: activeQuote.settlementCurrency,
              settlementAmountAtomic: activeQuote.settlementAmountAtomic,
              chainId: activeQuote.chainId,
              route: activeQuote.route
            }
          }
        })
      });
      const data = await parseResponse(response);
      clearActionResult();
      setLastVideoOperation(action);
      const requestId = extractActionRequestId(data.result);
      if (requestId) {
        const expectedVideoMetadata = extractExpectedVideoMetadata(data.result) || expectedVideoMetadataForAction(action, payload);
        setActionPoll({
          action,
          requestId,
          status: extractActionStatus(data.result) || "QUEUED",
          resultUrl: extractActionResultUrl(data.result),
          errorMessage: extractActionError(data.result),
          languageCode,
          expectedVideoMetadata,
          expressGenerationStatus: extractExpressGenerationStatus(data.result)
        });
      }
      setActionPaymentFlow({
        status: "started",
        message: `${formatActionLabel(action)} started after ${shortHash(txHash)}. Waiting for render completion before enabling another video operation.`,
        txHash
      });
      await loadStore().catch(() => undefined);
    } catch (error) {
      setActionPaymentFlow({
        status: "failed",
        message: error instanceof Error ? error.message : "Paid INFT action failed."
      });
      showActionError(error, "Paid INFT action failed");
    } finally {
      setBusy("");
    }
  }

  function buildUpdateOutroPayload() {
    const payload: Record<string, unknown> = {
      add_outro_animation: updateOutroAnimation
    };

    if (updateOutroMode === "image") {
      const imageUrl = updateOutroImageUrl.trim();
      if (!imageUrl) {
        throw new Error("New outro image URL is required.");
      }
      payload.new_outro_image_url = imageUrl;
      payload.add_outro_focus_area = updateOutroFocusArea;
      if (updateOutroFocusArea) {
        payload.add_outro_animation = true;
      }
      if (updateOutroFocusArea) {
        payload.outro_focust_area = parseOutroFocusArea(updateOutroFocusAreaJson);
      }
    } else {
      const ctaUrl = updateOutroCtaUrl.trim();
      if (!ctaUrl) {
        throw new Error("CTA URL is required.");
      }
      payload.generate_outro_image = true;
      payload.cta_url = ctaUrl;
      if (updateOutroTextTop.trim()) payload.cta_text_top = updateOutroTextTop.trim();
      if (updateOutroTextBottom.trim()) payload.cta_text_bottom = updateOutroTextBottom.trim();
      if (updateOutroCtaLogo.trim()) payload.cta_logo = updateOutroCtaLogo.trim();
    }
    return payload;
  }

  function updateOutro() {
    let payload: Record<string, unknown>;
    try {
      payload = buildUpdateOutroPayload();
    } catch (error) {
      showActionError(error, "Invalid outro update input");
      return;
    }
    runPaidAction("update_outro", payload).catch(() => undefined);
  }

  function buildUpdateFooterPayload() {
    if (updateFooterMode === "remove") {
      return {
        mode: "remove",
        remove_footer: true
      };
    }
    const footerUrl = updateFooterUrl.trim();
    const footerText = updateFooterTitle.trim();
    const footerLogo = updateFooterLogo.trim();
    if (!footerUrl && !footerText && !footerLogo) {
      throw new Error("Footer text, logo, or URL is required.");
    }
    return {
      mode: "update",
      ...(footerText ? { cta_text: footerText } : {}),
      ...(footerLogo ? { cta_logo: footerLogo } : {}),
      ...(footerUrl ? { cta_url: footerUrl } : {})
    };
  }

  function updateFooter() {
    let payload: Record<string, unknown>;
    try {
      payload = buildUpdateFooterPayload();
    } catch (error) {
      showActionError(error, "Invalid footer update input");
      return;
    }
    runPaidAction("update_footer", payload).catch(() => undefined);
  }

  function toggleVideoAction(action: VideoEditAction) {
    setExpandedVideoAction((current) => current === action ? "" : action);
    setActionQuote(null);
  }

  function addSubtitles() {
    const cleanLanguage = subtitleLanguage.trim();
    runPaidAction("add_subtitles", cleanLanguage ? { language: cleanLanguage } : {}).catch(() => undefined);
  }

  async function mutateCreatedRender(action: "publish" | "delete") {
    const generation = createdGeneration || (createdInft ? store?.generations.find((item) => item.id === createdInft.generationId) || null : null);
    const generationId = generation?.id || createdInft?.generationId || "";
    if (!generationId) {
      setRenderActionMessage("Render finalization is still finishing.");
      return;
    }
    setRenderActionBusy(action);
    setRenderActionMessage("");
    try {
      const response = await fetch(`/api/generations/${encodeURIComponent(generationId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          subAccountId: generation?.subAccountId || createdInft?.subAccountId || activeInft.subAccountId,
          wallet: createdInft?.ownerWallet || activeInft.ownerWallet
        })
      });
      const data = await parseResponse(response);
      if (action === "delete") {
        setCreatedGeneration(null);
        setCreatedInft(null);
        setActionPoll(null);
        setRenderActionMessage("Render deleted.");
        setActionPaymentFlow({ status: "idle", message: "Render deleted." });
      } else {
        const nextGeneration = extractGeneration(data);
        if (nextGeneration) {
          setCreatedGeneration(nextGeneration);
        }
        setRenderActionMessage("Render published.");
      }
      await loadStore().catch(() => undefined);
    } catch (error) {
      setRenderActionMessage(error instanceof Error ? error.message : "Unable to update render.");
    } finally {
      setRenderActionBusy("");
    }
  }

  return (
    <main className="inft-layout">
      <div className="topbar">
        <div>
          <div className="eyebrow">INFT Viewer</div>
          <h1>{activeInft.title}</h1>
          <p className="subtle">{activeInft.description}</p>
        </div>
        <div className="page-top-actions">
          <LanguageSelector />
          <BreadcrumbNav />
          <a className="btn" href="/">
            <RefreshCw size={16} /> Dashboard
          </a>
        </div>
      </div>

      <div className="inft-grid">
        <section className="stack">
          <div className="panel">
            <video className="video" src={activeInft.videoUrl} controls />
            <div className="button-row">
              <a className="btn primary" href={activeInft.videoUrl} download target="_blank" rel="noreferrer">
                <Download size={16} /> Download video
              </a>
              <button className="btn" onClick={shareInft}>
                <Share2 size={16} /> Share
              </button>
              <button className="btn" onClick={shareOnX}>
                <Share2 size={16} /> Share on X
              </button>
              <span className="badge ok">token #{activeInft.tokenId}</span>
              <span className="badge">{activeInft.referrer.code}</span>
              {activeInft.referrer.ensName && <span className="badge">{activeInft.referrer.ensName}</span>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Video Actions</h2>
              <Cable size={18} />
            </div>
            <div className="inft-wallet-action-row">
              <TextField
                label="Payer wallet"
                value={walletAddress}
                onChange={(value) => {
                  setWalletAddress(value);
                  setActionQuote(null);
                }}
              />
              <button className="btn" onClick={() => connectWallet()} disabled={busy === "wallet"}>
                <Wallet size={16} /> {walletActionLabel}
              </button>
            </div>
            {selectedPaymentToken && settlementToken && (
              <INFTActionPaymentSummary
                quote={actionQuote}
                transactionChain={transactionChain}
                selectedPaymentToken={selectedPaymentToken}
                settlementToken={settlementToken}
                paymentRail={paymentRail}
              />
            )}
            {actionQuote && (
              <div className="button-row">
                <span className="badge ok">
                  {actionQuote.totalUsd.toFixed(2)} {actionQuote.settlementCurrency || "USDC"} quote · pay {formatQuotePaymentAmount(actionQuote, selectedPaymentToken)}
                </span>
                {actionQuote.checkoutUrl && actionQuote.paymentRail === "uniswap" && (
                  <a className="btn" href={actionQuote.checkoutUrl} target="_blank" rel="noreferrer">
                    <ExternalLink size={16} /> Open Uniswap
                  </a>
                )}
              </div>
            )}
            {actionPaymentFlow.message && (
              <p className={`notice ${actionPaymentFlow.status === "failed" ? "error" : ""}`}>
                {actionPaymentFlow.message}
              </p>
            )}
            <div className="inft-action-picker" role="tablist" aria-label="INFT edit video actions">
              <button
                className={`inft-action-choice ${expandedVideoAction === "translate" ? "active" : ""}`}
                type="button"
                onClick={() => toggleVideoAction("translate")}
                disabled={videoActionDisabled || !selectedPaymentToken || !settlementToken}
                aria-expanded={expandedVideoAction === "translate"}
              >
                <Languages size={16} />
                <span>Retranslate</span>
                <small>{formatActionPrice(customer, "translate", settlementToken?.symbol)}</small>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <button
                className={`inft-action-choice ${expandedVideoAction === "add_subtitles" ? "active" : ""}`}
                type="button"
                onClick={() => toggleVideoAction("add_subtitles")}
                disabled={videoActionDisabled || !selectedPaymentToken || !settlementToken}
                aria-expanded={expandedVideoAction === "add_subtitles"}
              >
                <Captions size={16} />
                <span>Add Subtitles</span>
                <small>{formatActionPrice(customer, "add_subtitles", settlementToken?.symbol)}</small>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <button
                className={`inft-action-choice ${expandedVideoAction === "update_outro" ? "active" : ""}`}
                type="button"
                onClick={() => toggleVideoAction("update_outro")}
                disabled={videoActionDisabled || !selectedPaymentToken || !settlementToken}
                aria-expanded={expandedVideoAction === "update_outro"}
              >
                <ImagePlus size={16} />
                <span>Update Outro</span>
                <small>{formatActionPrice(customer, "update_outro", settlementToken?.symbol)}</small>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
              <button
                className={`inft-action-choice ${expandedVideoAction === "update_footer" ? "active" : ""}`}
                type="button"
                onClick={() => toggleVideoAction("update_footer")}
                disabled={videoActionDisabled || !selectedPaymentToken || !settlementToken}
                aria-expanded={expandedVideoAction === "update_footer"}
              >
                <PanelBottom size={16} />
                <span>Update Footer</span>
                <small>{formatActionPrice(customer, "update_footer", settlementToken?.symbol)}</small>
                <ChevronDown size={16} aria-hidden="true" />
              </button>
            </div>
            {expandedVideoAction && selectedPaymentToken && settlementToken && (
              <div className="inft-action-detail">
                {expandedVideoAction === "translate" && (
                  <div className="form-grid">
                    <SelectField
                      label="Target language"
                      value={language}
                      options={supportedSamsarProcessorLanguageOptions}
                      onChange={setLanguage}
                    />
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={translateEnableSubtitles}
                        onChange={(event) => setTranslateEnableSubtitles(event.target.checked)}
                      />
                      Enable subtitles
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={translateOutroText}
                        onChange={(event) => setTranslateOutroText(event.target.checked)}
                      />
                      Translate outro text
                    </label>
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={translateFooterText}
                        onChange={(event) => setTranslateFooterText(event.target.checked)}
                      />
                      Translate footer text
                    </label>
                    <INFTActionPayControl
                      icon={<Languages size={16} />}
                      label="Retranslate"
                      price={formatActionPrice(customer, "translate", settlementToken.symbol)}
                      tokens={selectablePaymentTokens}
                      selectedSymbol={paymentCurrency}
                      settlementToken={settlementToken}
                      disabled={videoActionDisabled}
                      busy={busy === "translate"}
                      primary
                      onSelect={(symbol) => {
                        setPaymentCurrency(symbol);
                        setActionQuote(null);
                      }}
                      onPay={() => runPaidAction("translate", {
                        languageCode: language,
                        enable_subtitles: translateEnableSubtitles,
                        translate_outro: translateOutroText,
                        translate_footer: translateFooterText
                      })}
                    />
                  </div>
                )}
                {expandedVideoAction === "add_subtitles" && (
                  <div className="form-grid">
                    <TextField label="Subtitle language" value={subtitleLanguage} onChange={setSubtitleLanguage} />
                    <INFTActionPayControl
                      icon={<Captions size={16} />}
                      label="Add Subtitles"
                      price={formatActionPrice(customer, "add_subtitles", settlementToken.symbol)}
                      tokens={selectablePaymentTokens}
                      selectedSymbol={paymentCurrency}
                      settlementToken={settlementToken}
                      disabled={videoActionDisabled}
                      busy={busy === "add_subtitles"}
                      primary
                      onSelect={(symbol) => {
                        setPaymentCurrency(symbol);
                        setActionQuote(null);
                      }}
                      onPay={addSubtitles}
                    />
                  </div>
                )}
                {expandedVideoAction === "update_outro" && (
                  <div className="form-grid">
                    <SelectField
                      label="Update mode"
                      value={updateOutroMode}
                      options={[
                        { value: "cta", label: "Generate CTA outro" },
                        { value: "image", label: "Use image URL" }
                      ]}
                      onChange={(value) => setUpdateOutroMode(value as "cta" | "image")}
                    />
                    {updateOutroMode === "image" ? (
                      <TextField label="New outro image URL" value={updateOutroImageUrl} onChange={setUpdateOutroImageUrl} full />
                    ) : (
                      <>
                        <TextField label="CTA URL" value={updateOutroCtaUrl} onChange={setUpdateOutroCtaUrl} full />
                        <TextField label="Top text" value={updateOutroTextTop} onChange={setUpdateOutroTextTop} />
                        <TextField label="Bottom text" value={updateOutroTextBottom} onChange={setUpdateOutroTextBottom} />
                        <TextField label="CTA logo URL" value={updateOutroCtaLogo} onChange={setUpdateOutroCtaLogo} full />
                      </>
                    )}
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={updateOutroAnimation}
                        disabled={updateOutroMode === "image" && updateOutroFocusArea}
                        onChange={(event) => setUpdateOutroAnimation(event.target.checked)}
                      />
                      Animate outro update
                    </label>
                    {updateOutroMode === "image" && (
                      <>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={updateOutroFocusArea}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setUpdateOutroFocusArea(checked);
                              if (checked) {
                                setUpdateOutroAnimation(true);
                              }
                            }}
                          />
                          Add outro focus area
                        </label>
                        {updateOutroFocusArea && (
                          <TextAreaField
                            label="Outro focus area JSON"
                            value={updateOutroFocusAreaJson}
                            onChange={setUpdateOutroFocusAreaJson}
                            full
                          />
                        )}
                      </>
                    )}
                    <INFTActionPayControl
                      icon={<ImagePlus size={16} />}
                      label="Update Outro"
                      price={formatActionPrice(customer, "update_outro", settlementToken.symbol)}
                      tokens={selectablePaymentTokens}
                      selectedSymbol={paymentCurrency}
                      settlementToken={settlementToken}
                      disabled={videoActionDisabled || !updateOutroRequiredValue}
                      busy={busy === "update_outro"}
                      primary
                      onSelect={(symbol) => {
                        setPaymentCurrency(symbol);
                        setActionQuote(null);
                      }}
                      onPay={updateOutro}
                    />
                  </div>
                )}
                {expandedVideoAction === "update_footer" && (
                  <div className="form-grid">
                    <SelectField
                      label="Footer action"
                      value={updateFooterMode}
                      options={[
                        { value: "update", label: "Update footer" },
                        { value: "remove", label: "Remove footer" }
                      ]}
                      onChange={(value) => setUpdateFooterMode(value as "update" | "remove")}
                    />
                    {updateFooterMode === "update" && (
                      <>
                        <TextField label="Footer text" value={updateFooterTitle} onChange={setUpdateFooterTitle} />
                        <TextField label="Footer URL" value={updateFooterUrl} onChange={setUpdateFooterUrl} />
                        <TextField label="Footer logo URL" value={updateFooterLogo} onChange={setUpdateFooterLogo} full />
                      </>
                    )}
                    <INFTActionPayControl
                      icon={<PanelBottom size={16} />}
                      label={updateFooterMode === "remove" ? "Remove Footer" : "Update Footer"}
                      price={formatActionPrice(customer, "update_footer", settlementToken.symbol)}
                      tokens={selectablePaymentTokens}
                      selectedSymbol={paymentCurrency}
                      settlementToken={settlementToken}
                      disabled={videoActionDisabled || !updateFooterRequiredValue}
                      busy={busy === "update_footer"}
                      primary
                      onSelect={(symbol) => {
                        setPaymentCurrency(symbol);
                        setActionQuote(null);
                      }}
                      onPay={updateFooter}
                    />
                  </div>
                )}
              </div>
            )}
            <details className="advanced-section inft-peer-actions">
              <summary>AXL peer message</summary>
              <div className="form-grid">
                <TextField label="AXL peer id" value={peerId} onChange={setPeerId} />
                <button className="btn" onClick={() => runAction("message_peer", { peerId, message: "Can we compose a cross-referrer outro trade?" })} disabled={busy === "message_peer"}>
                  <Send size={16} /> Send message
                </button>
              </div>
            </details>
            {actionPoll && (
              <ActionProgressCard
                poll={actionPoll}
                pending={!terminalActionStatuses.has(actionPoll.status.toUpperCase())}
              />
            )}
            {actionPoll?.resultUrl && actionPoll.status.toUpperCase() === "COMPLETED" && (
              <ActionRenderPreview
                resultUrl={actionPoll.resultUrl}
                action={actionPoll.action}
                generation={createdGeneration}
                inft={createdInft}
                fallbackInft={activeInft}
                busyAction={renderActionBusy}
                message={renderActionMessage}
                onPublish={() => mutateCreatedRender("publish")}
                onDelete={() => mutateCreatedRender("delete")}
              />
            )}
            {actionResult && <pre className={`item mono inft-action-result ${actionResultTone === "error" ? "error" : ""}`}>{actionResult}</pre>}
            {showActionReview && (
              <StorefrontRatingForm
                customerId={activeInft.customerId}
                subAccountId={activeInft.subAccountId}
                generationId={activeInft.generationId}
                inftId={activeInft.id}
                wallet={activeInft.ownerWallet}
                operation={lastVideoOperation}
                title="Rate this storefront after the operation"
              />
            )}
          </div>
        </section>

        <aside className="stack">
          <div className="panel">
            <div className="panel-header">
              <h2>Ownership</h2>
              <Wallet size={18} />
            </div>
            <p className="subtle">Owner wallet</p>
            <p className="mono">{activeInft.ownerWallet}</p>
            <p className="subtle">Agent wallet</p>
            <p className="mono">{activeInft.agentWalletAddress}</p>
            <p className="subtle">Contract</p>
            <p className="mono">{activeInft.contractAddress}</p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Public INFT URL</h2>
              <Share2 size={18} />
            </div>
            <p className="mono">{publicInftPath}</p>
            <div className="button-row">
              <button className="btn" onClick={copyInftUrl}>
                <Copy size={16} /> Copy URL
              </button>
              <button className="btn" onClick={shareInft}>
                <Share2 size={16} /> Share
              </button>
            </div>
            {shareMessage && <p className="notice">{shareMessage}</p>}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>0G Persistence</h2>
              <Link2 size={18} />
            </div>
            <p className="subtle">Video root</p>
            <p className="mono">{activeInft.storageRootHash}</p>
            <p className="subtle">Metadata root</p>
            <p className="mono">{activeInft.metadataRootHash}</p>
            <p className="subtle">Metadata URI</p>
            <p className="mono">{activeInft.metadataUri}</p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Metadata</h2>
              <Link2 size={18} />
            </div>
            <p className="mono">{activeInft.referrer.url}</p>
            <div className="list">
              {metadataItems.map((item, index) => (
                <div className="item" key={`${item.label}:${index}`}>
                  <div className="item-title">
                    <span className="subtle">{item.label}</span>
                    <strong>{item.value}</strong>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

type INFTMetadataItem = {
  label: string;
  value: string;
};

const hiddenINFTMetadataTraits = new Set([
  "payment_amount_usd",
  "samsar_request_id",
  "samsar_session_id",
  "has_subtitles",
  "has_outro",
  "has_footer",
  "result_language",
  "language_code",
  "languagecode",
  "languages"
]);

function buildINFTMetadataItems(inft: INFTRecord): INFTMetadataItem[] {
  const metadata = isRecord(inft.samsarVideoMetadata) ? inft.samsarVideoMetadata : {};
  const attributeMap = new Map(
    inft.attributes.map((attribute) => [normalizeMetadataTrait(attribute.trait_type), attribute.value])
  );
  const languageCode = resolveRenditionLanguageCode(inft.languageCode, metadata, attributeMap.get("language_code"), attributeMap.get("result_language"));
  const featuredItems: INFTMetadataItem[] = [
    { label: "Language", value: renditionLanguageName(languageCode) || "Unknown" },
    { label: "Has subtitles", value: formatBooleanMetadata(resolveVideoMetadataBoolean(metadata, attributeMap, "has_subtitles", "hasSubtitles")) },
    { label: "Has outro", value: formatBooleanMetadata(resolveVideoMetadataBoolean(metadata, attributeMap, "has_outro", "hasOutro")) },
    { label: "Has footer", value: formatBooleanMetadata(resolveVideoMetadataBoolean(metadata, attributeMap, "has_footer", "hasFooter")) }
  ];
  const attributeItems = inft.attributes
    .filter((attribute) => !hiddenINFTMetadataTraits.has(normalizeMetadataTrait(attribute.trait_type)))
    .map((attribute) => ({
      label: attribute.trait_type,
      value: formatMetadataValue(attribute.value)
    }));
  return [...featuredItems, ...attributeItems];
}

function normalizeMetadataTrait(value: string) {
  return value.trim().toLowerCase();
}

function resolveVideoMetadataBoolean(
  metadata: Record<string, unknown>,
  attributeMap: Map<string, unknown>,
  ...keys: string[]
) {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(metadata, key)) {
      const value = booleanFromUnknown(metadata[key]);
      if (value !== undefined) {
        return value;
      }
    }
    const attributeValue = attributeMap.get(normalizeMetadataTrait(key));
    const value = booleanFromUnknown(attributeValue);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function formatBooleanMetadata(value: boolean | null | undefined) {
  if (value === true) {
    return "Yes";
  }
  if (value === false) {
    return "No";
  }
  return "Unknown";
}

function formatMetadataValue(value: unknown) {
  if (typeof value === "boolean" || value === null) {
    return formatBooleanMetadata(value);
  }
  if (value === null || value === undefined || value === "") {
    return "Unknown";
  }
  return String(value);
}

async function findConnectedWalletOnChain(walletProviders: BrowserWalletProvider[], chain: TransactionChainConfig) {
  const providers = walletProviders.length > 0 ? walletProviders : fallbackBrowserWalletProviders();
  for (const walletProvider of providers) {
    const provider = walletProvider.provider;
    const accounts = await provider.request({ method: "eth_accounts" }).catch(() => []);
    const account = Array.isArray(accounts) ? String(accounts[0] || "") : "";
    if (!account) {
      continue;
    }
    const chainId = await provider.request({ method: "eth_chainId" }).catch(() => "");
    if (String(chainId).toLowerCase() === chain.hexChainId.toLowerCase()) {
      return { walletProvider, account };
    }
  }
  return null;
}

function fallbackBrowserWalletProviders(): BrowserWalletProvider[] {
  if (typeof window === "undefined" || !window.ethereum) {
    return [];
  }
  return [{
    id: "legacy:browser-wallet",
    name: "Browser wallet",
    provider: window.ethereum,
    detectedBy: "legacy"
  }];
}

function TextField({
  label,
  value,
  onChange,
  full = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  full?: boolean;
}) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  onChange,
  full = false
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  full?: boolean;
}) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      <textarea value={value} onChange={(event) => onChange(event.target.value)} />
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
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ActionProgressCard({
  poll,
  pending
}: {
  poll: ActionPollState;
  pending: boolean;
}) {
  const expressEntries = expressStatusEntries(poll.expressGenerationStatus);
  const progress = expressStatusProgress(expressEntries, poll.status);
  const currentStage = currentExpressStage(expressEntries, poll.status);
  return (
    <div className="inft-action-status item">
      <div className="inft-action-status-top">
        <span className="inft-action-status-icon" aria-hidden="true">
          {pending ? <Loader2 size={18} className="spin" /> : <span />}
        </span>
        <div>
          <span className="subtle">{formatActionLabel(poll.action)}</span>
          <strong>{currentStage.label}</strong>
        </div>
        <span className={`badge ${progress.complete ? "ok" : ""}`}>{currentStage.status}</span>
      </div>
      <div className="inft-action-progress" aria-label="Express generation progress">
        <span style={{ width: `${progress.percent}%` }} />
      </div>
      <details className="inft-status-dropdown">
        <summary>
          <span>Express generation status</span>
          <strong>{progress.completed}/{progress.total}</strong>
        </summary>
        {expressEntries.length > 0 ? (
          <div className="inft-express-status-list">
            {expressEntries.map(([key, status]) => (
              <div className="inft-express-status-row" key={key}>
                <span>{formatExpressStatusLabel(key)}</span>
                <strong>{formatExpressStatusValue(status)}</strong>
              </div>
            ))}
          </div>
        ) : (
          <div className="inft-express-status-list">
            <div className="inft-express-status-row">
              <span>Render</span>
              <strong>{formatExpressStatusValue(poll.status)}</strong>
            </div>
          </div>
        )}
      </details>
      <p className="mono inft-action-request">{poll.requestId}</p>
      {poll.errorMessage && <p className="subtle inft-action-error">{poll.errorMessage}</p>}
    </div>
  );
}

function ActionRenderPreview({
  resultUrl,
  action,
  generation,
  inft,
  fallbackInft,
  busyAction,
  message,
  onPublish,
  onDelete
}: {
  resultUrl: string;
  action: string;
  generation: Generation | null;
  inft: INFTRecord | null;
  fallbackInft: INFTRecord;
  busyAction: "publish" | "delete" | "";
  message: string;
  onPublish: () => void;
  onDelete: () => void;
}) {
  const published = generation?.feed?.published === true;
  const previewStyle = {
    "--inft-render-preview-ratio": resolveRenderAspectRatio(generation, inft || fallbackInft)
  } as CSSProperties;
  return (
    <div className="inft-render-preview item">
      <div className="item-title">
        <span className="subtle">{formatActionLabel(action)} render</span>
        <strong>{published ? "Published" : "Ready"}</strong>
      </div>
      <div className="inft-render-preview-frame" style={previewStyle}>
        <video src={resultUrl} controls playsInline preload="metadata" />
      </div>
      <div className="button-row">
        <button className="btn primary" onClick={onPublish} disabled={!generation || published || Boolean(busyAction)} type="button">
          {busyAction === "publish" ? <Loader2 size={16} className="spin" /> : <UploadCloud size={16} />}
          {published ? "Published" : "Publish"}
        </button>
        <button className="btn warn" onClick={onDelete} disabled={!generation || Boolean(busyAction)} type="button">
          {busyAction === "delete" ? <Loader2 size={16} className="spin" /> : <Trash2 size={16} />}
          Delete
        </button>
        {inft && (
          <a className="btn" href={`/inft/${inft.id}`}>
            <Link2 size={16} /> Open INFT
          </a>
        )}
        <a className="btn" href={resultUrl} target="_blank" rel="noreferrer">
          <Download size={16} /> Open video
        </a>
        {generation?.feed?.published && (
          <a className="btn" href={feedHrefForGeneration(generation)}>
            <ExternalLink size={16} /> View in feed
          </a>
        )}
      </div>
      {!generation && <p className="subtle">Finalizing the render record before publish controls are enabled.</p>}
      {message && <p className="notice">{message}</p>}
    </div>
  );
}

function INFTActionPayControl({
  icon,
  label,
  price,
  tokens,
  selectedSymbol,
  settlementToken,
  disabled,
  busy,
  primary = false,
  onSelect,
  onPay
}: {
  icon: ReactNode;
  label: string;
  price: string;
  tokens: PaymentToken[];
  selectedSymbol: PaymentCurrencySymbol;
  settlementToken: PaymentToken;
  disabled: boolean;
  busy: boolean;
  primary?: boolean;
  onSelect: (symbol: PaymentCurrencySymbol) => void;
  onPay: () => void;
}) {
  const orderedTokens = [...tokens].sort((left, right) => paymentTokenRank(left) - paymentTokenRank(right));
  const selectedToken = orderedTokens.find((token) => token.symbol === selectedSymbol) || orderedTokens[0];
  const currencyTooltip = selectedToken
    ? paymentCurrencyTooltip(selectedToken, settlementToken)
    : "Choose payment currency";
  return (
    <div className="payment-action-control" title={currencyTooltip}>
      <button className={`btn payment-action-main ${primary ? "primary" : ""}`} disabled={disabled} onClick={onPay} type="button">
        {icon} {busy ? "Working..." : `${label} ${price}`}
      </button>
      <span className="payment-action-currency">
        <select
          aria-label="Payment currency"
          className="payment-action-currency-select"
          title={currencyTooltip}
          value={selectedSymbol}
          onChange={(event) => onSelect(event.target.value as PaymentCurrencySymbol)}
          disabled={busy}
        >
          {orderedTokens.map((token) => (
            <option value={token.symbol} key={`${token.chainId}:${token.address}`}>
              {token.symbol}
            </option>
          ))}
        </select>
        <span className="payment-action-currency-label">{selectedSymbol}</span>
        <ChevronDown className="payment-action-currency-icon" size={18} aria-hidden="true" />
      </span>
    </div>
  );
}

function INFTActionPaymentSummary({
  quote,
  transactionChain,
  selectedPaymentToken,
  settlementToken,
  paymentRail
}: {
  quote: PaymentQuote | null;
  transactionChain: TransactionChainConfig;
  selectedPaymentToken: PaymentToken;
  settlementToken: PaymentToken;
  paymentRail: PaymentRail;
}) {
  return (
    <div className="payment-summary">
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

function resolveUserPaymentRail(paymentToken: PaymentToken, settlementToken: PaymentToken): PaymentRail {
  return paymentToken.address.toLowerCase() === settlementToken.address.toLowerCase() ? "direct" : "keeperhub";
}

function formatActionPrice(customer: Customer | null, action: INFTPaidAction, currency = "USDC") {
  const basePrice = customer?.pricing.inftActionPricesUsd?.[action] ?? defaultINFTActionPricesUsd[action];
  const platformFee = (basePrice * Number(customer?.pricing.platformFeeBps || 0)) / 10_000;
  return `${(Math.round((basePrice + platformFee) * 100) / 100).toFixed(2)} ${currency}`;
}

function formatActionLabel(action: string) {
  return action
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatQuotePaymentAmount(quote: PaymentQuote, paymentToken?: PaymentToken) {
  if (!quote.paymentAmountAtomic || !paymentToken) {
    return quote.paymentCurrency || "selected token";
  }
  return `${formatAtomicAmount(BigInt(quote.paymentAmountAtomic), paymentToken.decimals)} ${quote.paymentCurrency || paymentToken.symbol}`;
}

function paymentCurrencyTooltip(token: PaymentToken, settlementToken: PaymentToken) {
  const rail = resolveUserPaymentRail(token, settlementToken);
  if (rail === "direct") {
    return `Pay ${token.symbol} directly to the merchant settlement wallet.`;
  }
  return `Pay ${token.symbol}; KeeperHub settles ${settlementToken.symbol} to the merchant.`;
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

async function requestUniswapSwap(provider: EthereumProvider, quote: PaymentQuote, wallet: string, chainName: string) {
  const route = quote.route && typeof quote.route === "object" ? quote.route as Record<string, unknown> : {};
  const swapQuote = route.quote;
  if (!swapQuote || typeof swapQuote !== "object") {
    throw new Error("Live Uniswap quote data is required for swap payment. Create a fresh action quote or choose a KeeperHub payment currency.");
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
  const data = await parseResponse(response);
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
  const recovery = "Choose a KeeperHub payment currency or pay directly with the settlement token.";
  const gas = await estimateWalletGas(provider, transaction, {
    label: "Uniswap swap",
    chainName,
    recovery
  });
  return sendWalletTransaction(provider, { ...transaction, gas }, {
    label: "Uniswap swap",
    chainName,
    recovery
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
    throw new Error(`${label} recipient is missing or invalid.`);
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
    if (walletErrorCode(error) === 4001) {
      throw new Error(`${context.label} was rejected in the wallet.`);
    }
    const recovery = context.recovery ? ` ${context.recovery}` : "";
    throw new Error(`${context.label} failed on ${context.chainName}: ${formatErrorMessage(error, "wallet transaction failed")}.${recovery}`);
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
      throw new Error(`${context.label} estimated an unusually high gas limit (${paddedGas.toString()}) on ${context.chainName}. No transaction was submitted. ${context.recovery || ""}`.trim());
    }
    return toRpcQuantity(paddedGas);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unusually high gas limit")) {
      throw error;
    }
    const recovery = context.recovery ? ` ${context.recovery}` : "";
    throw new Error(`${context.label} gas estimate failed on ${context.chainName}: ${formatErrorMessage(error, "wallet gas estimate failed")}.${recovery}`);
  }
}

async function assertWalletBalance(provider: EthereumProvider, owner: string, token: PaymentToken, amountAtomic: string) {
  const requiredAmount = BigInt(amountAtomic || "0");
  const balance = token.native
    ? BigInt(String(await provider.request({ method: "eth_getBalance", params: [owner, "latest"] })))
    : await readErc20Balance(provider, token.address, owner);
  if (balance < requiredAmount) {
    const recovery = token.symbol === "USDC"
      ? "Select ETH or another supported token in the payment currency control to create a KeeperHub settlement quote."
      : "Use another payment currency and start again to create a fresh quote.";
    throw new Error(`Insufficient ${token.symbol} balance. Required ${formatAtomicAmount(requiredAmount, token.decimals)} ${token.symbol}, available ${formatAtomicAmount(balance, token.decimals)} ${token.symbol}. ${recovery}`);
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
  return `0x${BigInt(String(value)).toString(16)}`;
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

function walletErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : 0;
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

function shortHash(value?: string) {
  if (!value) {
    return "";
  }
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function parseOutroFocusArea(raw: string) {
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error("Outro focus area must be a JSON object.");
  }
  const focusArea = {
    x: Number(parsed.x),
    y: Number(parsed.y),
    width: Number(parsed.width),
    height: Number(parsed.height)
  };
  if (!Object.values(focusArea).every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("Outro focus area must include valid x, y, width, and height numbers.");
  }
  return focusArea;
}

function expectedVideoMetadataForAction(action: string, payload: Record<string, unknown>): SamsarVideoRenderMetadata | undefined {
  const metadata: SamsarVideoRenderMetadata = {};
  const languageCode = actionLanguageCode(action, payload);
  if (languageCode) {
    metadata.result_language = languageCode;
    metadata.languageCode = languageCode;
    metadata.language_code = languageCode;
    metadata.languages = [languageCode];
  }

  if (action === "add_subtitles") {
    metadata.has_subtitles = true;
  }
  if (action === "remove_subtitles") {
    metadata.has_subtitles = false;
  }
  if (action === "translate") {
    const hasSubtitles = booleanFromUnknown(
      payload.enable_subtitles ??
      payload.enableSubtitles ??
      payload.add_subtitles ??
      payload.addSubtitles
    );
    if (typeof hasSubtitles === "boolean") {
      metadata.has_subtitles = hasSubtitles;
    }
  }
  if (action === "add_outro" || action === "update_outro") {
    metadata.has_outro = true;
  }
  if (action === "update_footer") {
    if (payload.remove_footer === true || payload.removeFooter === true || payload.mode === "remove") {
      metadata.has_footer = false;
    } else if (
      firstStringValue(payload, "cta_url", "ctaUrl", "footerUrl", "footer_url", "url", "cta_text", "ctaText", "cta_logo", "ctaLogo") ||
      (Array.isArray(payload.footer_metadata) && payload.footer_metadata.length > 0) ||
      (Array.isArray(payload.footerMetadata) && payload.footerMetadata.length > 0)
    ) {
      metadata.has_footer = true;
    }
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractExpectedVideoMetadata(value: unknown): SamsarVideoRenderMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const rawMetadata = [
    value.expectedVideoMetadata,
    value.expected_video_metadata,
    value.samsarVideoMetadata,
    value.samsar_video_metadata,
    value.metadataPatch,
    value.metadata_patch
  ].find(isRecord);
  if (!rawMetadata) {
    return undefined;
  }
  const metadata: SamsarVideoRenderMetadata = {};
  const languageCode = resolveRenditionLanguageCode(rawMetadata);
  if (languageCode) {
    metadata.result_language = languageCode;
    metadata.languageCode = languageCode;
    metadata.language_code = languageCode;
    metadata.languages = [languageCode];
  }
  for (const key of ["has_subtitles", "has_outro", "has_footer"] as const) {
    const value = booleanFromUnknown(rawMetadata[key]);
    if (value !== undefined) {
      metadata[key] = value;
    }
  }
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function extractActionRequestId(value: unknown) {
  return firstStringValue(
    value,
    "request_id",
    "requestId",
    "global_status_id",
    "globalStatusId",
    "session_id",
    "sessionId",
    "sessionID",
    "video_session_id",
    "videoSessionId",
    "external_request_id",
    "externalRequestId",
    "id"
  );
}

function extractActionStatus(value: unknown) {
  return firstStringValue(value, "status", "state")?.toUpperCase();
}

function extractActionError(value: unknown) {
  return firstStringValue(value, "message", "error", "errorMessage");
}

function extractExpressGenerationStatus(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value) || !isRecord(value.expressGenerationStatus)) {
    return undefined;
  }
  const entries = Object.entries(value.expressGenerationStatus)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim().length > 0);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function extractGeneration(value: unknown): Generation | undefined {
  const generation = isRecord(value) ? value.generation : undefined;
  return isRecord(generation) && typeof generation.id === "string"
    ? generation as unknown as Generation
    : undefined;
}

function actionLanguageCode(action: string, payload: Record<string, unknown>) {
  if (!["translate", "add_subtitles"].includes(action)) {
    return undefined;
  }
  return resolveRenditionLanguageCode(
    payload.languageCode,
    payload.language_code,
    payload.language,
    payload.subtitleLanguage,
    payload.subtitle_language
  ) || undefined;
}

function booleanFromUnknown(value: unknown): boolean | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalized)) {
      return true;
    }
    if (["false", "0", "no"].includes(normalized)) {
      return false;
    }
  }
  return undefined;
}

function extractActionResultUrl(value: unknown): string | undefined {
  if (typeof value === "string" && /^https?:\/\//i.test(value.trim())) {
    return value.trim();
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractActionResultUrl(item);
      if (nested) {
        return nested;
      }
    }
  }
  if (isRecord(value)) {
    return extractActionResultUrl([
      value.resultUrl,
      value.result_url,
      value.videoUrl,
      value.video_url,
      value.remoteUrl,
      value.remoteURL,
      value.outputUrl,
      value.output_url,
      value.url,
      value.result,
      value.output,
      value.data
    ]);
  }
  return undefined;
}

function expressStatusEntries(status?: Record<string, string>) {
  return Object.entries(status || {});
}

function currentExpressStage(entries: Array<[string, string]>, fallbackStatus: string) {
  const activeEntry = entries.find(([, status]) => normalizeExpressStatus(status) !== "COMPLETED") || entries.at(-1);
  if (!activeEntry) {
    return {
      label: "Render",
      status: formatExpressStatusValue(fallbackStatus)
    };
  }
  return {
    label: formatExpressStatusLabel(activeEntry[0]),
    status: formatExpressStatusValue(activeEntry[1])
  };
}

function expressStatusProgress(entries: Array<[string, string]>, fallbackStatus: string) {
  const total = entries.length || 1;
  const completed = entries.length > 0
    ? entries.filter(([, status]) => normalizeExpressStatus(status) === "COMPLETED").length
    : normalizeExpressStatus(fallbackStatus) === "COMPLETED" ? 1 : 0;
  return {
    completed,
    total,
    complete: completed >= total,
    percent: Math.max(5, Math.round((completed / total) * 100))
  };
}

function normalizeExpressStatus(status: string) {
  return status.trim().toUpperCase();
}

function formatExpressStatusLabel(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatExpressStatusValue(value: string) {
  const normalized = normalizeExpressStatus(value);
  return normalized
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function resolveRenderAspectRatio(generation?: Generation | null, inft?: INFTRecord | null) {
  const aspectRatio = generation?.input.aspect_ratio || inftAspectRatio(inft);
  return aspectRatio === "9:16" ? "9 / 16" : "16 / 9";
}

function inftAspectRatio(inft?: INFTRecord | null) {
  if (!inft) {
    return undefined;
  }
  const attribute = inft.attributes.find((item) => normalizeMetadataTrait(item.trait_type) === "aspect_ratio");
  return String(attribute?.value || "").trim();
}

function feedHrefForGeneration(generation: Generation) {
  const mode = generation.input.aspect_ratio === "9:16" ? "mobile" : "desktop";
  return `/feed/${encodeURIComponent(generation.id)}/${mode}`;
}

function firstStringValue(value: unknown, ...keys: string[]): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function parseResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}
