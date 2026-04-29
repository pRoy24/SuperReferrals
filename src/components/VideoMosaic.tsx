"use client";

import { ArrowRight, Check, Copy, ExternalLink, Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_FEED_VIDEO_VOLUME, persistFeedVideoVolume, readFeedVideoVolume, subscribeFeedVideoVolume } from "@/lib/feed-video-preferences";
import type { PublicFeedItem } from "@/lib/types";

type MosaicAspectRatio = "16:9" | "9:16";

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
  const [videoReadyById, setVideoReadyById] = useState<Record<string, boolean>>({});
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
  }, [aspectReadyItems]);

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

  function toggleMuted() {
    const nextMuted = !muted;
    setMuted(nextMuted);
    for (const video of Object.values(videoRefs.current)) {
      if (video) {
        video.muted = nextMuted || volume === 0;
      }
    }
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
      >
        {displayedItems.map((item) => {
          const aspectRatio = normalizeMosaicAspectRatio(item.aspectRatio) as MosaicAspectRatio;
          const isPortrait = aspectRatio === "9:16";
          const isActive = activeId === item.id;
          const creatorWallet = showCreatorWallet ? getCreatorWallet?.(item) : "";
          const shouldShowFeedLink = typeof showFeedLink === "function" ? showFeedLink(item) : showFeedLink;
          const shouldShowInftLink = showInftLink && Boolean(item.inftId);
          const posterUrl = item.posterUrl;
          const tileStyle = {
            "--tile-ratio": isPortrait ? "9 / 16" : "16 / 9"
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
                  onLoadedData={() => markVideoReady(item)}
                  onPlay={() => setActiveId(item.id)}
                  onPlaying={() => markVideoReady(item)}
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
                  <button className="video-mosaic-icon" onClick={toggleMuted} title={muted || volume === 0 ? "Unmute" : "Mute"} type="button">
                    {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <button className="video-mosaic-icon" onClick={() => openFullscreen(item)} title="Full screen" type="button">
                    <Maximize2 size={16} />
                  </button>
                  <label className="video-mosaic-volume" title="Volume">
                    <input
                      aria-label={`Volume for ${item.title}`}
                      max="100"
                      min="0"
                      onChange={(event) => changeVolume(item, Number(event.target.value) / 100)}
                      type="range"
                      value={muted || volume === 0 ? 0 : Math.round(volume * 100)}
                    />
                  </label>
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

function shortWallet(value = "") {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed || "wallet";
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
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
