import { assertSponsorNodeVersion, readSponsorConfig } from "./config.js";
import { refillFundUnavailableReason } from "./availability.js";
import { loadSponsorEnvironment } from "./environment.js";
import { inspectFundSponsorReadiness } from "./fund-readiness.js";

assertSponsorNodeVersion();
loadSponsorEnvironment();
const config = readSponsorConfig();
const readiness = await inspectFundSponsorReadiness(config);
process.stdout.write(`${JSON.stringify(readiness, null, 2)}\n`);

const fundUnavailableReason = refillFundUnavailableReason(readiness, config);
if (fundUnavailableReason !== undefined) {
  process.stderr.write(`Relayed FUND unavailable: ${fundUnavailableReason}\n`);
  process.exitCode = 1;
}
