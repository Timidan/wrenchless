import { describe, expect, it } from "vitest";

import { parseRelayCanaryConfig, redactSensitive } from "./config.js";

const baseEnvironment = {
  STARKNET_RPC_URL: "https://rpc.example.test",
  WRENCHLESS_RELAY_ADDRESS: "0x789",
};

describe("parseRelayCanaryConfig", () => {
  it("requires an RPC URL", () => {
    expect(() =>
      parseRelayCanaryConfig({
        argv: ["--artifact", "artifact.json"],
        env: { WRENCHLESS_RELAY_ADDRESS: "0x789" },
      }),
    ).toThrow("STARKNET_RPC_URL");
  });

  it("requires a relay address", () => {
    expect(() =>
      parseRelayCanaryConfig({
        argv: ["--artifact", "artifact.json"],
        env: { STARKNET_RPC_URL: "https://rpc.example.test" },
      }),
    ).toThrow("WRENCHLESS_RELAY_ADDRESS");
  });

  it("rejects the zero relay address", () => {
    expect(() =>
      parseRelayCanaryConfig({
        argv: ["--artifact", "artifact.json"],
        env: {
          ...baseEnvironment,
          WRENCHLESS_RELAY_ADDRESS: "0x0",
        },
      }),
    ).toThrow("relay address must be non-zero");
  });

  it("does not require a private key for a dry-run", () => {
    const config = parseRelayCanaryConfig({
      argv: ["--artifact", "artifact.json"],
      env: baseEnvironment,
    });

    expect(config.broadcast).toBe(false);
    expect(config.relayPrivateKey).toBeUndefined();
  });

  it("treats the environment opt-in alone as a dry-run", () => {
    const config = parseRelayCanaryConfig({
      argv: ["--artifact", "artifact.json"],
      env: {
        ...baseEnvironment,
        WRENCHLESS_ALLOW_MAINNET_BROADCAST: "true",
      },
    });

    expect(config.broadcast).toBe(false);
  });

  it("rejects --broadcast without the environment opt-in", () => {
    expect(() =>
      parseRelayCanaryConfig({
        argv: ["--artifact", "artifact.json", "--broadcast"],
        env: {
          ...baseEnvironment,
          WRENCHLESS_RELAY_PRIVATE_KEY: "0xabc",
        },
      }),
    ).toThrow("WRENCHLESS_ALLOW_MAINNET_BROADCAST=true");
  });

  it("requires a private key when both broadcast opt-ins are present", () => {
    expect(() =>
      parseRelayCanaryConfig({
        argv: ["--artifact", "artifact.json", "--broadcast"],
        env: {
          ...baseEnvironment,
          WRENCHLESS_ALLOW_MAINNET_BROADCAST: "true",
        },
      }),
    ).toThrow("WRENCHLESS_RELAY_PRIVATE_KEY");
  });

  it("rejects a zero broadcast private key", () => {
    expect(() =>
      parseRelayCanaryConfig({
        argv: ["--artifact", "artifact.json", "--broadcast"],
        env: {
          ...baseEnvironment,
          WRENCHLESS_ALLOW_MAINNET_BROADCAST: "true",
          WRENCHLESS_RELAY_PRIVATE_KEY: "0x0",
        },
      }),
    ).toThrow("relay private key must be non-zero");
  });

  it("enables broadcast only when both opt-ins and the key are present", () => {
    const config = parseRelayCanaryConfig({
      argv: ["--artifact", "artifact.json", "--broadcast"],
      env: {
        ...baseEnvironment,
        WRENCHLESS_ALLOW_MAINNET_BROADCAST: "true",
        WRENCHLESS_RELAY_PRIVATE_KEY: "0xabc",
      },
    });

    expect(config.broadcast).toBe(true);
    expect(config.relayPrivateKey).toBe("0xabc");
  });

  it("rejects credential-bearing RPC URLs", () => {
    expect(() =>
      parseRelayCanaryConfig({
        argv: ["--artifact", "artifact.json"],
        env: {
          ...baseEnvironment,
          STARKNET_RPC_URL: "https://user:secret@rpc.example.test",
        },
      }),
    ).toThrow("must not contain embedded credentials");
  });
});

describe("redactSensitive", () => {
  it("redacts secret-bearing fields recursively", () => {
    expect(
      redactSensitive({
        relayAddress: "0x789",
        relayPrivateKey: "0xabc",
        nested: { mnemonic: "twelve words", rpcUrl: "https://secret" },
      }),
    ).toEqual({
      relayAddress: "0x789",
      relayPrivateKey: "[REDACTED]",
      nested: { mnemonic: "[REDACTED]", rpcUrl: "[REDACTED]" },
    });
  });
});
