export function env(name: string, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function isMockMode() {
  return parseMockFlag(process.env.SUPERREFERRALS_MOCKS, true);
}

export function isProviderMock(provider: string) {
  const specific = process.env[`${provider.toUpperCase()}_MOCKS`];
  if (specific !== undefined) {
    return parseMockFlag(specific, true);
  }
  return isMockMode();
}

export function appBaseUrl() {
  return env("APP_BASE_URL", "http://localhost:3000").replace(/\/$/, "");
}

export function requireLiveEnv(name: string) {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} is required when SUPERREFERRALS_MOCKS=false`);
  }
  return value;
}

function parseMockFlag(value: string | undefined, fallback: boolean) {
  if (value === undefined) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }
  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }
  return fallback;
}
