"use client";

import { Flame, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import VideoMosaic from "@/components/VideoMosaic";
import { fetchWithSamsarAuth } from "@/lib/storefront-auth-client";
import type { Generation, INFTRecord, PublicFeedItem, SuperReferralsStore } from "@/lib/types";

type StorefrontVideoItem = PublicFeedItem & {
  creatorWallet?: string;
  published: boolean;
};

type StorefrontVideoGridProps = {
  actor: "owner" | "user";
  allowBurn?: boolean;
  customerId: string;
  emptyText?: string;
  initialPageSize?: number;
  onRefresh?: () => Promise<void> | void;
  pageSizeOptions?: number[];
  publishedOnly?: boolean;
  showCreatorWallet?: boolean;
  store: SuperReferralsStore;
  subAccountId?: string;
  wallet?: string;
};

export default function StorefrontVideoGrid({
  actor,
  allowBurn = false,
  customerId,
  emptyText = "No videos yet.",
  initialPageSize = 9,
  onRefresh,
  pageSizeOptions = [6, 9, 12, 24],
  publishedOnly = false,
  showCreatorWallet = false,
  store,
  subAccountId,
  wallet
}: StorefrontVideoGridProps) {
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const items = useMemo(
    () => buildStorefrontVideoItems(store, { customerId, publishedOnly, subAccountId }),
    [customerId, publishedOnly, store, subAccountId]
  );
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Math.min(page, pageCount);
  const pageItems = items.slice((normalizedPage - 1) * pageSize, normalizedPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [customerId, pageSize, publishedOnly, subAccountId]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  async function updateVideo(item: StorefrontVideoItem, action: "unpublish" | "unpublish_and_burn") {
    setBusyAction(`${action}:${item.generationId}`);
    setMessage("");
    try {
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
      await onRefresh?.();
      setMessage(action === "unpublish_and_burn" ? "Video unpublished and INFT burn recorded." : "Video unpublished.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video update failed.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="storefront-video-grid-manager">
      <div className="storefront-video-grid-toolbar">
        <div className="storefront-video-count">
          <strong>{items.length}</strong>
          <span>{publishedOnly ? "published videos" : "videos"}</span>
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
          <VideoActions
            allowBurn={allowBurn}
            busyAction={busyAction}
            item={item as StorefrontVideoItem}
            onAction={updateVideo}
          />
        )}
        emptyText={emptyText}
        getCreatorWallet={(item) => (item as StorefrontVideoItem).creatorWallet}
        items={pageItems}
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
    </div>
  );
}

function VideoActions({
  allowBurn,
  busyAction,
  item,
  onAction
}: {
  allowBurn: boolean;
  busyAction: string;
  item: StorefrontVideoItem;
  onAction: (item: StorefrontVideoItem, action: "unpublish" | "unpublish_and_burn") => Promise<void>;
}) {
  const unpublishBusy = busyAction === `unpublish:${item.generationId}`;
  const burnBusy = busyAction === `unpublish_and_burn:${item.generationId}`;
  if (!item.published) {
    return <span className="video-mosaic-status">Unpublished</span>;
  }
  return (
    <>
      <button className="video-mosaic-action" disabled={Boolean(busyAction)} onClick={() => onAction(item, "unpublish")} type="button">
        {unpublishBusy ? <RefreshCw size={14} className="spin" /> : null}
        Unpublish
      </button>
      {allowBurn && (
        <button
          className="video-mosaic-action danger"
          disabled={Boolean(busyAction) || !item.inftId}
          onClick={() => onAction(item, "unpublish_and_burn")}
          title={item.inftId ? "Unpublish and burn INFT" : "This video has no INFT to burn"}
          type="button"
        >
          {burnBusy ? <RefreshCw size={14} className="spin" /> : <Flame size={14} />}
          Unpublish & burn
        </button>
      )}
    </>
  );
}

function buildStorefrontVideoItems(
  store: SuperReferralsStore,
  filters: { customerId: string; publishedOnly?: boolean; subAccountId?: string }
): StorefrontVideoItem[] {
  return store.generations
    .filter((generation) =>
      generation.customerId === filters.customerId &&
      generation.status === "COMPLETED" &&
      (!filters.subAccountId || generation.subAccountId === filters.subAccountId) &&
      (!filters.publishedOnly || generation.feed?.published === true)
    )
    .map((generation) => buildStorefrontVideoItem(store, generation))
    .filter((item): item is StorefrontVideoItem => Boolean(item))
    .sort((left, right) => videoTime(right) - videoTime(left));
}

function buildStorefrontVideoItem(store: SuperReferralsStore, generation: Generation): StorefrontVideoItem | null {
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
    tags: generation.feed?.tags || [],
    metrics: {
      likes,
      comments: commentCount,
      views,
      score: likes * 8 + commentCount * 12 + views
    },
    comments,
    likedByViewer: false,
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
  return Date.parse(item.publishedAt || item.createdAt) || 0;
}
