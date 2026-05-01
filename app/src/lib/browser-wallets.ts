"use client";

export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isBraveWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isMetaMask?: boolean;
  isRabby?: boolean;
  providers?: EthereumProvider[];
};

export type BrowserWalletProvider = {
  id: string;
  name: string;
  icon?: string;
  rdns?: string;
  provider: EthereumProvider;
  detectedBy: "eip6963" | "legacy";
};

type Eip6963ProviderDetail = {
  info: {
    uuid: string;
    name: string;
    icon?: string;
    rdns?: string;
  };
  provider: EthereumProvider;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

export function subscribeToBrowserWalletProviders(onProviders: (providers: BrowserWalletProvider[]) => void) {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const providers = new Map<string, BrowserWalletProvider>();
  const publish = () => onProviders(sortWalletProviders([...providers.values()]));
  const addProvider = (wallet: BrowserWalletProvider) => {
    providers.set(wallet.id, wallet);
    publish();
  };
  const announceProvider = (event: Event) => {
    const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
    if (!detail?.provider || !detail.info?.uuid) {
      return;
    }
    addProvider({
      id: `eip6963:${detail.info.uuid}`,
      name: detail.info.name || legacyWalletName(detail.provider),
      icon: detail.info.icon,
      rdns: detail.info.rdns,
      provider: detail.provider,
      detectedBy: "eip6963"
    });
  };

  window.addEventListener("eip6963:announceProvider", announceProvider as EventListener);

  const legacyProviders = normalizeLegacyProviders(window.ethereum);
  legacyProviders.forEach((provider, index) => {
    addProvider({
      id: `legacy:${legacyWalletName(provider)}:${index}`,
      name: legacyWalletName(provider),
      provider,
      detectedBy: "legacy"
    });
  });

  window.dispatchEvent(new Event("eip6963:requestProvider"));
  publish();

  return () => {
    window.removeEventListener("eip6963:announceProvider", announceProvider as EventListener);
  };
}

export function detectBrowserWalletProviders(timeoutMs = 250) {
  if (typeof window === "undefined") {
    return Promise.resolve([] as BrowserWalletProvider[]);
  }

  return new Promise<BrowserWalletProvider[]>((resolve) => {
    let latestProviders: BrowserWalletProvider[] = [];
    const unsubscribe = subscribeToBrowserWalletProviders((providers) => {
      latestProviders = providers;
    });
    window.setTimeout(() => {
      unsubscribe();
      resolve(latestProviders);
    }, timeoutMs);
  });
}

export async function requestWalletAccounts(
  provider: EthereumProvider,
  options: { forceAccountSelection?: boolean } = {}
) {
  if (options.forceAccountSelection) {
    await provider.request({
      method: "wallet_requestPermissions",
      params: [{ eth_accounts: {} }]
    }).catch((error) => {
      if (!isUnsupportedWalletMethod(error)) {
        throw error;
      }
    });
  }
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  return Array.isArray(accounts)
    ? accounts.map((account) => String(account)).filter(Boolean)
    : [];
}

function normalizeLegacyProviders(provider?: EthereumProvider) {
  if (!provider) {
    return [];
  }
  return Array.isArray(provider.providers) && provider.providers.length > 0
    ? provider.providers
    : [provider];
}

function legacyWalletName(provider: EthereumProvider) {
  if (provider.isRabby) {
    return "Rabby";
  }
  if (provider.isCoinbaseWallet) {
    return "Coinbase Wallet";
  }
  if (provider.isBraveWallet) {
    return "Brave Wallet";
  }
  if (provider.isMetaMask) {
    return "MetaMask";
  }
  return "Browser wallet";
}

function sortWalletProviders(providers: BrowserWalletProvider[]) {
  const byName = new Map<string, BrowserWalletProvider>();
  for (const provider of providers) {
    const key = provider.name.toLowerCase();
    const current = byName.get(key);
    if (!current || current.detectedBy === "legacy") {
      byName.set(key, provider);
    }
  }
  return [...byName.values()].sort((left, right) =>
    walletProviderRank(left.name) - walletProviderRank(right.name) ||
    left.name.localeCompare(right.name)
  );
}

function walletProviderRank(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes("metamask")) {
    return 0;
  }
  if (normalized.includes("coinbase")) {
    return 1;
  }
  if (normalized.includes("rabby")) {
    return 2;
  }
  if (normalized.includes("brave")) {
    return 3;
  }
  return 10;
}

function isUnsupportedWalletMethod(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? Number((error as { code?: unknown }).code)
    : 0;
  const message = error instanceof Error ? error.message : "";
  return code === -32601 || /unsupported|not supported|method not found/i.test(message);
}
