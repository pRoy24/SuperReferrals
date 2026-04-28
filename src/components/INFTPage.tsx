"use client";

import { Bot, Cable, Clapperboard, Copy, Download, ImagePlus, Languages, Link2, MessageSquare, RefreshCw, Scissors, Send, Share2, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import StorefrontRatingForm from "@/components/StorefrontRatingForm";
import type { INFTRecord } from "@/lib/types";

type ActionPollState = {
  action: string;
  requestId: string;
  status: string;
  resultUrl?: string;
  errorMessage?: string;
};

const terminalActionStatuses = new Set(["COMPLETED", "FAILED", "CANCELLED", "REFUNDED"]);

export default function INFTPage({ inft }: { inft: INFTRecord }) {
  const [question, setQuestion] = useState("What can this INFT do?");
  const [answer, setAnswer] = useState("");
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
  const publicInftPath = `/inft/${inft.id}`;
  const updateOutroRequiredValue = updateOutroMode === "cta" ? updateOutroCtaUrl.trim() : updateOutroImageUrl.trim();

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

  function buildUpdateOutroPayload() {
    const payload: Record<string, unknown> = {
      addOutroAnimation: updateOutroAnimation
    };

    if (updateOutroMode === "image") {
      const imageUrl = updateOutroImageUrl.trim();
      if (!imageUrl) {
        throw new Error("New outro image URL is required.");
      }
      payload.newOutroImageUrl = imageUrl;
      payload.addOutroFocusArea = updateOutroFocusArea;
      if (updateOutroFocusArea) {
        payload.outroFocusArea = parseOutroFocusArea(updateOutroFocusAreaJson);
      }
    } else {
      const ctaUrl = updateOutroCtaUrl.trim();
      if (!ctaUrl) {
        throw new Error("CTA URL is required.");
      }
      payload.generateOutroImage = true;
      payload.ctaUrl = ctaUrl;
      if (updateOutroTextTop.trim()) payload.ctaTextTop = updateOutroTextTop.trim();
      if (updateOutroTextBottom.trim()) payload.ctaTextBottom = updateOutroTextBottom.trim();
      if (updateOutroCtaLogo.trim()) payload.ctaLogo = updateOutroCtaLogo.trim();
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
    runAction("update_outro", payload).catch(() => undefined);
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
              <TextField label="Add outro image URL" value={outroImageUrl} onChange={setOutroImageUrl} full />
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
              <button className="btn" onClick={() => setShowUpdateOutro((visible) => !visible)} disabled={busy === "update_outro"}>
                <ImagePlus size={16} /> Update outro
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
                    <ImagePlus size={16} /> Update outro
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
