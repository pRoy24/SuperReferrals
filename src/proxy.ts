import { NextRequest, NextResponse } from "next/server";
import { APP_LANGUAGE_COOKIE_NAME } from "@/lib/localization";

const ZH_PREFIX = "/zh";

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname !== ZH_PREFIX && !pathname.startsWith(`${ZH_PREFIX}/`)) {
    return NextResponse.next();
  }

  const rewriteUrl = request.nextUrl.clone();
  rewriteUrl.pathname = pathname === ZH_PREFIX ? "/" : pathname.slice(ZH_PREFIX.length) || "/";

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-superreferrals-app-language", "zh");
  requestHeaders.set("x-superreferrals-locale-prefix", "zh");

  const response = NextResponse.rewrite(rewriteUrl, {
    request: {
      headers: requestHeaders
    }
  });
  response.cookies.set(APP_LANGUAGE_COOKIE_NAME, "zh", {
    maxAge: 31536000,
    path: "/",
    sameSite: "lax"
  });
  return response;
}

export const config = {
  matcher: ["/zh", "/zh/:path*"]
};
