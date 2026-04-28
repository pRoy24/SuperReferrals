import { createRequire } from "node:module";
import { JsonRpcProvider, Wallet } from "ethers";
import { env, isProviderMock } from "./env";
import { getZeroGChainConfig } from "./zero-g-chain";

type ZeroGComputeNetwork = "testnet" | "mainnet";
export type ZeroGComputeChatRole = "user" | "assistant";

export interface ZeroGComputeChatMessage {
  role: ZeroGComputeChatRole;
  content: string;
}

interface ZeroGComputeConfig {
  model: string;
  network: ZeroGComputeNetwork;
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

const computeBrokers = new Map<ZeroGComputeNetwork, Promise<ZeroGComputeBroker>>();

export async function askZeroGCompute(systemPrompt: string, question: string) {
  return askZeroGComputeChat(systemPrompt, [{ role: "user", content: question }]);
}

export async function askZeroGComputeChat(systemPrompt: string, messages: ZeroGComputeChatMessage[]) {
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
  const broker = await getZeroGComputeBroker(config.network);
  const service = await selectZeroGComputeService(broker, config);
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
    throw new Error(data?.message || "0G Compute request failed");
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

  return { model, network };
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

async function getZeroGComputeBroker(network: ZeroGComputeNetwork) {
  const cached = computeBrokers.get(network);
  if (cached) {
    return cached;
  }
  const brokerPromise = createZeroGComputeBroker(network);
  computeBrokers.set(network, brokerPromise);
  return brokerPromise;
}

async function createZeroGComputeBroker(network: ZeroGComputeNetwork): Promise<ZeroGComputeBroker> {
  const privateKey = env("OG_PRIVATE_KEY");
  if (!privateKey) {
    throw new Error("OG_PRIVATE_KEY is required for live 0G Compute requests.");
  }
  const chain = getZeroGChainConfig(network === "mainnet" ? 16661 : 16602);
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  return createZGComputeNetworkBroker(wallet);
}

async function selectZeroGComputeService(broker: ZeroGComputeBroker, config: ZeroGComputeConfig) {
  const services = await broker.inference.listService(0, 50, false);
  const chatbotServices = services.filter((service) => service.serviceType.toLowerCase() === "chatbot");
  const candidates = chatbotServices.length ? chatbotServices : services;
  const preferred = candidates.find((service) => normalizedModelName(service.model).includes(normalizedModelName(config.model)));
  const selected = preferred || candidates[0];
  if (!selected?.provider) {
    throw new Error(`No live 0G Compute inference provider was available for ${config.network}.`);
  }
  return selected;
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
