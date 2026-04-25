export function env(name: string, fallback = "") {
  const value = process.env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export function isMockMode() {
  if (process.env.SUPERREFERRER_MOCKS === "false") {
    return false;
  }
  return true;
}

export function appBaseUrl() {
  return env("APP_BASE_URL", "http://localhost:3000").replace(/\/$/, "");
}

export function requireLiveEnv(name: string) {
  const value = env(name);
  if (!value) {
    throw new Error(`${name} is required when SUPERREFERRER_MOCKS=false`);
  }
  return value;
}
