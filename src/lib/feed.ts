import { createId, nowIso } from "./ids";
import { videoLanguageMatchesAppLanguage } from "./localization";
import { resolveRenditionLanguageCode } from "./rendition-language";
import { mutateStore, readStore } from "./store";
import type {
  FeedComment,
  FeedMetrics,
  FeedSortOption,
  Generation,
  GenerationFeedSettings,
  GenerationInput,
  INFTRecord,
  PublicFeedItem,
  SubAccount,
  SuperReferralsStore
} from "./types";

const MAX_TAGS = 8;
const MAX_TAG_LENGTH = 28;
const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const COMMENT_PREVIEW_LIMIT = 12;

export function normalizeFeedTags(input: unknown): string[] {
  const rawValues = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,#]/)
      : [];
  const seen = new Set<string>();
  const tags: string[] = [];

  for (const value of rawValues) {
    const normalized = normalizeTag(String(value || ""));
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    tags.push(normalized);
    if (tags.length >= MAX_TAGS) {
      break;
    }
  }

  return tags;
}

export function buildGenerationFeedSettings(input?: {
  published?: unknown;
  samsarGalleryPublished?: unknown;
  tags?: unknown;
}, metadata?: Record<string, unknown>): GenerationFeedSettings {
  return {
    published: input?.published !== false,
    tags: normalizeFeedTags(input?.tags ?? metadata?.tags),
    publishedAt: input?.published === false ? undefined : nowIso(),
    samsarGalleryPublished: input?.samsarGalleryPublished !== false
  };
}

export async function listPublicFeedItems(filters: {
  search?: string;
  tag?: string;
  sort?: string;
  limit?: number;
  language?: string;
  viewerId?: string;
  focusId?: string;
  customerId?: string;
} = {}) {
  const store = await readStore();
  const viewerId = normalizeViewerId(filters.viewerId);
  const search = normalizeSearch(filters.search);
  const tag = normalizeTag(filters.tag || "");
  const sort = normalizeSort(filters.sort);
  const limit = normalizeLimit(filters.limit);
  let items = store.generations
    .map((generation) => buildPublicFeedItem(store, generation, viewerId))
    .filter((item): item is PublicFeedItem => Boolean(item));

  if (filters.customerId) {
    items = items.filter((item) => item.customerId === filters.customerId);
  }
  if (search) {
    items = items.filter((item) => searchableText(item).includes(search));
  }
  if (tag) {
    items = items.filter((item) => item.tags.includes(tag));
  }
  if (filters.language) {
    items = items.filter((item) => videoLanguageMatchesAppLanguage(item.languageCode, filters.language));
  }

  items.sort(compareFeedItems);
  const focusId = normalizeFocusId(filters.focusId);
  const focusedItem = focusId
    ? items.find((item) => matchesFeedItemId(item, focusId))
    : undefined;
  let limitedItems = items.slice(0, limit);
  if (focusedItem && !limitedItems.some((item) => item.id === focusedItem.id)) {
    limitedItems = [focusedItem, ...limitedItems.filter((item) => item.id !== focusedItem.id)].slice(0, limit);
  }

  return {
    items: limitedItems,
    tags: collectFeedTags(items),
    sort,
    search,
    selectedTag: tag
  };
}

export async function recordFeedView(generationId: string, viewerIdInput?: string) {
  const viewerId = normalizeViewerId(viewerIdInput);
  return mutateStore((store) => {
    assertPublishedGeneration(store, generationId);
    const timestamp = nowIso();
    const existing = store.feedViews.find((view) =>
      view.generationId === generationId && view.viewerId === viewerId
    );
    if (existing) {
      existing.count += 1;
      existing.updatedAt = timestamp;
    } else {
      store.feedViews.unshift({
        id: createId("fvw"),
        generationId,
        viewerId,
        count: 1,
        createdAt: timestamp,
        updatedAt: timestamp
      });
    }
    return buildPublicFeedItem(store, assertPublishedGeneration(store, generationId), viewerId);
  });
}

export async function toggleFeedLike(generationId: string, viewerIdInput?: string) {
  const viewerId = normalizeViewerId(viewerIdInput);
  return mutateStore((store) => {
    assertPublishedGeneration(store, generationId);
    const existingIndex = store.feedLikes.findIndex((like) =>
      like.generationId === generationId && like.viewerId === viewerId
    );
    let liked = true;
    if (existingIndex >= 0) {
      store.feedLikes.splice(existingIndex, 1);
      liked = false;
    } else {
      store.feedLikes.unshift({
        id: createId("flk"),
        generationId,
        viewerId,
        createdAt: nowIso()
      });
    }

    return {
      liked,
      item: buildPublicFeedItem(store, assertPublishedGeneration(store, generationId), viewerId)
    };
  });
}

export async function addFeedComment(input: {
  generationId: string;
  viewerId?: string;
  authorName?: string;
  body?: string;
}) {
  const viewerId = normalizeViewerId(input.viewerId);
  const body = sanitizeCommentBody(input.body);
  const authorName = sanitizeAuthorName(input.authorName);

  return mutateStore((store) => {
    assertPublishedGeneration(store, input.generationId);
    const timestamp = nowIso();
    const comment: FeedComment = {
      id: createId("fcm"),
      generationId: input.generationId,
      viewerId,
      authorName,
      body,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    store.feedComments.unshift(comment);
    return {
      comment,
      item: buildPublicFeedItem(store, assertPublishedGeneration(store, input.generationId), viewerId)
    };
  });
}

function buildPublicFeedItem(
  store: SuperReferralsStore,
  generation: Generation,
  viewerId: string
): PublicFeedItem | null {
  if (generation.status !== "COMPLETED" || generation.feed?.published !== true) {
    return null;
  }

  const inft = store.infts.find((item) => item.generationId === generation.id || item.id === generation.inftId);
  const videoUrl = generation.resultUrl || inft?.videoUrl || "";
  if (!videoUrl) {
    return null;
  }

  const subAccount = store.subAccounts.find((item) => item.id === generation.subAccountId);
  const customer = store.customers.find((item) => item.id === generation.customerId);
  const metrics = buildMetrics(store, generation);
  const comments = store.feedComments
    .filter((comment) => comment.generationId === generation.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, COMMENT_PREVIEW_LIMIT)
    .reverse();
  const metadata = generation.input.metadata || {};
  const publishedAt = generation.feed.publishedAt || generation.updatedAt || generation.createdAt;
  const baseTags = [
    ...normalizeFeedTags(generation.feed.tags),
    normalizeTag(generation.input.video_model),
    normalizeTag(generation.input.aspect_ratio),
    ...normalizeFeedTags(metadata.tags)
  ].filter(Boolean);

  return {
    id: generation.id,
    generationId: generation.id,
    inftId: inft?.id || generation.inftId,
    customerId: generation.customerId,
    customerName: customer?.name || "SuperReferrals customer",
    subAccountId: generation.subAccountId,
    authorName: creatorName(subAccount),
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
    tags: uniqueTags(baseTags),
    metrics,
    comments,
    likedByViewer: Boolean(viewerId && store.feedLikes.some((like) =>
      like.generationId === generation.id && like.viewerId === viewerId
    )),
    adminOrder: normalizeAdminOrder(generation.feed.adminOrder),
    createdAt: generation.createdAt,
    publishedAt
  };
}

function assertPublishedGeneration(store: SuperReferralsStore, generationId: string) {
  const generation = store.generations.find((item) => item.id === generationId);
  if (!generation || generation.status !== "COMPLETED" || generation.feed?.published !== true) {
    throw new Error("published feed video was not found");
  }
  return generation;
}

function buildMetrics(store: SuperReferralsStore, generation: Generation): FeedMetrics {
  const likes = store.feedLikes.filter((like) => like.generationId === generation.id).length;
  const comments = store.feedComments.filter((comment) => comment.generationId === generation.id).length;
  const views = store.feedViews
    .filter((view) => view.generationId === generation.id)
    .reduce((total, view) => total + Math.max(0, view.count || 0), 0);
  const publishedAt = Date.parse(generation.feed?.publishedAt || generation.updatedAt || generation.createdAt);
  const ageHours = Number.isFinite(publishedAt)
    ? Math.max(1, (Date.now() - publishedAt) / 36e5)
    : 1;
  const recencyBoost = 12 / Math.sqrt(ageHours);
  return {
    likes,
    comments,
    views,
    score: Math.round((likes * 8 + comments * 12 + views * 1.5 + recencyBoost) * 100) / 100
  };
}

function compareFeedItems(left: PublicFeedItem, right: PublicFeedItem) {
  const leftAdminOrder = normalizeAdminOrder(left.adminOrder);
  const rightAdminOrder = normalizeAdminOrder(right.adminOrder);
  if (leftAdminOrder !== undefined && rightAdminOrder !== undefined) {
    return leftAdminOrder - rightAdminOrder || feedCreatedTime(right) - feedCreatedTime(left);
  }
  return feedCreatedTime(right) - feedCreatedTime(left);
}

function normalizeAdminOrder(value: unknown) {
  const order = Number(value);
  return Number.isFinite(order) && order >= 0 ? order : undefined;
}

function feedCreatedTime(item: PublicFeedItem) {
  const createdAt = Date.parse(item.createdAt);
  if (Number.isFinite(createdAt)) {
    return createdAt;
  }
  const publishedAt = Date.parse(item.publishedAt);
  return Number.isFinite(publishedAt) ? publishedAt : 0;
}

function collectFeedTags(items: PublicFeedItem[]) {
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.tags) {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([tag, count]) => ({ tag, count }));
}

function searchableText(item: PublicFeedItem) {
  return normalizeSearch([
    item.title,
    item.description,
    item.customerName,
    item.authorName,
    item.referrerCode,
    item.videoModel,
    item.aspectRatio,
    item.tags.join(" ")
  ].join(" "));
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

function creatorName(subAccount?: SubAccount) {
  return cleanText(subAccount?.username) ||
    cleanText(subAccount?.email?.split("@")[0]) ||
    "SuperReferrals creator";
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

function uniqueTags(tags: string[]) {
  return normalizeFeedTags(tags);
}

function normalizeSort(_sort?: string): FeedSortOption {
  return "newest";
}

function normalizeLimit(limit?: number) {
  if (!Number.isFinite(limit || NaN)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(Number(limit))));
}

function normalizeSearch(value?: string) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFocusId(value?: string) {
  return String(value || "").trim();
}

function matchesFeedItemId(item: PublicFeedItem, value: string) {
  return item.id === value || item.generationId === value || item.inftId === value;
}

function normalizeViewerId(value?: string) {
  const clean = String(value || "").trim().slice(0, 96);
  return clean || "anonymous-feed-viewer";
}

function normalizeTag(value: string) {
  return value
    .trim()
    .replace(/^#+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_TAG_LENGTH);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeAuthorName(value: unknown) {
  return cleanText(value).replace(/\s+/g, " ").slice(0, 48) || "Guest viewer";
}

function sanitizeCommentBody(value: unknown) {
  const body = cleanText(value).replace(/\s+/g, " ").slice(0, 500);
  if (!body) {
    throw new Error("comment body is required");
  }
  return body;
}
