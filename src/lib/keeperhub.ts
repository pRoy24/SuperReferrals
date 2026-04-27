import { env, isProviderMock } from "./env";
import { createId, nowIso } from "./ids";
import { getTransactionChainConfig } from "./payment-tokens";
import type { KeeperSettlementRecord } from "./types";

type KeeperPaymentWorkflowEvent =
  | "quote_created"
  | "payment_confirmed"
  | "render_failed"
  | "refund_requested";

interface KeeperPaymentWorkflowPayload {
  event: KeeperPaymentWorkflowEvent;
  payerAddress: string;
  recipientAddress: string;
  amount: string;
  tokenAddress?: string;
  settlementTokenAddress?: string;
  settlementAmountAtomic?: string;
  paymentAmountAtomic?: string;
  paymentRecipientAddress?: string;
  paymentTxHash?: string;
  amountUsd?: number;
  chainId: number;
  quoteId?: string;
  generationId?: string;
  reason: string;
  metadata?: Record<string, unknown>;
}

export async function createKeeperPaymentIntent({
  payerAddress,
  recipientAddress,
  amount,
  tokenAddress,
  settlementTokenAddress,
  settlementAmountAtomic,
  paymentAmountAtomic,
  paymentRecipientAddress,
  amountUsd,
  chainId,
  reason
}: {
  payerAddress: string;
  recipientAddress: string;
  amount: string;
  tokenAddress?: string;
  settlementTokenAddress?: string;
  settlementAmountAtomic?: string;
  paymentAmountAtomic?: string;
  paymentRecipientAddress?: string;
  amountUsd?: number;
  chainId: number;
  reason: string;
}) {
  const apiKey = env("KEEPERHUB_API_KEY");
  if (isProviderMock("KEEPERHUB")) {
    return {
      executionId: createId("mock_keeper_payment"),
      status: "mock_ready",
      reason,
      instruction: {
        payerAddress,
        recipientAddress,
        amount,
        paymentAmountAtomic,
        paymentRecipientAddress,
        tokenAddress,
        settlementTokenAddress,
        settlementAmountAtomic,
        amountUsd,
        chainId
      }
    };
  }
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required when KEEPERHUB_MOCKS=false");
  }

  const baseUrl = env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "");
  const network = getKeeperHubPaymentNetwork(chainId);
  const workflowId = getKeeperHubPaymentWorkflowId(chainId);
  if (workflowId) {
    return {
      executionId: createId("keeper_quote"),
      status: "payment_ready",
      workflowId,
      network,
      reason,
      instruction: {
        event: "quote_created",
        payerAddress,
        recipientAddress,
        amount,
        amountUsd,
        paymentAmountAtomic,
        paymentRecipientAddress,
        tokenAddress,
        paymentTokenAddress: tokenAddress,
        settlementTokenAddress,
        settlementAmountAtomic,
        chainId
      }
    };
  }

  const response = await fetch(`${baseUrl}/execute/transfer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      network,
      recipientAddress,
      amount,
      tokenAddress,
      chainId,
      gasLimitMultiplier: "1.2",
      metadata: { reason, payerAddress, amountUsd, settlementTokenAddress, paymentAmountAtomic, paymentRecipientAddress }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "KeeperHub payment intent failed");
  }
  return data;
}

export async function confirmKeeperPaymentSettlement({
  payerAddress,
  recipientAddress,
  amount,
  tokenAddress,
  settlementTokenAddress,
  settlementAmountAtomic,
  paymentAmountAtomic,
  paymentRecipientAddress,
  paymentTxHash,
  amountUsd,
  chainId,
  quoteId,
  generationId,
  reason,
  metadata
}: Omit<KeeperPaymentWorkflowPayload, "event">) {
  if (isProviderMock("KEEPERHUB")) {
    return {
      executionId: createId("mock_keeper_settlement"),
      status: "mock_confirmed",
      event: "payment_confirmed",
      reason,
      paymentTxHash,
      quoteId,
      generationId
    };
  }
  const apiKey = env("KEEPERHUB_API_KEY");
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required when KEEPERHUB_MOCKS=false");
  }
  const workflowId = getKeeperHubPaymentWorkflowId(chainId);
  if (!workflowId) {
    throw new Error("KeeperHub payment workflow id is required to settle non-stable token payments.");
  }
  const baseUrl = env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "");
  const network = getKeeperHubPaymentNetwork(chainId);
  return postKeeperPaymentWorkflow({
    apiKey,
    baseUrl,
    workflowId,
    network,
    payload: {
      event: "payment_confirmed",
      payerAddress,
      recipientAddress,
      amount,
      amountUsd,
      paymentAmountAtomic,
      paymentRecipientAddress,
      paymentTxHash,
      tokenAddress,
      settlementTokenAddress,
      settlementAmountAtomic,
      chainId,
      quoteId,
      generationId,
      reason,
      metadata
    }
  });
}

export async function executeKeeperRefund({
  recipientAddress,
  amount,
  reason
}: {
  recipientAddress: string;
  amount: string;
  reason: string;
}) {
  const apiKey = env("KEEPERHUB_API_KEY");
  if (isProviderMock("KEEPERHUB")) {
    return {
      executionId: createId("mock_refund"),
      status: "mock_completed",
      reason
    };
  }
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required when KEEPERHUB_MOCKS=false");
  }
  const response = await fetch(`${env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "")}/execute/transfer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      network: env("KEEPERHUB_REFUND_NETWORK", getTransactionChainConfig().keeperHubNetwork),
      recipientAddress,
      amount,
      tokenAddress: env("KEEPERHUB_REFUND_TOKEN_ADDRESS") || undefined,
      chainId: getTransactionChainConfig().id,
      gasLimitMultiplier: "1.2"
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "KeeperHub refund transfer failed");
  }
  return data;
}

export async function executeKeeperDistribution({
  allocations,
  tokenAddress,
  chainId,
  reason
}: {
  allocations: Array<{
    label: string;
    recipientAddress: string;
    amountUsd: number;
  }>;
  tokenAddress?: string;
  chainId: number;
  reason: string;
}): Promise<KeeperSettlementRecord> {
  const apiKey = env("KEEPERHUB_API_KEY");
  if (isProviderMock("KEEPERHUB")) {
    return {
      mode: "distribution",
      status: "mock_completed",
      executionIds: allocations.map((allocation) => createId(`mock_keeper_${allocation.label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`)),
      allocations,
      rollbackPolicy: "Refund payer, cancel unsettled transfers, and mark the agent job rolled back.",
      createdAt: nowIso()
    };
  }
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required when KEEPERHUB_MOCKS=false");
  }

  const executionIds: string[] = [];
  for (const allocation of allocations) {
    if (allocation.amountUsd <= 0) {
      continue;
    }
    const response = await fetch(`${env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "")}/execute/transfer`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        network: getKeeperHubPaymentNetwork(chainId),
        recipientAddress: allocation.recipientAddress,
        amount: String(allocation.amountUsd),
        tokenAddress,
        chainId,
        gasLimitMultiplier: "1.2",
        metadata: { reason, label: allocation.label }
      })
    });
    const data = await response.json();
    if (!response.ok) {
      return {
        mode: "distribution",
        status: "failed",
        executionIds,
        allocations,
        rollbackPolicy: "Stop remaining transfers and trigger rollback/refund handling for completed legs.",
        createdAt: nowIso()
      };
    }
    executionIds.push(String(data.executionId || data.id || ""));
  }

  return {
    mode: "distribution",
    status: "completed",
    executionIds,
    allocations,
    rollbackPolicy: "Completed transfers are final; failed downstream work should create compensating refunds.",
    createdAt: nowIso()
  };
}

export async function executeKeeperRollback({
  recipientAddress,
  amount,
  reason
}: {
  recipientAddress: string;
  amount: string;
  reason: string;
}) {
  const refund = await executeKeeperRefund({ recipientAddress, amount, reason });
  return {
    mode: "rollback" as const,
    status: refund.status === "mock_completed" ? "mock_completed" as const : "completed" as const,
    executionIds: [String(refund.executionId || "")],
    allocations: [{ label: "rollback_refund", recipientAddress, amountUsd: Number(amount) || 0 }],
    rollbackPolicy: reason,
    createdAt: nowIso()
  };
}

export function getKeeperHubPaymentWorkflowId(chainId: number) {
  const chain = getTransactionChainConfig(chainId);
  return env(`KEEPERHUB_PAYMENT_WORKFLOW_ID_${chain.keeperHubNetwork.toUpperCase()}`) ||
    env(`KEEPERHUB_PAYMENT_WORKFLOW_ID_${chain.key.toUpperCase()}`) ||
    env("KEEPERHUB_PAYMENT_WORKFLOW_ID");
}

export function getKeeperHubPlatformWalletAddress(fallback = "") {
  return env("KEEPERHUB_PLATFORM_WALLET_ADDRESS", fallback);
}

function getKeeperHubPaymentNetwork(chainId: number) {
  const chain = getTransactionChainConfig(chainId);
  return env(`KEEPERHUB_PAYMENT_NETWORK_${chain.keeperHubNetwork.toUpperCase()}`) ||
    env(`KEEPERHUB_PAYMENT_NETWORK_${chain.key.toUpperCase()}`) ||
    chain.keeperHubNetwork;
}

async function postKeeperPaymentWorkflow({
  apiKey,
  baseUrl,
  workflowId,
  network,
  payload
}: {
  apiKey: string;
  baseUrl: string;
  workflowId: string;
  network: string;
  payload: KeeperPaymentWorkflowPayload;
}) {
  const response = await fetch(`${baseUrl}/workflow/${workflowId}/execute`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      ...payload,
      network,
      paymentTokenAddress: payload.tokenAddress
    })
  });
  const data = await parseKeeperResponse(response);
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || `KeeperHub payment workflow failed (${response.status})`);
  }
  return data;
}

async function parseKeeperResponse(response: Response) {
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
