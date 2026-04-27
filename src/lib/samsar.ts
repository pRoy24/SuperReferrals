import { appBaseUrl, env, isProviderMock } from "./env";
import { createId, nowIso } from "./ids";
import { samsarApiV1Url } from "./samsar-api";
import type { ExternalCreditGrant, ExternalUserIdentity, GenerationInput } from "./types";

const MOCK_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

function shouldMockSamsar(apiKeyOverride?: string) {
  if (isProviderMock("SAMSAR")) {
    return true;
  }
  if (!apiKeyOverride && !env("SAMSAR_API_KEY")) {
    throw new Error("SAMSAR_API_KEY is required when SAMSAR_MOCKS=false");
  }
  return false;
}

async function samsarRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { apiKey?: string; query?: Record<string, string | undefined> } = {}
): Promise<{ data: T; headers: Headers }> {
  const { apiKey: apiKeyOverride, query, ...requestInit } = init;
  const apiKey = apiKeyOverride || env("SAMSAR_API_KEY");
  if (isProviderMock("SAMSAR") || !apiKey) {
    throw new Error("Live SuperReferrals request called in mock mode");
  }
  const base = samsarApiV1Url();
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    ...requestInit,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(requestInit.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || `SuperReferrals request failed: ${response.status}`);
  }
  return { data: data as T, headers: response.headers };
}

export async function ensureExternalUserSession(externalUser: ExternalUserIdentity, apiKey?: string) {
  if (shouldMockSamsar(apiKey)) {
    return {
      externalApiKey: `mock_external_${externalUser.external_user_id}`,
      creditsRemaining: 5000,
      raw: { mock: true }
    };
  }
  const response = await samsarRequest("external_users/session", {
    apiKey,
    method: "POST",
    body: JSON.stringify({ external_user: externalUser })
  });
  return {
    externalApiKey: String(response.data.external_api_key || response.data.externalApiKey || ""),
    creditsRemaining: Number(response.data.remainingCredits || response.data.credits_remaining || 0),
    raw: response.data
  };
}

export async function grantExternalUserCredits({
  externalUser,
  credits,
  externalApiKey,
  apiKey,
  metadata
}: {
  externalUser: ExternalUserIdentity;
  credits: number;
  externalApiKey?: string;
  apiKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<ExternalCreditGrant> {
  const normalizedCredits = Math.max(1, Math.ceil(Number(credits) || 0));
  if (shouldMockSamsar(apiKey)) {
    return {
      credits: normalizedCredits,
      creditsGranted: normalizedCredits,
      remainingCredits: 5000,
      status: "mock_confirmed",
      source: "samsar_external_grant",
      raw: {
        mock: true,
        external_user: externalUser,
        metadata
      }
    };
  }

  const safeExternalApiKey =
    externalApiKey && !externalApiKey.startsWith("mock_") ? externalApiKey : undefined;
  const response = await samsarRequest("external_users/credits/grant", {
    apiKey,
    method: "POST",
    headers: safeExternalApiKey ? { "x-external-user-api-key": safeExternalApiKey } : undefined,
    body: JSON.stringify({
      external_user: externalUser,
      credits: normalizedCredits,
      metadata
    })
  });
  const data = response.data as Record<string, unknown>;
  const creditsGranted = Number(data.creditsGranted || data.credits_granted || normalizedCredits);
  const remainingCredits =
    extractExternalUserRemainingCredits(data) ??
    extractNumber(data.remainingCredits) ??
    extractNumber(data.remaining_credits) ??
    extractNumber(response.headers.get("x-credits-remaining")) ??
    0;
  return {
    credits: normalizedCredits,
    creditsGranted,
    remainingCredits,
    status: "confirmed",
    source: "samsar_external_grant",
    raw: data
  };
}

function extractExternalUserRemainingCredits(data: Record<string, unknown>) {
  const externalUser = data.externalUser || data.external_user;
  if (!externalUser || typeof externalUser !== "object" || Array.isArray(externalUser)) {
    return null;
  }

  const record = externalUser as Record<string, unknown>;
  return (
    extractNumber(record.generation_credits) ??
    extractNumber(record.generationCredits) ??
    extractNumber(record.creditsRemaining) ??
    extractNumber(record.remainingCredits) ??
    extractNumber(record.remaining_credits)
  );
}

function extractNumber(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export async function createExternalImageListVideo({
  externalUser,
  input,
  externalApiKey,
  apiKey,
  generationId
}: {
  externalUser?: ExternalUserIdentity;
  input: GenerationInput;
  externalApiKey?: string;
  apiKey?: string;
  generationId: string;
}) {
  if (shouldMockSamsar(apiKey)) {
    const requestId = `mock_samsar_${generationId}`;
    return {
      requestId,
      sessionId: requestId,
      creditsCharged: Math.max(25, input.image_urls.length * 25),
      creditsRemaining: 5000,
      raw: {
        mock: true,
        request_id: requestId,
        session_id: requestId,
        status_endpoint: `${appBaseUrl()}/api/generations/${generationId}/sync`
      }
    };
  }
  const safeExternalApiKey =
    externalApiKey && !externalApiKey.startsWith("mock_") ? externalApiKey : undefined;
  const response = externalUser
    ? await samsarRequest("external_users/image_list_to_video", {
      apiKey,
      method: "POST",
      headers: safeExternalApiKey ? { "x-external-user-api-key": safeExternalApiKey } : undefined,
      body: JSON.stringify({
        external_user: externalUser,
        input,
        webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`
      })
    })
    : await samsarRequest("video/image_list_to_video", {
      apiKey,
      method: "POST",
      body: JSON.stringify({
        input,
        webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`
      })
    });
  const data = response.data;
  const requestId = String(data.request_id || data.external_request_id || data.requestId || "");
  const sessionId = String(
    data.upstream_session_id ||
    data.upstreamSessionId ||
    data.upstream_request_id ||
    data.upstreamRequestId ||
    data.session_id ||
    data.sessionID ||
    requestId
  );
  return {
    requestId,
    sessionId,
    creditsCharged: Number(response.headers.get("x-credits-charged") || data.creditsCharged || 0),
    creditsRemaining: Number(response.headers.get("x-credits-remaining") || data.remainingCredits || 0),
    raw: data
  };
}

export async function getSamsarStatus(requestId: string, externalUser?: ExternalUserIdentity, externalApiKey?: string, apiKey?: string) {
  if (!requestId) {
    throw new Error("requestId is required");
  }
  if (shouldMockSamsar(apiKey) || requestId.startsWith("mock_samsar_")) {
    return {
      request_id: requestId,
      session_id: requestId,
      status: "COMPLETED",
      type: "video",
      result_url: MOCK_VIDEO_URL,
      result_urls: [MOCK_VIDEO_URL],
      updated_at: nowIso()
    };
  }
  const safeExternalApiKey =
    externalApiKey && !externalApiKey.startsWith("mock_") ? externalApiKey : undefined;
  const response = externalUser
    ? await samsarRequest("external_users/status", {
      apiKey,
      method: "GET",
      headers: safeExternalApiKey ? { "x-external-user-api-key": safeExternalApiKey } : undefined,
      query: {
        request_id: requestId,
        provider: externalUser.provider,
        external_user_id: externalUser.external_user_id,
        external_app_id: externalUser.external_app_id
      }
    })
    : await samsarRequest("status", {
      apiKey,
      method: "GET",
      query: { request_id: requestId }
    });
  return response.data;
}

export async function fetchLatestVideoUrl(sessionId: string, apiKey?: string) {
  if (shouldMockSamsar(apiKey) || sessionId.startsWith("mock_samsar_")) {
    return MOCK_VIDEO_URL;
  }
  const response = await samsarRequest("video/fetch_latest_version", {
    apiKey,
    method: "GET",
    query: { session_id: sessionId }
  });
  return String(response.data.result_url || response.data.remoteURL || "");
}

export async function runSamsarSessionAction(action: string, payload: Record<string, unknown>, apiKey?: string) {
  if (shouldMockSamsar(apiKey)) {
    return {
      request_id: createId(`mock_${action}`),
      status: "QUEUED",
      mock: true
    };
  }
  if (action === "translate") {
    return (await samsarRequest("video/translate_video", {
      apiKey,
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "join") {
    return (await samsarRequest("video/join_videos", {
      apiKey,
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "remove_subtitles") {
    return (await samsarRequest("video/remove_subtitles", {
      apiKey,
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "update_outro") {
    return (await samsarRequest("video/update_outro_image", {
      apiKey,
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "add_outro") {
    return (await samsarRequest("video/add_outro_image", {
      apiKey,
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "cancel_render") {
    return (await samsarRequest("video/cancel_render", {
      apiKey,
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "enhance_message") {
    return (await samsarRequest("chat/enhance", {
      apiKey,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "enhance_image") {
    return (await samsarRequest("image/enhance", {
      apiKey,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "remove_branding") {
    return (await samsarRequest("image/remove_branding", {
      apiKey,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "replace_branding") {
    return (await samsarRequest("image/replace_branding", {
      apiKey,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "create_rollup_banner") {
    return (await samsarRequest("image/create_rollup_banner", {
      apiKey,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "assistant_completion") {
    return (await samsarRequest("assistant/completion", {
      apiKey,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "generate_embeddings_from_plain_text") {
    return (await samsarRequest("chat/generate_embeddings_from_plain_text", {
      apiKey,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  throw new Error(`Unsupported SuperReferrals action: ${action}`);
}

export async function createSamsarAssistantCompletion(payload: Record<string, unknown>) {
  if (shouldMockSamsar()) {
    return {
      output_text:
        "This INFT can create derivative sessions, retranslate the video, join with another session, update or add an outro image, send AXL peer messages, and inspect its 0G storage and referrer metadata.",
      mock: true
    };
  }
  return (await samsarRequest("assistant/completion", {
    method: "POST",
    body: JSON.stringify(payload)
  })).data;
}
