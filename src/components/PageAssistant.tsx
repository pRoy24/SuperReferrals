"use client";

import {
  Bot,
  Check,
  Copy,
  Eraser,
  Maximize2,
  MessageCircle,
  Minimize2,
  Minus,
  RefreshCw,
  Send,
  X
} from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { samsarAuthHeaders } from "@/lib/storefront-auth-client";

type AssistantRole = "user" | "assistant";

type AssistantMessage = {
  id: string;
  role: AssistantRole;
  content: string;
  createdAt: string;
  model?: string;
  network?: string;
};

type AssistantThread = {
  id: string;
  pagePath: string;
  pageTitle: string;
  messages: AssistantMessage[];
  updatedAt: string;
};

const ASSISTANT_USER_STORAGE_KEY = "superreferrals:page-assistant-user";

export default function PageAssistant() {
  const pathname = usePathname() || "/";
  if (pathname === "/feed") {
    return null;
  }

  return <PageAssistantPanel pathname={pathname} />;
}

function PageAssistantPanel({ pathname }: { pathname: string }) {
  const [thread, setThread] = useState<AssistantThread | null>(null);
  const [input, setInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [busy, setBusy] = useState<"load" | "send" | "clear" | "">("");
  const [error, setError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const assistantUserIdRef = useRef("");

  const messages = useMemo(() => thread?.messages || [], [thread?.messages]);
  const pageTitle = thread?.pageTitle || pageLabelFromPath(pathname);
  const assistantClass = [
    "page-assistant",
    isExpanded ? "expanded" : ""
  ].filter(Boolean).join(" ");

  useEffect(() => {
    assistantUserIdRef.current = getOrCreateAssistantUserId();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const userId = assistantUserIdRef.current || getOrCreateAssistantUserId();
    assistantUserIdRef.current = userId;
    setBusy("load");
    setError("");

    fetch(`/api/assistant/page?pagePath=${encodeURIComponent(pathname)}`, {
      cache: "no-store",
      headers: assistantHeaders(userId),
      signal: controller.signal
    })
      .then(assertOk)
      .then((data) => {
        setThread(data.thread as AssistantThread);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Assistant failed to load.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy("");
        }
      });

    return () => controller.abort();
  }, [pathname]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const timer = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [isOpen, isExpanded, messages.length, busy]);

  async function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy === "send") {
      return;
    }
    const optimisticMessage: AssistantMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: new Date().toISOString()
    };
    setInput("");
    setIsOpen(true);
    setError("");
    setBusy("send");
    setThread((current) => current
      ? { ...current, messages: [...current.messages, optimisticMessage], updatedAt: optimisticMessage.createdAt }
      : {
        id: "pending",
        pagePath: pathname,
        pageTitle,
        messages: [optimisticMessage],
        updatedAt: optimisticMessage.createdAt
      });

    try {
      const data = await fetch("/api/assistant/page", {
        method: "POST",
        headers: assistantHeaders(assistantUserIdRef.current, { "content-type": "application/json" }),
        body: JSON.stringify({
          pagePath: pathname,
          message,
          userId: assistantUserIdRef.current
        })
      }).then(assertOk);
      setThread(data.thread as AssistantThread);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Assistant request failed.");
      setThread((current) => current
        ? { ...current, messages: current.messages.filter((item) => item.id !== optimisticMessage.id) }
        : current);
    } finally {
      setBusy("");
    }
  }

  async function clearThread() {
    if (busy === "clear" || messages.length === 0) {
      return;
    }
    const confirmed = window.confirm("Clear this page assistant conversation?");
    if (!confirmed) {
      return;
    }
    setBusy("clear");
    setError("");
    try {
      await fetch(`/api/assistant/page?pagePath=${encodeURIComponent(pathname)}`, {
        method: "DELETE",
        headers: assistantHeaders(assistantUserIdRef.current, { "content-type": "application/json" }),
        body: JSON.stringify({
          pagePath: pathname,
          userId: assistantUserIdRef.current
        })
      }).then(assertOk);
      setThread((current) => current ? { ...current, messages: [], updatedAt: new Date().toISOString() } : current);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : "Unable to clear assistant.");
    } finally {
      setBusy("");
    }
  }

  async function copyMessage(message: AssistantMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      window.setTimeout(() => setCopiedMessageId((current) => current === message.id ? "" : current), 1400);
    } catch {
      setError("Unable to copy message.");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage().catch(() => undefined);
    }
  }

  return (
    <div className={assistantClass}>
      <button
        type="button"
        className="page-assistant-launcher"
        onClick={() => setIsOpen((current) => !current)}
        aria-label={isOpen ? "Close assistant" : "Open assistant"}
      >
        <span className="page-assistant-launcher-icon"><MessageCircle size={22} /></span>
        <span className="page-assistant-launcher-copy">
          <strong>Assistant</strong>
          <small>{pageTitle}</small>
        </span>
      </button>

      {isOpen && (
        <section className="page-assistant-panel" aria-label="Page assistant">
          <header className="page-assistant-header">
            <div className="page-assistant-title">
              <span><Bot size={18} /></span>
              <div>
                <strong>Assistant</strong>
                <small>{pageTitle}</small>
              </div>
            </div>
            <div className="page-assistant-actions">
              <button type="button" onClick={clearThread} disabled={busy === "clear" || messages.length === 0} title="Clear conversation" aria-label="Clear conversation">
                {busy === "clear" ? <RefreshCw size={16} className="spin" /> : <Eraser size={16} />}
              </button>
              <button type="button" onClick={() => setIsExpanded((current) => !current)} title={isExpanded ? "Condense assistant" : "Expand assistant"} aria-label={isExpanded ? "Condense assistant" : "Expand assistant"}>
                {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button type="button" onClick={() => setIsOpen(false)} title="Collapse assistant" aria-label="Collapse assistant">
                <Minus size={16} />
              </button>
            </div>
          </header>

          <div className="page-assistant-body">
            {error && (
              <div className="page-assistant-notice" role="status">
                <span>{error}</span>
                <button type="button" onClick={() => setError("")} aria-label="Dismiss assistant notice"><X size={14} /></button>
              </div>
            )}
            {messages.length > 0 ? (
              <div className="page-assistant-messages">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <article className={`page-assistant-message ${isUser ? "user" : "assistant"}`} key={message.id}>
                      <div className="page-assistant-message-meta">
                        <strong>{isUser ? "You" : "Assistant"}</strong>
                        <span>{formatTime(message.createdAt)}</span>
                        <button type="button" onClick={() => copyMessage(message)} title="Copy message" aria-label="Copy message">
                          {copiedMessageId === message.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                      <div className="page-assistant-message-text">{message.content}</div>
                      {!isUser && (message.model || message.network) && (
                        <div className="page-assistant-message-foot">
                          {[message.network, message.model].filter(Boolean).join(" / ")}
                        </div>
                      )}
                    </article>
                  );
                })}
                {busy === "send" && <TypingIndicator />}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <div className="page-assistant-empty">
                {busy === "load" ? <RefreshCw size={24} className="spin" /> : <MessageCircle size={26} />}
              </div>
            )}
          </div>

          <form className="page-assistant-form" onSubmit={submitMessage}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about this page..."
              rows={2}
            />
            <button type="submit" disabled={!input.trim() || busy === "send"} className="page-assistant-send">
              {busy === "send" ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
              <span>Send</span>
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="page-assistant-typing" aria-label="Assistant is responding">
      <span />
      <span />
      <span />
    </div>
  );
}

function assistantHeaders(userId: string, init?: HeadersInit) {
  const headers = samsarAuthHeaders(init);
  if (userId) {
    headers.set("x-superreferrals-assistant-user", userId);
  }
  return headers;
}

async function assertOk(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.message === "string" ? data.message : "Request failed");
  }
  return data as Record<string, unknown>;
}

function getOrCreateAssistantUserId() {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    const existing = window.localStorage.getItem(ASSISTANT_USER_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const generated = typeof window.crypto?.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(ASSISTANT_USER_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `assistant-${Date.now()}`;
  }
}

function pageLabelFromPath(pathname: string) {
  if (pathname === "/") {
    return "Landing";
  }
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length) {
    return "SuperReferrals";
  }
  return segments
    .slice(0, 2)
    .map((segment) => segment.replace(/[-_]/g, " "))
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" / ");
}

function formatTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}
