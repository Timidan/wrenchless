/**
 * Presentation-side wallet plumbing, and nothing more.
 *
 * This module finds the injected provider and asks it for permission. It does
 * not decide whether the wallet is capable: every operation in `src/lib` checks
 * the chain and the Wallet API version itself and refuses if either is wrong,
 * so a second opinion here could only ever disagree with the module that is
 * actually about to sign something.
 */

export type BrowserWallet = {
  enable(options?: { starknetVersion?: "v5" }): Promise<string[]>;
  isConnected?: boolean;
  request<T>(input: { params?: unknown; type: string }): Promise<T>;
  selectedAddress?: string;
};

declare global {
  interface Window {
    starknet_argentX?: BrowserWallet;
  }
}

export function injectedWallet(): BrowserWallet | null {
  return window.starknet_argentX ?? null;
}

export function alreadyAuthorized(): BrowserWallet | null {
  const wallet = injectedWallet();
  if (wallet?.isConnected === true && wallet.selectedAddress) return wallet;
  return null;
}

/** Refuse an operation if Ready was switched after this role was opened. */
export function assertSelectedWalletAccount(
  wallet: Pick<BrowserWallet, "selectedAddress">,
  expectedAccount: string,
): void {
  const selected = wallet.selectedAddress;
  if (selected === undefined) {
    throw new Error("Ready Wallet has no selected account. Reconnect and try again.");
  }
  try {
    if (BigInt(selected) === BigInt(expectedAccount)) return;
  } catch {
    throw new Error("Ready Wallet returned an invalid account. Reconnect and try again.");
  }
  throw new Error(
    "The selected Ready Wallet account changed. Switch back to this wallet's account and try again.",
  );
}

/**
 * Returns the provider only once it has an account selected. A provider that
 * resolved `enable` but exposes no address is not connected, whatever it says.
 */
export async function requestWalletAccount(): Promise<{
  wallet: BrowserWallet;
  account: string;
}> {
  const wallet = injectedWallet();
  if (wallet === null) {
    throw new Error(
      "Ready Wallet was not found in this browser. Install or enable Ready Wallet, then reload this page.",
    );
  }
  const accounts = await wallet.enable({ starknetVersion: "v5" });
  const account = wallet.selectedAddress ?? accounts[0];
  if (account === undefined) {
    throw new Error("The wallet returned no account. Select one and try again.");
  }
  return { wallet, account };
}
