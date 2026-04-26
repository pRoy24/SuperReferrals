import { env, isProviderMock } from "./env";
import { createId, nowIso } from "./ids";
import { getTransactionChainConfig } from "./payment-tokens";
import type { KeeperSettlementRecord } from "./types";

export async function createKeeperPaymentIntent({
  payerAddress,
  recipientAddress,
  amount,
  tokenAddress,
  settlementTokenAddress,
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
  paymentAmountAtomic?: string;
  paymentRecipientAddress?: string;
  amountUsd?: number;
  chainId: number;
  reason: string;
}) {
  const apiKey = env("KEEPERHUB_API_KEY");
  if (isProviderMock("KEEPERHUB") || !apiKey) {
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
        amountUsd,
        chainId
      }
    };
  }

  const baseUrl = env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api").replace(/\/$/, "");
  const network = env("KEEPERHUB_PAYMENT_NETWORK", getTransactionChainConfig(chainId).keeperHubNetwork);
  const workflowId = env("KEEPERHUB_PAYMENT_WORKFLOW_ID");
  if (workflowId) {
    const response = await fetch(`${baseUrl}/workflows/${workflowId}/webhook`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        network,
        payerAddress,
        recipientAddress,
        amount,
        amountUsd,
        paymentAmountAtomic,
        paymentRecipientAddress,
        paymentTokenAddress: tokenAddress,
        settlementTokenAddress,
        tokenAddress,
        chainId,
        reason
      })
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || data?.message || "KeeperHub payment workflow failed");
    }
    return data;
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
  if (isProviderMock("KEEPERHUB") || !apiKey) {
    return {
      executionId: createId("mock_refund"),
      status: "mock_completed",
      reason
    };
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
  if (isProviderMock("KEEPERHUB") || !apiKey) {
    return {
      mode: "distribution",
      status: "mock_completed",
      executionIds: allocations.map((allocation) => createId(`mock_keeper_${allocation.label.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}`)),
      allocations,
      rollbackPolicy: "Refund payer, cancel unsettled transfers, and mark the agent job rolled back.",
      createdAt: nowIso()
    };
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
        network: env("KEEPERHUB_PAYMENT_NETWORK", getTransactionChainConfig(chainId).keeperHubNetwork),
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
