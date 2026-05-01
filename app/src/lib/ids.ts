import crypto from "node:crypto";

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
}

export function sha256Hex(input: string | Buffer | Uint8Array) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function bytes32From(input: string | Buffer | Uint8Array) {
  return `0x${sha256Hex(input)}` as `0x${string}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function shortHash(input: string) {
  return sha256Hex(input).slice(0, 10);
}

export function normalizeWallet(value?: string | null) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || "0x0000000000000000000000000000000000000000";
}

export function makeReferrerCode(seed: string) {
  return `ref-${shortHash(seed).toLowerCase()}`;
}
