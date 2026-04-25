import { env, isMockMode } from "./env";
import { createId, nowIso } from "./ids";

export async function getAxlTopology() {
  if (isMockMode()) {
    return {
      self: "mock-peer",
      peers: ["mock-peer-video-a", "mock-peer-video-b"],
      updatedAt: nowIso()
    };
  }
  const response = await fetch(`${env("AXL_BASE_URL", "http://localhost:9002")}/topology`, {
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error(`AXL topology failed: ${response.status}`);
  }
  return response.json();
}

export async function sendAxlMessage(peerId: string, payload: unknown) {
  if (isMockMode()) {
    return {
      messageId: createId("mock_axl"),
      peerId,
      payload,
      status: "mock_sent"
    };
  }
  const response = await fetch(`${env("AXL_BASE_URL", "http://localhost:9002")}/send`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ to: peerId, payload })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "AXL send failed");
  }
  return data;
}
