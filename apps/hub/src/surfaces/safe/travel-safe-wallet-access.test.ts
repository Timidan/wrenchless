import { describe, expect, it } from "vitest";

import type { BrowserWallet } from "../../adapters/wallet";
import {
  confirmTravelSafeWalletAccess,
  selectTravelSafeDeviceAccess,
} from "./travel-safe-wallet-access";

describe("selectTravelSafeDeviceAccess", () => {
  it("uses wallet confirmation when the browser has no passkeys", () => {
    expect(selectTravelSafeDeviceAccess(false)).toBe("wallet");
  });
});

describe("confirmTravelSafeWalletAccess", () => {
  it("uses a mainnet wallet signature as the device confirmation", async () => {
    const requests: { params?: unknown; type: string }[] = [];
    const wallet: BrowserWallet = {
      selectedAddress: "0x00ab",
      async request<T>(input: { params?: unknown; type: string }): Promise<T> {
        requests.push(input);
        if (input.type === "wallet_requestChainId") {
          // SAFETY: this fake branch implements wallet_requestChainId, whose result is a string.
          return "0x534e5f4d41494e" as T;
        }
        if (input.type === "wallet_signTypedData") {
          // SAFETY: this fake branch implements wallet_signTypedData, whose result is a string array.
          return ["0x1", "0x2"] as T;
        }
        throw new Error(`Unexpected request: ${input.type}`);
      },
    };

    await expect(
      confirmTravelSafeWalletAccess(wallet, "0xab"),
    ).resolves.toBe("0xab");
    expect(requests[0]).toEqual({ type: "wallet_requestChainId" });
    expect(requests[1]).toMatchObject({
      type: "wallet_signTypedData",
      params: {
        api_version: "0.10.3",
        domain: {
          chainId: "0x534e5f4d41494e",
          name: "Wrenchless",
          revision: "1",
          version: "1",
        },
        message: {
          account: "0xab",
          challenge: expect.stringMatching(/^0x[1-9a-f][0-9a-f]*$/),
        },
        primaryType: "TravelSafeAccess",
      },
    });
  });
});
