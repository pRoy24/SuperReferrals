import { appBaseUrl, env } from "./env";
import { createId, nowIso } from "./ids";
import { redisCommand } from "./store";

export const MAX_TEMP_IMAGE_UPLOAD_BYTES = 4 * 1024 * 1024;
const DEFAULT_TEMP_IMAGE_TTL_SECONDS = 60 * 60 * 24;
const TEMP_IMAGE_KEY_PREFIX = "superreferrals:temp-images";

const allowedImageTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
]);

type TempImageUploadDocument = {
  id: string;
  fileName: string;
  contentType: string;
  base64: string;
  sizeBytes: number;
  createdAt: string;
  expiresAt: string;
};

export type TempImageUploadResult = {
  id: string;
  url: string;
  contentType: string;
  fileName: string;
  sizeBytes: number;
  expiresAt: string;
};

export type StoredTempImageUpload = {
  id: string;
  fileName: string;
  contentType: string;
  bytes: Buffer;
  sizeBytes: number;
  expiresAt: string;
};

export async function createTempImageUpload(input: {
  bytes: Buffer;
  contentType: string;
  fileName?: string;
  baseUrl?: string;
  ttlSeconds?: number | null;
}): Promise<TempImageUploadResult> {
  const contentType = normalizeImageContentType(input.contentType);
  if (!contentType) {
    throw new Error("Upload a JPEG, PNG, or WebP image.");
  }
  if (input.bytes.length === 0) {
    throw new Error("Uploaded image was empty.");
  }
  if (input.bytes.length > MAX_TEMP_IMAGE_UPLOAD_BYTES) {
    throw new Error(`Uploaded image must be ${formatMegabytes(MAX_TEMP_IMAGE_UPLOAD_BYTES)} MB or smaller.`);
  }
  assertImageSignature(input.bytes, contentType);

  const ttlSeconds = normalizeUploadTtlSeconds(input.ttlSeconds);
  const id = createId("img");
  const now = new Date();
  const expiresAt = ttlSeconds
    ? new Date(now.getTime() + ttlSeconds * 1000).toISOString()
    : "";
  const extension = allowedImageTypes.get(contentType) || "img";
  const fileName = sanitizeFileName(input.fileName, `upload.${extension}`);
  const document: TempImageUploadDocument = {
    id,
    fileName,
    contentType,
    base64: input.bytes.toString("base64"),
    sizeBytes: input.bytes.length,
    createdAt: nowIso(),
    expiresAt
  };
  const command = ttlSeconds
    ? ["SET", tempImageKey(id), JSON.stringify(document), "EX", String(ttlSeconds)]
    : ["SET", tempImageKey(id), JSON.stringify(document)];
  await redisCommand<string>(command);
  return {
    id,
    url: `${normalizeBaseUrl(input.baseUrl)}/api/uploads/images/${id}`,
    contentType,
    fileName,
    sizeBytes: input.bytes.length,
    expiresAt
  };
}

export async function getTempImageUpload(id: string): Promise<StoredTempImageUpload | undefined> {
  const normalizedId = normalizeTempImageId(id);
  if (!normalizedId) {
    return undefined;
  }
  const raw = await redisCommand<unknown>(["GET", tempImageKey(normalizedId)]);
  if (!raw) {
    return undefined;
  }
  const document = parseTempImageUploadDocument(raw);
  if (!document) {
    return undefined;
  }
  return {
    id: document.id,
    fileName: document.fileName,
    contentType: document.contentType,
    bytes: Buffer.from(document.base64, "base64"),
    sizeBytes: document.sizeBytes,
    expiresAt: document.expiresAt
  };
}

function normalizeImageContentType(value: string) {
  const contentType = value.split(";")[0]?.trim().toLowerCase() || "";
  return allowedImageTypes.has(contentType) ? contentType : "";
}

function assertImageSignature(bytes: Buffer, contentType: string) {
  const isJpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isWebp =
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WEBP";
  if (
    (contentType === "image/jpeg" && isJpeg) ||
    (contentType === "image/png" && isPng) ||
    (contentType === "image/webp" && isWebp)
  ) {
    return;
  }
  throw new Error("Uploaded file content does not match a supported image type.");
}

function parseTempImageUploadDocument(raw: unknown): TempImageUploadDocument | undefined {
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return undefined;
    }
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.fileName !== "string" ||
      typeof record.contentType !== "string" ||
      typeof record.base64 !== "string" ||
      typeof record.sizeBytes !== "number" ||
      typeof record.expiresAt !== "string"
    ) {
      return undefined;
    }
    if (!normalizeImageContentType(record.contentType)) {
      return undefined;
    }
    return record as TempImageUploadDocument;
  } catch {
    return undefined;
  }
}

function tempImageKey(id: string) {
  return `${env("SUPERREFERRALS_REDIS_KEY_PREFIX", TEMP_IMAGE_KEY_PREFIX).replace(/:+$/, "")}:${storeEnvironmentSlug()}:${id}`;
}

function storeEnvironmentSlug() {
  const raw = env("DEPLOYMENT_ENV") || env("VERCEL_ENV") || process.env.NODE_ENV || "local";
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "local";
}

function tempImageTtlSeconds() {
  const value = Number(env("SUPERREFERRALS_TEMP_IMAGE_TTL_SECONDS"));
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TEMP_IMAGE_TTL_SECONDS;
}

function normalizeUploadTtlSeconds(value: number | null | undefined) {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  return tempImageTtlSeconds();
}

function normalizeBaseUrl(baseUrl?: string) {
  return (baseUrl || appBaseUrl()).replace(/\/+$/, "");
}

function normalizeTempImageId(value: string) {
  const id = value.trim();
  return /^img_[a-f0-9]{18}$/i.test(id) ? id : "";
}

function sanitizeFileName(fileName: string | undefined, fallback: string) {
  const cleaned = String(fileName || "")
    .trim()
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return cleaned || fallback;
}

function formatMegabytes(bytes: number) {
  return Math.floor(bytes / (1024 * 1024));
}
