import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestWalletAccount,
  type DiscoverableWallet,
} from "./wallet";

function candidate(
  id: string,
  name: string,
  account: string,
  versions: readonly string[] = ["0.10.3"],
): DiscoverableWallet {
  return {
    id,
    name,
    async request<T>(input: { type: string }): Promise<T> {
      if (input.type === "wallet_supportedWalletApi") {
        // SAFETY: this branch implements the version query, whose result is string[].
        return versions as T;
      }
      if (input.type !== "wallet_requestAccounts") {
        throw new Error(`Unexpected request: ${input.type}`);
      }
      // SAFETY: this fake implements the version and account requests used by the connector.
      return [account] as T;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestWalletAccount", () => {
  it("opens the same page in Xverse when a mobile browser has no provider", async () => {
    vi.stubGlobal("window", {
      location: { href: "https://wrenchless.timidan.xyz/safe?step=fund" },
    });
    const opened: string[] = [];

    await expect(
      requestWalletAccount({
        discoverWallets: async () => [],
        openMobileUrl: (url: string) => opened.push(url),
        userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile",
      }),
    ).rejects.toThrow("Continue in Xverse");
    expect(opened).toEqual([
      "https://connect.xverse.app/browser?url=https%3A%2F%2Fwrenchless.timidan.xyz%2Fsafe%3Fstep%3Dfund",
    ]);
  });

  it("offers Xverse when a desktop Chromium browser has no wallet", async () => {
    vi.stubGlobal("window", {});

    await expect(
      requestWalletAccount({
        discoverWallets: async () => [],
        userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
      }),
    ).rejects.toMatchObject({
      resolution: {
        href:
          "https://chromewebstore.google.com/detail/xverse-wallet/idnnbdplmphpflfnlkomgpfbpcgelopg",
        kind: "install_extension",
        label: "Install Xverse",
      },
    });
  });

  it("prefers Ready when another injected wallet is also available", async () => {
    vi.stubGlobal("window", {});
    const other = candidate("other", "Another wallet", "0x111");
    const ready = candidate("argentX", "Ready Wallet", "0x222");

    await expect(
      requestWalletAccount({
        discoverWallets: async () => [other, ready],
        userAgent: "Mozilla/5.0",
      }),
    ).resolves.toMatchObject({ account: "0x222" });
  });

  it("selects a compatible wallet instead of probing private balances", async () => {
    vi.stubGlobal("window", {});
    const calls: string[] = [];
    const unsupported = candidate("argentX", "Ready X", "0x111", ["0.10.2"]);
    const xverse = candidate("xverse", "Xverse", "0x222");
    const tracked: DiscoverableWallet = {
      ...xverse,
      async request<T>(input: { type: string }): Promise<T> {
        calls.push(input.type);
        return xverse.request<T>(input);
      },
    };

    await expect(
      requestWalletAccount({
        discoverWallets: async () => [unsupported, tracked],
        userAgent: "Mozilla/5.0 Mobile",
      }),
    ).resolves.toMatchObject({ account: "0x222" });
    expect(calls).toEqual([
      "wallet_supportedWalletApi",
      "wallet_requestAccounts",
    ]);
  });

  it("keeps a Ready extension whose request method lives on its prototype", async () => {
    class InjectedReady {
      readonly id = "argentX";
      readonly name = "Ready Wallet";
      readonly selectedAddress = "0x333";

      async request<T>(input: { type: string }): Promise<T> {
        if (input.type === "wallet_supportedWalletApi") {
          // SAFETY: this branch implements the version query, whose result is string[].
          return ["0.10.3"] as T;
        }
        if (input.type !== "wallet_requestAccounts") {
          throw new Error(`Unexpected request: ${input.type}`);
        }
        // SAFETY: this fake implements only wallet_requestAccounts, whose result is string[].
        return [this.selectedAddress] as T;
      }
    }

    vi.stubGlobal("window", { starknet_argentX: new InjectedReady() });

    await expect(
      requestWalletAccount({
        discoverWallets: async () => [],
        userAgent: "Mozilla/5.0",
      }),
    ).resolves.toMatchObject({ account: "0x333" });
  });
});
