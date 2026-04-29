export const DEFAULT_RENDITION_LANGUAGE_CODE = "EN";

export const supportedSamsarProcessorLanguageOptions = [
  { label: "English", value: "EN" },
  { label: "Spanish", value: "ES" },
  { label: "French", value: "FR" },
  { label: "Japanese", value: "JA" },
  { label: "Thai", value: "TH" },
  { label: "Chinese", value: "ZH" },
  { label: "Bengali", value: "BN" },
  { label: "Hindi", value: "HI" }
];

const RENDITION_LANGUAGE_KEYS = [
  "languageCode",
  "language_code",
  "renditionLanguageCode",
  "rendition_language_code",
  "result_language",
  "resultLanguage",
  "languages",
  "languageCodes",
  "language_codes",
  "session_language",
  "sessionLanguage",
  "language",
  "langauge"
] as const;

export function normalizeRenditionLanguageCode(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }

  const normalized = value.trim().replace(/_/g, "-").toUpperCase();
  return normalized && normalized !== "AUTO" ? normalized : "";
}

export function resolveRenditionLanguageCode(...values: unknown[]): string {
  for (const value of values) {
    if (Array.isArray(value)) {
      const nested = resolveRenditionLanguageCode(...value);
      if (nested) {
        return nested;
      }
      continue;
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const direct = resolveRenditionLanguageCode(
        ...RENDITION_LANGUAGE_KEYS.map((key) => record[key])
      );
      if (direct) {
        return direct;
      }
      continue;
    }

    const code = normalizeRenditionLanguageCode(value);
    if (code) {
      return code;
    }
  }

  return "";
}

export function languageCodeMetadata(languageCode: string) {
  return {
    languageCode,
    language_code: languageCode,
    renditionLanguageCode: languageCode,
    rendition_language_code: languageCode
  };
}
