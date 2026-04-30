import type { Customer, StorefrontEnsNetwork, VideoAspectRatio } from "./types";

export type StorefrontPublicSurface = "storefront" | "feed" | "mosaic" | "video";
export type StorefrontEnsPathMatch<T> = {
  customer: T;
  surface: StorefrontPublicSurface;
  generationId?: string;
  viewMode?: "mobile" | "desktop";
};

const DEFAULT_STOREFRONT_PATH = "/";
const DEFAULT_FEED_PATH = "/feed";
const DEFAULT_MOSAIC_PATH = "/gallery";
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

export function normalizeStorefrontGalleryPath(value: unknown) {
  const normalized = normalizeStorefrontProxyPath(value, DEFAULT_MOSAIC_PATH);
  return normalized === "/mosaic" || normalized.endsWith("/mosaic")
    ? `${normalized.slice(0, -"/mosaic".length)}/gallery`
    : normalized;
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
  return findStorefrontEnsHostMatch(customers, host)?.customer;
}

export function findStorefrontEnsHostMatch<T extends Pick<Customer, "storefront">>(
  customers: T[],
  host: string
) {
  const normalizedHost = normalizeStorefrontEnsName(host);
  if (!normalizedHost) {
    return undefined;
  }
  for (const customer of customers) {
    if (storefrontEnsHost(customer) === normalizedHost) {
      return {
        customer,
        surface: "storefront" as const
      };
    }
  }
  return undefined;
}

export function resolveStorefrontEnsPathMatch<T extends Pick<Customer, "storefront">>(
  customers: T[],
  host: string,
  pathname: string
): StorefrontEnsPathMatch<T> | undefined {
  const hostMatch = findStorefrontEnsHostMatch(customers, host);
  if (!hostMatch) {
    return undefined;
  }
  const customer = hostMatch.customer;
  const normalizedPath = normalizeStorefrontProxyPath(pathname, "/");
  const basePath = storefrontBaseProxyPath(customer);
  if (!isSameOrChildPath(normalizedPath, basePath)) {
    return undefined;
  }

  const relativePath = stripBasePath(normalizedPath, basePath);
  if (relativePath === "/") {
    return { customer, surface: "storefront" };
  }

  const feedPath = storefrontRelativeProxyPath(customer, customer.storefront?.ens?.feedPath, DEFAULT_FEED_PATH);
  const mosaicPath = storefrontRelativeProxyPath(customer, normalizeStorefrontGalleryPath(customer.storefront?.ens?.mosaicPath), DEFAULT_MOSAIC_PATH);
  const videoPath = storefrontRelativeProxyPath(customer, customer.storefront?.ens?.videoPath || feedPath, DEFAULT_VIDEO_PATH);

  if (relativePath === feedPath) {
    return { customer, surface: "feed" };
  }
  if (relativePath === mosaicPath) {
    return { customer, surface: "mosaic" };
  }
  const videoParts = pathParts(stripBasePath(relativePath, videoPath));
  if (isSameOrChildPath(relativePath, videoPath) && videoParts.length >= 2) {
    const viewMode = videoParts[1] === "desktop" ? "desktop" : videoParts[1] === "mobile" ? "mobile" : undefined;
    if (viewMode) {
      return {
        customer,
        surface: "video",
        generationId: decodeURIComponent(videoParts[0] || ""),
        viewMode
      };
    }
  }
  return undefined;
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
    return `/storefronts/${encodedCustomerId}/gallery`;
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
  const basePath = storefrontBaseProxyPath(customer);
  if (surface === "feed") {
    return joinProxyPath(basePath, storefrontRelativeProxyPath(customer, ens?.feedPath, DEFAULT_FEED_PATH));
  }
  if (surface === "mosaic") {
    return joinProxyPath(basePath, storefrontRelativeProxyPath(customer, normalizeStorefrontGalleryPath(ens?.mosaicPath), DEFAULT_MOSAIC_PATH));
  }
  if (surface === "video") {
    const base = joinProxyPath(basePath, storefrontRelativeProxyPath(customer, ens?.videoPath || ens?.feedPath, DEFAULT_VIDEO_PATH));
    if (!options.generationId) {
      return base;
    }
    return joinUrlPath(base, encodeURIComponent(options.generationId), options.viewMode || "mobile");
  }
  return basePath;
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
    galleryHref: storefrontPublicHref(customer, "mosaic")
  };
}

export function feedViewModeForAspectRatio(aspectRatio: VideoAspectRatio | string | undefined): "mobile" | "desktop" {
  return aspectRatio === "16:9" ? "desktop" : "mobile";
}

function storefrontBaseProxyPath(customer: Pick<Customer, "storefront">) {
  return normalizeStorefrontProxyPath(customer.storefront?.ens?.storefrontPath, DEFAULT_STOREFRONT_PATH);
}

function storefrontRelativeProxyPath(
  customer: Pick<Customer, "storefront">,
  path: unknown,
  fallback: string
) {
  const normalized = normalizeStorefrontProxyPath(path, fallback);
  const basePath = storefrontBaseProxyPath(customer);
  return isSameOrChildPath(normalized, basePath)
    ? stripBasePath(normalized, basePath)
    : normalized;
}

function joinProxyPath(basePath: string, childPath: string) {
  const base = normalizeStorefrontProxyPath(basePath, "/");
  const child = normalizeStorefrontProxyPath(childPath, "/");
  if (child === "/") {
    return base;
  }
  if (base !== "/" && isSameOrChildPath(child, base)) {
    return child;
  }
  return joinUrlPath(base, child);
}

function isSameOrChildPath(pathname: string, basePath: string) {
  const path = normalizeStorefrontProxyPath(pathname, "/");
  const base = normalizeStorefrontProxyPath(basePath, "/");
  return path === base || (base === "/" ? path.startsWith("/") : path.startsWith(`${base}/`));
}

function stripBasePath(pathname: string, basePath: string) {
  const path = normalizeStorefrontProxyPath(pathname, "/");
  const base = normalizeStorefrontProxyPath(basePath, "/");
  if (base === "/" || path === base) {
    return base === "/" ? path : "/";
  }
  return path.startsWith(`${base}/`) ? path.slice(base.length) || "/" : path;
}

function pathParts(pathname: string) {
  return normalizeStorefrontProxyPath(pathname, "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
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
