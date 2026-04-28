import { env, isProviderMock } from "./env";
import { getZeroGChainConfig } from "./zero-g-chain";

type ZeroGComputeNetwork = "testnet" | "mainnet";

interface ZeroGComputeConfig {
  endpoint: string;
  model: string;
  network: ZeroGComputeNetwork;
}

const DEFAULT_TESTNET_LLM_MODEL = "qwen-2.5-7b-instruct";
const DEFAULT_MAINNET_LLM_MODEL = "gpt-oss-120b";

export async function askZeroGCompute(systemPrompt: string, question: string) {
  const config = getZeroGComputeConfig();
  if (isProviderMock("OG_COMPUTE")) {
    return {
      output_text:
        `${systemPrompt.split("\n").slice(0, 4).join(" ")} Requested task: ${question}. Use the action buttons for executable operations, or ask for storage/referrer details.`,
      model: config.model,
      network: config.network,
      mock: true
    };
  }
  if (!config.endpoint) {
    throw new Error(
      `${config.network === "mainnet" ? "OG_COMPUTE_MAINNET_URL" : "OG_COMPUTE_TESTNET_URL"} or OG_COMPUTE_URL is required when OG_COMPUTE_MOCKS=false`
    );
  }
  const response = await fetch(config.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env("OG_COMPUTE_API_KEY") ? { authorization: `Bearer ${env("OG_COMPUTE_API_KEY")}` } : {})
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
      ]
    })
  });
  const data = await readComputeJson(response);
  if (!response.ok) {
    throw new Error(data?.message || "0G Compute request failed");
  }
  return {
    ...data,
    output_text: extractOutputText(data),
    model: data?.model || config.model,
    network: config.network
  };
}

function getZeroGComputeConfig(): ZeroGComputeConfig {
  const network = getZeroGComputeNetwork();
  const endpoint = normalizeChatCompletionsEndpoint(
    env(network === "mainnet" ? "OG_COMPUTE_MAINNET_URL" : "OG_COMPUTE_TESTNET_URL") ||
      env("OG_COMPUTE_URL")
  );
  const model =
    env(network === "mainnet" ? "OG_COMPUTE_MAINNET_MODEL" : "OG_COMPUTE_TESTNET_MODEL") ||
    env("OG_COMPUTE_MODEL") ||
    (network === "mainnet" ? DEFAULT_MAINNET_LLM_MODEL : DEFAULT_TESTNET_LLM_MODEL);

  return { endpoint, model, network };
}

function getZeroGComputeNetwork(): ZeroGComputeNetwork {
  const configuredNetwork = (env("OG_COMPUTE_NETWORK") || env("OG_NETWORK")).toLowerCase();
  if (configuredNetwork === "mainnet") {
    return "mainnet";
  }
  if (["galileo", "testnet"].includes(configuredNetwork)) {
    return "testnet";
  }

  const configuredChainId = Number(env("OG_COMPUTE_CHAIN_ID") || env("INFT_CHAIN_ID") || env("OG_CHAIN_ID") || "");
  const chain = getZeroGChainConfig(configuredChainId);
  return chain.id === 16661 ? "mainnet" : "testnet";
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
