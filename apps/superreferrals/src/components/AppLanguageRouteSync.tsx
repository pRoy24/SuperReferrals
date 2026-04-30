"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  applyDocumentAppLanguage,
  persistAppLanguage,
  readRouteAppLanguage,
  readStoredAppLanguage
} from "@/lib/app-language-client";

export default function AppLanguageRouteSync() {
  const pathname = usePathname();

  useEffect(() => {
    const routeLanguage = readRouteAppLanguage();
    if (!routeLanguage) {
      return;
    }
    if (readStoredAppLanguage() === routeLanguage) {
      applyDocumentAppLanguage(routeLanguage);
      return;
    }
    persistAppLanguage(routeLanguage);
  }, [pathname]);

  return null;
}
