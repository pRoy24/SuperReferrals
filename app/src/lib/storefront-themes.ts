import type { CSSProperties } from "react";
import type { StorefrontThemeId } from "./types";

export type StorefrontThemeVariable =
  | "--storefront-bg"
  | "--storefront-surface"
  | "--storefront-surface-strong"
  | "--storefront-text"
  | "--storefront-muted"
  | "--storefront-line"
  | "--storefront-accent"
  | "--storefront-accent-strong"
  | "--storefront-chip-bg"
  | "--storefront-chip-text"
  | "--storefront-hero-bg"
  | "--storefront-control-bg"
  | "--storefront-control-text"
  | "--storefront-button-bg"
  | "--storefront-button-text"
  | "--storefront-button-hover-bg"
  | "--storefront-button-hover-text"
  | "--storefront-primary-bg"
  | "--storefront-primary-text"
  | "--storefront-focus"
  | "--storefront-shadow";

export type StorefrontTheme = {
  id: StorefrontThemeId;
  label: string;
  accentLabel: string;
  swatches: [string, string, string];
  variables: Record<StorefrontThemeVariable, string>;
};

export const DEFAULT_STOREFRONT_THEME_ID: StorefrontThemeId = "theme-1";

export const STOREFRONT_THEMES: StorefrontTheme[] = [
  {
    id: "theme-1",
    label: "Material Light",
    accentLabel: "Clean blue",
    swatches: ["#f8fafc", "#1d4ed8", "#0f766e"],
    variables: {
      "--storefront-bg": "#f8fafc",
      "--storefront-surface": "#ffffff",
      "--storefront-surface-strong": "#ffffff",
      "--storefront-text": "#0f172a",
      "--storefront-muted": "#475569",
      "--storefront-line": "rgba(15, 23, 42, 0.14)",
      "--storefront-accent": "#1d4ed8",
      "--storefront-accent-strong": "#0f766e",
      "--storefront-chip-bg": "#dbeafe",
      "--storefront-chip-text": "#1d4ed8",
      "--storefront-hero-bg": "#ffffff",
      "--storefront-control-bg": "#ffffff",
      "--storefront-control-text": "#0f172a",
      "--storefront-button-bg": "#ffffff",
      "--storefront-button-text": "#1d4ed8",
      "--storefront-button-hover-bg": "#eff6ff",
      "--storefront-button-hover-text": "#1e40af",
      "--storefront-primary-bg": "#1d4ed8",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(29, 78, 216, 0.16)",
      "--storefront-shadow": "0 14px 34px rgba(15, 23, 42, 0.08)"
    }
  },
  {
    id: "theme-2",
    label: "Market Fresh",
    accentLabel: "Material green",
    swatches: ["#f7fbf6", "#166534", "#be123c"],
    variables: {
      "--storefront-bg": "#f7fbf6",
      "--storefront-surface": "#ffffff",
      "--storefront-surface-strong": "#fbfef9",
      "--storefront-text": "#102015",
      "--storefront-muted": "#4b6355",
      "--storefront-line": "rgba(22, 101, 52, 0.18)",
      "--storefront-accent": "#166534",
      "--storefront-accent-strong": "#be123c",
      "--storefront-chip-bg": "#dcfce7",
      "--storefront-chip-text": "#166534",
      "--storefront-hero-bg": "#ffffff",
      "--storefront-control-bg": "#ffffff",
      "--storefront-control-text": "#102015",
      "--storefront-button-bg": "#ffffff",
      "--storefront-button-text": "#166534",
      "--storefront-button-hover-bg": "#ecfdf5",
      "--storefront-button-hover-text": "#14532d",
      "--storefront-primary-bg": "#166534",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(22, 101, 52, 0.18)",
      "--storefront-shadow": "0 14px 34px rgba(16, 32, 21, 0.08)"
    }
  },
  {
    id: "theme-3",
    label: "Noir Mint",
    accentLabel: "Futuristic dark",
    swatches: ["#071012", "#0f766e", "#facc15"],
    variables: {
      "--storefront-bg": "#071012",
      "--storefront-surface": "#0f1f21",
      "--storefront-surface-strong": "#14282a",
      "--storefront-text": "#f2fffb",
      "--storefront-muted": "#b6d6d0",
      "--storefront-line": "rgba(94, 234, 212, 0.32)",
      "--storefront-accent": "#5eead4",
      "--storefront-accent-strong": "#facc15",
      "--storefront-chip-bg": "#16322f",
      "--storefront-chip-text": "#bffef3",
      "--storefront-hero-bg": "#0b181a",
      "--storefront-control-bg": "#102224",
      "--storefront-control-text": "#f2fffb",
      "--storefront-button-bg": "#11282a",
      "--storefront-button-text": "#d5fff8",
      "--storefront-button-hover-bg": "#17363a",
      "--storefront-button-hover-text": "#ffffff",
      "--storefront-primary-bg": "#0f766e",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(94, 234, 212, 0.2)",
      "--storefront-shadow": "0 18px 42px rgba(0, 0, 0, 0.3)"
    }
  },
  {
    id: "theme-4",
    label: "Gallery Rose",
    accentLabel: "Minimal editorial",
    swatches: ["#fff7fb", "#be185d", "#0f766e"],
    variables: {
      "--storefront-bg": "#fff7fb",
      "--storefront-surface": "#ffffff",
      "--storefront-surface-strong": "#fffbfd",
      "--storefront-text": "#271323",
      "--storefront-muted": "#694d62",
      "--storefront-line": "rgba(190, 24, 93, 0.18)",
      "--storefront-accent": "#be185d",
      "--storefront-accent-strong": "#0f766e",
      "--storefront-chip-bg": "#ccfbf1",
      "--storefront-chip-text": "#0f766e",
      "--storefront-hero-bg": "#ffffff",
      "--storefront-control-bg": "#ffffff",
      "--storefront-control-text": "#271323",
      "--storefront-button-bg": "#ffffff",
      "--storefront-button-text": "#be185d",
      "--storefront-button-hover-bg": "#fdf2f8",
      "--storefront-button-hover-text": "#9d174d",
      "--storefront-primary-bg": "#be185d",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(190, 24, 93, 0.16)",
      "--storefront-shadow": "0 14px 34px rgba(39, 19, 35, 0.08)"
    }
  },
  {
    id: "theme-5",
    label: "Signal Clean",
    accentLabel: "Cyan and amber",
    swatches: ["#f8fafc", "#0e7490", "#854d0e"],
    variables: {
      "--storefront-bg": "#f8fafc",
      "--storefront-surface": "#ffffff",
      "--storefront-surface-strong": "#ffffff",
      "--storefront-text": "#111827",
      "--storefront-muted": "#4b5563",
      "--storefront-line": "rgba(14, 116, 144, 0.18)",
      "--storefront-accent": "#0e7490",
      "--storefront-accent-strong": "#854d0e",
      "--storefront-chip-bg": "#fef3c7",
      "--storefront-chip-text": "#854d0e",
      "--storefront-hero-bg": "#ffffff",
      "--storefront-control-bg": "#ffffff",
      "--storefront-control-text": "#111827",
      "--storefront-button-bg": "#ffffff",
      "--storefront-button-text": "#0e7490",
      "--storefront-button-hover-bg": "#ecfeff",
      "--storefront-button-hover-text": "#155e75",
      "--storefront-primary-bg": "#0e7490",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(14, 116, 144, 0.18)",
      "--storefront-shadow": "0 14px 34px rgba(17, 24, 39, 0.08)"
    }
  },
  {
    id: "theme-6",
    label: "Editorial Paper",
    accentLabel: "Clean commerce",
    swatches: ["#fbfaf5", "#166534", "#991b1b"],
    variables: {
      "--storefront-bg": "#fbfaf5",
      "--storefront-surface": "#ffffff",
      "--storefront-surface-strong": "#fffefa",
      "--storefront-text": "#1c1917",
      "--storefront-muted": "#5f5751",
      "--storefront-line": "rgba(22, 101, 52, 0.18)",
      "--storefront-accent": "#166534",
      "--storefront-accent-strong": "#991b1b",
      "--storefront-chip-bg": "#fee2e2",
      "--storefront-chip-text": "#991b1b",
      "--storefront-hero-bg": "#ffffff",
      "--storefront-control-bg": "#ffffff",
      "--storefront-control-text": "#1c1917",
      "--storefront-button-bg": "#ffffff",
      "--storefront-button-text": "#166534",
      "--storefront-button-hover-bg": "#f0fdf4",
      "--storefront-button-hover-text": "#14532d",
      "--storefront-primary-bg": "#166534",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(22, 101, 52, 0.18)",
      "--storefront-shadow": "0 14px 34px rgba(28, 25, 23, 0.08)"
    }
  },
  {
    id: "theme-7",
    label: "Material Graphite",
    accentLabel: "Dark minimal",
    swatches: ["#111827", "#0369a1", "#38bdf8"],
    variables: {
      "--storefront-bg": "#111827",
      "--storefront-surface": "#1f2937",
      "--storefront-surface-strong": "#263244",
      "--storefront-text": "#f9fafb",
      "--storefront-muted": "#d1d5db",
      "--storefront-line": "rgba(209, 213, 219, 0.22)",
      "--storefront-accent": "#7dd3fc",
      "--storefront-accent-strong": "#38bdf8",
      "--storefront-chip-bg": "#1e3a5f",
      "--storefront-chip-text": "#bae6fd",
      "--storefront-hero-bg": "#1f2937",
      "--storefront-control-bg": "#111827",
      "--storefront-control-text": "#f9fafb",
      "--storefront-button-bg": "#111827",
      "--storefront-button-text": "#e0f2fe",
      "--storefront-button-hover-bg": "#263244",
      "--storefront-button-hover-text": "#ffffff",
      "--storefront-primary-bg": "#0369a1",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(125, 211, 252, 0.2)",
      "--storefront-shadow": "0 18px 42px rgba(0, 0, 0, 0.34)"
    }
  },
  {
    id: "theme-8",
    label: "Cyber Carbon",
    accentLabel: "Futuristic dark",
    swatches: ["#05070a", "#0e7490", "#f59e0b"],
    variables: {
      "--storefront-bg": "#05070a",
      "--storefront-surface": "#0c1117",
      "--storefront-surface-strong": "#111923",
      "--storefront-text": "#f8fbff",
      "--storefront-muted": "#b9c4d0",
      "--storefront-line": "rgba(34, 211, 238, 0.28)",
      "--storefront-accent": "#22d3ee",
      "--storefront-accent-strong": "#f59e0b",
      "--storefront-chip-bg": "#142431",
      "--storefront-chip-text": "#a5f3fc",
      "--storefront-hero-bg": "#0c1117",
      "--storefront-control-bg": "#090e13",
      "--storefront-control-text": "#f8fbff",
      "--storefront-button-bg": "#0a1118",
      "--storefront-button-text": "#cffafe",
      "--storefront-button-hover-bg": "#12202b",
      "--storefront-button-hover-text": "#ffffff",
      "--storefront-primary-bg": "#0e7490",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(34, 211, 238, 0.22)",
      "--storefront-shadow": "0 18px 46px rgba(0, 0, 0, 0.4)"
    }
  },
  {
    id: "theme-9",
    label: "Obsidian Volt",
    accentLabel: "High contrast dark",
    swatches: ["#101010", "#3f6212", "#a3e635"],
    variables: {
      "--storefront-bg": "#101010",
      "--storefront-surface": "#181818",
      "--storefront-surface-strong": "#202020",
      "--storefront-text": "#f7fee7",
      "--storefront-muted": "#c8d6b3",
      "--storefront-line": "rgba(163, 230, 53, 0.28)",
      "--storefront-accent": "#bef264",
      "--storefront-accent-strong": "#a3e635",
      "--storefront-chip-bg": "#263414",
      "--storefront-chip-text": "#d9f99d",
      "--storefront-hero-bg": "#181818",
      "--storefront-control-bg": "#0f0f0f",
      "--storefront-control-text": "#f7fee7",
      "--storefront-button-bg": "#111111",
      "--storefront-button-text": "#ecfccb",
      "--storefront-button-hover-bg": "#222a16",
      "--storefront-button-hover-text": "#ffffff",
      "--storefront-primary-bg": "#3f6212",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(190, 242, 100, 0.2)",
      "--storefront-shadow": "0 18px 44px rgba(0, 0, 0, 0.42)"
    }
  },
  {
    id: "theme-10",
    label: "Arctic Minimal",
    accentLabel: "Cool neutral",
    swatches: ["#f4f7fb", "#334155", "#075985"],
    variables: {
      "--storefront-bg": "#f4f7fb",
      "--storefront-surface": "#ffffff",
      "--storefront-surface-strong": "#ffffff",
      "--storefront-text": "#0b1220",
      "--storefront-muted": "#475569",
      "--storefront-line": "rgba(51, 65, 85, 0.16)",
      "--storefront-accent": "#334155",
      "--storefront-accent-strong": "#075985",
      "--storefront-chip-bg": "#e0f2fe",
      "--storefront-chip-text": "#075985",
      "--storefront-hero-bg": "#ffffff",
      "--storefront-control-bg": "#ffffff",
      "--storefront-control-text": "#0b1220",
      "--storefront-button-bg": "#ffffff",
      "--storefront-button-text": "#334155",
      "--storefront-button-hover-bg": "#f1f5f9",
      "--storefront-button-hover-text": "#0f172a",
      "--storefront-primary-bg": "#334155",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(51, 65, 85, 0.16)",
      "--storefront-shadow": "0 14px 34px rgba(15, 23, 42, 0.08)"
    }
  },
  {
    id: "theme-11",
    label: "Ink Bloom",
    accentLabel: "Dark editorial",
    swatches: ["#120f14", "#be123c", "#2dd4bf"],
    variables: {
      "--storefront-bg": "#120f14",
      "--storefront-surface": "#1c1820",
      "--storefront-surface-strong": "#261f2b",
      "--storefront-text": "#fff7fb",
      "--storefront-muted": "#dac9d3",
      "--storefront-line": "rgba(251, 113, 133, 0.28)",
      "--storefront-accent": "#fb7185",
      "--storefront-accent-strong": "#2dd4bf",
      "--storefront-chip-bg": "#33202a",
      "--storefront-chip-text": "#fecdd3",
      "--storefront-hero-bg": "#1c1820",
      "--storefront-control-bg": "#141018",
      "--storefront-control-text": "#fff7fb",
      "--storefront-button-bg": "#19131c",
      "--storefront-button-text": "#fecdd3",
      "--storefront-button-hover-bg": "#2a1d27",
      "--storefront-button-hover-text": "#ffffff",
      "--storefront-primary-bg": "#be123c",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(251, 113, 133, 0.2)",
      "--storefront-shadow": "0 18px 44px rgba(0, 0, 0, 0.38)"
    }
  },
  {
    id: "theme-12",
    label: "Clean Mono",
    accentLabel: "Black and white",
    swatches: ["#f6f6f6", "#171717", "#0f766e"],
    variables: {
      "--storefront-bg": "#f6f6f6",
      "--storefront-surface": "#ffffff",
      "--storefront-surface-strong": "#ffffff",
      "--storefront-text": "#171717",
      "--storefront-muted": "#525252",
      "--storefront-line": "rgba(23, 23, 23, 0.16)",
      "--storefront-accent": "#171717",
      "--storefront-accent-strong": "#0f766e",
      "--storefront-chip-bg": "#e5e5e5",
      "--storefront-chip-text": "#262626",
      "--storefront-hero-bg": "#ffffff",
      "--storefront-control-bg": "#ffffff",
      "--storefront-control-text": "#171717",
      "--storefront-button-bg": "#ffffff",
      "--storefront-button-text": "#171717",
      "--storefront-button-hover-bg": "#eeeeee",
      "--storefront-button-hover-text": "#000000",
      "--storefront-primary-bg": "#171717",
      "--storefront-primary-text": "#ffffff",
      "--storefront-focus": "rgba(23, 23, 23, 0.16)",
      "--storefront-shadow": "0 14px 34px rgba(23, 23, 23, 0.08)"
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
