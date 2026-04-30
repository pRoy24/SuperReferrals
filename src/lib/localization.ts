import type { AppLanguageCode } from "./types";

export const APP_LANGUAGE_STORAGE_KEY = "superreferrals:language";
export const DEFAULT_APP_LANGUAGE: AppLanguageCode = "en";

export const appLanguages: Array<{
  code: AppLanguageCode;
  label: string;
  htmlLang: string;
}> = [
  { code: "en", label: "English", htmlLang: "en" },
  { code: "zh", label: "Chinese (Simplified)", htmlLang: "zh-CN" }
];

const chinaRegionCountryCodes = new Set(["CN", "HK", "MO", "TW"]);

export function normalizeAppLanguage(value: unknown): AppLanguageCode | undefined {
  const normalized = String(value || "").trim().toLowerCase().replace(/_/g, "-");
  if (!normalized) {
    return undefined;
  }
  if (["en", "en-us", "en-gb", "english"].includes(normalized)) {
    return "en";
  }
  if (["cn", "zh", "zh-cn", "zh-hans", "zh-hant", "chinese"].includes(normalized)) {
    return "zh";
  }
  return undefined;
}

export function appLanguageHtmlLang(language: unknown) {
  const code = normalizeAppLanguage(language) || DEFAULT_APP_LANGUAGE;
  return appLanguages.find((item) => item.code === code)?.htmlLang || "en";
}

export function appLanguageForCountryCode(countryCode?: string | null): AppLanguageCode {
  const normalized = countryCode?.trim().toUpperCase();
  return normalized && chinaRegionCountryCodes.has(normalized) ? "zh" : DEFAULT_APP_LANGUAGE;
}

export function countryCodeFromHeaders(headers: Headers) {
  const rawCountry = firstHeaderValue(headers, [
    "x-vercel-ip-country",
    "cf-ipcountry",
    "x-country-code",
    "x-geo-country",
    "x-appengine-country"
  ]);
  const normalized = rawCountry
    .split(",")[0]
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  return normalized || undefined;
}

function firstHeaderValue(headers: Headers, names: string[]) {
  for (const name of names) {
    const value = headers.get(name)?.trim();
    if (value) {
      return value;
    }
  }
  return "";
}
