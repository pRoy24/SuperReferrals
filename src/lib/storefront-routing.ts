import type { Customer, StorefrontEnsNetwork, VideoAspectRatio } from "./types";

export type StorefrontPublicSurface = "storefront" | "feed" | "mosaic" | "video";

const DEFAULT_STOREFRONT_PATH = "/";
const DEFAULT_FEED_PATH = "/feed";
const DEFAULT_MOSAIC_PATH = "/mosaic";
const DEFAULT_VIDEO_PATH = "/feed";

export function normalizeStorefrontEnsName(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }
  const withoutProtocol = value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .split(/[/?#]/)[0] || "";
  return withoutProtocol
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "")
    .replace(/^\.+/, "");
}

export function normalizeStorefrontEnsNetwork(value: unknown): StorefrontEnsNetwork {
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (normalized === "mainnet" || normalized === "ethereum") {
    return "mainnet";
  }
  if (normalized === "base") {
    return "base";
  }
  return "sepolia";
}

export function normalizeStorefrontProxyPath(value: unknown, fallback = DEFAULT_STOREFRONT_PATH) {
  if (typeof value !== "string" || !value.trim()) {
    return fallback;
  }
  const [pathOnly] = value.trim().split(/[?#]/);
  const withSlash = pathOnly?.startsWith("/") ? pathOnly : `/${pathOnly || ""}`;
  const clean = withSlash.replace(/\/{2,}/g, "/").replace(/\/+$/, "");
  return clean || DEFAULT_STOREFRONT_PATH;
}

export function storefrontEnsHost(customer?: Pick<Customer, "storefront">) {
  if (!customer?.storefront?.ens?.enabled) {
    return "";
  }
  return normalizeStorefrontEnsName(customer.storefront.ens.name);
}

export function requestHostFromHeaders(headers: Pick<Headers, "get">, fallback = "") {
  return normalizeStorefrontEnsName(
    headers.get("x-forwarded-host") ||
    headers.get("host") ||
    fallback
  );
}

export function findStorefrontByEnsHost<T extends Pick<Customer, "storefront">>(
  customers: T[],
  host: string
) {
  const normalizedHost = normalizeStorefrontEnsName(host);
  if (!normalizedHost) {
    return undefined;
  }
  return customers.find((customer) => storefrontEnsHost(customer) === normalizedHost);
}

export function storefrontInternalPath(
  customerId: string,
  surface: StorefrontPublicSurface = "storefront",
  options: {
    generationId?: string;
    viewMode?: "mobile" | "desktop";
  } = {}
) {
  const encodedCustomerId = encodeURIComponent(customerId);
  if (surface === "feed") {
    return `/storefronts/${encodedCustomerId}/feed`;
  }
  if (surface === "mosaic") {
    return `/storefronts/${encodedCustomerId}/mosaic`;
  }
  if (surface === "video" && options.generationId) {
    const mode = options.viewMode || "mobile";
    return `/storefronts/${encodedCustomerId}/feed/${encodeURIComponent(options.generationId)}/${mode}`;
  }
  return `/storefronts/${encodedCustomerId}`;
}

export function storefrontProxyPath(
  customer: Pick<Customer, "storefront">,
  surface: StorefrontPublicSurface = "storefront",
  options: {
    generationId?: string;
    viewMode?: "mobile" | "desktop";
  } = {}
) {
  const ens = customer.storefront?.ens;
  if (surface === "feed") {
    return normalizeStorefrontProxyPath(ens?.feedPath, DEFAULT_FEED_PATH);
  }
  if (surface === "mosaic") {
    return normalizeStorefrontProxyPath(ens?.mosaicPath, DEFAULT_MOSAIC_PATH);
  }
  if (surface === "video") {
    const base = normalizeStorefrontProxyPath(ens?.videoPath || ens?.feedPath, DEFAULT_VIDEO_PATH);
    if (!options.generationId) {
      return base;
    }
    return joinUrlPath(base, encodeURIComponent(options.generationId), options.viewMode || "mobile");
  }
  return normalizeStorefrontProxyPath(ens?.storefrontPath, DEFAULT_STOREFRONT_PATH);
}

export function storefrontPublicHref(
  customer: Pick<Customer, "id" | "storefront">,
  surface: StorefrontPublicSurface = "storefront",
  options: {
    generationId?: string;
    viewMode?: "mobile" | "desktop";
  } = {}
) {
  const host = storefrontEnsHost(customer);
  if (host) {
    return `https://${host}${storefrontProxyPath(customer, surface, options)}`;
  }
  return storefrontInternalPath(customer.id, surface, options);
}

export function storefrontFeedPageProps(customer?: Pick<Customer, "id" | "name" | "storefront">) {
  if (!customer) {
    return {};
  }
  return {
    customerId: customer.id,
    storefrontHref: storefrontPublicHref(customer, "storefront"),
    storefrontLogoUrl: customer.storefront?.logoUrl || "",
    storefrontName: customer.name,
    mosaicHref: storefrontPublicHref(customer, "mosaic")
  };
}

export function feedViewModeForAspectRatio(aspectRatio: VideoAspectRatio | string | undefined): "mobile" | "desktop" {
  return aspectRatio === "16:9" ? "desktop" : "mobile";
}

function joinUrlPath(basePath: string, ...segments: string[]) {
  const base = normalizeStorefrontProxyPath(basePath);
  const suffix = segments
    .map((segment) => String(segment || "").trim().replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
  if (!suffix) {
    return base;
  }
  return base === "/" ? `/${suffix}` : `${base}/${suffix}`;
}
