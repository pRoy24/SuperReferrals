import { timingSafeEqual } from "node:crypto";
import { env } from "./env";
import { nowIso } from "./ids";
import { resolveRenditionLanguageCode } from "./rendition-language";
import type {
  Generation,
  GenerationInput,
  INFTRecord,
  PublicFeedItem,
  SuperReferralsStore
} from "./types";

export type AdminPublishedFeedItem = PublicFeedItem & {
  customerName: string;
};

export type AdminDashboardPayload = {
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
  publishedItems: AdminPublishedFeedItem[];
};

export function assertAdminSecret(input: unknown) {
  const expected = env("ADMIN_SECRET");
  if (!expected) {
    throw Object.assign(new Error("ADMIN_SECRET is not configured."), { status: 503 });
  }
  const provided = String(input || "");
  if (!safeEqual(provided, expected)) {
    throw Object.assign(new Error("Invalid admin secret."), { status: 401 });
  }
}

export function buildAdminDashboardPayload(store: SuperReferralsStore): AdminDashboardPayload {
  const publishedItems = buildAdminPublishedFeedItems(store);
  const completedRenditions = store.generations.filter((generation) => generation.status === "COMPLETED");
  const views = store.feedViews.reduce((total, view) => total + Math.max(0, Number(view.count || 0)), 0);

  return {
    analytics: {
      storefronts: store.customers.filter((customer) => Boolean(customer.storefront)).length,
      customers: store.customers.length,
      walletUsers: store.subAccounts.length,
      renditions: store.generations.length,
      completedRenditions: completedRenditions.length,
      publishedRenditions: publishedItems.length,
      unpublishedCompletedRenditions: completedRenditions.filter((generation) => generation.feed?.published !== true).length,
      portraitPublished: publishedItems.filter((item) => item.aspectRatio === "9:16").length,
      landscapePublished: publishedItems.filter((item) => item.aspectRatio === "16:9").length,
      likes: store.feedLikes.length,
      comments: store.feedComments.length,
      views
    },
    publishedItems
  };
}

export function applyAdminFeedOrder(store: SuperReferralsStore, orderIds: unknown) {
  const requestedIds = Array.isArray(orderIds)
    ? orderIds.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  const publishedGenerations = store.generations
    .filter((generation) => isPublishedVideoGeneration(store, generation))
    .sort(compareAdminGenerations);
  const requestedSet = new Set(requestedIds);
  const orderedIds = [
    ...requestedIds.filter((id) => publishedGenerations.some((generation) => generation.id === id)),
    ...publishedGenerations
      .filter((generation) => !requestedSet.has(generation.id))
      .map((generation) => generation.id)
  ];
  const orderById = new Map(orderedIds.map((id, index) => [id, index]));
  const timestamp = nowIso();

  for (const generation of store.generations) {
    const order = orderById.get(generation.id);
    if (order === undefined) {
      continue;
    }
    generation.feed = {
      ...(generation.feed || { published: true, tags: [] }),
      published: true,
      tags: generation.feed?.tags || [],
      publishedAt: generation.feed?.publishedAt || generation.updatedAt || generation.createdAt || timestamp,
      adminOrder: order
    };
    generation.updatedAt = timestamp;
  }
}

export function unpublishAdminFeedItem(store: SuperReferralsStore, generationId: string) {
  const generation = store.generations.find((item) => item.id === generationId);
  if (!generation || generation.status !== "COMPLETED" || generation.feed?.published !== true) {
    throw Object.assign(new Error("Published video was not found."), { status: 404 });
  }
  const nextFeed = {
    ...(generation.feed || { tags: [] }),
    published: false
  };
  delete nextFeed.adminOrder;
  generation.feed = nextFeed;
  generation.updatedAt = nowIso();
}

function buildAdminPublishedFeedItems(store: SuperReferralsStore): AdminPublishedFeedItem[] {
  return store.generations
    .filter((generation) => isPublishedVideoGeneration(store, generation))
    .map((generation) => buildAdminPublishedFeedItem(store, generation))
    .filter((item): item is AdminPublishedFeedItem => Boolean(item))
    .sort(compareAdminFeedItems);
}

function buildAdminPublishedFeedItem(store: SuperReferralsStore, generation: Generation): AdminPublishedFeedItem | null {
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
    .reduce((total, view) => total + Math.max(0, Number(view.count || 0)), 0);
  const publishedAt = generation.feed?.publishedAt || generation.updatedAt || generation.createdAt;

  return {
    id: generation.id,
    generationId: generation.id,
    inftId: inft?.id || generation.inftId,
    customerId: generation.customerId,
    customerName: customer?.name || "SuperReferrals customer",
    subAccountId: generation.subAccountId,
    authorName: cleanText(subAccount?.username) || cleanText(subAccount?.email?.split("@")[0]) || "SuperReferrals creator",
    referrerCode: generation.referrerCode,
    title: feedTitle(generation, inft),
    description: feedDescription(generation, inft),
    videoUrl,
    posterUrl: firstImageUrl(generation.input),
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
    publishedAt
  };
}

function isPublishedVideoGeneration(store: SuperReferralsStore, generation: Generation) {
  if (generation.status !== "COMPLETED" || generation.feed?.published !== true) {
    return false;
  }
  if (generation.resultUrl) {
    return true;
  }
  return store.infts.some((item) =>
    (item.generationId === generation.id || item.id === generation.inftId) &&
    Boolean(item.videoUrl)
  );
}

function compareAdminGenerations(left: Generation, right: Generation) {
  return compareAdminOrderValues(
    normalizeAdminOrder(left.feed?.adminOrder),
    normalizeAdminOrder(right.feed?.adminOrder)
  ) || generationTime(right) - generationTime(left);
}

function compareAdminFeedItems(left: AdminPublishedFeedItem, right: AdminPublishedFeedItem) {
  return compareAdminOrderValues(
    normalizeAdminOrder(left.adminOrder),
    normalizeAdminOrder(right.adminOrder)
  ) || feedItemTime(right) - feedItemTime(left);
}

function compareAdminOrderValues(left?: number, right?: number) {
  if (left === undefined && right === undefined) {
    return 0;
  }
  if (left === undefined) {
    return 1;
  }
  if (right === undefined) {
    return -1;
  }
  return left - right;
}

function generationTime(generation: Generation) {
  const createdAt = Date.parse(generation.createdAt);
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }
  const publishedAt = Date.parse(generation.feed?.publishedAt || generation.updatedAt);
  return Number.isFinite(publishedAt) ? publishedAt : 0;
}

function feedItemTime(item: AdminPublishedFeedItem) {
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

function firstImageUrl(input: GenerationInput) {
  for (const item of input.image_urls || []) {
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

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
