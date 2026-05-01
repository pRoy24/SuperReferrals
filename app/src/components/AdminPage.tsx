"use client";

import {
  ArrowDown,
  ArrowUp,
  BarChart3,
  EyeOff,
  Film,
  GripVertical,
  Home,
  Lock,
  RefreshCw,
  Save,
  Store,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from "react";
import LanguageSelector from "@/components/LanguageSelector";
import { readStoredAppLanguage, subscribeAppLanguage } from "@/lib/app-language-client";
import type { EnvDiagnostics } from "@/lib/env-diagnostics";
import { DEFAULT_APP_LANGUAGE, appLanguages, videoLanguageMatchesAppLanguage } from "@/lib/localization";
import type { AppLanguageCode, PublicFeedItem, VideoAspectRatio } from "@/lib/types";

type AdminAspectFilter = "all" | VideoAspectRatio;

type AdminDashboardPayload = {
  envDiagnostics: EnvDiagnostics;
  analytics: {
    storefronts: number;
    customers: number;
    walletUsers: number;
    renditions: number;
    completedRenditions: number;
    publishedRenditions: number;
    unpublishedCompletedRenditions: number;
    portraitPublished: number;
    landscapePublished: number;
    likes: number;
    comments: number;
    views: number;
  };
  publishedItems: PublicFeedItem[];
};

const aspectFilters: Array<{ value: AdminAspectFilter; label: string }> = [
  { value: "all", label: "All published" },
  { value: "9:16", label: "Portrait" },
  { value: "16:9", label: "Landscape" }
];

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [dashboard, setDashboard] = useState<AdminDashboardPayload | null>(null);
  const [items, setItems] = useState<PublicFeedItem[]>([]);
  const [aspectFilter, setAspectFilter] = useState<AdminAspectFilter>("all");
  const [busy, setBusy] = useState<"load" | "save" | "action" | "">("");
  const [message, setMessage] = useState("");
  const [draggedId, setDraggedId] = useState("");
  const [dragOverId, setDragOverId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [appLanguage, setAppLanguage] = useState<AppLanguageCode>(DEFAULT_APP_LANGUAGE);

  const visibleItems = useMemo(
    () => items.filter((item) =>
      videoLanguageMatchesAppLanguage(item.languageCode, appLanguage) &&
      (aspectFilter === "all" || item.aspectRatio === aspectFilter)
    ),
    [appLanguage, aspectFilter, items]
  );
  const languageLabel = appLanguages.find((language) => language.code === appLanguage)?.label || appLanguage.toUpperCase();

  useEffect(() => {
    setAppLanguage(readStoredAppLanguage() || DEFAULT_APP_LANGUAGE);
    return subscribeAppLanguage(setAppLanguage);
  }, []);

  async function loadDashboard(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!secret.trim()) {
      setMessage("Enter the admin secret.");
      return;
    }
    setBusy("load");
    setMessage("");
    try {
      const data = await sendAdminRequest({ action: "dashboard" });
      syncDashboard(data);
      setDirty(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load admin dashboard.");
    } finally {
      setBusy("");
    }
  }

  async function saveOrder() {
    setBusy("save");
    setMessage("");
    try {
      const data = await sendAdminRequest({
        action: "reorder",
        order: items.map((item) => item.id)
      });
      syncDashboard(data);
      setDirty(false);
      setMessage("Video order saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save video order.");
    } finally {
      setBusy("");
    }
  }

  async function updateVideo(action: "unpublish" | "delete", item: PublicFeedItem) {
    if (action === "delete" && !window.confirm(`Delete "${item.title}" permanently?`)) {
      return;
    }
    setBusy("action");
    setMessage("");
    try {
      const data = await sendAdminRequest({
        action,
        generationId: item.generationId
      });
      syncDashboard(data);
      setDirty(false);
      setMessage(action === "delete" ? "Video deleted." : "Video unpublished.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video update failed.");
    } finally {
      setBusy("");
    }
  }

  async function sendAdminRequest(payload: Record<string, unknown>) {
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret,
        ...payload
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "Admin request failed.");
    }
    return data as AdminDashboardPayload;
  }

  function syncDashboard(data: AdminDashboardPayload) {
    setDashboard(data);
    setItems(data.publishedItems);
  }

  function moveItem(sourceId: string, targetId: string) {
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }
    setItems((current) => reorderWithinVisibleItems(current, appLanguage, aspectFilter, sourceId, targetId));
    setDirty(true);
  }

  function moveVisibleItem(item: PublicFeedItem, direction: -1 | 1) {
    const currentIndex = visibleItems.findIndex((candidate) => candidate.id === item.id);
    const target = visibleItems[currentIndex + direction];
    if (target) {
      moveItem(item.id, target.id);
    }
  }

  function handleDragStart(event: DragEvent<HTMLElement>, item: PublicFeedItem) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", item.id);
    setDraggedId(item.id);
  }

  function handleDrop(event: DragEvent<HTMLElement>, item: PublicFeedItem) {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/plain") || draggedId;
    moveItem(sourceId, item.id);
    setDraggedId("");
    setDragOverId("");
  }

  const analytics = dashboard?.analytics;

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <a className="admin-brand-link" href="/">
          <img alt="" aria-hidden="true" height={28} src="/favicon.svg" width={28} />
          <span>SuperReferrals Admin</span>
        </a>
        <nav className="admin-nav" aria-label="Admin navigation">
          <a className="btn" href="/">
            <Home size={16} /> Landing
          </a>
          <a className="btn" href="/feed">
            <Film size={16} /> Feed
          </a>
          <a className="btn" href="/storefronts">
            <Store size={16} /> Storefronts
          </a>
          <a className="btn" href="/dashboard">
            <Lock size={16} /> Console
          </a>
          <LanguageSelector />
        </nav>
      </header>

      <section className="admin-auth-panel">
        <div>
          <span className="eyebrow">Admin</span>
          <h1>SuperReferrals dashboard</h1>
          <p className="subtle">Enter the admin secret to load feed controls and basic analytics.</p>
        </div>
        <form className="admin-secret-form" onSubmit={loadDashboard}>
          <label className="field">
            <span>Admin secret</span>
            <input
              autoComplete="current-password"
              onChange={(event) => setSecret(event.target.value)}
              placeholder="ADMIN_SECRET"
              type="password"
              value={secret}
            />
          </label>
          <button className="btn primary" disabled={busy === "load"} type="submit">
            {busy === "load" ? <RefreshCw size={16} className="spin" /> : <Lock size={16} />}
            Unlock
          </button>
        </form>
      </section>

      {message && <p className="notice">{message}</p>}

      {dashboard?.envDiagnostics.issues.length ? (
        <section className="environment-banner admin-env-banner" role="status" aria-label="Deployment environment diagnostics">
          <span>Config</span>
          <div>
            <p>
              {dashboard.envDiagnostics.environment} configuration has optional operational gaps. The app can still run, but some admin, 0G, settlement, registry, or iNFT functionality may be limited until these values are set.
            </p>
            <ul>
              {dashboard.envDiagnostics.issues.map((issue) => (
                <li key={`${issue.key}:${issue.message}`}>
                  <strong>{issue.key}</strong>: {issue.message} {issue.howToSet}
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      {analytics && (
        <section className="admin-stat-grid" aria-label="Basic analytics">
          <AdminStat label="Storefronts" value={analytics.storefronts} />
          <AdminStat label="Wallet users" value={analytics.walletUsers} />
          <AdminStat label="Renditions" value={analytics.renditions} />
          <AdminStat label="Completed" value={analytics.completedRenditions} />
          <AdminStat label="Published" value={analytics.publishedRenditions} />
          <AdminStat label="Unpublished" value={analytics.unpublishedCompletedRenditions} />
          <AdminStat label="Portrait" value={analytics.portraitPublished} />
          <AdminStat label="Landscape" value={analytics.landscapePublished} />
          <AdminStat label="Views" value={analytics.views} />
          <AdminStat label="Likes" value={analytics.likes} />
          <AdminStat label="Comments" value={analytics.comments} />
          <AdminStat label="Customers" value={analytics.customers} />
        </section>
      )}

      {dashboard && (
        <section className="admin-feed-panel">
          <div className="admin-feed-header">
            <div>
              <span className="eyebrow">Published Feed Order</span>
              <h2>Drag {languageLabel} videos into their feed order.</h2>
              <p className="subtle">
                Only videos matching the current language selector appear here. Saving preserves the global order for other languages.
              </p>
            </div>
            <div className="admin-feed-actions">
              <button className="btn" disabled={Boolean(busy)} onClick={() => loadDashboard()} type="button">
                <RefreshCw size={16} /> Refresh
              </button>
              <button className="btn primary" disabled={!dirty || Boolean(busy)} onClick={saveOrder} type="button">
                {busy === "save" ? <RefreshCw size={16} className="spin" /> : <Save size={16} />}
                Save order
              </button>
            </div>
          </div>

          <div className="admin-filter-row" role="group" aria-label="Published video aspect ratio filter">
            {aspectFilters.map((filter) => (
              <button
                className={aspectFilter === filter.value ? "active" : ""}
                key={filter.value}
                onClick={() => setAspectFilter(filter.value)}
                type="button"
              >
                {filter.label}
              </button>
            ))}
          </div>

          {visibleItems.length === 0 ? (
            <div className="admin-empty">No published {languageLabel} videos match this view.</div>
          ) : (
            <div className="admin-mosaic-grid">
              {visibleItems.map((item, visibleIndex) => (
                <article
                  className={`admin-video-card ${dragOverId === item.id ? "drag-over" : ""}`}
                  draggable={busy === ""}
                  key={item.id}
                  onDragEnd={() => {
                    setDraggedId("");
                    setDragOverId("");
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragOverId(item.id);
                  }}
                  onDragStart={(event) => handleDragStart(event, item)}
                  onDrop={(event) => handleDrop(event, item)}
                >
                  <div className={`admin-video-media ${item.aspectRatio === "9:16" ? "portrait" : "landscape"}`}>
                    <video controls muted playsInline poster={item.posterUrl} preload="metadata" src={item.videoUrl} />
                    <span className="admin-order-badge">#{items.findIndex((candidate) => candidate.id === item.id) + 1}</span>
                  </div>
                  <div className="admin-video-body">
                    <div className="admin-video-title">
                      <span>{item.customerName}</span>
                      <strong>{item.title}</strong>
                    </div>
                    <div className="admin-video-meta">
                      <span>{item.aspectRatio}</span>
                      <span>{item.languageCode || "auto"}</span>
                      <span>{item.metrics.views} views</span>
                    </div>
                    <div className="admin-video-controls">
                      <button className="icon-btn drag-handle" disabled={Boolean(busy)} title="Drag to reorder" type="button">
                        <GripVertical size={16} />
                      </button>
                      <button className="icon-btn" disabled={Boolean(busy) || visibleIndex === 0} onClick={() => moveVisibleItem(item, -1)} title="Move up" type="button">
                        <ArrowUp size={16} />
                      </button>
                      <button className="icon-btn" disabled={Boolean(busy) || visibleIndex === visibleItems.length - 1} onClick={() => moveVisibleItem(item, 1)} title="Move down" type="button">
                        <ArrowDown size={16} />
                      </button>
                      <button className="icon-btn" disabled={Boolean(busy)} onClick={() => updateVideo("unpublish", item)} title="Unpublish" type="button">
                        <EyeOff size={16} />
                      </button>
                      <button className="icon-btn danger" disabled={Boolean(busy)} onClick={() => updateVideo("delete", item)} title="Delete" type="button">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
    </main>
  );
}

function AdminStat({ label, value }: { label: string; value: number }) {
  return (
    <article className="admin-stat">
      <span><BarChart3 size={16} /></span>
      <div>
        <strong>{value.toLocaleString()}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}

function reorderWithinVisibleItems(
  items: PublicFeedItem[],
  appLanguage: AppLanguageCode,
  aspectFilter: AdminAspectFilter,
  sourceId: string,
  targetId: string
) {
  const visibleItems = items.filter((item) =>
    videoLanguageMatchesAppLanguage(item.languageCode, appLanguage) &&
    (aspectFilter === "all" || item.aspectRatio === aspectFilter)
  );
  const sourceIndex = visibleItems.findIndex((item) => item.id === sourceId);
  const targetIndex = visibleItems.findIndex((item) => item.id === targetId);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) {
    return items;
  }

  const reorderedVisible = [...visibleItems];
  const [moved] = reorderedVisible.splice(sourceIndex, 1);
  if (!moved) {
    return items;
  }
  reorderedVisible.splice(targetIndex, 0, moved);

  const visibleIds = new Set(visibleItems.map((item) => item.id));
  let visibleCursor = 0;
  return items.map((item) => {
    if (!visibleIds.has(item.id)) {
      return item;
    }
    const next = reorderedVisible[visibleCursor];
    visibleCursor += 1;
    return next || item;
  });
}
