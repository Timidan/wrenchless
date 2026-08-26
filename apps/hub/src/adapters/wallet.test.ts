import { afterEach, describe, expect, it, vi } from "vitest";

import {
  requestWalletAccount,
  type DiscoverableWallet,
} from "./wallet";

function candidate(
  id: string,
  name: string,
  account: string,
): DiscoverableWallet {
  return {
    id,
    name,
    async request<T>(input: { type: string }): Promise<T> {
      if (input.type !== "wallet_requestAccounts") {
        throw new Error(`Unexpected request: ${input.type}`);
      }
      // SAFETY: this fake implements only wallet_requestAccounts, whose result is string[].
      return [account] as T;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("requestWalletAccount", () => {
  it.each([
    ["Android", "Mozilla/5.0 (Linux; Android 15)"],
    ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"],
  ])("does not send %s users into an install-retry loop", async (
    _platform,
    userAgent,
  ) => {
    vi.stubGlobal("window", {});

    await expect(
      requestWalletAccount({ discoverWallets: async () => [], userAgent }),
    ).rejects.toMatchObject({
      resolution: { kind: "desktop_required" },
    });
  });

  it("offers the Ready extension when a desktop browser has no wallet", async () => {
    vi.stubGlobal("window", {});

    await expect(
      requestWalletAccount({
        discoverWallets: async () => [],
        userAgent: "Mozilla/5.0 Chrome/140.0.0.0 Safari/537.36",
      }),
    ).rejects.toMatchObject({
      resolution: {
        href:
          "https://chromewebstore.google.com/detail/argent-x/dlcobpjiigpikoobohmabehhmhfoodbb",
        kind: "install_extension",
        label: "Install Ready",
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

  it("keeps a Ready extension whose request method lives on its prototype", async () => {
    class InjectedReady {
      readonly id = "argentX";
      readonly name = "Ready Wallet";
      readonly selectedAddress = "0x333";

      async request<T>(input: { type: string }): Promise<T> {
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
