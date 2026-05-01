"use client";

import { useEffect, useState } from "react";
import {
  applyDocumentAppLanguage,
  persistAppLanguage,
  persistAppLanguagePreference,
  readRouteAppLanguage,
  readStoredAppLanguage
} from "@/lib/app-language-client";
import {
  DEFAULT_APP_LANGUAGE,
  appLanguages,
  normalizeAppLanguage
} from "@/lib/localization";
import { samsarAuthHeaders } from "@/lib/storefront-auth-client";
import type { AppLanguageCode } from "@/lib/types";

export default function LanguageSelector({
  className = "",
  initialLanguage,
  label = "Language"
}: {
  className?: string;
  initialLanguage?: AppLanguageCode;
  label?: string;
}) {
  const [language, setLanguage] = useState<AppLanguageCode>(
    normalizeAppLanguage(initialLanguage) || DEFAULT_APP_LANGUAGE
  );
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const preferredLanguage = readRouteAppLanguage() || readStoredAppLanguage() || normalizeAppLanguage(initialLanguage);
    if (preferredLanguage) {
      setLanguage(preferredLanguage);
      if (readRouteAppLanguage()) {
        persistAppLanguage(preferredLanguage);
      } else {
        applyDocumentAppLanguage(preferredLanguage);
      }
      persistAppLanguagePreference(preferredLanguage).catch(() => undefined);
    }

    fetch("/api/localization", {
      cache: "no-store",
      credentials: "same-origin",
      headers: samsarAuthHeaders()
    })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) {
          return;
        }
        const serverLanguage = normalizeAppLanguage(data.language) || DEFAULT_APP_LANGUAGE;
        if (!preferredLanguage) {
          setLanguage(serverLanguage);
          persistAppLanguage(serverLanguage);
          persistAppLanguagePreference(serverLanguage).catch(() => undefined);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setResolved(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialLanguage]);

  function selectLanguage(value: string) {
    const nextLanguage = normalizeAppLanguage(value);
    if (!nextLanguage || nextLanguage === language) {
      return;
    }
    setLanguage(nextLanguage);
    persistAppLanguage(nextLanguage);
    persistAppLanguagePreference(nextLanguage).catch(() => undefined);
  }

  return (
    <div className={`language-selector ${resolved ? "resolved" : ""} ${className}`.trim()}>
      <label>
        <span className="sr-only">{label}</span>
        <select
          aria-label={label}
          value={language}
          onChange={(event) => selectLanguage(event.target.value)}
        >
          {appLanguages.map((item) => (
            <option key={item.code} value={item.code}>{item.label}</option>
          ))}
        </select>
      </label>
    </div>
  );
}
