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
import { readRouteAppLanguage, readStoredAppLanguage, subscribeAppLanguage } from "@/lib/app-language-client";
import {
  assistantCopy,
  localizedAssistantEmptySuggestions,
  localizedAssistantPageLabel,
  normalizeAssistantPagePathForLocale
} from "@/lib/assistant-localization";
import { DEFAULT_APP_LANGUAGE, normalizeAppLanguage } from "@/lib/localization";
import { samsarAuthHeaders } from "@/lib/storefront-auth-client";
import type { AppLanguageCode } from "@/lib/types";

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
const ASSISTANT_MODEL_LABEL =
  process.env.NEXT_PUBLIC_ASSISTANT_MODEL ||
  process.env.NEXT_PUBLIC_OG_COMPUTE_MODEL ||
  "";
const ASSISTANT_ENVIRONMENT_LABEL =
  process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ||
  process.env.NEXT_PUBLIC_APP_ENV ||
  process.env.NEXT_PUBLIC_OG_NETWORK ||
  process.env.NODE_ENV ||
  "";

export default function PageAssistant({
  initialLanguage = DEFAULT_APP_LANGUAGE
}: {
  initialLanguage?: AppLanguageCode;
} = {}) {
  const pathname = usePathname() || "/";
  const assistantPagePath = normalizeAssistantPagePathForLocale(pathname);
  if (assistantPagePath === "/feed") {
    return null;
  }

  return <PageAssistantPanel initialLanguage={initialLanguage} pagePath={assistantPagePath} />;
}

function PageAssistantPanel({
  initialLanguage,
  pagePath
}: {
  initialLanguage: AppLanguageCode;
  pagePath: string;
}) {
  const [thread, setThread] = useState<AssistantThread | null>(null);
  const [input, setInput] = useState("");
  const [appLanguage, setAppLanguage] = useState<AppLanguageCode>(
    normalizeAppLanguage(initialLanguage) || DEFAULT_APP_LANGUAGE
  );
  const [isOpen, setIsOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [busy, setBusy] = useState<"load" | "send" | "clear" | "">("");
  const [error, setError] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const assistantUserIdRef = useRef("");

  const t = assistantCopy[appLanguage];
  const messages = useMemo(() => thread?.messages || [], [thread?.messages]);
  const pageTitle = localizedAssistantPageLabel(appLanguage, pagePath, thread?.pageTitle);
  const emptySuggestions = localizedAssistantEmptySuggestions(appLanguage, pagePath);
  const assistantClass = [
    "page-assistant",
    isExpanded ? "expanded" : ""
  ].filter(Boolean).join(" ");

  useEffect(() => {
    assistantUserIdRef.current = getOrCreateAssistantUserId();
  }, []);

  useEffect(() => {
    setAppLanguage(readRouteAppLanguage() || readStoredAppLanguage() || normalizeAppLanguage(initialLanguage) || DEFAULT_APP_LANGUAGE);
    return subscribeAppLanguage(setAppLanguage);
  }, [initialLanguage]);

  useEffect(() => {
    const controller = new AbortController();
    const userId = assistantUserIdRef.current || getOrCreateAssistantUserId();
    assistantUserIdRef.current = userId;
    setBusy("load");
    setError("");

    fetch(`/api/assistant/page?pagePath=${encodeURIComponent(pagePath)}`, {
      cache: "no-store",
      headers: assistantHeaders(userId),
      signal: controller.signal
    })
      .then((response) => assertOk(response, t.errors.generic))
      .then((data) => {
        setThread(data.thread as AssistantThread);
      })
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t.errors.load);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy("");
        }
      });

    return () => controller.abort();
  }, [pagePath]);

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
        pagePath,
        pageTitle,
        messages: [optimisticMessage],
        updatedAt: optimisticMessage.createdAt
      });

    try {
      const data = await fetch("/api/assistant/page", {
        method: "POST",
        headers: assistantHeaders(assistantUserIdRef.current, { "content-type": "application/json" }),
        body: JSON.stringify({
          pagePath,
          message,
          userId: assistantUserIdRef.current
        })
      }).then((response) => assertOk(response, t.errors.generic));
      setThread(data.thread as AssistantThread);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : t.errors.request);
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
    const confirmed = window.confirm(t.clearConversationConfirm);
    if (!confirmed) {
      return;
    }
    setBusy("clear");
    setError("");
    try {
      await fetch(`/api/assistant/page?pagePath=${encodeURIComponent(pagePath)}`, {
        method: "DELETE",
        headers: assistantHeaders(assistantUserIdRef.current, { "content-type": "application/json" }),
        body: JSON.stringify({
          pagePath,
          userId: assistantUserIdRef.current
        })
      }).then((response) => assertOk(response, t.errors.generic));
      setThread((current) => current ? { ...current, messages: [], updatedAt: new Date().toISOString() } : current);
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : t.errors.clear);
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
      setError(t.errors.copy);
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
        aria-label={isOpen ? t.closeAssistant : t.openAssistant}
      >
        <span className="page-assistant-launcher-icon"><MessageCircle size={22} /></span>
        <span className="page-assistant-launcher-copy">
          <strong>{t.launcherLabel}</strong>
          <small>{pageTitle}</small>
        </span>
      </button>

      {isOpen && (
        <section className="page-assistant-panel" aria-label={t.panelLabel}>
          <header className="page-assistant-header">
            <div className="page-assistant-title">
              <span><Bot size={18} /></span>
              <div>
                <strong>{t.assistant}</strong>
                <small>{pageTitle}</small>
              </div>
            </div>
            <div className="page-assistant-actions">
              <button type="button" onClick={clearThread} disabled={busy === "clear" || messages.length === 0} title={t.clearConversation} aria-label={t.clearConversation}>
                {busy === "clear" ? <RefreshCw size={16} className="spin" /> : <Eraser size={16} />}
              </button>
              <button type="button" onClick={() => setIsExpanded((current) => !current)} title={isExpanded ? t.condenseAssistant : t.expandAssistant} aria-label={isExpanded ? t.condenseAssistant : t.expandAssistant}>
                {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
              </button>
              <button type="button" onClick={() => setIsOpen(false)} title={t.collapseAssistant} aria-label={t.collapseAssistant}>
                <Minus size={16} />
              </button>
            </div>
          </header>

          <div className="page-assistant-body">
            {error && (
              <div className="page-assistant-notice" role="status">
                <span>{error}</span>
                <button type="button" onClick={() => setError("")} aria-label={t.dismissNotice}><X size={14} /></button>
              </div>
            )}
            {messages.length > 0 ? (
              <div className="page-assistant-messages">
                {messages.map((message) => {
                  const isUser = message.role === "user";
                  return (
                    <article className={`page-assistant-message ${isUser ? "user" : "assistant"}`} key={message.id}>
                      <div className="page-assistant-message-meta">
                        <strong>{isUser ? t.you : t.assistant}</strong>
                        <span>{formatTime(message.createdAt, appLanguage)}</span>
                        <button type="button" onClick={() => copyMessage(message)} title={t.copyMessage} aria-label={t.copyMessage}>
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
                {busy === "send" && <TypingIndicator label={t.typing} />}
                <div ref={messagesEndRef} />
              </div>
            ) : (
              <AssistantEmptyState
                environmentLabel={ASSISTANT_ENVIRONMENT_LABEL || t.empty.environmentFallback}
                loading={busy === "load"}
                modelLabel={ASSISTANT_MODEL_LABEL || t.empty.modelFallback}
                onSelectSuggestion={setInput}
                pageTitle={pageTitle}
                suggestions={emptySuggestions}
                t={t.empty}
              />
            )}
          </div>

          <form className="page-assistant-form" onSubmit={submitMessage}>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t.placeholder}
              rows={2}
            />
            <button type="submit" disabled={!input.trim() || busy === "send"} className="page-assistant-send">
              {busy === "send" ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
              <span>{t.send}</span>
            </button>
          </form>
        </section>
      )}
    </div>
  );
}

function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="page-assistant-typing" aria-label={label}>
      <span />
      <span />
      <span />
    </div>
  );
}

function AssistantEmptyState({
  environmentLabel,
  loading,
  modelLabel,
  onSelectSuggestion,
  pageTitle,
  suggestions,
  t
}: {
  environmentLabel: string;
  loading: boolean;
  modelLabel: string;
  onSelectSuggestion: (suggestion: string) => void;
  pageTitle: string;
  suggestions: string[];
  t: (typeof assistantCopy)[AppLanguageCode]["empty"];
}) {
  if (loading) {
    return (
      <div className="page-assistant-empty is-loading">
        <RefreshCw size={24} className="spin" />
        <span>{t.loading}</span>
      </div>
    );
  }

  return (
    <div className="page-assistant-empty">
      <div className="page-assistant-empty-hero">
        <span><MessageCircle size={22} /></span>
        <div>
          <strong>{t.title}</strong>
          <p>{t.intro}</p>
        </div>
      </div>
      <div className="page-assistant-empty-meta" aria-label={t.contextLabel}>
        <span>{t.contextLabel}: {pageTitle}</span>
        <span>{t.environmentLabel}: {environmentLabel}</span>
        <span>{t.modelLabel}: {modelLabel}</span>
      </div>
      <div className="page-assistant-empty-suggestions">
        <strong>{t.suggestionsLabel}</strong>
        <div>
          {suggestions.map((suggestion) => (
            <button type="button" key={suggestion} onClick={() => onSelectSuggestion(suggestion)}>
              {suggestion}
            </button>
          ))}
        </div>
      </div>
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

async function assertOk(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof data.message === "string" ? data.message : fallback);
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

function formatTime(value: string, language: AppLanguageCode) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Intl.DateTimeFormat(language === "zh" ? "zh-CN" : undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
}
