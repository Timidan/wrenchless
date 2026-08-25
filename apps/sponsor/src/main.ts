import { refillFundUnavailableReason } from "./availability.js";
import { assertSponsorNodeVersion, readSponsorConfig } from "./config.js";
import { loadSponsorEnvironment } from "./environment.js";
import { createSponsorServer } from "./server.js";
import { RefillFundRelay } from "./fund-relay.js";
import { inspectFundSponsorReadiness } from "./fund-readiness.js";
import {
  readOrCreateRecoveryIndexKey,
  ReadyAccountSignatureVerifier,
  RecoveryIndex,
  RecoveryLookupService,
} from "./recovery-index.js";

assertSponsorNodeVersion();
loadSponsorEnvironment();
const config = readSponsorConfig();
async function liveFundUnavailableReason() {
  try {
    return refillFundUnavailableReason(
      await inspectFundSponsorReadiness(config),
      config,
    );
  } catch {
    return "fund_readiness_unavailable" as const;
  }
}
const initialFundUnavailableReason = await liveFundUnavailableReason();
const recoveryIndexKey = await readOrCreateRecoveryIndexKey({
  configuredKey: config.recoveryIndexKey,
  keyPath: config.recoveryIndexKeyPath,
  production: config.production,
});
const recoveryIndex = new RecoveryIndex(
  config.recoveryIndexPath,
  recoveryIndexKey,
);
const signatureVerifier = new ReadyAccountSignatureVerifier(config.rpcUrl);
const recoveryLookup = new RecoveryLookupService(
  recoveryIndex,
  recoveryIndexKey,
  signatureVerifier,
);
const fundRelay = new RefillFundRelay(
  config,
  recoveryIndex,
  signatureVerifier,
);
const server = createSponsorServer(fundRelay, recoveryLookup, {
  allowedOrigin: config.allowedOrigin,
  fundUnavailableReason: liveFundUnavailableReason,
  requireHttps: config.production,
  trustProxy: config.trustProxy,
});

server.listen(config.port, config.bindHost, () => {
  process.stdout.write(
    initialFundUnavailableReason === undefined
      ? `Wrenchless sponsor ready on ${config.bindHost}:${config.port}\n`
      : `Wrenchless sponsor degraded on ${config.bindHost}:${config.port}: ${initialFundUnavailableReason}\n`,
  );
});

function shutDown(): void {
  server.close(() => {
    process.exitCode = 0;
  });
}

process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);
