"use client";

import { AlertTriangle, ArrowDown, ArrowUp, Bot, ChevronDown, CircleDollarSign, CircleHelp, Code2, ExternalLink, GripVertical, ListChecks, Play, Plus, RefreshCw, Store, Trash2, Undo2, Upload, Wallet } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import { UserStoreCreatorSkeleton } from "@/components/FormLoadingSkeletons";
import StorefrontRatingForm from "@/components/StorefrontRatingForm";
import StorefrontVideoGrid from "@/components/StorefrontVideoGrid";
import {
  requestWalletAccounts,
  subscribeToBrowserWalletProviders,
  type BrowserWalletProvider,
  type EthereumProvider
} from "@/lib/browser-wallets";
import {
  findPaymentToken,
  getPaymentTokens,
  getTransactionChainConfig,
  normalizeTransactionChainIdForEnvironment,
  settlementTokenForCurrency,
  type PaymentToken,
  type TransactionChainConfig
} from "@/lib/payment-tokens";
import {
  estimateDurationSeconds,
  getAllowedModelPricingConfigurations,
  getRenderConditionError,
  getStorefrontConditionTiles,
  getStorefrontMaxImages,
  resolveModelPriceDetails
} from "@/lib/pricing";
import { getStorefrontAccessError } from "@/lib/storefront-access";
import { isUsableEvmAddress } from "@/lib/wallet-address";
import type {
  Customer,
  Generation,
  GenerationInput,
  ModelPricingConfiguration,
  PaymentCurrencySymbol,
  PaymentQuote,
  PaymentRail,
  SubAccount,
  SuperReferralsStore,
  GenerationStatus,
  VideoAspectRatio,
  VideoModel
} from "@/lib/types";

type GenerationFormState = {
  imageUrls: string;
  inftTitle: string;
  metadata: string;
  prompt: string;
  videoModel: VideoModel;
  aspectRatio: VideoAspectRatio;
  language: string;
  enableSubtitles: boolean;
  addOutroAnimation: boolean;
  addOutroFocusArea: boolean;
  outroFocusArea: string;
  ctaUrl: string;
  ctaTextTop: string;
  ctaTextBottom: string;
  ctaLogo: string;
  addFooterAnimation: boolean;
  publishToFeed: boolean;
  publishToSamsarGallery: boolean;
  feedTags: string;
  txHash: string;
};

type RenderFormMode = "simple" | "advanced";
type RenderFormPatch = Partial<GenerationFormState>;

type ImageWizardItem = {
  image_url: string;
  title: string;
  image_text: string;
};

type MetadataWizardItem = {
  key: string;
  value: string;
};

type OutroFocusAreaWizard = {
  x: string;
  y: string;
  width: string;
  height: string;
};

type RenderFlowState = {
  status: "idle" | "payment" | "confirming" | "starting" | "started" | "completed" | "failed";
  message: string;
  txHash?: string;
  generationId?: string;
};

type ImageOrientation = "portrait" | "landscape";

type RenderOrientationWarning = {
  imageOrientation: ImageOrientation;
  renderOrientation: ImageOrientation;
  detectedCount: number;
  majorityCount: number;
  skippedCount: number;
};

const activeGenerationStatuses = new Set<GenerationStatus>([
  "PAYMENT_PENDING",
  "PAYMENT_CONFIRMED",
  "QUEUED",
  "PROCESSING"
]);

const sampleImageUrlBases = new Set([
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
  "https://images.unsplash.com/photo-1460353581641-37baddab0fa2",
  "https://images.unsplash.com/photo-1525966222134-fcfa99b8ae77"
]);

const starterImages = [
  {
    image_url: "https://images.pexels.com/photos/7562351/pexels-photo-7562351.jpeg?auto=compress&cs=tinysrgb&w=1600",
    title: "Immersive Reality",
    image_text: "Step into a new way to play, explore, and connect."
  },
  {
    image_url: "https://images.pexels.com/photos/4240501/pexels-photo-4240501.jpeg?auto=compress&cs=tinysrgb&w=1600",
    title: "Mobile Workspace",
    image_text: "Stay connected and productive from anywhere."
  },
  {
    image_url: "https://images.pexels.com/photos/7605937/pexels-photo-7605937.jpeg?auto=compress&cs=tinysrgb&w=1600",
    title: "Creator Flow",
    image_text: "Plan, create, and multitask with tools that move with you."
  }
];

const starterImageMetadata = JSON.stringify(starterImages, null, 2);

const legacyStarterCampaignTitle = "Tech lifestyle launch";
const legacyStarterCampaignMetadata = JSON.stringify({ campaign: "customer-store" }, null, 2);
const legacyStarterPrompt = [
  "Create a polished tech lifestyle ad with smooth cinematic motion and clean transitions.",
  "Make each scene feel premium, useful, and aspirational.",
  "End with a strong modern product-launch energy."
].join("\n");
const legacyDefaultOutroFocusArea = JSON.stringify({ x: 680, y: 296, width: 432, height: 432 }, null, 2);
const legacyStarterCtaUrl = "https://www.pexels.com/search/technology%20lifestyle/";
const legacyStarterCtaTextTop = "Scan to learn more";
const legacyStarterCtaTextBottom = "Open the offer";
const legacyStarterFeedTags = "tech, lifestyle, product";
const supportedRenditionLanguages = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "pt", label: "Portuguese" },
  { value: "it", label: "Italian" },
  { value: "nl", label: "Dutch" },
  { value: "sv", label: "Swedish" },
  { value: "hi", label: "Hindi" },
  { value: "ar", label: "Arabic" },
  { value: "ru", label: "Russian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "th", label: "Thai" },
  { value: "zh", label: "Chinese" }
];
const supportedRenditionLanguageCodes = new Set<string>(supportedRenditionLanguages.map((language) => language.value));

const renderFormTooltips = {
  inftTitle: "Optional title saved into the render metadata and associated INFT.",
  imageScenes: "Add the product or scene images that should drive the video. Each image can include optional title and scene text.",
  imageUrl: "Paste a public http(s) image URL or upload an image from your device.",
  imageTitle: "Optional per-scene title used by the generated video and footer metadata.",
  imageText: "Optional copy for the scene, such as a product detail or callout.",
  prompt: "Describe the motion, style, pacing, and campaign direction for the generated product video.",
  language: "Select the spoken or subtitle language, or leave auto detect for mixed-language content.",
  subtitles: "Includes subtitles in the render when the selected model supports them.",
  campaignMetadata: "Optional key-value metadata stored with the render and INFT payload.",
  metadataField: "Metadata key to include in the generated payload.",
  metadataValue: "Metadata value to include for this key. JSON values such as numbers and objects are supported.",
  publishTargets: "Choose where completed videos should be visible after the render finishes.",
  feedTags: "Optional comma-separated tags for discovery in the public feed.",
  outro: "Optional CTA URL used to generate a final outro image and per-scene footer links.",
  ctaUrl: "Destination URL for the generated CTA outro and footer links.",
  ctaTextTop: "Optional top line rendered on the generated CTA outro.",
  ctaTextBottom: "Optional bottom line rendered on the generated CTA outro.",
  ctaLogo: "Optional public image URL for a logo displayed on the generated CTA outro.",
  outroAnimation: "Animates the server-generated CTA outro image at the end of the video.",
  outroFocusAnimation: "Uses an explicit focus area when animating the generated outro image.",
  footerAnimation: "Adds a CTA footer animation to individual scenes using the CTA URL.",
  outroFocusArea: "Optional pixel rectangle that guides where the outro animation should focus.",
  paymentTxHash: "Optional transaction hash to use when payment was completed outside the wallet flow.",
  imageJson: "Advanced JSON array of image URL strings or image objects.",
  metadataJson: "Advanced JSON object stored with the generated render and INFT.",
  payloadPreview: "Read-only preview of the SuperReferrals generation payload assembled from this form."
};

function createDefaultGenerationForm(modelSelection?: Pick<GenerationFormState, "videoModel" | "aspectRatio">): GenerationFormState {
  return {
    imageUrls: "",
    inftTitle: "",
    metadata: "",
    prompt: "",
    videoModel: modelSelection?.videoModel || ("RUNWAYML" as VideoModel),
    aspectRatio: modelSelection?.aspectRatio || ("9:16" as VideoAspectRatio),
    language: "auto",
    enableSubtitles: true,
    addOutroAnimation: true,
    addOutroFocusArea: true,
    outroFocusArea: "",
    ctaUrl: "",
    ctaTextTop: "",
    ctaTextBottom: "",
    ctaLogo: "",
    addFooterAnimation: true,
    publishToFeed: true,
    publishToSamsarGallery: true,
    feedTags: "",
    txHash: ""
  };
}

function restorePersistedGenerationForm(
  persisted: Partial<GenerationFormState> | undefined,
  pricingOptions: ModelPricingConfiguration[]
): GenerationFormState {
  const next = createDefaultGenerationForm();
  if (persisted && typeof persisted === "object" && !Array.isArray(persisted)) {
    const persistedRecord = persisted as Record<string, unknown>;
    let restoredInftTitle = false;
    if (typeof persisted.imageUrls === "string") next.imageUrls = sanitizeImageUrlsForForm(persisted.imageUrls);
    if (typeof persisted.inftTitle === "string") {
      next.inftTitle = persisted.inftTitle;
      restoredInftTitle = true;
    }
    if (typeof persisted.metadata === "string") next.metadata = persisted.metadata;
    if (typeof persisted.prompt === "string") next.prompt = persisted.prompt;
    if (typeof persisted.videoModel === "string") next.videoModel = persisted.videoModel as VideoModel;
    if (typeof persisted.aspectRatio === "string") next.aspectRatio = persisted.aspectRatio as VideoAspectRatio;
    if (typeof persisted.language === "string") {
      const normalizedLanguage = persisted.language.trim().toLowerCase();
      if (supportedRenditionLanguageCodes.has(normalizedLanguage)) next.language = normalizedLanguage;
    }
    if (typeof persisted.enableSubtitles === "boolean") next.enableSubtitles = persisted.enableSubtitles;
    if (typeof persistedRecord.enable_subtitles === "boolean") next.enableSubtitles = persistedRecord.enable_subtitles;
    if (typeof persisted.addOutroAnimation === "boolean") next.addOutroAnimation = persisted.addOutroAnimation;
    if (typeof persisted.addOutroFocusArea === "boolean") next.addOutroFocusArea = persisted.addOutroFocusArea;
    if (typeof persisted.outroFocusArea === "string") next.outroFocusArea = persisted.outroFocusArea;
    if (typeof persisted.ctaUrl === "string") next.ctaUrl = persisted.ctaUrl;
    if (typeof persistedRecord.cta_url === "string" && !persisted.ctaUrl) next.ctaUrl = persistedRecord.cta_url;
    if (typeof persisted.ctaTextTop === "string") next.ctaTextTop = persisted.ctaTextTop;
    if (typeof persistedRecord.cta_text_top === "string") next.ctaTextTop = persistedRecord.cta_text_top;
    if (typeof persisted.ctaTextBottom === "string") next.ctaTextBottom = persisted.ctaTextBottom;
    if (typeof persistedRecord.cta_text_bottom === "string") next.ctaTextBottom = persistedRecord.cta_text_bottom;
    if (typeof persisted.ctaLogo === "string") next.ctaLogo = persisted.ctaLogo;
    if (typeof persistedRecord.cta_logo === "string") next.ctaLogo = persistedRecord.cta_logo;
    if (typeof persisted.addFooterAnimation === "boolean") next.addFooterAnimation = persisted.addFooterAnimation;
    if (typeof persistedRecord.add_footer_animation === "boolean") next.addFooterAnimation = persistedRecord.add_footer_animation;
    if (typeof persisted.publishToFeed === "boolean") next.publishToFeed = persisted.publishToFeed;
    if (typeof persisted.publishToSamsarGallery === "boolean") next.publishToSamsarGallery = persisted.publishToSamsarGallery;
    if (typeof persisted.feedTags === "string") next.feedTags = persisted.feedTags;
    if (typeof persisted.txHash === "string") next.txHash = persisted.txHash;
    if (!restoredInftTitle) {
      next.inftTitle = extractMetadataTitle(next.metadata) || next.inftTitle;
    }
  }
  clearLegacyStarterContent(next);
  return {
    ...next,
    ...resolveValidModelSelection(pricingOptions, next)
  };
}

function clearLegacyStarterContent(form: GenerationFormState) {
  let cleared = false;
  if (isLegacyStarterImageMetadata(form.imageUrls)) {
    form.imageUrls = "";
    cleared = true;
  }
  if (form.inftTitle.trim() === legacyStarterCampaignTitle) {
    form.inftTitle = "";
    cleared = true;
  }
  if (isMatchingJsonObject(form.metadata, legacyStarterCampaignMetadata)) {
    form.metadata = "";
    cleared = true;
  }
  if (form.prompt.trim() === legacyStarterPrompt) {
    form.prompt = "";
    cleared = true;
  }
  if (isMatchingJsonObject(form.outroFocusArea, legacyDefaultOutroFocusArea)) {
    form.outroFocusArea = "";
    cleared = true;
  }
  if (form.ctaUrl.trim() === legacyStarterCtaUrl) {
    form.ctaUrl = "";
    cleared = true;
  }
  if (form.ctaTextTop.trim() === legacyStarterCtaTextTop) {
    form.ctaTextTop = "";
    cleared = true;
  }
  if (form.ctaTextBottom.trim() === legacyStarterCtaTextBottom) {
    form.ctaTextBottom = "";
    cleared = true;
  }
  if (form.feedTags.trim() === legacyStarterFeedTags) {
    form.feedTags = "";
    cleared = true;
  }
  if (cleared && form.language === "en") {
    form.language = "auto";
  }
}

function isLegacyStarterImageMetadata(raw: string) {
  const items = parseImageWizardItems(raw);
  return items.length === starterImages.length && items.every((item, index) => {
    const starter = starterImages[index];
    return (
      item.image_url === starter.image_url &&
      item.title === starter.title &&
      item.image_text === starter.image_text
    );
  });
}

function isMatchingJsonObject(raw: string, expectedRaw: string) {
  try {
    return JSON.stringify(parseJsonObject(raw)) === JSON.stringify(parseJsonObject(expectedRaw));
  } catch {
    return false;
  }
}

function resolveValidModelSelection(
  pricingOptions: ModelPricingConfiguration[],
  preferred: Pick<GenerationFormState, "videoModel" | "aspectRatio">
): Pick<GenerationFormState, "videoModel" | "aspectRatio"> {
  const exact = pricingOptions.find((item) =>
    item.videoModel === preferred.videoModel &&
    item.aspectRatio === preferred.aspectRatio
  );
  const sameModel = pricingOptions.find((item) => item.videoModel === preferred.videoModel);
  const fallback = createDefaultGenerationForm();
  const defaultOption = pricingOptions.find((item) =>
    item.videoModel === fallback.videoModel &&
    item.aspectRatio === fallback.aspectRatio
  );
  const selected = exact || sameModel || defaultOption || pricingOptions[0];
  return selected
    ? { videoModel: selected.videoModel, aspectRatio: selected.aspectRatio }
    : { videoModel: preferred.videoModel, aspectRatio: preferred.aspectRatio };
}

export default function UserLandingPage({ referrerCode = "", customerId = "" }: { referrerCode?: string; customerId?: string }) {
  const [store, setStore] = useState<SuperReferralsStore | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [walletAddress, setWalletAddress] = useState("");
  const [walletProviders, setWalletProviders] = useState<BrowserWalletProvider[]>([]);
  const [activeWalletProvider, setActiveWalletProvider] = useState<BrowserWalletProvider | null>(null);
  const hydratedWalletSessionKey = useRef("");
  const [renderFormHydratedKey, setRenderFormHydratedKey] = useState("");
  const [serverRenderFormHydratedKey, setServerRenderFormHydratedKey] = useState("");
  const [profileForm, setProfileForm] = useState({
    email: "",
    username: ""
  });
  const [generationForm, setGenerationForm] = useState<GenerationFormState>(() => createDefaultGenerationForm());
  const [renderFormMode, setRenderFormMode] = useState<RenderFormMode>("simple");
  const [imageWizardItems, setImageWizardItems] = useState<ImageWizardItem[]>(() => parseImageWizardItems(""));
  const [metadataWizardItems, setMetadataWizardItems] = useState<MetadataWizardItem[]>(() => parseMetadataWizardItems(""));
  const [outroFocusAreaWizard, setOutroFocusAreaWizard] = useState<OutroFocusAreaWizard>(() => parseOutroFocusAreaWizard(""));
  const [paymentCurrency, setPaymentCurrency] = useState<PaymentCurrencySymbol>("USDC");
  const [quote, setQuote] = useState<PaymentQuote | null>(null);
  const [autoPolling, setAutoPolling] = useState(false);
  const [renderFlow, setRenderFlow] = useState<RenderFlowState>({ status: "idle", message: "" });
  const [renderSessionLocked, setRenderSessionLocked] = useState(false);
  const [renderOrientationWarning, setRenderOrientationWarning] = useState<RenderOrientationWarning | null>(null);
  const [showOlderTasks, setShowOlderTasks] = useState(false);
  const generationSubmitInFlightRef = useRef(false);
  const pendingRenderCurrencyRef = useRef<PaymentCurrencySymbol | null>(null);

  async function load() {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    const data = await response.json();
    setStore(data);
  }

  useEffect(() => {
    load().catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => subscribeToBrowserWalletProviders(setWalletProviders), []);

  const routeAccount = useMemo(
    () => store?.subAccounts.find((account) => account.referrerCode === referrerCode),
    [store, referrerCode]
  );
  const customer = useMemo(() => {
    if (!store) return null;
    if (routeAccount) {
      return store.customers.find((item) => item.id === routeAccount.customerId) || null;
    }
    if (customerId) {
      return store.customers.find((item) => item.id === customerId) || null;
    }
    return store.customers[0] || null;
  }, [store, routeAccount, customerId]);
  const pricingOptions = useMemo(
    () => getAllowedModelPricingConfigurations(customer),
    [customer]
  );
  const selectedPricing = pricingOptions.find((item) =>
    item.videoModel === generationForm.videoModel &&
    item.aspectRatio === generationForm.aspectRatio
  ) || pricingOptions[0];
  const connectedSubAccount = useMemo(
    () => store?.subAccounts.find((account) =>
      customer &&
      account.customerId === customer.id &&
      sameWallet(account.wallet, walletAddress)
    ),
    [store, customer, walletAddress]
  );
  const imageCount = countImageInputs(generationForm.imageUrls);
  const maxImages = getStorefrontMaxImages(customer);
  const conditionTiles = getStorefrontConditionTiles(customer);
  const renderConditionError = getRenderConditionError(customer, {
    imageCount,
    videoModel: generationForm.videoModel,
    aspectRatio: generationForm.aspectRatio
  });
  const renderAccessError = getStorefrontAccessError(customer, store, {
    wallet: walletAddress || connectedSubAccount?.wallet
  });
  const paymentSetupNotice = customer && !isUsableEvmAddress(customer.ownerWallet)
    ? "Merchant payout wallet is not connected. Payment quotes will use the configured platform settlement wallet when available."
    : "";
  const renderGateError = renderConditionError || renderAccessError;
  const selectedPricingDetails = resolveModelPriceDetails(customer, selectedPricing);
  const estimatedDurationSeconds = estimateDurationSeconds(imageCount, selectedPricing);
  const userGenerations = connectedSubAccount
    ? store?.generations.filter((generation) => generation.subAccountId === connectedSubAccount.id) || []
    : [];
  const sortedUserGenerations = useMemo(
    () => [...userGenerations].sort((left, right) => generationTime(right) - generationTime(left)),
    [userGenerations]
  );
  const latestCompletedGeneration = sortedUserGenerations.find((generation) => generation.status === "COMPLETED");
  const primaryTaskGenerations = useMemo(() => {
    const visible = new Map<string, Generation>();
    const latest = sortedUserGenerations[0];
    if (latest) {
      visible.set(latest.id, latest);
    }
    if (latestCompletedGeneration) {
      visible.set(latestCompletedGeneration.id, latestCompletedGeneration);
    }
    return [...visible.values()];
  }, [latestCompletedGeneration, sortedUserGenerations]);
  const olderTaskGenerations = useMemo(
    () => sortedUserGenerations.filter((generation) =>
      !primaryTaskGenerations.some((visible) => visible.id === generation.id)
    ),
    [primaryTaskGenerations, sortedUserGenerations]
  );
  const trackedGeneration = renderFlow.generationId
    ? userGenerations.find((generation) => generation.id === renderFlow.generationId)
    : undefined;
  const pollingGenerationIds = useMemo(
    () => userGenerations
      .filter((generation) => activeGenerationStatuses.has(generation.status))
      .map((generation) => generation.id),
    [userGenerations]
  );
  const pollingKey = pollingGenerationIds.join("|");
  const hasActiveUserGenerations = pollingGenerationIds.length > 0;
  const sessionStorageKey = useMemo(
    () => `superreferrals:user-session:${routeAccount?.referrerCode || customer?.id || referrerCode || customerId || "default"}`,
    [routeAccount?.referrerCode, customer?.id, referrerCode, customerId]
  );
  const renderFormStorageKey = useMemo(() => {
    const key = routeAccount?.referrerCode || customer?.id || referrerCode || customerId;
    return key ? `superreferrals:render-form:${key}:v1` : "";
  }, [routeAccount?.referrerCode, customer?.id, referrerCode, customerId]);
  const subAccountPreferenceKey = useMemo(
    () => connectedSubAccount
      ? `${connectedSubAccount.id}:${connectedSubAccount.preferences?.updatedAt || connectedSubAccount.updatedAt}`
      : "",
    [connectedSubAccount?.id, connectedSubAccount?.preferences?.updatedAt, connectedSubAccount?.updatedAt]
  );
  const transactionChain = useMemo(
    () => getTransactionChainConfig(normalizeTransactionChainIdForEnvironment(customer?.pricing.chainId)),
    [customer?.pricing.chainId]
  );
  const paymentTokens = useMemo(() => getPaymentTokens(transactionChain.id), [transactionChain.id]);
  const selectablePaymentTokens = useMemo(() => {
    const ethOrUsdc = paymentTokens.filter((token) => token.symbol === "USDC" || token.symbol === "ETH");
    return ethOrUsdc.length ? ethOrUsdc : paymentTokens;
  }, [paymentTokens]);
  const selectedPaymentToken = selectablePaymentTokens.find((token) => token.symbol === paymentCurrency) || selectablePaymentTokens[0]!;
  const settlementToken =
    findPaymentToken(customer?.pricing.settlementTokenAddress || "", transactionChain.id) ||
    settlementTokenForCurrency(customer?.pricing.currency || "USDC", transactionChain.id) ||
    selectedPaymentToken;
  const paymentRail = useMemo(
    () => resolveUserPaymentRail(selectedPaymentToken, settlementToken),
    [selectedPaymentToken, settlementToken]
  );
  const hasWalletAddress = Boolean(walletAddress.trim());
  const generationPayloadPreview = useMemo(
    () => previewGenerationPayload(generationForm),
    [generationForm]
  );
  const renderSubmitDisabled = busy === "generation" || busy === "orientation" || renderSessionLocked || imageCount === 0;

  function updateGenerationForm(patch: RenderFormPatch) {
    const nextPatch = {
      ...patch,
      ...(typeof patch.imageUrls === "string" ? { imageUrls: sanitizeImageUrlsForForm(patch.imageUrls) } : {})
    };
    setGenerationForm((current) => ({ ...current, ...nextPatch }));
  }

  function syncRenderWizardState(form: GenerationFormState) {
    setImageWizardItems(parseImageWizardItems(form.imageUrls));
    setMetadataWizardItems(parseMetadataWizardItems(form.metadata));
    setOutroFocusAreaWizard(parseOutroFocusAreaWizard(form.outroFocusArea));
  }

  function openRenderFormMode(mode: RenderFormMode) {
    if (mode === "simple") {
      syncRenderWizardState(generationForm);
    }
    setRenderFormMode(mode);
  }

  function resetGenerationForm() {
    const selection = resolveValidModelSelection(pricingOptions, generationForm);
    const nextForm = createDefaultGenerationForm(selection);
    setGenerationForm(nextForm);
    syncRenderWizardState(nextForm);
    setRenderFormMode("simple");
    setQuote(null);
    setRenderSessionLocked(false);
    generationSubmitInFlightRef.current = false;
    setRenderFlow({ status: "idle", message: "" });
    setMessage("Render form reset.");
  }

  function commitImageWizardItems(nextImages: ImageWizardItem[]) {
    setImageWizardItems(nextImages);
    setGenerationForm((current) => ({
      ...current,
      imageUrls: serializeImageWizardItems(nextImages)
    }));
  }

  function updateImageWizardItem(index: number, patch: Partial<ImageWizardItem>) {
    const nextImages = imageWizardItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    );
    commitImageWizardItems(nextImages);
  }

  function addImageWizardItem() {
    if (maxImages && imageWizardItems.length >= maxImages) {
      setMessage(`This storefront allows up to ${maxImages} image${maxImages === 1 ? "" : "s"} per render.`);
      return;
    }
    const nextImages = [...imageWizardItems, { image_url: "", title: "", image_text: "" }];
    commitImageWizardItems(nextImages);
  }

  function removeImageWizardItem(index: number) {
    const nextImages = imageWizardItems.filter((_, itemIndex) => itemIndex !== index);
    commitImageWizardItems(nextImages);
  }

  function moveImageWizardItem(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= imageWizardItems.length ||
      toIndex >= imageWizardItems.length
    ) {
      return;
    }
    const nextImages = [...imageWizardItems];
    const [movedImage] = nextImages.splice(fromIndex, 1);
    nextImages.splice(toIndex, 0, movedImage);
    commitImageWizardItems(nextImages);
  }

  function commitMetadataWizardItems(nextItems: MetadataWizardItem[]) {
    setMetadataWizardItems(nextItems);
    updateGenerationForm({ metadata: serializeMetadataWizardItems(nextItems) });
  }

  function updateMetadataWizardItem(index: number, patch: Partial<MetadataWizardItem>) {
    commitMetadataWizardItems(metadataWizardItems.map((item, itemIndex) =>
      itemIndex === index ? { ...item, ...patch } : item
    ));
  }

  function addMetadataWizardItem() {
    commitMetadataWizardItems([...metadataWizardItems, { key: "", value: "" }]);
  }

  function removeMetadataWizardItem(index: number) {
    commitMetadataWizardItems(metadataWizardItems.filter((_, itemIndex) => itemIndex !== index));
  }

  function updateOutroFocusAreaWizard(field: keyof OutroFocusAreaWizard, value: string) {
    const nextFocusArea = { ...outroFocusAreaWizard, [field]: value };
    setOutroFocusAreaWizard(nextFocusArea);
    updateGenerationForm({ outroFocusArea: serializeOutroFocusAreaWizard(nextFocusArea) });
  }

  useEffect(() => {
    if (!customer || !renderFormStorageKey || renderFormHydratedKey === renderFormStorageKey) {
      return;
    }
    const raw = window.localStorage.getItem(renderFormStorageKey);
    if (!raw) {
      setRenderFormHydratedKey(renderFormStorageKey);
      return;
    }
    try {
      const persisted = JSON.parse(raw) as {
        form?: Partial<GenerationFormState>;
      };
      const nextForm = restorePersistedGenerationForm(persisted.form, pricingOptions);
      setGenerationForm(nextForm);
      syncRenderWizardState(nextForm);
      setRenderFormMode("simple");
      setRenderFormHydratedKey(renderFormStorageKey);
    } catch {
      window.localStorage.removeItem(renderFormStorageKey);
      setRenderFormHydratedKey(renderFormStorageKey);
    }
  }, [customer, renderFormHydratedKey, renderFormStorageKey, pricingOptions]);

  useEffect(() => {
    if (!customer || !renderFormStorageKey || renderFormHydratedKey !== renderFormStorageKey) {
      return;
    }
    window.localStorage.setItem(renderFormStorageKey, JSON.stringify({
      form: generationForm
    }));
  }, [customer, generationForm, renderFormHydratedKey, renderFormStorageKey]);

  useEffect(() => {
    if (!customer || !connectedSubAccount || !subAccountPreferenceKey || serverRenderFormHydratedKey === subAccountPreferenceKey) {
      return;
    }
    const preferences = connectedSubAccount.preferences;
    if (preferences?.renderForm) {
      const nextForm = restorePersistedGenerationForm(preferences.renderForm as Partial<GenerationFormState>, pricingOptions);
      setGenerationForm(nextForm);
      syncRenderWizardState(nextForm);
    }
    setRenderFormMode("simple");
    setServerRenderFormHydratedKey(subAccountPreferenceKey);
  }, [connectedSubAccount, customer, pricingOptions, serverRenderFormHydratedKey, subAccountPreferenceKey]);

  useEffect(() => {
    if (
      !customer ||
      !connectedSubAccount ||
      !subAccountPreferenceKey ||
      serverRenderFormHydratedKey !== subAccountPreferenceKey
    ) {
      return;
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      fetch("/api/subaccounts", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          subAccountId: connectedSubAccount.id,
          customerId: customer.id,
          wallet: connectedSubAccount.wallet,
          preferences: {
            renderForm: generationForm
          }
        })
      }).catch(() => undefined);
    }, 600);
    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [
    connectedSubAccount?.id,
    connectedSubAccount?.wallet,
    customer?.id,
    generationForm,
    serverRenderFormHydratedKey,
    subAccountPreferenceKey
  ]);

  useEffect(() => {
    if (!selectedPricing) return;
    if (
      selectedPricing.videoModel !== generationForm.videoModel ||
      selectedPricing.aspectRatio !== generationForm.aspectRatio
    ) {
      setGenerationForm((current) => ({
        ...current,
        videoModel: selectedPricing.videoModel,
        aspectRatio: selectedPricing.aspectRatio
      }));
    }
  }, [selectedPricing, generationForm.videoModel, generationForm.aspectRatio]);

  useEffect(() => {
    setQuote(null);
  }, [generationForm.imageUrls, generationForm.videoModel, generationForm.aspectRatio, paymentCurrency, transactionChain.id, walletAddress]);

  useEffect(() => {
    const firstToken = selectablePaymentTokens[0];
    if (firstToken && !selectablePaymentTokens.some((token) => token.symbol === paymentCurrency)) {
      setPaymentCurrency(firstToken.symbol);
    }
  }, [paymentCurrency, selectablePaymentTokens]);

  useEffect(() => {
    const provider = activeWalletProvider?.provider || walletProviders[0]?.provider;
    if (!provider?.on) {
      return;
    }
    const handleAccountsChanged = (...args: unknown[]) => {
      const accounts = Array.isArray(args[0]) ? args[0].map((account) => String(account)) : [];
      const firstAccount = accounts[0] || "";
      setWalletAddress(firstAccount);
      if (firstAccount) {
        setProfileForm((current) => ({
          ...current,
          username: current.username || `wallet-${shortWallet(firstAccount)}`
        }));
      }
    };
    provider.on("accountsChanged", handleAccountsChanged);
    return () => provider.removeListener?.("accountsChanged", handleAccountsChanged);
  }, [activeWalletProvider?.id, walletProviders]);

  useEffect(() => {
    if (hydratedWalletSessionKey.current === sessionStorageKey) {
      return;
    }
    hydratedWalletSessionKey.current = sessionStorageKey;
    const rawSession = window.localStorage.getItem(sessionStorageKey);
    if (!rawSession) {
      const provider = activeWalletProvider?.provider || walletProviders[0]?.provider || window.ethereum;
      provider?.request({ method: "eth_accounts" })
        .then((accounts) => {
          const firstAccount = Array.isArray(accounts) ? String(accounts[0] || "") : "";
          if (firstAccount) {
            setWalletAddress(firstAccount);
            setProfileForm((current) => ({
              ...current,
              username: current.username || `wallet-${shortWallet(firstAccount)}`
            }));
          }
        })
        .catch(() => undefined);
      return;
    }
    try {
      const session = JSON.parse(rawSession) as { walletAddress?: string; email?: string; username?: string };
      if (session.walletAddress) {
        setWalletAddress(session.walletAddress);
      }
      setProfileForm((current) => ({
        email: session.email || current.email,
        username: session.username || current.username
      }));
    } catch {
      window.localStorage.removeItem(sessionStorageKey);
    }
  }, [sessionStorageKey, activeWalletProvider?.provider, walletProviders]);

  useEffect(() => {
    if (!walletAddress.trim()) {
      return;
    }
    window.localStorage.setItem(sessionStorageKey, JSON.stringify({
      walletAddress,
      email: profileForm.email,
      username: profileForm.username
    }));
  }, [walletAddress, profileForm.email, profileForm.username, sessionStorageKey]);

  useEffect(() => {
    if (!pollingKey) {
      return;
    }
    const activeGenerationIds = pollingKey.split("|").filter(Boolean);
    let cancelled = false;

    async function pollActiveGenerations() {
      setAutoPolling(true);
      try {
        await Promise.all(activeGenerationIds.map((id) =>
          fetch(`/api/generations/${id}/sync`, { method: "POST" }).catch(() => null)
        ));
        if (!cancelled) {
          await load();
        }
      } finally {
        if (!cancelled) {
          setAutoPolling(false);
        }
      }
    }

    pollActiveGenerations().catch(() => undefined);
    const interval = window.setInterval(() => {
      pollActiveGenerations().catch(() => undefined);
    }, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [pollingKey]);

  useEffect(() => {
    if (!trackedGeneration || !renderFlow.generationId) {
      return;
    }
    if (trackedGeneration.status === "COMPLETED" && renderFlow.status !== "completed") {
      updateRenderFlow({
        status: "completed",
        message: `Render task ${trackedGeneration.id} finished and was persisted${trackedGeneration.storage?.video?.uri ? " to 0G storage" : ""}.`,
        txHash: trackedGeneration.payment.txHash,
        generationId: trackedGeneration.id
      });
    }
    if (trackedGeneration.status === "FAILED" && renderFlow.status !== "failed") {
      updateRenderFlow({
        status: "failed",
        message: trackedGeneration.errorMessage
          ? `Render task ${trackedGeneration.id} failed: ${trackedGeneration.errorMessage}`
          : `Render task ${trackedGeneration.id} failed.`,
        txHash: trackedGeneration.payment.txHash,
        generationId: trackedGeneration.id
      });
    }
  }, [trackedGeneration?.status, trackedGeneration?.updatedAt, renderFlow.generationId, renderFlow.status]);

  function selectedEthereumProvider(walletProvider?: BrowserWalletProvider) {
    const selected = walletProvider || activeWalletProvider || walletProviders[0] || null;
    return {
      walletProvider: selected,
      provider: selected?.provider || window.ethereum
    };
  }

  async function connectWallet(walletProvider?: BrowserWalletProvider) {
    setBusy("wallet");
    setMessage("");
    try {
      const selected = selectedEthereumProvider(walletProvider);
      if (!selected.provider) {
        setMessage("No injected wallet detected. Open this page in a wallet-enabled browser or enter a wallet address to continue in mock mode.");
        return;
      }
      const accounts = await requestWalletAccounts(selected.provider, { forceAccountSelection: true });
      const firstAccount = accounts[0] || "";
      if (!firstAccount) {
        throw new Error("Wallet did not return an account");
      }
      await ensureWalletNetwork(selected.provider, transactionChain);
      const nextProfile = {
        ...profileForm,
        username: profileForm.username || `wallet-${shortWallet(firstAccount)}`
      };
      setActiveWalletProvider(selected.walletProvider);
      setWalletAddress(firstAccount);
      setProfileForm(nextProfile);
      setMessage(
        `Wallet connected${selected.walletProvider ? ` with ${selected.walletProvider.name}` : ""} on ${transactionChain.name}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Wallet connection failed");
    } finally {
      setBusy("");
    }
  }

  async function ensureWalletSubAccount(
    walletOverride = walletAddress,
    profileOverride = profileForm
  ) {
    if (!customer) {
      throw new Error("Customer store is not available");
    }
    const effectiveWallet = walletOverride.trim();
    if (!effectiveWallet) {
      throw new Error("Connect or enter a wallet address first");
    }
    const existingAccount = store?.subAccounts.find((account) =>
      account.customerId === customer.id &&
      sameWallet(account.wallet, effectiveWallet)
    );
    if (existingAccount?.blockchainRegistration) {
      return existingAccount;
    }

    const response = await fetch("/api/subaccounts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        wallet: effectiveWallet,
        email: profileOverride.email || undefined,
        username: profileOverride.username || `wallet-${shortWallet(effectiveWallet)}`
      })
    });
    const data = await assertOk(response);
    await load();
    return data.account as SubAccount;
  }

  function paymentTokenForCurrency(currency: PaymentCurrencySymbol) {
    return selectablePaymentTokens.find((token) => token.symbol === currency) || selectedPaymentToken;
  }

  function quoteMatchesPaymentToken(activeQuote: PaymentQuote | null, paymentToken: PaymentToken) {
    return Boolean(
      activeQuote &&
      activeQuote.chainId === transactionChain.id &&
      activeQuote.paymentTokenAddress?.toLowerCase() === paymentToken.address.toLowerCase()
    );
  }

  async function requestQuote(account: SubAccount, paymentTokenOverride = selectedPaymentToken) {
    if (!customer) {
      throw new Error("Customer store is not available");
    }
    const requestedPaymentRail = resolveUserPaymentRail(paymentTokenOverride, settlementToken);
    const response = await fetch("/api/payments/quote", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        customerId: customer.id,
        subAccountId: account.id,
        imageCount,
        durationSeconds: estimatedDurationSeconds,
        videoModel: generationForm.videoModel,
        aspectRatio: generationForm.aspectRatio,
        tokenIn: paymentTokenOverride.address,
        tokenOut: settlementToken.address,
        paymentCurrency: paymentTokenOverride.symbol,
        settlementCurrency: settlementToken.symbol,
        paymentRail: requestedPaymentRail,
        swapper: account.wallet,
        chainId: transactionChain.id
      })
    });
    const data = await assertOk(response);
    setQuote(data.quote);
    await load();
    return data.quote as PaymentQuote;
  }

  async function createQuote() {
    setBusy("quote");
    setMessage("");
    try {
      if (renderConditionError) {
        throw new Error(renderConditionError);
      }
      if (renderAccessError) {
        throw new Error(renderAccessError);
      }
      const paymentToken = paymentTokenForCurrency(paymentCurrency);
      setPaymentCurrency(paymentToken.symbol);
      const account = await ensureWalletSubAccount();
      const quoted = await requestQuote(account, paymentToken);
      setMessage(`${quoted.totalUsd.toFixed(2)} ${quoted.settlementCurrency || "USDC"} quote created for payment in ${quoted.paymentCurrency || paymentToken.symbol} on ${transactionChain.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Quote failed");
    } finally {
      setBusy("");
    }
  }

  function updateRenderFlow(next: RenderFlowState) {
    setRenderFlow(next);
    setMessage(next.message);
  }

  async function executePaymentForRender(activeQuote: PaymentQuote, account: SubAccount) {
    const manualTxHash = generationForm.txHash.trim();
    if (manualTxHash) {
      return manualTxHash;
    }
    if (!customer) {
      throw new Error("Customer store is not available");
    }
    const walletProvider = selectedEthereumProvider();
    if (!walletProvider.provider) {
      throw new Error("A wallet transaction is required before rendering. Open this page in a wallet-enabled browser or paste an existing payment transaction hash.");
    }
    if (!activeQuote.settlementAmountAtomic) {
      throw new Error("Quote did not include a settlement amount.");
    }

    await ensureWalletNetwork(walletProvider.provider, transactionChain);
    const paymentToken = findPaymentToken(activeQuote.paymentTokenAddress || "", transactionChain.id) || selectedPaymentToken;
    const activeSettlementToken =
      findPaymentToken(activeQuote.settlementTokenAddress || "", transactionChain.id) || settlementToken;
    const sameToken = paymentToken.address.toLowerCase() === activeSettlementToken.address.toLowerCase();
    const paymentAmountAtomic = activeQuote.paymentAmountAtomic || activeQuote.settlementAmountAtomic;
    const paymentRecipient = activeQuote.paymentRecipientAddress || customer.ownerWallet;
    if (!isUsableEvmAddress(paymentRecipient)) {
      throw new Error("Quote did not include a valid non-zero payment recipient. Connect a merchant payout wallet or configure the platform settlement wallet.");
    }

    if (activeQuote.paymentRail === "uniswap" && !sameToken) {
      updateRenderFlow({ status: "payment", message: "Requesting Uniswap swap transaction from the wallet." });
      const swapTxHash = await requestUniswapSwap(walletProvider.provider, activeQuote, account.wallet, transactionChain.name);
      updateRenderFlow({
        status: "confirming",
        message: `Swap ${shortHash(swapTxHash)} submitted. Waiting for settlement tokens before transfer.`,
        txHash: swapTxHash
      });
      const swapReceipt = await waitForWalletReceipt(walletProvider.provider, swapTxHash, 120000);
      if (!swapReceipt) {
        throw new Error("Timed out waiting for the swap transaction to mine. Paste the final settlement transfer hash after the wallet confirms.");
      }
      if (!isSuccessfulReceipt(swapReceipt)) {
        throw new Error("Swap transaction reverted; render was not started.");
      }
      updateRenderFlow({ status: "payment", message: "Swap mined. Requesting settlement transfer.", txHash: swapTxHash });
      const settlementTxHash = await requestTokenTransfer({
        provider: walletProvider.provider,
        from: account.wallet,
        token: activeSettlementToken,
        recipient: paymentRecipient,
        amountAtomic: activeQuote.settlementAmountAtomic,
        label: "Settlement transfer",
        chainName: transactionChain.name
      });
      updateRenderFlow({
        status: "confirming",
        message: `Settlement transfer ${shortHash(settlementTxHash)} submitted. Waiting for confirmation.`,
        txHash: settlementTxHash
      });
      const settlementReceipt = await waitForWalletReceipt(walletProvider.provider, settlementTxHash, 120000);
      if (!settlementReceipt) {
        throw new Error("Timed out waiting for the settlement transfer to mine. Paste the transfer hash once it confirms.");
      }
      if (!isSuccessfulReceipt(settlementReceipt)) {
        throw new Error("Settlement transfer reverted; render was not started.");
      }
      return settlementTxHash;
    }

    if (activeQuote.paymentRail === "keeperhub" && !sameToken) {
      updateRenderFlow({
        status: "payment",
        message: `Requesting ${paymentToken.symbol} payment for KeeperHub ${activeSettlementToken.symbol} settlement.`
      });
      const keeperPaymentTxHash = await requestTokenTransfer({
        provider: walletProvider.provider,
        from: account.wallet,
        token: paymentToken,
        recipient: paymentRecipient,
        amountAtomic: paymentAmountAtomic,
        label: "KeeperHub payment",
        chainName: transactionChain.name
      });
      updateRenderFlow({
        status: "confirming",
        message: `KeeperHub payment ${shortHash(keeperPaymentTxHash)} submitted. Waiting for confirmation before starting render.`,
        txHash: keeperPaymentTxHash
      });
      const keeperPaymentReceipt = await waitForWalletReceipt(walletProvider.provider, keeperPaymentTxHash, 120000);
      if (!keeperPaymentReceipt) {
        throw new Error("Timed out waiting for the KeeperHub payment to mine. Paste the payment transaction hash once it confirms.");
      }
      if (!isSuccessfulReceipt(keeperPaymentReceipt)) {
        throw new Error("KeeperHub payment reverted; render was not started.");
      }
      return keeperPaymentTxHash;
    }

    if (!sameToken) {
      throw new Error("Selected payment token differs from the settlement token. Choose Uniswap for swap payment or pay directly with the settlement token.");
    }

    updateRenderFlow({ status: "payment", message: `Requesting ${activeSettlementToken.symbol} transfer from the wallet.` });
    const transferTxHash = await requestTokenTransfer({
      provider: walletProvider.provider,
      from: account.wallet,
      token: activeSettlementToken,
      recipient: paymentRecipient,
      amountAtomic: activeQuote.settlementAmountAtomic,
      label: "Payment transfer",
      chainName: transactionChain.name
    });
    updateRenderFlow({
      status: "confirming",
      message: `Payment transfer ${shortHash(transferTxHash)} submitted. Waiting for confirmation.`,
      txHash: transferTxHash
    });
    const transferReceipt = await waitForWalletReceipt(walletProvider.provider, transferTxHash, 120000);
    if (!transferReceipt) {
      throw new Error("Timed out waiting for the payment transfer to mine. Paste the transfer hash once it confirms.");
    }
    if (!isSuccessfulReceipt(transferReceipt)) {
      throw new Error("Payment transfer reverted; render was not started.");
    }
    return transferTxHash;
  }

  async function runGeneration(currency = paymentCurrency) {
    if (!customer) return;
    if (generationSubmitInFlightRef.current || renderSessionLocked) {
      setMessage("A render is already pending for this form. Reset the form to start a fresh session before submitting again.");
      return;
    }
    generationSubmitInFlightRef.current = true;
    setBusy("generation");
    setMessage("");
    setRenderFlow({ status: "payment", message: "Preparing payment before starting the render." });
    let createdGeneration: Generation | undefined;
    try {
      if (renderConditionError) {
        throw new Error(renderConditionError);
      }
      if (renderAccessError) {
        throw new Error(renderAccessError);
      }
      const paymentToken = paymentTokenForCurrency(currency);
      setPaymentCurrency(paymentToken.symbol);
      const account = await ensureWalletSubAccount();
      const activeQuote = quoteMatchesPaymentToken(quote, paymentToken)
        ? quote as PaymentQuote
        : await requestQuote(account, paymentToken);
      const paymentTxHash = await executePaymentForRender(activeQuote, account);
      updateRenderFlow({
        status: "starting",
        message: `Payment transaction ${shortHash(paymentTxHash)} confirmed. Starting video render task.`,
        txHash: paymentTxHash
      });
      const generationPayload = buildGenerationPayload(generationForm);
      const response = await fetch("/api/generations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer.id,
          subAccountId: account.id,
          generation: generationPayload,
          feed: {
            published: generationForm.publishToFeed,
            samsarGalleryPublished: generationForm.publishToSamsarGallery,
            tags: generationForm.feedTags
          },
          payment: {
            quoteId: activeQuote.id,
            txHash: paymentTxHash,
            payerWallet: account.wallet,
            amountUsd: activeQuote.totalUsd,
            tokenAddress: activeQuote.paymentTokenAddress,
            tokenSymbol: activeQuote.paymentCurrency,
            paymentRail: activeQuote.paymentRail,
            chainId: activeQuote.chainId,
            route: activeQuote.route
          }
        })
      });
      const data = await assertOk(response);
      await load();
      createdGeneration = data.generation as Generation | undefined;
      if (!createdGeneration) {
        throw new Error("Render API did not return a render task.");
      }
      setRenderSessionLocked(activeGenerationStatuses.has(createdGeneration.status));
      if (createdGeneration.status === "PAYMENT_PENDING") {
        updateRenderFlow({
          status: "confirming",
          message: `Payment is pending for render task ${createdGeneration.id}. Reset the form to start another session while this task is tracked below.`,
          txHash: paymentTxHash,
          generationId: createdGeneration.id
        });
      } else {
        updateRenderFlow({
          status: "started",
          message: `Payment transaction ${shortHash(paymentTxHash)} accepted and render task ${createdGeneration.id} started. Reset the form to start another session while auto-polling tracks this task below.`,
          txHash: paymentTxHash,
          generationId: createdGeneration.id
        });
      }
    } catch (error) {
      if (!createdGeneration || !activeGenerationStatuses.has(createdGeneration.status)) {
        setRenderSessionLocked(false);
      }
      const errorMessage = formatErrorMessage(error, "Render request failed");
      updateRenderFlow({
        status: "failed",
        message: errorMessage.includes("render was not started") || errorMessage.includes("Render was not started")
          ? errorMessage
          : `${errorMessage} Render was not started.`
      });
    } finally {
      generationSubmitInFlightRef.current = false;
      setBusy("");
    }
  }

  async function startRenderWithOrientationCheck(currency = paymentCurrency) {
    if (!customer) return;
    if (generationSubmitInFlightRef.current || renderSessionLocked || renderConditionError || renderAccessError) {
      await runGeneration(currency);
      return;
    }
    setBusy("orientation");
    setMessage("Checking image dimensions before starting the render.");
    try {
      const warning = await detectRenderOrientationWarning(generationForm);
      if (warning) {
        pendingRenderCurrencyRef.current = currency;
        setRenderOrientationWarning(warning);
        setMessage("");
        return;
      }
    } catch {
      // Continue to the normal render flow; payload validation there will surface actionable errors.
    } finally {
      setBusy("");
    }
    await runGeneration(currency);
  }

  async function continueRenderAfterOrientationWarning() {
    const currency = pendingRenderCurrencyRef.current || paymentCurrency;
    pendingRenderCurrencyRef.current = null;
    setRenderOrientationWarning(null);
    await runGeneration(currency);
  }

  function cancelRenderAfterOrientationWarning() {
    pendingRenderCurrencyRef.current = null;
    setRenderOrientationWarning(null);
    if (renderFormMode !== "simple") {
      syncRenderWizardState(generationForm);
      setRenderFormMode("simple");
    }
    setMessage("Render paused. Adjust the image scenes or choose a matching render aspect ratio.");
  }

  async function syncGeneration(id: string) {
    setBusy(id);
    setMessage("");
    try {
      const response = await fetch(`/api/generations/${id}/sync`, { method: "POST" });
      const data = await assertOk(response);
      await load();
      const syncedGeneration = data.generation as Generation | undefined;
      setMessage(syncedGeneration?.status === "FAILED"
        ? syncedGeneration.errorMessage || "Render task sync failed."
        : "Render task synced.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sync failed");
    } finally {
      setBusy("");
    }
  }

  if (!store) {
    return <UserStoreCreatorSkeleton />;
  }

  if (!customer) {
    return <main className="public-main storefront-user-main"><div className="notice">Customer store was not found.</div></main>;
  }

  return (
    <main className="public-main storefront-user-main">
      <section className="hero-band public-hero">
        <div>
          <div className="eyebrow">{customer.name}</div>
          <h1>Generate a product video</h1>
          <p className="subtle">
            {customer.storefront?.description || "Connect your wallet, choose a render configuration, pay the store price, and track your previous render tasks."}
          </p>
          <div className="storefront-landing-meta">
            <span><Wallet size={15} /> payout {isUsableEvmAddress(customer.ownerWallet) ? shortWallet(customer.ownerWallet) : "platform settlement if configured"}</span>
            {customer.storefront?.category && <span><Store size={15} /> {customer.storefront.category}</span>}
            {customer.ensName && <span>{customer.ensName}</span>}
          </div>
        </div>
        <div className="landing-hero-actions">
          <BreadcrumbNav />
          <a className="btn" href="/storefronts">
            <Store size={16} /> Directory
          </a>
          <button className="btn" onClick={() => load()} title="Refresh data">
            <RefreshCw size={16} /> Refresh
          </button>
        </div>
      </section>

      {message && <p className="notice">{message}</p>}
      {paymentSetupNotice && <p className="notice">{paymentSetupNotice}</p>}

      <div className="grid public-grid">
        <section className="stack storefront-setup-stack">
          <div className="panel storefront-wallet-panel">
            <div className="panel-header">
              <h2>Wallet</h2>
              <Wallet size={18} />
            </div>
            <div className="form-grid">
              <TextField label="Wallet address" value={walletAddress} onChange={setWalletAddress} full />
            </div>
            <div className="wallet-provider-grid">
              {walletProviders.map((walletProvider) => (
                <button
                  className={`wallet-provider-button ${activeWalletProvider?.id === walletProvider.id ? "active" : ""}`}
                  disabled={busy === "wallet"}
                  key={walletProvider.id}
                  onClick={() => connectWallet(walletProvider)}
                  type="button"
                >
                  {walletProvider.icon ? <img alt="" src={walletProvider.icon} /> : <Wallet size={16} />}
                  {walletProvider.name}
                </button>
              ))}
              {walletProviders.length === 0 && (
                <button className="wallet-provider-button" disabled={busy === "wallet"} onClick={() => connectWallet()} type="button">
                  <Wallet size={16} /> Browser wallet
                </button>
              )}
            </div>
            <div className="button-row">
              <button className="btn primary" onClick={() => connectWallet()} disabled={busy === "wallet"}>
                <Wallet size={16} /> {busy === "wallet" ? "Connecting..." : hasWalletAddress ? "Switch wallet" : "Connect wallet"}
              </button>
              {hasWalletAddress && <span className="badge ok">connected {shortWallet(walletAddress)}</span>}
            </div>
          </div>

          <div className="panel storefront-pricing-panel">
            <div className="panel-header">
              <h2>Pricing</h2>
              <CircleDollarSign size={18} />
            </div>
            <div className="list">
              <div className="storefront-condition-tiles">
                {conditionTiles.map((tile) => <span key={tile}>{tile}</span>)}
              </div>
              {pricingOptions.map((item) => (
                <PricingOption
                  item={item}
                  key={item.id}
                  customer={customer}
                  selected={selectedPricing?.id === item.id}
                  onSelect={() => updateGenerationForm({ videoModel: item.videoModel, aspectRatio: item.aspectRatio })}
                />
              ))}
              {pricingOptions.length === 0 && <p className="subtle">This storefront has no enabled pricing options.</p>}
            </div>
          </div>
          {renderOrientationWarning && (
            <RenderOrientationWarningDialog
              warning={renderOrientationWarning}
              aspectRatio={generationForm.aspectRatio}
              onCancel={cancelRenderAfterOrientationWarning}
              onContinue={() => continueRenderAfterOrientationWarning().catch(() => undefined)}
            />
          )}
        </section>

        <section className="stack storefront-workflow-stack">
          <div className="panel panel-strong storefront-render-panel">
            <div className="panel-header">
              <h2>Render Task</h2>
              <Play size={18} />
            </div>
            <div className="render-mode-toolbar">
              <span className="subtle">Input mode</span>
              <div className="render-mode-actions">
                <div className="mode-toggle" role="group" aria-label="Render input mode">
                  <button
                    type="button"
                    className={renderFormMode === "simple" ? "active" : ""}
                    onClick={() => openRenderFormMode("simple")}
                  >
                    <ListChecks size={16} /> Simple wizard
                  </button>
                  <button
                    type="button"
                    className={renderFormMode === "advanced" ? "active" : ""}
                    onClick={() => openRenderFormMode("advanced")}
                  >
                    <Code2 size={16} /> Advanced JSON
                  </button>
                </div>
                <button type="button" className="btn small" onClick={resetGenerationForm}>
                  <Undo2 size={15} /> Reset session
                </button>
              </div>
            </div>
            {renderFormMode === "simple" ? (
              <SimpleRenderForm
                form={generationForm}
                imageWizardItems={imageWizardItems}
                metadataWizardItems={metadataWizardItems}
                outroFocusAreaWizard={outroFocusAreaWizard}
                imageCount={imageCount}
                onPatch={updateGenerationForm}
                onImageChange={updateImageWizardItem}
                onImageAdd={addImageWizardItem}
                onImageRemove={removeImageWizardItem}
                onImageMove={moveImageWizardItem}
                onMetadataChange={updateMetadataWizardItem}
                onMetadataAdd={addMetadataWizardItem}
                onMetadataRemove={removeMetadataWizardItem}
                onFocusAreaChange={updateOutroFocusAreaWizard}
              />
            ) : (
              <AdvancedRenderForm
                form={generationForm}
                generationPayloadPreview={generationPayloadPreview}
                onPatch={updateGenerationForm}
              />
            )}
            <PaymentSummary
              imageCount={imageCount}
              quote={quote}
              transactionChain={transactionChain}
              selectedPaymentToken={selectedPaymentToken}
              settlementToken={settlementToken}
              paymentRail={paymentRail}
              estimatedDurationSeconds={estimatedDurationSeconds}
              selectedPricingDetails={selectedPricingDetails}
            />
            <div className="button-row">
              <button className="btn" onClick={createQuote} disabled={busy === "quote" || imageCount === 0}>
                <CircleDollarSign size={16} /> Quote {paymentCurrency}
              </button>
              <PaymentActionControl
                tokens={selectablePaymentTokens}
                selectedSymbol={paymentCurrency}
                settlementToken={settlementToken}
                disabled={renderSubmitDisabled}
                busy={busy === "generation" || busy === "orientation"}
                locked={renderSessionLocked}
                onSelect={setPaymentCurrency}
                onPay={() => startRenderWithOrientationCheck(paymentCurrency)}
                busyLabel={busy === "orientation" ? "Checking..." : undefined}
              />
              {quote?.checkoutUrl && quote.paymentRail === "uniswap" && (
                <a className="btn" href={quote.checkoutUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={16} /> Open Uniswap
                </a>
              )}
              <a className="btn" href="/feed">
                <ExternalLink size={16} /> Open feed
              </a>
              {autoPolling && <span className="badge ok">polling {pollingGenerationIds.length} render{pollingGenerationIds.length === 1 ? "" : "s"}</span>}
              {!autoPolling && hasActiveUserGenerations && <span className="badge">tracking {pollingGenerationIds.length} active</span>}
            </div>
            {renderSessionLocked && (
              <p className="notice">This render session has already been submitted. Reset the session to enable a fresh payment and start another render.</p>
            )}
            {renderGateError && imageCount > 0 && <p className="notice">{renderGateError}</p>}
            <RenderFlowNotice state={renderFlow} />
          </div>

          <div className="panel storefront-user-video-panel">
            <div className="panel-header">
              <div>
                <h2>Your Videos</h2>
                <p className="subtle">Toggle between published videos and all INFTs created by this wallet on the current storefront.</p>
              </div>
              <Bot size={18} />
            </div>
            {connectedSubAccount ? (
              <StorefrontVideoGrid
                actor="user"
                allowBurn
                customerId={customer.id}
                emptyText="No completed videos for this wallet yet."
                ethereumProvider={activeWalletProvider?.provider || walletProviders[0]?.provider || null}
                initialPageSize={6}
                onRefresh={load}
                store={store}
                subAccountId={connectedSubAccount.id}
                wallet={connectedSubAccount.wallet || walletAddress}
              />
            ) : (
              <p className="subtle">Connect your wallet to view videos created by this wallet.</p>
            )}
            <div className="list">
              <div className="section-title compact">
                <h3>Task status</h3>
                {olderTaskGenerations.length > 0 && (
                  <button
                    className="btn small"
                    onClick={() => setShowOlderTasks((current) => !current)}
                    type="button"
                  >
                    <ChevronDown size={15} className={showOlderTasks ? "rotate-180" : ""} />
                    {showOlderTasks ? "Hide older" : `View older (${olderTaskGenerations.length})`}
                  </button>
                )}
              </div>
              {connectedSubAccount && userGenerations.length === 0 && <p className="subtle">No render tasks for this wallet yet.</p>}
              {primaryTaskGenerations.map((generation) => (
                <GenerationItem
                  key={generation.id}
                  generation={generation}
                  quote={store?.quotes.find((quote) => quote.id === generation.payment.quoteId) || null}
                  busy={busy === generation.id}
                  showReview={generation.id === latestCompletedGeneration?.id}
                  wallet={connectedSubAccount?.wallet || walletAddress}
                  onSync={() => syncGeneration(generation.id)}
                />
              ))}
              {showOlderTasks && olderTaskGenerations.length > 0 && (
                <div className="task-history-list">
                  {olderTaskGenerations.map((generation) => (
                    <GenerationItem
                      key={generation.id}
                      generation={generation}
                      quote={store?.quotes.find((quote) => quote.id === generation.payment.quoteId) || null}
                      busy={busy === generation.id}
                      showReview={false}
                      wallet={connectedSubAccount?.wallet || walletAddress}
                      onSync={() => syncGeneration(generation.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function SimpleRenderForm({
  form,
  imageWizardItems,
  metadataWizardItems,
  outroFocusAreaWizard,
  imageCount,
  onPatch,
  onImageChange,
  onImageAdd,
  onImageRemove,
  onImageMove,
  onMetadataChange,
  onMetadataAdd,
  onMetadataRemove,
  onFocusAreaChange
}: {
  form: GenerationFormState;
  imageWizardItems: ImageWizardItem[];
  metadataWizardItems: MetadataWizardItem[];
  outroFocusAreaWizard: OutroFocusAreaWizard;
  imageCount: number;
  onPatch: (patch: RenderFormPatch) => void;
  onImageChange: (index: number, patch: Partial<ImageWizardItem>) => void;
  onImageAdd: () => void;
  onImageRemove: (index: number) => void;
  onImageMove: (fromIndex: number, toIndex: number) => void;
  onMetadataChange: (index: number, patch: Partial<MetadataWizardItem>) => void;
  onMetadataAdd: () => void;
  onMetadataRemove: (index: number) => void;
  onFocusAreaChange: (field: keyof OutroFocusAreaWizard, value: string) => void;
}) {
  const [uploadingImageIndex, setUploadingImageIndex] = useState<number | null>(null);
  const [uploadError, setUploadError] = useState("");
  const [draggedImageIndex, setDraggedImageIndex] = useState<number | null>(null);
  const [dragOverImageIndex, setDragOverImageIndex] = useState<number | null>(null);
  const usesServerGeneratedOutro = Boolean(form.ctaUrl.trim());

  async function uploadImageFile(index: number, item: ImageWizardItem, file: File) {
    if (uploadingImageIndex !== null) {
      return;
    }
    if (!file.type.startsWith("image/")) {
      setUploadError("Upload an image file.");
      return;
    }
    setUploadingImageIndex(index);
    setUploadError("");
    try {
      const formData = new FormData();
      formData.set("image", file);
      const response = await fetch("/api/uploads/images", {
        method: "POST",
        body: formData
      });
      const data = await assertOk(response);
      const upload = data.upload as { url?: string; fileName?: string };
      if (!upload?.url) {
        throw new Error("Upload did not return an image URL.");
      }
      onImageChange(index, {
        image_url: upload.url,
        ...(item.title.trim() ? {} : { title: titleFromFileName(upload.fileName || file.name) })
      });
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Image upload failed.");
    } finally {
      setUploadingImageIndex(null);
    }
  }

  function handleUploadInput(index: number, item: ImageWizardItem, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      uploadImageFile(index, item, file).catch(() => undefined);
    }
  }

  function handleUploadDrop(index: number, item: ImageWizardItem, event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (uploadingImageIndex !== null) {
      return;
    }
    const file = Array.from(event.dataTransfer.files).find((candidate) => candidate.type.startsWith("image/"));
    if (file) {
      uploadImageFile(index, item, file).catch(() => undefined);
      return;
    }
    setUploadError("Drop a JPEG, PNG, or WebP image.");
  }

  function handleImageDragStart(event: DragEvent<HTMLButtonElement>, index: number) {
    if (uploadingImageIndex !== null) {
      event.preventDefault();
      return;
    }
    setDraggedImageIndex(index);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-superreferrals-image-index", String(index));
    event.dataTransfer.setData("text/plain", String(index));
  }

  function handleImageDragOver(event: DragEvent<HTMLDivElement>, index: number) {
    if (uploadingImageIndex !== null || isFileDragEvent(event) || draggedImageIndex === null) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverImageIndex(index);
  }

  function handleImageDrop(event: DragEvent<HTMLDivElement>, index: number) {
    if (uploadingImageIndex !== null || isFileDragEvent(event)) {
      return;
    }
    event.preventDefault();
    const fromIndex = parseDraggedImageIndex(event, draggedImageIndex);
    setDraggedImageIndex(null);
    setDragOverImageIndex(null);
    if (fromIndex !== null) {
      onImageMove(fromIndex, index);
    }
  }

  return (
    <div className="form-grid render-wizard-grid">
      <TextField
        label="INFT title"
        tooltip={renderFormTooltips.inftTitle}
        value={form.inftTitle}
        onChange={(inftTitle) => onPatch({ inftTitle })}
        full
      />

      <WizardSection
        title="Image scenes"
        tooltip={renderFormTooltips.imageScenes}
        badge={`${imageCount} ready`}
        actionLabel="Add image"
        onAction={onImageAdd}
      >
        {uploadError && <p className="notice compact">{uploadError}</p>}
        <div className="wizard-list">
          {imageWizardItems.map((item, index) => (
            <div
              className={`wizard-entry ${dragOverImageIndex === index ? "drag-over" : ""}`}
              key={`image-${index}`}
              onDragLeave={() => setDragOverImageIndex((current) => current === index ? null : current)}
              onDragOver={(event) => handleImageDragOver(event, index)}
              onDrop={(event) => handleImageDrop(event, index)}
            >
              <div className="wizard-image-grid">
                <div className="image-source-toolbar full">
                  <div className="field image-url-field">
                    <label><LabelWithTooltip label="Image URL" tooltip={renderFormTooltips.imageUrl} /></label>
                    <input
                      value={item.image_url}
                      onChange={(event) => onImageChange(index, { image_url: event.target.value })}
                      placeholder="https://..."
                    />
                  </div>
                  <label
                    className={`image-upload-zone ${uploadingImageIndex === index ? "uploading" : ""}`}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                    }}
                    onDrop={(event) => handleUploadDrop(index, item, event)}
                  >
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => handleUploadInput(index, item, event)}
                      disabled={uploadingImageIndex !== null}
                    />
                    <Upload size={16} />
                    <span>{uploadingImageIndex === index ? "Uploading..." : "Upload"}</span>
                  </label>
                  <div className="image-toolbar-actions">
                    <button
                      type="button"
                      className="icon-btn drag-handle"
                      draggable={uploadingImageIndex === null}
                      onDragStart={(event) => handleImageDragStart(event, index)}
                      onDragEnd={() => {
                        setDraggedImageIndex(null);
                        setDragOverImageIndex(null);
                      }}
                      title="Drag to reorder"
                      disabled={uploadingImageIndex !== null}
                    >
                      <GripVertical size={16} />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => onImageMove(index, index - 1)} disabled={uploadingImageIndex !== null || index === 0} title="Move image up">
                      <ArrowUp size={16} />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => onImageMove(index, index + 1)} disabled={uploadingImageIndex !== null || index === imageWizardItems.length - 1} title="Move image down">
                      <ArrowDown size={16} />
                    </button>
                    <button type="button" className="icon-btn danger" onClick={() => onImageRemove(index)} disabled={uploadingImageIndex !== null} title="Remove image">
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                <ImageUrlPreview rawUrl={item.image_url} title={item.title} />
                <TextField
                  label="Title"
                  tooltip={renderFormTooltips.imageTitle}
                  value={item.title}
                  onChange={(title) => onImageChange(index, { title })}
                />
                <TextField
                  label="Image text"
                  tooltip={renderFormTooltips.imageText}
                  value={item.image_text}
                  onChange={(image_text) => onImageChange(index, { image_text })}
                />
              </div>
            </div>
          ))}
        </div>
      </WizardSection>

      <div className="field full">
        <label><LabelWithTooltip label="Prompt" tooltip={renderFormTooltips.prompt} /></label>
        <textarea value={form.prompt} onChange={(event) => onPatch({ prompt: event.target.value })} />
      </div>

      <SelectField
        label="Rendition language"
        tooltip={renderFormTooltips.language}
        value={form.language}
        options={supportedRenditionLanguages}
        onChange={(language) => onPatch({ language })}
      />
      <label className="toggle-row" title={renderFormTooltips.subtitles}>
        <input
          type="checkbox"
          checked={form.enableSubtitles}
          onChange={(event) => onPatch({ enableSubtitles: event.target.checked })}
        />
        Enable subtitles
      </label>

      <WizardSection
        title="Campaign metadata"
        tooltip={renderFormTooltips.campaignMetadata}
        actionLabel="Add field"
        onAction={onMetadataAdd}
      >
        <div className="wizard-list">
          {metadataWizardItems.map((item, index) => (
            <div className="wizard-key-value" key={`metadata-${index}`}>
              <div className="field">
                <label><LabelWithTooltip label="Field" tooltip={renderFormTooltips.metadataField} /></label>
                <input
                  value={item.key}
                  onChange={(event) => onMetadataChange(index, { key: event.target.value })}
                  placeholder="campaign"
                />
              </div>
              <div className="field">
                <label><LabelWithTooltip label="Value" tooltip={renderFormTooltips.metadataValue} /></label>
                <input
                  value={item.value}
                  onChange={(event) => onMetadataChange(index, { value: event.target.value })}
                  placeholder="customer-store"
                />
              </div>
              <button type="button" className="icon-btn danger" onClick={() => onMetadataRemove(index)} title="Remove field">
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      </WizardSection>

      <PublishTargets form={form} onPatch={onPatch} />
      <TextField label="Feed tags" tooltip={renderFormTooltips.feedTags} value={form.feedTags} onChange={(feedTags) => onPatch({ feedTags })} />

      <WizardSection
        title="Server-side outro image from URL"
        tooltip={renderFormTooltips.outro}
        badge={usesServerGeneratedOutro ? "enabled" : "URL required"}
      >
        <div className="form-grid">
          <TextField label="CTA outro URL" tooltip={renderFormTooltips.ctaUrl} value={form.ctaUrl} onChange={(ctaUrl) => onPatch({ ctaUrl })} />
          {usesServerGeneratedOutro && (
            <>
              <TextField
                label="CTA top text"
                tooltip={renderFormTooltips.ctaTextTop}
                value={form.ctaTextTop}
                onChange={(ctaTextTop) => onPatch({ ctaTextTop })}
              />
              <TextField
                label="CTA bottom text"
                tooltip={renderFormTooltips.ctaTextBottom}
                value={form.ctaTextBottom}
                onChange={(ctaTextBottom) => onPatch({ ctaTextBottom })}
              />
              <TextField
                label="CTA logo URL"
                tooltip={renderFormTooltips.ctaLogo}
                value={form.ctaLogo}
                onChange={(ctaLogo) => onPatch({ ctaLogo })}
                full
              />
              <label className="toggle-row" title={renderFormTooltips.outroAnimation}>
                <input
                  type="checkbox"
                  checked={form.addOutroAnimation}
                  onChange={(event) => onPatch({ addOutroAnimation: event.target.checked })}
                />
                Animate server-generated outro
              </label>
              <label className="toggle-row" title={renderFormTooltips.outroFocusAnimation}>
                <input
                  type="checkbox"
                  checked={form.addOutroFocusArea}
                  onChange={(event) => onPatch({ addOutroFocusArea: event.target.checked })}
                />
                Animate outro image focus area
              </label>
              <label className="toggle-row" title={renderFormTooltips.footerAnimation}>
                <input
                  type="checkbox"
                  checked={form.addFooterAnimation}
                  onChange={(event) => onPatch({ addFooterAnimation: event.target.checked })}
                />
                Animate per-scene CTA footer
              </label>
            </>
          )}
        </div>
      </WizardSection>

      {usesServerGeneratedOutro && form.addOutroFocusArea && (
        <WizardSection title="Outro focus area" tooltip={renderFormTooltips.outroFocusArea}>
          <div className="focus-area-grid">
            {(["x", "y", "width", "height"] as Array<keyof OutroFocusAreaWizard>).map((field) => (
              <div className="field" key={field}>
                <label><LabelWithTooltip label={field} tooltip={renderFormTooltips.outroFocusArea} /></label>
                <input
                  type="number"
                  min="0"
                  value={outroFocusAreaWizard[field]}
                  onChange={(event) => onFocusAreaChange(field, event.target.value)}
                />
              </div>
            ))}
          </div>
        </WizardSection>
      )}

      <TextField
        label="Payment tx hash (manual fallback)"
        tooltip={renderFormTooltips.paymentTxHash}
        value={form.txHash}
        onChange={(txHash) => onPatch({ txHash })}
        full
      />
    </div>
  );
}

function isFileDragEvent(event: DragEvent<HTMLElement>) {
  return Array.from(event.dataTransfer.types).includes("Files");
}

function parseDraggedImageIndex(event: DragEvent<HTMLElement>, fallback: number | null) {
  const raw =
    event.dataTransfer.getData("application/x-superreferrals-image-index") ||
    event.dataTransfer.getData("text/plain");
  const parsed = Number(raw);
  if (Number.isInteger(parsed) && parsed >= 0) {
    return parsed;
  }
  return fallback;
}

function titleFromFileName(fileName: string) {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

type ImageUrlPreviewState =
  | { imageUrl: string; status: "empty" }
  | { imageUrl: string; status: "invalid"; message: string }
  | { imageUrl: string; status: "loading" }
  | { imageUrl: string; status: "loaded"; width: number; height: number }
  | { imageUrl: string; status: "failed"; message: string };

function createImagePreviewState(imageUrl: string, previewError: string): ImageUrlPreviewState {
  if (!imageUrl) {
    return { imageUrl, status: "empty" };
  }
  if (previewError) {
    return { imageUrl, status: "invalid", message: previewError };
  }
  return { imageUrl, status: "loading" };
}

function ImageUrlPreview({ rawUrl, title }: { rawUrl: string; title: string }) {
  const imageUrl = rawUrl.trim();
  const previewTitle = title.trim();
  const previewError = getImagePreviewUrlError(imageUrl);
  const [state, setState] = useState<ImageUrlPreviewState>(() =>
    createImagePreviewState(imageUrl, previewError)
  );
  const activeState = state.imageUrl === imageUrl ? state : createImagePreviewState(imageUrl, previewError);

  useEffect(() => {
    if (!imageUrl) {
      setState({ imageUrl, status: "empty" });
      return;
    }
    if (previewError) {
      setState({ imageUrl, status: "invalid", message: previewError });
      return;
    }
    let cancelled = false;
    const image = new Image();
    const timeout = window.setTimeout(() => {
      if (!cancelled) {
        setState({
          imageUrl,
          status: "failed",
          message: "Preview timed out while detecting this image ratio."
        });
      }
    }, 15000);

    function clearPreviewTimeout() {
      window.clearTimeout(timeout);
    }

    function completeLoadedPreview() {
      clearPreviewTimeout();
      if (cancelled) return;
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        setState({
          imageUrl,
          status: "loaded",
          width: image.naturalWidth,
          height: image.naturalHeight
        });
        return;
      }
      setState({
        imageUrl,
        status: "failed",
        message: "Preview loaded without readable image dimensions."
      });
    }

    setState({ imageUrl, status: "loading" });
    image.onload = completeLoadedPreview;
    image.onerror = () => {
      clearPreviewTimeout();
      if (!cancelled) {
        setState({ imageUrl, status: "failed", message: "Preview unavailable for this image URL." });
      }
    };
    image.decoding = "async";
    image.src = imageUrl;
    if (image.complete) {
      completeLoadedPreview();
    }
    return () => {
      cancelled = true;
      clearPreviewTimeout();
      image.onload = null;
      image.onerror = null;
    };
  }, [imageUrl, previewError]);

  if (!imageUrl) {
    return null;
  }

  const aspectRatio = activeState.status === "loaded" ? formatDetectedAspectRatio(activeState.width, activeState.height) : "";
  const statusText =
    activeState.status === "loaded" ? aspectRatio :
      activeState.status === "loading" ? "Detecting aspect ratio..." :
        activeState.status === "invalid" || activeState.status === "failed" ? activeState.message :
          "";

  return (
    <div className={`image-url-preview image-url-preview-${activeState.status}`}>
      <div className="image-url-preview-frame">
        {activeState.status === "loaded" && (
          <img
            key={imageUrl}
            src={imageUrl}
            alt={previewTitle ? `${previewTitle} preview` : "Image preview"}
            loading="lazy"
            decoding="async"
          />
        )}
        {activeState.status !== "loaded" && <span>{activeState.status === "loading" ? "Loading" : "No preview"}</span>}
        <div className="image-url-preview-overlay">
          {previewTitle && <strong>{previewTitle}</strong>}
          {statusText && <span>{statusText}</span>}
        </div>
      </div>
    </div>
  );
}

function PublishTargets({
  form,
  onPatch
}: {
  form: GenerationFormState;
  onPatch: (patch: RenderFormPatch) => void;
}) {
  return (
    <div className="field full publish-targets">
      <label><LabelWithTooltip label="Publish to" tooltip={renderFormTooltips.publishTargets} /></label>
      <div className="publish-target-options">
        <label className="toggle-row" title="Publishes to the application feed">
          <input
            type="checkbox"
            checked={form.publishToFeed}
            onChange={(event) => onPatch({ publishToFeed: event.target.checked })}
          />
          Feed
        </label>
        <label className="toggle-row" title="Publishes to the samsar-js gallery">
          <input
            type="checkbox"
            checked={form.publishToSamsarGallery}
            onChange={(event) => onPatch({ publishToSamsarGallery: event.target.checked })}
          />
          Public gallery
        </label>
      </div>
    </div>
  );
}

function AdvancedRenderForm({
  form,
  generationPayloadPreview,
  onPatch
}: {
  form: GenerationFormState;
  generationPayloadPreview: string;
  onPatch: (patch: RenderFormPatch) => void;
}) {
  return (
    <div className="form-grid">
      <TextField label="INFT title" tooltip={renderFormTooltips.inftTitle} value={form.inftTitle} onChange={(inftTitle) => onPatch({ inftTitle })} full />
      <div className="field full">
        <label><LabelWithTooltip label="Image URL metadata JSON array" tooltip={renderFormTooltips.imageJson} /></label>
        <textarea value={form.imageUrls} onChange={(event) => onPatch({ imageUrls: event.target.value })} />
      </div>
      <div className="field full">
        <label><LabelWithTooltip label="JSON payload metadata" tooltip={renderFormTooltips.metadataJson} /></label>
        <textarea value={form.metadata} onChange={(event) => onPatch({ metadata: event.target.value })} />
      </div>
      <PublishTargets form={form} onPatch={onPatch} />
      <TextField label="Feed tags" tooltip={renderFormTooltips.feedTags} value={form.feedTags} onChange={(feedTags) => onPatch({ feedTags })} />
      <div className="field full">
        <label><LabelWithTooltip label="Prompt" tooltip={renderFormTooltips.prompt} /></label>
        <textarea value={form.prompt} onChange={(event) => onPatch({ prompt: event.target.value })} />
      </div>
      <SelectField
        label="Rendition language"
        tooltip={renderFormTooltips.language}
        value={form.language}
        options={supportedRenditionLanguages}
        onChange={(language) => onPatch({ language })}
      />
      <label className="toggle-row" title={renderFormTooltips.subtitles}>
        <input
          type="checkbox"
          checked={form.enableSubtitles}
          onChange={(event) => onPatch({ enableSubtitles: event.target.checked })}
        />
        Enable subtitles
      </label>
      <TextField label="CTA outro URL" tooltip={renderFormTooltips.ctaUrl} value={form.ctaUrl} onChange={(ctaUrl) => onPatch({ ctaUrl })} />
      <TextField label="CTA top text" tooltip={renderFormTooltips.ctaTextTop} value={form.ctaTextTop} onChange={(ctaTextTop) => onPatch({ ctaTextTop })} />
      <TextField label="CTA bottom text" tooltip={renderFormTooltips.ctaTextBottom} value={form.ctaTextBottom} onChange={(ctaTextBottom) => onPatch({ ctaTextBottom })} />
      <TextField label="CTA logo URL" tooltip={renderFormTooltips.ctaLogo} value={form.ctaLogo} onChange={(ctaLogo) => onPatch({ ctaLogo })} full />
      <TextField label="Payment tx hash (manual fallback)" tooltip={renderFormTooltips.paymentTxHash} value={form.txHash} onChange={(txHash) => onPatch({ txHash })} full />
      <label className="toggle-row" title={renderFormTooltips.outroAnimation}>
        <input
          type="checkbox"
          checked={form.addOutroAnimation}
          onChange={(event) => onPatch({ addOutroAnimation: event.target.checked })}
        />
        Animate server-generated outro
      </label>
      <label className="toggle-row" title={renderFormTooltips.outroFocusAnimation}>
        <input
          type="checkbox"
          checked={form.addOutroFocusArea}
          onChange={(event) => onPatch({ addOutroFocusArea: event.target.checked })}
        />
        Animate outro image focus area
      </label>
      <label className="toggle-row" title={renderFormTooltips.footerAnimation}>
        <input
          type="checkbox"
          checked={form.addFooterAnimation}
          onChange={(event) => onPatch({ addFooterAnimation: event.target.checked })}
        />
        Animate per-scene CTA footer
      </label>
      <div className="field full">
        <label><LabelWithTooltip label="Outro focus area JSON" tooltip={renderFormTooltips.outroFocusArea} /></label>
        <textarea
          value={form.outroFocusArea}
          onChange={(event) => onPatch({ outroFocusArea: event.target.value })}
        />
      </div>
      <div className="field full">
        <label><LabelWithTooltip label="Generated SuperReferrals payload preview" tooltip={renderFormTooltips.payloadPreview} /></label>
        <textarea className="payload-preview" value={generationPayloadPreview} readOnly />
      </div>
    </div>
  );
}

function WizardSection({
  title,
  tooltip,
  badge,
  actionLabel,
  onAction,
  children
}: {
  title: string;
  tooltip?: string;
  badge?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="wizard-section full">
      <div className="wizard-section-header">
        <div>
          <label><LabelWithTooltip label={title} tooltip={tooltip} /></label>
          {badge && <span className="badge">{badge}</span>}
        </div>
        {actionLabel && onAction && (
          <button type="button" className="btn small" onClick={onAction}>
            <Plus size={15} /> {actionLabel}
          </button>
        )}
      </div>
      {children}
    </div>
  );
}

function RenderFlowNotice({ state }: { state: RenderFlowState }) {
  if (state.status === "idle") {
    return null;
  }
  const failedAfterStart = state.status === "failed" && Boolean(state.generationId);
  const finalizationFailed = state.status === "failed" && state.message.includes("0G persistence");
  const statusLabel =
    state.status === "failed" ? (finalizationFailed ? "Finalization failed" : failedAfterStart ? "Render failed" : "Render not started") :
      state.status === "completed" ? "Render finished" :
        state.status === "started" ? "Render started" :
          state.status === "starting" ? "Starting render" :
            state.status === "confirming" ? "Confirming payment" :
              "Payment required";
  const badgeClass = state.status === "failed" ? "badge fail" : state.status === "completed" || state.status === "started" ? "badge ok" : "badge";
  return (
    <div className={`render-status ${state.status === "failed" ? "fail" : ""}`}>
      <div className="item-title">
        <strong>{statusLabel}</strong>
        <span className={badgeClass}>{state.status}</span>
      </div>
      <p className="subtle">{state.message}</p>
      {state.txHash && <div className="mono">tx {state.txHash}</div>}
      {state.generationId && <div className="mono">task {state.generationId}</div>}
    </div>
  );
}

function RenderOrientationWarningDialog({
  warning,
  aspectRatio,
  onCancel,
  onContinue
}: {
  warning: RenderOrientationWarning;
  aspectRatio: VideoAspectRatio;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const imageLabel = orientationLabel(warning.imageOrientation);
  const renderLabel = orientationLabel(warning.renderOrientation);
  return (
    <div className="render-warning-backdrop" role="presentation">
      <div
        className="render-warning-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="render-orientation-warning-title"
      >
        <div className="render-warning-title">
          <AlertTriangle size={22} aria-hidden="true" />
          <h3 id="render-orientation-warning-title">Dimension mismatch</h3>
        </div>
        <p>
          Image height and width don't match dimensions of result video. Quality may be affected.
        </p>
        <div className="render-warning-details">
          Most detected images are {imageLabel} ({warning.majorityCount} of {warning.detectedCount}), but the result video is {renderLabel} ({aspectRatio}).
          {warning.skippedCount > 0 && ` ${warning.skippedCount} image${warning.skippedCount === 1 ? "" : "s"} could not be checked.`}
        </div>
        <div className="render-warning-actions">
          <button type="button" className="btn" onClick={onCancel}>
            No
          </button>
          <button type="button" className="btn primary" onClick={onContinue}>
            Yes, continue
          </button>
        </div>
      </div>
    </div>
  );
}

function PricingOption({
  item,
  customer,
  selected,
  onSelect
}: {
  item: ModelPricingConfiguration;
  customer: Customer;
  selected: boolean;
  onSelect: () => void;
}) {
  const details = resolveModelPriceDetails(customer, item);
  return (
    <button
      className="item"
      onClick={onSelect}
      style={{ textAlign: "left", borderColor: selected ? "var(--accent-cool)" : undefined }}
    >
      <div className="item-title">
        <strong>{item.label}</strong>
        <span className="badge ok">{details.pricePerSecondUsd.toFixed(2)} USDC/sec</span>
      </div>
      <p className="subtle">
        {item.videoModel} · {item.aspectRatio} · up to {item.maxSecondsPerImage}s/image
      </p>
    </button>
  );
}

function PaymentActionControl({
  tokens,
  selectedSymbol,
  settlementToken,
  disabled,
  busy,
  busyLabel,
  locked,
  onSelect,
  onPay
}: {
  tokens: PaymentToken[];
  selectedSymbol: PaymentCurrencySymbol;
  settlementToken: PaymentToken;
  disabled: boolean;
  busy: boolean;
  busyLabel?: string;
  locked: boolean;
  onSelect: (symbol: PaymentCurrencySymbol) => void;
  onPay: () => void;
}) {
  const orderedTokens = [...tokens].sort((left, right) => paymentTokenRank(left) - paymentTokenRank(right));
  const selectedToken = orderedTokens.find((token) => token.symbol === selectedSymbol) || orderedTokens[0];
  const currencyTooltip = selectedToken
    ? paymentCurrencyTooltip(selectedToken, settlementToken)
    : "Choose payment currency";
  return (
    <div className="payment-action-control" title={currencyTooltip}>
      <button className="btn primary payment-action-main" disabled={disabled} onClick={onPay} type="button">
        <Play size={16} /> {busy ? busyLabel || "Starting..." : locked ? "Reset session first" : `Pay ${selectedSymbol} & start render`}
      </button>
      <span className="payment-action-currency">
        <select
          aria-label="Payment currency"
          className="payment-action-currency-select"
          title={currencyTooltip}
          value={selectedSymbol}
          onChange={(event) => onSelect(event.target.value as PaymentCurrencySymbol)}
          disabled={busy}
        >
          {orderedTokens.map((token) => (
            <option value={token.symbol} key={`${token.chainId}:${token.address}`}>
              {token.symbol}
            </option>
          ))}
        </select>
        <ChevronDown className="payment-action-currency-icon" size={18} aria-hidden="true" />
      </span>
    </div>
  );
}

function paymentCurrencyTooltip(token: PaymentToken, settlementToken: PaymentToken) {
  const rail = resolveUserPaymentRail(token, settlementToken);
  if (rail === "direct") {
    return `Pay ${token.symbol} directly to the merchant settlement wallet.`;
  }
  return `Pay ${token.symbol}; KeeperHub settles ${settlementToken.symbol} to the merchant.`;
}

function PaymentSummary({
  imageCount,
  quote,
  transactionChain,
  selectedPaymentToken,
  settlementToken,
  paymentRail,
  estimatedDurationSeconds,
  selectedPricingDetails
}: {
  imageCount: number;
  quote: PaymentQuote | null;
  transactionChain: TransactionChainConfig;
  selectedPaymentToken: PaymentToken;
  settlementToken: PaymentToken;
  paymentRail: PaymentRail;
  estimatedDurationSeconds: number;
  selectedPricingDetails: ReturnType<typeof resolveModelPriceDetails>;
}) {
  return (
    <div className="payment-summary">
      <div>
        <span className="subtle">Images</span>
        <strong>{imageCount}</strong>
      </div>
      <div>
        <span className="subtle">Est. seconds</span>
        <strong>{estimatedDurationSeconds}</strong>
      </div>
      <div>
        <span className="subtle">User price</span>
        <strong>{selectedPricingDetails.pricePerSecondUsd.toFixed(2)} USDC/sec</strong>
      </div>
      <div>
        <span className="subtle">Paying</span>
        <strong>{selectedPaymentToken.symbol}</strong>
      </div>
      <div>
        <span className="subtle">Network</span>
        <strong>{transactionChain.name}</strong>
      </div>
      <div>
        <span className="subtle">Settlement</span>
        <strong>{settlementToken.symbol}</strong>
      </div>
      <div>
        <span className="subtle">Payment path</span>
        <strong>{quote?.paymentRail || paymentRail}</strong>
      </div>
      {quote?.paymentAmountAtomic && (
        <div>
          <span className="subtle">Pay amount</span>
          <strong>{formatAtomicAmount(BigInt(quote.paymentAmountAtomic), selectedPaymentToken.decimals)} {quote.paymentCurrency || selectedPaymentToken.symbol}</strong>
        </div>
      )}
      {quote && (
        <div className="payment-total">
          <span className="subtle">Quote</span>
          <strong>{quote.totalUsd.toFixed(2)} {quote.settlementCurrency || settlementToken.symbol}</strong>
        </div>
      )}
    </div>
  );
}

function paymentTokenRank(token: PaymentToken) {
  const preferredOrder: Record<string, number> = {
    USDC: 0,
    ETH: 1,
    WETH: 2,
    USDT: 3
  };
  return preferredOrder[token.symbol] ?? 10;
}

function resolveUserPaymentRail(paymentToken: PaymentToken, settlementToken: PaymentToken): PaymentRail {
  return paymentToken.address.toLowerCase() === settlementToken.address.toLowerCase() ? "direct" : "keeperhub";
}

function generationTime(generation: Generation) {
  return Date.parse(generation.updatedAt || generation.createdAt) || 0;
}

function generationTaskTitle(generation: Generation) {
  const metadataTitle = typeof generation.input.metadata?.title === "string"
    ? generation.input.metadata.title.trim()
    : "";
  return metadataTitle || `Render ${generation.id.slice(0, 10)}`;
}

function formatGenerationTimestamp(generation: Generation) {
  const value = Date.parse(generation.updatedAt || generation.createdAt);
  if (!Number.isFinite(value)) {
    return "recent";
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(value);
}

function GenerationItem({
  generation,
  quote,
  busy,
  showReview,
  wallet,
  onSync
}: {
  generation: Generation;
  quote?: PaymentQuote | null;
  busy: boolean;
  showReview: boolean;
  wallet?: string;
  onSync: () => void;
}) {
  const badgeClass = generation.status === "COMPLETED" ? "badge ok" : generation.status === "FAILED" ? "badge fail" : "badge";
  const paymentSummary = formatGenerationPaymentSummary(generation, quote);
  return (
    <div className="item task-status-item">
      <div className="item-title">
        <strong>{generationTaskTitle(generation)}</strong>
        <span className={badgeClass}>{generation.status}</span>
      </div>
      <p className="subtle task-status-summary">
        <span>{formatGenerationTimestamp(generation)}</span>
        <span>{generation.input.image_urls.length} image{generation.input.image_urls.length === 1 ? "" : "s"}</span>
        <span>{generation.input.video_model}</span>
        <span>{generation.input.aspect_ratio}</span>
        <span>{paymentSummary}</span>
      </p>
      {generation.errorMessage && <p className="subtle">{generation.errorMessage}</p>}
      <div className="button-row">
        <button className="btn" onClick={onSync} disabled={busy || generation.status === "COMPLETED"}>
          <RefreshCw size={16} /> Sync
        </button>
        {generation.inftId && <a className="btn" href={`/inft/${generation.inftId}`}><ExternalLink size={16} /> Open INFT</a>}
        {generation.feed?.published && generation.status === "COMPLETED" && <a className="btn" href={feedHrefForGeneration(generation)}><ExternalLink size={16} /> View in feed</a>}
      </div>
      {showReview && generation.status === "COMPLETED" && (
        <StorefrontRatingForm
          customerId={generation.customerId}
          subAccountId={generation.subAccountId}
          generationId={generation.id}
          inftId={generation.inftId}
          wallet={wallet}
          operation="video_render"
          title="Rate this storefront after your render"
        />
      )}
    </div>
  );
}

function feedHrefForGeneration(generation: Generation) {
  const mode = generation.input.aspect_ratio === "9:16" ? "mobile" : "desktop";
  return `/feed/${encodeURIComponent(generation.id)}/${mode}`;
}

function formatGenerationPaymentSummary(generation: Generation, quote?: PaymentQuote | null) {
  const settlementSymbol = quote?.settlementCurrency || generation.payment.settlementTokenSymbol || "USDC";
  const quoteSummary = `${generation.payment.amountUsd.toFixed(2)} ${settlementSymbol} quote`;
  const paymentSymbol = quote?.paymentCurrency || generation.payment.tokenSymbol;
  const paymentAmountAtomic =
    generation.payment.verification?.amountAtomic ||
    generation.payment.paymentAmountAtomic ||
    quote?.paymentAmountAtomic;
  const paymentToken = resolveGenerationPaymentToken(generation, quote);
  const paidAmount = formatAtomicAmountString(paymentAmountAtomic, paymentToken?.decimals);

  if (!paymentSymbol || !paidAmount || paymentSymbol === settlementSymbol) {
    return quoteSummary;
  }

  return `${quoteSummary} · ${paidAmount} ${paymentSymbol} paid`;
}

function resolveGenerationPaymentToken(generation: Generation, quote?: PaymentQuote | null) {
  const chainId = quote?.chainId || generation.payment.chainId || getTransactionChainConfig().id;
  return (
    findPaymentToken(quote?.paymentTokenAddress || generation.payment.tokenAddress || "", chainId) ||
    getPaymentTokens(chainId).find((token) => token.symbol === (quote?.paymentCurrency || generation.payment.tokenSymbol))
  );
}

function formatAtomicAmountString(amountAtomic?: string, decimals?: number) {
  if (!amountAtomic || decimals === undefined) {
    return "";
  }
  try {
    return formatAtomicAmount(BigInt(amountAtomic), decimals);
  } catch {
    return "";
  }
}

type SelectFieldOption = string | { value: string; label: string };

function LabelWithTooltip({ label, tooltip }: { label: ReactNode; tooltip?: string }) {
  if (!tooltip) {
    return <>{label}</>;
  }
  return (
    <span className="label-with-tooltip" title={tooltip}>
      <span>{label}</span>
      <CircleHelp size={13} aria-hidden="true" />
    </span>
  );
}

function TextField({
  label,
  tooltip,
  value,
  onChange,
  type = "text",
  full = false
}: {
  label: string;
  tooltip?: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  full?: boolean;
}) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label><LabelWithTooltip label={label} tooltip={tooltip} /></label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SelectField({
  label,
  tooltip,
  value,
  options,
  onChange
}: {
  label: string;
  tooltip?: string;
  value: string;
  options: SelectFieldOption[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label><LabelWithTooltip label={label} tooltip={tooltip} /></label>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => {
          const optionValue = typeof option === "string" ? option : option.value;
          const optionLabel = typeof option === "string" ? option : option.label;
          return <option value={optionValue} key={optionValue}>{optionLabel}</option>;
        })}
      </select>
    </div>
  );
}

async function requestUniswapSwap(provider: EthereumProvider, quote: PaymentQuote, wallet: string, chainName: string) {
  const route = quote.route && typeof quote.route === "object" ? quote.route as Record<string, unknown> : {};
  const swapQuote = route.quote;
  if (!swapQuote || typeof swapQuote !== "object") {
    throw new Error("Live Uniswap quote data is required for swap payment. Create a quote with Uniswap enabled, or use the Uniswap link and paste the final payment transfer hash.");
  }
  const permitData = route.permitData;
  const signature = permitData
    ? String(await provider.request({
      method: "eth_signTypedData_v4",
      params: [wallet, JSON.stringify(permitData)]
    }))
    : undefined;
  const response = await fetch("/api/payments/uniswap-swap", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      quote: swapQuote,
      permitData,
      signature
    })
  });
  const data = await assertOk(response);
  const swapResponse = data.swap && typeof data.swap === "object" ? data.swap as Record<string, unknown> : {};
  const tx = swapResponse.swap && typeof swapResponse.swap === "object" ? swapResponse.swap as Record<string, unknown> : {};
  if (!tx.to || !tx.data) {
    throw new Error("Uniswap swap response did not include a transaction.");
  }
  const transaction = compactTransaction({
    from: wallet,
    to: String(tx.to),
    data: String(tx.data),
    value: toRpcQuantity(tx.value)
  });
  const gas = await estimateWalletGas(provider, transaction, {
    label: "Uniswap swap",
    chainName,
    recovery: "Try Pay with USDC on the direct rail, or use Open Uniswap and paste the final settlement transfer hash."
  });
  return sendWalletTransaction(provider, { ...transaction, gas }, {
    label: "Uniswap swap",
    chainName,
    recovery: "Try Pay with USDC on the direct rail, or use Open Uniswap and paste the final settlement transfer hash."
  });
}

async function requestTokenTransfer({
  provider,
  from,
  token,
  recipient,
  amountAtomic,
  label,
  chainName
}: {
  provider: EthereumProvider;
  from: string;
  token: PaymentToken;
  recipient: string;
  amountAtomic: string;
  label: string;
  chainName: string;
}) {
  if (!isUsableEvmAddress(recipient)) {
    throw new Error(`${label} recipient is missing, invalid, or the zero address. No wallet transaction was submitted.`);
  }
  await assertWalletBalance(provider, from, token, amountAtomic);
  const tx = token.native
    ? {
      from,
      to: recipient,
      value: toRpcQuantity(amountAtomic),
      gas: "0x5208"
    }
    : {
      from,
      to: token.address,
      data: buildErc20TransferData(recipient, amountAtomic),
      value: "0x0",
      gas: "0x1d4c0"
    };
  return sendWalletTransaction(provider, tx, { label, chainName });
}

async function sendWalletTransaction(
  provider: EthereumProvider,
  transaction: Record<string, unknown>,
  context: { label: string; chainName: string; recovery?: string }
) {
  try {
    return String(await provider.request({
      method: "eth_sendTransaction",
      params: [compactTransaction(transaction)]
    }));
  } catch (error) {
    console.error(`${context.label} wallet transaction failed`, {
      chainName: context.chainName,
      to: transaction.to,
      value: transaction.value,
      gas: transaction.gas,
      error
    });
    throw new Error(formatWalletTransactionError(error, context));
  }
}

async function estimateWalletGas(
  provider: EthereumProvider,
  transaction: Record<string, unknown>,
  context: { label: string; chainName: string; recovery?: string }
) {
  try {
    const gas = BigInt(String(await provider.request({
      method: "eth_estimateGas",
      params: [compactTransaction(transaction)]
    })));
    const paddedGas = (gas * 12n) / 10n + 1n;
    const maxReasonableSwapGas = 4_000_000n;
    if (paddedGas > maxReasonableSwapGas) {
      throw new Error(`${context.label} estimated an unusually high gas limit (${paddedGas.toString()}) on ${context.chainName}. No transaction was submitted and the render was not started. ${context.recovery || ""}`.trim());
    }
    return toRpcQuantity(paddedGas);
  } catch (error) {
    if (error instanceof Error && error.message.includes("unusually high gas limit")) {
      throw error;
    }
    throw new Error(formatWalletTransactionError(error, context));
  }
}

async function assertWalletBalance(provider: EthereumProvider, owner: string, token: PaymentToken, amountAtomic: string) {
  const requiredAmount = BigInt(amountAtomic || "0");
  const balance = token.native
    ? BigInt(String(await provider.request({ method: "eth_getBalance", params: [owner, "latest"] })))
    : await readErc20Balance(provider, token.address, owner);
  if (balance < requiredAmount) {
    const recovery = token.symbol === "USDC"
      ? "Select ETH in the payment currency dropdown and click Pay ETH & start render to create a fresh KeeperHub settlement quote."
      : "Use another payment currency and start again to create a fresh quote.";
    throw new Error(`Insufficient ${token.symbol} balance for payment. Required ${formatAtomicAmount(requiredAmount, token.decimals)} ${token.symbol}, available ${formatAtomicAmount(balance, token.decimals)} ${token.symbol}. ${recovery} Render was not started.`);
  }
}

async function readErc20Balance(provider: EthereumProvider, tokenAddress: string, owner: string) {
  const result = await provider.request({
    method: "eth_call",
    params: [{
      to: tokenAddress,
      data: `0x70a08231${encodeAddressWord(owner)}`
    }, "latest"]
  });
  return BigInt(String(result || "0x0"));
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

function buildErc20TransferData(recipient: string, amountAtomic: string) {
  const cleanRecipient = encodeAddressWord(recipient);
  const cleanAmount = BigInt(amountAtomic || "0").toString(16).padStart(64, "0");
  return `0xa9059cbb${cleanRecipient}${cleanAmount}`;
}

function encodeAddressWord(address: string) {
  const cleanAddress = address.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-f]{40}$/.test(cleanAddress)) {
    throw new Error("Invalid wallet address");
  }
  return cleanAddress.padStart(64, "0");
}

function formatAtomicAmount(amount: bigint, decimals: number) {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  if (fraction === 0n) {
    return whole.toString();
  }
  const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole.toString()}.${fractionText}`;
}

function toRpcQuantity(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" && value.startsWith("0x")) {
    return `0x${BigInt(value).toString(16)}`;
  }
  const bigint = BigInt(String(value));
  return `0x${bigint.toString(16)}`;
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

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function ensureWalletNetwork(provider: EthereumProvider, chain: TransactionChainConfig) {
  const currentChainId = await provider.request({ method: "eth_chainId" }).catch(() => "");
  if (String(currentChainId).toLowerCase() === chain.hexChainId.toLowerCase()) {
    return;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hexChainId }]
    });
  } catch (error) {
    if (walletErrorCode(error) !== 4902) {
      throw new Error(`Switch wallet to ${chain.name} to continue.`);
    }
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId: chain.hexChainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: chain.rpcUrls,
        blockExplorerUrls: chain.blockExplorerUrls
      }]
    });
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: chain.hexChainId }]
    });
  }
}

function walletErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error ? Number((error as { code?: unknown }).code) : 0;
}

function formatWalletTransactionError(
  error: unknown,
  context: { label: string; chainName: string; recovery?: string }
) {
  const message = formatErrorMessage(error, `${context.label} failed`);
  if (/gas limit too high/i.test(message)) {
    return `Wallet rejected ${context.label} before broadcast: gas limit too high on ${context.chainName}. No transaction hash was created and the render was not started. ${context.recovery || "Confirm the wallet is on the expected network and retry."}`.trim();
  }
  if (walletErrorCode(error) === 4001) {
    return `${context.label} was rejected in the wallet. Render was not started.`;
  }
  return `${context.label} failed before the render task could start: ${message}`;
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

async function assertOk(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function parseImageWizardItems(raw: string): ImageWizardItem[] {
  try {
    const trimmed = raw.trim();
    if (!trimmed) {
      return [emptyImageWizardItem()];
    }
    const parsed = trimmed.startsWith("[") ? JSON.parse(trimmed) as unknown[] : parseImageInputs(trimmed);
    if (!Array.isArray(parsed)) {
      return [emptyImageWizardItem()];
    }
    const items = parsed.map((item) => {
      if (typeof item === "string") {
        return {
          image_url: item,
          title: "",
          image_text: ""
        };
      }
      const record = item && typeof item === "object" && !Array.isArray(item)
        ? item as Record<string, unknown>
        : {};
      return {
        image_url: getImageInputUrl(record),
        title: String(record.title || ""),
        image_text: String(record.image_text || record.imageText || "")
      };
    });
    return items.length > 0 ? items : [emptyImageWizardItem()];
  } catch {
    return [emptyImageWizardItem()];
  }
}

function emptyImageWizardItem(): ImageWizardItem {
  return { image_url: "", title: "", image_text: "" };
}

function serializeImageWizardItems(items: ImageWizardItem[]) {
  const payload = items
    .map((item) => ({
      image_url: item.image_url.trim(),
      title: item.title.trim(),
      image_text: item.image_text.trim()
    }))
    .filter((item) => item.image_url)
    .map((item) => {
      const output: Record<string, unknown> = { image_url: item.image_url };
      if (item.title) {
        output.title = item.title;
      }
      if (item.image_text) {
        output.image_text = item.image_text;
      }
      return output;
    });
  return JSON.stringify(payload, null, 2);
}

function sanitizeImageUrlsForForm(raw: string) {
  if (!/skip_enhancement|skipEnhancement|resize_image|resizeImage/.test(raw)) {
    return raw;
  }
  try {
    return JSON.stringify(
      parseImageInputs(raw).map((item) =>
        typeof item === "string" ? item : withoutProcessorOnlyImageFlags(item)
      ),
      null,
      2
    );
  } catch {
    return raw;
  }
}

function parseMetadataWizardItems(raw: string): MetadataWizardItem[] {
  try {
    const parsed = parseJsonObject(raw);
    const items = Object.entries(parsed).map(([key, value]) => ({
      key,
      value: formatWizardValue(value)
    }));
    return items.length > 0 ? items : [emptyMetadataWizardItem()];
  } catch {
    return [emptyMetadataWizardItem()];
  }
}

function emptyMetadataWizardItem(): MetadataWizardItem {
  return { key: "", value: "" };
}

function serializeMetadataWizardItems(items: MetadataWizardItem[]) {
  const metadata: Record<string, unknown> = {};
  for (const item of items) {
    const key = item.key.trim();
    if (key) {
      metadata[key] = coerceWizardValue(item.value);
    }
  }
  return JSON.stringify(metadata, null, 2);
}

function parseOutroFocusAreaWizard(raw: string): OutroFocusAreaWizard {
  try {
    const parsed = parseOutroFocusArea(raw);
    return {
      x: String(parsed.x),
      y: String(parsed.y),
      width: String(parsed.width),
      height: String(parsed.height)
    };
  } catch {
    return { x: "", y: "", width: "", height: "" };
  }
}

function serializeOutroFocusAreaWizard(focusArea: OutroFocusAreaWizard) {
  return JSON.stringify({
    x: parseWizardNumber(focusArea.x),
    y: parseWizardNumber(focusArea.y),
    width: parseWizardNumber(focusArea.width),
    height: parseWizardNumber(focusArea.height)
  }, null, 2);
}

function parseWizardNumber(value: string) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatWizardValue(value: unknown) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function coerceWizardValue(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "true" || trimmed === "false" || trimmed === "null" || /^-?\d+(\.\d+)?$/.test(trimmed) || trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return value;
    }
  }
  return value;
}

function parseJsonObject(raw: string) {
  if (!raw.trim()) {
    return {};
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("metadata must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function extractMetadataTitle(raw: string) {
  try {
    const metadata = parseJsonObject(raw);
    return typeof metadata.title === "string" ? metadata.title.trim() : "";
  } catch {
    return "";
  }
}

function buildGenerationPayload(form: GenerationFormState): GenerationInput {
  const imageInputs = parseImageInputs(form.imageUrls).map((item) => applySampleImageProcessingFlags(item, form.aspectRatio));
  const ctaUrl = form.ctaUrl.trim();
  const ctaTextTop = form.ctaTextTop.trim();
  const ctaTextBottom = form.ctaTextBottom.trim();
  const ctaLogo = form.ctaLogo.trim();
  const addOutroFocusArea = form.addOutroFocusArea !== false;
  const metadata = parseJsonObject(form.metadata);
  const inftTitle = form.inftTitle.trim();
  if (!ctaUrl) {
    throw new Error("cta_url is required for the server-generated CTA outro image");
  }
  if (inftTitle) {
    metadata.title = inftTitle;
  }

  const payload: GenerationInput = {
    image_urls: imageInputs,
    metadata,
    prompt: form.prompt,
    video_model: form.videoModel,
    aspect_ratio: form.aspectRatio,
    language: form.language,
    enable_subtitles: form.enableSubtitles,
    generate_outro_image: true,
    cta_url: ctaUrl,
    add_outro_animation: form.addOutroAnimation,
    add_outro_focus_area: addOutroFocusArea,
    add_footer_animation: form.addFooterAnimation
  };

  if (ctaTextTop) {
    payload.cta_text_top = ctaTextTop;
  }
  if (ctaTextBottom) {
    payload.cta_text_bottom = ctaTextBottom;
  }
  if (ctaLogo) {
    payload.cta_logo = ctaLogo;
  }
  if (form.addFooterAnimation) {
    payload.footer_metadata = buildFooterMetadata(imageInputs, ctaUrl);
  }

  if (addOutroFocusArea) {
    payload.outro_focust_area = parseOutroFocusArea(form.outroFocusArea);
  }
  return payload;
}

function buildFooterMetadata(imageInputs: Array<string | Record<string, unknown>>, ctaUrl: string): NonNullable<GenerationInput["footer_metadata"]> {
  return imageInputs.map((item, index) => {
    const record = typeof item === "object" && item && !Array.isArray(item) ? item as Record<string, unknown> : undefined;
    const title = String(record?.title || record?.image_text || record?.imageText || `Scene ${index + 1}`).trim();
    return {
      url: ctaUrl,
      ...(title ? { title } : {})
    };
  });
}

async function detectRenderOrientationWarning(form: GenerationFormState): Promise<RenderOrientationWarning | null> {
  const imageUrls = parseImageInputs(form.imageUrls)
    .map((item) => getEffectiveRenderImageUrl(item, form.aspectRatio))
    .filter(Boolean);
  if (imageUrls.length === 0) {
    return null;
  }

  const dimensions = await Promise.all(imageUrls.map((imageUrl) =>
    loadImageDimensions(imageUrl).catch(() => null)
  ));
  let portraitCount = 0;
  let landscapeCount = 0;
  for (const dimension of dimensions) {
    if (!dimension) {
      continue;
    }
    const orientation = imageOrientationFromDimensions(dimension.width, dimension.height);
    if (orientation === "portrait") {
      portraitCount += 1;
    }
    if (orientation === "landscape") {
      landscapeCount += 1;
    }
  }

  const detectedCount = portraitCount + landscapeCount;
  if (detectedCount === 0 || portraitCount === landscapeCount) {
    return null;
  }

  const imageOrientation = portraitCount > landscapeCount ? "portrait" : "landscape";
  const majorityCount = imageOrientation === "portrait" ? portraitCount : landscapeCount;
  const renderOrientation = orientationFromAspectRatio(form.aspectRatio);
  if (majorityCount <= detectedCount / 2 || imageOrientation === renderOrientation) {
    return null;
  }

  return {
    imageOrientation,
    renderOrientation,
    detectedCount,
    majorityCount,
    skippedCount: imageUrls.length - detectedCount
  };
}

function getEffectiveRenderImageUrl(item: string | Record<string, unknown>, aspectRatio: VideoAspectRatio) {
  const effective = applySampleImageProcessingFlags(item, aspectRatio);
  return typeof effective === "string" ? effective : getImageInputUrl(effective);
}

function loadImageDimensions(imageUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    const timeout = window.setTimeout(() => {
      cleanup();
      reject(new Error("Image dimension check timed out."));
    }, 8000);

    function cleanup() {
      window.clearTimeout(timeout);
      image.onload = null;
      image.onerror = null;
    }

    function complete() {
      cleanup();
      if (image.naturalWidth > 0 && image.naturalHeight > 0) {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        return;
      }
      reject(new Error("Image dimensions were unavailable."));
    }

    image.onload = complete;
    image.onerror = () => {
      cleanup();
      reject(new Error("Image dimension check failed."));
    };
    image.decoding = "async";
    image.src = imageUrl;
    if (image.complete) {
      complete();
    }
  });
}

function imageOrientationFromDimensions(width: number, height: number): ImageOrientation | "" {
  if (height > width) {
    return "portrait";
  }
  if (width > height) {
    return "landscape";
  }
  return "";
}

function orientationFromAspectRatio(aspectRatio: VideoAspectRatio): ImageOrientation {
  const [width, height] = aspectRatio.split(":").map((value) => Number(value));
  return width > height ? "landscape" : "portrait";
}

function orientationLabel(orientation: ImageOrientation) {
  return orientation === "portrait" ? "vertical" : "landscape";
}

function applySampleImageProcessingFlags(item: string | Record<string, unknown>, aspectRatio: VideoAspectRatio): string | Record<string, unknown> {
  if (typeof item === "string") {
    const isSampleImage = isSampleImageUrl(item);
    return {
      image_url: isSampleImage ? buildAspectSizedSampleImageUrl(item, aspectRatio) : item
    };
  }

  const normalizedItem = withoutProcessorOnlyImageFlags(item);
  const imageUrl = getImageInputUrl(item);

  return {
    ...normalizedItem,
    ...(isSampleImageUrl(imageUrl) ? { image_url: buildAspectSizedSampleImageUrl(imageUrl, aspectRatio) } : {})
  };
}

function withoutProcessorOnlyImageFlags(item: Record<string, unknown>) {
  const next = { ...item };
  delete next.skip_enhancement;
  delete next.skipEnhancement;
  delete next.resize_image;
  delete next.resizeImage;
  return next;
}

function isSampleImageUrl(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    return sampleImageUrlBases.has(`${url.origin}${url.pathname}`);
  } catch {
    return false;
  }
}

function buildAspectSizedSampleImageUrl(rawUrl: string, aspectRatio: VideoAspectRatio) {
  const url = new URL(rawUrl);
  const [width, height] = aspectRatio === "9:16" ? [1024, 1792] : [1792, 1024];
  url.search = new URLSearchParams({
    auto: "format",
    fit: "crop",
    w: String(width),
    h: String(height),
    q: "90"
  }).toString();
  return url.toString();
}

function previewGenerationPayload(form: GenerationFormState) {
  try {
    return JSON.stringify(buildGenerationPayload(form), null, 2);
  } catch (error) {
    return JSON.stringify({
      error: error instanceof Error ? error.message : "Invalid render payload"
    }, null, 2);
  }
}

function countImageInputs(raw: string) {
  try {
    return parseImageInputs(raw).length;
  } catch {
    return 0;
  }
}

function parseImageInputs(raw: string): Array<string | Record<string, unknown>> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error("image_urls must be a JSON array");
    }
    return parsed.map((item, index) => normalizeImageInputItem(item, index));
  }
  return trimmed
    .split(/\n|,/)
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value, index) => {
      assertUsableImageUrl(value, `image_urls item ${index + 1}`);
      return value;
    });
}

function normalizeImageInputItem(item: unknown, index: number): string | Record<string, unknown> {
  if (typeof item === "string") {
    const value = item.trim();
    if (!value) {
      throw new Error(`image_urls item ${index + 1} must not be empty`);
    }
    assertUsableImageUrl(value, `image_urls item ${index + 1}`);
    return value;
  }
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new Error(`image_urls item ${index + 1} must be a URL string or object`);
  }
  const record = item as Record<string, unknown>;
  const imageUrl = getImageInputUrl(record);
  if (!imageUrl) {
    throw new Error(`image_urls item ${index + 1} must include image_url`);
  }
  assertUsableImageUrl(imageUrl, `image_urls item ${index + 1}`);
  return {
    ...withoutProcessorOnlyImageFlags(record),
    image_url: imageUrl
  };
}

function getImageInputUrl(record: Record<string, unknown>) {
  return String(
    record.image_url ||
    record.imageUrl ||
    record.url ||
    record.src ||
    record.effective_url ||
    record.effectiveUrl ||
    record.enhanced_url ||
    record.enhancedUrl ||
    ""
  ).trim();
}

function getImagePreviewUrlError(rawUrl: string) {
  if (!rawUrl) {
    return "";
  }
  try {
    const url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) {
      return "Use an http(s) image URL.";
    }
    if (url.hostname === "example.com" || url.hostname.endsWith(".example.com")) {
      return "Use a real image URL.";
    }
    return "";
  } catch {
    return "Enter a valid image URL.";
  }
}

function formatDetectedAspectRatio(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return "unknown ratio";
  }
  const divisor = greatestCommonDivisor(width, height);
  const ratioWidth = Math.round(width / divisor);
  const ratioHeight = Math.round(height / divisor);
  if (ratioWidth <= 99 && ratioHeight <= 99) {
    return `${ratioWidth}:${ratioHeight}`;
  }
  return width >= height
    ? `${(width / height).toFixed(2)}:1`
    : `1:${(height / width).toFixed(2)}`;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(Math.round(left));
  let b = Math.abs(Math.round(right));
  while (b > 0) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a || 1;
}

function assertUsableImageUrl(rawUrl: string, label: string) {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must be an http(s) URL`);
  }
  if (url.hostname === "example.com" || url.hostname.endsWith(".example.com")) {
    throw new Error(`${label} must use a real reachable image URL, not an example.com placeholder`);
  }
}

function parseOutroFocusArea(raw: string) {
  const parsed = parseJsonObject(raw);
  const focusArea = {
    x: Number(parsed.x),
    y: Number(parsed.y),
    width: Number(parsed.width),
    height: Number(parsed.height)
  };
  if (!Object.values(focusArea).every((value) => Number.isFinite(value) && value >= 0)) {
    throw new Error("outro focus area must include valid x, y, width, and height numbers");
  }
  return focusArea;
}

function sameWallet(left?: string, right?: string) {
  return normalizeWallet(left) === normalizeWallet(right);
}

function normalizeWallet(value = "") {
  return value.trim().toLowerCase();
}

function shortWallet(value = "") {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed || "wallet";
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function shortHash(value = "") {
  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value;
}
