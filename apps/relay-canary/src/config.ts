import { z } from "zod";

import type { JsonValue } from "@wrenchless/canary-core";

export const MAINNET_POOL_ADDRESS =
  "0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a";
export const STRK_TOKEN_ADDRESS =
  "0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d";
export const MAINNET_REFILL_HELPER_ADDRESS =
  "0x026ce951b858934b1ad832be2f93a102b9bf42deb5b824204278ed72b45fa828";
export const MAINNET_REFILL_HELPER_CLASS_HASH =
  "0x002b9104960ea863f78027933eba57370c7c13b88a3e67f828a5c989afb862f9";
export const MAX_POOL_FEE_FRI = 12_000_000_000_000_000_000n;
export const MAX_TRANSACTION_FEE_FRI = 10_000_000_000_000_000_000n;

const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const feltSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/, "expected a lowercase 0x-prefixed hexadecimal felt")
  .refine((value) => BigInt(value) < STARK_FIELD_PRIME, "felt exceeds the Stark field");
const relayAddressSchema = feltSchema.refine(
  (value) => BigInt(value) !== 0n,
  "relay address must be non-zero",
);
const relayPrivateKeySchema = feltSchema.refine(
  (value) => BigInt(value) !== 0n,
  "relay private key must be non-zero",
);

const rpcUrlSchema = z
  .url()
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  }, "STARKNET_RPC_URL must use http or https")
  .refine((value) => {
    const url = new URL(value);
    return url.username === "" && url.password === "";
  }, "STARKNET_RPC_URL must not contain embedded credentials");

export type RelayCanaryConfig = {
  artifactPath: string;
  rpcUrl: string;
  relayAddress: string;
  relayPrivateKey?: string;
  broadcast: boolean;
  poolAddress: string;
  strkAddress: string;
  maxPoolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
};

type ConfigInput = {
  argv: readonly string[];
  env: Readonly<Record<string, string | undefined>>;
};

type ParsedArguments = {
  artifactPath: string;
  broadcastRequested: boolean;
};

function parseArguments(argv: readonly string[]): ParsedArguments {
  let artifactPath: string | undefined;
  let broadcastRequested = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifact") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error("--artifact requires a file path");
      }
      if (artifactPath !== undefined) {
        throw new Error("--artifact may be provided only once");
      }
      artifactPath = value;
      index += 1;
      continue;
    }
    if (argument === "--broadcast") {
      if (broadcastRequested) {
        throw new Error("--broadcast may be provided only once");
      }
      broadcastRequested = true;
      continue;
    }
    throw new Error(`unknown argument: ${argument}`);
  }

  if (artifactPath === undefined || artifactPath.trim() === "") {
    throw new Error("--artifact is required");
  }

  return { artifactPath, broadcastRequested };
}

export function parseRelayCanaryConfig(input: ConfigInput): RelayCanaryConfig {
  const { artifactPath, broadcastRequested } = parseArguments(input.argv);
  const rawRpcUrl = input.env.STARKNET_RPC_URL;
  if (rawRpcUrl === undefined || rawRpcUrl === "") {
    throw new Error("STARKNET_RPC_URL is required");
  }
  const rpcUrl = rpcUrlSchema.parse(rawRpcUrl);

  const rawRelayAddress = input.env.WRENCHLESS_RELAY_ADDRESS;
  if (rawRelayAddress === undefined || rawRelayAddress === "") {
    throw new Error("WRENCHLESS_RELAY_ADDRESS is required");
  }
  const relayAddress = relayAddressSchema.parse(rawRelayAddress);

  const environmentAllowsBroadcast =
    input.env.WRENCHLESS_ALLOW_MAINNET_BROADCAST === "true";
  if (broadcastRequested && !environmentAllowsBroadcast) {
    throw new Error(
      "--broadcast requires WRENCHLESS_ALLOW_MAINNET_BROADCAST=true",
    );
  }

  let relayPrivateKey: string | undefined;
  if (broadcastRequested) {
    const rawRelayPrivateKey = input.env.WRENCHLESS_RELAY_PRIVATE_KEY;
    if (rawRelayPrivateKey === undefined || rawRelayPrivateKey === "") {
      throw new Error("WRENCHLESS_RELAY_PRIVATE_KEY is required for broadcast");
    }
    relayPrivateKey = relayPrivateKeySchema.parse(rawRelayPrivateKey);
  }

  const config: RelayCanaryConfig = {
    artifactPath,
    rpcUrl,
    relayAddress,
    broadcast: broadcastRequested && environmentAllowsBroadcast,
    poolAddress: MAINNET_POOL_ADDRESS,
    strkAddress: STRK_TOKEN_ADDRESS,
    maxPoolFeeFri: MAX_POOL_FEE_FRI,
    maxTransactionFeeFri: MAX_TRANSACTION_FEE_FRI,
  };
  if (relayPrivateKey !== undefined) {
    config.relayPrivateKey = relayPrivateKey;
  }
  return config;
}

const sensitiveKey =
  /(private.?key|mnemonic|passphrase|secret|rpc.?url|authorization|token|proof)/i;
const jsonObjectSchema = z.record(z.string(), z.json());

export function redactSensitive(value: JsonValue): JsonValue {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }
  const objectResult = jsonObjectSchema.safeParse(value);
  if (objectResult.success) {
    return Object.fromEntries(
      Object.entries(objectResult.data).map(([key, entry]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redactSensitive(entry),
      ]),
    );
  }
  return value;
}
