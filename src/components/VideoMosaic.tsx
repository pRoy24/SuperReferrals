"use client";

import { ArrowRight, Check, Copy, ExternalLink, Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_FEED_VIDEO_VOLUME, persistFeedVideoVolume, readFeedVideoVolume, subscribeFeedVideoVolume } from "@/lib/feed-video-preferences";
import type { PublicFeedItem } from "@/lib/types";

type MosaicAspectRatio = "16:9" | "9:16";
type MosaicLayout = {
  columns: number;
  gap: number;
  rowHeight: number;
  width: number;
};

type VideoMosaicProgress = {
  currentTime: number;
  duration: number;
};

const MOSAIC_COLUMNS = 12;
const MOSAIC_GAP_PX = 12;
const MOSAIC_ROW_HEIGHT_PX = 4;

type VideoMosaicProps = {
  items: PublicFeedItem[];
  actions?: (item: PublicFeedItem) => ReactNode;
  className?: string;
  emptyText?: string;
  getCreatorWallet?: (item: PublicFeedItem) => string | undefined;
  limit?: number;
  maxRows?: 2 | 3;
  moreHref?: string;
  moreLabel?: string;
  showCreatorWallet?: boolean;
  showFeedLink?: boolean | ((item: PublicFeedItem) => boolean);
  showInftLink?: boolean;
};

export default function VideoMosaic({
  actions,
  items,
  className = "",
  emptyText = "No published videos yet.",
  getCreatorWallet,
  limit,
  maxRows,
  moreHref = "/feed",
  moreLabel = "More videos",
  showCreatorWallet = false,
  showFeedLink = true,
  showInftLink = true
}: VideoMosaicProps) {
  const visibleItems = useMemo(
    () => typeof limit === "number" ? items.slice(0, limit) : items,
    [items, limit]
  );
  const aspectReadyItems = useMemo(
    () => visibleItems.filter((item) => Boolean(normalizeMosaicAspectRatio(item.aspectRatio))),
    [visibleItems]
  );
  const [activeId, setActiveId] = useState("");
  const [copiedWalletId, setCopiedWalletId] = useState("");
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_FEED_VIDEO_VOLUME);
  const [volumePanelItemId, setVolumePanelItemId] = useState("");
  const [videoProgressById, setVideoProgressById] = useState<Record<string, VideoMosaicProgress>>({});
  const [videoReadyById, setVideoReadyById] = useState<Record<string, boolean>>({});
  const [mosaicLayout, setMosaicLayout] = useState<MosaicLayout>({
    columns: 1,
    gap: MOSAIC_GAP_PX,
    rowHeight: MOSAIC_ROW_HEIGHT_PX,
    width: 0
  });
  const mosaicGridRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});
  const displayedItems = aspectReadyItems;
  const hiddenCount = Math.max(0, items.length - displayedItems.length);

  useEffect(() => {
    const storedVolume = readFeedVideoVolume();
    setVolume(storedVolume);
    setMuted(storedVolume === 0);
    return subscribeFeedVideoVolume((nextVolume) => {
      setVolume(nextVolume);
      setMuted(nextVolume === 0);
    });
  }, []);

  useEffect(() => {
    for (const [id, video] of Object.entries(videoRefs.current)) {
      if (video && id !== activeId) {
        video.pause();
      }
    }
    setVolumePanelItemId((current) => current && current !== activeId ? "" : current);
  }, [activeId]);

  useEffect(() => {
    for (const video of Object.values(videoRefs.current)) {
      if (!video) {
        continue;
      }
      video.volume = volume;
      video.muted = muted || volume === 0;
    }
  }, [muted, volume]);

  useEffect(() => {
    const visibleIds = new Set(aspectReadyItems.map((item) => item.id));
    for (const [id, video] of Object.entries(videoRefs.current)) {
      if (!visibleIds.has(id) && video) {
        video.pause();
      }
    }
    if (activeId && !visibleIds.has(activeId)) {
      setActiveId("");
    }
  }, [activeId, aspectReadyItems]);

  useEffect(() => {
    const visibleIds = new Set(aspectReadyItems.map((item) => item.id));
    setVideoReadyById((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => visibleIds.has(id))
    ));
    setVideoProgressById((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => visibleIds.has(id))
    ));
  }, [aspectReadyItems]);

  useEffect(() => {
    const grid = mosaicGridRef.current;
    if (!grid) {
      return;
    }

    function syncColumnCount() {
      const width = grid?.clientWidth || 0;
      const columns = width <= 620 ? 1 : MOSAIC_COLUMNS;
      setMosaicLayout((current) =>
        current.width === width && current.columns === columns
          ? current
          : { ...current, columns, width }
      );
    }

    syncColumnCount();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", syncColumnCount);
      return () => window.removeEventListener("resize", syncColumnCount);
    }

    const resizeObserver = new ResizeObserver(syncColumnCount);
    resizeObserver.observe(grid);
    return () => resizeObserver.disconnect();
  }, []);

  function markVideoReady(item: PublicFeedItem) {
    setVideoReadyById((current) => current[item.id] ? current : { ...current, [item.id]: true });
  }

  async function togglePlayback(item: PublicFeedItem) {
    const video = videoRefs.current[item.id];
    if (!video) {
      return;
    }
    if (activeId === item.id && !video.paused) {
      video.pause();
      setActiveId("");
      return;
    }
    for (const [id, otherVideo] of Object.entries(videoRefs.current)) {
      if (id !== item.id && otherVideo) {
        otherVideo.pause();
      }
    }
    if (video.ended) {
      video.currentTime = 0;
    }
    video.muted = muted || volume === 0;
    video.volume = volume;
    setActiveId(item.id);
    await video.play().catch(() => setActiveId(""));
  }

  function toggleVolumePanel(item: PublicFeedItem) {
    if (volumePanelItemId !== item.id && muted && volume > 0) {
      setMuted(false);
    }
    setVolumePanelItemId((current) => current === item.id ? "" : item.id);
  }

  function changeVolume(item: PublicFeedItem, value: number) {
    const normalized = persistFeedVideoVolume(value);
    setVolume(normalized);
    setMuted(normalized === 0);
    const video = videoRefs.current[item.id];
    if (video) {
      video.volume = normalized;
      video.muted = normalized === 0;
    }
  }

  function updateVideoProgress(id: string, video: HTMLVideoElement) {
    const nextCurrentTime = Number.isFinite(video.currentTime) ? Math.max(0, video.currentTime) : 0;
    const nextDuration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    setVideoProgressById((current) => {
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
    const duration = video?.duration || videoProgressById[item.id]?.duration || 0;
    if (!Number.isFinite(duration) || duration <= 0) {
      return;
    }
    const normalizedTime = Math.max(0, Math.min(duration, nextTime));
    if (video) {
      video.currentTime = normalizedTime;
    }
    setVideoProgressById((current) => ({
      ...current,
      [item.id]: {
        currentTime: normalizedTime,
        duration
      }
    }));
  }

  function openFullscreen(item: PublicFeedItem) {
    const video = videoRefs.current[item.id];
    if (!video) {
      return;
    }
    requestVideoFullscreen(video);
  }

  async function copyWallet(item: PublicFeedItem, wallet: string) {
    await navigator.clipboard?.writeText(wallet).catch(() => undefined);
    setCopiedWalletId(item.id);
    window.setTimeout(() => {
      setCopiedWalletId((current) => current === item.id ? "" : current);
    }, 1200);
  }

  if (visibleItems.length === 0) {
    return <div className={`video-mosaic-empty ${className}`.trim()}>{emptyText}</div>;
  }

  if (aspectReadyItems.length === 0) {
    return <div className={`video-mosaic-empty ${className}`.trim()}>Preparing video layout...</div>;
  }

  return (
    <div className={`video-mosaic ${className}`.trim()}>
      <div
        className={`video-mosaic-grid ${maxRows ? `rows-${maxRows}` : ""}`.trim()}
        ref={mosaicGridRef}
        style={{
          "--mosaic-columns": String(mosaicLayout.columns),
          "--mosaic-gap": `${mosaicLayout.gap}px`,
          "--mosaic-row-height": `${mosaicLayout.rowHeight}px`
        } as CSSProperties}
      >
        {displayedItems.map((item) => {
          const aspectRatio = normalizeMosaicAspectRatio(item.aspectRatio) as MosaicAspectRatio;
          const isPortrait = aspectRatio === "9:16";
          const isActive = activeId === item.id;
          const creatorWallet = showCreatorWallet ? getCreatorWallet?.(item) : "";
          const shouldShowFeedLink = typeof showFeedLink === "function" ? showFeedLink(item) : showFeedLink;
          const shouldShowInftLink = showInftLink && Boolean(item.inftId);
          const posterUrl = item.posterUrl;
          const columnSpan = getMosaicColumnSpan(aspectRatio, mosaicLayout);
          const tileStyle = {
            "--tile-column-span": String(columnSpan),
            "--tile-ratio": isPortrait ? "9 / 16" : "16 / 9",
            "--tile-row-span": String(getMosaicRowSpan(aspectRatio, columnSpan, mosaicLayout))
          } as CSSProperties;

          return (
            <article
              className={`video-mosaic-card ${isPortrait ? "portrait" : "landscape"}`}
              key={item.id}
              style={tileStyle}
            >
              <div
                className="video-mosaic-media"
                onClick={() => togglePlayback(item)}
              >
                {posterUrl && (
                  <img
                    alt=""
                    className={`video-mosaic-poster ${videoReadyById[item.id] ? "hidden" : ""}`}
                    src={posterUrl}
                  />
                )}
                <video
                  ref={(node) => {
                    videoRefs.current[item.id] = node;
                  }}
                  src={item.videoUrl}
                  poster={posterUrl}
                  muted={muted || volume === 0}
                  playsInline
                  preload="metadata"
                  onEnded={() => setActiveId((current) => current === item.id ? "" : current)}
                  onDurationChange={(event) => updateVideoProgress(item.id, event.currentTarget)}
                  onLoadedMetadata={(event) => updateVideoProgress(item.id, event.currentTarget)}
                  onPlay={() => setActiveId(item.id)}
                  onPlaying={() => markVideoReady(item)}
                  onSeeked={(event) => updateVideoProgress(item.id, event.currentTarget)}
                  onTimeUpdate={(event) => updateVideoProgress(item.id, event.currentTarget)}
                />
                <button
                  className="video-mosaic-play"
                  onClick={(event) => {
                    event.stopPropagation();
                    togglePlayback(item);
                  }}
                  title={isActive ? "Pause video" : "Play video"}
                  type="button"
                >
                  {isActive ? <Pause size={22} /> : <Play size={22} />}
                </button>
              </div>
              <div className="video-mosaic-body">
                <div className="video-mosaic-meta">
                  <span>{item.customerName}</span>
                  <strong>{item.title}</strong>
                  <small>{item.videoModel} · {item.aspectRatio}</small>
                  {creatorWallet && (
                    <button className="video-mosaic-wallet" onClick={() => copyWallet(item, creatorWallet)} title="Copy creator wallet" type="button">
                      <span>{shortWallet(creatorWallet)}</span>
                      {copiedWalletId === item.id ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                  )}
                </div>
                <div className="video-mosaic-controls">
                  <button className="video-mosaic-icon" onClick={() => togglePlayback(item)} title={isActive ? "Pause" : "Play"} type="button">
                    {isActive ? <Pause size={16} /> : <Play size={16} />}
                  </button>
                  <VideoMosaicVolumeControl
                    muted={muted}
                    open={volumePanelItemId === item.id}
                    onToggle={() => toggleVolumePanel(item)}
                    onVolume={(value) => changeVolume(item, value)}
                    value={volume}
                  />
                  <button className="video-mosaic-icon" onClick={() => openFullscreen(item)} title="Full screen" type="button">
                    <Maximize2 size={16} />
                  </button>
                  <VideoMosaicScrubber
                    item={item}
                    progress={videoProgressById[item.id]}
                    onSeek={(time) => seekVideo(item, time)}
                  />
                  {actions && <div className="video-mosaic-actions">{actions(item)}</div>}
                  {(shouldShowInftLink || shouldShowFeedLink) && (
                    <div className="video-mosaic-link-row">
                      {shouldShowInftLink && (
                        <a className="video-mosaic-feed-link" href={`/inft/${item.inftId}`} title="Open INFT">
                          <ExternalLink size={16} /> INFT
                        </a>
                      )}
                      {shouldShowFeedLink && (
                        <a className="video-mosaic-feed-link" href={feedHrefForItem(item)} title="View in feed">
                          <ExternalLink size={16} /> Feed
                        </a>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {moreHref && items.length > 0 && (
        <div className="video-mosaic-footer">
          <a className="video-mosaic-more" href={moreHref}>
            {hiddenCount > 0 ? `${moreLabel} (${hiddenCount})` : moreLabel}
            <ArrowRight size={16} />
          </a>
        </div>
      )}
    </div>
  );
}

function VideoMosaicVolumeControl({
  muted,
  open,
  onToggle,
  onVolume,
  value
}: {
  muted: boolean;
  open: boolean;
  onToggle: () => void;
  onVolume: (value: number) => void;
  value: number;
}) {
  const displayValue = muted ? 0 : Math.round(value * 100);
  const sliderStyle = { "--mosaic-volume-progress": `${displayValue}%` } as CSSProperties;

  return (
    <div className={`video-mosaic-volume-control ${open ? "open" : ""}`}>
      <button
        aria-expanded={open}
        aria-label="Volume"
        className="video-mosaic-icon"
        onClick={onToggle}
        title="Volume"
        type="button"
      >
        {muted || value === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      {open && (
        <label className="video-mosaic-volume-popover" title="Volume">
          <input
            aria-label="Volume"
            aria-orientation="vertical"
            className="video-mosaic-volume-slider"
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

function VideoMosaicScrubber({
  item,
  progress,
  onSeek
}: {
  item: PublicFeedItem;
  progress?: VideoMosaicProgress;
  onSeek: (time: number) => void;
}) {
  const duration = progress?.duration || 0;
  const currentTime = duration > 0 ? Math.min(progress?.currentTime || 0, duration) : 0;
  const percent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const scrubberStyle = { "--mosaic-scrubber-progress": `${percent}%` } as CSSProperties;

  return (
    <div className="video-mosaic-scrubber" onClick={(event) => event.stopPropagation()}>
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
      <span>{formatVideoTime(currentTime)} / {formatVideoTime(duration)}</span>
    </div>
  );
}

function getMosaicColumnSpan(aspectRatio: MosaicAspectRatio, layout: MosaicLayout) {
  if (layout.columns <= 1) {
    return 1;
  }
  if (layout.width <= 980) {
    return aspectRatio === "9:16" ? 4 : 8;
  }
  return aspectRatio === "9:16" ? 3 : 6;
}

function getMosaicRowSpan(aspectRatio: MosaicAspectRatio, columnSpan: number, layout: MosaicLayout) {
  const columns = Math.max(1, layout.columns);
  const fallbackWidth = aspectRatio === "9:16" ? 180 : 320;
  const width = layout.width || fallbackWidth;
  const trackWidth = columns === 1
    ? width
    : (width - layout.gap * (columns - 1)) / columns;
  const tileWidth = columns === 1
    ? trackWidth
    : trackWidth * columnSpan + layout.gap * (columnSpan - 1);
  const tileHeight = aspectRatio === "9:16" ? tileWidth * (16 / 9) : tileWidth * (9 / 16);
  return Math.max(1, Math.ceil((tileHeight + layout.gap) / (layout.rowHeight + layout.gap)));
}

function shortWallet(value = "") {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed || "wallet";
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
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

function feedHrefForItem(item: PublicFeedItem) {
  const mode = normalizeMosaicAspectRatio(item.aspectRatio) === "9:16" ? "mobile" : "desktop";
  return `/feed/${encodeURIComponent(item.generationId || item.id)}/${mode}`;
}

function requestVideoFullscreen(video: HTMLVideoElement) {
  const target = (video.closest(".video-mosaic-media") as HTMLElement | null) || video;
  if (target.requestFullscreen) {
    target.requestFullscreen().catch(() => undefined);
    return;
  }
  const fullscreenVideo = video as HTMLVideoElement & { webkitEnterFullscreen?: () => void };
  fullscreenVideo.webkitEnterFullscreen?.();
}

function normalizeMosaicAspectRatio(value: unknown): MosaicAspectRatio | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "");
  if (normalized === "9:16" || normalized === "9/16" || normalized === "portrait") {
    return "9:16";
  }
  if (normalized === "16:9" || normalized === "16/9" || normalized === "landscape") {
    return "16:9";
  }

  const match = normalized.match(/^(\d+(?:\.\d+)?)[/:x](\d+(?:\.\d+)?)$/);
  if (!match) {
    return null;
  }
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }
  const ratio = width / height;
  if (Math.abs(ratio - 9 / 16) <= 0.03) {
    return "9:16";
  }
  if (Math.abs(ratio - 16 / 9) <= 0.03) {
    return "16:9";
  }
  return null;
}
