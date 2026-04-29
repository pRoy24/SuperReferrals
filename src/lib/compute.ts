import { createRequire } from "node:module";
import { JsonRpcProvider, Wallet } from "ethers";
import { env, isProviderMock } from "./env";
import { getZeroGChainConfig } from "./zero-g-chain";

export type ZeroGComputeNetwork = "testnet" | "mainnet";
export type ZeroGComputeChatRole = "user" | "assistant";

export interface ZeroGComputeChatMessage {
  role: ZeroGComputeChatRole;
  content: string;
}

export interface ZeroGComputeChatResponse {
  output_text: string;
  model: string;
  network: ZeroGComputeNetwork;
  mock?: boolean;
  [key: string]: any;
}

interface ZeroGComputeConfig {
  model: string;
  network: ZeroGComputeNetwork;
  deploymentEnvironment: string;
}

interface ZeroGComputeSigner {
  privateKey: string;
  source: string;
}

interface ZeroGComputeProviderPreference {
  providerAddress: string;
  source: string;
}

const DEFAULT_TESTNET_LLM_MODEL = "qwen-2.5-7b-instruct";
const DEFAULT_MAINNET_LLM_MODEL = "GLM-5-FP8";

type ZeroGComputeService = {
  provider: string;
  serviceType: string;
  url: string;
  model: string;
};

type ZeroGComputeBroker = {
  inference: {
    listService(offset?: number, limit?: number, includeUnacknowledged?: boolean): Promise<ZeroGComputeService[]>;
    getServiceMetadata(providerAddress: string): Promise<{ endpoint: string; model: string }>;
    getRequestHeaders(providerAddress: string, content?: string): Promise<Record<string, string>>;
    processResponse(providerAddress: string, chatID?: string, content?: string): Promise<boolean | null>;
  };
};

const require = createRequire(import.meta.url);
const { createZGComputeNetworkBroker } = require("@0glabs/0g-serving-broker") as {
  createZGComputeNetworkBroker(wallet: Wallet): Promise<ZeroGComputeBroker>;
};

const computeBrokers = new Map<string, Promise<ZeroGComputeBroker>>();

export async function askZeroGCompute(systemPrompt: string, question: string): Promise<ZeroGComputeChatResponse> {
  return askZeroGComputeChat(systemPrompt, [{ role: "user", content: question }]);
}

export async function askZeroGComputeChat(systemPrompt: string, messages: ZeroGComputeChatMessage[]): Promise<ZeroGComputeChatResponse> {
  const config = getZeroGComputeConfig();
  const cleanMessages = messages
    .map((message) => ({
      role: message.role,
      content: message.content.trim()
    }))
    .filter((message) => message.content);
  const latestQuestion = [...cleanMessages].reverse().find((message) => message.role === "user")?.content || "";
  if (isProviderMock("OG_COMPUTE")) {
    return {
      output_text:
        `${systemPrompt.split("\n").slice(0, 4).join(" ")} Requested task: ${latestQuestion}. Use the available page actions for executable operations, or ask a more specific follow-up.`,
      model: config.model,
      network: config.network,
      mock: true
    };
  }
  const signer = resolveZeroGComputePrivateKey(config);
  const broker = await getZeroGComputeBroker(config, signer);
  const providerPreference = resolveZeroGComputeProviderAddress(config);
  const services = await selectZeroGComputeServices(broker, config, providerPreference);
  let lastProviderError: unknown;
  for (const service of services) {
    try {
      return await requestZeroGComputeService(broker, config, service, systemPrompt, cleanMessages);
    } catch (error) {
      lastProviderError = error;
      if (providerPreference || !shouldTryNextZeroGComputeProvider(error)) {
        throw decorateZeroGComputeProviderError(error, config, service, signer.source, providerPreference);
      }
    }
  }

  throw decorateZeroGComputeProviderError(
    lastProviderError || new Error("0G Compute request failed"),
    config,
    services[services.length - 1],
    signer.source,
    providerPreference
  );
}

async function requestZeroGComputeService(
  broker: ZeroGComputeBroker,
  config: ZeroGComputeConfig,
  service: ZeroGComputeService,
  systemPrompt: string,
  cleanMessages: ZeroGComputeChatMessage[]
): Promise<ZeroGComputeChatResponse> {
  const metadata = await broker.inference.getServiceMetadata(service.provider);
  const endpoint = normalizeChatCompletionsEndpoint(metadata.endpoint || service.url);
  const requestBody = {
    model: metadata.model || service.model || config.model,
    messages: [
      { role: "system", content: systemPrompt },
      ...cleanMessages
    ]
  };
  const billingHeaders = await broker.inference.getRequestHeaders(service.provider, JSON.stringify(requestBody));
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...billingHeaders
    },
    body: JSON.stringify(requestBody)
  });
  const data = await readComputeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || `0G Compute request failed with status ${response.status}`);
  }
  const chatId = response.headers.get("ZG-Res-Key") || response.headers.get("zg-res-key") || String(data.id || data.chatID || "");
  if (chatId) {
    await broker.inference.processResponse(service.provider, chatId, JSON.stringify(data.usage || data)).catch(() => null);
  }
  return {
    ...data,
    output_text: extractOutputText(data),
    model: data?.model || requestBody.model,
    network: config.network
  };
}

function getZeroGComputeConfig(): ZeroGComputeConfig {
  const network = getZeroGComputeNetwork();
  const model = network === "mainnet" ? DEFAULT_MAINNET_LLM_MODEL : DEFAULT_TESTNET_LLM_MODEL;

  return { model, network, deploymentEnvironment: getRuntimeDeploymentEnvironment() };
}

function getZeroGComputeNetwork(): ZeroGComputeNetwork {
  const configuredNetwork = env("OG_NETWORK").toLowerCase();
  if (configuredNetwork === "mainnet") {
    return "mainnet";
  }
  if (["galileo", "testnet"].includes(configuredNetwork)) {
    return "testnet";
  }

  const configuredChainId = Number(env("INFT_CHAIN_ID") || env("OG_CHAIN_ID") || "");
  const chain = getZeroGChainConfig(configuredChainId);
  return chain.id === 16661 ? "mainnet" : "testnet";
}

async function getZeroGComputeBroker(config: ZeroGComputeConfig, signer: ZeroGComputeSigner) {
  const cacheKey = [
    config.network,
    normalizeEnvSuffix(config.model),
    signer.source
  ].join(":");
  const cached = computeBrokers.get(cacheKey);
  if (cached) {
    return cached;
  }
  const brokerPromise = createZeroGComputeBroker(config.network, signer);
  computeBrokers.set(cacheKey, brokerPromise);
  return brokerPromise;
}

async function createZeroGComputeBroker(network: ZeroGComputeNetwork, signer: ZeroGComputeSigner): Promise<ZeroGComputeBroker> {
  const chain = getZeroGChainConfig(network === "mainnet" ? 16661 : 16602);
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(signer.privateKey, provider);
  return createZGComputeNetworkBroker(wallet);
}

async function selectZeroGComputeServices(
  broker: ZeroGComputeBroker,
  config: ZeroGComputeConfig,
  providerPreference?: ZeroGComputeProviderPreference
) {
  const services = await broker.inference.listService(0, 50, false);
  const chatbotServices = services.filter((service) => service.serviceType.toLowerCase() === "chatbot");
  const candidates = chatbotServices.length ? chatbotServices : services;
  if (providerPreference) {
    const selected = candidates.find((service) => sameAddress(service.provider, providerPreference.providerAddress)) ||
      services.find((service) => sameAddress(service.provider, providerPreference.providerAddress));
    if (!selected?.provider) {
      throw new Error(`${providerPreference.source} points to ${providerPreference.providerAddress}, but that provider is not available for ${config.network}.`);
    }
    return [selected];
  }

  const modelMatches = candidates.filter((service) => normalizedModelName(service.model).includes(normalizedModelName(config.model)));
  const selected = dedupeServicesByProvider([...modelMatches, ...candidates]);
  if (!selected.length) {
    throw new Error(`No live 0G Compute inference provider was available for ${config.network}.`);
  }
  return selected;
}

function resolveZeroGComputePrivateKey(config: ZeroGComputeConfig): ZeroGComputeSigner {
  const match = resolveScopedEnvValue("OG_COMPUTE_PRIVATE_KEY", config);
  if (match) {
    return { privateKey: match.value, source: match.name };
  }

  if (allowsLegacyComputeKeyFallback(config)) {
    const privateKey = env("OG_PRIVATE_KEY");
    if (privateKey) {
      return { privateKey, source: "OG_PRIVATE_KEY" };
    }
  }

  const candidates = scopedEnvCandidates("OG_COMPUTE_PRIVATE_KEY", config).slice(0, 8).join(", ");
  throw new Error(
    `A platform 0G Compute signer is required for live assistant requests. Configure one of: ${candidates}. ` +
      "Deployed assistant compute intentionally does not fall back to customer/project OG_PRIVATE_KEY."
  );
}

function resolveZeroGComputeProviderAddress(config: ZeroGComputeConfig): ZeroGComputeProviderPreference | undefined {
  const match = resolveScopedEnvValue("OG_COMPUTE_PROVIDER_ADDRESS", config);
  if (!match) {
    return undefined;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(match.value)) {
    throw new Error(`${match.name} must be a 0x-prefixed EVM provider address.`);
  }
  return { providerAddress: match.value, source: match.name };
}

function resolveScopedEnvValue(prefix: string, config: ZeroGComputeConfig) {
  for (const name of scopedEnvCandidates(prefix, config)) {
    const value = env(name);
    if (value) {
      return { name, value };
    }
  }
  return undefined;
}

function scopedEnvCandidates(prefix: string, config: ZeroGComputeConfig) {
  const deployment = normalizeEnvSuffix(config.deploymentEnvironment);
  const model = normalizeEnvSuffix(config.model);
  const networkTokens = zeroGComputeNetworkEnvTokens(config.network);
  return uniqueStrings([
    deployment && model ? `${prefix}_${deployment}_${model}` : "",
    ...networkTokens.map((network) => `${prefix}_${network}_${model}`),
    model ? `${prefix}_${model}` : "",
    deployment ? `${prefix}_${deployment}` : "",
    ...networkTokens.map((network) => `${prefix}_${network}`),
    prefix
  ]);
}

function zeroGComputeNetworkEnvTokens(network: ZeroGComputeNetwork) {
  const configuredNetwork = normalizeEnvSuffix(env("OG_NETWORK"));
  const defaults = network === "mainnet" ? ["MAINNET"] : ["TESTNET", "GALILEO"];
  return uniqueStrings([configuredNetwork, ...defaults]);
}

function normalizeEnvSuffix(value: string) {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function allowsLegacyComputeKeyFallback(config: ZeroGComputeConfig) {
  const deployment = normalizeEnvSuffix(config.deploymentEnvironment);
  return !process.env.VERCEL && !process.env.NOW_REGION && !["PRODUCTION", "PREVIEW", "STAGING"].includes(deployment);
}

function getRuntimeDeploymentEnvironment() {
  return (
    env("NEXT_PUBLIC_DEPLOYMENT_ENV") ||
    env("DEPLOYMENT_ENV") ||
    env("VERCEL_ENV") ||
    env("NEXT_PUBLIC_APP_ENV") ||
    process.env.NODE_ENV ||
    "local"
  );
}

function sameAddress(left: string, right: string) {
  if (!left || !right) {
    return false;
  }
  return left.toLowerCase() === right.toLowerCase();
}

function dedupeServicesByProvider(services: ZeroGComputeService[]) {
  const seen = new Set<string>();
  return services.filter((service) => {
    if (!service.provider) {
      return false;
    }
    const key = service.provider.toLowerCase();
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function shouldTryNextZeroGComputeProvider(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("sub-account not found") ||
    message.includes("service provider does not exist") ||
    message.includes("service not found") ||
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("econnreset") ||
    /status 5\d\d/.test(message)
  );
}

function decorateZeroGComputeProviderError(
  error: unknown,
  config: ZeroGComputeConfig,
  service: ZeroGComputeService | undefined,
  signerSource: string,
  providerPreference?: ZeroGComputeProviderPreference
) {
  const message = errorMessage(error);
  if (!service?.provider || !/sub-account not found/i.test(message)) {
    return error instanceof Error ? error : new Error(message);
  }

  const providerSource = providerPreference ? ` from ${providerPreference.source}` : "";
  return new Error(
    `0G Compute platform signer ${signerSource} does not have an initialized sub-account for provider ` +
      `${service.provider}${providerSource} on ${config.network}/${config.model}. ` +
      `Fund that platform wallet provider sub-account with transfer-fund, or set ${scopedEnvCandidates("OG_COMPUTE_PROVIDER_ADDRESS", config)[0]} ` +
      `to a funded provider. Original error: ${message}`
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

function normalizedModelName(value: string) {
  return value.toLowerCase().replace(/^.*\//, "");
}

function normalizeChatCompletionsEndpoint(endpoint: string) {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (!trimmed) {
    return "";
  }

  try {
    const url = new URL(trimmed);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (pathname.endsWith("/chat/completions")) {
      return url.toString();
    }
    if (pathname.endsWith("/v1/proxy")) {
      url.pathname = `${pathname}/chat/completions`;
      return url.toString();
    }
    if (pathname.endsWith("/v1")) {
      url.pathname = `${pathname}/proxy/chat/completions`;
      return url.toString();
    }
    if (!pathname || pathname === "/") {
      url.pathname = "/v1/proxy/chat/completions";
      return url.toString();
    }
    return trimmed;
  } catch {
    return trimmed;
  }
}

async function readComputeJson(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function extractOutputText(data: Record<string, any>) {
  if (typeof data.output_text === "string") {
    return data.output_text;
  }
  if (typeof data.outputText === "string") {
    return data.outputText;
  }
  if (typeof data.text === "string") {
    return data.text;
  }
  const firstChoice = Array.isArray(data.choices) ? data.choices[0] : undefined;
  const content = firstChoice?.message?.content || firstChoice?.delta?.content || firstChoice?.text;
  if (typeof content === "string") {
    return content;
  }
  return JSON.stringify(data, null, 2);
}
