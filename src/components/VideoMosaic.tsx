"use client";

import { ArrowRight, Check, Copy, ExternalLink, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PublicFeedItem } from "@/lib/types";

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
  showInftLink = false
}: VideoMosaicProps) {
  const rowLimit = maxRows ? maxRows * 3 : undefined;
  const visibleLimit = [limit, rowLimit]
    .filter((value): value is number => typeof value === "number")
    .reduce<number | undefined>((smallest, value) => smallest === undefined ? value : Math.min(smallest, value), undefined);
  const visibleItems = useMemo(
    () => typeof visibleLimit === "number" ? items.slice(0, visibleLimit) : items,
    [items, visibleLimit]
  );
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  const [activeId, setActiveId] = useState("");
  const [copiedWalletId, setCopiedWalletId] = useState("");
  const [mutedById, setMutedById] = useState<Record<string, boolean>>({});
  const [volumeById, setVolumeById] = useState<Record<string, number>>({});
  const [videoReadyById, setVideoReadyById] = useState<Record<string, boolean>>({});
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

  useEffect(() => {
    for (const [id, video] of Object.entries(videoRefs.current)) {
      if (video && id !== activeId) {
        video.pause();
      }
    }
  }, [activeId]);

  useEffect(() => {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    for (const [id, video] of Object.entries(videoRefs.current)) {
      if (!visibleIds.has(id) && video) {
        video.pause();
      }
    }
    if (activeId && !visibleIds.has(activeId)) {
      setActiveId("");
    }
  }, [activeId, visibleItems]);

  useEffect(() => {
    const visibleIds = new Set(visibleItems.map((item) => item.id));
    setVideoReadyById((current) => Object.fromEntries(
      Object.entries(current).filter(([id]) => visibleIds.has(id))
    ));
  }, [visibleItems]);

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
    video.muted = mutedById[item.id] ?? true;
    video.volume = volumeById[item.id] ?? 0.66;
    setActiveId(item.id);
    await video.play().catch(() => setActiveId(""));
  }

  function toggleMuted(item: PublicFeedItem) {
    const nextMuted = !(mutedById[item.id] ?? true);
    setMutedById((current) => ({ ...current, [item.id]: nextMuted }));
    const video = videoRefs.current[item.id];
    if (video) {
      video.muted = nextMuted;
    }
  }

  function changeVolume(item: PublicFeedItem, value: number) {
    const normalized = Math.max(0, Math.min(1, value));
    setVolumeById((current) => ({ ...current, [item.id]: normalized }));
    setMutedById((current) => ({ ...current, [item.id]: normalized === 0 }));
    const video = videoRefs.current[item.id];
    if (video) {
      video.volume = normalized;
      video.muted = normalized === 0;
    }
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

  return (
    <div className={`video-mosaic ${className}`.trim()}>
      <div className={`video-mosaic-grid ${maxRows ? `rows-${maxRows}` : ""}`.trim()}>
        {visibleItems.map((item, index) => {
          const isActive = activeId === item.id;
          const muted = mutedById[item.id] ?? true;
          const volume = volumeById[item.id] ?? 0.66;
          const creatorWallet = showCreatorWallet ? getCreatorWallet?.(item) : "";
          const shouldShowFeedLink = typeof showFeedLink === "function" ? showFeedLink(item) : showFeedLink;
          const tileStyle = {
            "--tile-ratio": item.aspectRatio === "9:16" ? "9 / 16" : "16 / 9"
          } as CSSProperties;

          return (
            <article
              className={`video-mosaic-card ${item.aspectRatio === "9:16" ? "portrait" : "landscape"}`}
              key={item.id}
              style={tileStyle}
            >
              <div className="video-mosaic-media">
                {item.posterUrl && (
                  <img
                    alt=""
                    className={`video-mosaic-poster ${videoReadyById[item.id] ? "hidden" : ""}`}
                    src={item.posterUrl}
                  />
                )}
                <video
                  height={item.aspectRatio === "9:16" ? 16 : 9}
                  ref={(node) => {
                    videoRefs.current[item.id] = node;
                  }}
                  src={item.videoUrl}
                  poster={item.posterUrl}
                  muted={muted}
                  playsInline
                  preload="metadata"
                  width={item.aspectRatio === "9:16" ? 9 : 16}
                  onEnded={() => setActiveId((current) => current === item.id ? "" : current)}
                  onLoadedData={() => markVideoReady(item)}
                  onPlay={() => setActiveId(item.id)}
                  onPlaying={() => markVideoReady(item)}
                />
                <button className="video-mosaic-play" onClick={() => togglePlayback(item)} title={isActive ? "Pause video" : "Play video"} type="button">
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
                  <button className="video-mosaic-icon" onClick={() => toggleMuted(item)} title={muted ? "Unmute" : "Mute"} type="button">
                    {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                  </button>
                  <label className="video-mosaic-volume" title="Volume">
                    <input
                      aria-label={`Volume for ${item.title}`}
                      max="100"
                      min="0"
                      onChange={(event) => changeVolume(item, Number(event.target.value) / 100)}
                      type="range"
                      value={muted ? 0 : Math.round(volume * 100)}
                    />
                  </label>
                  {showInftLink && item.inftId && (
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
                {actions && <div className="video-mosaic-actions">{actions(item)}</div>}
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
  const mode = item.aspectRatio === "9:16" ? "mobile" : "desktop";
  return `/feed/${encodeURIComponent(item.generationId || item.id)}/${mode}`;
}
