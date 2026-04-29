"use client";

import { ArrowRight, Check, Copy, ExternalLink, Maximize2, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_FEED_VIDEO_VOLUME, persistFeedVideoVolume, readFeedVideoVolume, subscribeFeedVideoVolume } from "@/lib/feed-video-preferences";
import type { PublicFeedItem } from "@/lib/types";

type MosaicTileLayout = {
  height: number;
  width: number;
  x: number;
  y: number;
};

type MosaicLayout = {
  columns: number;
  height: number;
  tiles: Record<string, MosaicTileLayout>;
};

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
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(DEFAULT_FEED_VIDEO_VOLUME);
  const [videoReadyById, setVideoReadyById] = useState<Record<string, boolean>>({});
  const [mosaicLayout, setMosaicLayout] = useState<MosaicLayout | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const videoRefs = useRef<Record<string, HTMLVideoElement | null>>({});

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

  useEffect(() => {
    const node = gridRef.current;
    if (!node || visibleItems.length === 0) {
      setMosaicLayout(null);
      return;
    }
    const gridNode = node;

    let frame = 0;

    function measureMosaic() {
      frame = 0;
      const nodeWidth = gridNode.clientWidth;
      if (nodeWidth <= 0) {
        return;
      }
      const styles = window.getComputedStyle(gridNode);
      const nextLayout = buildMosaicLayout(visibleItems, {
        containerWidth: nodeWidth,
        gap: cssNumber(styles.getPropertyValue("--mosaic-gap"), 12),
        landscapeSpan: cssInteger(styles.getPropertyValue("--mosaic-landscape-span"), 2),
        maxColumns: cssInteger(styles.getPropertyValue("--mosaic-max-columns"), 6),
        minColumnWidth: cssNumber(styles.getPropertyValue("--mosaic-min-column"), 170)
      });
      setMosaicLayout((current) => mosaicLayoutsEqual(current, nextLayout) ? current : nextLayout);
    }

    function scheduleMeasure() {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(measureMosaic);
    }

    measureMosaic();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(gridNode);
    return () => {
      observer.disconnect();
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
    };
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

  return (
    <div className={`video-mosaic ${className}`.trim()}>
      <div
        className={`video-mosaic-grid ${maxRows ? `rows-${maxRows}` : ""} ${mosaicLayout ? "is-laid-out" : ""}`.trim()}
        ref={gridRef}
        style={mosaicLayout ? { "--mosaic-height": `${mosaicLayout.height}px` } as CSSProperties : undefined}
      >
        {visibleItems.map((item) => {
          const isActive = activeId === item.id;
          const creatorWallet = showCreatorWallet ? getCreatorWallet?.(item) : "";
          const shouldShowFeedLink = typeof showFeedLink === "function" ? showFeedLink(item) : showFeedLink;
          const shouldShowInftLink = showInftLink && Boolean(item.inftId);
          const layout = mosaicLayout?.tiles[item.id];
          const tileStyle = {
            "--tile-height": layout ? `${layout.height}px` : undefined,
            "--tile-ratio": item.aspectRatio === "9:16" ? "9 / 16" : "16 / 9",
            "--tile-width": layout ? `${layout.width}px` : undefined,
            "--tile-x": layout ? `${layout.x}px` : undefined,
            "--tile-y": layout ? `${layout.y}px` : undefined
          } as CSSProperties;

          return (
            <article
              className={`video-mosaic-card ${item.aspectRatio === "9:16" ? "portrait" : "landscape"}`}
              key={item.id}
              style={tileStyle}
            >
              <div
                className="video-mosaic-media"
                onClick={() => togglePlayback(item)}
              >
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
                  muted={muted || volume === 0}
                  playsInline
                  preload="metadata"
                  width={item.aspectRatio === "9:16" ? 9 : 16}
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
  const mode = item.aspectRatio === "9:16" ? "mobile" : "desktop";
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

function buildMosaicLayout(
  items: PublicFeedItem[],
  options: {
    containerWidth: number;
    gap: number;
    landscapeSpan: number;
    maxColumns: number;
    minColumnWidth: number;
  }
): MosaicLayout {
  const gap = Math.max(0, options.gap);
  const minColumnWidth = Math.max(120, options.minColumnWidth);
  const maxColumns = Math.max(1, options.maxColumns);
  const rawColumns = Math.floor((options.containerWidth + gap) / (minColumnWidth + gap));
  const columns = Math.max(1, Math.min(maxColumns, rawColumns || 1));
  const columnWidth = (options.containerWidth - gap * (columns - 1)) / columns;
  const columnHeights = Array.from({ length: columns }, () => 0);
  const tiles: Record<string, MosaicTileLayout> = {};

  for (const item of items) {
    const preferredSpan = item.aspectRatio === "9:16" ? 1 : Math.max(1, options.landscapeSpan);
    const span = Math.min(columns, preferredSpan);
    let bestColumn = 0;
    let bestY = Number.POSITIVE_INFINITY;

    for (let column = 0; column <= columns - span; column += 1) {
      const candidateY = Math.max(...columnHeights.slice(column, column + span));
      if (candidateY < bestY) {
        bestY = candidateY;
        bestColumn = column;
      }
    }

    const width = columnWidth * span + gap * (span - 1);
    const ratio = item.aspectRatio === "9:16" ? 16 / 9 : 9 / 16;
    const height = width * ratio;
    const x = bestColumn * (columnWidth + gap);
    const y = bestY;
    const nextHeight = y + height + gap;

    for (let column = bestColumn; column < bestColumn + span; column += 1) {
      columnHeights[column] = nextHeight;
    }

    tiles[item.id] = {
      height: roundCssNumber(height),
      width: roundCssNumber(width),
      x: roundCssNumber(x),
      y: roundCssNumber(y)
    };
  }

  const height = Math.max(0, Math.max(...columnHeights) - gap);
  return {
    columns,
    height: roundCssNumber(height),
    tiles
  };
}

function cssNumber(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cssInteger(value: string, fallback: number) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundCssNumber(value: number) {
  return Math.round(value * 100) / 100;
}

function mosaicLayoutsEqual(left: MosaicLayout | null, right: MosaicLayout) {
  if (!left || left.columns !== right.columns || left.height !== right.height) {
    return false;
  }
  const leftIds = Object.keys(left.tiles);
  const rightIds = Object.keys(right.tiles);
  if (leftIds.length !== rightIds.length) {
    return false;
  }
  return rightIds.every((id) => {
    const leftTile = left.tiles[id];
    const rightTile = right.tiles[id];
    return Boolean(leftTile) &&
      leftTile.height === rightTile.height &&
      leftTile.width === rightTile.width &&
      leftTile.x === rightTile.x &&
      leftTile.y === rightTile.y;
  });
}
