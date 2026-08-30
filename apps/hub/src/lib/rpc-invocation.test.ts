import { describe, expect, it } from "vitest";

import { readPublicBalances } from "./ready-cover";
import { readReadyPoolRegistration } from "./ready-private-setup";
import { TRAVEL_SAFE_TOKENS } from "./travel-safe-tokens";
import { readTravelSafeV3Snapshot } from "./travel-safe-state-v3";

/**
 * `fetch` refuses to run with the wrong `this`. Reading it off an options
 * object and calling `input.fetcher(...)` hands it that object and the browser
 * answers "Failed to execute 'fetch' on 'Window': Illegal invocation" — the
 * whole read fails before it leaves the page, and no test that supplies its
 * own plain function will ever notice.
 *
 * Node does not enforce the rule, so these reproduce it: in a module, a plain
 * call has `this === undefined` and a method call does not. Every reader that
 * accepts a fetcher is held to the same contract here, because this has now
 * cost two of them.
 */
function callRecorder() {
  let calledAsMethod = false;
  const fetcher: typeof fetch = function record(
    this: typeof globalThis | undefined,
  ): Promise<Response> {
    if (this !== undefined) calledAsMethod = true;
    return Promise.reject(new Error("recorded"));
  };
  return { fetcher, calledAsMethod: () => calledAsMethod };
}

const HELPER = "0x43d60a5bf9cd864d9d5bb1d86d48a3268d32c3a004db64962b03215d3fdb2ed";
const POOL = "0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";

describe("Every chain reader calls fetch as a plain function", () => {
  it("reads a Travel Safe snapshot without binding fetch to its options", async () => {
    const recorder = callRecorder();
    await expect(
      readTravelSafeV3Snapshot({
        helperAddress: HELPER,
        stateId: "0x1",
        rpcUrl: "https://rpc.wrenchless.test",
        fetcher: recorder.fetcher,
      }),
    ).rejects.toThrow();
    expect(recorder.calledAsMethod()).toBe(false);
  });

  it("reads pool registration the same way", async () => {
    const recorder = callRecorder();
    await expect(
      readReadyPoolRegistration({
        account: "0x123",
        poolAddress: POOL,
        rpcUrl: "https://rpc.wrenchless.test",
        fetcher: recorder.fetcher,
      }),
    ).rejects.toThrow();
    expect(recorder.calledAsMethod()).toBe(false);
  });

  it("reads ordinary token balances the same way", async () => {
    const recorder = callRecorder();
    const balances = await readPublicBalances({
      account: "0x123",
      tokens: TRAVEL_SAFE_TOKENS,
      rpcUrl: "https://rpc.wrenchless.test",
      fetcher: recorder.fetcher,
    });
    // This reader reports a failed read rather than throwing, so the contract
    // is checked on the call itself.
    expect(balances.every((entry) => !entry.available)).toBe(true);
    expect(recorder.calledAsMethod()).toBe(false);
  });
});
