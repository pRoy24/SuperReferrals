"use client";

import { Flame, RefreshCw, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { encodeFunctionData, parseAbi } from "viem";
import VideoMosaic from "@/components/VideoMosaic";
import { requestWalletAccounts, type EthereumProvider } from "@/lib/browser-wallets";
import { fetchWithSamsarAuth } from "@/lib/storefront-auth-client";
import type { Generation, INFTRecord, PublicFeedItem, SuperReferralsStore, VideoAspectRatio, VideoModel } from "@/lib/types";

type StorefrontVideoItem = PublicFeedItem & {
  creatorWallet?: string;
  published: boolean;
  source: "published" | "inft";
};

type StorefrontVideoMode = "published" | "infts";
type StorefrontVideoAction = "publish" | "unpublish" | "burn" | "unpublish_and_burn" | "prepare_burn";
type INFTBurnChain = {
  id: number;
  hexChainId?: string;
  name: string;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
  rpcUrls: string[];
  blockExplorerUrls?: string[];
};
type INFTBurnRequest = {
  tokenId?: string;
  contractAddress?: string;
  mock?: boolean;
  chain?: INFTBurnChain;
};

type StorefrontVideoGridProps = {
  actor: "owner" | "user";
  allowBurn?: boolean;
  customerId: string;
  emptyText?: string;
  initialPageSize?: number;
  onRefresh?: () => Promise<void> | void;
  pageSizeOptions?: number[];
  publishedOnly?: boolean;
  ethereumProvider?: EthereumProvider | null;
  showCreatorWallet?: boolean;
  store: SuperReferralsStore;
  subAccountId?: string;
  wallet?: string;
};

const inftBurnAbi = parseAbi(["function burnAgent(uint256 tokenId)"]);

export default function StorefrontVideoGrid({
  actor,
  allowBurn = false,
  customerId,
  emptyText = "No videos yet.",
  initialPageSize = 9,
  onRefresh,
  pageSizeOptions = [6, 9, 12, 24],
  showCreatorWallet = false,
  ethereumProvider,
  store,
  subAccountId,
  wallet
}: StorefrontVideoGridProps) {
  const [busyAction, setBusyAction] = useState("");
  const [mode, setMode] = useState<StorefrontVideoMode>("published");
  const [message, setMessage] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(initialPageSize);
  const items = useMemo(
    () => mode === "infts"
      ? buildStorefrontINFTItems(store, { customerId, subAccountId })
      : buildStorefrontVideoItems(store, { customerId, publishedOnly: true, subAccountId }),
    [customerId, mode, store, subAccountId]
  );
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const normalizedPage = Math.min(page, pageCount);
  const pageItems = items.slice((normalizedPage - 1) * pageSize, normalizedPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [customerId, pageSize, mode, subAccountId]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  async function updateVideo(item: StorefrontVideoItem, action: StorefrontVideoAction) {
    if (actor === "user" && isBurnAction(action)) {
      await updateVideoWithWalletBurn(item, action);
      return;
    }

    setBusyAction(`${action}:${item.generationId}`);
    setMessage("");
    try {
      await sendGenerationAction(item, action);
      await onRefresh?.();
      setMessage(actionMessage(action));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video update failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function updateVideoWithWalletBurn(item: StorefrontVideoItem, action: StorefrontVideoAction) {
    setBusyAction(`${action}:${item.generationId}`);
    setMessage("");
    try {
      const prepared = await sendGenerationAction(item, "prepare_burn");
      const burnRequest = readBurnRequest(prepared);
      let burnTxHash = cleanText((prepared.burn as Record<string, unknown> | undefined)?.txHash);
      if (!burnRequest.mock) {
        setMessage("Confirm the INFT burn in your wallet.");
        burnTxHash = await requestWalletINFTBurn({
          provider: ethereumProvider,
          ownerWallet: wallet,
          burnRequest
        });
      }
      await sendGenerationAction(item, action, { burnTxHash });
      await onRefresh?.();
      setMessage(actionMessage(action));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video update failed.");
    } finally {
      setBusyAction("");
    }
  }

  async function sendGenerationAction(
    item: StorefrontVideoItem,
    action: StorefrontVideoAction,
    extra: Record<string, unknown> = {}
  ) {
    const fetcher = actor === "owner" ? fetchWithSamsarAuth : fetch;
    const response = await fetcher(`/api/generations/${encodeURIComponent(item.generationId)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action,
        actor,
        customerId,
        subAccountId,
        wallet,
        ...extra
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.message || "Video update failed.");
    }
    return data as Record<string, unknown>;
  }

  return (
    <div className="storefront-video-grid-manager">
      <div className="storefront-video-grid-toolbar">
        <div className="storefront-video-count">
          <strong>{items.length}</strong>
          <span>{mode === "infts" ? "INFTs" : "published videos"}</span>
        </div>
        <div className="storefront-video-mode-toggle" role="group" aria-label="Video view">
          <button className={mode === "published" ? "active" : ""} onClick={() => setMode("published")} type="button">
            Published
          </button>
          <button className={mode === "infts" ? "active" : ""} onClick={() => setMode("infts")} type="button">
            INFTs
          </button>
        </div>
        <label className="storefront-video-page-size">
          <SlidersHorizontal size={15} />
          <span>Items</span>
          <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
            {pageSizeOptions.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
      </div>

      {message && <p className="notice compact">{message}</p>}

      <VideoMosaic
        actions={(item) => (
          <VideoActions
            allowBurn={allowBurn}
            busyAction={busyAction}
            item={item as StorefrontVideoItem}
            onAction={updateVideo}
          />
        )}
        emptyText={mode === "infts" ? "No INFT videos for this storefront yet." : emptyText}
        getCreatorWallet={(item) => (item as StorefrontVideoItem).creatorWallet}
        items={pageItems}
        key={mode}
        moreHref=""
        showCreatorWallet={showCreatorWallet}
        showFeedLink={(item) => (item as StorefrontVideoItem).published}
        showInftLink
      />

      {items.length > 0 && (
        <div className="storefront-video-pagination">
          <button className="btn small" disabled={normalizedPage <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))} type="button">
            Previous
          </button>
          <span>Page {normalizedPage} of {pageCount}</span>
          <button className="btn small" disabled={normalizedPage >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))} type="button">
            Next
          </button>
        </div>
      )}
    </div>
  );
}

function VideoActions({
  allowBurn,
  busyAction,
  item,
  onAction
}: {
  allowBurn: boolean;
  busyAction: string;
  item: StorefrontVideoItem;
  onAction: (item: StorefrontVideoItem, action: StorefrontVideoAction) => Promise<void>;
}) {
  const publishBusy = busyAction === `publish:${item.generationId}`;
  const unpublishBusy = busyAction === `unpublish:${item.generationId}`;
  const directBurnBusy = busyAction === `burn:${item.generationId}`;
  const burnBusy = busyAction === `unpublish_and_burn:${item.generationId}`;
  if (!item.published) {
    return (
      <>
        <button className="video-mosaic-action" disabled={Boolean(busyAction)} onClick={() => onAction(item, "publish")} type="button">
          {publishBusy ? <RefreshCw size={14} className="spin" /> : null}
          Publish
        </button>
        {allowBurn && item.source === "inft" && (
          <button
            className="video-mosaic-action danger"
            disabled={Boolean(busyAction) || !item.inftId}
            onClick={() => onAction(item, "burn")}
            title={item.inftId ? "Burn INFT" : "This video has no INFT to burn"}
            type="button"
          >
            {directBurnBusy ? <RefreshCw size={14} className="spin" /> : <Flame size={14} />}
            Burn
          </button>
        )}
      </>
    );
  }
  return (
    <>
      <button className="video-mosaic-action" disabled={Boolean(busyAction)} onClick={() => onAction(item, "unpublish")} type="button">
        {unpublishBusy ? <RefreshCw size={14} className="spin" /> : null}
        Unpublish
      </button>
      {allowBurn && (
        <button
          className="video-mosaic-action danger"
          disabled={Boolean(busyAction) || !item.inftId}
          onClick={() => onAction(item, item.source === "inft" ? "burn" : "unpublish_and_burn")}
          title={item.inftId ? "Unpublish and burn INFT" : "This video has no INFT to burn"}
          type="button"
        >
          {burnBusy || directBurnBusy ? <RefreshCw size={14} className="spin" /> : <Flame size={14} />}
          {item.source === "inft" ? "Burn" : "Unpublish & burn"}
        </button>
      )}
    </>
  );
}

function actionMessage(action: StorefrontVideoAction) {
  if (action === "publish") {
    return "INFT published to the video feed.";
  }
  if (action === "burn") {
    return "INFT burned and video records removed.";
  }
  if (action === "unpublish_and_burn") {
    return "Video unpublished, INFT burned, and records removed.";
  }
  return "Video unpublished.";
}

function isBurnAction(action: StorefrontVideoAction) {
  return action === "burn" || action === "unpublish_and_burn";
}

function buildStorefrontVideoItems(
  store: SuperReferralsStore,
  filters: { customerId: string; publishedOnly?: boolean; subAccountId?: string }
): StorefrontVideoItem[] {
  return store.generations
    .filter((generation) =>
      generation.customerId === filters.customerId &&
      generation.status === "COMPLETED" &&
      (!filters.subAccountId || generation.subAccountId === filters.subAccountId) &&
      (!filters.publishedOnly || generation.feed?.published === true)
    )
    .map((generation) => buildStorefrontVideoItem(store, generation))
    .filter((item): item is StorefrontVideoItem => Boolean(item))
    .sort((left, right) => videoTime(right) - videoTime(left));
}

function buildStorefrontVideoItem(store: SuperReferralsStore, generation: Generation): StorefrontVideoItem | null {
  const inft = store.infts.find((item) => item.generationId === generation.id || item.id === generation.inftId);
  const videoUrl = generation.resultUrl || inft?.videoUrl || "";
  if (!videoUrl) {
    return null;
  }
  const customer = store.customers.find((item) => item.id === generation.customerId);
  const subAccount = store.subAccounts.find((item) => item.id === generation.subAccountId);
  const comments = store.feedComments
    .filter((comment) => comment.generationId === generation.id)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 12)
    .reverse();
  const commentCount = store.feedComments.filter((comment) => comment.generationId === generation.id).length;
  const likes = store.feedLikes.filter((like) => like.generationId === generation.id).length;
  const views = store.feedViews
    .filter((view) => view.generationId === generation.id)
    .reduce((total, view) => total + Math.max(0, view.count || 0), 0);
  const publishedAt = generation.feed?.publishedAt || generation.updatedAt || generation.createdAt;

  return {
    id: generation.id,
    generationId: generation.id,
    inftId: inft?.id || generation.inftId,
    customerId: generation.customerId,
    customerName: customer?.name || "SuperReferrals customer",
    subAccountId: generation.subAccountId,
    authorName: cleanText(subAccount?.username) || cleanText(subAccount?.email?.split("@")[0]) || "SuperReferrals creator",
    creatorWallet: subAccount?.wallet,
    referrerCode: generation.referrerCode,
    title: feedTitle(generation, inft),
    description: feedDescription(generation, inft),
    videoUrl,
    posterUrl: firstImageUrl(generation),
    aspectRatio: generation.input.aspect_ratio,
    videoModel: generation.input.video_model,
    tags: generation.feed?.tags || [],
    metrics: {
      likes,
      comments: commentCount,
      views,
      score: likes * 8 + commentCount * 12 + views
    },
    comments,
    likedByViewer: false,
    createdAt: generation.createdAt,
    publishedAt,
    published: generation.feed?.published === true,
    source: "published"
  };
}

function buildStorefrontINFTItems(
  store: SuperReferralsStore,
  filters: { customerId: string; subAccountId?: string }
): StorefrontVideoItem[] {
  return store.infts
    .filter((inft) =>
      inft.customerId === filters.customerId &&
      (!filters.subAccountId || inft.subAccountId === filters.subAccountId)
    )
    .map((inft) => buildStorefrontINFTItem(store, inft))
    .filter((item): item is StorefrontVideoItem => Boolean(item))
    .sort((left, right) => videoTime(right) - videoTime(left));
}

function buildStorefrontINFTItem(store: SuperReferralsStore, inft: INFTRecord): StorefrontVideoItem | null {
  const generation = store.generations.find((item) => item.id === inft.generationId || item.inftId === inft.id);
  const generationId = generation?.id || inft.generationId;
  const videoUrl = inft.videoUrl || generation?.resultUrl || "";
  if (!videoUrl || !generationId) {
    return null;
  }
  const customer = store.customers.find((item) => item.id === inft.customerId);
  const subAccount = store.subAccounts.find((item) => item.id === inft.subAccountId);
  const comments = store.feedComments
    .filter((comment) => comment.generationId === generationId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, 12)
    .reverse();
  const commentCount = store.feedComments.filter((comment) => comment.generationId === generationId).length;
  const likes = store.feedLikes.filter((like) => like.generationId === generationId).length;
  const views = store.feedViews
    .filter((view) => view.generationId === generationId)
    .reduce((total, view) => total + Math.max(0, view.count || 0), 0);

  return {
    id: inft.id,
    generationId,
    inftId: inft.id,
    customerId: inft.customerId,
    customerName: customer?.name || "SuperReferrals customer",
    subAccountId: inft.subAccountId,
    authorName: cleanText(subAccount?.username) || cleanText(subAccount?.email?.split("@")[0]) || "SuperReferrals creator",
    creatorWallet: inft.ownerWallet || subAccount?.wallet,
    referrerCode: generation?.referrerCode || inft.referrer.code,
    title: cleanText(inft.title) || (generation ? feedTitle(generation, inft) : "SuperReferrals INFT"),
    description: cleanText(inft.description) || (generation ? feedDescription(generation, inft) : "Generated SuperReferrals INFT"),
    videoUrl,
    posterUrl: generation ? firstImageUrl(generation) : undefined,
    aspectRatio: generation?.input.aspect_ratio || inftAspectRatio(inft),
    videoModel: generation?.input.video_model || inftVideoModel(inft),
    tags: generation?.feed?.tags || [],
    metrics: {
      likes,
      comments: commentCount,
      views,
      score: likes * 8 + commentCount * 12 + views
    },
    comments,
    likedByViewer: false,
    createdAt: inft.createdAt,
    publishedAt: generation?.feed?.publishedAt || inft.updatedAt || inft.createdAt,
    published: generation?.feed?.published === true,
    source: "inft"
  };
}

function feedTitle(generation: Generation, inft?: INFTRecord) {
  return cleanText(generation.input.metadata?.title) ||
    titleFromSlug(cleanText(generation.input.metadata?.slug)) ||
    inft?.title ||
    "SuperReferrals Video";
}

function feedDescription(generation: Generation, inft?: INFTRecord) {
  return cleanText(generation.input.metadata?.description) ||
    cleanText(generation.input.prompt) ||
    inft?.description ||
    "Published SuperReferrals video";
}

function titleFromSlug(value: string) {
  const slug = value
    .trim()
    .split(/[/?#]/)[0]
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!slug) {
    return "";
  }
  return slug
    .split(" ")
    .map((part) => part ? part[0]!.toUpperCase() + part.slice(1) : "")
    .join(" ");
}

function firstImageUrl(generation: Generation) {
  for (const item of generation.input.image_urls || []) {
    if (typeof item === "string" && item.trim()) {
      return item.trim();
    }
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const record = item as Record<string, unknown>;
      const value = cleanText(record.image_url) || cleanText(record.imageUrl) || cleanText(record.url);
      if (value) {
        return value;
      }
    }
  }
  return undefined;
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function inftAspectRatio(inft: INFTRecord): VideoAspectRatio {
  return inftAttribute(inft, "aspect_ratio") === "9:16" ? "9:16" : "16:9";
}

function inftVideoModel(inft: INFTRecord): VideoModel {
  const value = inftAttribute(inft, "video_model");
  if (value === "VEO3.1I2V" || value === "SEEDANCEI2V" || value === "KLING3.0" || value === "RUNWAYML") {
    return value;
  }
  return "RUNWAYML";
}

function inftAttribute(inft: INFTRecord, traitType: string) {
  const attribute = inft.attributes.find((item) => item.trait_type === traitType);
  return typeof attribute?.value === "string" ? attribute.value.trim() : "";
}

function videoTime(item: StorefrontVideoItem) {
  return Date.parse(item.publishedAt || item.createdAt) || 0;
}

function readBurnRequest(data: Record<string, unknown>): INFTBurnRequest {
  const burnRequest = data.burnRequest && typeof data.burnRequest === "object"
    ? data.burnRequest as INFTBurnRequest
    : {};
  if (burnRequest.mock) {
    return burnRequest;
  }
  if (!burnRequest.contractAddress || !burnRequest.tokenId || !burnRequest.chain) {
    throw new Error("Burn request is missing INFT contract, token, or chain details.");
  }
  return burnRequest;
}

async function requestWalletINFTBurn({
  provider,
  ownerWallet,
  burnRequest
}: {
  provider?: EthereumProvider | null;
  ownerWallet?: string;
  burnRequest: INFTBurnRequest;
}) {
  if (!provider) {
    throw new Error("Connect this wallet in a wallet-enabled browser before burning the INFT.");
  }
  const chain = burnRequest.chain;
  const tokenId = burnRequest.tokenId;
  const contractAddress = burnRequest.contractAddress;
  if (!chain || !tokenId || !contractAddress) {
    throw new Error("Burn request is missing INFT contract, token, or chain details.");
  }
  await ensureWalletNetwork(provider, chain);
  const accounts = await requestWalletAccounts(provider);
  const owner = ownerWallet?.trim();
  const from = accounts.find((account) => sameWallet(account, owner)) || accounts[0];
  if (!from) {
    throw new Error("Connect the INFT owner wallet before burning.");
  }
  if (owner && !sameWallet(from, owner)) {
    throw new Error("The connected wallet does not match the INFT owner wallet.");
  }

  const transaction = {
    from,
    to: contractAddress,
    data: encodeFunctionData({
      abi: inftBurnAbi,
      functionName: "burnAgent",
      args: [BigInt(tokenId)]
    }),
    value: "0x0"
  };
  const gas = await estimateWalletGas(provider, transaction, chain.name);
  const txHash = String(await provider.request({
    method: "eth_sendTransaction",
    params: [compactTransaction({ ...transaction, gas })]
  }));
  const receipt = await waitForWalletReceipt(provider, txHash, 120000);
  if (!receipt) {
    throw new Error("Timed out waiting for the INFT burn transaction to confirm.");
  }
  if (!isSuccessfulReceipt(receipt)) {
    throw new Error("INFT burn transaction reverted.");
  }
  return txHash;
}

async function ensureWalletNetwork(provider: EthereumProvider, chain: INFTBurnChain) {
  const hexChainId = chain.hexChainId || `0x${chain.id.toString(16)}`;
  const currentChainId = await provider.request({ method: "eth_chainId" }).catch(() => "");
  if (String(currentChainId).toLowerCase() === hexChainId.toLowerCase()) {
    return;
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }]
    });
  } catch (error) {
    if (walletErrorCode(error) !== 4902) {
      throw new Error(`Switch wallet to ${chain.name} to continue.`);
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: hexChainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls,
        blockExplorerUrls: chain.blockExplorerUrls || []
      }]
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }]
    });
  }
}

async function estimateWalletGas(provider: EthereumProvider, transaction: Record<string, unknown>, chainName: string) {
  try {
    const gas = BigInt(String(await provider.request({
      method: "eth_estimateGas",
      params: [compactTransaction(transaction)]
    })));
    return `0x${((gas * 12n) / 10n + 1n).toString(16)}`;
  } catch (error) {
    throw new Error(`INFT burn gas estimate failed on ${chainName}: ${formatErrorMessage(error, "wallet gas estimate failed")}.`);
  }
}

async function waitForWalletReceipt(provider: EthereumProvider, txHash: string, timeoutMs = 60000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const receipt = await provider.request({
      method: "eth_getTransactionReceipt",
      params: [txHash]
    }).catch(() => null);
    if (receipt) {
      return receipt;
    }
    await delay(3000);
  }
  return null;
}

function compactTransaction(tx: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(tx).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function isSuccessfulReceipt(receipt: unknown) {
  if (!receipt || typeof receipt !== "object") {
    return false;
  }
  const status = (receipt as { status?: unknown }).status;
  if (typeof status === "string") {
    return status.toLowerCase() === "0x1" || status === "1";
  }
  if (typeof status === "number") {
    return status === 1;
  }
  if (typeof status === "boolean") {
    return status;
  }
  return false;
}

function walletErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : 0;
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error) {
    const record = error as Record<string, unknown>;
    const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : undefined;
    return String(record.message || nested?.message || fallback);
  }
  return fallback;
}

function sameWallet(left?: string, right?: string) {
  return Boolean(left && right && left.trim().toLowerCase() === right.trim().toLowerCase());
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
