import { env } from "./env";

const DEFAULT_SAMSAR_API_ROOT_URL = "https://api.samsar.one";

export function samsarApiRootUrl() {
  return stripV1Path(env("SAMSAR_API_URL", DEFAULT_SAMSAR_API_ROOT_URL));
}

export function samsarApiV1Url() {
  const configured = env("SAMSAR_API_URL", DEFAULT_SAMSAR_API_ROOT_URL).replace(/\/$/, "");
  return configured.endsWith("/v1") ? configured : `${stripV1Path(configured)}/v1`;
}

function stripV1Path(value: string) {
  const normalized = value.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? normalized.slice(0, -3) : normalized;
}
