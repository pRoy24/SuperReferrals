"use client";

import {
  ExternalLink,
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
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject, type PointerEvent } from "react";
import type { FeedSortOption, PublicFeedItem } from "@/lib/types";

type FeedViewMode = "mobile" | "desktop";

type FeedResponse = {
  items: PublicFeedItem[];
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
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<FeedSortOption>("ranked");
  const [viewMode, setViewMode] = useState<FeedViewMode>("mobile");
  const [viewerId, setViewerId] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(0.66);
  const [playing, setPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [commentItemId, setCommentItemId] = useState<string | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const mobileCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const viewedItems = useRef(new Set<string>());
  const controlsHideTimer = useRef<number | null>(null);

  const visibleItems = useMemo(
    () => items.filter((item) => isVisibleInFeedMode(item, viewMode)),
    [items, viewMode]
  );
  const activeItem = visibleItems[activeIndex] || visibleItems[0];
  const commentItem = commentItemId ? visibleItems.find((item) => item.id === commentItemId) : undefined;
  const emptyFormatLabel = viewMode === "desktop" ? "landscape" : "portrait";

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
  }, [viewerId, query, sort]);

  useEffect(() => {
    if (visibleItems.length > 0 && activeIndex >= visibleItems.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, visibleItems.length]);

  useEffect(() => {
    setActiveIndex(0);
    setCommentItemId(null);
  }, [viewMode]);

  useEffect(() => {
    if (commentItemId && !visibleItems.some((item) => item.id === commentItemId)) {
      setCommentItemId(null);
    }
  }, [commentItemId, visibleItems]);

  useEffect(() => {
    const current = activeItem?.id;
    for (const [id, video] of Object.entries(videoRefs.current)) {
      if (!video) {
        continue;
      }
      video.muted = muted;
      video.volume = volume;
      if (id === current && playing) {
        video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }, [activeItem?.id, muted, playing, volume, items, viewMode]);

  useEffect(() => {
    if (viewMode !== "desktop" || visibleItems.length < 2 || !playing) {
      return;
    }
    const interval = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % visibleItems.length);
    }, 9500);
    return () => window.clearInterval(interval);
  }, [visibleItems.length, playing, viewMode]);

  useEffect(() => {
    if (viewMode !== "mobile") {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const id = visible?.target.getAttribute("data-feed-id");
      const index = visibleItems.findIndex((item) => item.id === id);
      if (index >= 0) {
        setActiveIndex(index);
      }
    }, { threshold: [0.62, 0.78] });

    for (const item of visibleItems) {
      const node = mobileCardRefs.current[item.id];
      if (node) {
        observer.observe(node);
      }
    }

    return () => observer.disconnect();
  }, [visibleItems, viewMode]);

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

  useEffect(() => {
    return () => {
      if (controlsHideTimer.current !== null) {
        window.clearTimeout(controlsHideTimer.current);
      }
    };
  }, []);

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
      const response = await fetch(`/api/feed?${params.toString()}`, { cache: "no-store" });
      const data = await parseResponse<FeedResponse>(response);
      setItems(data.items);
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

  function selectItem(index: number, behavior: ScrollBehavior = "smooth") {
    if (visibleItems.length === 0) {
      return;
    }
    const nextIndex = (index + visibleItems.length) % visibleItems.length;
    setActiveIndex(nextIndex);
    const nextItem = visibleItems[nextIndex];
    if (viewMode === "mobile" && nextItem) {
      window.requestAnimationFrame(() => {
        mobileCardRefs.current[nextItem.id]?.scrollIntoView({ behavior, block: "start" });
      });
    }
  }

  function changeVolume(nextValue: number) {
    const normalized = Math.max(0, Math.min(1, nextValue));
    setVolume(normalized);
    setMuted(normalized === 0);
  }

  function revealControls(event: PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest(".feed-comment-drawer")) {
      return;
    }
    setControlsVisible(true);
    if (controlsHideTimer.current !== null) {
      window.clearTimeout(controlsHideTimer.current);
    }
    controlsHideTimer.current = window.setTimeout(() => {
      setControlsVisible(false);
      controlsHideTimer.current = null;
    }, 1600);
  }

  function openComments(item: PublicFeedItem) {
    setCommentItemId(item.id);
    setControlsVisible(true);
    if (controlsHideTimer.current !== null) {
      window.clearTimeout(controlsHideTimer.current);
      controlsHideTimer.current = null;
    }
  }

  const feedClass = `feed-shell ${viewMode === "mobile" ? "is-mobile" : "is-desktop"} ${controlsVisible ? "controls-visible" : ""}`;

  return (
    <main className={feedClass} onPointerDown={revealControls} onPointerMove={revealControls}>
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
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos or creators" />
        </label>
        <label className="feed-select">
          <SlidersHorizontal size={16} />
          <select value={sort} onChange={(event) => setSort(event.target.value as FeedSortOption)}>
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      {message && <p className="notice">{message}</p>}

      {loading && items.length === 0 ? (
        <section className="feed-empty">Loading published videos...</section>
      ) : items.length === 0 ? (
        <section className="feed-empty">No published feed videos match these filters.</section>
      ) : visibleItems.length === 0 ? (
        <section className="feed-empty">No {emptyFormatLabel} videos match these filters.</section>
      ) : viewMode === "mobile" ? (
        <section className="mobile-video-feed">
          {visibleItems.map((item, index) => (
            <article
              className={`mobile-feed-card ${index === activeIndex ? "active" : ""}`}
              data-feed-id={item.id}
              key={item.id}
              ref={(node) => {
                mobileCardRefs.current[item.id] = node;
              }}
            >
              <FeedVideo item={item} active={index === activeIndex} muted={muted} playing={playing} videoRefs={videoRefs} onEnded={() => selectItem(index + 1)} />
              <MobileOverlay
                item={item}
                activeIndex={activeIndex}
                items={visibleItems}
                muted={muted}
                playing={playing}
                volume={volume}
                controlsVisible={controlsVisible && index === activeIndex}
                onSelectItem={selectItem}
                onToggleMute={() => setMuted((value) => !value)}
                onTogglePlay={() => setPlaying((value) => !value)}
                onVolume={changeVolume}
                onComments={() => openComments(item)}
                onLike={() => toggleLike(item)}
              />
            </article>
          ))}
          {commentItem && (
            <CommentDrawer
              item={commentItem}
              authorName={authorName}
              commentDraft={commentDrafts[commentItem.id] || ""}
              onAuthorName={setAuthorName}
              onCommentDraft={(value) => setCommentDrafts((current) => ({ ...current, [commentItem.id]: value }))}
              onComment={(event) => addComment(event, commentItem)}
              onClose={() => setCommentItemId(null)}
            />
          )}
        </section>
      ) : (
        <section className="desktop-feed-layout">
          <div className="desktop-player-stage">
            <FeedVideo key={activeItem.id} item={activeItem} active muted={muted} playing={playing} videoRefs={videoRefs} onEnded={() => selectItem(activeIndex + 1)} />
            <DesktopMinimalControls
              item={activeItem}
              activeIndex={activeIndex}
              items={visibleItems}
              muted={muted}
              playing={playing}
              volume={volume}
              onSelectItem={selectItem}
              onToggleMute={() => setMuted((value) => !value)}
              onTogglePlay={() => setPlaying((value) => !value)}
              onVolume={changeVolume}
              onComments={() => openComments(activeItem)}
              onLike={() => toggleLike(activeItem)}
            />
          </div>

          {commentItem && (
            <CommentDrawer
              item={commentItem}
              authorName={authorName}
              commentDraft={commentDrafts[commentItem.id] || ""}
              onAuthorName={setAuthorName}
              onCommentDraft={(value) => setCommentDrafts((current) => ({ ...current, [commentItem.id]: value }))}
              onComment={(event) => addComment(event, commentItem)}
              onClose={() => setCommentItemId(null)}
            />
          )}
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
  activeIndex,
  items,
  muted,
  playing,
  volume,
  controlsVisible,
  onSelectItem,
  onToggleMute,
  onTogglePlay,
  onVolume,
  onComments,
  onLike
}: {
  item: PublicFeedItem;
  activeIndex: number;
  items: PublicFeedItem[];
  muted: boolean;
  playing: boolean;
  volume: number;
  controlsVisible: boolean;
  onSelectItem: (index: number) => void;
  onToggleMute: () => void;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
  onComments: () => void;
  onLike: () => void;
}) {
  return (
    <div className={`mobile-feed-overlay ${controlsVisible ? "visible" : ""}`}>
      <div className="mobile-feed-meta" onPointerDown={(event) => event.stopPropagation()}>
        <FeedMiniMeta item={item} />
      </div>
      <div className="mobile-action-rail" onPointerDown={(event) => event.stopPropagation()}>
        <button className="round-action" onClick={onTogglePlay} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <button className="round-action" onClick={onToggleMute} title={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={20} /> : <Volume2 size={20} />}
        </button>
        <label className="mobile-volume" title="Volume">
          <input
            aria-label="Volume"
            max="100"
            min="0"
            onChange={(event) => onVolume(Number(event.target.value) / 100)}
            type="range"
            value={muted ? 0 : Math.round(volume * 100)}
          />
        </label>
        <button className={`round-action ${item.likedByViewer ? "active" : ""}`} onClick={onLike} title={item.likedByViewer ? "Unlike" : "Like"}>
          <Heart size={20} fill={item.likedByViewer ? "currentColor" : "none"} />
        </button>
        <button className="round-action" onClick={onComments} title="Comments">
          <MessageCircle size={20} />
        </button>
        {item.inftId && (
          <a className="round-action" href={`/inft/${item.inftId}`} title="Open INFT">
            <ExternalLink size={20} />
          </a>
        )}
      </div>
      <FeedTimeline items={items} activeIndex={activeIndex} onSelectItem={onSelectItem} />
    </div>
  );
}

function DesktopMinimalControls({
  item,
  activeIndex,
  items,
  muted,
  playing,
  volume,
  onSelectItem,
  onToggleMute,
  onTogglePlay,
  onVolume,
  onComments,
  onLike
}: {
  item: PublicFeedItem;
  activeIndex: number;
  items: PublicFeedItem[];
  muted: boolean;
  playing: boolean;
  volume: number;
  onSelectItem: (index: number) => void;
  onToggleMute: () => void;
  onTogglePlay: () => void;
  onVolume: (value: number) => void;
  onComments: () => void;
  onLike: () => void;
}) {
  return (
    <div className="feed-minimal-ui" onPointerDown={(event) => event.stopPropagation()}>
      <FeedMiniMeta item={item} />
      <div className="feed-bottom-controls">
        <button className="glass-icon" onClick={onTogglePlay} title={playing ? "Pause" : "Play"}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <button className="glass-icon" onClick={onToggleMute} title={muted ? "Unmute" : "Mute"}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
        <label className="desktop-volume" title="Volume">
          <input
            aria-label="Volume"
            max="100"
            min="0"
            onChange={(event) => onVolume(Number(event.target.value) / 100)}
            type="range"
            value={muted ? 0 : Math.round(volume * 100)}
          />
        </label>
        <button className={`glass-icon ${item.likedByViewer ? "active" : ""}`} onClick={onLike} title={item.likedByViewer ? "Unlike" : "Like"}>
          <Heart size={18} fill={item.likedByViewer ? "currentColor" : "none"} />
        </button>
        <button className="glass-icon" onClick={onComments} title="Comments">
          <MessageCircle size={18} />
        </button>
        {item.inftId && (
          <a className="glass-icon" href={`/inft/${item.inftId}`} title="Open INFT">
            <ExternalLink size={18} />
          </a>
        )}
      </div>
      <FeedTimeline items={items} activeIndex={activeIndex} onSelectItem={onSelectItem} />
    </div>
  );
}

function FeedMiniMeta({ item }: { item: PublicFeedItem }) {
  return (
    <div className="feed-meta">
      <div className="feed-author">@{item.authorName}</div>
      <h2>{item.title}</h2>
    </div>
  );
}

function FeedTimeline({
  items,
  activeIndex,
  onSelectItem
}: {
  items: PublicFeedItem[];
  activeIndex: number;
  onSelectItem: (index: number) => void;
}) {
  return (
    <div className="feed-timeline" aria-label="Feed position">
      {items.map((item, index) => (
        <button
          aria-label={`Open ${item.title}`}
          className={index === activeIndex ? "active" : ""}
          key={item.id}
          onClick={() => onSelectItem(index)}
          title={item.title}
          type="button"
        />
      ))}
    </div>
  );
}

function CommentDrawer({
  item,
  authorName,
  commentDraft,
  onAuthorName,
  onCommentDraft,
  onComment,
  onClose
}: {
  item: PublicFeedItem;
  authorName: string;
  commentDraft: string;
  onAuthorName: (value: string) => void;
  onCommentDraft: (value: string) => void;
  onComment: (event: FormEvent) => void;
  onClose: () => void;
}) {
  return (
    <aside className="feed-comment-drawer open" onPointerDown={(event) => event.stopPropagation()}>
      <CommentPanel
        item={item}
        authorName={authorName}
        commentDraft={commentDraft}
        onAuthorName={onAuthorName}
        onCommentDraft={onCommentDraft}
        onComment={onComment}
        onClose={onClose}
      />
    </aside>
  );
}

function CommentPanel({
  item,
  authorName,
  commentDraft,
  onAuthorName,
  onCommentDraft,
  onComment,
  onClose
}: {
  item: PublicFeedItem;
  authorName: string;
  commentDraft: string;
  onAuthorName: (value: string) => void;
  onCommentDraft: (value: string) => void;
  onComment: (event: FormEvent) => void;
  onClose: () => void;
}) {
  const comments = useMemo(() => item.comments.slice().reverse(), [item.comments]);
  return (
    <section className="comment-panel">
      <div className="panel-header">
        <h2>Comments</h2>
        <div className="panel-actions">
          <span className="badge">{formatMetric(item.metrics.comments)}</span>
          <button className="icon-toggle compact" onClick={onClose} title="Close comments" type="button">
            <X size={16} />
          </button>
        </div>
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

function isVisibleInFeedMode(item: PublicFeedItem, viewMode: FeedViewMode) {
  return viewMode === "mobile"
    ? item.aspectRatio === "9:16"
    : item.aspectRatio !== "9:16";
}
