import { env } from "./env";

const DEFAULT_SAMSAR_API_ROOT_URL = "https://api.samsar.one";

export function samsarApiRootUrl() {
  return stripV1Path(env("SAMSAR_API_URL", DEFAULT_SAMSAR_API_ROOT_URL));
}

export function samsarApiV1Url() {
  return samsarVersionedApiUrl("v1");
}

export function samsarApiV2Url() {
  return samsarVersionedApiUrl("v2");
}

function samsarVersionedApiUrl(version: "v1" | "v2") {
  const configured = env("SAMSAR_API_URL", DEFAULT_SAMSAR_API_ROOT_URL).replace(/\/$/, "");
  return configured.endsWith(`/${version}`) ? configured : `${stripVersionPath(configured)}/${version}`;
}

function stripV1Path(value: string) {
  return stripVersionPath(value);
}

function stripVersionPath(value: string) {
  const normalized = value.replace(/\/$/, "");
  return normalized.replace(/\/v[0-9]+$/i, "");
}
