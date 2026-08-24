import { refillFundUnavailableReason } from "./availability.js";
import { assertSponsorNodeVersion, readSponsorConfig } from "./config.js";
import { loadSponsorEnvironment } from "./environment.js";
import { createSponsorServer } from "./server.js";
import { RefillFundRelay } from "./fund-relay.js";
import { inspectFundSponsorReadiness } from "./fund-readiness.js";

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
const fundRelay = new RefillFundRelay(config);
const server = createSponsorServer(fundRelay, {
  allowedOrigin: config.allowedOrigin,
  fundUnavailableReason: liveFundUnavailableReason,
  requireHttps: config.production,
  trustProxy: config.trustProxy,
});

server.listen(config.port, "127.0.0.1", () => {
  process.stdout.write(
    initialFundUnavailableReason === undefined
      ? `Wrenchless sponsor ready on 127.0.0.1:${config.port}\n`
      : `Wrenchless sponsor degraded on 127.0.0.1:${config.port}: ${initialFundUnavailableReason}\n`,
  );
});

function shutDown(): void {
  server.close(() => {
    process.exitCode = 0;
  });
}

process.once("SIGINT", shutDown);
process.once("SIGTERM", shutDown);
