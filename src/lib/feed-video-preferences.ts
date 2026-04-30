export const DEFAULT_FEED_VIDEO_VOLUME = 0.5;

const FEED_VIDEO_VOLUME_STORAGE_KEY = "superreferrals:feed-video-volume";
const FEED_VIDEO_VOLUME_EVENT = "superreferrals:feed-video-volume-change";
const FEED_VIDEO_HARDWARE_VOLUME_STEP = 0.1;

type FeedVideoVolumeChangeSource = "toolbar" | "hardware";
type FeedVideoHardwareVolumeIntent = "up" | "down" | "mute";

type FeedVideoVolumeChange = {
  intent?: FeedVideoHardwareVolumeIntent;
  source?: FeedVideoVolumeChangeSource;
  volume: number;
};

let hardwareVolumeSyncSubscribers = 0;

export function readFeedVideoVolume() {
  if (typeof window === "undefined") {
    return DEFAULT_FEED_VIDEO_VOLUME;
  }
  return normalizeFeedVideoVolume(window.localStorage.getItem(FEED_VIDEO_VOLUME_STORAGE_KEY));
}

export function persistFeedVideoVolume(value: number, change?: Omit<FeedVideoVolumeChange, "volume">) {
  const normalized = normalizeFeedVideoVolume(value);
  if (typeof window === "undefined") {
    return normalized;
  }
  window.localStorage.setItem(FEED_VIDEO_VOLUME_STORAGE_KEY, String(normalized));
  window.dispatchEvent(new CustomEvent<FeedVideoVolumeChange>(FEED_VIDEO_VOLUME_EVENT, {
    detail: {
      ...change,
      volume: normalized
    }
  }));
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
    listener(feedVideoVolumeFromEventDetail((event as CustomEvent<FeedVideoVolumeChange | number>).detail));
  }

  window.addEventListener("storage", handleStorage);
  window.addEventListener(FEED_VIDEO_VOLUME_EVENT, handleCustom);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(FEED_VIDEO_VOLUME_EVENT, handleCustom);
  };
}

export function subscribeFeedVideoHardwareVolumeSync() {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  hardwareVolumeSyncSubscribers += 1;
  if (hardwareVolumeSyncSubscribers === 1) {
    window.addEventListener("keydown", handleHardwareVolumeKey, { capture: true });
  }

  return () => {
    hardwareVolumeSyncSubscribers = Math.max(0, hardwareVolumeSyncSubscribers - 1);
    if (hardwareVolumeSyncSubscribers === 0) {
      window.removeEventListener("keydown", handleHardwareVolumeKey, { capture: true });
    }
  };
}

export function normalizeFeedVideoVolume(value: number | string | null | undefined) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(value || "");
  return Number.isFinite(parsed)
    ? Math.max(0, Math.min(1, parsed))
    : DEFAULT_FEED_VIDEO_VOLUME;
}

function handleHardwareVolumeKey(event: KeyboardEvent) {
  const intent = hardwareVolumeIntentFromEvent(event);
  if (!intent) {
    return;
  }

  const currentVolume = readFeedVideoVolume();
  const nextVolume = hardwareVolumeForIntent(currentVolume, intent);
  persistFeedVideoVolume(nextVolume, { intent, source: "hardware" });
}

function hardwareVolumeIntentFromEvent(event: KeyboardEvent): FeedVideoHardwareVolumeIntent | null {
  const key = event.key || "";
  const code = event.code || "";
  const legacyKeyCode = event.keyCode || event.which;
  if (key === "AudioVolumeUp" || key === "VolumeUp" || code === "AudioVolumeUp" || code === "VolumeUp" || legacyKeyCode === 175) {
    return "up";
  }
  if (key === "AudioVolumeDown" || key === "VolumeDown" || code === "AudioVolumeDown" || code === "VolumeDown" || legacyKeyCode === 174) {
    return "down";
  }
  if (key === "AudioVolumeMute" || key === "VolumeMute" || code === "AudioVolumeMute" || code === "VolumeMute" || legacyKeyCode === 173) {
    return "mute";
  }
  return null;
}

function hardwareVolumeForIntent(currentVolume: number, intent: FeedVideoHardwareVolumeIntent) {
  if (intent === "mute") {
    return 0;
  }
  if (currentVolume <= 0) {
    return FEED_VIDEO_HARDWARE_VOLUME_STEP;
  }
  const direction = intent === "up" ? 1 : -1;
  const nextStep = Math.round((currentVolume + direction * FEED_VIDEO_HARDWARE_VOLUME_STEP) * 100) / 100;
  return normalizeFeedVideoVolume(nextStep);
}

function feedVideoVolumeFromEventDetail(detail: FeedVideoVolumeChange | number | null | undefined) {
  if (typeof detail === "number") {
    return normalizeFeedVideoVolume(detail);
  }
  return normalizeFeedVideoVolume(detail?.volume);
}
