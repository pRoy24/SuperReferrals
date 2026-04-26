import { appBaseUrl, env, isProviderMock } from "./env";
import { createId, nowIso } from "./ids";
import type { ExternalCreditGrant, ExternalUserIdentity, GenerationInput } from "./types";

const MOCK_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

async function samsarRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { query?: Record<string, string | undefined> } = {}
): Promise<{ data: T; headers: Headers }> {
  const apiKey = env("SAMSAR_API_KEY");
  if (isProviderMock("SAMSAR") || !apiKey) {
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
  if (isProviderMock("SAMSAR") || !env("SAMSAR_API_KEY")) {
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

export async function grantExternalUserCredits({
  externalUser,
  credits,
  externalApiKey,
  metadata
}: {
  externalUser: ExternalUserIdentity;
  credits: number;
  externalApiKey?: string;
  metadata?: Record<string, unknown>;
}): Promise<ExternalCreditGrant> {
  const normalizedCredits = Math.max(1, Math.ceil(Number(credits) || 0));
  if (isProviderMock("SAMSAR") || !env("SAMSAR_API_KEY")) {
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
  const remainingCredits = Number(
    data.remainingCredits ||
    data.remaining_credits ||
    response.headers.get("x-credits-remaining") ||
    0
  );
  return {
    credits: normalizedCredits,
    creditsGranted,
    remainingCredits,
    status: "confirmed",
    source: "samsar_external_grant",
    raw: data
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
  if (isProviderMock("SAMSAR") || !env("SAMSAR_API_KEY")) {
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
  const response = await samsarRequest("external_users/image_list_to_video", {
    method: "POST",
    headers: safeExternalApiKey ? { "x-external-user-api-key": safeExternalApiKey } : undefined,
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
  if (isProviderMock("SAMSAR") || !env("SAMSAR_API_KEY") || requestId.startsWith("mock_samsar_")) {
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
      method: "GET",
      query: { request_id: requestId }
    });
  return response.data;
}

export async function fetchLatestVideoUrl(sessionId: string) {
  if (isProviderMock("SAMSAR") || !env("SAMSAR_API_KEY") || sessionId.startsWith("mock_samsar_")) {
    return MOCK_VIDEO_URL;
  }
  const response = await samsarRequest("video/fetch_latest_version", {
    method: "GET",
    query: { session_id: sessionId }
  });
  return String(response.data.result_url || response.data.remoteURL || "");
}

export async function runSamsarSessionAction(action: string, payload: Record<string, unknown>) {
  if (isProviderMock("SAMSAR") || !env("SAMSAR_API_KEY")) {
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
  if (action === "update_outro") {
    return (await samsarRequest("video/update_outro_image", {
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "add_outro") {
    return (await samsarRequest("video/add_outro_image", {
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "cancel_render") {
    return (await samsarRequest("video/cancel_render", {
      method: "POST",
      body: JSON.stringify({ input: payload })
    })).data;
  }
  if (action === "enhance_message") {
    return (await samsarRequest("chat/enhance", {
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "enhance_image") {
    return (await samsarRequest("image/enhance", {
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "remove_branding") {
    return (await samsarRequest("image/remove_branding", {
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "replace_branding") {
    return (await samsarRequest("image/replace_branding", {
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "create_rollup_banner") {
    return (await samsarRequest("image/create_rollup_banner", {
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "assistant_completion") {
    return (await samsarRequest("assistant/completion", {
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "generate_embeddings_from_plain_text") {
    return (await samsarRequest("chat/generate_embeddings_from_plain_text", {
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  throw new Error(`Unsupported Samsar action: ${action}`);
}

export async function createSamsarAssistantCompletion(payload: Record<string, unknown>) {
  if (isProviderMock("SAMSAR") || !env("SAMSAR_API_KEY")) {
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
