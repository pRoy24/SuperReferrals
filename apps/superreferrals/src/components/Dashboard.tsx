"use client";

import {
  Bot,
  CircleDollarSign,
  Database,
  ExternalLink,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  Network,
  Palette,
  Plus,
  Radio,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Store,
  Undo2,
  Upload,
  Users,
  Wallet,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { encodeFunctionData, namehash, parseAbi } from "viem";
import { CustomerStoreCreatorSkeleton } from "@/components/FormLoadingSkeletons";
import { requestWalletAccounts, subscribeToBrowserWalletProviders, type BrowserWalletProvider, type EthereumProvider } from "@/lib/browser-wallets";
import { getPaymentTokens, getTransactionChainConfig, settlementTokenForCurrency, type TransactionChainConfig } from "@/lib/payment-tokens";
import {
  CREDIT_UNIT_USD,
  DEFAULT_CUSTOMER_MULTIPLIER,
  defaultINFTActionPricesUsd,
  defaultModelPricingConfigurations,
  getCreditUnitUsd,
  getCustomerMultiplier,
  getINFTActionPricesUsd,
  getModelPricingConfigurations,
  paidINFTActions,
  resolveModelPriceDetails
} from "@/lib/pricing";
import {
  authCredentialsFromCurrentUrl,
  fetchWithSamsarAuth,
  refreshStoredSamsarCredentialsIfNeeded,
  removeAuthCredentialsFromCurrentUrl,
  storeSamsarCredentials
} from "@/lib/storefront-auth-client";
import BreadcrumbNav from "@/components/BreadcrumbNav";
import LanguageSelector from "@/components/LanguageSelector";
import StorefrontVideoGrid from "@/components/StorefrontVideoGrid";
import { syncStoredAppLanguagePreference } from "@/lib/app-language-client";
import {
  DEFAULT_STOREFRONT_HERO_SUBTITLE,
  DEFAULT_STOREFRONT_HERO_TITLE,
  DEFAULT_STOREFRONT_LAYOUT_ID,
  STOREFRONT_LAYOUT_OPTIONS,
  normalizeStorefrontLayoutId
} from "@/lib/storefront-customization";
import {
  normalizeStorefrontEnsName,
  normalizeStorefrontGalleryPath,
  normalizeStorefrontProxyPath,
  storefrontPublicHref
} from "@/lib/storefront-routing";
import { DEFAULT_STOREFRONT_THEME_ID, STOREFRONT_THEMES } from "@/lib/storefront-themes";
import { isUsableEvmAddress } from "@/lib/wallet-address";
import type { Customer, INFTPaidAction, ModelPricingConfiguration, PaymentCurrencySymbol, StorefrontEnsNetwork, StorefrontLayoutId, StorefrontThemeId, SuperReferralsStore, VideoAspectRatio, VideoModel } from "@/lib/types";

const processorCreditAmounts = [10, 25, 50, 100];
const conditionModelOptions: VideoModel[] = ["RUNWAYML", "VEO3.1I2V", "SEEDANCEI2V", "KLING3.0"];
const conditionAspectOptions: VideoAspectRatio[] = ["9:16", "16:9"];
const ENS_RESOLVER_ABI = parseAbi([
  "function multicall(bytes[] data) returns (bytes[])",
  "function setText(bytes32 node, string key, string value)"
]);
type ToastState = { id: number; kind: "success" | "error" | "warning"; message: string } | null;
const deploymentEnvironment = (
  process.env.NEXT_PUBLIC_DEPLOYMENT_ENV ||
  process.env.NEXT_PUBLIC_APP_ENV ||
  process.env.NODE_ENV ||
  ""
).toLowerCase();
const showStagingEnvironmentNotice = deploymentEnvironment !== "production";

export default function Dashboard() {
  const [store, setStore] = useState<SuperReferralsStore | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [logoUploadError, setLogoUploadError] = useState("");
  const [activeCustomerId, setActiveCustomerId] = useState("");
  const [creatingNewStorefront, setCreatingNewStorefront] = useState(false);
  const [ensSettingsOpen, setEnsSettingsOpen] = useState(false);
  const [ensConfigTxHash, setEnsConfigTxHash] = useState("");
  const [appOrigin, setAppOrigin] = useState("");
  const [processorAmountUsd, setProcessorAmountUsd] = useState(25);
  const [processorAccountForm, setProcessorAccountForm] = useState({
    email: "",
    password: ""
  });
  const [walletProviders, setWalletProviders] = useState<BrowserWalletProvider[]>([]);
  const [agentObjective, setAgentObjective] = useState(
    "Let the Agent Town plan a referrer video workflow, price it, route settlement, and publish all 0G receipts."
  );
  const [agentPayload, setAgentPayload] = useState(JSON.stringify({
    image_urls: [
      "https://images.unsplash.com/photo-1542291026-7eec264c27ff",
      "https://images.unsplash.com/photo-1460353581641-37baddab0fa2"
    ],
    video_model: "RUNWAYML",
    aspect_ratio: "9:16",
    prompt: "Create a short launch video with a crisp CTA outro."
  }, null, 2));
  const [customerForm, setCustomerForm] = useState({
    id: "",
    name: "",
    ownerWallet: "",
    platformFeeBps: 500,
    refundOnFailureBps: 5000,
    customerMultiplier: DEFAULT_CUSTOMER_MULTIPLIER,
    creditUnitUsd: CREDIT_UNIT_USD,
    referrerBaseUrl: "",
    ensName: "",
    storefrontDescription: "",
    storefrontHeroTitle: DEFAULT_STOREFRONT_HERO_TITLE,
    storefrontHeroSubtitle: DEFAULT_STOREFRONT_HERO_SUBTITLE,
    storefrontWebsiteUrl: "",
    storefrontSupportEmail: "",
    storefrontCategory: "",
    storefrontTags: "",
    storefrontLogoUrl: "",
    storefrontThemeId: DEFAULT_STOREFRONT_THEME_ID as StorefrontThemeId,
    storefrontLayoutId: DEFAULT_STOREFRONT_LAYOUT_ID as StorefrontLayoutId,
    ensProxyEnabled: false,
    ensProxyName: "",
    ensProxyNetwork: "sepolia" as StorefrontEnsNetwork,
    ensStorefrontPath: "/",
    ensFeedPath: "/feed",
    ensMosaicPath: "/gallery",
    ensVideoPath: "/feed",
    ensContentHash: "",
    conditionalsEnabled: false,
    allowedModels: conditionModelOptions,
    allowedAspectRatios: conditionAspectOptions,
    maxImages: 6,
    dailyWalletRenderLimit: "",
    walletAccessMode: "open" as "open" | "whitelist",
    walletWhitelist: "",
    inftActionPricesUsd: defaultINFTActionPricesUsd,
    modelConfigurations: defaultModelPricingConfigurations
  });

  async function load(customerId = activeCustomerId) {
    const params = new URLSearchParams({ scope: "account" });
    if (customerId) {
      params.set("customerId", customerId);
    }
    const response = await fetchWithSamsarAuth(`/api/bootstrap?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    setStore(data);
  }

  async function initializeStorefrontSession() {
    const credentials = authCredentialsFromCurrentUrl();
    if (credentials.authToken) {
      storeSamsarCredentials(credentials);
      try {
        const response = await fetchWithSamsarAuth("/api/processor/session", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(credentials)
        });
        const data = await assertOk(response);
        storeSamsarCredentials({
          authToken: data.account?.authToken || credentials.authToken,
          refreshToken: data.account?.refreshToken || credentials.refreshToken,
          expiryDate: data.account?.expiryDate || credentials.expiryDate,
          refreshTokenExpiresAt: data.account?.refreshTokenExpiresAt || credentials.refreshTokenExpiresAt
        });
        await syncStoredAppLanguagePreference().catch(() => undefined);
        setMessage(`Signed in to ${data.account?.email || "your SuperReferrals account"}.`);
      } finally {
        removeAuthCredentialsFromCurrentUrl();
      }
    } else {
      await refreshStoredSamsarCredentialsIfNeeded();
      await syncStoredAppLanguagePreference().catch(() => undefined);
    }
    await load();
  }

  useEffect(() => {
    initializeStorefrontSession().catch((error) => setMessage(error.message));
  }, []);

  useEffect(() => {
    setAppOrigin(window.location.origin.replace(/\/$/, ""));
  }, []);

  useEffect(() => subscribeToBrowserWalletProviders(setWalletProviders), []);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => {
      setToast((current) => current?.id === toast.id ? null : current);
    }, 3600);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const activeCustomer = store?.customers.find((item) => item.id === activeCustomerId) || store?.customers[0];
  const accountStorefronts = useMemo(
    () => activeCustomer && store
      ? store.customers.filter((item) => sameProcessorAccount(item, activeCustomer))
      : [],
    [activeCustomer, store]
  );
  const transactionChain = getTransactionChainConfig();
  const defaultEnsProxyNetwork: StorefrontEnsNetwork = transactionChain.key === "base"
    ? "base"
    : transactionChain.key === "mainnet"
      ? "mainnet"
      : "sepolia";

  useEffect(() => {
    if (!store) return;
    const customer = activeCustomer;
    if (!customer) return;
    if (!activeCustomerId) {
      setActiveCustomerId(customer.id);
    }
    if (creatingNewStorefront) {
      return;
    }
    const ownerWallet = isUsableEvmAddress(customer.ownerWallet)
      ? customer.ownerWallet
      : isUsableEvmAddress(customer.samsarAccount?.walletAddress)
      ? customer.samsarAccount?.walletAddress || ""
      : "";
    setCustomerForm({
      id: customer.id,
      name: customer.name,
      ownerWallet,
      platformFeeBps: customer.pricing.platformFeeBps,
      refundOnFailureBps: customer.pricing.refundOnFailureBps,
      customerMultiplier: getCustomerMultiplier(customer),
      creditUnitUsd: getCreditUnitUsd(customer),
      referrerBaseUrl: customer.referrerBaseUrl,
      ensName: customer.ensName || "",
      storefrontDescription: customer.storefront?.description || "",
      storefrontHeroTitle: customer.storefront?.heroTitle || DEFAULT_STOREFRONT_HERO_TITLE,
      storefrontHeroSubtitle: customer.storefront?.heroSubtitle || customer.storefront?.description || DEFAULT_STOREFRONT_HERO_SUBTITLE,
      storefrontWebsiteUrl: customer.storefront?.websiteUrl || "",
      storefrontSupportEmail: customer.storefront?.supportEmail || "",
      storefrontCategory: customer.storefront?.category || "",
      storefrontTags: customer.storefront?.tags?.join(", ") || "",
      storefrontLogoUrl: customer.storefront?.logoUrl || "",
      storefrontThemeId: customer.storefront?.themeId || DEFAULT_STOREFRONT_THEME_ID,
      storefrontLayoutId: normalizeStorefrontLayoutId(customer.storefront?.layoutId),
      ensProxyEnabled: customer.storefront?.ens?.enabled || false,
      ensProxyName: customer.storefront?.ens?.name || "",
      ensProxyNetwork: customer.storefront?.ens?.network || defaultEnsProxyNetwork,
      ensStorefrontPath: customer.storefront?.ens?.storefrontPath || "/",
      ensFeedPath: customer.storefront?.ens?.feedPath || "/feed",
      ensMosaicPath: normalizeStorefrontGalleryPath(customer.storefront?.ens?.mosaicPath),
      ensVideoPath: customer.storefront?.ens?.videoPath || "/feed",
      ensContentHash: customer.storefront?.ens?.contentHash || "",
      conditionalsEnabled: customer.storefront?.conditions?.enabled || false,
      allowedModels: customer.storefront?.conditions?.allowedModels?.length
        ? customer.storefront.conditions.allowedModels
        : conditionModelOptions,
      allowedAspectRatios: customer.storefront?.conditions?.allowedAspectRatios?.length
        ? customer.storefront.conditions.allowedAspectRatios
        : conditionAspectOptions,
      maxImages: customer.storefront?.conditions?.maxImages || 6,
      dailyWalletRenderLimit: customer.storefront?.conditions?.dailyWalletRenderLimit
        ? String(customer.storefront.conditions.dailyWalletRenderLimit)
        : "",
      walletAccessMode: customer.storefront?.conditions?.walletAccessMode === "whitelist" ? "whitelist" : "open",
      walletWhitelist: customer.storefront?.conditions?.walletWhitelist?.join("\n") || "",
      inftActionPricesUsd: getINFTActionPricesUsd(customer),
      modelConfigurations: getModelPricingConfigurations(customer)
    });
    setProcessorAccountForm((current) => ({
      ...current,
      email: customer.samsarAccount?.email || current.email
    }));
    setEnsSettingsOpen(Boolean(customer.storefront?.ens?.enabled || customer.storefront?.ens?.name));
  }, [activeCustomer, activeCustomerId, creatingNewStorefront, defaultEnsProxyNetwork, store]);

  const customer = activeCustomer;
  const activeStorefrontGenerations = customer
    ? store?.generations.filter((item) => item.customerId === customer.id) || []
    : [];
  const activeStorefrontSubAccounts = customer
    ? store?.subAccounts.filter((item) => item.customerId === customer.id) || []
    : [];
  const activeJobs = activeStorefrontGenerations.filter((item) => ["QUEUED", "PROCESSING"].includes(item.status)).length;
  const completedJobs = activeStorefrontGenerations.filter((item) => item.status === "COMPLETED").length;
  const agentJobs = store?.agentJobs || [];
  const latestAgentJob = agentJobs[0];
  const settlementToken = settlementTokenForCurrency("USDC", transactionChain.id) || getPaymentTokens(transactionChain.id)[0];
  const hasProcessorAccountSession = Boolean(customer?.samsarAccount?.hasSession || customer?.samsarAccount?.authToken || customer?.samsarAccount?.apiKey);
  const processorCreditsRemaining = hasProcessorAccountSession ? Number(customer?.subscription.creditsRemaining || 0) : 0;
  const hasCreditedProcessorAccount = hasProcessorAccountSession && processorCreditsRemaining > 0;
  const processorAccountEmail = customer?.samsarAccount?.email || processorAccountForm.email;
  const linkedSamsarWallet = customer?.samsarAccount?.walletAddress || customerForm.ownerWallet;
  const hasValidOwnerWallet = isUsableEvmAddress(customerForm.ownerWallet);
  const ownerWalletRequiredNotice = hasValidOwnerWallet
    ? ""
    : `Link a valid payout wallet before publishing or collecting storefront payments. Customer transfers are created on ${transactionChain.name}.`;
  const connectingCustomerWallet = busy.startsWith("customer-wallet");
  const customerLanding = useMemo(() => {
    const seedAccount = activeStorefrontSubAccounts[0];
    return seedAccount ? `/r/${seedAccount.referrerCode}` : customer ? `/storefronts/${customer.id}` : "";
  }, [activeStorefrontSubAccounts, customer]);
  const publicStorefrontLinks = customer ? [
    { label: "Storefront", href: storefrontPublicHref(customer, "storefront") },
    { label: "Feed", href: storefrontPublicHref(customer, "feed") },
    { label: "Gallery", href: storefrontPublicHref(customer, "mosaic") }
  ] : [];
  const ensProxyName = normalizeStorefrontEnsName(customerForm.ensProxyName);
  const ensProxyPreviewCustomer: Customer | undefined = customer && ensProxyName ? {
    ...customer,
    storefront: {
      ...customer.storefront,
      ens: {
        enabled: true,
        name: ensProxyName,
        network: customerForm.ensProxyNetwork,
        storefrontPath: customerForm.ensStorefrontPath,
        feedPath: customerForm.ensFeedPath,
        mosaicPath: customerForm.ensMosaicPath,
        videoPath: customerForm.ensVideoPath,
        contentHash: customerForm.ensContentHash
      }
    }
  } : undefined;
  const ensProxyRecordRows = ensProxyPreviewCustomer ? [
    { key: "url", value: storefrontPublicHref(ensProxyPreviewCustomer, "storefront") },
    { key: "com.superreferrals.storefront", value: storefrontPublicHref(ensProxyPreviewCustomer, "storefront") },
    { key: "com.superreferrals.feed", value: storefrontPublicHref(ensProxyPreviewCustomer, "feed") },
    { key: "com.superreferrals.gallery", value: storefrontPublicHref(ensProxyPreviewCustomer, "mosaic") },
    { key: "com.superreferrals.proxy", value: appOrigin }
  ].filter((row) => row.value) : [];
  const ensConfigExplorerUrl = ensConfigTxHash
    ? `${ensWalletChainConfig(customerForm.ensProxyNetwork).blockExplorerUrls[0]}/tx/${ensConfigTxHash}`
    : "";

  function updatePricingRow(id: string, patch: Partial<ModelPricingConfiguration>) {
    setCustomerForm((current) => ({
      ...current,
      modelConfigurations: current.modelConfigurations.map((item) =>
        item.id === id ? { ...item, ...patch } : item
      )
    }));
  }

  function updateINFTActionPrice(action: INFTPaidAction, value: string) {
    const parsed = Number(value);
    setCustomerForm((current) => ({
      ...current,
      inftActionPricesUsd: {
        ...current.inftActionPricesUsd,
        [action]: Number.isFinite(parsed) && parsed > 0
          ? parsed
          : defaultINFTActionPricesUsd[action]
      }
    }));
  }

  function toggleAllowedModel(model: VideoModel) {
    setCustomerForm((current) => ({
      ...current,
      allowedModels: current.allowedModels.includes(model)
        ? current.allowedModels.filter((item) => item !== model)
        : [...current.allowedModels, model]
    }));
  }

  function toggleAllowedAspectRatio(aspectRatio: VideoAspectRatio) {
    setCustomerForm((current) => ({
      ...current,
      allowedAspectRatios: current.allowedAspectRatios.includes(aspectRatio)
        ? current.allowedAspectRatios.filter((item) => item !== aspectRatio)
        : [...current.allowedAspectRatios, aspectRatio]
    }));
  }

  async function uploadStorefrontLogo(file: File) {
    if (!file.type.startsWith("image/")) {
      setLogoUploadError("Upload a JPEG, PNG, or WebP logo image.");
      return;
    }
    setBusy("storefront-logo");
    setLogoUploadError("");
    try {
      const formData = new FormData();
      formData.set("image", file);
      const response = await fetchWithSamsarAuth("/api/uploads/storefront-logo", {
        method: "POST",
        body: formData
      });
      const data = await assertOk(response);
      const upload = data.upload as { url?: string };
      if (!upload?.url) {
        throw new Error("Upload did not return a logo URL.");
      }
      setCustomerForm((current) => ({ ...current, storefrontLogoUrl: upload.url || "" }));
      showToast("Storefront logo uploaded. Save setup to publish it.");
    } catch (error) {
      const uploadError = error instanceof Error ? error.message : "Logo upload failed.";
      setLogoUploadError(uploadError);
      showToast(uploadError, "error");
    } finally {
      setBusy("");
    }
  }

  function handleStorefrontLogoInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (file) {
      uploadStorefrontLogo(file).catch(() => undefined);
    }
  }

  function showToast(message: string, kind: "success" | "error" | "warning" = "success") {
    setToast({ id: Date.now(), kind, message });
  }

  function selectStorefront(customerId: string) {
    setCreatingNewStorefront(false);
    setActiveCustomerId(customerId);
    setMessage("");
    void load(customerId);
  }

  function startNewStorefront() {
    const base = customer;
    const ownerWallet = isUsableEvmAddress(base?.ownerWallet)
      ? base?.ownerWallet || ""
      : isUsableEvmAddress(base?.samsarAccount?.walletAddress)
      ? base?.samsarAccount?.walletAddress || ""
      : customerForm.ownerWallet;
    setCreatingNewStorefront(true);
    setEnsSettingsOpen(false);
    setCustomerForm({
      id: "",
      name: `${processorAccountEmail || base?.name || "Customer"} storefront`,
      ownerWallet,
      platformFeeBps: base?.pricing.platformFeeBps ?? customerForm.platformFeeBps,
      refundOnFailureBps: base?.pricing.refundOnFailureBps ?? customerForm.refundOnFailureBps,
      customerMultiplier: DEFAULT_CUSTOMER_MULTIPLIER,
      creditUnitUsd: CREDIT_UNIT_USD,
      referrerBaseUrl: base?.referrerBaseUrl || customerForm.referrerBaseUrl,
      ensName: base?.ensName || "",
      storefrontDescription: "",
      storefrontHeroTitle: DEFAULT_STOREFRONT_HERO_TITLE,
      storefrontHeroSubtitle: DEFAULT_STOREFRONT_HERO_SUBTITLE,
      storefrontWebsiteUrl: "",
      storefrontSupportEmail: base?.storefront?.supportEmail || "",
      storefrontCategory: "",
      storefrontTags: "",
      storefrontLogoUrl: "",
      storefrontThemeId: DEFAULT_STOREFRONT_THEME_ID,
      storefrontLayoutId: DEFAULT_STOREFRONT_LAYOUT_ID,
      ensProxyEnabled: false,
      ensProxyName: "",
      ensProxyNetwork: defaultEnsProxyNetwork,
      ensStorefrontPath: "/",
      ensFeedPath: "/feed",
      ensMosaicPath: "/gallery",
      ensVideoPath: "/feed",
      ensContentHash: "",
      conditionalsEnabled: false,
      allowedModels: conditionModelOptions,
      allowedAspectRatios: conditionAspectOptions,
      maxImages: 6,
      dailyWalletRenderLimit: "",
      walletAccessMode: "open",
      walletWhitelist: "",
      inftActionPricesUsd: defaultINFTActionPricesUsd,
      modelConfigurations: defaultModelPricingConfigurations.map((item) => ({ ...item }))
    });
    setMessage("Editing a new storefront. Save setup to publish it in the directory.");
  }

  async function saveCustomer() {
    if (!hasCreditedProcessorAccount) {
      const error = "Purchase credits or sign in before saving your SuperReferrals storefront.";
      setMessage(error);
      showToast(error, "error");
      return;
    }
    if (!hasValidOwnerWallet) {
      const warning = ownerWalletRequiredNotice;
      setMessage(warning);
      showToast(warning, "warning");
      return;
    }
    setBusy("customer");
    setMessage("");
    try {
      const enabledPricing = customerForm.modelConfigurations.find((item) => item.enabled) ||
        customerForm.modelConfigurations[0];
      const enabledDetails = resolveModelPriceDetails(
        { pricing: { customerMultiplier: customerForm.customerMultiplier, creditUnitUsd: customerForm.creditUnitUsd } },
        enabledPricing
      );
      const response = await fetchWithSamsarAuth("/api/customers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: customerForm.id,
          createNewStorefront: creatingNewStorefront || !customerForm.id,
          name: customerForm.name,
          ownerWallet: customerForm.ownerWallet,
          referrerBaseUrl: customerForm.referrerBaseUrl,
          ensName: customerForm.ensName,
          storefront: {
            description: customerForm.storefrontDescription,
            heroTitle: customerForm.storefrontHeroTitle,
            heroSubtitle: customerForm.storefrontHeroSubtitle,
            websiteUrl: customerForm.storefrontWebsiteUrl,
            supportEmail: customerForm.storefrontSupportEmail,
            category: customerForm.storefrontCategory,
            tags: customerForm.storefrontTags,
            logoUrl: customerForm.storefrontLogoUrl,
            themeId: customerForm.storefrontThemeId,
            layoutId: customerForm.storefrontLayoutId,
            ens: {
              enabled: customerForm.ensProxyEnabled,
              name: customerForm.ensProxyName,
              network: customerForm.ensProxyNetwork,
              storefrontPath: customerForm.ensStorefrontPath,
              feedPath: customerForm.ensFeedPath,
              mosaicPath: customerForm.ensMosaicPath,
              videoPath: customerForm.ensVideoPath,
              contentHash: customerForm.ensContentHash
            },
            conditions: {
              enabled: customerForm.conditionalsEnabled,
              allowedModels: customerForm.allowedModels,
              allowedAspectRatios: customerForm.allowedAspectRatios,
              maxImages: Number(customerForm.maxImages) || undefined,
              dailyWalletRenderLimit: Number(customerForm.dailyWalletRenderLimit) || undefined,
              walletAccessMode: customerForm.walletAccessMode,
              walletWhitelist: customerForm.walletWhitelist
            }
          },
          pricing: {
            currency: "USDC" as PaymentCurrencySymbol,
            pricePerImageUsd: Number(enabledDetails.pricePerSecondUsd * (enabledPricing?.maxSecondsPerImage || 1)),
            pricePerSecondUsd: enabledDetails.pricePerSecondUsd,
            inftActionPricesUsd: customerForm.inftActionPricesUsd,
            customerMultiplier: Number(customerForm.customerMultiplier) || DEFAULT_CUSTOMER_MULTIPLIER,
            creditUnitUsd: Number(customerForm.creditUnitUsd) || CREDIT_UNIT_USD,
            modelConfigurations: customerForm.modelConfigurations.map((item) => ({
              ...item,
              baseCreditsPerSecond: Number(item.baseCreditsPerSecond) || 0,
              maxSecondsPerImage: Number(item.maxSecondsPerImage) || 0,
              basePricePerSecondUsd: Number(item.baseCreditsPerSecond || 0) * Number(customerForm.creditUnitUsd || CREDIT_UNIT_USD),
              customPricePerSecondUsd: Number(item.customPricePerSecondUsd) > 0 ? Number(item.customPricePerSecondUsd) : undefined,
              enabled: item.enabled !== false
            })),
            platformFeeBps: Number(customerForm.platformFeeBps),
            refundOnFailureBps: Number(customerForm.refundOnFailureBps),
            chainId: settlementToken.chainId,
            settlementTokenAddress: settlementToken.address
          },
          subscription: {
            status: "active",
            creditsRemaining: processorCreditsRemaining
          }
        })
      });
      const data = await assertOk(response);
      if (data.customer?.id) {
        setActiveCustomerId(data.customer.id);
      }
      setCreatingNewStorefront(false);
      await load(data.customer?.id || customer?.id || customerForm.id);
      const successMessage = creatingNewStorefront
        ? "New storefront saved."
        : "Storefront pricing, allowlist, and setup saved.";
      setMessage(successMessage);
      showToast(successMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Save failed";
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setBusy("");
    }
  }

  async function verifyEnsProxyRecords() {
    const ensName = normalizeStorefrontEnsName(customerForm.ensProxyName);
    if (!ensName) {
      const warning = "Enter an ENS name before verification.";
      setMessage(warning);
      showToast(warning, "warning");
      return;
    }
    setBusy("ens-verify");
    setMessage("");
    try {
      const response = await fetch("/api/ens/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: ensName, network: customerForm.ensProxyNetwork })
      });
      const data = await assertOk(response);
      const texts = data.result?.texts || {};
      const missingRows = ensProxyRecordRows.filter((row) => texts[row.key] !== row.value);
      const successMessage = missingRows.length === 0
        ? `${ensName} resolves with the storefront proxy records.`
        : `${ensName} resolves, but ${missingRows.map((row) => row.key).join(", ")} must be updated.`;
      setMessage(successMessage);
      showToast(successMessage, missingRows.length === 0 ? "success" : "warning");
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "ENS verification failed";
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setBusy("");
    }
  }

  async function configureEnsProxyRecords(walletProvider?: BrowserWalletProvider) {
    const ensName = normalizeStorefrontEnsName(customerForm.ensProxyName);
    if (!customer?.id) {
      const warning = "Save the storefront before writing ENS records.";
      setMessage(warning);
      showToast(warning, "warning");
      return;
    }
    if (!ensName) {
      const warning = "Enter an ENS name before writing records.";
      setMessage(warning);
      showToast(warning, "warning");
      return;
    }
    if (ensProxyRecordRows.length === 0) {
      const warning = "No ENS records are ready to write.";
      setMessage(warning);
      showToast(warning, "warning");
      return;
    }
    setBusy("ens-configure");
    setEnsConfigTxHash("");
    setMessage("");
    try {
      const provider = walletProvider?.provider || walletProviders[0]?.provider || window.ethereum;
      if (!provider) {
        throw new Error("No browser wallet detected. Install MetaMask, Coinbase Wallet, Rabby, Brave Wallet, or another EIP-1193 wallet.");
      }
      const accounts = await requestWalletAccounts(provider, { forceAccountSelection: true });
      const from = accounts[0];
      if (!from) {
        throw new Error("Wallet did not return an account.");
      }
      const resolveResponse = await fetch("/api/ens/resolve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: ensName, network: customerForm.ensProxyNetwork })
      });
      const resolveData = await assertOk(resolveResponse);
      const resolverAddress = String(resolveData.result?.resolverAddress || "");
      if (!isUsableEvmAddress(resolverAddress)) {
        throw new Error(`${ensName} does not have a resolver. Set a resolver in the ENS manager before writing SuperReferrals records.`);
      }
      const chain = ensWalletChainConfig(customerForm.ensProxyNetwork);
      await ensureWalletNetwork(provider, chain);
      const node = (resolveData.result?.node || namehash(ensName)) as `0x${string}`;
      const calls = ensProxyRecordRows.map((row) => encodeFunctionData({
        abi: ENS_RESOLVER_ABI,
        functionName: "setText",
        args: [node, row.key, row.value]
      }));
      const data = encodeFunctionData({
        abi: ENS_RESOLVER_ABI,
        functionName: "multicall",
        args: [calls]
      });
      const transaction = {
        from,
        to: resolverAddress,
        data,
        value: "0x0"
      };
      const gas = await estimateWalletGas(provider, transaction, {
        label: "ENS record update",
        chainName: chain.name,
        recovery: "Confirm that the connected wallet is the ENS name manager and that the resolver supports text records."
      });
      const txHash = await sendWalletTransaction(provider, { ...transaction, gas }, {
        label: "ENS record update",
        chainName: chain.name,
        recovery: "Confirm that the connected wallet is the ENS name manager and that the resolver supports text records."
      });
      setEnsConfigTxHash(txHash);
      const receipt = await waitForWalletReceipt(provider, txHash, 90000);
      if (receipt && !isSuccessfulReceipt(receipt)) {
        throw new Error(`ENS record transaction ${txHash} failed on ${chain.name}.`);
      }
      const successMessage = receipt
        ? `ENS records updated for ${ensName}.`
        : `ENS record transaction submitted for ${ensName}: ${txHash}`;
      setMessage(successMessage);
      showToast(successMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "ENS record update failed";
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setBusy("");
    }
  }

  async function connectCustomerWallet(walletProvider?: BrowserWalletProvider) {
    if (!hasProcessorAccountSession) {
      const warning = "Sign in before linking a payout wallet to your SuperReferrals account.";
      setMessage(warning);
      showToast(warning, "warning");
      return;
    }
    setBusy(`customer-wallet${walletProvider ? `-${walletProvider.id}` : ""}`);
    setMessage("");
    try {
      const provider = walletProvider?.provider || walletProviders[0]?.provider || window.ethereum;
      if (!provider) {
        throw new Error("No browser wallet detected. Install MetaMask, Coinbase Wallet, Rabby, Brave Wallet, or another EIP-1193 wallet.");
      }
      const accounts = await requestWalletAccounts(provider, { forceAccountSelection: true });
      const firstAccount = accounts[0] || "";
      if (!firstAccount) {
        throw new Error("Wallet did not return an account");
      }
      setCustomerForm((current) => ({ ...current, ownerWallet: firstAccount }));
      const response = await fetchWithSamsarAuth("/api/processor/account/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer?.id || customerForm.id,
          action: "link_wallet",
          wallet: firstAccount
        })
      });
      await assertOk(response);
      await load();
      const successMessage = `${walletProvider?.name || "Wallet"} connected. Payout wallet ${shortWallet(firstAccount)} is ready for ${transactionChain.name} payments.`;
      setMessage(successMessage);
      showToast(successMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Wallet connection failed";
      setMessage(errorMessage);
      showToast(errorMessage, "error");
    } finally {
      setBusy("");
    }
  }

  async function loginProcessorAccount() {
    setBusy("processor-login");
    setMessage("");
    try {
      const response = await fetchWithSamsarAuth("/api/processor/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer?.id || customerForm.id,
          customerName: customer?.name || customerForm.name,
          email: processorAccountForm.email,
          password: processorAccountForm.password
        })
      });
      const data = await assertOk(response);
      storeSamsarCredentials({
        authToken: data.account?.authToken,
        refreshToken: data.account?.refreshToken,
        expiryDate: data.account?.expiryDate,
        refreshTokenExpiresAt: data.account?.refreshTokenExpiresAt
      });
      await syncStoredAppLanguagePreference().catch(() => undefined);
      await load();
      const credits = Number(data.account?.creditsRemaining || 0);
      setProcessorAccountForm((current) => ({ ...current, password: "" }));
      setMessage(credits > 0
        ? `Signed in to ${data.account?.email || "your SuperReferrals account"} with ${credits} credits. Store setup is ready.`
        : `Signed in to ${data.account?.email || "your SuperReferrals account"}, but this account has no credits. Purchase credits to continue.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "SuperReferrals sign-in failed");
    } finally {
      setBusy("");
    }
  }

  async function addProcessorCredits(amountUsd = processorAmountUsd) {
    const parsedAmountUsd = Number(amountUsd);
    if (!Number.isFinite(parsedAmountUsd) || parsedAmountUsd <= 0) {
      setMessage("Enter a valid dollar amount for processor credits.");
      return;
    }
    const checkoutEmail = processorAccountEmail.trim().toLowerCase();
    if (!checkoutEmail || !isEmailLike(checkoutEmail)) {
      setMessage("Enter a valid email address before purchasing processor credits.");
      return;
    }

    setBusy("processor-credits");
    setMessage("");
    try {
      const existingCustomerId = customer?.id || "";
      const existingCustomerName = customer?.name || "";
      const response = await fetchWithSamsarAuth("/api/processor/credits/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          amountCents: Math.round(parsedAmountUsd * 100),
          customerId: existingCustomerId || undefined,
          customerEmail: checkoutEmail || undefined,
          metadata: {
            ...(existingCustomerId ? { superreferralsCustomerId: existingCustomerId } : {}),
            ...(existingCustomerName ? { superreferralsCustomerName: existingCustomerName } : {}),
            ...(customerForm.ownerWallet ? { superreferralsOwnerWallet: customerForm.ownerWallet } : {}),
            ...(checkoutEmail ? { superreferralsAccountEmail: checkoutEmail } : {})
          }
        })
      });
      const data = await assertOk(response);
      if (!data.checkout?.url) {
        throw new Error("SuperReferrals checkout did not return a URL");
      }
      window.location.href = data.checkout.url;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to start SuperReferrals checkout");
    } finally {
      setBusy("");
    }
  }

  async function runProcessorAccountAction(action: "refresh_credits" | "create_login_link" | "create_password_link") {
    setBusy(`processor-${action}`);
    setMessage("");
    try {
      const response = await fetchWithSamsarAuth("/api/processor/account/action", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer?.id || customerForm.id,
          action
        })
      });
      const data = await assertOk(response);
      await load();
      if (data.loginUrl) {
        window.open(data.loginUrl, "_blank", "noopener,noreferrer");
      }
      if (action === "refresh_credits") {
        setMessage(`SuperReferrals credits refreshed: ${Number(data.creditsRemaining || 0)} credits.`);
      } else if (action === "create_password_link") {
        setMessage("Created a SuperReferrals password setup link.");
      } else {
        setMessage("Created a SuperReferrals account login link.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "SuperReferrals account action failed");
    } finally {
      setBusy("");
    }
  }

  async function runAgentTown() {
    setBusy("agent-town");
    setMessage("");
    try {
      const response = await fetchWithSamsarAuth("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customer?.id || customerForm.id,
          objective: agentObjective,
          payload: parseJsonObject(agentPayload)
        })
      });
      const data = await assertOk(response);
      await load();
      setMessage(`Agent Town job ${data.job?.id || ""} completed with full 0G receipts.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Agent Town run failed");
    } finally {
      setBusy("");
    }
  }

  async function rollbackAgentJob(id: string) {
    setBusy(`rollback-${id}`);
    setMessage("");
    try {
      const response = await fetchWithSamsarAuth(`/api/agents/${id}/rollback`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "Operator requested rollback from customer console" })
      });
      await assertOk(response);
      await load();
      setMessage(`Agent job ${id} rollback recorded.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rollback failed");
    } finally {
      setBusy("");
    }
  }

  if (!store) {
    return <CustomerStoreCreatorSkeleton />;
  }

  return (
    <div className="app-shell">
      <SaveToast toast={toast} />
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark"><Sparkles size={18} /></span>
          SuperReferrals
        </div>
        <p className="sidebar-copy">
          Customer console for SuperReferrals credits, store setup, per-second USDC pricing, and render operations.
        </p>
        <nav className="nav-list">
          <a className="nav-item" href="#processor-credits"><CircleDollarSign size={16} /> Credits</a>
          <a className="nav-item" href="#store-setup"><KeyRound size={16} /> Store setup</a>
          <a className="nav-item" href="#usdc-pricing"><ShieldCheck size={16} /> USDC pricing</a>
          <a className="nav-item" href="#published-videos"><Radio size={16} /> Published videos</a>
          <a className="nav-item" href="#agent-town"><Network size={16} /> Agent Town</a>
          <a className="nav-item" href="#render-history"><Bot size={16} /> Render history</a>
          {customerLanding && <a className="nav-item" href={customerLanding}><ExternalLink size={16} /> Public view</a>}
          <a className="nav-item" href="/storefronts"><Store size={16} /> Storefront directory</a>
        </nav>
      </aside>

      <main className="main">
        <div className="topbar hero-band">
          <div className="topbar-copy">
            <div className="topbar-title-row">
              <BreadcrumbNav />
              <div className="eyebrow">Storefront Owner Console</div>
            </div>
            <h1>Configure your customer store</h1>
            <p className="subtle">
              Purchase credits or sign in, define public per-second render pricing in USDC, and publish your SuperReferrals storefront.
            </p>
          </div>
          <div className="page-top-actions">
            <LanguageSelector />
            {customerLanding && (
              <a className="btn primary" href={customerLanding}>
                <ExternalLink size={16} /> Public facing URL
              </a>
            )}
            <button className="btn" onClick={() => load()} title="Refresh data">
              <RefreshCw size={16} /> Refresh
            </button>
          </div>
        </div>

        {showStagingEnvironmentNotice && (
          <div className="environment-banner" role="status">
            <span>Staging environment</span>
            <p>
              This workspace is for demo purposes only. Merchant production storefront accounts should be created at{" "}
              <a href="https://super-referrals.vercel.app/" target="_blank" rel="noreferrer">super-referrals.vercel.app</a>{" "}
              when production onboarding opens. Coming soon.
            </p>
          </div>
        )}

        {message && <p className="notice">{message}</p>}

        <section className="stat-row">
          <div className="stat"><strong>{activeStorefrontSubAccounts.length}</strong><span className="subtle">wallet users</span></div>
          <div className="stat"><strong>{activeStorefrontGenerations.length}</strong><span className="subtle">render tasks</span></div>
          <div className="stat"><strong>{activeJobs}</strong><span className="subtle">active jobs</span></div>
          <div className="stat"><strong>{completedJobs}</strong><span className="subtle">completed jobs</span></div>
          <div className="stat"><strong>{store.agents.length}</strong><span className="subtle">agent citizens</span></div>
          <div className="stat"><strong>{agentJobs.length}</strong><span className="subtle">agent jobs</span></div>
        </section>

        <div className="grid storefront-owner-layout">
          <section className="stack storefront-owner-setup-stack">
            <div className="panel panel-strong" id="processor-credits">
              <div className="panel-header">
                <div>
                  <h2>SuperReferrals Account & Credits</h2>
                  <p className="subtle">
                    Purchase credits or sign in to set up your store. Configure business rules, price multipliers, and conditional logic from the admin panel.
                  </p>
                </div>
                <CircleDollarSign size={18} />
              </div>
              <div className="account-status-strip">
                <div className="readonly-value">
                  {hasProcessorAccountSession ? processorAccountEmail || "SuperReferrals account ready" : "No login detected."}
                </div>
                <span className={hasCreditedProcessorAccount ? "badge ok" : "badge"}>
                  {processorCreditsRemaining} credits
                </span>
              </div>
              <div className="amount-grid">
                {processorCreditAmounts.map((amount) => (
                  <button
                    className={`amount-choice ${processorAmountUsd === amount ? "active" : ""}`}
                    key={amount}
                    onClick={() => setProcessorAmountUsd(amount)}
                  >
                    <span>${amount}</span>
                    <strong>{amount * 100} credits</strong>
                  </button>
                ))}
              </div>
              <div className="form-grid processor-checkout">
                <TextField
                  label="Checkout amount USD"
                  type="number"
                  value={processorAmountUsd}
                  onChange={(amount) => setProcessorAmountUsd(Number(amount))}
                />
                <TextField
                  label="Account email"
                  value={processorAccountForm.email}
                  onChange={(email) => setProcessorAccountForm({ ...processorAccountForm, email })}
                />
                <div className="field">
                  <label>Estimated credits</label>
                  <div className="readonly-value">{Math.max(0, Math.round(Number(processorAmountUsd || 0) * 100))}</div>
                </div>
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={() => addProcessorCredits()} disabled={busy === "processor-credits"}>
                  <CircleDollarSign size={16} /> Purchase credits
                </button>
              </div>
              <div className="button-row">
                <button className="btn" onClick={() => runProcessorAccountAction("refresh_credits")} disabled={busy === "processor-refresh_credits" || !hasProcessorAccountSession}>
                  <RefreshCw size={16} /> Refresh credits
                </button>
              </div>
              <div className="account-wallet-link">
                <div className="field">
                  <label>Linked payout wallet</label>
                  <div className="readonly-value mono">{hasProcessorAccountSession && linkedSamsarWallet ? linkedSamsarWallet : "No wallet linked"}</div>
                </div>
                <button className="btn" onClick={() => connectCustomerWallet()} disabled={connectingCustomerWallet || !hasProcessorAccountSession}>
                  <Wallet size={16} /> Connect wallet
                </button>
              </div>
              <details className="advanced-section processor-login-dropdown" open={!hasProcessorAccountSession}>
                <summary>Login with samsar-js credentials</summary>
                <div className="form-grid processor-login">
                  <TextField
                    label="Account email"
                    value={processorAccountForm.email}
                    onChange={(email) => setProcessorAccountForm({ ...processorAccountForm, email })}
                  />
                  <TextField
                    label="Password"
                    type="password"
                    value={processorAccountForm.password}
                    onChange={(password) => setProcessorAccountForm({ ...processorAccountForm, password })}
                  />
                </div>
                <div className="button-row inline-actions">
                  <button className="btn" onClick={loginProcessorAccount} disabled={busy === "processor-login" || !processorAccountForm.email || !processorAccountForm.password}>
                    <ShieldCheck size={16} /> Submit
                  </button>
                </div>
              </details>
            </div>

            <div className={`panel ${hasCreditedProcessorAccount ? "" : "panel-disabled"}`} id="store-setup">
              <div className="panel-header">
                <h2>Store Setup</h2>
                <KeyRound size={18} />
              </div>
              {accountStorefronts.length > 0 && (
                <div className="list storefront-switcher">
                  <div className="item-title">
                    <strong>Your storefronts</strong>
                    <button className="btn small" type="button" onClick={startNewStorefront} disabled={!hasCreditedProcessorAccount}>
                      <Plus size={15} /> New storefront
                    </button>
                  </div>
                  {accountStorefronts.map((item) => (
                    <button
                      className="item"
                      key={item.id}
                      onClick={() => selectStorefront(item.id)}
                      style={{ textAlign: "left", borderColor: !creatingNewStorefront && item.id === customer?.id ? "var(--accent-cool)" : undefined }}
                      type="button"
                    >
                      <div className="item-title">
                        <strong>{item.name}</strong>
                        <span className="badge">
                          {item.id === customer?.id
                            ? `${store.generations.filter((generation) => generation.customerId === item.id).length} renders`
                            : "Switch"}
                        </span>
                      </div>
                      <p className="subtle">
                        {item.storefront?.category || "Customer store"} · {item.storefront?.conditions?.enabled ? "custom policies" : "default policies"}
                      </p>
                    </button>
                  ))}
                  {creatingNewStorefront && (
                    <div className="notice">New storefront draft. Saving creates a separate directory item with its own policies, pricing, ratings, and render history.</div>
                  )}
                </div>
              )}
              <div className="form-grid">
                <TextField label="Store name" value={customerForm.name} onChange={(name) => setCustomerForm({ ...customerForm, name })} />
                <TextField label="Storefront category" value={customerForm.storefrontCategory} onChange={(storefrontCategory) => setCustomerForm({ ...customerForm, storefrontCategory })} />
                <TextField label="Storefront header" value={customerForm.storefrontHeroTitle} onChange={(storefrontHeroTitle) => setCustomerForm({ ...customerForm, storefrontHeroTitle })} />
                <TextField label="Storefront website URL" value={customerForm.storefrontWebsiteUrl} onChange={(storefrontWebsiteUrl) => setCustomerForm({ ...customerForm, storefrontWebsiteUrl })} />
                <div className="field full storefront-logo-edit">
                  <label>Storefront logo</label>
                  <div className="storefront-logo-edit-row">
                    <span className="storefront-logo-preview">
                      <img alt="" src={customerForm.storefrontLogoUrl || "/superreferrals-logo.svg"} />
                    </span>
                    <div className="storefront-logo-controls">
                      <input
                        value={customerForm.storefrontLogoUrl}
                        onChange={(event) => setCustomerForm({ ...customerForm, storefrontLogoUrl: event.target.value })}
                        placeholder="https://..."
                      />
                      <label className={`btn small ${busy === "storefront-logo" ? "disabled" : ""}`}>
                        <Upload size={15} /> {busy === "storefront-logo" ? "Uploading..." : "Upload image"}
                        <input
                          accept="image/jpeg,image/png,image/webp"
                          disabled={busy === "storefront-logo"}
                          hidden
                          onChange={handleStorefrontLogoInput}
                          type="file"
                        />
                      </label>
                    </div>
                  </div>
                  <p className="subtle">Recommended logo: 320 x 120 PNG or WebP, transparent background, 4 MB max. If empty, the public navbar uses the SuperReferrals logo.</p>
                  {logoUploadError && <p className="notice warning compact">{logoUploadError}</p>}
                </div>
                <div className="field full">
                  <label>Storefront subheader</label>
                  <textarea value={customerForm.storefrontHeroSubtitle} onChange={(event) => setCustomerForm({ ...customerForm, storefrontHeroSubtitle: event.target.value })} />
                </div>
                <div className="field full">
                  <label>Directory description</label>
                  <textarea value={customerForm.storefrontDescription} onChange={(event) => setCustomerForm({ ...customerForm, storefrontDescription: event.target.value })} />
                </div>
              </div>
              <div className="theme-picker-section">
                <div className="item-title">
                  <div>
                    <strong>Public storefront layout</strong>
                    <p className="subtle">Choose how wallet, pricing, and render controls are arranged on public routes.</p>
                  </div>
                  <ImageIcon size={17} />
                </div>
                <div className="storefront-layout-picker" role="radiogroup" aria-label="Public storefront layout">
                  {STOREFRONT_LAYOUT_OPTIONS.map((layout) => (
                    <button
                      aria-checked={customerForm.storefrontLayoutId === layout.id}
                      className={`layout-choice ${customerForm.storefrontLayoutId === layout.id ? "active" : ""}`}
                      key={layout.id}
                      onClick={() => setCustomerForm({ ...customerForm, storefrontLayoutId: layout.id })}
                      role="radio"
                      type="button"
                    >
                      <strong>{layout.label}</strong>
                      <small>{layout.description}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="theme-picker-section">
                <div className="item-title">
                  <div>
                    <strong>Public storefront theme</strong>
                    <p className="subtle">Theme 1 keeps the current storefront look; the other themes are complementary presets.</p>
                  </div>
                  <Palette size={17} />
                </div>
                <div className="theme-picker-grid" role="radiogroup" aria-label="Public storefront theme">
                  {STOREFRONT_THEMES.map((theme) => (
                    <button
                      aria-checked={customerForm.storefrontThemeId === theme.id}
                      className={`theme-choice ${customerForm.storefrontThemeId === theme.id ? "active" : ""}`}
                      key={theme.id}
                      onClick={() => setCustomerForm({ ...customerForm, storefrontThemeId: theme.id })}
                      role="radio"
                      type="button"
                    >
                      <span className="theme-swatch-row" aria-hidden="true">
                        {theme.swatches.map((color) => <span key={color} style={{ background: color }} />)}
                      </span>
                      <strong>{theme.label}</strong>
                      <small>{theme.accentLabel}</small>
                    </button>
                  ))}
                </div>
              </div>
              <div className="setup-wallet-strip">
                <div className="field">
                  <label>Store owner payout wallet</label>
                  <div className="readonly-value mono">{hasValidOwnerWallet ? customerForm.ownerWallet : "No wallet connected"}</div>
                </div>
                <div className="wallet-provider-grid">
                  {(walletProviders.length > 0 ? walletProviders : []).map((walletProvider) => (
                    <button
                      className="wallet-provider-button"
                      disabled={connectingCustomerWallet || !hasProcessorAccountSession}
                      key={walletProvider.id}
                      onClick={() => connectCustomerWallet(walletProvider)}
                      type="button"
                    >
                      {walletProvider.icon ? <img alt="" src={walletProvider.icon} /> : <Wallet size={16} />}
                      {walletProvider.name}
                    </button>
                  ))}
                  {walletProviders.length === 0 && (
                    <button className="wallet-provider-button" disabled={connectingCustomerWallet || !hasProcessorAccountSession} onClick={() => connectCustomerWallet()} type="button">
                      <Wallet size={16} /> Browser wallet
                    </button>
                  )}
                </div>
              </div>
              {ownerWalletRequiredNotice && <p className="notice warning">{ownerWalletRequiredNotice}</p>}
              <details className="advanced-section">
                <summary>Advanced owner and storefront details</summary>
                <div className="form-grid">
                  <TextField label="Payout wallet address" value={customerForm.ownerWallet} onChange={(ownerWallet) => setCustomerForm({ ...customerForm, ownerWallet })} full />
                  <TextField label="ENS name" value={customerForm.ensName} onChange={(ensName) => setCustomerForm({ ...customerForm, ensName })} />
                  <TextField label="Support email" value={customerForm.storefrontSupportEmail} onChange={(storefrontSupportEmail) => setCustomerForm({ ...customerForm, storefrontSupportEmail })} />
                  <TextField label="Referrer base URL" value={customerForm.referrerBaseUrl} onChange={(referrerBaseUrl) => setCustomerForm({ ...customerForm, referrerBaseUrl })} full />
                  <TextField label="Storefront tags" value={customerForm.storefrontTags} onChange={(storefrontTags) => setCustomerForm({ ...customerForm, storefrontTags })} />
                  <TextField label="Platform fee bps" type="number" value={customerForm.platformFeeBps} onChange={(platformFeeBps) => setCustomerForm({ ...customerForm, platformFeeBps: Number(platformFeeBps) })} />
                  <TextField label="Failure refund bps" type="number" value={customerForm.refundOnFailureBps} onChange={(refundOnFailureBps) => setCustomerForm({ ...customerForm, refundOnFailureBps: Number(refundOnFailureBps) })} />
                </div>
              </details>
              <details
                className="advanced-section storefront-ens-section"
                onToggle={(event) => setEnsSettingsOpen(event.currentTarget.open)}
                open={ensSettingsOpen}
              >
                <summary>ENS storefront proxy</summary>
                <div className="ens-proxy-header">
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={customerForm.ensProxyEnabled}
                      onChange={(event) => setCustomerForm({ ...customerForm, ensProxyEnabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                  <button className="btn small" onClick={verifyEnsProxyRecords} disabled={busy === "ens-verify" || !customerForm.ensProxyName} type="button">
                    <Globe2 size={15} /> Verify ENS
                  </button>
                  <button className="btn small" onClick={() => configureEnsProxyRecords()} disabled={busy === "ens-configure" || !customerForm.ensProxyName || !customer} type="button">
                    <Wallet size={15} /> Write ENS records
                  </button>
                </div>
                <div className="form-grid">
                  <TextField label="ENS host or subdomain" value={customerForm.ensProxyName} onChange={(ensProxyName) => setCustomerForm({ ...customerForm, ensProxyName })} />
                  <div className="field">
                    <label>ENS network</label>
                    <select
                      value={customerForm.ensProxyNetwork}
                      onChange={(event) => setCustomerForm({ ...customerForm, ensProxyNetwork: event.target.value as StorefrontEnsNetwork })}
                    >
                      <option value="sepolia">Sepolia testnet</option>
                      <option value="mainnet">Ethereum mainnet</option>
                      <option value="base">Base production, Ethereum ENS</option>
                    </select>
                  </div>
                  <TextField label="Storefront base path" value={customerForm.ensStorefrontPath} onChange={(ensStorefrontPath) => setCustomerForm({ ...customerForm, ensStorefrontPath: normalizeStorefrontProxyPath(ensStorefrontPath, "/") })} />
                  <TextField label="Feed relative path" value={customerForm.ensFeedPath} onChange={(ensFeedPath) => setCustomerForm({ ...customerForm, ensFeedPath: normalizeStorefrontProxyPath(ensFeedPath, "/feed") })} />
                  <TextField label="Gallery relative path" value={customerForm.ensMosaicPath} onChange={(ensMosaicPath) => setCustomerForm({ ...customerForm, ensMosaicPath: normalizeStorefrontGalleryPath(ensMosaicPath) })} />
                  <TextField label="Video relative path prefix" value={customerForm.ensVideoPath} onChange={(ensVideoPath) => setCustomerForm({ ...customerForm, ensVideoPath: normalizeStorefrontProxyPath(ensVideoPath, "/feed") })} />
                  <TextField label="Content hash" value={customerForm.ensContentHash} onChange={(ensContentHash) => setCustomerForm({ ...customerForm, ensContentHash })} full />
                </div>
                {customer && (
                  <div className="ens-record-list">
                    <div className="item-title">
                      <strong>ENS text records</strong>
                      <ImageIcon size={15} />
                    </div>
                    {ensProxyRecordRows.map((row) => (
                      <div className="ens-record-row" key={row.key}>
                        <code>{row.key}</code>
                        <span>{row.value}</span>
                      </div>
                    ))}
                    {ensConfigExplorerUrl && (
                      <a className="btn small" href={ensConfigExplorerUrl} target="_blank" rel="noreferrer">
                        <ExternalLink size={15} /> ENS transaction
                      </a>
                    )}
                  </div>
                )}
              </details>
              <div className="button-row">
                <button className="btn primary" onClick={saveCustomer} disabled={busy === "customer" || !hasCreditedProcessorAccount}>
                  <Save size={16} /> Save setup
                </button>
                <a className="btn" href="/storefronts"><Store size={16} /> Directory</a>
                {publicStorefrontLinks.map((link) => (
                  <a className="btn" href={link.href} key={link.label} target={link.href.startsWith("http") ? "_blank" : undefined} rel={link.href.startsWith("http") ? "noreferrer" : undefined}>
                    <ExternalLink size={16} /> {link.label}
                  </a>
                ))}
              </div>
            </div>
          </section>

          <section className="stack storefront-owner-pricing-stack">
            <div className={`panel panel-strong storefront-owner-pricing-panel ${hasCreditedProcessorAccount ? "" : "panel-disabled"}`} id="usdc-pricing">
              <div className="panel-header">
                <h2>Public Render Pricing</h2>
                <Database size={18} />
              </div>
              <div className="form-grid pricing-summary-grid">
                <TextField
                  label="Global user multiplier"
                  type="number"
                  value={customerForm.customerMultiplier}
                  onChange={(customerMultiplier) => setCustomerForm({ ...customerForm, customerMultiplier: Number(customerMultiplier) })}
                />
                <div className="field">
                  <label>Processor credit value</label>
                  <div className="readonly-value">{customerForm.creditUnitUsd.toFixed(3)} USDC / credit</div>
                </div>
              </div>

              <div className="pricing-table action-pricing-list">
                {paidINFTActions.map((action) => (
                  <div className="pricing-row" key={action}>
                    <div>
                      <strong>{formatINFTActionLabel(action)}</strong>
                      <p className="subtle">INFT page operation price</p>
                    </div>
                    <TextField
                      label="USDC price"
                      type="number"
                      value={customerForm.inftActionPricesUsd[action] ?? defaultINFTActionPricesUsd[action]}
                      onChange={(value) => updateINFTActionPrice(action, value)}
                    />
                  </div>
                ))}
              </div>

              <div className="render-conditions-editor storefront-render-conditions">
                <div className="item-title">
                  <div>
                    <strong>Storefront render conditions</strong>
                    <p className="subtle">Restrict which render choices are available on this storefront route.</p>
                  </div>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={customerForm.conditionalsEnabled}
                      onChange={(event) => setCustomerForm({ ...customerForm, conditionalsEnabled: event.target.checked })}
                    />
                    Enabled
                  </label>
                </div>
                {customerForm.conditionalsEnabled && (
                  <div className="conditions-editor-grid storefront-conditions-grid">
                    <div className="field full">
                      <label>Enabled models</label>
                      <div className="condition-chip-grid">
                        {conditionModelOptions.map((model) => (
                          <label className="toggle-chip" key={model}>
                            <input
                              type="checkbox"
                              checked={customerForm.allowedModels.includes(model)}
                              onChange={() => toggleAllowedModel(model)}
                            />
                            {model}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div className="field">
                      <label>Enabled aspect ratios</label>
                      <div className="condition-chip-grid compact">
                        {conditionAspectOptions.map((aspectRatio) => (
                          <label className="toggle-chip" key={aspectRatio}>
                            <input
                              type="checkbox"
                              checked={customerForm.allowedAspectRatios.includes(aspectRatio)}
                              onChange={() => toggleAllowedAspectRatio(aspectRatio)}
                            />
                            {aspectRatio}
                          </label>
                        ))}
                      </div>
                    </div>
                    <TextField
                      label="Max images per render"
                      type="number"
                      value={customerForm.maxImages}
                      onChange={(maxImages) => setCustomerForm({ ...customerForm, maxImages: Number(maxImages) })}
                    />
                    <TextField
                      label="Daily wallet render limit"
                      type="number"
                      value={customerForm.dailyWalletRenderLimit}
                      onChange={(dailyWalletRenderLimit) => setCustomerForm({ ...customerForm, dailyWalletRenderLimit })}
                    />
                    <label className="toggle-row">
                      <input
                        type="checkbox"
                        checked={customerForm.walletAccessMode === "whitelist"}
                        onChange={(event) => setCustomerForm({
                          ...customerForm,
                          walletAccessMode: event.target.checked ? "whitelist" : "open"
                        })}
                      />
                      Whitelisted wallets only
                    </label>
                    {customerForm.walletAccessMode === "whitelist" && (
                      <div className="field full">
                        <label>Whitelisted wallet addresses</label>
                        <textarea
                          value={customerForm.walletWhitelist}
                          onChange={(event) => setCustomerForm({ ...customerForm, walletWhitelist: event.target.value })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="pricing-table model-settings-list">
                {customerForm.modelConfigurations.map((config) => {
                  const details = resolveModelPriceDetails(
                    { pricing: { customerMultiplier: customerForm.customerMultiplier, creditUnitUsd: customerForm.creditUnitUsd } },
                    config
                  );
                  return (
                    <div className="pricing-row model-settings-row" key={config.id}>
                      <div className="model-settings-title">
                        <strong>{config.label}</strong>
                        <p className="subtle">{config.videoModel} · {config.aspectRatio} · up to {config.maxSecondsPerImage}s/image</p>
                      </div>
                      <div className="model-settings-fields">
                        <div className="readonly-value pricing-readonly">
                          <span>{details.baseCreditsPerSecond}</span>
                          <small>credits/sec</small>
                        </div>
                        <div className="readonly-value pricing-readonly">
                          <span>{details.basePricePerSecondUsd.toFixed(2)}</span>
                          <small>base USDC/sec</small>
                        </div>
                        <TextField
                          label="Custom USDC/sec"
                          type="number"
                          value={config.customPricePerSecondUsd ?? ""}
                          onChange={(customPricePerSecondUsd) => {
                            const parsed = Number(customPricePerSecondUsd);
                            updatePricingRow(config.id, {
                              customPricePerSecondUsd: Number.isFinite(parsed) && parsed > 0 ? parsed : undefined
                            });
                          }}
                        />
                        <div className="readonly-value pricing-readonly">
                          <span>{details.pricePerSecondUsd.toFixed(2)}</span>
                          <small>user USDC/sec</small>
                        </div>
                        <label className="toggle-row">
                          <input
                            type="checkbox"
                            checked={config.enabled}
                            onChange={(event) => updatePricingRow(config.id, { enabled: event.target.checked })}
                          />
                          Enabled
                        </label>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={saveCustomer} disabled={busy === "customer" || !hasCreditedProcessorAccount}>
                  <Save size={16} /> Save pricing
                </button>
                <button
                  className="btn"
                  onClick={() => setCustomerForm({
                    ...customerForm,
                    modelConfigurations: customerForm.modelConfigurations.map((item) => ({
                      ...item,
                      customPricePerSecondUsd: undefined
                    }))
                  })}
                >
                  Clear model overrides
                </button>
              </div>
            </div>
          </section>
        </div>

        {customer && (
          <section className="panel storefront-owner-video-panel" id="published-videos">
            <div className="panel-header">
              <div>
                <h2>Videos</h2>
                <p className="subtle">
                  Manage published and unpublished videos for this storefront. Unpublishing removes the video from every public feed surface.
                </p>
              </div>
              <Bot size={18} />
            </div>
            <StorefrontVideoGrid
              actor="owner"
              customerId={customer.id}
              emptyText="No published videos for this storefront yet."
              initialPageSize={9}
              onRefresh={load}
              showCreatorWallet
              store={store}
            />
          </section>
        )}

        <section className="panel agent-town-panel" id="agent-town">
          <div className="panel-header">
            <div>
              <h2>Agent Town</h2>
              <p className="subtle">
                Multi-agent sandbox for 0G Chain, Storage, DA, Compute, service discovery, SuperReferrals actions, Uniswap price signals, KeeperHub settlement, and Gensyn AXL chatter.
              </p>
            </div>
            <Network size={20} />
          </div>

          <div className="form-grid">
            <div className="field full">
              <label>Agent objective</label>
              <textarea value={agentObjective} onChange={(event) => setAgentObjective(event.target.value)} />
            </div>
            <div className="field full">
              <label>Agent payload JSON</label>
              <textarea value={agentPayload} onChange={(event) => setAgentPayload(event.target.value)} />
            </div>
          </div>
          <div className="button-row">
            <button className="btn primary" onClick={runAgentTown} disabled={busy === "agent-town"}>
              <Zap size={16} /> Run Agent Town
            </button>
            <button className="btn" onClick={() => load()} title="Refresh agents">
              <RefreshCw size={16} /> Refresh agents
            </button>
            {latestAgentJob && (
              <button className="btn warn" onClick={() => rollbackAgentJob(latestAgentJob.id)} disabled={busy === `rollback-${latestAgentJob.id}`}>
                <Undo2 size={16} /> Roll back latest
              </button>
            )}
          </div>

          <div className="agent-town-grid">
            <div>
              <div className="section-title">
                <Users size={16} />
                <h3>Agents</h3>
              </div>
              <div className="list">
                {store.agents.map((agent) => (
                  <div className="item" key={agent.id}>
                    <div className="item-title">
                      <strong>{agent.name}</strong>
                      <span className="badge ok">{agent.role}</span>
                    </div>
                    <p className="subtle">{agent.personality}</p>
                    <p className="mono">{agent.axlPeerId}</p>
                    <p className="mono">{agent.walletAddress}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div className="section-title">
                <Database size={16} />
                <h3>0G Receipts</h3>
              </div>
              <div className="list">
                {!latestAgentJob && <p className="subtle">Run Agent Town to generate pillar receipts.</p>}
                {latestAgentJob?.receipts.map((receipt) => (
                  <div className="item" key={`${latestAgentJob.id}-${receipt.pillar}`}>
                    <div className="item-title">
                      <strong>{receipt.label}</strong>
                      <span className="badge">{receipt.pillar}</span>
                    </div>
                    <p className="subtle">{receipt.detail}</p>
                    <p className="mono">{receipt.rootHash || receipt.txHash || receipt.uri}</p>
                  </div>
                ))}
                {latestAgentJob?.priceSignal && (
                  <div className="item">
                    <div className="item-title">
                      <strong>Uniswap price signal</strong>
                      <span className="badge ok">{latestAgentJob.priceSignal.confidence.toFixed(2)}</span>
                    </div>
                    <p className="subtle">
                      {latestAgentJob.priceSignal.chargeUsd.toFixed(2)} {latestAgentJob.priceSignal.settlementToken} charged from {latestAgentJob.priceSignal.paymentToken}.
                    </p>
                  </div>
                )}
              </div>
            </div>

            <div>
              <div className="section-title">
                <Radio size={16} />
                <h3>AXL Timeline</h3>
              </div>
              <div className="list">
                {store.agentTownEvents.length === 0 && <p className="subtle">No agent events yet.</p>}
                {store.agentTownEvents.slice(0, 8).map((event) => {
                  const fromAgent = store.agents.find((agent) => agent.id === event.fromAgentId);
                  const toAgent = store.agents.find((agent) => agent.id === event.toAgentId);
                  return (
                    <div className="item" key={event.id}>
                      <div className="item-title">
                        <strong>{fromAgent?.name || event.fromAgentId}</strong>
                        <span className="badge">{event.channel}</span>
                      </div>
                      <p className="subtle">
                        {toAgent ? `to ${toAgent.name}: ` : ""}{event.content}
                      </p>
                      {event.axlMessageId && <p className="mono">{event.axlMessageId}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        <section className="panel render-history-panel" id="render-history">
          <div className="panel-header">
            <h2>Recent Render Tasks</h2>
            <Bot size={18} />
          </div>
          <div className="list render-task-row">
            {activeStorefrontGenerations.length === 0 && <p className="subtle">No render tasks yet.</p>}
            {activeStorefrontGenerations.slice(0, 8).map((generation) => (
              <div className="item" key={generation.id}>
                <div className="item-title">
                  <strong>{generation.id}</strong>
                  <span className={generation.status === "COMPLETED" ? "badge ok" : generation.status === "FAILED" ? "badge fail" : "badge"}>{generation.status}</span>
                </div>
                <p className="subtle">
                  {generation.input.image_urls.length} images · {generation.input.video_model} · {generation.input.aspect_ratio} · {generation.payment.amountUsd.toFixed(2)} USDC
                </p>
                {generation.inftId && <a className="btn" href={`/inft/${generation.inftId}`}><ExternalLink size={16} /> Open INFT</a>}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function formatINFTActionLabel(action: INFTPaidAction) {
  return action
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function TextField({
  label,
  value,
  onChange,
  type = "text",
  full = false
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  full?: boolean;
}) {
  return (
    <div className={`field ${full ? "full" : ""}`}>
      <label>{label}</label>
      <input type={type} value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function SaveToast({ toast }: { toast: ToastState }) {
  if (!toast) {
    return null;
  }
  return (
    <div className={`save-toast ${toast.kind}`} role="status" aria-live="polite">
      <strong>{toast.kind === "success" ? "Saved" : toast.kind === "warning" ? "Wallet required" : "Update failed"}</strong>
      <span>{toast.message}</span>
    </div>
  );
}

function sameProcessorAccount(left: Customer, right: Customer) {
  const leftUserId = left.samsarAccount?.userId || left.samsarAccount?.externalUserId;
  const rightUserId = right.samsarAccount?.userId || right.samsarAccount?.externalUserId;
  if (leftUserId && rightUserId) {
    return leftUserId === rightUserId;
  }
  const leftEmail = left.samsarAccount?.email?.toLowerCase();
  const rightEmail = right.samsarAccount?.email?.toLowerCase();
  if (leftEmail && rightEmail) {
    return leftEmail === rightEmail;
  }
  return left.id === right.id;
}

async function assertOk(response: Response) {
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function parseJsonObject(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("JSON must be an object");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid JSON payload");
  }
}

function shortWallet(value = "") {
  const trimmed = value.trim();
  if (trimmed.length <= 12) {
    return trimmed || "wallet";
  }
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
}

function isEmailLike(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function ensWalletChainConfig(network: StorefrontEnsNetwork): TransactionChainConfig {
  return getTransactionChainConfig(network === "sepolia" ? 11155111 : 1);
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
    return toRpcQuantity((gas * 12n) / 10n + 1n);
  } catch (error) {
    throw new Error(formatWalletTransactionError(error, context));
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

function compactTransaction(transaction: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(transaction).filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}

function toRpcQuantity(value: bigint) {
  return `0x${value.toString(16)}`;
}

function walletErrorCode(error: unknown) {
  return typeof error === "object" && error && "code" in error
    ? Number((error as { code?: unknown }).code)
    : 0;
}

function formatWalletTransactionError(
  error: unknown,
  context: { label: string; chainName: string; recovery?: string }
) {
  if (walletErrorCode(error) === 4001) {
    return `${context.label} was rejected in the wallet.`;
  }
  const recovery = context.recovery ? ` ${context.recovery}` : "";
  return `${context.label} failed on ${context.chainName}: ${formatErrorMessage(error, "wallet transaction failed")}.${recovery}`;
}

function formatErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "object" && error && "message" in error) {
    return String((error as { message?: unknown }).message || fallback);
  }
  return fallback;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
