import { appBaseUrl, env, isMockMode } from "./env";
import { createId, nowIso } from "./ids";
import type { ExternalUserIdentity, GenerationInput } from "./types";

const MOCK_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

async function samsarRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {}
): Promise<{ data: T; headers: Headers }> {
  const apiKey = env("SAMSAR_API_KEY");
  if (isMockMode() || !apiKey) {
    throw new Error("Samsar live request called in mock mode");
  }
  const base = env("SAMSAR_BASE_URL", "https://api.samsar.one/v1").replace(/\/$/, "");
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  Object.entries(init.query || {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
      ...(init.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || `Samsar request failed: ${response.status}`);
  }
  return { data: data as T, headers: response.headers };
}

export async function ensureExternalUserSession(externalUser: ExternalUserIdentity) {
  if (isMockMode() || !env("SAMSAR_API_KEY")) {
    return {
      externalApiKey: `mock_external_${externalUser.external_user_id}`,
      creditsRemaining: 5000,
      raw: { mock: true }
    };
  }
  const response = await samsarRequest("external_users/session", {
    method: "POST",
    body: JSON.stringify({ external_user: externalUser })
  });
  return {
    externalApiKey: String(response.data.external_api_key || response.data.externalApiKey || ""),
    creditsRemaining: Number(response.data.remainingCredits || response.data.credits_remaining || 0),
    raw: response.data
  };
}

export async function createExternalImageListVideo({
  externalUser,
  input,
  externalApiKey,
  generationId
}: {
  externalUser: ExternalUserIdentity;
  input: GenerationInput;
  externalApiKey?: string;
  generationId: string;
}) {
  if (isMockMode() || !env("SAMSAR_API_KEY")) {
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
  const response = await samsarRequest("external_users/image_list_to_video", {
    method: "POST",
    headers: externalApiKey ? { "x-external-user-api-key": externalApiKey } : undefined,
    body: JSON.stringify({
      external_user: externalUser,
      input,
      webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`
    })
  });
  const data = response.data;
  const requestId = String(data.request_id || data.external_request_id || data.requestId || "");
  const sessionId = String(data.session_id || data.sessionID || data.upstream_session_id || requestId);
  return {
    requestId,
    sessionId,
    creditsCharged: Number(response.headers.get("x-credits-charged") || data.creditsCharged || 0),
    creditsRemaining: Number(response.headers.get("x-credits-remaining") || data.remainingCredits || 0),
    raw: data
  };
}

export async function getSamsarStatus(requestId: string, externalUser?: ExternalUserIdentity, externalApiKey?: string) {
  if (!requestId) {
    throw new Error("requestId is required");
  }
  if (isMockMode() || !env("SAMSAR_API_KEY") || requestId.startsWith("mock_samsar_")) {
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
  const response = externalUser
    ? await samsarRequest("external_users/status", {
      method: "GET",
      headers: externalApiKey ? { "x-external-user-api-key": externalApiKey } : undefined,
      query: {
        request_id: requestId,
        provider: externalUser.provider,
        external_user_id: externalUser.external_user_id,
        external_app_id: externalUser.external_app_id
      }
    })
    : await samsarRequest("status", {
      method: "GET",
      query: { request_id: requestId }
    });
  return response.data;
}

export async function fetchLatestVideoUrl(sessionId: string) {
  if (isMockMode() || !env("SAMSAR_API_KEY") || sessionId.startsWith("mock_samsar_")) {
    return MOCK_VIDEO_URL;
  }
  const response = await samsarRequest("video/fetch_latest_version", {
    method: "GET",
    query: { session_id: sessionId }
  });
  return String(response.data.result_url || response.data.remoteURL || "");
}

export async function runSamsarSessionAction(action: string, payload: Record<string, unknown>) {
  if (isMockMode() || !env("SAMSAR_API_KEY")) {
    return {
      request_id: createId(`mock_${action}`),
      status: "QUEUED",
      mock: true
    };
  }
  if (action === "translate") {
    return (await samsarRequest("video/translate_video", {
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "join") {
    return (await samsarRequest("video/join_videos", {
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "remove_subtitles") {
    return (await samsarRequest("video/remove_subtitles", {
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  throw new Error(`Unsupported Samsar action: ${action}`);
}

export async function createSamsarAssistantCompletion(payload: Record<string, unknown>) {
  if (isMockMode() || !env("SAMSAR_API_KEY")) {
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
