import SamsarClient, { SamsarRequestError } from "samsar-js";
import { appBaseUrl, isProviderMock } from "./env";
import { createId, nowIso } from "./ids";
import { samsarApiV1Url, samsarApiV2Url } from "./samsar-api";
import type {
  ExternalUserIdentity,
  GenerationInput,
  SamsarPublicationRecord,
  VideoAspectRatio,
  VideoModel
} from "./types";

const MOCK_VIDEO_URL = "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4";

type SamsarPublicationClient = {
  publishPublication(
    input: Record<string, unknown>,
    options?: { idempotencyKey?: string; externalUserApiKey?: string }
  ): Promise<{ data: Record<string, unknown> }>;
};

type SamsarSessionActionOptions = {
  apiKey?: string;
  authToken?: string;
  appKey?: string;
  appSecret?: string;
  externalApiKey?: string;
  idempotencyKey?: string;
};

type SamsarVideoActionClient = {
  createV2VideoFromImageList(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  translateV2Video(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  cloneV2Video(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  updateV2VideoOutroImage(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  updateV2VideoFooterImage(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  addV2VideoOutroImage(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  updateVideoOutroImage(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  addVideoOutroImage(input: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  getV2Status(requestId: string, options?: Record<string, unknown>): Promise<SamsarClientResult>;
  postV2(path: string, payload?: Record<string, unknown>, options?: Record<string, unknown>): Promise<SamsarClientResult>;
};

type SamsarLegacyVideoActionClient = Pick<SamsarVideoActionClient, "updateVideoOutroImage" | "addVideoOutroImage">;

type SamsarClientResult = {
  data: Record<string, unknown>;
  creditsCharged?: number;
  creditsRemaining?: number;
  headers?: Record<string, string>;
};

type SamsarCredentialOptions = Pick<SamsarSessionActionOptions, "apiKey" | "authToken" | "appKey" | "appSecret">;

function shouldMockSamsar(credential?: string | SamsarCredentialOptions) {
  if (isProviderMock("SAMSAR")) {
    return true;
  }
  if (!hasSamsarCredential(credential)) {
    throw new Error("A storefront Samsar APP_KEY or auth token is required for live Samsar requests.");
  }
  return false;
}

async function samsarRequest<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & SamsarCredentialOptions & { query?: Record<string, string | undefined> } = {}
): Promise<{ data: T; headers: Headers }> {
  const { apiKey: apiKeyOverride, authToken, appKey, appSecret, query, ...requestInit } = init;
  if (isProviderMock("SAMSAR") || !hasSamsarCredential({ apiKey: apiKeyOverride, authToken, appKey })) {
    throw new Error("Live SuperReferrals request called in mock mode");
  }
  if (appKey && !appSecret?.trim()) {
    throw new Error("A Samsar APP_SECRET is required when using APP_KEY authentication.");
  }
  const base = samsarApiV2Url();
  const url = new URL(`${base}/${path.replace(/^\//, "")}`);
  Object.entries(query || {}).forEach(([key, value]) => {
    if (value) url.searchParams.set(key, value);
  });
  const response = await fetch(url, {
    ...requestInit,
    headers: {
      "content-type": "application/json",
      authorization: appKey ? `AppKey ${appKey}` : `Bearer ${authToken || apiKeyOverride}`,
      ...(appKey ? { "x-app-secret": appSecret || "" } : {}),
      ...(requestInit.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || data?.error?.message || `SuperReferrals request failed: ${response.status}`);
  }
  return { data: data as T, headers: response.headers };
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
  authToken,
  appKey,
  appSecret,
  generationId
}: {
  externalUser?: ExternalUserIdentity;
  input: GenerationInput;
  externalApiKey?: string;
  apiKey?: string;
  authToken?: string;
  appKey?: string;
  appSecret?: string;
  generationId: string;
}) {
  const credential = { authToken, apiKey, appKey, appSecret };
  if (shouldMockSamsar(credential)) {
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
  const response = await (await samsarVideoActionClient({ authToken, apiKey, appKey, appSecret, externalApiKey })).createV2VideoFromImageList(
    input as unknown as Record<string, unknown>,
    samsarVideoActionRequestOptions({
      idempotencyKey: `superreferrals:${generationId}:image-list-to-video`,
      externalApiKey,
      externalUser
    })
  );
  const data = samsarClientActionResult(response) as Record<string, unknown>;
  const requestId = String(data.request_id || data.external_request_id || data.requestId || "");
  const sessionId = normalizeSamsarVideoSessionId(
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
    creditsCharged: Number(data.creditsCharged || 0),
    creditsRemaining: Number(data.remainingCredits || 0),
    raw: data
  };
}

export function normalizeSamsarVideoSessionId(value: unknown) {
  const candidate = typeof value === "string" ? value.trim() : "";
  if (!candidate) {
    return "";
  }
  return candidate.startsWith("extreq_") ? candidate.slice("extreq_".length) : candidate;
}

export function extractSamsarVideoSessionIdFromUrl(...values: unknown[]) {
  for (const value of values) {
    if (typeof value !== "string") {
      continue;
    }
    const candidate = value.trim();
    if (!candidate) {
      continue;
    }
    const decoded = safeDecodeURIComponent(candidate);
    const match = decoded.match(/(?:^|[/_-])video-([a-f0-9]{24})(?:[_./-]|$)/i);
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

export function normalizeSamsarActionSessionId(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function getSamsarStatus(
  requestId: string,
  externalUser?: ExternalUserIdentity,
  externalApiKey?: string,
  credential?: string | SamsarCredentialOptions
): Promise<Record<string, unknown>> {
  if (!requestId) {
    throw new Error("requestId is required");
  }
  const credentialOptions = normalizeSamsarCredentialOptions(credential);
  if (shouldMockSamsar(credentialOptions) || requestId.startsWith("mock_samsar_")) {
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
  const response = await (await samsarVideoActionClient({ ...credentialOptions, externalApiKey })).getV2Status(
    requestId,
    samsarVideoActionRequestOptions({ externalApiKey, externalUser })
  );
  return samsarClientActionResult(response);
}

export async function fetchLatestVideoUrl(sessionId: string, credential?: string | SamsarCredentialOptions) {
  const videoSessionId = normalizeSamsarVideoSessionId(sessionId);
  const credentialOptions = normalizeSamsarCredentialOptions(credential);
  if (shouldMockSamsar(credentialOptions) || videoSessionId.startsWith("mock_samsar_")) {
    return MOCK_VIDEO_URL;
  }
  const status = await getSamsarStatus(videoSessionId, undefined, undefined, credentialOptions);
  return String(status.result_url || status.remoteURL || "");
}

export async function runSamsarSessionAction(
  action: string,
  payload: Record<string, unknown>,
  options: string | SamsarSessionActionOptions = {}
) {
  const normalizedOptions = typeof options === "string" ? { apiKey: options } : options;
  if (shouldMockSamsar(normalizedOptions)) {
    return {
      request_id: createId(`mock_${action}`),
      status: "QUEUED",
      mock: true
    };
  }
  const sessionActionPayload = normalizeSamsarSessionActionPayload(payload);
  const videoClient = await samsarVideoActionClient(normalizedOptions);
  const videoOptions = samsarVideoActionRequestOptions(normalizedOptions);
  if (action === "translate") {
    return samsarClientActionResult(await videoClient.translateV2Video(
      sessionActionPayload,
      videoOptions
    ));
  }
  if (action === "join") {
    return samsarClientActionResult(await videoClient.postV2("join_videos", {
      input: sessionActionPayload,
      webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`
    }, videoOptions));
  }
  if (action === "copy_inft" || action === "clone") {
    return samsarClientActionResult(await videoClient.cloneV2Video(
      sessionActionPayload,
      videoOptions
    ));
  }
  if (action === "add_subtitles") {
    return samsarClientActionResult(await videoClient.postV2("add_subtitles", {
      input: sessionActionPayload,
      webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`
    }, videoOptions));
  }
  if (action === "remove_subtitles") {
    return samsarClientActionResult(await videoClient.postV2("remove_subtitles", {
      input: sessionActionPayload,
      webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`
    }, videoOptions));
  }
  if (action === "update_outro") {
    try {
      return samsarClientActionResult(await videoClient.updateV2VideoOutroImage(
        sessionActionPayload,
        videoOptions
      ));
    } catch (error) {
      if (!isMissingSamsarV2OutroRoute(error)) {
        throw error;
      }
      const legacyClient = await samsarLegacyVideoActionClient(normalizedOptions);
      return samsarClientActionResult(await legacyClient.updateVideoOutroImage(
        sessionActionPayload,
        videoOptions
      ));
    }
  }
  if (action === "add_outro") {
    try {
      return samsarClientActionResult(await videoClient.addV2VideoOutroImage(
        sessionActionPayload,
        videoOptions
      ));
    } catch (error) {
      if (!isMissingSamsarV2OutroRoute(error)) {
        throw error;
      }
      const legacyClient = await samsarLegacyVideoActionClient(normalizedOptions);
      return samsarClientActionResult(await legacyClient.addVideoOutroImage(
        sessionActionPayload,
        videoOptions
      ));
    }
  }
  if (action === "update_footer") {
    return samsarClientActionResult(await videoClient.updateV2VideoFooterImage(
      sessionActionPayload,
      videoOptions
    ));
  }
  if (action === "cancel_render") {
    return samsarClientActionResult(await videoClient.postV2("cancel_render", {
      input: sessionActionPayload,
      webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`
    }, videoOptions));
  }
  if (action === "enhance_message") {
    return (await samsarRequest("chat/enhance", {
      ...normalizedOptions,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "enhance_image") {
    return (await samsarRequest("image/enhance", {
      ...normalizedOptions,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "remove_branding") {
    return (await samsarRequest("image/remove_branding", {
      ...normalizedOptions,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "replace_branding") {
    return (await samsarRequest("image/replace_branding", {
      ...normalizedOptions,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "create_rollup_banner") {
    return (await samsarRequest("image/create_rollup_banner", {
      ...normalizedOptions,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "assistant_completion") {
    return (await samsarRequest("assistant/completion", {
      ...normalizedOptions,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  if (action === "generate_embeddings_from_plain_text") {
    return (await samsarRequest("chat/generate_embeddings_from_plain_text", {
      ...normalizedOptions,
      method: "POST",
      body: JSON.stringify(payload)
    })).data;
  }
  throw new Error(`Unsupported SuperReferrals action: ${action}`);
}

async function samsarVideoActionClient(options: SamsarSessionActionOptions): Promise<SamsarVideoActionClient> {
  const appKey = options.appKey?.trim();
  const appSecret = options.appSecret?.trim();
  if (!appKey) {
    throw new Error("A storefront Samsar APP_KEY is required for SuperReferrals video actions.");
  }
  if (!appSecret) {
    throw new Error("A Samsar APP_SECRET is required when using APP_KEY authentication.");
  }
  return new SamsarClient({
    apiKey: undefined,
    appKey,
    appSecret,
    baseUrl: samsarApiRootUrlForSdk(),
    externalUserApiKey: usableExternalApiKey(options.externalApiKey)
  }) as SamsarVideoActionClient;
}

async function samsarLegacyVideoActionClient(options: SamsarSessionActionOptions): Promise<SamsarLegacyVideoActionClient> {
  const appKey = options.appKey?.trim();
  const appSecret = options.appSecret?.trim();
  if (!appKey) {
    throw new Error("A storefront Samsar APP_KEY is required for SuperReferrals video actions.");
  }
  if (!appSecret) {
    throw new Error("A Samsar APP_SECRET is required when using APP_KEY authentication.");
  }
  return new SamsarClient({
    apiKey: undefined,
    appKey,
    appSecret,
    baseUrl: samsarApiV1Url(),
    externalUserApiKey: usableExternalApiKey(options.externalApiKey)
  }) as SamsarLegacyVideoActionClient;
}

function samsarVideoActionRequestOptions(options: SamsarSessionActionOptions & { externalUser?: ExternalUserIdentity }) {
  return {
    webhookUrl: `${appBaseUrl()}/api/webhooks/samsar`,
    idempotencyKey: options.idempotencyKey,
    externalUserApiKey: usableExternalApiKey(options.externalApiKey),
    externalUser: options.externalUser
  };
}

function isMissingSamsarV2OutroRoute(error: unknown) {
  if (error instanceof SamsarRequestError) {
    return error.status === 404 && /\/v2\/(?:update_outro_image|add_outro_image)/i.test(error.url || "");
  }
  if (error && typeof error === "object") {
    const record = error as { status?: unknown; url?: unknown; message?: unknown };
    if (Number(record.status) === 404 && /\/v2\/(?:update_outro_image|add_outro_image)/i.test(String(record.url || ""))) {
      return true;
    }
    const message = String(record.message || "");
    return /\/v2\/(?:update_outro_image|add_outro_image)/i.test(message) && /404|not found/i.test(message);
  }
  return false;
}

function samsarClientActionResult(response: SamsarClientResult): Record<string, unknown> {
  const data = response.data || {};
  return {
    ...data,
    creditsCharged:
      response.creditsCharged ??
      extractNumber(response.headers?.["x-credits-charged"]) ??
      extractNumber(data.creditsCharged) ??
      extractNumber(data.credits_charged),
    remainingCredits:
      response.creditsRemaining ??
      extractNumber(response.headers?.["x-credits-remaining"]) ??
      extractNumber(data.remainingCredits) ??
      extractNumber(data.remaining_credits) ??
      extractNumber(data.creditsRemaining)
  };
}

function normalizeSamsarSessionActionPayload(payload: Record<string, unknown>) {
  const normalized = { ...payload };
  for (const key of ["videoSessionId", "video_session_id", "sessionId", "session_id", "sessionID"]) {
    const sessionId = normalizeSamsarActionSessionId(normalized[key]);
    if (sessionId) {
      normalized[key] = sessionId;
    }
  }

  const sessionIds = normalized.session_ids || normalized.sessionIds;
  if (Array.isArray(sessionIds)) {
    const normalizedSessionIds = sessionIds
      .map((sessionId) => normalizeSamsarActionSessionId(sessionId))
      .filter(Boolean);
    if (normalized.session_ids) {
      normalized.session_ids = normalizedSessionIds;
    }
    if (normalized.sessionIds) {
      normalized.sessionIds = normalizedSessionIds;
    }
  }
  return normalized;
}

export async function publishSamsarSessionPublication(input: {
  sessionId: string;
  title?: string;
  description?: string;
  tags?: string[];
  creatorHandle?: string;
  aspectRatio?: VideoAspectRatio;
  videoModel?: VideoModel;
  prompt?: string;
  language?: string;
  apiKey?: string;
  appKey?: string;
  appSecret?: string;
  externalApiKey?: string;
  idempotencyKey?: string;
}): Promise<SamsarPublicationRecord> {
  const sessionId = normalizeSamsarVideoSessionId(input.sessionId);
  if (!sessionId) {
    throw new Error("sessionId is required to publish a Samsar publication");
  }

  const credential = input.appKey?.trim();
  if (isProviderMock("SAMSAR") || sessionId.startsWith("mock_samsar_")) {
    return {
      status: "mock_published",
      sessionId,
      publicationId: createId("mock_pub"),
      submittedAt: nowIso()
    };
  }
  if (!credential) {
    throw new Error("A Samsar APP_KEY is required to publish a Samsar publication");
  }
  if (!input.appSecret?.trim()) {
    throw new Error("A Samsar APP_SECRET is required to publish a Samsar publication");
  }

  const client = await samsarPublicationClient({
    apiKey: undefined,
    appKey: input.appKey,
    appSecret: input.appSecret,
    externalApiKey: input.externalApiKey
  });
  const response = await client.publishPublication(
    {
      session_id: sessionId,
      title: input.title,
      description: input.description,
      tags: input.tags,
      creator_handle: input.creatorHandle,
      aspect_ratio: input.aspectRatio,
      video_model: input.videoModel,
      original_prompt: input.prompt,
      session_language: input.language,
      language: input.language
    },
    {
      idempotencyKey: input.idempotencyKey || `superreferrals-publication:${sessionId}`,
      externalUserApiKey: usableExternalApiKey(input.externalApiKey)
    }
  );
  const data = response.data || {};
  return {
    status: "published",
    sessionId: publicationSessionId(data) || sessionId,
    publicationId: publicationId(data) || undefined,
    submittedAt: nowIso()
  };
}

async function samsarPublicationClient(options: SamsarCredentialOptions & { externalApiKey?: string }) {
  return new SamsarClient({
    apiKey: options.appKey ? undefined : options.apiKey,
    appKey: options.appKey,
    appSecret: options.appSecret,
    baseUrl: samsarApiRootUrlForSdk(),
    externalUserApiKey: usableExternalApiKey(options.externalApiKey)
  }) as SamsarPublicationClient;
}

function samsarApiRootUrlForSdk() {
  return samsarApiV2Url().replace(/\/v2$/i, "");
}

function usableExternalApiKey(value?: string) {
  const clean = value?.trim();
  return clean && !clean.startsWith("mock_") ? clean : undefined;
}

function normalizeSamsarCredentialOptions(credential?: string | SamsarCredentialOptions): SamsarCredentialOptions {
  return typeof credential === "string" ? { apiKey: credential } : credential || {};
}

function hasSamsarCredential(credential?: string | SamsarCredentialOptions) {
  if (typeof credential === "string") {
    return Boolean(credential.trim());
  }
  return Boolean(credential?.appKey?.trim() || credential?.authToken?.trim() || credential?.apiKey?.trim());
}

function publicationId(data: Record<string, unknown>) {
  const publication = recordValue(data.publication);
  return firstStringValue(
    data.publication_id,
    data.publicationId,
    data.id,
    publication.publication_id,
    publication.publicationId,
    publication.id
  );
}

function publicationSessionId(data: Record<string, unknown>) {
  const publication = recordValue(data.publication);
  const session = recordValue(data.session);
  return normalizeSamsarVideoSessionId(firstStringValue(
    data.session_id,
    data.sessionId,
    publication.session_id,
    publication.sessionId,
    session.session_id,
    session.sessionId
  ));
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstStringValue(...values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
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
