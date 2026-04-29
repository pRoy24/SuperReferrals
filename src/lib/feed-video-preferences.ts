export const DEFAULT_FEED_VIDEO_VOLUME = 0.5;

const FEED_VIDEO_VOLUME_STORAGE_KEY = "superreferrals:feed-video-volume";
const FEED_VIDEO_VOLUME_EVENT = "superreferrals:feed-video-volume-change";

export function readFeedVideoVolume() {
  if (typeof window === "undefined") {
    return DEFAULT_FEED_VIDEO_VOLUME;
  }
  return normalizeFeedVideoVolume(window.localStorage.getItem(FEED_VIDEO_VOLUME_STORAGE_KEY));
}

export function persistFeedVideoVolume(value: number) {
  const normalized = normalizeFeedVideoVolume(value);
  if (typeof window === "undefined") {
    return normalized;
  }
  window.localStorage.setItem(FEED_VIDEO_VOLUME_STORAGE_KEY, String(normalized));
  window.dispatchEvent(new CustomEvent(FEED_VIDEO_VOLUME_EVENT, { detail: normalized }));
  return normalized;
}

export function subscribeFeedVideoVolume(listener: (volume: number) => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  function handleStorage(event: StorageEvent) {
    if (event.key === FEED_VIDEO_VOLUME_STORAGE_KEY) {
      listener(normalizeFeedVideoVolume(event.newValue));
    }
  }

  function handleCustom(event: Event) {
    listener(normalizeFeedVideoVolume((event as CustomEvent<number>).detail));
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(FEED_VIDEO_VOLUME_EVENT, handleCustom);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(FEED_VIDEO_VOLUME_EVENT, handleCustom);
  };
}

export function normalizeFeedVideoVolume(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value || "");
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(1, parsed))
    : DEFAULT_FEED_VIDEO_VOLUME;
}
