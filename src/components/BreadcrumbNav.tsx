"use client";

import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

type BreadcrumbItem = {
  href: string;
  label: string;
};

export default function BreadcrumbNav() {
  const pathname = usePathname() || "/";
  const router = useRouter();
  const breadcrumbs = buildBreadcrumbs(pathname);

  if (pathname === "/" || breadcrumbs.length <= 1) {
    return null;
  }

  const fallbackHref = breadcrumbs[breadcrumbs.length - 2]?.href || "/";
  const isFeedRoute = pathname === "/feed" || pathname.startsWith("/feed/");

  function goBack() {
    if (typeof window === "undefined") {
      router.push(fallbackHref);
      return;
    }
    const referrer = document.referrer;
    const hasSameOriginReferrer = referrer.startsWith(window.location.origin);
    if (window.history.length > 1 && (!referrer || hasSameOriginReferrer)) {
      router.back();
      return;
    }
    router.push(fallbackHref);
  }

  return (
    <nav className={`breadcrumb-nav ${isFeedRoute ? "is-feed" : ""}`} aria-label="Breadcrumb">
      <button className="breadcrumb-back" onClick={goBack} type="button">
        <ChevronLeft size={16} /> Back
      </button>
      <ol>
        {breadcrumbs.map((item, index) => {
          const isCurrent = index === breadcrumbs.length - 1;
          return (
            <li key={`${item.href}-${index}`}>
              {index === 0 && <Home size={14} />}
              {isCurrent ? (
                <span aria-current="page">{item.label}</span>
              ) : (
                <Link href={item.href}>{item.label}</Link>
              )}
              {!isCurrent && <ChevronRight size={13} />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function buildBreadcrumbs(pathname: string): BreadcrumbItem[] {
  const path = normalizePathname(pathname);
  if (path === "/dashboard") {
    return homeCrumbs({ href: "/dashboard", label: "Console" });
  }
  if (path === "/storefronts") {
    return homeCrumbs({ href: "/storefronts", label: "Storefronts" });
  }
  if (path.startsWith("/storefronts/")) {
    return homeCrumbs(
      { href: "/storefronts", label: "Storefronts" },
      { href: path, label: "Storefront" }
    );
  }
  if (path === "/feed") {
    return homeCrumbs({ href: "/feed", label: "Feed" });
  }
  if (path.startsWith("/feed/")) {
    const segments = path.split("/").filter(Boolean);
    const mode = segments[2];
    return homeCrumbs(
      { href: "/feed", label: "Feed" },
      { href: `/feed/${segments[1]}`, label: "Video" },
      ...(mode ? [{ href: path, label: toTitleCase(mode) }] : [])
    );
  }
  if (path.startsWith("/inft/")) {
    return homeCrumbs(
      { href: "/feed", label: "Feed" },
      { href: path, label: "INFT" }
    );
  }
  if (path.startsWith("/r/")) {
    return homeCrumbs(
      { href: "/storefronts", label: "Storefronts" },
      { href: path, label: "Generate video" }
    );
  }
  if (path === "/payment_success") {
    return homeCrumbs(
      { href: "/dashboard", label: "Console" },
      { href: path, label: "Payment received" }
    );
  }
  if (path === "/payment_cancel") {
    return homeCrumbs(
      { href: "/dashboard", label: "Console" },
      { href: path, label: "Payment cancelled" }
    );
  }
  if (path === "/samsar/callback") {
    return homeCrumbs(
      { href: "/dashboard", label: "Console" },
      { href: path, label: "Account connection" }
    );
  }

  return path
    .split("/")
    .filter(Boolean)
    .reduce<BreadcrumbItem[]>((crumbs, segment, index, segments) => {
      const href = `/${segments.slice(0, index + 1).join("/")}`;
      crumbs.push({ href, label: toTitleCase(segment) });
      return crumbs;
    }, [{ href: "/", label: "Home" }]);
}

function homeCrumbs(...items: BreadcrumbItem[]) {
  return [{ href: "/", label: "Home" }, ...items];
}

function normalizePathname(pathname: string) {
  const path = pathname.split("?")[0]?.replace(/\/+$/, "") || "/";
  return path === "" ? "/" : path;
}

function toTitleCase(value: string) {
  return decodeURIComponent(value)
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
