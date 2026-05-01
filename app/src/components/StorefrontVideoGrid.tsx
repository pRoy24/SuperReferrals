"use client";

import { ChevronDown, Eye, EyeOff, MoreHorizontal, RefreshCw, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import VideoMosaic from "@/components/VideoMosaic";
import { readStoredAppLanguage, subscribeAppLanguage } from "@/lib/app-language-client";
import { DEFAULT_APP_LANGUAGE, videoLanguageMatchesAppLanguage } from "@/lib/localization";
import { resolveRenditionLanguageCode } from "@/lib/rendition-language";
import { feedViewModeForAspectRatio, storefrontInternalPath } from "@/lib/storefront-routing";
import { fetchWithSamsarAuth } from "@/lib/storefront-auth-client";
import type { AppLanguageCode, Generation, INFTRecord, PublicFeedItem, SuperReferralsStore } from "@/lib/types";

export type StorefrontVideoItem = PublicFeedItem & {
  creatorWallet?: string;
  published: boolean;
};

type StorefrontVideoMode = "published" | "unpublished";
export type StorefrontVideoAction = "publish" | "unpublish" | "delete";

type StorefrontVideoGridProps = {
  actor: "owner" | "user";
  customerId: string;
  emptyText?: string;
  initialPageSize?: number;
  onRefresh?: () => Promise<void> | void;
  pageSizeOptions?: number[];
  showCreatorWallet?: boolean;
  store: SuperReferralsStore;
  subAccountId?: string;
  wallet?: string;
};

export default function StorefrontVideoGrid({
  actor,
  customerId,
  emptyText = "No videos yet.",
  initialPageSize = 9,
  onRefresh,
  pageSizeOptions = [6, 9, 12, 24],
  showCreatorWallet = false,
  store,
  subAccountId,
  wallet
}: StorefrontVideoGridProps) {
  const [busyAction, setBusyAction] = useState("");
  const [confirmDeleteItem, setConfirmDeleteItem] = useState<StorefrontVideoItem | null>(null);
  const [localStore, setLocalStore] = useState(store);
  const [listVersion, setListVersion] = useState(0);
  const [mode, setMode] = useState<StorefrontVideoMode>("published");
  const [appLanguage, setAppLanguage] = useState<AppLanguageCode>(DEFAULT_APP_LANGUAGE);
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const allItems = useMemo(
    () => buildStorefrontVideoItems(localStore, {
      customerId,
      published: mode === "published",
      subAccountId
    }),
    [customerId, mode, localStore, subAccountId]
  );
  const items = useMemo(
    () => allItems.filter((item) => videoLanguageMatchesAppLanguage(item.languageCode, appLanguage)),
    [allItems, appLanguage]
  );
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Math.min(page, pageCount);
  const pageItems = items.slice((normalizedPage - 1) * pageSize, normalizedPage * pageSize);
  const deleteBusy = confirmDeleteItem ? busyAction === `delete:${confirmDeleteItem.generationId}` : false;

  useEffect(() => {
    setLocalStore(store);
    setListVersion((current) => current + 1);
  }, [store]);

  useEffect(() => {
    setAppLanguage(readStoredAppLanguage() || DEFAULT_APP_LANGUAGE);
    return subscribeAppLanguage(setAppLanguage);
  }, []);

  useEffect(() => {
    setPage(1);
  }, [appLanguage, customerId, pageSize, mode, subAccountId]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  async function updateVideo(item: StorefrontVideoItem, action: StorefrontVideoAction) {
    setBusyAction(`${action}:${item.generationId}`);
    setMessage("");
    try {
      const result = await sendGenerationAction(item, action);
      await refreshVideoLists(item, action, result);
      setMessage(actionMessage(action));
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video update failed.");
      return false;
    } finally {
      setBusyAction("");
    }
  }

  async function confirmDeleteVideo() {
    if (!confirmDeleteItem) {
      return;
    }
    const deleted = await updateVideo(confirmDeleteItem, "delete");
    if (deleted) {
      setConfirmDeleteItem(null);
    }
  }

  async function refreshVideoLists(
    item: StorefrontVideoItem,
    action: StorefrontVideoAction,
    result?: Record<string, unknown>
  ) {
    setLocalStore((current) => applyStorefrontVideoMutation(current, item, action, result));
    setListVersion((current) => current + 1);
    await onRefresh?.();
    setListVersion((current) => current + 1);
  }

  async function sendGenerationAction(
    item: StorefrontVideoItem,
    action: StorefrontVideoAction
  ) {
    const fetcher = actor === "owner" ? fetchWithSamsarAuth : fetch;
    const response = await fetcher(`/api/generations/${encodeURIComponent(item.generationId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        actor,
        customerId,
        subAccountId,
        wallet
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "Video update failed.");
    }
    return data as Record<string, unknown>;
  }

  return (
    <div className="storefront-video-grid-manager">
      <div className="storefront-video-grid-toolbar">
        <div className="storefront-video-count">
          <strong>{items.length}</strong>
          <span>{mode === "published" ? "published videos" : "unpublished videos"}</span>
        </div>
        <div className="storefront-video-mode-toggle" role="group" aria-label="Video view">
          <button className={mode === "published" ? "active" : ""} onClick={() => setMode("published")} type="button">
            Published
          </button>
          <button className={mode === "unpublished" ? "active" : ""} onClick={() => setMode("unpublished")} type="button">
            Unpublished
          </button>
        </div>
        <label className="storefront-video-page-size">
          <SlidersHorizontal size={15} />
          <span>Items</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      {message && <p className="notice compact">{message}</p>}

      <VideoMosaic
        actions={(item) => (
          <StorefrontVideoActions
            busyAction={busyAction}
            item={item as StorefrontVideoItem}
            onAction={updateVideo}
            onDelete={setConfirmDeleteItem}
          />
        )}
        emptyText={mode === "published" ? emptyText : "No unpublished videos for this storefront yet."}
        feedHrefForItem={(item) => storefrontInternalPath(customerId, "video", {
          generationId: item.generationId,
          viewMode: feedViewModeForAspectRatio(item.aspectRatio)
        })}
        getCreatorWallet={(item) => (item as StorefrontVideoItem).creatorWallet}
        items={pageItems}
        key={`${mode}:${listVersion}`}
        moreHref=""
        showCreatorWallet={showCreatorWallet}
        showFeedLink={(item) => (item as StorefrontVideoItem).published}
        showInftLink
      />

      {items.length > 0 && (
        <div className="storefront-video-pagination">
          <button className="btn small" disabled={normalizedPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
            Previous
          </button>
          <span>Page {normalizedPage} of {pageCount}</span>
          <button className="btn small" disabled={normalizedPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">
            Next
          </button>
        </div>
      )}

      {confirmDeleteItem && (
        <StorefrontVideoDeleteDialog
          busy={deleteBusy}
          onCancel={() => setConfirmDeleteItem(null)}
          onConfirm={confirmDeleteVideo}
        />
      )}
    </div>
  );
}

export function StorefrontVideoActions({
  busyAction,
  item,
  onAction,
  onDelete
}: {
  busyAction: string;
  item: StorefrontVideoItem;
  onAction: (item: StorefrontVideoItem, action: StorefrontVideoAction) => Promise<unknown> | unknown;
  onDelete: (item: StorefrontVideoItem) => void;
}) {
  const [open, setOpen] = useState(false);
  const itemBusy = busyAction.endsWith(`:${item.generationId}`);
  const disabled = Boolean(busyAction);

  function runAction(action: StorefrontVideoAction) {
    setOpen(false);
    void onAction(item, action);
  }

  function requestDelete() {
    setOpen(false);
    onDelete(item);
  }

  return (
    <div
      className="video-mosaic-action-menu"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
        }
      }}
    >
      <button
        aria-expanded={open}
        aria-haspopup="menu"
        className="video-mosaic-action video-mosaic-action-trigger"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        {itemBusy ? <RefreshCw size={14} className="spin" /> : <MoreHorizontal size={14} />}
        Actions
        <ChevronDown size={14} className={open ? "rotate-180" : ""} />
      </button>
      {open && (
        <div className="video-mosaic-action-dropdown" role="menu">
          {item.published ? (
            <button className="video-mosaic-action-option" onClick={() => runAction("unpublish")} role="menuitem" type="button">
              <EyeOff size={14} />
              Unpublish
            </button>
          ) : (
            <button className="video-mosaic-action-option" onClick={() => runAction("publish")} role="menuitem" type="button">
              <Eye size={14} />
              Publish
            </button>
          )}
          <button className="video-mosaic-action-option danger" onClick={requestDelete} role="menuitem" type="button">
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

export function StorefrontVideoDeleteDialog({
  busy,
  onCancel,
  onConfirm
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="video-delete-dialog-backdrop" onClick={() => busy ? undefined : onCancel()}>
      <div
        aria-labelledby="video-delete-title"
        aria-modal="true"
        className="video-delete-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <h3 id="video-delete-title">Are you sure?</h3>
        <p>This action is not reversible.</p>
        <div className="video-delete-dialog-actions">
          <button className="btn small" disabled={busy} onClick={onCancel} type="button">
            Cancel
          </button>
          <button className="btn small warn" disabled={busy} onClick={onConfirm} type="button">
            {busy && <RefreshCw size={14} className="spin" />}
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

function actionMessage(action: StorefrontVideoAction) {
  if (action === "publish") {
    return "Video published.";
  }
  if (action === "delete") {
    return "Video deleted permanently.";
  }
  return "Video unpublished.";
}

function applyStorefrontVideoMutation(
  store: SuperReferralsStore,
  item: StorefrontVideoItem,
  action: StorefrontVideoAction,
  result?: Record<string, unknown>
): SuperReferralsStore {
  if (action === "delete") {
    return removeVideoFromLocalStore(store, item);
  }
  const resultGeneration = readResultGeneration(result);
  return {
    ...store,
    generations: store.generations.map((generation) => {
      if (generation.id !== item.generationId) {
        return generation;
      }
      if (resultGeneration) {
        return resultGeneration;
      }
      return {
        ...generation,
        feed: {
          ...(generation.feed || { tags: [] }),
          published: action === "publish",
          publishedAt: action === "publish"
            ? generation.feed?.publishedAt || new Date().toISOString()
            : generation.feed?.publishedAt
        }
      };
    })
  };
}

function removeVideoFromLocalStore(store: SuperReferralsStore, item: StorefrontVideoItem): SuperReferralsStore {
  const generationIds = new Set<string>([item.generationId]);
  const inftIds = new Set<string>();
  const quoteIds = new Set<string>();
  if (item.inftId) {
    inftIds.add(item.inftId);
  }
  for (const generation of store.generations) {
    if (generationIds.has(generation.id) && generation.inftId) {
      inftIds.add(generation.inftId);
    }
    if (generationIds.has(generation.id) && generation.payment.quoteId) {
      quoteIds.add(generation.payment.quoteId);
    }
  }
  for (const inft of store.infts) {
    if (generationIds.has(inft.generationId)) {
      inftIds.add(inft.id);
    }
  }
  const removedJobIds = new Set(
    store.agentJobs
      .filter((job) =>
        generationIds.has(job.generationId || "") ||
        inftIds.has(job.inftId || "")
      )
      .map((job) => job.id)
  );
  return {
    ...store,
    generations: store.generations.filter((generation) =>
      !generationIds.has(generation.id) &&
      !inftIds.has(generation.inftId || "")
    ),
    infts: store.infts.filter((inft) =>
      !inftIds.has(inft.id) &&
      !generationIds.has(inft.generationId)
    ),
    feedLikes: store.feedLikes.filter((like) => !generationIds.has(like.generationId)),
    feedComments: store.feedComments.filter((comment) => !generationIds.has(comment.generationId)),
    feedViews: store.feedViews.filter((view) => !generationIds.has(view.generationId)),
    storefrontRatings: store.storefrontRatings.filter((rating) =>
      !generationIds.has(rating.generationId || "") &&
      !inftIds.has(rating.inftId || "")
    ),
    quotes: store.quotes.filter((quote) => !inftIds.has(quote.inftId || "") && !quoteIds.has(quote.id)),
    agentJobs: store.agentJobs.filter((job) =>
      !generationIds.has(job.generationId || "") &&
      !inftIds.has(job.inftId || "")
    ),
    agentTownEvents: store.agentTownEvents.filter((event) => !removedJobIds.has(event.jobId || ""))
  };
}

function readResultGeneration(result?: Record<string, unknown>) {
  const generation = result?.generation;
  if (!generation || typeof generation !== "object" || Array.isArray(generation)) {
    return undefined;
  }
  return typeof (generation as Generation).id === "string"
    ? generation as Generation
    : undefined;
}

function buildStorefrontVideoItems(
  store: SuperReferralsStore,
  filters: { customerId: string; published: boolean; subAccountId?: string }
): StorefrontVideoItem[] {
  return store.generations
    .filter((generation) =>
      generation.customerId === filters.customerId &&
      generation.status === "COMPLETED" &&
      (!filters.subAccountId || generation.subAccountId === filters.subAccountId) &&
      (generation.feed?.published === true) === filters.published
    )
    .map((generation) => buildStorefrontVideoItem(store, generation))
    .filter((item): item is StorefrontVideoItem => Boolean(item))
    .sort(compareStorefrontVideoItems);
}

function compareStorefrontVideoItems(left: StorefrontVideoItem, right: StorefrontVideoItem) {
  if (left.published && right.published) {
    const leftAdminOrder = normalizeAdminOrder(left.adminOrder);
    const rightAdminOrder = normalizeAdminOrder(right.adminOrder);
    if (leftAdminOrder !== undefined && rightAdminOrder !== undefined) {
      return leftAdminOrder - rightAdminOrder || videoTime(right) - videoTime(left);
    }
  }
  return videoTime(right) - videoTime(left);
}

export function buildStorefrontVideoItem(store: SuperReferralsStore, generation: Generation): StorefrontVideoItem | null {
  const inft = store.infts.find((item) => item.generationId === generation.id || item.id === generation.inftId);
  const videoUrl = generation.resultUrl || inft?.videoUrl || "";
  if (!videoUrl) {
    return null;
  }
  const customer = store.customers.find((item) => item.id === generation.customerId);
  const subAccount = store.subAccounts.find((item) => item.id === generation.subAccountId);
  const comments = store.feedComments
    .filter((comment) => comment.generationId === generation.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 12)
    .reverse();
  const commentCount = store.feedComments.filter((comment) => comment.generationId === generation.id).length;
  const likes = store.feedLikes.filter((like) => like.generationId === generation.id).length;
  const views = store.feedViews
    .filter((view) => view.generationId === generation.id)
    .reduce((total, view) => total + Math.max(0, view.count || 0), 0);
  const publishedAt = generation.feed?.publishedAt || generation.updatedAt || generation.createdAt;

  return {
    id: generation.id,
    generationId: generation.id,
    inftId: inft?.id || generation.inftId,
    customerId: generation.customerId,
    customerName: customer?.name || "SuperReferrals customer",
    subAccountId: generation.subAccountId,
    authorName: cleanText(subAccount?.username) || cleanText(subAccount?.email?.split("@")[0]) || "SuperReferrals creator",
    creatorWallet: subAccount?.wallet,
    referrerCode: generation.referrerCode,
    title: feedTitle(generation, inft),
    description: feedDescription(generation, inft),
    videoUrl,
    posterUrl: firstImageUrl(generation),
    aspectRatio: generation.input.aspect_ratio,
    videoModel: generation.input.video_model,
    languageCode: resolveRenditionLanguageCode(
      generation.languageCode,
      generation.samsarVideoMetadata,
      generation.input.language,
      inft?.languageCode,
      inft?.samsarVideoMetadata
    ),
    tags: generation.feed?.tags || [],
    metrics: {
      likes,
      comments: commentCount,
      views,
      score: likes * 8 + commentCount * 12 + views
    },
    comments,
    likedByViewer: false,
    adminOrder: normalizeAdminOrder(generation.feed?.adminOrder),
    createdAt: generation.createdAt,
    publishedAt,
    published: generation.feed?.published === true
  };
}

function feedTitle(generation: Generation, inft?: INFTRecord) {
  return cleanText(generation.input.metadata?.title) ||
    titleFromSlug(cleanText(generation.input.metadata?.slug)) ||
    inft?.title ||
    "SuperReferrals Video";
}

function feedDescription(generation: Generation, inft?: INFTRecord) {
  return cleanText(generation.input.metadata?.description) ||
    cleanText(generation.input.prompt) ||
    inft?.description ||
    "Published SuperReferrals video";
}

function titleFromSlug(value: string) {
  const slug = value
    .trim()
    .split(/[/?#]/)[0]
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!slug) {
    return "";
  }
  return slug
    .split(" ")
    .map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function firstImageUrl(generation: Generation) {
  for (const item of generation.input.image_urls || []) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const value = cleanText(record.image_url) || cleanText(record.imageUrl) || cleanText(record.url);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function videoTime(item: StorefrontVideoItem) {
  const createdAt = Date.parse(item.createdAt);
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }
  const publishedAt = Date.parse(item.publishedAt);
  return Number.isFinite(publishedAt) ? publishedAt : 0;
}

function normalizeAdminOrder(value: unknown) {
  const order = Number(value);
  return Number.isFinite(order) && order >= 0 ? order : undefined;
}
