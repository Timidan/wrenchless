import { getWallets } from "@wallet-standard/app";
import { z } from "zod";

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

export type WalletInstallTarget = {
  href: string;
  label: "Install Ready";
};

export class WalletUnavailableError extends Error {
  readonly install: WalletInstallTarget;

  constructor(install: WalletInstallTarget) {
    super("No compatible wallet was found");
    this.name = "WalletUnavailableError";
    this.install = install;
  }
}

type RequestWalletAccountOptions = {
  discoverWallets?: () => Promise<readonly DiscoverableWallet[]>;
  userAgent?: string;
};

declare global {
  interface Window {
    starknet?: unknown;
    starknet_argentX?: unknown;
    starknet_braavos?: unknown;
  }
}

const READY_INSTALL = {
  android: "https://play.google.com/store/apps/details?id=com.ready.wallet",
  chrome:
    "https://chromewebstore.google.com/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb",
  firefox: "https://addons.mozilla.org/en-GB/firefox/addon/argent-x/",
  ios: "https://apps.apple.com/us/app/ready-x/id6744935604",
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

function installTarget(userAgent: string): WalletInstallTarget {
  let href: string = READY_INSTALL.other;
  if (/android/i.test(userAgent)) href = READY_INSTALL.android;
  else if (/iphone|ipad|ipod/i.test(userAgent)) href = READY_INSTALL.ios;
  else if (/firefox|fxios/i.test(userAgent)) href = READY_INSTALL.firefox;
  else if (/chrome|chromium|crios|edg\//i.test(userAgent)) {
    href = READY_INSTALL.chrome;
  }
  return { href, label: "Install Ready" };
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
    throw new WalletUnavailableError(
      installTarget(options.userAgent ?? browserUserAgent()),
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
