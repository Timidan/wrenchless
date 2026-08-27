import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  MobileConnectInput,
  MobileRequestInput,
  ReadyMobileClient,
} from "./ready-mobile-wallet";
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
  it("connects a mobile browser to Ready with private-action permissions", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://wrenchless.timidan.xyz" },
    });
    const opened: string[] = [];
    let connectInput: MobileConnectInput | undefined;
    const client: ReadyMobileClient = {
      session: { getAll: () => [] },
      async connect(input: MobileConnectInput) {
        connectInput = input;
        return {
          uri: "wc:pairing",
          approval: async () => ({
            topic: "ready-session",
            namespaces: {
              starknet: {
                accounts: ["starknet:SNMAIN:0x123"],
                methods: [
                  "starknet_account",
                  "starknet_signTypedData",
                  "wallet_supportedWalletApi",
                  "wallet_strk20Balances",
                  "wallet_strk20PrepareInvoke",
                  "wallet_strk20InvokeTransaction",
                ],
                events: ["accountsChanged", "chainChanged"],
              },
            },
          }),
        };
      },
      async request(): Promise<never> {
        throw new Error("No request expected");
      },
    };

    await expect(
      requestWalletAccount({
        createMobileClient: async () => client,
        discoverWallets: async () => [],
        openMobileUrl: (url: string) => opened.push(url),
        userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile",
        walletConnectProjectId: "test-project",
      }),
    ).resolves.toMatchObject({ account: "0x123" });
    expect(opened).toEqual([
      "intent://wc?uri=wc%3Apairing#Intent;scheme=ready;package=com.ready.wallet;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.ready.wallet;end",
    ]);
    expect(connectInput).toEqual({
      requiredNamespaces: {
        starknet: {
          chains: ["starknet:SNMAIN"],
          events: ["accountsChanged", "chainChanged"],
          methods: [
            "starknet_account",
            "starknet_signTypedData",
            "wallet_supportedWalletApi",
            "wallet_strk20Balances",
            "wallet_strk20PrepareInvoke",
            "wallet_strk20InvokeTransaction",
          ],
        },
      },
    });
  });

  it("adapts Wrenchless wallet requests to the approved mobile session", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://wrenchless.timidan.xyz" },
    });
    const opened: string[] = [];
    const requestOrder: string[] = [];
    const requests: MobileRequestInput[] = [];
    const client: ReadyMobileClient = {
      session: { getAll: () => [] },
      async connect() {
        return {
          uri: "wc:private",
          approval: async () => ({
            topic: "private-session",
            namespaces: {
              starknet: {
                accounts: ["starknet:SNMAIN:0x456"],
                methods: [
                  "starknet_account",
                  "starknet_signTypedData",
                  "wallet_supportedWalletApi",
                  "wallet_strk20Balances",
                  "wallet_strk20PrepareInvoke",
                  "wallet_strk20InvokeTransaction",
                ],
                events: ["accountsChanged", "chainChanged"],
              },
            },
          }),
        };
      },
      async request(input: MobileRequestInput) {
        requestOrder.push("request");
        requests.push(input);
        if (input.request.method === "starknet_signTypedData") {
          return { signature: ["0x1", "0x2"] };
        }
        return { prepared: true };
      },
    };
    const connected = await requestWalletAccount({
      createMobileClient: async () => client,
      discoverWallets: async () => [],
      openMobileUrl: (url: string) => {
        opened.push(url);
        if (url.startsWith("intent://#Intent;")) requestOrder.push("open");
      },
      userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile",
      walletConnectProjectId: "test-project",
    });

    await expect(
      connected.wallet.request({ type: "wallet_supportedWalletApi" }),
    ).resolves.toEqual(["0.10.3"]);
    await expect(
      connected.wallet.request({
        type: "wallet_strk20PrepareInvoke",
        params: { actions: [{ type: "transfer" }], simulate: false },
      }),
    ).resolves.toEqual({ prepared: true });
    await expect(
      connected.wallet.request({
        type: "wallet_signTypedData",
        params: {
          domain: { name: "Wrenchless" },
          types: { StarknetDomain: [] },
          primaryType: "Recovery",
          message: { state_id: "0x1" },
          api_version: "0.10.3",
        },
      }),
    ).resolves.toEqual(["0x1", "0x2"]);
    expect(opened).toEqual([
      "intent://wc?uri=wc%3Aprivate#Intent;scheme=ready;package=com.ready.wallet;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.ready.wallet;end",
      "intent://#Intent;scheme=ready;package=com.ready.wallet;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.ready.wallet;end",
      "intent://#Intent;scheme=ready;package=com.ready.wallet;S.browser_fallback_url=https%3A%2F%2Fplay.google.com%2Fstore%2Fapps%2Fdetails%3Fid%3Dcom.ready.wallet;end",
    ]);
    expect(requestOrder).toEqual(["request", "open", "request", "open"]);
    expect(requests).toEqual([
      {
        topic: "private-session",
        chainId: "starknet:SNMAIN",
        request: {
          method: "wallet_strk20PrepareInvoke",
          params: { actions: [{ type: "transfer" }], simulate: false },
        },
      },
      {
        topic: "private-session",
        chainId: "starknet:SNMAIN",
        request: {
          method: "starknet_signTypedData",
          params: {
            accountAddress: "0x456",
            typedData: {
              domain: { name: "Wrenchless" },
              types: { StarknetDomain: [] },
              primaryType: "Recovery",
              message: { state_id: "0x1" },
            },
          },
        },
      },
    ]);
  });

  it("reuses an approved mobile session without reconnecting", async () => {
    vi.stubGlobal("window", {
      location: { origin: "https://wrenchless.timidan.xyz" },
    });
    const opened: string[] = [];
    const session = {
      topic: "saved-session",
      namespaces: {
        starknet: {
          accounts: ["starknet:SNMAIN:0x789"],
          methods: [
            "starknet_account",
            "starknet_signTypedData",
            "wallet_supportedWalletApi",
            "wallet_strk20Balances",
            "wallet_strk20PrepareInvoke",
            "wallet_strk20InvokeTransaction",
          ],
          events: ["accountsChanged", "chainChanged"],
        },
      },
    };
    const client: ReadyMobileClient = {
      session: { getAll: () => [session] },
      async connect(): Promise<never> {
        throw new Error("The saved session should be reused");
      },
      async request(): Promise<string[]> {
        return ["0.10.3"];
      },
    };

    const connected = await requestWalletAccount({
      createMobileClient: async () => client,
      discoverWallets: async () => [],
      openMobileUrl: (url: string) => opened.push(url),
      userAgent: "Mozilla/5.0 (Linux; Android 15) Mobile",
      walletConnectProjectId: "test-project",
    });

    expect(connected.account).toBe("0x789");
    expect(opened).toEqual([]);
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
