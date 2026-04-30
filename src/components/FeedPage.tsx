"use client";

import {
  Bot,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Heart,
  LayoutGrid,
  Maximize2,
  MessageCircle,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Search,
  Send,
  Smartphone,
  Store,
  Volume2,
  VolumeX,
  X
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject, type UIEvent, type WheelEvent } from "react";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import LanguageSelector from "@/components/LanguageSelector";
import { readStoredAppLanguage, subscribeAppLanguage } from "@/lib/app-language-client";
import { DEFAULT_FEED_VIDEO_VOLUME, persistFeedVideoVolume, readFeedVideoVolume, subscribeFeedVideoHardwareVolumeSync, subscribeFeedVideoVolume } from "@/lib/feed-video-preferences";
import { DEFAULT_APP_LANGUAGE } from "@/lib/localization";
import { samsarAuthHeaders } from "@/lib/storefront-auth-client";
import type { AppLanguageCode, PublicFeedItem } from "@/lib/types";

type FeedViewMode = "mobile" | "desktop";
type FeedPageProps = {
  initialGenerationId?: string;
  initialViewMode?: FeedViewMode;
  customerId?: string;
  storefrontHref?: string;
  storefrontLogoUrl?: string;
  storefrontName?: string;
  mosaicHref?: string;
};
type VideoProgress = {
  currentTime: number;
  duration: number;
};

type DesktopDragState = {
  pointerId: number;
  startX: number;
  startY: number;
};

type FeedResponse = {
  items: PublicFeedItem[];
};

type AssistantRole = "user" | "assistant";

type FeedAssistantMessage = {
  id: string;
  role: AssistantRole;
  content: string;
  createdAt: string;
  model?: string;
  network?: string;
};

type FeedAssistantThread = {
  id: string;
  pagePath: string;
  pageTitle: string;
  messages: FeedAssistantMessage[];
  updatedAt: string;
};

const ASSISTANT_USER_STORAGE_KEY = "superreferrals:page-assistant-user";
const WHEEL_SEEK_PIXELS_PER_SECOND = 42;
const MAX_WHEEL_SEEK_SECONDS = 12;
const DESKTOP_SWIPE_NAV_THRESHOLD = 82;
const DESKTOP_SWIPE_NAV_LOCK_MS = 620;
const PRELOAD_READY_STATE = 2; // HAVE_CURRENT_DATA
const PRELOAD_NETWORK_LOADING_STATE = 2; // NETWORK_LOADING

export default function FeedPage({
  initialGenerationId = "",
  initialViewMode,
  customerId = "",
  storefrontHref = "",
  storefrontLogoUrl = "",
  storefrontName = "",
  mosaicHref = ""
}: FeedPageProps = {}) {
  const [items, setItems] = useState<PublicFeedItem[]>([]);
  const [query, setQuery] = useState("");
  const [appLanguage, setAppLanguage] = useState<AppLanguageCode>(DEFAULT_APP_LANGUAGE);
  const [viewMode, setViewMode] = useState<FeedViewMode>("mobile");
  const [viewerId, setViewerId] = useState("");
  const [authorName, setAuthorName] = useState("");
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(DEFAULT_FEED_VIDEO_VOLUME);
  const [playing, setPlaying] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [volumePanelItemId, setVolumePanelItemId] = useState<string | null>(null);
  const [commentItemId, setCommentItemId] = useState<string | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [videoProgress, setVideoProgress] = useState<Record<string, VideoProgress>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const mobileCardRefs = useRef<Record<string, HTMLElement | null>>({});
  const mobileFeedRef = useRef<HTMLElement | null>(null);
  const viewedItems = useRef(new Set<string>());
  const controlsHideTimer = useRef<number | null>(null);
  const mobileScrollFrame = useRef<number | null>(null);
  const mobileScrollTarget = useRef<number | null>(null);
  const mobileScrollTargetTimer = useRef<number | null>(null);
  const desktopDrag = useRef<DesktopDragState | null>(null);
  const desktopWheelSwipeDelta = useRef(0);
  const desktopWheelSwipeLockUntil = useRef(0);
  const desktopWheelSwipeResetTimer = useRef<number | null>(null);
  const initialSelectionApplied = useRef(false);

  const visibleItems = useMemo(
    () => items.filter((item) => isVisibleInFeedMode(item, viewMode)),
    [items, viewMode]
  );
  const activeItem = visibleItems[activeIndex] || visibleItems[0];
  const activeVisibleIndex = activeItem ? visibleItems.findIndex((item) => item.id === activeItem.id) : -1;
  const nextPreloadItem = activeVisibleIndex >= 0 && visibleItems.length > 1
    ? visibleItems[(activeVisibleIndex + 1) % visibleItems.length]
    : undefined;
  const commentItem = commentItemId ? visibleItems.find((item) => item.id === commentItemId) : undefined;
  const emptyFormatLabel = viewMode === "desktop" ? "landscape" : "portrait";

  useEffect(() => {
    setViewerId(getOrCreateViewerId());
    setAppLanguage(readStoredAppLanguage() || DEFAULT_APP_LANGUAGE);
    setAuthorName(window.localStorage.getItem("superreferrals:feed-author") || "");
    const storedVolume = readFeedVideoVolume();
    setVolume(storedVolume);
    if (storedVolume === 0) {
      setMuted(true);
    }
    setViewMode(initialViewMode || (window.matchMedia("(max-width: 760px)").matches ? "mobile" : "desktop"));
  }, [initialViewMode]);

  useEffect(() => subscribeAppLanguage(setAppLanguage), []);

  useEffect(() => subscribeFeedVideoVolume((nextVolume) => {
    setVolume(nextVolume);
    setMuted(nextVolume === 0);
  }), []);

  useEffect(() => subscribeFeedVideoHardwareVolumeSync(), []);

  useEffect(() => {
    initialSelectionApplied.current = false;
  }, [initialGenerationId]);

  useEffect(() => {
    if (!viewerId) {
      return;
    }
    const timeout = window.setTimeout(() => {
      loadFeed().catch((error) => setMessage(error.message));
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [viewerId, query, appLanguage, customerId, initialGenerationId]);

  useEffect(() => {
    if (visibleItems.length > 0 && activeIndex >= visibleItems.length) {
      setActiveIndex(0);
    }
  }, [activeIndex, visibleItems.length]);

  useEffect(() => {
    setActiveIndex(0);
    setCommentItemId(null);
    setVolumePanelItemId(null);
  }, [viewMode]);

  useEffect(() => {
    setVolumePanelItemId(null);
  }, [activeItem?.id]);

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
        if (video.ended) {
          video.currentTime = 0;
        }
        video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    }
  }, [activeItem?.id, muted, playing, volume, items, viewMode]);

  useEffect(() => {
    if (!activeItem || activeVisibleIndex < 0 || visibleItems.length < 2) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      preloadFeedVideo(activeVisibleIndex + 1);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeItem?.id, activeVisibleIndex, visibleItems]);

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
      if (index >= 0 && mobileScrollTarget.current === null) {
        setActiveIndex(index);
        setPlaying(true);
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
      if (mobileScrollFrame.current !== null) {
        window.cancelAnimationFrame(mobileScrollFrame.current);
      }
      if (mobileScrollTargetTimer.current !== null) {
        window.clearTimeout(mobileScrollTargetTimer.current);
      }
      if (desktopWheelSwipeResetTimer.current !== null) {
        window.clearTimeout(desktopWheelSwipeResetTimer.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      document.body.classList.remove("feed-controls-visible");
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("feed-controls-visible", controlsVisible || assistantOpen);
  }, [assistantOpen, controlsVisible]);

  async function loadFeed() {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        viewerId,
        sort: "newest",
        language: appLanguage,
        limit: "80"
      });
      if (query.trim()) {
        params.set("q", query.trim());
      }
      if (initialGenerationId.trim()) {
        params.set("focusId", initialGenerationId.trim());
      }
      if (customerId.trim()) {
        params.set("customerId", customerId.trim());
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

  useEffect(() => {
    if (!initialGenerationId || items.length === 0) {
      return;
    }
    const focusedItem = items.find((item) => matchesInitialFeedItem(item, initialGenerationId));
    if (!focusedItem) {
      return;
    }
    const focusedMode = initialViewMode || feedModeForItem(focusedItem);
    setViewMode((current) => current === focusedMode ? current : focusedMode);
  }, [initialGenerationId, initialViewMode, items]);

  useEffect(() => {
    if (!initialGenerationId || initialSelectionApplied.current) {
      return;
    }
    const index = visibleItems.findIndex((item) => matchesInitialFeedItem(item, initialGenerationId));
    if (index < 0) {
      return;
    }
    initialSelectionApplied.current = true;
    setActiveIndex(index);
    setPlaying(true);
  }, [initialGenerationId, visibleItems]);

  function selectItem(index: number, behavior: ScrollBehavior = "smooth") {
    if (visibleItems.length === 0) {
      return;
    }
    const nextIndex = (index + visibleItems.length) % visibleItems.length;
    setActiveIndex(nextIndex);
    setPlaying(true);
    setVolumePanelItemId(null);
    const nextItem = visibleItems[nextIndex];
    if (viewMode === "mobile" && nextItem) {
      mobileScrollTarget.current = nextIndex;
      if (mobileScrollTargetTimer.current !== null) {
        window.clearTimeout(mobileScrollTargetTimer.current);
      }
      mobileScrollTargetTimer.current = window.setTimeout(() => {
        mobileScrollTarget.current = null;
        mobileScrollTargetTimer.current = null;
      }, 760);
      window.requestAnimationFrame(() => {
        const feed = mobileFeedRef.current;
        const card = mobileCardRefs.current[nextItem.id];
        if (feed && card) {
          feed.scrollTo({ top: Math.max(0, card.offsetTop - feed.offsetTop), behavior });
          return;
        }
        card?.scrollIntoView({ behavior, block: "start" });
      });
    }
  }

  function preloadFeedVideo(index: number) {
    if (visibleItems.length < 2) {
      return;
    }
    const targetIndex = (index + visibleItems.length) % visibleItems.length;
    const targetItem = visibleItems[targetIndex];
    if (!targetItem || targetItem.id === activeItem?.id) {
      return;
    }
    const video = videoRefs.current[targetItem.id];
    if (!video) {
      return;
    }
    video.preload = "auto";
    if (video.readyState >= PRELOAD_READY_STATE || video.networkState === PRELOAD_NETWORK_LOADING_STATE) {
      return;
    }
    video.load();
  }

  function handleVideoProgress(id: string, video: HTMLVideoElement) {
    updateVideoProgress(id, video.currentTime, video.duration);
  }

  function updateVideoProgress(id: string, currentTime: number, duration: number) {
    const nextCurrentTime = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
    const nextDuration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    setVideoProgress((current) => {
      const previous = current[id];
      if (
        previous &&
        Math.abs(previous.currentTime - nextCurrentTime) < 0.12 &&
        Math.abs(previous.duration - nextDuration) < 0.12
      ) {
        return current;
      }
      return {
        ...current,
        [id]: {
          currentTime: nextCurrentTime,
          duration: nextDuration
        }
      };
    });
  }

  function seekVideo(item: PublicFeedItem, nextTime: number) {
    const video = videoRefs.current[item.id];
    const duration = video?.duration || videoProgress[item.id]?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const normalizedTime = Math.max(0, Math.min(duration, nextTime));
    if (video) {
      video.currentTime = normalizedTime;
      if (item.id === activeItem?.id && playing) {
        video.play().catch(() => undefined);
      }
    }
    updateVideoProgress(item.id, normalizedTime, duration);
  }

  function handleMobileScroll(event: UIEvent<HTMLElement>) {
    if (viewMode !== "mobile" || mobileScrollFrame.current !== null) {
      return;
    }
    const feed = event.currentTarget;
    mobileScrollFrame.current = window.requestAnimationFrame(() => {
      mobileScrollFrame.current = null;
      const lockedIndex = mobileScrollTarget.current;
      if (lockedIndex !== null) {
        const lockedItem = visibleItems[lockedIndex];
        const lockedCard = lockedItem ? mobileCardRefs.current[lockedItem.id] : null;
        const targetTop = lockedCard ? Math.max(0, lockedCard.offsetTop - feed.offsetTop) : lockedIndex * Math.max(feed.clientHeight, 1);
        if (Math.abs(feed.scrollTop - targetTop) < 3) {
          mobileScrollTarget.current = null;
          if (mobileScrollTargetTimer.current !== null) {
            window.clearTimeout(mobileScrollTargetTimer.current);
            mobileScrollTargetTimer.current = null;
          }
        }
        return;
      }
      const nextIndex = Math.round(feed.scrollTop / Math.max(feed.clientHeight, 1));
      if (nextIndex >= 0 && nextIndex < visibleItems.length && nextIndex !== activeIndex) {
        setActiveIndex(nextIndex);
        setPlaying(true);
        setVolumePanelItemId(null);
      }
    });
  }

  function handleDesktopWheel(event: WheelEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (!activeItem || visibleItems.length < 2 || shouldIgnoreDesktopNavigationTarget(target)) {
      return;
    }
    const horizontalDelta = normalizedHorizontalWheelDelta(event);
    if (Math.abs(horizontalDelta) < 4) {
      return;
    }
    event.preventDefault();
    queueDesktopWheelSwipe(horizontalDelta);
  }

  function handleFeedItemWheel(event: WheelEvent<HTMLElement>, item?: PublicFeedItem) {
    const target = event.target as HTMLElement;
    if (
      !item ||
      shouldIgnoreSeekWheelTarget(target)
    ) {
      return;
    }
    const horizontalDelta = normalizedHorizontalWheelDelta(event);
    if (Math.abs(horizontalDelta) < 4) {
      return;
    }
    const video = videoRefs.current[item.id];
    const duration = video?.duration || videoProgress[item.id]?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const currentTime = video?.currentTime ?? videoProgress[item.id]?.currentTime ?? 0;
    const seekOffset = clampNumber(horizontalDelta / WHEEL_SEEK_PIXELS_PER_SECOND, -MAX_WHEEL_SEEK_SECONDS, MAX_WHEEL_SEEK_SECONDS);
    if (Math.abs(seekOffset) < 0.04) {
      return;
    }
    event.preventDefault();
    setVolumePanelItemId(null);
    seekVideo(item, currentTime + seekOffset);
  }

  function handleDesktopPointerDown(event: PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (
      viewMode !== "desktop" ||
      target.closest("a, button, input, textarea, select, .feed-video-frame, .feed-minimal-ui, .feed-comment-drawer, .feed-assistant-popdown") ||
      (event.pointerType === "mouse" && event.button !== 0)
    ) {
      return;
    }
    desktopDrag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDesktopPointerUp(event: PointerEvent<HTMLElement>) {
    const drag = desktopDrag.current;
    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }
    desktopDrag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    if (Math.abs(deltaX) > 64 && Math.abs(deltaX) > Math.abs(deltaY) * 1.2) {
      selectItem(activeIndex + (deltaX < 0 ? 1 : -1));
    }
  }

  function handleDesktopPointerCancel(event: PointerEvent<HTMLElement>) {
    if (desktopDrag.current?.pointerId === event.pointerId) {
      desktopDrag.current = null;
    }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function queueDesktopWheelSwipe(deltaX: number) {
    const now = Date.now();
    if (now < desktopWheelSwipeLockUntil.current) {
      return;
    }
    if (desktopWheelSwipeResetTimer.current !== null) {
      window.clearTimeout(desktopWheelSwipeResetTimer.current);
    }
    const currentDelta = desktopWheelSwipeDelta.current;
    desktopWheelSwipeDelta.current = Math.sign(currentDelta) === Math.sign(deltaX)
      ? currentDelta + deltaX
      : deltaX;
    desktopWheelSwipeResetTimer.current = window.setTimeout(() => {
      desktopWheelSwipeDelta.current = 0;
      desktopWheelSwipeResetTimer.current = null;
    }, 180);
    if (Math.abs(desktopWheelSwipeDelta.current) < DESKTOP_SWIPE_NAV_THRESHOLD) {
      return;
    }
    const direction = desktopWheelSwipeDelta.current > 0 ? 1 : -1;
    desktopWheelSwipeDelta.current = 0;
    desktopWheelSwipeLockUntil.current = now + DESKTOP_SWIPE_NAV_LOCK_MS;
    setVolumePanelItemId(null);
    selectItem(activeIndex + direction);
  }

  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent) {
      if (
        viewMode !== "desktop" ||
        visibleItems.length < 2 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        shouldIgnoreNavigationKeyTarget(event.target)
      ) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        setVolumePanelItemId(null);
        selectItem(activeIndex - 1);
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        setVolumePanelItemId(null);
        selectItem(activeIndex + 1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, viewMode, visibleItems]);

  function changeVolume(nextValue: number) {
    const normalized = persistFeedVideoVolume(nextValue);
    setVolume(normalized);
    setMuted(normalized === 0);
  }

  function unmuteWithUsableVolume() {
    if (volume > 0) {
      setMuted(false);
      return;
    }
    const normalized = persistFeedVideoVolume(DEFAULT_FEED_VIDEO_VOLUME);
    setVolume(normalized);
    setMuted(false);
  }

  function toggleMuted() {
    setVolumePanelItemId(null);
    if (muted || volume <= 0) {
      unmuteWithUsableVolume();
      return;
    }
    setMuted(true);
  }

  function toggleControlVolume(item: PublicFeedItem) {
    setControlsVisible(true);
    if (controlsHideTimer.current !== null) {
      window.clearTimeout(controlsHideTimer.current);
      controlsHideTimer.current = null;
    }
    setVolumePanelItemId((current) => current === item.id ? null : item.id);
    if (muted || volume <= 0) {
      unmuteWithUsableVolume();
      return;
    }
    setMuted(true);
  }

  function openFullscreen(item: PublicFeedItem) {
    const video = videoRefs.current[item.id];
    if (!video) {
      return;
    }
    requestVideoFullscreen(video);
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
    if (volumePanelItemId) {
      controlsHideTimer.current = null;
      return;
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

  function toggleAssistant() {
    setControlsVisible(true);
    if (controlsHideTimer.current !== null) {
      window.clearTimeout(controlsHideTimer.current);
      controlsHideTimer.current = null;
    }
    setAssistantOpen((current) => !current);
  }

  const feedClass = `feed-shell ${viewMode === "mobile" ? "is-mobile" : "is-desktop"} ${controlsVisible || assistantOpen ? "controls-visible" : ""}`;

  return (
    <main className={feedClass} onPointerDown={revealControls} onPointerMove={revealControls}>
      <header className="feed-topbar">
        <div className="feed-topbar-left">
          <BreadcrumbNav />
          <div className="feed-brand-title">
            <img alt="" aria-hidden="true" height={28} src={storefrontLogoUrl || "/favicon.svg"} width={28} />
            <h1>{storefrontName ? `${storefrontName} feed` : "Video feed"}</h1>
          </div>
        </div>
        <div className="feed-toolbar">
          {storefrontHref && (
            <a className="icon-toggle" href={storefrontHref} title="Open storefront">
              <Store size={18} />
            </a>
          )}
          {mosaicHref && (
            <a className="icon-toggle" href={mosaicHref} title="Open mosaic">
              <LayoutGrid size={18} />
            </a>
          )}
          <LanguageSelector className="is-feed" />
          <button className={`icon-toggle ${viewMode === "mobile" ? "active" : ""}`} onClick={() => setViewMode("mobile")} title="Mobile feed">
            <Smartphone size={18} />
          </button>
          <button className={`icon-toggle ${viewMode === "desktop" ? "active" : ""}`} onClick={() => setViewMode("desktop")} title="Desktop feed">
            <Monitor size={18} />
          </button>
          <button className="icon-toggle" onClick={toggleMuted} title={muted ? "Unmute" : "Mute"}>
            {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <button className="icon-toggle" onClick={() => setPlaying((value) => !value)} title={playing ? "Pause" : "Play"}>
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="icon-toggle" onClick={() => loadFeed().catch((error) => setMessage(error.message))} title="Refresh feed">
            <RefreshCw size={18} />
          </button>
          <div className="feed-assistant-menu">
            <button className={`icon-toggle feed-assistant-toggle ${assistantOpen ? "active" : ""}`} onClick={toggleAssistant} title="Open video assistant">
              <MessageCircle size={18} />
              <span>Assistant</span>
            </button>
            {assistantOpen && (
              <FeedAssistantPopdown
                activeItem={activeItem}
                itemCount={visibleItems.length}
                onClose={() => setAssistantOpen(false)}
                viewMode={viewMode}
              />
            )}
          </div>
        </div>
      </header>

      <section className="feed-controls" aria-label="Feed filters">
        <label className="feed-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search videos or creators" />
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
        <section className="mobile-video-feed" onScroll={handleMobileScroll} ref={mobileFeedRef}>
          {visibleItems.map((item, index) => (
            <article
              className={`mobile-feed-card ${index === activeIndex ? "active" : ""}`}
              data-feed-id={item.id}
              key={item.id}
              onWheel={(event) => handleFeedItemWheel(event, item)}
              ref={(node) => {
                mobileCardRefs.current[item.id] = node;
              }}
            >
              <FeedVideo
                item={item}
                active={index === activeIndex}
                muted={muted}
                playing={playing}
                preloadAhead={item.id === nextPreloadItem?.id}
                videoRefs={videoRefs}
                onEnded={() => selectItem(index + 1)}
                onProgress={handleVideoProgress}
                onPlayStateChange={setPlaying}
                onReadyToPreloadNext={() => preloadFeedVideo(index + 1)}
              />
              <MobileOverlay
                item={item}
                muted={muted}
                playing={playing}
                progress={videoProgress[item.id]}
                volume={volume}
                volumeOpen={volumePanelItemId === item.id}
                controlsVisible={controlsVisible && index === activeIndex}
                onSeek={(time) => seekVideo(item, time)}
                onTogglePlay={() => setPlaying((value) => !value)}
                onToggleVolumePanel={() => toggleControlVolume(item)}
                onVolume={changeVolume}
                onFullscreen={() => openFullscreen(item)}
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
          <div
            className="desktop-player-stage"
            onPointerCancel={handleDesktopPointerCancel}
            onPointerDown={handleDesktopPointerDown}
            onPointerUp={handleDesktopPointerUp}
            onWheel={handleDesktopWheel}
          >
            {visibleItems.map((item, index) => (
              <article
                className={`desktop-feed-card ${index === activeIndex ? "active" : ""}`}
                key={item.id}
              >
                <FeedVideo
                  item={item}
                  active={index === activeIndex}
                  muted={muted}
                  playing={playing}
                  preloadAhead={item.id === nextPreloadItem?.id}
                  videoRefs={videoRefs}
                  onEnded={() => selectItem(index + 1)}
                  onProgress={handleVideoProgress}
                  onPlayStateChange={setPlaying}
                  onReadyToPreloadNext={() => preloadFeedVideo(index + 1)}
                />
              </article>
            ))}
            <DesktopStepNavigation
              itemCount={visibleItems.length}
              onNext={() => selectItem(activeIndex + 1)}
              onPrevious={() => selectItem(activeIndex - 1)}
            />
            <DesktopMinimalControls
              item={activeItem}
              muted={muted}
              playing={playing}
              progress={activeItem ? videoProgress[activeItem.id] : undefined}
              volume={volume}
              volumeOpen={Boolean(activeItem && volumePanelItemId === activeItem.id)}
              onSeek={(time) => activeItem && seekVideo(activeItem, time)}
              onTogglePlay={() => setPlaying((value) => !value)}
              onToggleVolumePanel={() => activeItem && toggleControlVolume(activeItem)}
              onVolume={changeVolume}
              onFullscreen={() => activeItem && openFullscreen(activeItem)}
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

function FeedAssistantPopdown({
  activeItem,
  itemCount,
  onClose,
  viewMode
}: {
  activeItem?: PublicFeedItem;
  itemCount: number;
  onClose: () => void;
  viewMode: FeedViewMode;
}) {
  const [thread, setThread] = useState<FeedAssistantThread | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState<"load" | "send" | "">("load");
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const assistantUserIdRef = useRef("");
  const messages = thread?.messages || [];

  useEffect(() => {
    assistantUserIdRef.current = getOrCreateAssistantUserId();
    const controller = new AbortController();
    setBusy("load");
    setError("");
    fetch("/api/assistant/page?pagePath=%2Ffeed", {
      cache: "no-store",
      headers: assistantHeaders(assistantUserIdRef.current),
      signal: controller.signal
    })
      .then(parseResponse<{ thread: FeedAssistantThread }>)
      .then((data) => setThread(data.thread))
      .catch((loadError) => {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load video assistant.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setBusy("");
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [messages.length, busy]);

  async function submitMessage(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const message = input.trim();
    if (!message || busy === "send") {
      return;
    }

    const timestamp = new Date().toISOString();
    const optimisticMessage: FeedAssistantMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: message,
      createdAt: timestamp
    };
    setInput("");
    setBusy("send");
    setError("");
    setThread((current) => current
      ? { ...current, messages: [...current.messages, optimisticMessage], updatedAt: timestamp }
      : {
        id: "pending",
        pagePath: "/feed",
        pageTitle: "Video Feed",
        messages: [optimisticMessage],
        updatedAt: timestamp
      });

    try {
      const data = await fetch("/api/assistant/page", {
        method: "POST",
        headers: assistantHeaders(assistantUserIdRef.current, { "content-type": "application/json" }),
        body: JSON.stringify({
          pagePath: "/feed",
          message,
          userId: assistantUserIdRef.current,
          context: feedAssistantContext({ activeItem, itemCount, viewMode })
        })
      }).then(parseResponse<{ thread: FeedAssistantThread }>);
      setThread(data.thread);
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Assistant request failed.");
      setThread((current) => current
        ? { ...current, messages: current.messages.filter((item) => item.id !== optimisticMessage.id) }
        : current);
    } finally {
      setBusy("");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitMessage().catch(() => undefined);
    }
  }

  return (
    <section className="feed-assistant-popdown" aria-label="Video assistant" onPointerDown={(event) => event.stopPropagation()}>
      <header className="feed-assistant-header">
        <div className="feed-assistant-title">
          <span><Bot size={17} /></span>
          <div>
            <strong>Video Assistant</strong>
            <small>{viewMode} · newest</small>
          </div>
        </div>
        <button className="feed-assistant-close" onClick={onClose} title="Close assistant" type="button">
          <X size={16} />
        </button>
      </header>

      <div className="feed-assistant-body">
        {error && <div className="feed-assistant-notice">{error}</div>}
        {messages.length > 0 ? (
          <div className="feed-assistant-messages">
            {messages.map((message) => (
              <article className={`feed-assistant-message ${message.role}`} key={message.id}>
                <div className="feed-assistant-message-meta">
                  <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
                  <span>{formatAssistantTime(message.createdAt)}</span>
                </div>
                <div className="feed-assistant-message-text">{message.content}</div>
              </article>
            ))}
            {busy === "send" && <div className="feed-assistant-typing"><span /><span /><span /></div>}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="feed-assistant-empty">
            {busy === "load" ? <RefreshCw size={22} className="spin" /> : <MessageCircle size={24} />}
          </div>
        )}
      </div>

      <form className="feed-assistant-form" onSubmit={submitMessage}>
        <textarea
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about this video or feed controls..."
          rows={2}
          value={input}
        />
        <button className="feed-assistant-send" disabled={!input.trim() || busy === "send"} type="submit">
          {busy === "send" ? <RefreshCw size={16} className="spin" /> : <Send size={16} />}
        </button>
      </form>
    </section>
  );
}

function FeedVideo({
  item,
  active,
  muted,
  playing,
  preloadAhead,
  videoRefs,
  onEnded,
  onProgress,
  onPlayStateChange,
  onReadyToPreloadNext
}: {
  item: PublicFeedItem;
  active: boolean;
  muted: boolean;
  playing: boolean;
  preloadAhead: boolean;
  videoRefs: RefObject<Record<string, HTMLVideoElement | null>>;
  onEnded: () => void;
  onProgress: (id: string, video: HTMLVideoElement) => void;
  onPlayStateChange: (nextPlaying: boolean) => void;
  onReadyToPreloadNext: () => void;
}) {
  const ratio = feedAspectRatioStyle(item);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [frameReady, setFrameReady] = useState(false);
  const [posterVisible, setPosterVisible] = useState(Boolean(item.posterUrl));
  const posterUrl = frameReady ? item.posterUrl : undefined;

  useEffect(() => {
    setPosterVisible(Boolean(item.posterUrl));
  }, [item.id, item.posterUrl, item.videoUrl]);

  useEffect(() => {
    setFrameReady(false);
    const node = frameRef.current;
    if (!node) {
      return;
    }
    const measuredNode = node;

    let frame = 0;
    function measureFrame() {
      frame = 0;
      const rect = measuredNode.getBoundingClientRect();
      setFrameReady(rect.width > 0 && rect.height > 0);
    }

    frame = window.requestAnimationFrame(measureFrame);
    const observer = new ResizeObserver(measureFrame);
    observer.observe(measuredNode);
    return () => {
      observer.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [item.id, item.aspectRatio]);

  function revealVideoFrame() {
    setPosterVisible(false);
  }

  function handleVideoLoaded(video: HTMLVideoElement) {
    onProgress(item.id, video);
    if (active) {
      onReadyToPreloadNext();
    }
  }

  function handleVideoPointerDown(event: PointerEvent<HTMLVideoElement>) {
    pointerStart.current = { x: event.clientX, y: event.clientY };
  }

  function handleVideoClick(event: MouseEvent<HTMLVideoElement>) {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!active) {
      return;
    }
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) {
      return;
    }
    event.stopPropagation();
    const video = event.currentTarget;
    const nextPlaying = video.paused || video.ended;
    if (nextPlaying) {
      if (video.ended) {
        video.currentTime = 0;
      }
      onPlayStateChange(true);
      video.play().catch(() => onPlayStateChange(false));
      return;
    }
    video.pause();
    onPlayStateChange(false);
  }

  return (
    <div
      className={`feed-video-frame ${item.aspectRatio === "9:16" ? "portrait" : "landscape"}`}
      ref={frameRef}
      style={ratio}
    >
      {posterUrl && (
        <img
          alt=""
          className={`feed-video-poster ${posterVisible ? "" : "hidden"}`}
          src={posterUrl}
        />
      )}
      <video
        className={`feed-video ${item.aspectRatio === "9:16" ? "portrait" : "landscape"}`}
        height={item.aspectRatio === "9:16" ? 16 : 9}
        ref={(node) => {
          videoRefs.current[item.id] = node;
        }}
        src={item.videoUrl}
        poster={posterUrl}
        muted={muted}
        loop={false}
        playsInline
        preload={active || preloadAhead ? "auto" : "metadata"}
        autoPlay={active && playing}
        width={item.aspectRatio === "9:16" ? 9 : 16}
        onCanPlay={(event) => handleVideoLoaded(event.currentTarget)}
        onClick={handleVideoClick}
        onDurationChange={(event) => onProgress(item.id, event.currentTarget)}
        onEnded={onEnded}
        onLoadedData={(event) => handleVideoLoaded(event.currentTarget)}
        onLoadedMetadata={(event) => onProgress(item.id, event.currentTarget)}
        onPointerDown={handleVideoPointerDown}
        onPlaying={revealVideoFrame}
        onSeeked={(event) => onProgress(item.id, event.currentTarget)}
        onTimeUpdate={(event) => onProgress(item.id, event.currentTarget)}
      />
    </div>
  );
}

function MobileOverlay({
  item,
  muted,
  playing,
  progress,
  volume,
  volumeOpen,
  controlsVisible,
  onSeek,
  onTogglePlay,
  onToggleVolumePanel,
  onVolume,
  onFullscreen,
  onComments,
  onLike
}: {
  item: PublicFeedItem;
  muted: boolean;
  playing: boolean;
  progress?: VideoProgress;
  volume: number;
  volumeOpen: boolean;
  controlsVisible: boolean;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onToggleVolumePanel: () => void;
  onVolume: (value: number) => void;
  onFullscreen: () => void;
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
        <VolumeControl
          muted={muted}
          open={volumeOpen}
          onToggle={onToggleVolumePanel}
          onVolume={onVolume}
          value={volume}
          variant="mobile"
        />
        <button className="round-action" onClick={onFullscreen} title="Full screen">
          <Maximize2 size={20} />
        </button>
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
      <VideoScrubber item={item} progress={progress} onSeek={onSeek} />
    </div>
  );
}

function DesktopStepNavigation({
  itemCount,
  onPrevious,
  onNext
}: {
  itemCount: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  if (itemCount < 2) {
    return null;
  }
  return (
    <div className="desktop-step-nav" aria-label="Video navigation">
      <button className="desktop-nav-button previous" onClick={onPrevious} title="Previous video" type="button">
        <ChevronLeft size={30} />
      </button>
      <button className="desktop-nav-button next" onClick={onNext} title="Next video" type="button">
        <ChevronRight size={30} />
      </button>
    </div>
  );
}

function DesktopMinimalControls({
  item,
  muted,
  playing,
  progress,
  volume,
  volumeOpen,
  onSeek,
  onTogglePlay,
  onToggleVolumePanel,
  onVolume,
  onFullscreen,
  onComments,
  onLike
}: {
  item: PublicFeedItem;
  muted: boolean;
  playing: boolean;
  progress?: VideoProgress;
  volume: number;
  volumeOpen: boolean;
  onSeek: (time: number) => void;
  onTogglePlay: () => void;
  onToggleVolumePanel: () => void;
  onVolume: (value: number) => void;
  onFullscreen: () => void;
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
        <VolumeControl
          muted={muted}
          open={volumeOpen}
          onToggle={onToggleVolumePanel}
          onVolume={onVolume}
          value={volume}
          variant="desktop"
        />
        <button className="glass-icon" onClick={onFullscreen} title="Full screen">
          <Maximize2 size={18} />
        </button>
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
      <VideoScrubber item={item} progress={progress} onSeek={onSeek} />
    </div>
  );
}

function VolumeControl({
  muted,
  open,
  onToggle,
  onVolume,
  value,
  variant
}: {
  muted: boolean;
  open: boolean;
  onToggle: () => void;
  onVolume: (value: number) => void;
  value: number;
  variant: "mobile" | "desktop";
}) {
  const iconSize = variant === "mobile" ? 20 : 18;
  const displayValue = muted ? 0 : Math.round(value * 100);
  const buttonClass = variant === "mobile" ? "round-action" : "glass-icon";
  const sliderStyle = { "--feed-volume-progress": `${displayValue}%` } as CSSProperties;

  return (
    <div className={`feed-volume-control ${variant} ${open ? "open" : ""}`} onPointerDown={(event) => event.stopPropagation()}>
      <button
        aria-expanded={open}
        aria-label="Volume"
        className={buttonClass}
        onClick={onToggle}
        title="Volume"
        type="button"
      >
        {muted || value === 0 ? <VolumeX size={iconSize} /> : <Volume2 size={iconSize} />}
      </button>
      {open && (
        <label className="feed-volume-popover" title="Volume">
          <input
            aria-label="Volume"
            aria-orientation="vertical"
            className="feed-volume-slider"
            max="100"
            min="0"
            onChange={(event) => onVolume(Number(event.target.value) / 100)}
            style={sliderStyle}
            type="range"
            value={displayValue}
          />
        </label>
      )}
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

function VideoScrubber({
  item,
  progress,
  onSeek
}: {
  item: PublicFeedItem;
  progress?: VideoProgress;
  onSeek: (time: number) => void;
}) {
  const duration = progress?.duration || 0;
  const currentTime = duration > 0 ? Math.min(progress?.currentTime || 0, duration) : 0;
  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const scrubberStyle = { "--scrubber-progress": `${percent}%` } as CSSProperties;
  const timeLabel = `${formatVideoTime(currentTime)} / ${formatVideoTime(duration)}`;

  return (
    <div
      className="video-scrubber"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <input
        aria-label={`Seek ${item.title}`}
        disabled={duration <= 0}
        max={duration || 0}
        min="0"
        onChange={(event) => onSeek(Number(event.target.value))}
        step="0.05"
        style={scrubberStyle}
        type="range"
        value={currentTime}
      />
      <span className="video-time" title="Elapsed / total duration">{timeLabel}</span>
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

function getOrCreateAssistantUserId() {
  try {
    const existing = window.localStorage.getItem(ASSISTANT_USER_STORAGE_KEY);
    if (existing) {
      return existing;
    }
    const generated = window.crypto?.randomUUID?.() || `assistant-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.localStorage.setItem(ASSISTANT_USER_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `assistant-${Date.now()}`;
  }
}

function assistantHeaders(userId: string, init?: HeadersInit) {
  const headers = samsarAuthHeaders(init);
  if (userId) {
    headers.set("x-superreferrals-assistant-user", userId);
  }
  return headers;
}

function feedAssistantContext({
  activeItem,
  itemCount,
  viewMode
}: {
  activeItem?: PublicFeedItem;
  itemCount: number;
  viewMode: FeedViewMode;
}) {
  return [
    `Current feed mode: ${viewMode}`,
    "Current sort option: newest",
    `Visible video count: ${itemCount}`,
    activeItem
      ? [
        `Active video title: ${activeItem.title}`,
        `Active video creator: ${activeItem.authorName}`,
        `Active video model: ${activeItem.videoModel}`,
        `Active video aspect ratio: ${activeItem.aspectRatio}`,
        `Active video likes/comments/views: ${activeItem.metrics.likes}/${activeItem.metrics.comments}/${activeItem.metrics.views}`,
        `Active video tags: ${activeItem.tags.join(", ") || "none"}`
      ].join("\n")
      : "No active video is currently selected."
  ].join("\n");
}

function formatAssistantTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return "";
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit"
  }).format(timestamp);
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

function formatVideoTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0:00";
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function shouldIgnoreSeekWheelTarget(target: HTMLElement) {
  return Boolean(target.closest(
    "a, button, input, textarea, select, .feed-minimal-ui, .mobile-action-rail, .feed-comment-drawer, .feed-assistant-popdown, .feed-volume-popover"
  ));
}

function shouldIgnoreDesktopNavigationTarget(target: HTMLElement) {
  return Boolean(target.closest(
    "a, button, input, textarea, select, .feed-minimal-ui, .feed-comment-drawer, .feed-assistant-popdown, .feed-volume-popover"
  ));
}

function shouldIgnoreNavigationKeyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return Boolean(
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true'], .feed-comment-drawer, .feed-assistant-popdown")
  );
}

function normalizedHorizontalWheelDelta(event: WheelEvent<HTMLElement>) {
  const rawDelta = event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)
    ? event.deltaY
    : event.deltaX;
  if (!event.shiftKey && Math.abs(rawDelta) <= Math.abs(event.deltaY)) {
    return 0;
  }
  const deltaModeMultiplier = event.deltaMode === 1
    ? 16
    : event.deltaMode === 2
      ? 280
      : 1;
  return rawDelta * deltaModeMultiplier;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function requestVideoFullscreen(video: HTMLVideoElement) {
  const target = (video.closest(".feed-video-frame") as HTMLElement | null) || video;
  if (target.requestFullscreen) {
    target.requestFullscreen().catch(() => undefined);
    return;
  }
  const fullscreenVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
  fullscreenVideo.webkitEnterFullscreen?.();
}

function feedAspectRatioStyle(item: PublicFeedItem) {
  return {
    "--feed-video-ratio": item.aspectRatio === "9:16" ? "9 / 16" : "16 / 9",
    "--feed-video-ratio-value": item.aspectRatio === "9:16" ? "0.5625" : "1.7777777778"
  } as CSSProperties;
}

function isVisibleInFeedMode(item: PublicFeedItem, viewMode: FeedViewMode) {
  return viewMode === "mobile"
    ? item.aspectRatio === "9:16"
    : item.aspectRatio !== "9:16";
}

function feedModeForItem(item: PublicFeedItem): FeedViewMode {
  return item.aspectRatio === "9:16" ? "mobile" : "desktop";
}

function matchesInitialFeedItem(item: PublicFeedItem, generationId: string) {
  return item.id === generationId || item.generationId === generationId || item.inftId === generationId;
}
