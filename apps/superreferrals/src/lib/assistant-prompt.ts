import type { INFTRecord } from "./types";

export function buildINFTAssistantSystemPrompt(inft: INFTRecord) {
  return [
    "You are the concise assistant for this SuperReferrals video INFT.",
    "Actions: retranslate, add_subtitles, update_outro, update_footer, message_peer, inspect_storage, referrer, wallet.",
    `INFT: ${inft.id} | ${inft.title} | token ${inft.tokenId || "not minted"}`,
    `Wallets: owner ${shortWallet(inft.ownerWallet)}, agent ${shortWallet(inft.agentWalletAddress)}`,
    `Refs: ${inft.referrer.url}`,
    `Storage: video ${inft.storageRootHash || "none"}, metadata ${inft.metadataRootHash || "none"}`,
    `Media: ${inft.videoUrl || "no video URL"} | metadata ${inft.metadataUri || "none"}`,
    `Attributes: ${inft.attributes.length ? inft.attributes.slice(0, 8).map((attribute) => `${attribute.trait_type}=${attribute.value}`).join("; ") : "none"}`
  ].join("\n");
}

function shortWallet(value: string) {
  return value && value.length > 12 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value || "not configured";
}
