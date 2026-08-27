import { getWallets } from "@wallet-standard/app";
import { z } from "zod";

import type { ReadyMobileClientFactory } from "./ready-mobile-wallet";

/** The wallet surface used after an account has been selected. */
export type BrowserWallet = {
  id?: string;
  name?: string;
  request<T>(input: { params?: unknown; type: string }): Promise<T>;
  selectedAddress: string;
};

export type DiscoverableWallet = {
  id: string;
  name: string;
  request<T>(input: { params?: unknown; type: string }): Promise<T>;
  selectedAddress?: string | undefined;
};

type WalletRequest = DiscoverableWallet["request"];

export type WalletUnavailableResolution = {
  href: string;
  kind: "install_extension";
  label: "Install Ready";
};

export class WalletUnavailableError extends Error {
  readonly resolution: WalletUnavailableResolution;

  constructor(resolution: WalletUnavailableResolution) {
    super("No compatible wallet was found");
    this.name = "WalletUnavailableError";
    this.resolution = resolution;
  }
}

type RequestWalletAccountOptions = {
  createMobileClient?: ReadyMobileClientFactory;
  discoverWallets?: () => Promise<readonly DiscoverableWallet[]>;
  openMobileUrl?: (url: string) => void;
  userAgent?: string;
  walletConnectProjectId?: string;
};

declare global {
  interface Window {
    starknet?: unknown;
    starknet_argentX?: unknown;
    starknet_braavos?: unknown;
  }
}

const READY_INSTALL = {
  chrome:
    "https://chromewebstore.google.com/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb",
  firefox: "https://addons.mozilla.org/en-GB/firefox/addon/argent-x/",
  other:
    "https://help.wallet.ready.co/hc/en-us/articles/28313046540829-What-is-Ready-X",
} as const;

const STARKNET_WALLET_API = "starknet:walletApi";

const standardFeatureSchema = z
  .object({
    id: z.string().min(1),
    request: z.instanceof(Function),
  })
  .passthrough();

const injectedProviderSchema = z
  .object({
    id: z.string().min(1).optional(),
    name: z.string().min(1).optional(),
    request: z.instanceof(Function),
    selectedAddress: z.string().min(1).optional(),
  })
  .passthrough();

function unavailableResolution(
  userAgent: string,
): WalletUnavailableResolution {
  let href: string = READY_INSTALL.other;
  if (/firefox/i.test(userAgent)) href = READY_INSTALL.firefox;
  else if (/chrome|chromium|crios|edg\//i.test(userAgent)) {
    href = READY_INSTALL.chrome;
  }
  return { href, kind: "install_extension", label: "Install Ready" };
}

function mobileBrowser(userAgent: string): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

function applicationUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (configured) return configured;
  const parsed = z
    .object({ location: z.object({ origin: z.string().url() }) })
    .safeParse(globalThis.window);
  if (parsed.success) return parsed.data.location.origin;
  throw new Error("Wrenchless public URL is not configured");
}

function openMobileUrl(url: string): void {
  globalThis.location.assign(url);
}

function readyCandidate(
  wallets: readonly DiscoverableWallet[],
): DiscoverableWallet | undefined {
  return wallets.find((wallet) => {
    const identity = `${wallet.id} ${wallet.name}`.toLowerCase();
    return identity.includes("ready") || identity.includes("argent");
  });
}

function standardWallets(): DiscoverableWallet[] {
  return getWallets()
    .get()
    .flatMap((wallet) => {
      const feature = wallet.features[STARKNET_WALLET_API];
      const parsed = standardFeatureSchema.safeParse(feature);
      if (!parsed.success) return [];
      // SAFETY: the schema established that this Wallet Standard feature owns a callable request.
      const request = parsed.data.request as WalletRequest;
      const boundRequest = request.bind(feature);
      return [
        {
          id: parsed.data.id,
          name: wallet.name,
          request<T>(input: { params?: unknown; type: string }): Promise<T> {
            return boundRequest<T>(input);
          },
        },
      ];
    });
}

function browserWindow(): object | null {
  const candidate = globalThis.window;
  if (candidate === undefined || candidate === null) return null;
  return candidate;
}

function injectedWallets(): DiscoverableWallet[] {
  const scope = browserWindow();
  if (scope === null) return [];
  const keys = Object.getOwnPropertyNames(scope).filter((key) =>
    key.startsWith("starknet_"),
  );
  const sources: { key: string; value: unknown }[] = [
    { key: "starknet", value: globalThis.window.starknet },
    { key: "starknet_argentX", value: globalThis.window.starknet_argentX },
    { key: "starknet_braavos", value: globalThis.window.starknet_braavos },
  ];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(scope, key);
    if (descriptor !== undefined && "value" in descriptor) {
      sources.push({ key, value: descriptor.value });
    }
  }
  const wallets: DiscoverableWallet[] = [];
  for (const { key, value } of sources) {
    const parsed = injectedProviderSchema.safeParse(value);
    if (!parsed.success) continue;
    // SAFETY: the provider schema established a callable request at this browser boundary.
    const request = parsed.data.request as WalletRequest;
    const boundRequest = request.bind(value);
    const fallbackId = key === "starknet_argentX" ? "argentX" : key;
    wallets.push({
      id: parsed.data.id ?? fallbackId,
      name:
        parsed.data.name ??
        (key === "starknet_argentX" ? "Ready Wallet" : fallbackId),
      request<T>(input: { params?: unknown; type: string }): Promise<T> {
        return boundRequest<T>(input);
      },
      get selectedAddress() {
        const current = injectedProviderSchema.safeParse(value);
        return current.success ? current.data.selectedAddress : undefined;
      },
    });
  }
  return wallets;
}

function uniqueWallets(
  wallets: readonly DiscoverableWallet[],
): DiscoverableWallet[] {
  const seen = new Set<string>();
  return wallets.filter((wallet) => {
    const id = wallet.id.toLowerCase();
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function availableWallets(): DiscoverableWallet[] {
  return uniqueWallets([...standardWallets(), ...injectedWallets()]);
}

function browserUserAgent(): string {
  const parsed = z
    .object({ userAgent: z.string() })
    .safeParse(globalThis.navigator);
  return parsed.success ? parsed.data.userAgent : "";
}

/** Refuse an operation if the selected account changed after this role opened. */
export function assertSelectedWalletAccount(
  wallet: Pick<BrowserWallet, "selectedAddress">,
  expectedAccount: string,
): void {
  const selected = wallet.selectedAddress;
  try {
    if (BigInt(selected) === BigInt(expectedAccount)) return;
  } catch {
    throw new Error("The wallet returned an invalid account. Reconnect and try again.");
  }
  throw new Error("The selected account changed. Switch back and try again.");
}

function connectedWallet(
  candidate: DiscoverableWallet,
  account: string,
): BrowserWallet {
  return {
    id: candidate.id,
    name: candidate.name,
    async request<T>(input: { params?: unknown; type: string }): Promise<T> {
      const result = await candidate.request(input);
      // SAFETY: Wallet API callers supply T for the named method's documented result.
      return result as T;
    },
    get selectedAddress() {
      return candidate.selectedAddress ?? account;
    },
  };
}

/**
 * Discover and connect a Starknet wallet. Private-method support is checked by
 * the operation that follows; discovery never treats a brand as capability.
 */
export async function requestWalletAccount(
  options: RequestWalletAccountOptions = {},
): Promise<{ wallet: BrowserWallet; account: string }> {
  const discoverWallets =
    options.discoverWallets ?? (async () => availableWallets());
  const wallets = uniqueWallets([
    ...(await discoverWallets()),
    ...injectedWallets(),
  ]);
  const wallet = readyCandidate(wallets) ?? wallets[0];
  if (wallet === undefined) {
    const userAgent = options.userAgent ?? browserUserAgent();
    if (mobileBrowser(userAgent)) {
      const { connectReadyMobileWallet } = await import("./ready-mobile-wallet");
      const mobileInput: Parameters<typeof connectReadyMobileWallet>[0] = {
        projectId:
          options.walletConnectProjectId ??
          import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ??
          "",
        applicationUrl: applicationUrl(),
        openUrl: options.openMobileUrl ?? openMobileUrl,
        userAgent,
      };
      if (options.createMobileClient !== undefined) {
        mobileInput.createClient = options.createMobileClient;
      }
      return connectReadyMobileWallet(mobileInput);
    }
    throw new WalletUnavailableError(
      unavailableResolution(userAgent),
    );
  }

  const response = await wallet.request({
    type: "wallet_requestAccounts",
    params: { silent_mode: false },
  });
  const accounts = z.array(z.string().min(1)).parse(response);
  const account = wallet.selectedAddress ?? accounts[0];
  if (account === undefined) {
    throw new Error("The wallet returned no account. Select one and try again.");
  }
  return { wallet: connectedWallet(wallet, account), account };
}
