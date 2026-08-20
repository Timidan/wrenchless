import { describe, expect, it } from "vitest";

import { formatCliError } from "./main.js";

describe("formatCliError", () => {
  it("redacts configured secrets and RPC URLs from failures", () => {
    const message = formatCliError(
      new Error(
        "request to https://rpc.example.test/path?api_key=secret-key failed for 0xprivate",
      ),
      {
        STARKNET_RPC_URL:
          "https://rpc.example.test/path?api_key=secret-key",
        WRENCHLESS_RELAY_PRIVATE_KEY: "0xprivate",
      },
    );

    expect(message).toBe(
      "request to [REDACTED] failed for [REDACTED]",
    );
    expect(message).not.toContain("secret-key");
    expect(message).not.toContain("0xprivate");
  });

  it("uses a stable message for non-Error failures", () => {
    expect(formatCliError({ sensitive: "object" }, {})).toBe(
      "unknown relay canary failure",
    );
  });
});
