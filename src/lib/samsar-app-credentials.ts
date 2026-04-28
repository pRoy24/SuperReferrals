import crypto from "node:crypto";
import { env } from "./env";
import type { Customer } from "./types";

const MIN_APP_SECRET_LENGTH = 32;

export type StoredSamsarAppKeyCredential = {
  appKeyHash: string;
  appKeyEncrypted: string;
  appKeyPrefix?: string;
  appKeyLast4?: string;
  appKeyCreatedAt?: string;
  appKeyUpdatedAt?: string;
  appKeyExpiresAt?: string;
};

export function requireSamsarAppSecret() {
  const secret = env("SAMSAR_APP_SECRET");
  if (secret.length < MIN_APP_SECRET_LENGTH) {
    throw new Error("SAMSAR_APP_SECRET must be at least 32 characters to generate Samsar app keys.");
  }
  return secret;
}

export function hasStoredSamsarAppKey(customer?: Pick<Customer, "samsarAccount">) {
  return Boolean(customer?.samsarAccount?.appKeyHash && customer.samsarAccount.appKeyEncrypted);
}

export function secureSamsarAppKey(
  appKey: string,
  metadata: Omit<StoredSamsarAppKeyCredential, "appKeyHash" | "appKeyEncrypted"> = {}
): StoredSamsarAppKeyCredential {
  const cleanAppKey = appKey.trim();
  if (!cleanAppKey) {
    throw new Error("Samsar APP_KEY was empty.");
  }
  const appSecret = requireSamsarAppSecret();
  return {
    appKeyHash: hashSamsarAppKey(cleanAppKey, appSecret),
    appKeyEncrypted: encryptSamsarAppKey(cleanAppKey, appSecret),
    appKeyPrefix: metadata.appKeyPrefix,
    appKeyLast4: metadata.appKeyLast4 || cleanAppKey.slice(-4),
    appKeyCreatedAt: metadata.appKeyCreatedAt,
    appKeyUpdatedAt: metadata.appKeyUpdatedAt,
    appKeyExpiresAt: metadata.appKeyExpiresAt
  };
}

export function decryptStoredSamsarAppKey(customer: Pick<Customer, "samsarAccount">) {
  const encrypted = customer.samsarAccount?.appKeyEncrypted;
  if (!encrypted) {
    return "";
  }
  const appSecret = requireSamsarAppSecret();
  const appKey = decryptSamsarAppKey(encrypted, appSecret);
  const expectedHash = customer.samsarAccount?.appKeyHash;
  if (expectedHash && !timingSafeEqual(expectedHash, hashSamsarAppKey(appKey, appSecret))) {
    throw new Error("Stored Samsar APP_KEY hash verification failed.");
  }
  return appKey;
}

export function samsarAppClientCredentials(customer: Pick<Customer, "samsarAccount">) {
  const appKey = decryptStoredSamsarAppKey(customer);
  if (!appKey) {
    return {};
  }
  return {
    appKey,
    appSecret: requireSamsarAppSecret()
  };
}

function hashSamsarAppKey(appKey: string, appSecret: string) {
  return crypto.createHmac("sha256", appSecret).update(appKey).digest("base64url");
}

function encryptSamsarAppKey(appKey: string, appSecret: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(appSecret), iv);
  const encrypted = Buffer.concat([
    cipher.update(appKey, "utf8"),
    cipher.final()
  ]);
  return [
    "v1",
    iv.toString("base64url"),
    encrypted.toString("base64url"),
    cipher.getAuthTag().toString("base64url")
  ].join(".");
}

function decryptSamsarAppKey(value: string, appSecret: string) {
  const [version, iv, encrypted, authTag] = value.split(".");
  if (version !== "v1" || !iv || !encrypted || !authTag) {
    throw new Error("Unsupported Samsar APP_KEY encryption format.");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(appSecret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final()
  ]);
  return decrypted.toString("utf8");
}

function encryptionKey(appSecret: string) {
  return crypto.createHash("sha256").update(`superreferrals:samsar-app-key:${appSecret}`).digest();
}

function timingSafeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
