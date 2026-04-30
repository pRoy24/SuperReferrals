import type { CSSProperties } from "react";
import type { StorefrontThemeId } from "./types";

export type StorefrontTheme = {
  id: StorefrontThemeId;
  label: string;
  accentLabel: string;
  swatches: [string, string, string];
  variables: Record<string, string>;
};

export const DEFAULT_STOREFRONT_THEME_ID: StorefrontThemeId = "theme-1";

export const STOREFRONT_THEMES: StorefrontTheme[] = [
  {
    id: "theme-1",
    label: "Theme 1",
    accentLabel: "Studio Light",
    swatches: ["#ffffff", "#f97316", "#2563eb"],
    variables: {
      "--storefront-bg": "linear-gradient(180deg, #fff7ed 0%, #f8fbff 58%, #eefdf8 100%)",
      "--storefront-surface": "rgba(255, 255, 255, 0.88)",
      "--storefront-surface-strong": "rgba(255, 255, 255, 0.96)",
      "--storefront-text": "#0f172a",
      "--storefront-muted": "#64748b",
      "--storefront-line": "rgba(31, 91, 160, 0.14)",
      "--storefront-accent": "#2563eb",
      "--storefront-accent-strong": "#f97316",
      "--storefront-chip-bg": "rgba(37, 99, 235, 0.1)",
      "--storefront-chip-text": "#1d4ed8",
      "--storefront-hero-bg": "radial-gradient(circle at top left, rgba(255, 237, 213, 0.9), transparent 36%), radial-gradient(circle at top right, rgba(219, 234, 254, 0.9), transparent 34%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 247, 250, 0.9))"
    }
  },
  {
    id: "theme-2",
    label: "Theme 2",
    accentLabel: "Market Fresh",
    swatches: ["#f8fff4", "#16a34a", "#f43f5e"],
    variables: {
      "--storefront-bg": "linear-gradient(180deg, #f8fff4 0%, #ecfeff 52%, #fff1f2 100%)",
      "--storefront-surface": "rgba(255, 255, 255, 0.9)",
      "--storefront-surface-strong": "rgba(248, 255, 244, 0.96)",
      "--storefront-text": "#102015",
      "--storefront-muted": "#5f7668",
      "--storefront-line": "rgba(22, 163, 74, 0.16)",
      "--storefront-accent": "#16a34a",
      "--storefront-accent-strong": "#f43f5e",
      "--storefront-chip-bg": "rgba(244, 63, 94, 0.11)",
      "--storefront-chip-text": "#be123c",
      "--storefront-hero-bg": "radial-gradient(circle at 10% 0%, rgba(187, 247, 208, 0.88), transparent 34%), radial-gradient(circle at 100% 12%, rgba(254, 205, 211, 0.86), transparent 30%), linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(236, 253, 245, 0.92))"
    }
  },
  {
    id: "theme-3",
    label: "Theme 3",
    accentLabel: "Noir Mint",
    swatches: ["#081112", "#3dd6c6", "#facc15"],
    variables: {
      "--storefront-bg": "linear-gradient(180deg, #071012 0%, #102626 62%, #172118 100%)",
      "--storefront-surface": "rgba(9, 23, 25, 0.86)",
      "--storefront-surface-strong": "rgba(16, 38, 38, 0.94)",
      "--storefront-text": "#f2fffb",
      "--storefront-muted": "#a6c8c2",
      "--storefront-line": "rgba(61, 214, 198, 0.22)",
      "--storefront-accent": "#3dd6c6",
      "--storefront-accent-strong": "#facc15",
      "--storefront-chip-bg": "rgba(250, 204, 21, 0.13)",
      "--storefront-chip-text": "#fde68a",
      "--storefront-hero-bg": "radial-gradient(circle at top left, rgba(61, 214, 198, 0.24), transparent 34%), radial-gradient(circle at bottom right, rgba(250, 204, 21, 0.16), transparent 30%), linear-gradient(180deg, rgba(8, 17, 18, 0.94), rgba(16, 38, 38, 0.92))"
    }
  },
  {
    id: "theme-4",
    label: "Theme 4",
    accentLabel: "Gallery Rose",
    swatches: ["#fff7fb", "#db2777", "#0f766e"],
    variables: {
      "--storefront-bg": "linear-gradient(180deg, #fff7fb 0%, #f7fee7 48%, #eff6ff 100%)",
      "--storefront-surface": "rgba(255, 255, 255, 0.89)",
      "--storefront-surface-strong": "rgba(255, 247, 251, 0.96)",
      "--storefront-text": "#271323",
      "--storefront-muted": "#765f71",
      "--storefront-line": "rgba(219, 39, 119, 0.15)",
      "--storefront-accent": "#db2777",
      "--storefront-accent-strong": "#0f766e",
      "--storefront-chip-bg": "rgba(15, 118, 110, 0.1)",
      "--storefront-chip-text": "#0f766e",
      "--storefront-hero-bg": "radial-gradient(circle at 0% 0%, rgba(251, 207, 232, 0.92), transparent 35%), radial-gradient(circle at 96% 12%, rgba(153, 246, 228, 0.72), transparent 30%), linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(255, 247, 251, 0.9))"
    }
  },
  {
    id: "theme-5",
    label: "Theme 5",
    accentLabel: "Signal Pop",
    swatches: ["#f8fafc", "#0891b2", "#eab308"],
    variables: {
      "--storefront-bg": "linear-gradient(180deg, #f8fafc 0%, #fefce8 50%, #ecfeff 100%)",
      "--storefront-surface": "rgba(255, 255, 255, 0.9)",
      "--storefront-surface-strong": "rgba(248, 250, 252, 0.97)",
      "--storefront-text": "#111827",
      "--storefront-muted": "#5b6472",
      "--storefront-line": "rgba(8, 145, 178, 0.16)",
      "--storefront-accent": "#0891b2",
      "--storefront-accent-strong": "#eab308",
      "--storefront-chip-bg": "rgba(234, 179, 8, 0.15)",
      "--storefront-chip-text": "#854d0e",
      "--storefront-hero-bg": "radial-gradient(circle at 8% 0%, rgba(165, 243, 252, 0.86), transparent 34%), radial-gradient(circle at 100% 18%, rgba(254, 240, 138, 0.86), transparent 31%), linear-gradient(180deg, rgba(255, 255, 255, 0.94), rgba(248, 250, 252, 0.9))"
    }
  },
  {
    id: "theme-6",
    label: "Theme 6",
    accentLabel: "Luxe Paper",
    swatches: ["#fbfaf5", "#166534", "#b91c1c"],
    variables: {
      "--storefront-bg": "linear-gradient(180deg, #fbfaf5 0%, #f0fdf4 54%, #fff1f2 100%)",
      "--storefront-surface": "rgba(255, 255, 255, 0.88)",
      "--storefront-surface-strong": "rgba(251, 250, 245, 0.97)",
      "--storefront-text": "#1c1917",
      "--storefront-muted": "#6d625b",
      "--storefront-line": "rgba(22, 101, 52, 0.16)",
      "--storefront-accent": "#166534",
      "--storefront-accent-strong": "#b91c1c",
      "--storefront-chip-bg": "rgba(185, 28, 28, 0.1)",
      "--storefront-chip-text": "#991b1b",
      "--storefront-hero-bg": "radial-gradient(circle at 0% 0%, rgba(187, 247, 208, 0.72), transparent 36%), radial-gradient(circle at 96% 10%, rgba(254, 202, 202, 0.78), transparent 31%), linear-gradient(180deg, rgba(255, 255, 255, 0.9), rgba(251, 250, 245, 0.94))"
    }
  }
];

const themeIdSet = new Set<StorefrontThemeId>(STOREFRONT_THEMES.map((theme) => theme.id));

export function normalizeStorefrontThemeId(value: unknown): StorefrontThemeId {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return themeIdSet.has(normalized as StorefrontThemeId)
    ? normalized as StorefrontThemeId
    : DEFAULT_STOREFRONT_THEME_ID;
}

export function getStorefrontTheme(value: unknown): StorefrontTheme {
  const id = normalizeStorefrontThemeId(value);
  return STOREFRONT_THEMES.find((theme) => theme.id === id) || STOREFRONT_THEMES[0]!;
}

export function storefrontThemeStyle(value: unknown): CSSProperties {
  return getStorefrontTheme(value).variables as CSSProperties;
}
