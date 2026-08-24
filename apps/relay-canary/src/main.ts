import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  jsonValueSchema,
  parseJsonText,
  parseRegistrationArtifact,
} from "@wrenchless/canary-core";

import {
  parseRelayCanaryConfig,
  redactSensitive,
} from "./config.js";
import { inspectRegistrationCanary } from "./inspect.js";
import { StarknetRegistrationCanaryClient } from "./starknet-client.js";

export function formatCliError(
  cause: unknown,
  env: Readonly<Record<string, string | undefined>>,
): string {
  if (!(cause instanceof Error)) {
    return "unknown relay canary failure";
  }

  let message = cause.message;
  for (const key of [
    "WRENCHLESS_RELAY_PRIVATE_KEY",
    "STARKNET_RPC_URL",
  ] as const) {
    const value = env[key];
    if (value !== undefined && value !== "") {
      message = message.replaceAll(value, "[REDACTED]");
    }
  }
  return message.replace(/https?:\/\/\S+/gu, "[URL REDACTED]");
}

export async function main(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const config = parseRelayCanaryConfig({ argv, env });
  const artifactText = await readFile(config.artifactPath, "utf8");
  const artifact = parseRegistrationArtifact(parseJsonText(artifactText));
  const client = new StarknetRegistrationCanaryClient(
    config.rpcUrl,
    config.relayAddress,
  );
  const result = await inspectRegistrationCanary({
    artifact,
    config,
    client,
  });

  const publicResult = redactSensitive(jsonValueSchema.parse(result));
  process.stdout.write(`${JSON.stringify(publicResult, null, 2)}\n`);
}

const entrypoint = process.argv[1];
if (
  entrypoint !== undefined &&
  import.meta.url === pathToFileURL(entrypoint).href
) {
  main().catch((cause: unknown) => {
    process.stderr.write(
      `relay canary failed: ${formatCliError(cause, process.env)}\n`,
    );
    process.exitCode = 1;
  });
}
