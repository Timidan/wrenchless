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

export type WalletUnavailableResolution = {
  href: string;
  kind: "install_extension";
  label: "Install Ready" | "Install Xverse";
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
  discoverWallets?: () => Promise<readonly DiscoverableWallet[]>;
  openMobileUrl?: (url: string) => void;
  userAgent?: string;
};

declare global {
  interface Window {
    starknet?: unknown;
    starknet_argentX?: unknown;
    starknet_braavos?: unknown;
    starknet_xverse?: unknown;
  }
}

const READY_INSTALL = {
  firefox: "https://addons.mozilla.org/en-GB/firefox/addon/argent-x/",
  other:
    "https://help.wallet.ready.co/hc/en-us/articles/28313046540829-What-is-Ready-X",
} as const;

const XVERSE = {
  chrome:
    "https://chromewebstore.google.com/detail/xverse-wallet/idnnbdplmphpflfnlkomgpfbpcgelopg",
  mobile: "https://connect.xverse.app/browser",
} as const;

const STARKNET_WALLET_API = "starknet:walletApi";
const PRIVATE_WALLET_API_VERSION = "0.10.3";

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
  if (/chrome|chromium|crios|edg\//i.test(userAgent)) {
    return {
      href: XVERSE.chrome,
      kind: "install_extension",
      label: "Install Xverse",
    };
  }
  let href: string = READY_INSTALL.other;
  if (/firefox/i.test(userAgent)) href = READY_INSTALL.firefox;
  return { href, kind: "install_extension", label: "Install Ready" };
}

function mobileBrowser(userAgent: string): boolean {
  return /android|iphone|ipad|ipod|mobile/i.test(userAgent);
}

function applicationPageUrl(): string {
  const parsed = z
    .object({ location: z.object({ href: z.string().url() }) })
    .safeParse(globalThis.window);
  if (parsed.success) return parsed.data.location.href;
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (configured) return new URL(configured).toString();
  throw new Error("Wrenchless public URL is not configured");
}

function openMobileUrl(url: string): void {
  globalThis.location.assign(url);
}

function xverseMobileUrl(pageUrl: string): string {
  const url = new URL(XVERSE.mobile);
  url.searchParams.set("url", pageUrl);
  return url.toString();
}

function readyCandidate(
  wallets: readonly DiscoverableWallet[],
): DiscoverableWallet | undefined {
  return wallets.find((wallet) => {
    const identity = `${wallet.id} ${wallet.name}`.toLowerCase();
    return identity.includes("ready") || identity.includes("argent");
  });
}

function versionParts(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  if (match === null) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function versionAtLeast(version: string, minimum: string): boolean {
  const candidate = versionParts(version);
  const required = versionParts(minimum);
  if (candidate === null || required === null) return false;
  for (let index = 0; index < candidate.length; index += 1) {
    const left = candidate[index] ?? 0;
    const right = required[index] ?? 0;
    if (left > right) return true;
    if (left < right) return false;
  }
  return true;
}

async function supportsPrivateWalletApi(
  wallet: DiscoverableWallet,
): Promise<boolean> {
  try {
    const response = await wallet.request({ type: "wallet_supportedWalletApi" });
    const versions = z.array(z.string()).parse(response);
    return versions.some((version) =>
      versionAtLeast(version, PRIVATE_WALLET_API_VERSION),
    );
  } catch {
    return false;
  }
}

async function privateWallets(
  wallets: readonly DiscoverableWallet[],
): Promise<DiscoverableWallet[]> {
  const support = await Promise.all(wallets.map(supportsPrivateWalletApi));
  return wallets.filter((_, index) => support[index] === true);
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
    { key: "starknet_xverse", value: globalThis.window.starknet_xverse },
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
        (key === "starknet_argentX"
          ? "Ready Wallet"
          : key === "starknet_xverse"
            ? "Xverse"
            : fallbackId),
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
 * Discover and connect a privacy-capable Starknet wallet. Capability comes
 * from the Wallet API version query, never from a wallet name or balance read.
 */
export async function requestWalletAccount(
  options: RequestWalletAccountOptions = {},
): Promise<{ wallet: BrowserWallet; account: string }> {
  const discoverWallets =
    options.discoverWallets ?? (async () => availableWallets());
  const discovered = uniqueWallets([
    ...(await discoverWallets()),
    ...injectedWallets(),
  ]);
  const userAgent = options.userAgent ?? browserUserAgent();
  if (discovered.length === 0) {
    if (mobileBrowser(userAgent)) {
      if (/xverse/i.test(userAgent)) {
        throw new Error("Xverse did not expose private Starknet actions");
      }
      (options.openMobileUrl ?? openMobileUrl)(
        xverseMobileUrl(applicationPageUrl()),
      );
      throw new Error("Continue in Xverse");
    }
    throw new WalletUnavailableError(
      unavailableResolution(userAgent),
    );
  }

  const compatible = await privateWallets(discovered);
  const wallet = readyCandidate(compatible) ?? compatible[0];
  if (wallet === undefined) {
    const names = discovered.map((candidate) => candidate.name).join(", ");
    throw new Error(
      `${names || "This wallet"} does not support private Starknet actions`,
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
