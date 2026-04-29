"use client";

import { ExternalLink, Pause, Play, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { PublicFeedItem } from "@/lib/types";

type VideoMosaicProps = {
  items: PublicFeedItem[];
  className?: string;
  emptyText?: string;
  limit?: number;
};

export default function VideoMosaic({
  items,
  className = "",
  emptyText = "No published videos yet.",
  limit
}: VideoMosaicProps) {
  const visibleItems = useMemo(
    () => typeof limit === "number" ? items.slice(0, limit) : items,
    [items, limit]
  );
  const [activeId, setActiveId] = useState("");
  const [mutedById, setMutedById] = useState<Record<string, boolean>>({});
  const [volumeById, setVolumeById] = useState<Record<string, number>>({});
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

  if (visibleItems.length === 0) {
    return <div className={`video-mosaic-empty ${className}`.trim()}>{emptyText}</div>;
  }

  return (
    <div className={`video-mosaic ${className}`.trim()}>
      <div className="video-mosaic-grid">
        {visibleItems.map((item, index) => {
          const isActive = activeId === item.id;
          const muted = mutedById[item.id] ?? true;
          const volume = volumeById[item.id] ?? 0.66;
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
                <video
                  ref={(node) => {
                    videoRefs.current[item.id] = node;
                  }}
                  src={item.videoUrl}
                  poster={item.posterUrl}
                  muted={muted}
                  playsInline
                  preload="metadata"
                  onEnded={() => setActiveId((current) => current === item.id ? "" : current)}
                  onPlay={() => setActiveId(item.id)}
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
                  <a className="video-mosaic-feed-link" href={feedHrefForItem(item)} title="View in feed">
                    <ExternalLink size={16} /> Feed
                  </a>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function feedHrefForItem(item: PublicFeedItem) {
  const mode = item.aspectRatio === "9:16" ? "mobile" : "desktop";
  return `/feed/${encodeURIComponent(item.generationId || item.id)}/${mode}`;
}
