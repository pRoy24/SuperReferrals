import { env, isMockMode } from "./env";

export type EnvDiagnosticSeverity = "error" | "warning";

export type EnvDiagnosticIssue = {
  key: string;
  label: string;
  message: string;
  howToSet: string;
  severity: EnvDiagnosticSeverity;
  adminOnly?: boolean;
};

export type EnvDiagnostics = {
  environment: string;
  profile: "non-production" | "production";
  mockMode: boolean;
  appCanRun: boolean;
  issues: EnvDiagnosticIssue[];
};

type ExpectedEnvValue = {
  key: string;
  label: string;
  expected: string;
  message: string;
};

const nonProductionExpectedValues: ExpectedEnvValue[] = [
  {
    key: "TRANSACTION_NETWORK",
    label: "Payment network",
    expected: "sepolia",
    message: "Development, local, staging, and preview should use Sepolia payment settings."
  },
  {
    key: "TRANSACTION_CHAIN_ID",
    label: "Payment chain ID",
    expected: "11155111",
    message: "Development, local, staging, and preview should use Ethereum Sepolia."
  },
  {
    key: "NEXT_PUBLIC_TRANSACTION_NETWORK",
    label: "Public payment network",
    expected: "sepolia",
    message: "The browser-visible payment network should match Sepolia outside production."
  },
  {
    key: "NEXT_PUBLIC_TRANSACTION_CHAIN_ID",
    label: "Public payment chain ID",
    expected: "11155111",
    message: "The browser-visible payment chain ID should match Sepolia outside production."
  },
  {
    key: "OG_NETWORK",
    label: "0G network",
    expected: "galileo",
    message: "Development, local, staging, and preview should use 0G Galileo."
  },
  {
    key: "OG_CHAIN_ID",
    label: "0G chain ID",
    expected: "16602",
    message: "Development, local, staging, and preview should use 0G Galileo."
  },
  {
    key: "ENS_CHAIN_ID",
    label: "ENS chain ID",
    expected: "11155111",
    message: "Non-production ENS lookups should use Sepolia unless intentionally overridden."
  }
];

const productionExpectedValues: ExpectedEnvValue[] = [
  {
    key: "TRANSACTION_NETWORK",
    label: "Payment network",
    expected: "ethereum",
    message: "Production should use the production payment network."
  },
  {
    key: "TRANSACTION_CHAIN_ID",
    label: "Payment chain ID",
    expected: "1",
    message: "Production should use Ethereum mainnet unless a production alternative is intentionally configured."
  },
  {
    key: "NEXT_PUBLIC_TRANSACTION_NETWORK",
    label: "Public payment network",
    expected: "ethereum",
    message: "The browser-visible payment network should match production."
  },
  {
    key: "NEXT_PUBLIC_TRANSACTION_CHAIN_ID",
    label: "Public payment chain ID",
    expected: "1",
    message: "The browser-visible payment chain ID should match production."
  },
  {
    key: "OG_NETWORK",
    label: "0G network",
    expected: "mainnet",
    message: "Production should use 0G mainnet."
  },
  {
    key: "OG_CHAIN_ID",
    label: "0G chain ID",
    expected: "16661",
    message: "Production should use 0G mainnet."
  },
  {
    key: "ENS_CHAIN_ID",
    label: "ENS chain ID",
    expected: "1",
    message: "Production ENS lookups should use Ethereum mainnet."
  }
];

export function getEnvDiagnostics(): EnvDiagnostics {
  const environment = currentDeploymentEnvironment();
  const profile = environment === "production" ? "production" : "non-production";
  const mockMode = isMockMode();
  const localLike = isLocalLikeEnvironment(environment);
  const liveSeverity: EnvDiagnosticSeverity = profile === "production" || !mockMode ? "error" : "warning";
  const issues: EnvDiagnosticIssue[] = [];

  addMissingIssue(issues, "APP_BASE_URL", {
    label: "Application base URL",
    message: "Webhooks, uploads, callbacks, and generated links need the public app URL.",
    howToSet: profile === "production"
      ? "Set APP_BASE_URL to the production URL, for example https://super-referrals.vercel.app."
      : "Set APP_BASE_URL to http://localhost:3000 locally or the preview/staging Vercel URL when deployed.",
    severity: localLike ? "warning" : "error"
  });
  addMissingIssue(issues, "SUPERREFERRALS_SESSION_SECRET", {
    label: "Session secret",
    message: "Account cookies need a stable deployment secret.",
    howToSet: "Generate one with openssl rand -base64 32 and keep the same value for the target environment.",
    severity: localLike ? "warning" : "error"
  });
  addMissingIssue(issues, "ADMIN_SECRET", {
    label: "Admin secret",
    message: "The admin dashboard is disabled until ADMIN_SECRET is set.",
    howToSet: "Generate one with openssl rand -base64 32 and use it to unlock /admin.",
    severity: "warning"
  });
  addMissingIssue(issues, "SAMSAR_APP_SECRET", {
    label: "Samsar platform APP_SECRET",
    message: "Storefront APP_KEY provisioning and stored APP_KEY encryption need the Samsar platform APP_SECRET.",
    howToSet: "Paste the APP_SECRET from the Samsar platform credentials for this deployment, or leave it blank until storefront creation is needed.",
    severity: "warning"
  });
  addMissingIssue(issues, "KEEPERHUB_API_KEY", {
    label: "KeeperHub API key",
    message: "Live payment settlement and refunds need KeeperHub API access.",
    howToSet: "Create or copy the KeeperHub API key from the KeeperHub dashboard for the deployment account.",
    severity: liveSeverity
  });
  addMissingIssue(issues, "KEEPERHUB_WALLET_ADDRESS", {
    label: "KeeperHub wallet",
    message: "Live storefront payments need a settlement wallet address.",
    howToSet: "Create or choose the KeeperHub organization wallet and set its EVM address.",
    severity: liveSeverity
  });
  addMissingIssue(issues, "OG_PRIVATE_KEY", {
    label: "0G signer private key",
    message: "Live 0G storage, iNFT minting, and registry writes need a funded platform signer.",
    howToSet: "Use a funded deployment wallet private key for the selected 0G network. Never commit this value.",
    severity: liveSeverity
  });
  addMissingIssue(issues, "OG_STORAGE_INDEXER_RPC", {
    label: "0G storage indexer",
    message: "Live 0G storage uploads need a storage indexer endpoint.",
    howToSet: profile === "production"
      ? "Use https://indexer-storage-turbo.0g.ai for 0G mainnet unless your operator provides another endpoint."
      : "Use https://indexer-storage-testnet-turbo.0g.ai for 0G Galileo unless your operator provides another endpoint.",
    severity: liveSeverity
  });
  addMissingIssue(issues, "OG_DA_URL", {
    label: "0G DA endpoint",
    message: "Live data availability submissions need a 0G DA endpoint.",
    howToSet: "Set the DA submission endpoint from your 0G operator or leave blank until DA publishing is enabled.",
    severity: "warning",
    adminOnly: true
  });
  addMissingIssue(issues, "USER_REGISTRY_CONTRACT_ADDRESS", {
    label: "User registry contract",
    message: "Live user profile registry writes need the deployed registry contract address.",
    howToSet: "Deploy SuperReferralsUserRegistry on the target 0G network and set the address.",
    severity: "warning",
    adminOnly: true
  });
  addMissingIssue(issues, "AGENT_REGISTRY_CONTRACT_ADDRESS", {
    label: "Agent registry contract",
    message: "Live agent registry writes need the deployed agent registry contract address.",
    howToSet: "Deploy SuperReferralsAgentRegistry on the target 0G network and set the address.",
    severity: "warning",
    adminOnly: true
  });
  addMissingIssue(issues, "INFT_CONTRACT_ADDRESS", {
    label: "iNFT contract",
    message: "Live iNFT minting needs the deployed iNFT contract address.",
    howToSet: "Run the iNFT deployment for the target network and set the resulting contract address.",
    severity: "warning"
  });

  for (const expected of profile === "production" ? productionExpectedValues : nonProductionExpectedValues) {
    addExpectedValueIssue(issues, expected, liveSeverity);
  }

  addUrlIssue(issues, "TRANSACTION_RPC_URL", "Payment RPC URL", liveSeverity);
  addUrlIssue(issues, "NEXT_PUBLIC_TRANSACTION_RPC_URL", "Public payment RPC URL", liveSeverity);
  addUrlIssue(issues, "OG_RPC_URL", "0G RPC URL", liveSeverity);
  addUrlIssue(issues, "ENS_RPC_URL", "ENS RPC URL", "warning");

  return {
    environment,
    profile,
    mockMode,
    appCanRun: true,
    issues: uniqueIssues(issues)
  };
}

export function getLandingEnvDiagnostics(): EnvDiagnostics {
  const diagnostics = getEnvDiagnostics();
  return {
    ...diagnostics,
    issues: diagnostics.issues.filter((issue) => !issue.adminOnly)
  };
}

function addMissingIssue(
  issues: EnvDiagnosticIssue[],
  key: string,
  input: Omit<EnvDiagnosticIssue, "key">
) {
  if (!isMissingOrPlaceholder(rawEnvValue(key))) {
    return;
  }
  issues.push({ key, ...input });
}

function addExpectedValueIssue(
  issues: EnvDiagnosticIssue[],
  expected: ExpectedEnvValue,
  severity: EnvDiagnosticSeverity
) {
  const value = rawEnvValue(expected.key);
  if (isMissingOrPlaceholder(value)) {
    issues.push({
      key: expected.key,
      label: expected.label,
      message: expected.message,
      howToSet: `Set ${expected.key}=${expected.expected}.`,
      severity
    });
    return;
  }
  if (value.trim().toLowerCase() !== expected.expected.toLowerCase()) {
    issues.push({
      key: expected.key,
      label: expected.label,
      message: `${expected.message} Current value is ${value}.`,
      howToSet: `Set ${expected.key}=${expected.expected} unless this deployment intentionally uses another network.`,
      severity
    });
  }
}

function addUrlIssue(
  issues: EnvDiagnosticIssue[],
  key: string,
  label: string,
  severity: EnvDiagnosticSeverity
) {
  const value = rawEnvValue(key);
  if (isMissingOrPlaceholder(value)) {
    issues.push({
      key,
      label,
      message: `${label} is not configured.`,
      howToSet: `Set ${key} to the RPC or API URL for this environment.`,
      severity
    });
    return;
  }
  if (!/^https?:\/\//i.test(value)) {
    issues.push({
      key,
      label,
      message: `${label} must be an http(s) URL.`,
      howToSet: `Set ${key} to a full URL beginning with https://.`,
      severity
    });
  }
}

function uniqueIssues(issues: EnvDiagnosticIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.key}:${issue.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function currentDeploymentEnvironment() {
  return normalizeEnvironment(
    env("DEPLOYMENT_ENV") ||
    env("NEXT_PUBLIC_DEPLOYMENT_ENV") ||
    env("VERCEL_ENV") ||
    env("APP_ENV") ||
    env("NEXT_PUBLIC_APP_ENV") ||
    (process.env.NODE_ENV === "production" ? "production" : "local")
  );
}

function normalizeEnvironment(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["prod", "production"].includes(normalized)) return "production";
  if (["preview", "staging", "stage"].includes(normalized)) return normalized === "stage" ? "staging" : normalized;
  if (["development", "dev"].includes(normalized)) return "development";
  return normalized || "local";
}

function isLocalLikeEnvironment(environment: string) {
  return environment === "local" || environment === "development" || environment === "dev";
}

function rawEnvValue(key: string) {
  return process.env[key]?.trim() || "";
}

function isMissingOrPlaceholder(value: string) {
  if (!value) return true;
  return /^change-me/i.test(value) ||
    /^replace_with_/i.test(value) ||
    /^<.*>$/i.test(value) ||
    /your[-_\w.]*\.example/i.test(value) ||
    /paste[_-]?|todo/i.test(value);
}
