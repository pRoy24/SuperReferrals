#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(repoRoot, "deploy.json");
const DEFAULT_REDIS_PLAN = "free";
const REDIS_ENV_KEYS = [
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
  "KV_REST_API_READ_ONLY_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_READ_ONLY_TOKEN"
];
const REDIS_ENV_KEY_PAIRS = [
  ["KV_REST_API_URL", "KV_REST_API_TOKEN"],
  ["UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]
];

main();

function main() {
  const { targetName, options } = parseArgs(process.argv.slice(2));
  const config = readJson(options.config || defaultConfigPath);
  const target = resolveTarget(config, targetName, options);
  const scope = options.scope || process.env.VERCEL_SCOPE || process.env.VERCEL_TEAM || config.vercel?.defaultScope || "";
  const project = options.project || process.env.VERCEL_PROJECT || config.vercel?.defaultProject || "";
  const blobConfig = {
    enabled: config.vercel?.blob?.enabled !== false,
    storeName: options.storeName || config.vercel?.blob?.storeName || "superreferrals-private",
    access: options.access || config.vercel?.blob?.access || "private",
    region: options.region || config.vercel?.blob?.region || "iad1"
  };
  const redisConfig = {
    integration: options.redisIntegration || config.vercel?.redis?.integration || "upstash/upstash-kv",
    resourceName: options.redisName || config.vercel?.redis?.resourceName || "superreferrals-redis",
    plan: options.redisPlan || config.vercel?.redis?.plan || DEFAULT_REDIS_PLAN,
    primaryRegion: options.redisRegion || config.vercel?.redis?.primaryRegion || "iad1",
    eviction: booleanString(config.vercel?.redis?.eviction, "false"),
    prodPack: booleanString(config.vercel?.redis?.prodPack, "false"),
    autoUpgrade: booleanString(config.vercel?.redis?.autoUpgrade, "false")
  };
  const token = readToken();

  printHeader({ targetName, target, scope, project, blobConfig, redisConfig, dryRun: options.dryRun });
  if (options.skipEnvValidation) {
    console.log("0G required env: skipped by flag.");
  } else {
    validateEnvFile(target, config.zeroG || {});
  }

  if (!options.skipVercel) {
    ensureVercelCliAuth({ token, options });
    ensureVercelProjectLinked({ scope, project, token, options });
    if (!options.skipRedis) {
      const targetEnvKeys = listTargetEnvKeys({ target, token, options });
      const redisPair = existingRedisEnvPair(targetEnvKeys);
      if (redisPair) {
        console.log(`Upstash Redis: existing ${redisPair.join("/")} found in target Vercel env; reusing it and skipping provisioning.`);
      } else if (target.redisFromTarget) {
        reuseRedisEnvFromTarget({ config, sourceTargetName: target.redisFromTarget, target, targetEnvKeys, token, options });
      } else {
        ensureUpstashRedis({ redisConfig, target, scope, token, options });
      }
    }
    if (blobConfig.enabled && !options.skipBlob) {
      ensurePrivateBlobStore({ blobConfig, target, scope, token, options });
    } else if (!blobConfig.enabled && !options.skipBlob) {
      console.log("Vercel Blob: disabled in deploy.json; using Redis + 0G storage.");
    }
    if (!options.skipEnvSync) {
      runEnvSync({ targetName, target, scope, project, token, options });
    }
  }

  printNextSteps({
    targetName,
    target,
    blobConfig,
    redisConfig,
    skippedVercel: options.skipVercel,
    skippedEnvValidation: options.skipEnvValidation
  });
}

function parseArgs(args) {
  const options = {
    config: "",
    scope: "",
    project: "",
    storeName: "",
    region: "",
    access: "",
    dryRun: false,
    login: true,
    skipVercel: false,
    skipBlob: false,
    skipRedis: false,
    skipEnvSync: true,
    skipEnvValidation: false,
    forceEnvSync: false,
    noOverwriteEnvSync: false,
    useGlobalToken: false,
    acceptMarketplaceTerms: true,
    redisIntegration: "",
    redisName: "",
    redisPlan: "",
    redisRegion: "",
    verbose: false
  };
  let targetName = "";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--") && !targetName) {
      targetName = arg;
      continue;
    }

    const raw = arg.startsWith("--") ? arg.slice(2) : arg;
    const equalsIndex = raw.indexOf("=");
    const name = equalsIndex >= 0 ? raw.slice(0, equalsIndex) : raw;
    const inlineValue = equalsIndex >= 0 ? raw.slice(equalsIndex + 1) : undefined;
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      if (index >= args.length) fail(`Missing value for --${name}.`);
      return args[index];
    };

    switch (name) {
      case "config":
        options.config = path.resolve(repoRoot, readValue());
        break;
      case "scope":
        options.scope = readValue();
        break;
      case "project":
        options.project = readValue();
        break;
      case "store-name":
        options.storeName = readValue();
        break;
      case "region":
        options.region = readValue();
        break;
      case "access":
        options.access = readValue();
        break;
      case "dry-run":
        options.dryRun = true;
        break;
      case "no-login":
        options.login = false;
        break;
      case "skip-vercel":
        options.skipVercel = true;
        break;
      case "skip-blob":
        options.skipBlob = true;
        break;
      case "skip-redis":
        options.skipRedis = true;
        break;
      case "skip-env-sync":
        options.skipEnvSync = true;
        break;
      case "skip-env-validation":
        options.skipEnvValidation = true;
        break;
      case "sync-env":
        options.skipEnvSync = false;
        break;
      case "force-env-sync":
        options.forceEnvSync = true;
        break;
      case "no-overwrite-env-sync":
        options.noOverwriteEnvSync = true;
        break;
      case "use-global-token":
        options.useGlobalToken = true;
        break;
      case "accept-marketplace-terms":
        options.acceptMarketplaceTerms = true;
        break;
      case "no-accept-marketplace-terms":
        options.acceptMarketplaceTerms = false;
        break;
      case "redis-integration":
        options.redisIntegration = readValue();
        break;
      case "redis-name":
        options.redisName = readValue();
        break;
      case "redis-plan":
        options.redisPlan = readValue();
        break;
      case "redis-region":
        options.redisRegion = readValue();
        break;
      case "verbose":
        options.verbose = true;
        break;
      case "help":
        usage(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  if (!targetName) usage(1);
  if (!["staging", "production"].includes(targetName)) {
    fail(`Unknown target "${targetName}". Expected staging or production.`);
  }
  return { targetName, options };
}

function readJson(filePath) {
  if (!existsSync(filePath)) {
    fail(`Missing ${path.relative(repoRoot, filePath)}.`);
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`Could not parse ${path.relative(repoRoot, filePath)}: ${error.message}`);
  }
}

function resolveTarget(config, targetName, options) {
  const target = config.targets?.[targetName];
  if (!target) {
    fail(`deploy.json is missing targets.${targetName}.`);
  }
  return {
    envFile: target.envFile || `.env.${targetName}`,
    fallbackEnvFiles: Array.isArray(target.fallbackEnvFiles) ? target.fallbackEnvFiles : [],
    environment: target.environment || (targetName === "production" ? "production" : "preview"),
    branch: target.branch || "",
    redisFromTarget: target.redisFromTarget || ""
  };
}

function readToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const tokenPath = path.resolve(repoRoot, process.env.VERCEL_TOKEN_FILE || ".vercel-token");
  if (!existsSync(tokenPath)) return "";
  return readFileSync(tokenPath, "utf8").trim();
}

function booleanString(value, fallback) {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function printHeader({ targetName, target, scope, project, blobConfig, redisConfig, dryRun }) {
  console.log(`${dryRun ? "Dry run: " : ""}SuperReferrals deploy bootstrap`);
  console.log(`target: ${targetName} -> Vercel ${target.environment}${target.branch ? ` branch ${target.branch}` : ""}`);
  console.log(`project: ${scope || "(interactive scope)"}/${project || "(interactive project)"}`);
  console.log(`env file: ${target.envFile}`);
  console.log(`redis: ${redisConfig.integration} ${redisConfig.resourceName} (${redisConfig.plan}, ${redisConfig.primaryRegion})`);
  console.log(blobConfig.enabled
    ? `blob store: ${blobConfig.storeName} (${blobConfig.access}, ${blobConfig.region})`
    : "blob store: disabled");
}

function validateEnvFile(target, zeroGConfig) {
  const envFile = target.envFile;
  const envPath = path.resolve(repoRoot, envFile);
  if (!existsSync(envPath)) {
    fail(`Missing ${envFile}. Copy the matching .example file and fill it before bootstrapping.`);
  }
  const variables = loadTargetEnvVariables(target);
  const missing = [];
  const placeholders = [];

  for (const key of zeroGConfig.required || []) {
    const value = variables.get(key);
    if (!value) {
      missing.push(key);
    } else if (isPlaceholder(value)) {
      placeholders.push(key);
    }
  }

  if (missing.length || placeholders.length) {
    const parts = [];
    if (missing.length) parts.push(`missing: ${missing.join(", ")}`);
    if (placeholders.length) parts.push(`placeholder values: ${placeholders.join(", ")}`);
    fail(`0G env is not ready in ${envFile} (${parts.join("; ")}).`);
  }

  const recommendedMissing = (zeroGConfig.recommended || []).filter((key) => !variables.get(key));
  const fallbackLabel = target.fallbackEnvFiles.length ? ` with fallbacks ${target.fallbackEnvFiles.join(", ")}` : "";
  console.log(`0G required env: ok${fallbackLabel}${recommendedMissing.length ? `; recommended missing: ${recommendedMissing.join(", ")}` : ""}`);
}

function loadTargetEnvVariables(target) {
  const primaryPath = path.resolve(repoRoot, target.envFile);
  const variables = filterUploadableEnvVariables(parseEnv(readFileSync(primaryPath, "utf8")));
  for (const fallbackEnvFile of target.fallbackEnvFiles || []) {
    const fallbackPath = path.resolve(repoRoot, fallbackEnvFile);
    if (!existsSync(fallbackPath)) {
      continue;
    }
    const fallbackVariables = filterUploadableEnvVariables(parseEnv(readFileSync(fallbackPath, "utf8")));
    for (const [key, value] of fallbackVariables) {
      const currentValue = variables.get(key);
      if (!currentValue || isPlaceholder(currentValue)) {
        variables.set(key, value);
      }
    }
  }
  return variables;
}

function filterUploadableEnvVariables(variables) {
  const filtered = new Map();
  for (const [key, value] of variables) {
    if (isVercelSystemKey(key)) {
      continue;
    }
    filtered.set(key, value);
  }
  return filtered;
}

function isVercelSystemKey(key) {
  return key === "VERCEL_TOKEN" ||
    key === "VERCEL_AUTH_TOKEN" ||
    key === "VERCEL_ACCESS_TOKEN" ||
    key === "VERCEL_OIDC_TOKEN" ||
    key === "VERCEL_SCOPE" ||
    key === "VERCEL_TEAM" ||
    key === "VERCEL_PROJECT" ||
    key === "VERCEL_PROJECT_ID" ||
    key === "VERCEL_ORG_ID" ||
    key === "VERCEL_TEAM_ID" ||
    key.startsWith("VERCEL_");
}

function parseEnv(source) {
  const variables = new Map();
  for (const line of source.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = line.indexOf("=");
    if (equalsIndex < 0) continue;
    let key = line.slice(0, equalsIndex).trim();
    if (key.startsWith("export ")) key = key.slice("export ".length).trim();
    variables.set(key, parseEnvValue(line.slice(equalsIndex + 1)));
  }
  return variables;
}

function parseEnvValue(rawValue) {
  const value = rawValue.trimStart();
  if (!value) return "";
  if (value.startsWith('"')) {
    let output = "";
    for (let index = 1; index < value.length; index += 1) {
      const char = value[index];
      if (char === '"') return output;
      if (char === "\\") {
        index += 1;
        const escaped = value[index];
        if (escaped === "n") output += "\n";
        else if (escaped === "r") output += "\r";
        else if (escaped === "t") output += "\t";
        else output += escaped ?? "";
      } else {
        output += char;
      }
    }
    return output;
  }
  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    return end >= 0 ? value.slice(1, end) : value.slice(1);
  }
  const commentIndex = value.search(/\s#/);
  return (commentIndex >= 0 ? value.slice(0, commentIndex) : value).trimEnd();
}

function isPlaceholder(value) {
  return /^replace_with_/i.test(value) || /^<.*>$/.test(value) || /paste[_-]?|todo/i.test(value);
}

function ensureVercelCliAuth({ token, options }) {
  if (options.dryRun || token || options.useGlobalToken) {
    console.log(token ? "Vercel auth: using token from env/file." : "Vercel auth: using active CLI login.");
    return;
  }
  if (hasActiveVercelCliLogin({ options })) {
    console.log("Vercel auth: using active CLI login.");
    return;
  }
  if (!options.login) {
    fail("Missing Vercel token or active login. Set VERCEL_TOKEN, put it in .vercel-token, pass --use-global-token, or omit --no-login.");
  }
  console.log("Vercel auth: starting interactive login. Complete the browser/email challenge if Vercel asks for it.");
  runVercelInteractive(["login"], { token: "", options });
}

function hasActiveVercelCliLogin({ options }) {
  const result = runVercel(["whoami"], {
    token: "",
    options,
    allowFailure: true,
    secrets: []
  });
  return result.status === 0;
}

function ensureVercelProjectLinked({ scope, project, token, options }) {
  const projectConfigPath = path.resolve(repoRoot, ".vercel/project.json");
  if (existsSync(projectConfigPath)) {
    console.log("Vercel project link: ok.");
    return;
  }
  if (options.dryRun) {
    console.log("Would link Vercel project locally.");
    return;
  }
  const args = ["link"];
  if (scope && project) {
    args.push("--yes", "--scope", scope, "--project", project);
  }
  console.log("Vercel project link: starting link flow.");
  runVercelInteractive(args, { token, options });
}

function ensurePrivateBlobStore({ blobConfig, target, scope, token, options }) {
  const args = [
    "blob",
    "create-store",
    blobConfig.storeName,
    "--access",
    blobConfig.access,
    "--region",
    blobConfig.region,
    "--environment",
    target.environment,
    "--yes",
    ...(scope ? ["--scope", scope] : [])
  ];

  if (options.dryRun) {
    console.log(`Would run: vercel ${args.join(" ")}`);
    return;
  }

  console.log("Vercel Blob: creating or verifying private store.");
  const result = runVercel(args, { token, options, allowFailure: true });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status === 0) {
    console.log("Vercel Blob store created or connected. Vercel should add BLOB_READ_WRITE_TOKEN to the linked project.");
    return;
  }
  if (/already exists|duplicate|BLOB_READ_WRITE_TOKEN|store.*exists/i.test(output)) {
    console.log("Vercel Blob store appears to already exist. Continuing.");
    return;
  }
  fail(`Vercel Blob setup failed.\n${redact(output, [token])}`);
}

function listTargetEnvKeys({ target, token, options }) {
  if (options.dryRun) {
    return new Set();
  }
  const keys = new Set();
  addListedEnvKeys(keys, { environment: target.environment, branch: "", token, options });
  if (target.branch) {
    addListedEnvKeys(keys, { environment: target.environment, branch: target.branch, token, options });
  }
  return keys;
}

function addListedEnvKeys(keys, { environment, branch, token, options }) {
  const args = [
    "env",
    "list",
    environment,
    ...(branch ? [branch] : []),
    "--format",
    "json"
  ];
  const label = `${environment}${branch ? ` branch ${branch}` : ""}`;
  const result = runVercel(args, { token, options, allowFailure: true });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status !== 0) {
    fail(`Unable to list Vercel env keys for ${label}. Env inspection is required before Redis bootstrap.\n${redact(output, [token])}`);
  }

  try {
    const parsed = parseVercelJsonOutput(output);
    for (const key of collectVercelEnvKeys(parsed, branch)) {
      keys.add(key);
    }
  } catch (error) {
    fail(`Unable to parse Vercel env key list for ${label}: ${error.message}`);
  }
}

function existingRedisEnvPair(keys) {
  return REDIS_ENV_KEY_PAIRS.find(([urlKey, tokenKey]) => keys.has(urlKey) && keys.has(tokenKey)) || null;
}

function collectVercelEnvKeys(value, desiredBranch = "", output = new Set()) {
  const validKey = /^[A-Za-z_][A-Za-z0-9_]*$/;
  if (Array.isArray(value)) {
    for (const item of value) collectVercelEnvKeys(item, desiredBranch, output);
    return output;
  }
  if (!value || typeof value !== "object") {
    return output;
  }

  if (typeof value.key === "string" && validKey.test(value.key)) {
    const gitBranch = typeof value.gitBranch === "string" ? value.gitBranch : "";
    if ((desiredBranch && (!gitBranch || gitBranch === desiredBranch)) || (!desiredBranch && !gitBranch)) {
      output.add(value.key);
    }
  }

  for (const prop of ["envs", "environmentVariables", "variables", "items", "results"]) {
    if (Object.prototype.hasOwnProperty.call(value, prop)) {
      collectVercelEnvKeys(value[prop], desiredBranch, output);
    }
  }
  return output;
}

function parseVercelJsonOutput(text) {
  for (let start = 0; start < text.length; start += 1) {
    const first = text[start];
    if (first !== "{" && first !== "[") {
      continue;
    }

    const stack = [];
    let inString = false;
    let escaped = false;

    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (char === "\\") {
          escaped = true;
        } else if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
      } else if (char === "{") {
        stack.push("}");
      } else if (char === "[") {
        stack.push("]");
      } else if (char === "}" || char === "]") {
        if (stack.pop() !== char) {
          break;
        }
        if (stack.length === 0) {
          try {
            return JSON.parse(text.slice(start, index + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  throw new Error("Vercel CLI did not return a JSON object or array.");
}

function ensureUpstashRedis({ redisConfig, target, scope, token, options }) {
  const integrationProvider = redisConfig.integration.split("/")[0];
  const listArgs = [
    "integration",
    "list",
    "--format=json",
    "--integration",
    integrationProvider,
    ...(scope ? ["--scope", scope] : [])
  ];
  const installArgs = [
    "integration",
    "add",
    redisConfig.integration,
    "--plan",
    redisConfig.plan,
    "--name",
    redisConfig.resourceName,
    "--environment",
    target.environment,
    "--metadata",
    `primaryRegion=${redisConfig.primaryRegion}`,
    "--metadata",
    `eviction=${redisConfig.eviction}`,
    "--metadata",
    `prodPack=${redisConfig.prodPack}`,
    "--metadata",
    `autoUpgrade=${redisConfig.autoUpgrade}`,
    ...(scope ? ["--scope", scope] : [])
  ];

  if (options.dryRun) {
    console.log(`Would check: vercel ${listArgs.join(" ")}`);
    if (options.acceptMarketplaceTerms) {
      console.log(`Would run if missing: vercel integration accept-terms ${integrationProvider} --yes${scope ? ` --scope ${scope}` : ""}`);
    }
    console.log(`Would run: vercel ${installArgs.join(" ")}`);
    return;
  }

  if (hasExistingUpstashRedisResource({ redisConfig, listArgs, token, options })) {
    console.log(`Upstash Redis: ${redisConfig.resourceName} already exists or is already connected.`);
    return;
  }

  if (options.acceptMarketplaceTerms) {
    console.log(`Marketplace terms: accepting terms for ${integrationProvider}.`);
    runVercel(["integration", "accept-terms", integrationProvider, "--yes", ...(scope ? ["--scope", scope] : [])], {
      token,
      options,
      allowFailure: true
    });
  }

  console.log(`Upstash Redis: creating or connecting Redis resource on plan ${redisConfig.plan}.`);
  const result = runVercel(installArgs, { token, options, allowFailure: true });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status === 0) {
    console.log("Upstash Redis resource created/connected. Vercel should inject KV_REST_API_URL and KV_REST_API_TOKEN.");
    return;
  }
  if (/already exists|resource.*exists|already.*connected|duplicate/i.test(output)) {
    console.log("Upstash Redis resource appears to already exist. Continuing.");
    return;
  }
  if (/terms|EULA|privacy|addendum|consent|authorization|attestation|browser/i.test(output)) {
    fail(
      `Upstash Redis setup requires an interactive/legal authorization step.\n` +
        `Run one of:\n` +
        `  npx vercel@latest integration accept-terms ${integrationProvider} --yes\n` +
        `  npm run deploy:setup:${target.environment === "production" ? "production" : "staging"} -- --accept-marketplace-terms\n` +
        `Then rerun this bootstrap.\n\n${redact(output, [token])}`
    );
  }
  if (/Billing plan not found/i.test(output)) {
    fail(
      `Upstash Redis setup failed because plan "${redisConfig.plan}" is not available for this Vercel integration.\n` +
        `Use --redis-plan paid or one of the plans listed by Vercel, then rerun bootstrap.\n\n${redact(output, [token])}`
    );
  }
  fail(`Upstash Redis setup failed.\n${redact(output, [token])}`);
}

function reuseRedisEnvFromTarget({ config, sourceTargetName, target, targetEnvKeys = new Set(), token, options }) {
  const sourceTarget = resolveTarget(config, sourceTargetName, options);
  const sourceLabel = `${sourceTargetName} (${sourceTarget.environment}${sourceTarget.branch ? `/${sourceTarget.branch}` : ""})`;
  const targetLabel = `${target.environment}${target.branch ? `/${target.branch}` : ""}`;
  if (options.dryRun) {
    console.log(`Would reuse Redis env from ${sourceLabel} for ${targetLabel}: ${REDIS_ENV_KEYS.join(", ")}`);
    return;
  }
  const existingPair = existingRedisEnvPair(targetEnvKeys);
  if (existingPair) {
    console.log(`Upstash Redis: existing ${existingPair.join("/")} found in ${targetLabel}; skipping Redis env copy.`);
    return;
  }

  const dir = mkdtempSync(path.join(os.tmpdir(), "superreferrals-vercel-env-"));
  const envPath = path.join(dir, `${sourceTargetName}.env`);
  try {
    console.log(`Upstash Redis: reusing Redis env from ${sourceLabel} for ${targetLabel}.`);
    runVercel([
      "env",
      "pull",
      envPath,
      "--environment",
      sourceTarget.environment,
      ...(sourceTarget.branch ? ["--git-branch", sourceTarget.branch] : []),
      "--yes"
    ], { token, options, secrets: [token] });

    const sourceVariables = parseEnv(readFileSync(envPath, "utf8"));
    const redisVariables = REDIS_ENV_KEYS
      .map((key) => [key, sourceVariables.get(key)])
      .filter(([key, value]) => !targetEnvKeys.has(key) && typeof value === "string" && value.length > 0);
    const hasKvPair = sourceVariables.get("KV_REST_API_URL") && sourceVariables.get("KV_REST_API_TOKEN");
    const hasUpstashPair = sourceVariables.get("UPSTASH_REDIS_REST_URL") && sourceVariables.get("UPSTASH_REDIS_REST_TOKEN");
    if (!hasKvPair && !hasUpstashPair) {
      fail(`No Redis REST env vars were found in ${sourceLabel}. Run staging bootstrap first or add KV_REST_API_URL and KV_REST_API_TOKEN manually.`);
    }
    if (!redisVariables.length) {
      console.log(`Upstash Redis: Redis env keys already exist in ${targetLabel}; nothing to copy.`);
      return;
    }

    for (const [key, value] of redisVariables) {
      runVercel([
        "env",
        "add",
        key,
        target.environment,
        ...(target.branch ? [target.branch] : []),
        "--yes",
        "--sensitive"
      ], { token, options, input: value, secrets: [token, value] });
      console.log(`Production Redis env set: ${key}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function hasExistingUpstashRedisResource({ redisConfig, listArgs, token, options }) {
  const result = runVercel(listArgs, { token, options, allowFailure: true });
  const output = `${result.stdout}\n${result.stderr}`.trim();
  if (result.status !== 0) {
    if (options.verbose && output) {
      console.log(`Upstash Redis list check did not complete; continuing to install.\n${redact(output, [token])}`);
    }
    return false;
  }
  if (!output) {
    return false;
  }

  try {
    return resourceJsonContains(output, [
      redisConfig.resourceName,
      redisConfig.integration,
      "upstash-kv"
    ]);
  } catch {
    return textContainsAll(output, ["upstash", redisConfig.resourceName]) ||
      textContainsAll(output, ["upstash", "redis"]);
  }
}

function resourceJsonContains(rawJson, needles) {
  const parsed = JSON.parse(rawJson);
  const textValues = [];
  collectTextValues(parsed, textValues);
  const haystack = textValues.join("\n").toLowerCase();
  const resourceName = String(needles[0] || "").toLowerCase();
  if (resourceName && haystack.includes(resourceName)) {
    return true;
  }
  return needles.slice(1).some((needle) => haystack.includes(String(needle).toLowerCase()));
}

function collectTextValues(value, output) {
  if (typeof value === "string") {
    output.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectTextValues(item, output);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value)) collectTextValues(item, output);
  }
}

function textContainsAll(text, needles) {
  const lower = text.toLowerCase();
  return needles.every((needle) => lower.includes(String(needle).toLowerCase()));
}

function runEnvSync({ targetName, target, scope, project, token, options }) {
  const mergedEnvFile = createMergedEnvFileForSync(target);
  const args = [
    "scripts/sync-vercel-env.mjs",
    targetName,
    ...(options.forceEnvSync ? ["--force-all"] : []),
    ...(options.noOverwriteEnvSync ? ["--no-overwrite"] : []),
    ...(mergedEnvFile ? ["--file", mergedEnvFile] : []),
    ...(scope ? ["--scope", scope] : []),
    ...(project ? ["--project", project] : []),
    ...(options.useGlobalToken || !token ? ["--use-global-token"] : [])
  ];
  if (options.dryRun) {
    args.push("--dry-run");
  }
  console.log("Vercel env sync: running repository env sync.");
  const child = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(token ? { VERCEL_TOKEN: token } : {})
    }
  });
  if (child.error) {
    fail(`Unable to run env sync: ${child.error.message}`);
  }
  if (child.status !== 0) {
    cleanupMergedEnvFile(mergedEnvFile);
    fail(`Env sync failed with exit code ${child.status}.`);
  }
  cleanupMergedEnvFile(mergedEnvFile);
}

function createMergedEnvFileForSync(target) {
  if (!target.fallbackEnvFiles.length) {
    return "";
  }
  const variables = loadTargetEnvVariables(target);
  const dir = mkdtempSync(path.join(os.tmpdir(), "superreferrals-env-"));
  const filePath = path.join(dir, `${path.basename(target.envFile)}.merged`);
  const body = Array.from(variables.entries())
    .map(([key, value]) => `${key}=${quoteEnvValue(value)}`)
    .join("\n");
  writeFileSync(filePath, `${body}\n`, { mode: 0o600 });
  return filePath;
}

function cleanupMergedEnvFile(filePath) {
  if (!filePath) {
    return;
  }
  rmSync(path.dirname(filePath), { recursive: true, force: true });
}

function quoteEnvValue(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@,+-]*$/.test(text)) {
    return text;
  }
  return JSON.stringify(text);
}

function runVercel(args, { token, options, allowFailure = false, input, secrets = [token] }) {
  const vercelBin = process.env.VERCEL_CLI_BIN || "npx";
  const vercelPrefix = process.env.VERCEL_CLI_BIN ? [] : ["--yes", "vercel@latest"];
  const child = spawnSync(vercelBin, [...vercelPrefix, ...args, "--non-interactive"], {
    cwd: repoRoot,
    encoding: "utf8",
    input,
    env: {
      ...process.env,
      ...(token ? { VERCEL_TOKEN: token } : {}),
      NO_COLOR: "1"
    }
  });
  if (child.error) {
    fail(`Unable to run Vercel CLI: ${child.error.message}`);
  }
  if (child.status !== 0 && !allowFailure) {
    fail(redact([child.stdout, child.stderr].filter(Boolean).join("\n"), secrets));
  }
  if (options.verbose && child.stdout.trim()) {
    console.log(redact(child.stdout.trim(), secrets));
  }
  return child;
}

function runVercelInteractive(args, { token, options }) {
  const vercelBin = process.env.VERCEL_CLI_BIN || "npx";
  const vercelPrefix = process.env.VERCEL_CLI_BIN ? [] : ["--yes", "vercel@latest"];
  const child = spawnSync(vercelBin, [...vercelPrefix, ...args], {
    cwd: repoRoot,
    stdio: "inherit",
    env: {
      ...process.env,
      ...(token ? { VERCEL_TOKEN: token } : {})
    }
  });
  if (child.error) {
    fail(`Unable to run Vercel CLI: ${child.error.message}`);
  }
  if (child.status !== 0) {
    fail(`Vercel CLI failed for: vercel ${args.join(" ")}`);
  }
  if (options.verbose) {
    console.log(`Vercel CLI completed: vercel ${args.join(" ")}`);
  }
}

function printNextSteps({ targetName, target, blobConfig, redisConfig, skippedVercel, skippedEnvValidation }) {
  console.log("\nBootstrap checklist:");
  console.log(skippedEnvValidation
    ? "1. 0G env validation was skipped; validate before running live 0G flows."
    : "1. 0G env was validated from the target env file.");
  if (skippedVercel) {
    console.log("2. Vercel steps were skipped by flag.");
  } else {
    console.log(target.redisFromTarget
      ? `2. Redis env reused from ${target.redisFromTarget}; production/staging stay separated by Redis key namespace.`
      : `2. Upstash Redis requested: ${redisConfig.resourceName}.`);
    if (blobConfig.enabled) {
      console.log(`3. Private Vercel Blob store requested: ${blobConfig.storeName}.`);
      console.log(target.redisFromTarget
        ? "4. Confirm the target environment has copied KV_REST_API_URL/KV_REST_API_TOKEN plus BLOB_READ_WRITE_TOKEN if Blob is enabled."
        : "4. The linked Vercel integration should inject KV_REST_API_URL, KV_REST_API_TOKEN, and BLOB_READ_WRITE_TOKEN for the target environment.");
    } else {
      console.log("3. Private Vercel Blob is disabled; use Redis for app state and 0G for render artifacts/metadata.");
      console.log(target.redisFromTarget
        ? "4. Confirm the target environment has copied KV_REST_API_URL and KV_REST_API_TOKEN from the source target."
        : "4. The linked Vercel integration should inject KV_REST_API_URL and KV_REST_API_TOKEN for the target environment.");
    }
    console.log(`5. Redeploy ${targetName} after storage/env changes so the running deployment sees new values.`);
  }
  console.log(`Target env: ${target.environment}${target.branch ? ` / ${target.branch}` : ""}.`);
}

function redact(text, secrets) {
  let output = text || "";
  for (const secret of secrets || []) {
    if (!secret || secret.length < 3) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

function usage(exitCode) {
  console.log(`Usage: node scripts/bootstrap-deploy.mjs <staging|production> [options]

Guides a new operator through durable storage setup:
  - validates 0G env in the target env file
  - logs into/links Vercel when needed
  - creates an Upstash Redis resource
  - creates a private Vercel Blob store only when enabled in deploy.json
  - can run repository Vercel env sync when --sync-env is passed

Options:
  --config <path>          Deploy config file, default deploy.json
  --scope <team>           Vercel team/scope slug
  --project <name>         Vercel project name
  --store-name <name>      Blob store name
  --region <region>        Blob region, default from deploy.json
  --access <private|public> Blob access mode, default private
  --dry-run                Print planned actions
  --no-login               Do not launch interactive Vercel login
  --use-global-token       Use active Vercel CLI login for env sync
  --skip-vercel            Only validate local deploy env
  --skip-redis             Skip Upstash Redis provisioning
  --skip-blob              Skip Blob store creation
  --sync-env               Also sync the target env file to Vercel after storage setup
  --skip-env-sync          Do not sync env vars to Vercel (default)
  --force-env-sync         Pass --force-all to the env sync helper
  --no-overwrite-env-sync  Pass --no-overwrite to the env sync helper
  --skip-env-validation    Provision Vercel storage without requiring local 0G env files
  --accept-marketplace-terms
                           Accept Vercel Marketplace terms for Redis integration (default)
  --no-accept-marketplace-terms
                           Do not run Marketplace terms acceptance automatically
  --redis-integration <id> Redis integration slug, default upstash/upstash-kv
  --redis-name <name>      Redis resource name
  --redis-plan <plan>      Redis plan, default ${DEFAULT_REDIS_PLAN}
  --redis-region <region>  Redis primary region
  --verbose                Print extra command output
`);
  process.exit(exitCode);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
