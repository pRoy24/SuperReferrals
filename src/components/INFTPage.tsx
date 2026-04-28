"use client";

import { Cable, Clapperboard, Copy, Download, ImagePlus, Languages, Link2, RefreshCw, Scissors, Send, Share2, Wallet } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import StorefrontRatingForm from "@/components/StorefrontRatingForm";
import {
  requestWalletAccounts,
  subscribeToBrowserWalletProviders,
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
import { isUsableEvmAddress } from "@/lib/wallet-address";
import type { Customer, INFTPaidAction, INFTRecord, PaymentCurrencySymbol, PaymentQuote, PaymentRail, SuperReferralsStore } from "@/lib/types";

type ActionPollState = {
  action: string;
  requestId: string;
  status: string;
  resultUrl?: string;
  errorMessage?: string;
};

type ActionPaymentFlow = {
  status: "idle" | "payment" | "confirming" | "starting" | "started" | "failed";
  message: string;
  txHash?: string;
};

const terminalActionStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]);

export default function INFTPage({ inft }: { inft: INFTRecord }) {
  const [actionResult, setActionResult] = useState("");
  const [busy, setBusy] = useState("");
  const [peerId, setPeerId] = useState("mock-peer-video-a");
  const [joinSession, setJoinSession] = useState("");
  const [language, setLanguage] = useState("es");
  const [outroImageUrl, setOutroImageUrl] = useState("");
  const [updateOutroMode, setUpdateOutroMode] = useState<"cta" | "image">("cta");
  const [updateOutroImageUrl, setUpdateOutroImageUrl] = useState("");
  const [updateOutroCtaUrl, setUpdateOutroCtaUrl] = useState("");
  const [updateOutroTextTop, setUpdateOutroTextTop] = useState("Scan to learn more");
  const [updateOutroTextBottom, setUpdateOutroTextBottom] = useState("");
  const [updateOutroCtaLogo, setUpdateOutroCtaLogo] = useState("");
  const [updateOutroAnimation, setUpdateOutroAnimation] = useState(true);
  const [showUpdateOutro, setShowUpdateOutro] = useState(false);
  const [updateOutroFocusArea, setUpdateOutroFocusArea] = useState(false);
  const [updateOutroFocusAreaJson, setUpdateOutroFocusAreaJson] = useState(JSON.stringify({ x: 680, y: 296, width: 432, height: 432 }, null, 2));
  const [shareMessage, setShareMessage] = useState("");
  const [lastVideoOperation, setLastVideoOperation] = useState("");
  const [actionPoll, setActionPoll] = useState<ActionPollState | null>(null);
  const [store, setStore] = useState<SuperReferralsStore | null>(null);
  const [walletAddress, setWalletAddress] = useState(inft.ownerWallet || "");
  const [walletProviders, setWalletProviders] = useState<BrowserWalletProvider[]>([]);
  const [activeWalletProvider, setActiveWalletProvider] = useState<BrowserWalletProvider | null>(null);
  const [paymentCurrency, setPaymentCurrency] = useState<PaymentCurrencySymbol>("USDC");
  const [actionQuote, setActionQuote] = useState<PaymentQuote | null>(null);
  const [actionPaymentFlow, setActionPaymentFlow] = useState<ActionPaymentFlow>({ status: "idle", message: "" });
  const publicInftPath = `/inft/${inft.id}`;
  const updateOutroRequiredValue = updateOutroMode === "cta" ? updateOutroCtaUrl.trim() : updateOutroImageUrl.trim();

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

  useEffect(() => subscribeToBrowserWalletProviders(setWalletProviders), []);

  const customer = useMemo(
    () => store?.customers.find((item) => item.id === inft.customerId) || null,
    [store, inft.customerId]
  );
  const transactionChain = useMemo(
    () => getTransactionChainConfig(normalizeTransactionChainIdForEnvironment(customer?.pricing.chainId)),
    [customer?.pricing.chainId]
  );
  const paymentTokens = useMemo(() => getPaymentTokens(transactionChain.id), [transactionChain.id]);
  const selectablePaymentTokens = useMemo(() => {
    const ethOrUsdc = paymentTokens.filter((token) => token.symbol === "USDC" || token.symbol === "ETH");
    return ethOrUsdc.length ? ethOrUsdc : paymentTokens;
  }, [paymentTokens]);
  const selectedPaymentToken = selectablePaymentTokens.find((token) => token.symbol === paymentCurrency) || selectablePaymentTokens[0];
  const settlementToken =
    findPaymentToken(customer?.pricing.settlementTokenAddress || "", transactionChain.id) ||
    settlementTokenForCurrency(customer?.pricing.currency || "USDC", transactionChain.id) ||
    selectedPaymentToken;
  useEffect(() => {
    if (!actionPoll?.requestId || terminalActionStatuses.has(actionPoll.status.toUpperCase())) {
      return;
    }
    const pollRequestId = actionPoll.requestId;
    let cancelled = false;

    async function pollActionStatus() {
      try {
        const response = await fetch(`/api/infts/${inft.id}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "action_status",
            payload: { requestId: pollRequestId }
          })
        });
        const data = await parseResponse(response);
        const result = data.result as Record<string, unknown>;
        const nextStatus = extractActionStatus(result);
        const nextResultUrl = extractActionResultUrl(result);
        const nextErrorMessage = extractActionError(result);
        if (!cancelled) {
          setActionResult(JSON.stringify(result, null, 2));
          setActionPoll((current) => {
            if (!current || current.requestId !== pollRequestId) {
              return current;
            }
            return {
              ...current,
              status: nextStatus || current.status || "PROCESSING",
              resultUrl: nextResultUrl || current.resultUrl,
              errorMessage: nextErrorMessage
            };
          });
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
  }, [actionPoll?.requestId, actionPoll?.status, inft.id]);

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
          title: inft.title,
          text: inft.description,
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
    shareUrl.searchParams.set("text", inft.title);
    shareUrl.searchParams.set("url", url);
    window.open(shareUrl.toString(), "_blank", "noopener,noreferrer");
  }

  function selectedEthereumProvider(walletProvider?: BrowserWalletProvider) {
    const selected = walletProvider || activeWalletProvider || walletProviders[0] || null;
    return {
      walletProvider: selected,
      provider: selected?.provider || window.ethereum
    };
  }

  async function connectWallet(walletProvider?: BrowserWalletProvider) {
    setBusy("wallet");
    setActionPaymentFlow({ status: "idle", message: "" });
    try {
      const selected = selectedEthereumProvider(walletProvider);
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
      setActionQuote(null);
      setActionPaymentFlow({
        status: "idle",
        message: `Wallet connected on ${transactionChain.name}.`
      });
    } catch (error) {
      setActionPaymentFlow({
        status: "failed",
        message: error instanceof Error ? error.message : "Wallet connection failed."
      });
    } finally {
      setBusy("");
    }
  }

  async function runAction(action: string, payload: Record<string, unknown> = {}) {
    setBusy(action);
    try {
      const response = await fetch(`/api/infts/${inft.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, payload })
      });
      const data = await parseResponse(response);
      setActionResult(JSON.stringify(data.result, null, 2));
      if (action !== "message_peer") {
        setLastVideoOperation(action);
        const requestId = extractActionRequestId(data.result);
        if (requestId) {
          setActionPoll({
            action,
            requestId,
            status: extractActionStatus(data.result) || "QUEUED",
            resultUrl: extractActionResultUrl(data.result),
            errorMessage: extractActionError(data.result)
          });
        }
      }
    } catch (error) {
      setActionResult(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy("");
    }
  }

  function quoteMatchesAction(activeQuote: PaymentQuote | null, action: INFTPaidAction, paymentToken: PaymentToken) {
    return Boolean(
      activeQuote &&
      activeQuote.inftId === inft.id &&
      activeQuote.operation === action &&
      activeQuote.chainId === transactionChain.id &&
      activeQuote.paymentTokenAddress?.toLowerCase() === paymentToken.address.toLowerCase()
    );
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
        subAccountId: inft.subAccountId,
        inftId: inft.id,
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
    if (!sameToken && activeQuote.paymentRail !== "keeperhub") {
      throw new Error("Selected payment token differs from the settlement token. Choose ETH keeper settlement or pay directly with USDC.");
    }

    const transferToken = sameToken ? activeSettlementToken : paymentToken;
    const transferAmount = sameToken ? activeQuote.settlementAmountAtomic : paymentAmountAtomic;
    const label = sameToken ? "Payment transfer" : "KeeperHub payment";
    setActionPaymentFlow({
      status: "payment",
      message: `Requesting ${transferToken.symbol} payment for ${formatActionLabel(activeQuote.operation || "operation")}.`
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
    setBusy(action);
    setActionPaymentFlow({ status: "payment", message: "Preparing payment quote." });
    try {
      if (!selectedPaymentToken) {
        throw new Error("No supported payment token is available.");
      }
      const activeQuote = quoteMatchesAction(actionQuote, action, selectedPaymentToken)
        ? actionQuote as PaymentQuote
        : await requestActionQuote(action, selectedPaymentToken);
      const txHash = await executePaymentForAction(activeQuote);
      setActionPaymentFlow({
        status: "starting",
        message: `Payment ${shortHash(txHash)} confirmed. Starting ${formatActionLabel(action)}.`,
        txHash
      });
      const response = await fetch(`/api/infts/${inft.id}/actions`, {
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
              chainId: activeQuote.chainId
            }
          }
        })
      });
      const data = await parseResponse(response);
      setActionResult(JSON.stringify(data.result, null, 2));
      setLastVideoOperation(action);
      const requestId = extractActionRequestId(data.result);
      if (requestId) {
        setActionPoll({
          action,
          requestId,
          status: extractActionStatus(data.result) || "QUEUED",
          resultUrl: extractActionResultUrl(data.result),
          errorMessage: extractActionError(data.result)
        });
      }
      setActionPaymentFlow({
        status: "started",
        message: `${formatActionLabel(action)} started after ${shortHash(txHash)}.`,
        txHash
      });
      await loadStore().catch(() => undefined);
    } catch (error) {
      setActionPaymentFlow({
        status: "failed",
        message: error instanceof Error ? error.message : "Paid INFT action failed."
      });
      setActionResult(error instanceof Error ? error.message : "Paid INFT action failed");
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
      setActionResult(error instanceof Error ? error.message : "Invalid outro update input");
      return;
    }
    runPaidAction("update_outro", payload).catch(() => undefined);
  }

  return (
    <main className="inft-layout">
      <div className="topbar">
        <div>
          <div className="eyebrow">INFT Viewer</div>
          <h1>{inft.title}</h1>
          <p className="subtle">{inft.description}</p>
        </div>
        <a className="btn" href="/">
          <RefreshCw size={16} /> Dashboard
        </a>
      </div>

      <div className="inft-grid">
        <section className="stack">
          <div className="panel">
            <video className="video" src={inft.videoUrl} controls />
            <div className="button-row">
              <a className="btn primary" href={inft.videoUrl} download target="_blank" rel="noreferrer">
                <Download size={16} /> Download video
              </a>
              <button className="btn" onClick={shareInft}>
                <Share2 size={16} /> Share
              </button>
              <button className="btn" onClick={shareOnX}>
                <Share2 size={16} /> Share on X
              </button>
              <span className="badge ok">token #{inft.tokenId}</span>
              <span className="badge">{inft.referrer.code}</span>
              {inft.referrer.ensName && <span className="badge">{inft.referrer.ensName}</span>}
            </div>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Agent Actions</h2>
              <Cable size={18} />
            </div>
            <div className="form-grid">
              <TextField label="Target language" value={language} onChange={setLanguage} />
              <TextField label="Join with session id" value={joinSession} onChange={setJoinSession} />
              <TextField label="Add outro image URL" value={outroImageUrl} onChange={setOutroImageUrl} full />
              <TextField label="AXL peer id" value={peerId} onChange={setPeerId} full />
              <TextField
                label="Payer wallet"
                value={walletAddress}
                onChange={(value) => {
                  setWalletAddress(value);
                  setActionQuote(null);
                }}
                full
              />
              <SelectField
                label="Pay with"
                value={paymentCurrency}
                options={selectablePaymentTokens.map((token) => ({ value: token.symbol, label: token.symbol }))}
                onChange={(value) => {
                  setPaymentCurrency(value as PaymentCurrencySymbol);
                  setActionQuote(null);
                }}
              />
            </div>
            <div className="button-row">
              <button className="btn" onClick={() => connectWallet()} disabled={busy === "wallet"}>
                <Wallet size={16} /> Connect wallet
              </button>
              {actionQuote && (
                <span className="badge ok">
                  {actionQuote.totalUsd.toFixed(2)} {actionQuote.settlementCurrency || "USDC"} quote · pay {formatQuotePaymentAmount(actionQuote, selectedPaymentToken)}
                </span>
              )}
            </div>
            {actionPaymentFlow.message && <p className="notice">{actionPaymentFlow.message}</p>}
            <div className="button-row">
              <button className="btn" onClick={() => runPaidAction("translate", { language })} disabled={busy === "translate"}>
                <Languages size={16} /> Retranslate {formatActionPrice(customer, "translate")}
              </button>
              <button className="btn" onClick={() => runPaidAction("join", { session_id: joinSession, blend_scenes: true })} disabled={busy === "join" || !joinSession}>
                <Clapperboard size={16} /> Join {formatActionPrice(customer, "join")}
              </button>
              <button className="btn" onClick={() => runPaidAction("remove_subtitles")} disabled={busy === "remove_subtitles"}>
                <Scissors size={16} /> Remove subtitles {formatActionPrice(customer, "remove_subtitles")}
              </button>
              <button className="btn" onClick={() => runPaidAction("add_outro", { outro_image_url: outroImageUrl, add_outro_animation: true })} disabled={busy === "add_outro" || !outroImageUrl}>
                <ImagePlus size={16} /> Add outro {formatActionPrice(customer, "add_outro")}
              </button>
              <button className="btn" onClick={() => setShowUpdateOutro((visible) => !visible)} disabled={busy === "update_outro"}>
                <ImagePlus size={16} /> Update outro {formatActionPrice(customer, "update_outro")}
              </button>
              <button className="btn" onClick={() => runAction("message_peer", { peerId, message: "Can we compose a cross-referrer outro trade?" })} disabled={busy === "message_peer"}>
                <Send size={16} /> AXL message
              </button>
            </div>
            {showUpdateOutro && (
              <div className="form-grid action-form">
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
                        onChange={(event) => setUpdateOutroFocusArea(event.target.checked)}
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
                <div className="button-row">
                  <button
                    className="btn primary"
                    onClick={updateOutro}
                    disabled={busy === "update_outro" || !updateOutroRequiredValue}
                  >
                    <ImagePlus size={16} /> Update outro {formatActionPrice(customer, "update_outro")}
                  </button>
                  <button className="btn" onClick={() => setShowUpdateOutro(false)} disabled={busy === "update_outro"}>
                    Close
                  </button>
                </div>
              </div>
            )}
            {actionPoll && (
              <div className="item">
                <div className="item-title">
                  <span className="subtle">{actionPoll.action.replaceAll("_", " ")}</span>
                  <strong>{actionPoll.status}</strong>
                </div>
                <p className="mono">{actionPoll.requestId}</p>
                {actionPoll.resultUrl && (
                  <a className="btn" href={actionPoll.resultUrl} target="_blank" rel="noreferrer">
                    <Download size={16} /> Open result
                  </a>
                )}
                {actionPoll.errorMessage && <p className="subtle">{actionPoll.errorMessage}</p>}
              </div>
            )}
            {actionResult && <pre className="item mono">{actionResult}</pre>}
            {lastVideoOperation && (
              <StorefrontRatingForm
                customerId={inft.customerId}
                subAccountId={inft.subAccountId}
                generationId={inft.generationId}
                inftId={inft.id}
                wallet={inft.ownerWallet}
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
            <p className="mono">{inft.ownerWallet}</p>
            <p className="subtle">Agent wallet</p>
            <p className="mono">{inft.agentWalletAddress}</p>
            <p className="subtle">Contract</p>
            <p className="mono">{inft.contractAddress}</p>
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
            <p className="mono">{inft.storageRootHash}</p>
            <p className="subtle">Metadata root</p>
            <p className="mono">{inft.metadataRootHash}</p>
            <p className="subtle">Metadata URI</p>
            <p className="mono">{inft.metadataUri}</p>
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Referrer Metadata</h2>
              <Link2 size={18} />
            </div>
            <p className="mono">{inft.referrer.url}</p>
            <div className="list">
              {inft.attributes.map((attribute) => (
                <div className="item" key={attribute.trait_type}>
                  <div className="item-title">
                    <span className="subtle">{attribute.trait_type}</span>
                    <strong>{String(attribute.value)}</strong>
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

function resolveUserPaymentRail(paymentToken: PaymentToken, settlementToken: PaymentToken): PaymentRail {
  return paymentToken.address.toLowerCase() === settlementToken.address.toLowerCase() ? "direct" : "keeperhub";
}

function formatActionPrice(customer: Customer | null, action: INFTPaidAction) {
  const basePrice = customer?.pricing.inftActionPricesUsd?.[action] ?? defaultINFTActionPricesUsd[action];
  const platformFee = (basePrice * Number(customer?.pricing.platformFeeBps || 0)) / 10_000;
  return `${(Math.round((basePrice + platformFee) * 100) / 100).toFixed(2)} USDC`;
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
  context: { label: string; chainName: string }
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
    throw new Error(`${context.label} failed on ${context.chainName}: ${formatErrorMessage(error, "wallet transaction failed")}`);
  }
}

async function assertWalletBalance(provider: EthereumProvider, owner: string, token: PaymentToken, amountAtomic: string) {
  const requiredAmount = BigInt(amountAtomic || "0");
  const balance = token.native
    ? BigInt(String(await provider.request({ method: "eth_getBalance", params: [owner, "latest"] })))
    : await readErc20Balance(provider, token.address, owner);
  if (balance < requiredAmount) {
    throw new Error(`Insufficient ${token.symbol} balance. Required ${formatAtomicAmount(requiredAmount, token.decimals)} ${token.symbol}, available ${formatAtomicAmount(balance, token.decimals)} ${token.symbol}.`);
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

function extractActionRequestId(value: unknown) {
  return firstStringValue(value, "request_id", "requestId", "session_id", "sessionID", "id");
}

function extractActionStatus(value: unknown) {
  return firstStringValue(value, "status", "state")?.toUpperCase();
}

function extractActionError(value: unknown) {
  return firstStringValue(value, "message", "error", "errorMessage");
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
