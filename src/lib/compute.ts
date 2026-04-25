import { env, isMockMode } from "./env";

export async function askZeroGCompute(systemPrompt: string, question: string) {
  const endpoint = env("OG_COMPUTE_URL");
  if (isMockMode() || !endpoint) {
    return {
      output_text:
        `${systemPrompt.split("\n").slice(0, 4).join(" ")} Requested task: ${question}. Use the action buttons for executable operations, or ask for storage/referrer details.`,
      mock: true
    };
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
