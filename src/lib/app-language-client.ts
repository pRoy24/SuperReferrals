"use client";

import {
  APP_LANGUAGE_STORAGE_KEY,
  appLanguageHtmlLang,
  normalizeAppLanguage
} from "./localization";
import { samsarAuthHeaders } from "./storefront-auth-client";
import type { AppLanguageCode } from "./types";

export const APP_LANGUAGE_CHANGE_EVENT = "superreferrals:language-change";

export function readStoredAppLanguage() {
  if (typeof window === "undefined") {
    return undefined;
  }
  try {
    return normalizeAppLanguage(window.localStorage.getItem(APP_LANGUAGE_STORAGE_KEY));
  } catch {
    return undefined;
  }
}

export function applyDocumentAppLanguage(language: AppLanguageCode) {
  if (typeof document === "undefined") {
    return;
  }
  document.documentElement.lang = appLanguageHtmlLang(language);
  window.dispatchEvent(new CustomEvent(APP_LANGUAGE_CHANGE_EVENT, { detail: { language } }));
}

export function persistAppLanguage(language: AppLanguageCode) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(APP_LANGUAGE_STORAGE_KEY, language);
  } catch {
    // The in-memory document language still changes when storage is unavailable.
  }
  applyDocumentAppLanguage(language);
}

export function subscribeAppLanguage(listener: (language: AppLanguageCode) => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }
  const handleLanguageChange = (event: Event) => {
    const nextLanguage = normalizeAppLanguage((event as CustomEvent).detail?.language) || readStoredAppLanguage();
    if (nextLanguage) {
      listener(nextLanguage);
    }
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== APP_LANGUAGE_STORAGE_KEY) {
      return;
    }
    const nextLanguage = normalizeAppLanguage(event.newValue);
    if (nextLanguage) {
      listener(nextLanguage);
    }
  };
  window.addEventListener(APP_LANGUAGE_CHANGE_EVENT, handleLanguageChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(APP_LANGUAGE_CHANGE_EVENT, handleLanguageChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export async function syncStoredAppLanguagePreference(target: {
  subAccountId?: string;
  customerId?: string;
  wallet?: string;
} = {}) {
  const language = readStoredAppLanguage();
  if (!language) {
    return;
  }
  await persistAppLanguagePreference(language, target);
}

export async function persistAppLanguagePreference(
  language: AppLanguageCode,
  target: {
    subAccountId?: string;
    customerId?: string;
    wallet?: string;
  } = {}
) {
  const response = await fetch("/api/localization", {
    method: "PATCH",
    headers: samsarAuthHeaders({ "content-type": "application/json" }),
    credentials: "same-origin",
    body: JSON.stringify({ language, ...target })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || "Unable to save language preference");
  }
  return data;
}
