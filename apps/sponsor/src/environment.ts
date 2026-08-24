import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadEnvFile } from "node:process";

export function sponsorEnvironmentPath(
  environment: NodeJS.ProcessEnv = process.env,
): string {
  return (
    environment.WRENCHLESS_SPONSOR_ENV ??
    join(homedir(), ".config", "wrenchless", "sponsor.env")
  );
}

export function loadSponsorEnvironment(): string {
  const path = sponsorEnvironmentPath();
  if (!existsSync(path)) {
    throw new Error(
      `sponsor environment does not exist at ${path}; run pnpm sponsor:configure`,
    );
  }
  loadEnvFile(path);
  return path;
}
