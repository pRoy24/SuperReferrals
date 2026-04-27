import { env, isProviderMock } from "./env";

export async function askZeroGCompute(systemPrompt: string, question: string) {
  const endpoint = env("OG_COMPUTE_URL");
  if (isProviderMock("OG_COMPUTE")) {
    return {
      output_text:
        `${systemPrompt.split("\n").slice(0, 4).join(" ")} Requested task: ${question}. Use the action buttons for executable operations, or ask for storage/referrer details.`,
      mock: true
    };
  }
  if (!endpoint) {
    throw new Error("OG_COMPUTE_URL is required when OG_COMPUTE_MOCKS=false");
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(env("OG_COMPUTE_API_KEY") ? { authorization: `Bearer ${env("OG_COMPUTE_API_KEY")}` } : {})
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question }
      ]
    })
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data?.message || "0G Compute request failed");
  }
  return data;
}
