#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const DEFAULT_TEAM = "proy24s-projects";
const DEFAULT_PROJECT = "super-referrals";

const DEFAULT_TARGETS = {
  staging: {
    sourceFile: ".env.staging",
    environment: "preview",
    branch: "develop",
    stateFile: ".vercel-env-sync/staging.json"
  },
  production: {
    sourceFile: ".env.production",
    environment: "production",
    branch: "",
    stateFile: ".vercel-env-sync/production.json"
  }
};

const BLOCKED_KEYS = new Set([
  "VERCEL_TOKEN",
  "VERCEL_AUTH_TOKEN",
  "VERCEL_ACCESS_TOKEN",
  "VERCEL_SCOPE",
  "VERCEL_TEAM",
  "VERCEL_PROJECT",
  "VERCEL_PROJECT_ID",
  "VERCEL_ORG_ID",
  "VERCEL_TEAM_ID"
]);

const PLACEHOLDER_PATTERNS = [
  /^replace_with_/i,
  /^your-domain\.example$/i,
  /your[-\w.]*\.example/i,
  /^<.*>$/,
  /paste[_-]?/,
  /todo/i
];

main();

function main() {
  const { targetName, options } = parseArgs(process.argv.slice(2));
  const target = buildTarget(targetName, options);
  const sourcePath = path.resolve(repoRoot, target.sourceFile);
  const statePath = path.resolve(repoRoot, target.stateFile);
  const scope = options.scope || process.env.VERCEL_SCOPE || process.env.VERCEL_TEAM || DEFAULT_TEAM;
  const project = options.project || process.env.VERCEL_PROJECT || DEFAULT_PROJECT;
  const token = readToken(options);

  if (!existsSync(sourcePath)) {
    fail(`Missing ${target.sourceFile}. Create it from ${target.sourceFile}.example or pass --file <path>.`);
  }

  if (!token && !options.useGlobalToken && !options.dryRun) {
    fail(
      "Missing Vercel token. Set VERCEL_TOKEN, put the token in .vercel-token, " +
        "or pass --use-global-token to use the currently logged-in Vercel CLI account."
    );
  }

  const variables = parseEnvFile(readFileSync(sourcePath, "utf8"), target.sourceFile);
  validateVariables(variables, targetName, options);

  const skippedEmpty = options.includeEmpty ? [] : variables.filter(({ value }) => value === "");
  const uploadVariables = options.includeEmpty ? variables : variables.filter(({ value }) => value !== "");
  const hashes = Object.fromEntries(uploadVariables.map(({ key, value }) => [key, hashValue(key, value)]));
  const previousState = loadState(statePath, target);
  const previousHashes = previousState.hashes || {};
  const changed = uploadVariables.filter(({ key }) => options.forceAll || previousHashes[key] !== hashes[key]);
  const removed = Object.keys(previousHashes)
    .filter((key) => !(key in hashes))
    .sort();
  const unchangedCount = uploadVariables.length - changed.length;

  printPlan({
    targetName,
    target,
    scope,
    project,
    sourceFile: target.sourceFile,
    changed,
    removed,
    unchangedCount,
    skippedEmpty,
    deleteRemoved: options.deleteRemoved,
    dryRun: options.dryRun
  });

  if (options.dryRun) {
    return;
  }

  ensureLinked({ scope, project, token, options });

  for (const entry of changed) {
    runVercelEnvAdd(entry, { target, scope, token, options });
    console.log(`set ${entry.key}`);
  }

  if (options.deleteRemoved) {
    for (const key of removed) {
      runVercelEnvRemove(key, { target, scope, token, options });
      console.log(`removed ${key}`);
    }
  } else if (removed.length) {
    console.log("Skipped remote removals. Re-run with --delete-removed to remove omitted keys.");
  }

  writeState(statePath, {
    version: 1,
    targetName,
    environment: target.environment,
    branch: target.branch,
    sourceFile: target.sourceFile,
    syncedAt: new Date().toISOString(),
    hashes: options.deleteRemoved
      ? hashes
      : {
          ...Object.fromEntries(removed.map((key) => [key, previousHashes[key]])),
          ...hashes
        }
  });

  console.log("Vercel env sync complete.");
}

function parseArgs(args) {
  const options = {
    dryRun: false,
    forceAll: false,
    deleteRemoved: false,
    allowPlaceholders: false,
    allowLocalAppBaseUrl: false,
    noOverwrite: false,
    useGlobalToken: false,
    file: "",
    environment: "",
    branch: undefined,
    scope: "",
    project: "",
    verbose: false,
    includeEmpty: false
  };

  let targetName = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--") && !targetName) {
      targetName = arg;
      continue;
    }

    let name = arg;
    let inlineValue;
    if (arg.startsWith("--")) {
      const raw = arg.slice(2);
      const equalsIndex = raw.indexOf("=");
      name = equalsIndex === -1 ? raw : raw.slice(0, equalsIndex);
      inlineValue = equalsIndex === -1 ? undefined : raw.slice(equalsIndex + 1);
    }
    const readValue = () => {
      if (inlineValue !== undefined) return inlineValue;
      index += 1;
      if (index >= args.length) fail(`Missing value for --${name}.`);
      return args[index];
    };

    switch (name) {
      case "dry-run":
        options.dryRun = true;
        break;
      case "force-all":
        options.forceAll = true;
        break;
      case "delete-removed":
        options.deleteRemoved = true;
        break;
      case "no-overwrite":
        options.noOverwrite = true;
        break;
      case "allow-placeholders":
        options.allowPlaceholders = true;
        break;
      case "allow-local-app-base-url":
        options.allowLocalAppBaseUrl = true;
        break;
      case "use-global-token":
        options.useGlobalToken = true;
        break;
      case "verbose":
        options.verbose = true;
        break;
      case "include-empty":
        options.includeEmpty = true;
        break;
      case "skip-empty":
        options.includeEmpty = false;
        break;
      case "file":
        options.file = readValue();
        break;
      case "environment":
        options.environment = readValue();
        break;
      case "branch":
        options.branch = readValue();
        break;
      case "scope":
        options.scope = readValue();
        break;
      case "project":
        options.project = readValue();
        break;
      case "help":
        usage(0);
        break;
      default:
        fail(`Unknown argument: ${arg}`);
    }
  }

  if (!targetName) {
    usage(1);
  }

  if (!(targetName in DEFAULT_TARGETS)) {
    fail(`Unknown target "${targetName}". Expected staging or production.`);
  }

  return { targetName, options };
}

function buildTarget(targetName, options) {
  const defaults = DEFAULT_TARGETS[targetName];
  const prefix = targetName.toUpperCase();
  const envSourceFile = process.env[`VERCEL_${prefix}_ENV_FILE`];
  const envEnvironment = process.env[`VERCEL_${prefix}_ENVIRONMENT`];
  const envBranch = process.env[`VERCEL_${prefix}_BRANCH`];

  return {
    sourceFile: options.file || envSourceFile || defaults.sourceFile,
    environment: options.environment || envEnvironment || defaults.environment,
    branch: normalizeBranch(options.branch !== undefined ? options.branch : envBranch ?? defaults.branch),
    stateFile: defaults.stateFile
  };
}

function normalizeBranch(branch) {
  if (branch === undefined || branch === null) return "";
  const normalized = String(branch).trim();
  return normalized === "-" ? "" : normalized;
}

function readToken(options) {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN;
  const tokenFile = process.env.VERCEL_TOKEN_FILE || ".vercel-token";
  const tokenPath = path.resolve(repoRoot, tokenFile);
  if (existsSync(tokenPath)) {
    return readFileSync(tokenPath, "utf8").trim();
  }
  return options.useGlobalToken ? "" : "";
}

function parseEnvFile(source, filename) {
  const variables = [];
  const seen = new Set();
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const equalsIndex = line.indexOf("=");
    if (equalsIndex === -1) {
      fail(`${filename}:${lineNumber} is not KEY=value syntax.`);
    }

    let key = line.slice(0, equalsIndex).trim();
    if (key.startsWith("export ")) {
      key = key.slice("export ".length).trim();
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      fail(`${filename}:${lineNumber} has invalid env var name "${key}".`);
    }

    if (seen.has(key)) {
      fail(`${filename}:${lineNumber} duplicates "${key}". Keep one value per key.`);
    }
    seen.add(key);

    variables.push({
      key,
      value: parseEnvValue(line.slice(equalsIndex + 1), filename, lineNumber),
      lineNumber
    });
  });

  return variables;
}

function parseEnvValue(rawValue, filename, lineNumber) {
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
        else if (escaped === "\\" || escaped === '"') output += escaped;
        else output += escaped ?? "";
      } else {
        output += char;
      }
    }
    fail(`${filename}:${lineNumber} has an unterminated double-quoted value.`);
  }

  if (value.startsWith("'")) {
    const end = value.indexOf("'", 1);
    if (end === -1) fail(`${filename}:${lineNumber} has an unterminated single-quoted value.`);
    return value.slice(1, end);
  }

  let end = value.length;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "#" && (index === 0 || /\s/.test(value[index - 1]))) {
      end = index;
      break;
    }
  }
  return value.slice(0, end).trimEnd();
}

function validateVariables(variables, targetName, options) {
  const blocked = variables
    .filter(({ key }) => BLOCKED_KEYS.has(key) || key.startsWith("VERCEL_"))
    .map(({ key }) => key);
  if (blocked.length) {
    fail(`Refusing to upload Vercel control credentials/system keys: ${blocked.join(", ")}`);
  }

  if (!options.allowPlaceholders) {
    const placeholders = variables
      .filter(({ value }) => PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(value)))
      .map(({ key }) => key);
    if (placeholders.length) {
      const message =
        `Placeholder values found in ${placeholders.join(", ")}. ` +
        "Replace them before syncing to Vercel.";
      if (options.dryRun) {
        console.warn(`Warning: ${message}`);
      } else {
        fail(`${message} Pass --allow-placeholders only if this is intentional.`);
      }
    }
  }

  const appBaseUrl = variables.find(({ key }) => key === "APP_BASE_URL")?.value;
  if (
    appBaseUrl &&
    !options.allowLocalAppBaseUrl &&
    targetName !== "development" &&
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(appBaseUrl)
  ) {
    fail("APP_BASE_URL points at localhost. Set the deployed URL or pass --allow-local-app-base-url intentionally.");
  }
}

function hashValue(key, value) {
  return createHash("sha256").update(key).update("\0").update(value).digest("hex");
}

function loadState(statePath, target) {
  if (!existsSync(statePath)) return { hashes: {} };

  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    if (state.environment !== target.environment || state.branch !== target.branch) {
      return { hashes: {} };
    }
    return state;
  } catch {
    fail(`Could not parse ${path.relative(repoRoot, statePath)}. Delete it and re-run.`);
  }
}

function writeState(statePath, state) {
  mkdirSync(path.dirname(statePath), { recursive: true });
  const tempPath = `${statePath}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(tempPath, statePath);
}

function ensureLinked({ scope, project, token, options }) {
  const projectConfig = path.resolve(repoRoot, ".vercel/project.json");
  if (existsSync(projectConfig)) return;

  console.log(`Linking Vercel project ${scope}/${project} locally.`);
  runVercel(["link", "--yes", "--team", scope, "--project", project], {
    token,
    options,
    secrets: [token]
  });
}

function runVercelEnvAdd(entry, { target, scope, token, options }) {
  const args = [
    "env",
    "add",
    entry.key,
    target.environment,
    ...targetBranchArg(target),
    ...(options.noOverwrite ? [] : ["--force"]),
    "--yes",
    "--sensitive",
    ...emptyValueArg(entry),
    "--scope",
    scope
  ];
  runVercel(args, {
    token,
    options,
    input: entry.value === "" ? undefined : entry.value,
    secrets: [token, entry.value]
  });
}

function runVercelEnvRemove(key, { target, scope, token, options }) {
  const args = [
    "env",
    "remove",
    key,
    target.environment,
    ...targetBranchArg(target),
    "--yes",
    "--scope",
    scope
  ];
  runVercel(args, { token, options, secrets: [token] });
}

function targetBranchArg(target) {
  return target.branch ? [target.branch] : [];
}

function emptyValueArg(entry) {
  return entry.value === "" ? ["--value", ""] : [];
}

function runVercel(args, { token, options, input, secrets }) {
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

  if (child.status !== 0) {
    const output = redact([child.stdout, child.stderr].filter(Boolean).join("\n"), secrets);
    fail(`Vercel CLI failed for: vercel ${args.slice(0, 4).join(" ")}\n${output}`.trim());
  }

  if (options.verbose && child.stdout.trim()) {
    console.log(redact(child.stdout.trim(), secrets));
  }
}

function redact(text, secrets) {
  let output = text;
  for (const secret of secrets || []) {
    if (!secret || secret.length < 3) continue;
    output = output.split(secret).join("[redacted]");
  }
  return output;
}

function printPlan({
  targetName,
  target,
  scope,
  project,
  sourceFile,
  changed,
  removed,
  unchangedCount,
  skippedEmpty,
  deleteRemoved,
  dryRun
}) {
  const targetLabel = target.branch
    ? `${target.environment} branch ${target.branch}`
    : target.environment;
  console.log(`${dryRun ? "Dry run: " : ""}${targetName} -> ${scope}/${project} (${targetLabel})`);
  console.log(`source: ${sourceFile}`);
  console.log(`changed: ${changed.length}, unchanged: ${unchangedCount}, removed locally: ${removed.length}`);
  if (changed.length) console.log(`will set: ${changed.map(({ key }) => key).join(", ")}`);
  if (skippedEmpty.length) console.log(`skipped empty: ${skippedEmpty.map(({ key }) => key).join(", ")}`);
  if (removed.length) {
    const action = deleteRemoved ? "will remove" : "remote removals disabled";
    console.log(`${action}: ${removed.join(", ")}`);
  }
}

function usage(exitCode) {
  console.log(`Usage: node scripts/sync-vercel-env.mjs <staging|production> [options]

Options:
  --dry-run                    Print changed keys without updating Vercel
  --force-all                  Upload every key from the source file
  --no-overwrite               Fail instead of overwriting an existing Vercel key
  --delete-removed             Remove keys omitted from the source file and tracked in local state
  --file <path>                Override source env file
  --environment <name>         Override Vercel environment, e.g. preview or production
  --branch <name|- >           Override branch scope; use "-" for no branch
  --scope <team>               Override Vercel team/scope slug
  --project <name>             Override Vercel project name for first-time link
  --use-global-token           Use the active Vercel CLI login instead of requiring VERCEL_TOKEN
  --include-empty              Upload empty values instead of skipping them
  --allow-placeholders         Permit obvious placeholder values
  --allow-local-app-base-url   Permit APP_BASE_URL=http://localhost...
  --verbose                    Print non-secret Vercel CLI output
`);
  process.exit(exitCode);
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
