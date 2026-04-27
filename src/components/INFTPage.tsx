"use client";

import { Ban, Bot, Cable, Clapperboard, Copy, Download, ImagePlus, Languages, Link2, MessageSquare, RefreshCw, Scissors, Send, Share2, Wallet } from "lucide-react";
import { useState } from "react";
import StorefrontRatingForm from "@/components/StorefrontRatingForm";
import type { INFTRecord } from "@/lib/types";

export default function INFTPage({ inft }: { inft: INFTRecord }) {
  const [question, setQuestion] = useState("What can this INFT do?");
  const [answer, setAnswer] = useState("");
  const [actionResult, setActionResult] = useState("");
  const [busy, setBusy] = useState("");
  const [peerId, setPeerId] = useState("mock-peer-video-a");
  const [joinSession, setJoinSession] = useState("");
  const [language, setLanguage] = useState("es");
  const [outroImageUrl, setOutroImageUrl] = useState("");
  const [shareMessage, setShareMessage] = useState("");
  const [lastVideoOperation, setLastVideoOperation] = useState("");
  const publicInftPath = `/inft/${inft.id}`;

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

  async function ask() {
    setBusy("ask");
    try {
      const response = await fetch(`/api/infts/${inft.id}/assistant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question })
      });
      const data = await parseResponse(response);
      setAnswer(data.answer?.output_text || JSON.stringify(data.answer, null, 2));
    } catch (error) {
      setAnswer(error instanceof Error ? error.message : "Assistant failed");
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
      }
    } catch (error) {
      setActionResult(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy("");
    }
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
              <h2>Assistant</h2>
              <Bot size={18} />
            </div>
            <div className="field">
              <label>Question</label>
              <textarea value={question} onChange={(event) => setQuestion(event.target.value)} />
            </div>
            <div className="button-row">
              <button className="btn primary" onClick={ask} disabled={busy === "ask"}>
                <MessageSquare size={16} /> Ask
              </button>
            </div>
            {answer && <pre className="item mono">{answer}</pre>}
          </div>

          <div className="panel">
            <div className="panel-header">
              <h2>Agent Actions</h2>
              <Cable size={18} />
            </div>
            <div className="form-grid">
              <TextField label="Target language" value={language} onChange={setLanguage} />
              <TextField label="Join with session id" value={joinSession} onChange={setJoinSession} />
              <TextField label="Outro image URL" value={outroImageUrl} onChange={setOutroImageUrl} full />
              <TextField label="AXL peer id" value={peerId} onChange={setPeerId} full />
            </div>
            <div className="button-row">
              <button className="btn" onClick={() => runAction("translate", { language })} disabled={busy === "translate"}>
                <Languages size={16} /> Retranslate
              </button>
              <button className="btn" onClick={() => runAction("join", { sessionId: joinSession, blendScenes: true })} disabled={busy === "join" || !joinSession}>
                <Clapperboard size={16} /> Join
              </button>
              <button className="btn" onClick={() => runAction("remove_subtitles")} disabled={busy === "remove_subtitles"}>
                <Scissors size={16} /> Remove subtitles
              </button>
              <button className="btn" onClick={() => runAction("add_outro", { outroImageUrl, addOutroAnimation: true })} disabled={busy === "add_outro" || !outroImageUrl}>
                <ImagePlus size={16} /> Add outro
              </button>
              <button className="btn" onClick={() => runAction("update_outro", { outroImageUrl })} disabled={busy === "update_outro" || !outroImageUrl}>
                <ImagePlus size={16} /> Update outro
              </button>
              <button className="btn warn" onClick={() => runAction("cancel_render")} disabled={busy === "cancel_render"}>
                <Ban size={16} /> Cancel render
              </button>
              <button className="btn" onClick={() => runAction("message_peer", { peerId, message: "Can we compose a cross-referrer outro trade?" })} disabled={busy === "message_peer"}>
                <Send size={16} /> AXL message
              </button>
            </div>
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

async function parseResponse(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}
