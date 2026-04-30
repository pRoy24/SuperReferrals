"use client";

import { useEffect, useState } from "react";
import {
  applyDocumentAppLanguage,
  persistAppLanguage,
  persistAppLanguagePreference,
  readStoredAppLanguage
} from "@/lib/app-language-client";
import {
  DEFAULT_APP_LANGUAGE,
  appLanguages,
  normalizeAppLanguage
} from "@/lib/localization";
import { samsarAuthHeaders } from "@/lib/storefront-auth-client";
import type { AppLanguageCode } from "@/lib/types";

export default function LanguageSelector() {
  const [language, setLanguage] = useState<AppLanguageCode>(DEFAULT_APP_LANGUAGE);
  const [resolved, setResolved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const localLanguage = readStoredAppLanguage();
    if (localLanguage) {
      setLanguage(localLanguage);
      applyDocumentAppLanguage(localLanguage);
      persistAppLanguagePreference(localLanguage).catch(() => undefined);
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
        if (!localLanguage) {
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
  }, []);

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
    <div className={`global-language-selector ${resolved ? "resolved" : ""}`}>
      <label>
        <span className="sr-only">Language</span>
        <select
          aria-label="Language"
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
