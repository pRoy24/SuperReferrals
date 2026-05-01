import { Contract, JsonRpcProvider, Wallet, ZeroAddress } from "ethers";
import {
  buildKeeperHubAllocations,
  collectiblesChainForEnvironment,
  paymentChainConfigForEnvironment,
  type Currency,
  type KeeperHubAllocation,
  type SuperStoresTransactionRequest,
  type SuperStoresTransactionResult
} from "./superstores";

const MARKETPLACE_ABI = [
  "function fulfillKeeperHubPurchase(uint256 listingId,uint256 quantity,address buyer,address referrer) external",
  "function keeperHubExecutor() view returns (address)"
];

export async function settleAndReleaseSuperStoresSale(
  input: SuperStoresTransactionRequest
): Promise<SuperStoresTransactionResult> {
  validateTransactionRequest(input);

  const paymentChain = paymentChainConfigForEnvironment(input.environment);
  const allocations = buildKeeperHubAllocations(input);
  const keeperHub = await executeKeeperHubSettlement({ input, allocations });
  const baseResult = {
    ok: keeperHub.status === "completed" || keeperHub.status === "mock_completed",
    saleId: input.saleId,
    paymentChain: paymentChain.key,
    paymentChainId: paymentChain.id,
    collectiblesChain: collectiblesChainForEnvironment(input.environment),
    keeperHub
  };

  if (keeperHub.status !== "completed" && keeperHub.status !== "mock_completed") {
    return {
      ...baseResult,
      ok: false,
      release: { status: "pending" }
    };
  }

  if (input.collectionMode === "database") {
    return {
      ...baseResult,
      release: { status: "not_required" }
    };
  }

  const release = await releaseCollectibleOn0G(input);
  return {
    ...baseResult,
    ok: release.status === "released" || release.status === "mock_released",
    release
  };
}

async function executeKeeperHubSettlement({
  input,
  allocations
}: {
  input: SuperStoresTransactionRequest;
  allocations: KeeperHubAllocation[];
}): Promise<SuperStoresTransactionResult["keeperHub"]> {
  const chain = paymentChainConfigForEnvironment(input.environment);
  const apiKey = env("KEEPERHUB_API_KEY");
  const workflowId = env(`KEEPERHUB_PAYMENT_WORKFLOW_ID_${chain.network.toUpperCase()}`) ||
    env(`KEEPERHUB_PAYMENT_WORKFLOW_ID_${chain.key.toUpperCase().replace(/-/g, "_")}`) ||
    env("KEEPERHUB_PAYMENT_WORKFLOW_ID");

  if (shouldMockTransactions()) {
    return {
      status: "mock_completed",
      network: chain.network,
      executionIds: allocations.map((allocation) => `mock_keeperhub_${input.saleId}_${allocation.label}`),
      allocations
    };
  }
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required when SUPERSTORES_MOCK_TRANSACTIONS=false.");
  }

  if (workflowId) {
    const data = await postKeeperHub({
      apiKey,
      path: `/workflow/${workflowId}/execute`,
      body: {
        event: "superstores_sale_settlement",
        network: chain.network,
        chainId: chain.id,
        saleId: input.saleId,
        listingId: input.listingId,
        buyerWallet: input.buyerWallet,
        buyerCurrency: input.buyerCurrency,
        settlementCurrency: input.settlementCurrency,
        finalAmount: input.finalAmount,
        allocations,
        metadata: {
          collectionMode: input.collectionMode,
          tokenStandard: input.tokenStandard,
          saleMechanism: input.saleMechanism,
          referrerCode: input.referrerCode || null
        }
      }
    });
    return {
      status: "completed",
      network: chain.network,
      executionIds: [String(data.executionId || data.id || workflowId)],
      allocations
    };
  }

  const executionIds: string[] = [];
  for (const allocation of allocations) {
    const data = await postKeeperHub({
      apiKey,
      path: "/execute/transfer",
      body: {
        network: chain.network,
        chainId: chain.id,
        recipientAddress: allocation.recipientAddress,
        amount: String(allocation.amount),
        tokenAddress: tokenAddressForCurrency(allocation.currency, chain.usdcAddress),
        gasLimitMultiplier: "1.2",
        metadata: {
          saleId: input.saleId,
          listingId: input.listingId,
          allocation: allocation.label,
          buyerWallet: input.buyerWallet
        }
      }
    });
    executionIds.push(String(data.executionId || data.id || ""));
  }

  return {
    status: "completed",
    network: chain.network,
    executionIds,
    allocations
  };
}

async function releaseCollectibleOn0G(
  input: SuperStoresTransactionRequest
): Promise<SuperStoresTransactionResult["release"]> {
  const marketplaceAddress = env("SUPERSTORES_MARKETPLACE_ADDRESS");
  const executorPrivateKey = env("SUPERSTORES_MARKETPLACE_EXECUTOR_PRIVATE_KEY") || env("OG_PRIVATE_KEY");
  const marketplaceListingId = input.marketplaceListingId || numericListingId(input.listingId);
  if (shouldMockTransactions()) {
    return {
      status: "mock_released",
      marketplaceAddress: marketplaceAddress || "mock_marketplace",
      txHash: `mock_0g_release_${input.saleId}`,
      gasEstimate: "120000"
    };
  }
  if (!marketplaceAddress) {
    throw new Error("SUPERSTORES_MARKETPLACE_ADDRESS is required for on-chain SuperStores releases.");
  }
  if (!executorPrivateKey) {
    throw new Error("SUPERSTORES_MARKETPLACE_EXECUTOR_PRIVATE_KEY or OG_PRIVATE_KEY is required for on-chain SuperStores releases.");
  }
  if (!marketplaceListingId) {
    throw new Error("marketplaceListingId is required to release an on-chain SuperStores listing.");
  }

  const provider = new JsonRpcProvider(env("OG_RPC_URL", defaultOgRpcUrl(input.environment)));
  const signer = new Wallet(executorPrivateKey, provider);
  const marketplace = new Contract(marketplaceAddress, MARKETPLACE_ABI, signer);
  const referrer = input.referrerWallet || ZeroAddress;
  const quantity = BigInt(Math.max(1, Math.floor(input.quantity || 1)));
  const gasEstimate = await marketplace.fulfillKeeperHubPurchase.estimateGas(
    BigInt(marketplaceListingId),
    quantity,
    input.buyerWallet,
    referrer
  );
  const tx = await marketplace.fulfillKeeperHubPurchase(
    BigInt(marketplaceListingId),
    quantity,
    input.buyerWallet,
    referrer,
    { gasLimit: (gasEstimate * 12n) / 10n }
  );
  const receipt = await tx.wait();
  return {
    status: receipt?.status === 1 ? "released" : "failed",
    marketplaceAddress,
    txHash: tx.hash,
    gasEstimate: gasEstimate.toString()
  };
}

async function postKeeperHub({
  apiKey,
  path,
  body
}: {
  apiKey: string;
  path: string;
  body: Record<string, unknown>;
}) {
  const response = await fetch(`${env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify(body)
  });
  const data = await parseResponse(response);
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `KeeperHub request failed (${response.status})`);
  }
  return data;
}

async function parseResponse(response: Response): Promise<Record<string, any>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function validateTransactionRequest(input: SuperStoresTransactionRequest) {
  if (!input.saleId || !input.listingId) {
    throw new Error("saleId and listingId are required.");
  }
  if (!isAddressLike(input.buyerWallet) || !isAddressLike(input.sellerWallet) || !isAddressLike(input.platformTreasuryWallet)) {
    throw new Error("buyer, seller, and platform treasury wallets are required.");
  }
  if (input.referrerWallet && !isAddressLike(input.referrerWallet)) {
    throw new Error("referrer wallet is invalid.");
  }
  if (input.finalAmount <= 0 || input.sellerAmount <= 0) {
    throw new Error("transaction amount must be greater than zero.");
  }
}

function tokenAddressForCurrency(currency: Currency, usdcAddress: string) {
  return currency === "USDC" ? usdcAddress : undefined;
}

function numericListingId(value: string) {
  return /^\d+$/.test(value) ? value : "";
}

function shouldMockTransactions() {
  const configured = env("SUPERSTORES_MOCK_TRANSACTIONS");
  if (configured) {
    return configured.toLowerCase() !== "false";
  }
  return env("NODE_ENV") !== "production";
}

function defaultOgRpcUrl(environment: string) {
  return collectiblesChainForEnvironment(environment) === "0g-mainnet"
    ? "https://evmrpc.0g.ai"
    : "https://evmrpc-testnet.0g.ai";
}

function isAddressLike(value: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(value);
}

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}
