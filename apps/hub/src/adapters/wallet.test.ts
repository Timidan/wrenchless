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
    [
      "Android",
      "Mozilla/5.0 (Linux; Android 15)",
      "https://play.google.com/store/apps/details?id=com.ready.wallet",
    ],
    [
      "iPhone",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
      "https://apps.apple.com/us/app/ready-x/id6744935604",
    ],
  ])("offers the official %s install page when no wallet is available", async (
    _platform,
    userAgent,
    installHref,
  ) => {
    vi.stubGlobal("window", {});

    await expect(
      requestWalletAccount({ discoverWallets: async () => [], userAgent }),
    ).rejects.toMatchObject({
      install: { href: installHref, label: "Install Ready" },
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
