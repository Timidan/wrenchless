import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import {
  jsonValueSchema,
  parseJsonText,
  parseRefillFundArtifact,
} from "@wrenchless/canary-core";

import {
  MAINNET_REFILL_HELPER_ADDRESS,
  parseRelayCanaryConfig,
  redactSensitive,
} from "./config.js";
import { formatCliError } from "./main.js";
import { inspectRefillFund } from "./refill-inspect.js";
import { StarknetRegistrationCanaryClient } from "./starknet-client.js";

export async function refillMain(
  argv: readonly string[] = process.argv.slice(2),
  env: Readonly<Record<string, string | undefined>> = process.env,
): Promise<void> {
  const config = parseRelayCanaryConfig({ argv, env });
  const artifactText = await readFile(config.artifactPath, "utf8");
  const artifact = parseRefillFundArtifact(parseJsonText(artifactText));
  const client = new StarknetRegistrationCanaryClient(
    config.rpcUrl,
    config.relayAddress,
  );
  const result = await inspectRefillFund({
    artifact,
    config,
    configuredHelperAddress: MAINNET_REFILL_HELPER_ADDRESS,
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
  refillMain().catch((cause: unknown) => {
    process.stderr.write(
      `refill FUND failed: ${formatCliError(cause, process.env)}\n`,
    );
    process.exitCode = 1;
  });
}
