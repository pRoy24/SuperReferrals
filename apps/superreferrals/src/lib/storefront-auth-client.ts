"use client";

const SAMSAR_AUTH_TOKEN_STORAGE_KEY = "superreferrals:samsar-auth-token";
const SAMSAR_CREDENTIALS_STORAGE_KEY = "superreferrals:samsar-credentials";
const REFRESH_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000;

export type StoredSamsarCredentials = {
  authToken?: string;
  refreshToken?: string;
  expiryDate?: string;
  refreshTokenExpiresAt?: string;
};

export function readStoredSamsarAuthToken() {
  return readStoredSamsarCredentials().authToken || "";
}

export function storeSamsarAuthToken(authToken?: string) {
  const cleanAuthToken = authToken?.trim();
  if (typeof window === "undefined" || !cleanAuthToken) {
    return;
  }
  storeSamsarCredentials({ authToken: cleanAuthToken });
}

export function readStoredSamsarCredentials(): StoredSamsarCredentials {
  if (typeof window === "undefined") {
    return {};
  }
  const credentials = parseStoredCredentials(readStorageItem(window.localStorage, SAMSAR_CREDENTIALS_STORAGE_KEY)) ||
    parseStoredCredentials(readStorageItem(window.sessionStorage, SAMSAR_CREDENTIALS_STORAGE_KEY)) ||
    {};
  const legacyAuthToken = readStorageItem(window.localStorage, SAMSAR_AUTH_TOKEN_STORAGE_KEY) ||
    readStorageItem(window.sessionStorage, SAMSAR_AUTH_TOKEN_STORAGE_KEY);
  if (!credentials.authToken && legacyAuthToken) {
    credentials.authToken = legacyAuthToken;
  }
  return cleanSamsarCredentials(credentials);
}

export function storeSamsarCredentials(credentials: StoredSamsarCredentials) {
  if (typeof window === "undefined") {
    return {};
  }
  const next = cleanSamsarCredentials({
    ...readStoredSamsarCredentials(),
    ...credentials
  });
  if (!next.authToken && !next.refreshToken) {
    return next;
  }
  const serialized = JSON.stringify(next);
  writeStorageItem(window.localStorage, SAMSAR_CREDENTIALS_STORAGE_KEY, serialized);
  writeStorageItem(window.sessionStorage, SAMSAR_CREDENTIALS_STORAGE_KEY, serialized);
  if (next.authToken) {
    writeStorageItem(window.localStorage, SAMSAR_AUTH_TOKEN_STORAGE_KEY, next.authToken);
    writeStorageItem(window.sessionStorage, SAMSAR_AUTH_TOKEN_STORAGE_KEY, next.authToken);
  }
  return next;
}

export function authCredentialsFromCurrentUrl(): StoredSamsarCredentials {
  if (typeof window === "undefined") {
    return {};
  }
  const url = new URL(window.location.href);
  return cleanSamsarCredentials({
    authToken: getFirstSearchParam(url, ["authToken", "auth_token", "accessToken", "access_token", "token"]),
    refreshToken: getFirstSearchParam(url, ["refreshToken", "refresh_token"]),
    expiryDate: getFirstSearchParam(url, ["expiryDate", "expiry_date", "expiresAt", "expires_at"]),
    refreshTokenExpiresAt: getFirstSearchParam(url, ["refreshTokenExpiresAt", "refresh_token_expires_at"])
  });
}

export function authTokenFromCurrentUrl() {
  return authCredentialsFromCurrentUrl().authToken || "";
}

export function removeAuthCredentialsFromCurrentUrl() {
  if (typeof window === "undefined") {
    return;
  }
  const url = new URL(window.location.href);
  let changed = false;
  for (const key of [
    "authToken",
    "auth_token",
    "accessToken",
    "access_token",
    "token",
    "refreshToken",
    "refresh_token",
    "expiryDate",
    "expiry_date",
    "expiresAt",
    "expires_at",
    "refreshTokenExpiresAt",
    "refresh_token_expires_at"
  ]) {
    if (url.searchParams.has(key)) {
      url.searchParams.delete(key);
      changed = true;
    }
  }
  if (changed) {
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }
}

export function removeAuthTokenFromCurrentUrl() {
  removeAuthCredentialsFromCurrentUrl();
}

export function shouldRefreshSamsarCredentials(credentials = readStoredSamsarCredentials()) {
  if (!credentials.refreshToken || !credentials.expiryDate) {
    return false;
  }
  const expiresAt = Date.parse(credentials.expiryDate);
  return Number.isFinite(expiresAt) && expiresAt - Date.now() <= REFRESH_THRESHOLD_MS;
}

export async function refreshStoredSamsarCredentialsIfNeeded() {
  const credentials = readStoredSamsarCredentials();
  if (!shouldRefreshSamsarCredentials(credentials)) {
    return credentials;
  }
  const response = await fetch("/api/processor/session/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: credentials.refreshToken }),
    credentials: "same-origin"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Unable to refresh SuperReferrals account credentials.");
  }
  return storeSamsarCredentials({
    authToken: data.account?.authToken,
    refreshToken: data.account?.refreshToken,
    expiryDate: data.account?.expiryDate,
    refreshTokenExpiresAt: data.account?.refreshTokenExpiresAt
  });
}

export function samsarAuthHeaders(headers?: HeadersInit) {
  const merged = new Headers(headers);
  const authToken = readStoredSamsarAuthToken();
  if (authToken && !merged.has("authorization")) {
    merged.set("authorization", `Bearer ${authToken}`);
  }
  return merged;
}

export function fetchWithSamsarAuth(input: RequestInfo | URL, init: RequestInit = {}) {
  return fetch(input, {
    ...init,
    headers: samsarAuthHeaders(init.headers)
  });
}

function getFirstSearchParam(url: URL, keys: string[]) {
  for (const key of keys) {
    const value = url.searchParams.get(key)?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

function cleanSamsarCredentials(credentials: StoredSamsarCredentials): StoredSamsarCredentials {
  return {
    authToken: credentials.authToken?.trim() || undefined,
    refreshToken: credentials.refreshToken?.trim() || undefined,
    expiryDate: credentials.expiryDate?.trim() || undefined,
    refreshTokenExpiresAt: credentials.refreshTokenExpiresAt?.trim() || undefined
  };
}

function parseStoredCredentials(value: string | undefined) {
  if (!value) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(value) as StoredSamsarCredentials;
    return parsed && typeof parsed === "object" ? parsed : undefined;
  } catch {
    return { authToken: value };
  }
}

function readStorageItem(storage: Storage, key: string) {
  try {
    return storage.getItem(key)?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function writeStorageItem(storage: Storage, key: string, value: string) {
  try {
    storage.setItem(key, value);
  } catch {
    // The httpOnly session cookie set by the API remains the durable fallback.
  }
}
