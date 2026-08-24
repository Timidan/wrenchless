import { pathToFileURL } from "node:url";

import { z } from "zod";

import {
  MAINNET_POOL_ADDRESS,
  STRK_TOKEN_ADDRESS,
} from "./config.js";
import { formatCliError } from "./main.js";
import {
  inspectReadyStatus,
  StarknetReadyStatusClient,
} from "./ready-status.js";

const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;
const coverAddressSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/, "expected a lowercase 0x-prefixed cover address")
  .refine((value) => BigInt(value) !== 0n, "cover address must be non-zero")
  .refine(
    (value) => BigInt(value) < STARK_FIELD_PRIME,
    "cover address exceeds the Stark field",
  );
const rpcUrlSchema = z
  .url()
  .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
    message: "STARKNET_RPC_URL must use http or https",
  })
  .refine(
    (value) => {
      const url = new URL(value);
      return url.username === "" && url.password === "";
    },
    { message: "STARKNET_RPC_URL must not contain embedded credentials" },
  );

function parseCoverAddress(argv: readonly string[]): string {
  if (argv.length !== 2 || argv[0] !== "--cover" || argv[1] === undefined) {
    throw new Error("usage: pnpm ready:status --cover 0x...");
  }
  return coverAddressSchema.parse(argv[1]);
}

export async function readyStatusMain(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const coverAddress = parseCoverAddress(argv);
  const rawRpcUrl = env.STARKNET_RPC_URL;
  if (rawRpcUrl === undefined || rawRpcUrl === "") {
    throw new Error("STARKNET_RPC_URL is required");
  }
  const rpcUrl = rpcUrlSchema.parse(rawRpcUrl);
  const result = await inspectReadyStatus({
    client: new StarknetReadyStatusClient(rpcUrl),
    coverAddress,
    poolAddress: MAINNET_POOL_ADDRESS,
    strkAddress: STRK_TOKEN_ADDRESS,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  readyStatusMain().catch((cause: unknown) => {
    process.stderr.write(
      `Ready status failed: ${formatCliError(cause, process.env)}\n`,
    );
    process.exitCode = 1;
  });
}
