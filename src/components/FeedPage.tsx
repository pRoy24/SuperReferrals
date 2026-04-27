"use client";

import {
  ExternalLink,
  Eye,
  Heart,
  MessageCircle,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  SlidersHorizontal,
  Smartphone,
  Tags,
  Volume2,
  VolumeX
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject } from "react";
import type { FeedSortOption, PublicFeedItem } from "@/lib/types";

type FeedViewMode = "mobile" | "desktop";

type FeedResponse = {
  items: PublicFeedItem[];
  tags: Array<{ tag: string; count: number }>;
  sort: FeedSortOption;
  search: string;
  selectedTag: string;
};

const sortOptions: Array<{ value: FeedSortOption; label: string }> = [
  { value: "ranked", label: "Ranked" },
  { value: "newest", label: "Newest" },
  { value: "most_liked", label: "Most liked" },
  { value: "most_commented", label: "Most commented" },
  { value: "most_viewed", label: "Most viewed" }
];

export default function FeedPage() {
  const [items, setItems] = useState<PublicFeedItem[]>([]);
  const [tags, setTags] = useState<FeedResponse["tags"]>([]);
  const [query, setQuery] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [sort, setSort] = useState<FeedSortOption>("ranked");
  const [viewMode, setViewMode] = useState<FeedViewMode>("desktop");
  const [viewerId, setViewerId] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(true);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const mobileCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const viewedItems = useRef(new Set<string>());

  const activeItem = items[activeIndex] || items[0];

  useEffect(() => {
    setViewerId(getOrCreateViewerId());
    setAuthorName(window.localStorage.getItem("superreferrals:feed-author") || "");
    setViewMode(window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop");
  }, []);

  useEffect(() => {
    if (!viewerId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      loadFeed().catch((error) => setMessage(error.message));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [viewerId, query, selectedTag, sort]);

  useEffect(() => {
    if (activeIndex >= items.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, items.length]);

  useEffect(() => {
    const current = activeItem?.id;
    for (const [id, video] of Object.entries(videoRefs.current)) {
      if (!video) {
        continue;
      }
      video.muted = muted;
      if (id === current && playing) {
        video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }, [activeItem?.id, muted, playing, items, viewMode]);

  useEffect(() => {
    if (viewMode !== "desktop" || items.length < 2 || !playing) {
      return;
    }
    const interval = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % items.length);
    }, 9500);
    return () => window.clearInterval(interval);
  }, [items.length, playing, viewMode]);

  useEffect(() => {
    if (viewMode !== "mobile") {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const id = visible?.target.getAttribute("data-feed-id");
      const index = items.findIndex((item) => item.id === id);
      if (index >= 0) {
        setActiveIndex(index);
      }
    }, { threshold: [0.62, 0.78] });

    for (const item of items) {
      const node = mobileCardRefs.current[item.id];
      if (node) {
        observer.observe(node);
      }
    }

    return () => observer.disconnect();
  }, [items, viewMode]);

  useEffect(() => {
    if (!activeItem || !viewerId || viewedItems.current.has(activeItem.id)) {
      return;
    }
    viewedItems.current.add(activeItem.id);
    const timeout = window.setTimeout(() => {
      recordView(activeItem.id).catch(() => undefined);
    }, 900);
    return () => window.clearTimeout(timeout);
  }, [activeItem?.id, viewerId]);

  async function loadFeed() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        viewerId,
        sort,
        limit: "80"
      });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      if (selectedTag) {
        params.set("tag", selectedTag);
      }
      const response = await fetch(`/api/feed?${params.toString()}`, { cache: "no-store" });
      const data = await parseResponse<FeedResponse>(response);
      setItems(data.items);
      setTags(data.tags);
    } finally {
      setLoading(false);
    }
  }

  async function recordView(id: string) {
    const response = await fetch(`/api/feed/${id}/view`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewerId })
    });
    const data = await parseResponse<{ item?: PublicFeedItem }>(response);
    if (data.item) {
      updateItem(data.item);
    }
  }

  async function toggleLike(item: PublicFeedItem) {
    const response = await fetch(`/api/feed/${item.id}/like`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ viewerId })
    });
    const data = await parseResponse<{ liked: boolean; item?: PublicFeedItem }>(response);
    if (data.item) {
      updateItem(data.item);
    }
  }

  async function addComment(event: FormEvent, item: PublicFeedItem) {
    event.preventDefault();
    const body = (commentDrafts[item.id] || "").trim();
    if (!body) {
      return;
    }
    const response = await fetch(`/api/feed/${item.id}/comments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        viewerId,
        authorName,
        body
      })
    });
    const data = await parseResponse<{ item?: PublicFeedItem }>(response);
    window.localStorage.setItem("superreferrals:feed-author", authorName);
    setCommentDrafts((current) => ({ ...current, [item.id]: "" }));
    if (data.item) {
      updateItem(data.item);
    }
  }

  function updateItem(nextItem: PublicFeedItem) {
    setItems((current) => current.map((item) => item.id === nextItem.id ? nextItem : item));
  }

  const feedClass = `feed-shell ${viewMode === "mobile" ? "is-mobile" : "is-desktop"}`;

  return (
    <main className={feedClass}>
      <header className="feed-topbar">
        <div>
          <div className="eyebrow">SuperReferrals</div>
          <h1>Video Feed</h1>
        </div>
        <div className="feed-toolbar">
          <button className={`icon-toggle ${viewMode === "mobile" ? "active" : ""}`} onClick={() => setViewMode("mobile")} title="Mobile feed">
            <Smartphone size={18} />
          </button>
          <button className={`icon-toggle ${viewMode === "desktop" ? "active" : ""}`} onClick={() => setViewMode("desktop")} title="Desktop feed">
            <Monitor size={18} />
          </button>
          <button className="icon-toggle" onClick={() => setMuted((value) => !value)} title={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button className="icon-toggle" onClick={() => setPlaying((value) => !value)} title={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="icon-toggle" onClick={() => loadFeed().catch((error) => setMessage(error.message))} title="Refresh feed">
            <RefreshCw size={18} />
          </button>
        </div>
      </header>

      <section className="feed-controls" aria-label="Feed filters">
        <label className="feed-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos, creators, tags" />
        </label>
        <label className="feed-select">
          <SlidersHorizontal size={16} />
          <select value={sort} onChange={(event) => setSort(event.target.value as FeedSortOption)}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <div className="feed-tag-row">
          <button className={`tag-chip ${selectedTag === "" ? "active" : ""}`} onClick={() => setSelectedTag("")}>
            <Tags size={14} /> All
          </button>
          {tags.map((item) => (
            <button className={`tag-chip ${selectedTag === item.tag ? "active" : ""}`} key={item.tag} onClick={() => setSelectedTag(item.tag)}>
              #{item.tag} <span>{item.count}</span>
            </button>
          ))}
        </div>
      </section>

      {message && <p className="notice">{message}</p>}

      {loading && items.length === 0 ? (
        <section className="feed-empty">Loading published videos...</section>
      ) : items.length === 0 ? (
        <section className="feed-empty">No published feed videos match these filters.</section>
      ) : viewMode === "mobile" ? (
        <section className="mobile-video-feed">
          {items.map((item, index) => (
            <article
              className="mobile-feed-card"
              data-feed-id={item.id}
              key={item.id}
              ref={(node) => {
                mobileCardRefs.current[item.id] = node;
              }}
            >
              <FeedVideo item={item} active={index === activeIndex} muted={muted} playing={playing} videoRefs={videoRefs} onEnded={() => setActiveIndex((index + 1) % items.length)} />
              <MobileOverlay
                item={item}
                authorName={authorName}
                commentDraft={commentDrafts[item.id] || ""}
                onAuthorName={setAuthorName}
                onCommentDraft={(value) => setCommentDrafts((current) => ({ ...current, [item.id]: value }))}
                onComment={(event) => addComment(event, item)}
                onLike={() => toggleLike(item)}
              />
            </article>
          ))}
        </section>
      ) : (
        <section className="desktop-feed-layout">
          <div className="desktop-player-stage">
            <FeedVideo item={activeItem} active muted={muted} playing={playing} videoRefs={videoRefs} onEnded={() => setActiveIndex((activeIndex + 1) % items.length)} />
            <div className="desktop-player-caption">
              <FeedMeta item={activeItem} />
              <MetricBar item={activeItem} onLike={() => toggleLike(activeItem)} />
            </div>
          </div>

          <aside className="desktop-feed-panel">
            <CommentPanel
              item={activeItem}
              authorName={authorName}
              commentDraft={commentDrafts[activeItem.id] || ""}
              onAuthorName={setAuthorName}
              onCommentDraft={(value) => setCommentDrafts((current) => ({ ...current, [activeItem.id]: value }))}
              onComment={(event) => addComment(event, activeItem)}
            />
            <div className="desktop-video-rail">
              {items.map((item, index) => (
                <button className={`rail-item ${index === activeIndex ? "active" : ""}`} key={item.id} onClick={() => setActiveIndex(index)}>
                  <span className="rail-thumb">
                    <video src={item.videoUrl} muted playsInline preload="metadata" poster={item.posterUrl} />
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.metrics.score.toFixed(1)} score · {formatMetric(item.metrics.views)} views</small>
                  </span>
                </button>
              ))}
            </div>
          </aside>
        </section>
      )}
    </main>
  );
}

function FeedVideo({
  item,
  active,
  muted,
  playing,
  videoRefs,
  onEnded
}: {
  item: PublicFeedItem;
  active: boolean;
  muted: boolean;
  playing: boolean;
  videoRefs: MutableRefObject<Record<string, HTMLVideoElement | null>>;
  onEnded: () => void;
}) {
  return (
    <video
      className={`feed-video ${item.aspectRatio === "9:16" ? "portrait" : "landscape"}`}
      ref={(node) => {
        videoRefs.current[item.id] = node;
      }}
      src={item.videoUrl}
      poster={item.posterUrl}
      muted={muted}
      loop={false}
      playsInline
      preload={active ? "auto" : "metadata"}
      autoPlay={active && playing}
      onEnded={onEnded}
    />
  );
}

function MobileOverlay({
  item,
  authorName,
  commentDraft,
  onAuthorName,
  onCommentDraft,
  onComment,
  onLike
}: {
  item: PublicFeedItem;
  authorName: string;
  commentDraft: string;
  onAuthorName: (value: string) => void;
  onCommentDraft: (value: string) => void;
  onComment: (event: FormEvent) => void;
  onLike: () => void;
}) {
  return (
    <div className="mobile-feed-overlay">
      <div className="mobile-feed-meta">
        <FeedMeta item={item} />
      </div>
      <div className="mobile-action-rail">
        <button className={`round-action ${item.likedByViewer ? "active" : ""}`} onClick={onLike} title={item.likedByViewer ? "Unlike" : "Like"}>
          <Heart size={21} fill={item.likedByViewer ? "currentColor" : "none"} />
          <span>{formatMetric(item.metrics.likes)}</span>
        </button>
        <span className="round-action static" title="Comments">
          <MessageCircle size={21} />
          <span>{formatMetric(item.metrics.comments)}</span>
        </span>
        <span className="round-action static" title="Views">
          <Eye size={21} />
          <span>{formatMetric(item.metrics.views)}</span>
        </span>
        {item.inftId && (
          <a className="round-action" href={`/inft/${item.inftId}`} title="Open INFT">
            <ExternalLink size={20} />
          </a>
        )}
      </div>
      <form className="mobile-comment-form" onSubmit={onComment}>
        <input value={authorName} onChange={(event) => onAuthorName(event.target.value)} placeholder="Name" />
        <input value={commentDraft} onChange={(event) => onCommentDraft(event.target.value)} placeholder="Comment" />
        <button type="submit" title="Post comment">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}

function FeedMeta({ item }: { item: PublicFeedItem }) {
  return (
    <div className="feed-meta">
      <div className="feed-author">@{item.authorName}</div>
      <h2>{item.title}</h2>
      <p>{item.description}</p>
      <div className="feed-meta-tags">
        {item.tags.slice(0, 5).map((tag) => <span key={tag}>#{tag}</span>)}
      </div>
    </div>
  );
}

function MetricBar({ item, onLike }: { item: PublicFeedItem; onLike: () => void }) {
  return (
    <div className="feed-metrics">
      <button className={`metric-button ${item.likedByViewer ? "active" : ""}`} onClick={onLike}>
        <Heart size={16} fill={item.likedByViewer ? "currentColor" : "none"} /> {formatMetric(item.metrics.likes)}
      </button>
      <span><MessageCircle size={16} /> {formatMetric(item.metrics.comments)}</span>
      <span><Eye size={16} /> {formatMetric(item.metrics.views)}</span>
      <span>{item.metrics.score.toFixed(1)} score</span>
    </div>
  );
}

function CommentPanel({
  item,
  authorName,
  commentDraft,
  onAuthorName,
  onCommentDraft,
  onComment
}: {
  item: PublicFeedItem;
  authorName: string;
  commentDraft: string;
  onAuthorName: (value: string) => void;
  onCommentDraft: (value: string) => void;
  onComment: (event: FormEvent) => void;
}) {
  const comments = useMemo(() => item.comments.slice().reverse(), [item.comments]);
  return (
    <section className="comment-panel">
      <div className="panel-header">
        <h2>Comments</h2>
        <span className="badge">{formatMetric(item.metrics.comments)}</span>
      </div>
      <div className="comment-list">
        {comments.length === 0 && <p className="subtle">No comments yet.</p>}
        {comments.map((comment) => (
          <div className="comment-item" key={comment.id}>
            <strong>{comment.authorName}</strong>
            <p>{comment.body}</p>
          </div>
        ))}
      </div>
      <form className="comment-form" onSubmit={onComment}>
        <input value={authorName} onChange={(event) => onAuthorName(event.target.value)} placeholder="Name" />
        <textarea value={commentDraft} onChange={(event) => onCommentDraft(event.target.value)} placeholder="Add a comment" />
        <button className="btn primary" type="submit">
          <Send size={16} /> Post
        </button>
      </form>
    </section>
  );
}

async function parseResponse<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Feed request failed");
  }
  return data as T;
}

function getOrCreateViewerId() {
  const key = "superreferrals:feed-viewer-id";
  const existing = window.localStorage.getItem(key);
  if (existing) {
    return existing;
  }
  const next = window.crypto?.randomUUID?.() || `viewer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(key, next);
  return next;
}

function formatMetric(value: number) {
  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}m`;
  }
  if (value >= 1_000) {
    return `${(value / 1_000).toFixed(1)}k`;
  }
  return String(value);
}
