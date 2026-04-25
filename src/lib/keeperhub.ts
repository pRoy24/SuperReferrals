import { env, isMockMode } from "./env";
import { createId } from "./ids";

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
  if (isMockMode() || !apiKey) {
    return {
      executionId: createId("mock_refund"),
      status: "mock_completed",
      reason
    };
  }
  const response = await fetch(`${env("KEEPERHUB_BASE_URL", "https://app.keeperhub.com/api")}/execute/transfer`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      network: env("KEEPERHUB_REFUND_NETWORK", "base"),
      recipientAddress,
      amount,
      tokenAddress: env("KEEPERHUB_REFUND_TOKEN_ADDRESS") || undefined,
      gasLimitMultiplier: "1.2"
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.error?.message || data?.message || "KeeperHub refund transfer failed");
  }
  return data;
}
