import { NextResponse } from "next/server";
import { processorAuthTokenFromRequest, readProcessorAccountSessionCookie } from "@/lib/account-session";
import { shortHash } from "@/lib/ids";
import {
  clearPageAssistantThread,
  getPageAssistantThread,
  normalizePagePath,
  submitPageAssistantMessage,
  type PageAssistantUser
} from "@/lib/page-assistant";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const pagePath = normalizePagePath(url.searchParams.get("pagePath") || "/");
    const user = resolvePageAssistantUser(request);
    const thread = await getPageAssistantThread(user, pagePath);
    return NextResponse.json({ thread, user: { label: user.label } });
  } catch (error) {
    return assistantError(error, "Unable to load assistant thread");
  }
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const user = resolvePageAssistantUser(request, body);
    const result = await submitPageAssistantMessage({
      user,
      pagePath: normalizePagePath(String(body.pagePath || "/")),
      message: String(body.message || body.question || "")
    });
    return NextResponse.json(result);
  } catch (error) {
    return assistantError(error, "Assistant request failed");
  }
}

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const body = await readJson(request);
    const pagePath = normalizePagePath(String(body.pagePath || url.searchParams.get("pagePath") || "/"));
    const user = resolvePageAssistantUser(request, body);
    await clearPageAssistantThread(user, pagePath);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return assistantError(error, "Unable to clear assistant thread");
  }
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const data = await request.json();
    return data && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function resolvePageAssistantUser(request: Request, body: Record<string, unknown> = {}): PageAssistantUser {
  const session = readProcessorAccountSessionCookie(request.headers.get("cookie"));
  if (session?.customerId) {
    const accountLabel = session.email || session.username || session.userId || session.customerName || session.customerId;
    return {
      userKey: `account:${session.customerId}:${accountLabel}`,
      label: accountLabel
    };
  }

  const authToken = processorAuthTokenFromRequest(request);
  if (authToken) {
    return {
      userKey: `auth:${shortHash(authToken)}`,
      label: "authenticated user"
    };
  }

  const requestedUserId =
    stringValue(body.userId) ||
    request.headers.get("x-superreferrals-assistant-user") ||
    request.headers.get("x-assistant-user") ||
    "";
  const cleanUserId = sanitizeUserKey(requestedUserId);
  if (cleanUserId) {
    return {
      userKey: `browser:${cleanUserId}`,
      label: "browser user"
    };
  }

  const fallbackSeed = [
    request.headers.get("user-agent") || "unknown-agent",
    request.headers.get("accept-language") || "unknown-language"
  ].join(":");
  return {
    userKey: `anonymous:${shortHash(fallbackSeed)}`,
    label: "anonymous user"
  };
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function sanitizeUserKey(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9:_-]+/g, "")
    .slice(0, 96);
}

function assistantError(error: unknown, fallback: string) {
  return NextResponse.json(
    { message: error instanceof Error ? error.message : fallback },
    { status: 400 }
  );
}
