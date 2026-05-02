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
  reason,
  deferSettlement = false
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
  deferSettlement?: boolean;
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
    throw new Error("KEEPERHUB_API_KEY is required for live KeeperHub requests.");
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
  if (deferSettlement) {
    return {
      executionId: createId("keeper_deferred_quote"),
      status: "payment_ready",
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
        chainId,
        settlementPolicy: "defer_until_render_completed"
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

export async function completeKeeperPaymentSettlement({
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
      executionId: createId("mock_keeper_completion"),
      status: "mock_confirmed",
      event: "payment_confirmed",
      reason,
      paymentTxHash,
      quoteId,
      generationId
    };
  }
  const workflowId = getKeeperHubPaymentWorkflowId(chainId);
  if (workflowId) {
    return confirmKeeperPaymentSettlement({
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
    });
  }
  if (tokenAddress && settlementTokenAddress && tokenAddress.toLowerCase() !== settlementTokenAddress.toLowerCase()) {
    throw new Error("KEEPERHUB_PAYMENT_WORKFLOW_ID is required to settle converted KeeperHub render payments.");
  }
  return executeKeeperTransfer({
    recipientAddress,
    amount,
    tokenAddress: settlementTokenAddress || tokenAddress,
    chainId,
    reason,
    metadata: {
      event: "payment_confirmed",
      payerAddress,
      paymentRecipientAddress,
      paymentTxHash,
      amountUsd,
      paymentAmountAtomic,
      settlementAmountAtomic,
      quoteId,
      generationId,
      ...(metadata || {})
    }
  });
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
    throw new Error("KEEPERHUB_API_KEY is required for live KeeperHub requests.");
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

export async function requestKeeperPaymentRefund({
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
      executionId: createId("mock_keeper_refund"),
      status: "mock_completed",
      event: "render_failed",
      reason,
      paymentTxHash,
      quoteId,
      generationId
    };
  }
  const apiKey = env("KEEPERHUB_API_KEY");
  if (!apiKey) {
    throw new Error("KEEPERHUB_API_KEY is required for live KeeperHub refund requests.");
  }
  const workflowId = getKeeperHubPaymentWorkflowId(chainId);
  if (workflowId) {
    const baseUrl = env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "");
    const network = getKeeperHubPaymentNetwork(chainId);
    return postKeeperPaymentWorkflow({
      apiKey,
      baseUrl,
      workflowId,
      network,
      payload: {
        event: "render_failed",
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
  if (tokenAddress && settlementTokenAddress && tokenAddress.toLowerCase() !== settlementTokenAddress.toLowerCase()) {
    throw new Error("KEEPERHUB_PAYMENT_WORKFLOW_ID is required to refund converted KeeperHub render payments.");
  }
  return executeKeeperRefund({
    recipientAddress: payerAddress,
    amount,
    tokenAddress: tokenAddress || settlementTokenAddress,
    chainId,
    reason,
    metadata: {
      event: "render_failed",
      storefrontRecipientAddress: recipientAddress,
      paymentRecipientAddress,
      paymentTxHash,
      amountUsd,
      paymentAmountAtomic,
      settlementAmountAtomic,
      quoteId,
      generationId,
      ...(metadata || {})
    }
  });
}

export async function executeKeeperRefund({
  recipientAddress,
  amount,
  reason,
  tokenAddress,
  chainId,
  metadata
}: {
  recipientAddress: string;
  amount: string;
  reason: string;
  tokenAddress?: string;
  chainId?: number;
  metadata?: Record<string, unknown>;
}) {
  return executeKeeperTransfer({
    recipientAddress,
    amount,
    tokenAddress,
    chainId,
    reason,
    metadata
  });
}

async function executeKeeperTransfer({
  recipientAddress,
  amount,
  reason,
  tokenAddress,
  chainId,
  metadata
}: {
  recipientAddress: string;
  amount: string;
  reason: string;
  tokenAddress?: string;
  chainId?: number;
  metadata?: Record<string, unknown>;
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
    throw new Error("KEEPERHUB_API_KEY is required for live KeeperHub requests.");
  }
  const transferChain = chainId || getTransactionChainConfig().id;
  const response = await fetch(`${env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "")}/execute/transfer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      network: env("KEEPERHUB_REFUND_NETWORK", getTransactionChainConfig(transferChain).keeperHubNetwork),
      recipientAddress,
      amount,
      tokenAddress,
      chainId: transferChain,
      gasLimitMultiplier: "1.2",
      metadata: { reason, ...(metadata || {}) }
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "KeeperHub transfer failed");
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
    throw new Error("KEEPERHUB_API_KEY is required for live KeeperHub requests.");
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

export function getKeeperHubWalletAddress(fallback = "") {
  return env("KEEPERHUB_WALLET_ADDRESS", fallback);
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
