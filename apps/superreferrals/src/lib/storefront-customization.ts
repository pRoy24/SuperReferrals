import type { StorefrontLayoutId } from "./types";

export const DEFAULT_STOREFRONT_HERO_TITLE = "Generate a product video";
export const DEFAULT_STOREFRONT_HERO_SUBTITLE = "Connect wallet, choose a configuration, submit the task, and wait for render.";
export const DEFAULT_STOREFRONT_LAYOUT_ID: StorefrontLayoutId = "classic";

export const STOREFRONT_LAYOUT_OPTIONS: Array<{
  id: StorefrontLayoutId;
  label: string;
  description: string;
}> = [
  {
    id: "classic",
    label: "Classic",
    description: "Wallet and pricing appear first, followed by the render task."
  },
  {
    id: "studio",
    label: "Render first",
    description: "The render task leads the page, with setup details below."
  },
  {
    id: "sidebar",
    label: "Split",
    description: "Wallet and pricing stay in a left column beside the render task."
  }
];

const storefrontLayoutIds = new Set<StorefrontLayoutId>(STOREFRONT_LAYOUT_OPTIONS.map((layout) => layout.id));

export function normalizeStorefrontLayoutId(value: unknown): StorefrontLayoutId {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return storefrontLayoutIds.has(normalized as StorefrontLayoutId)
    ? normalized as StorefrontLayoutId
    : DEFAULT_STOREFRONT_LAYOUT_ID;
}
