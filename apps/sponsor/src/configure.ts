import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import { assertSponsorNodeVersion } from "./config.js";
import { sponsorEnvironmentPath } from "./environment.js";

const OPERATOR_KEYSTORE = join(
  homedir(),
  ".config",
  "wrenchless",
  "operator-keystore.json",
);

assertSponsorNodeVersion();
const target = sponsorEnvironmentPath();
if (existsSync(target)) {
  throw new Error(`refusing to overwrite the existing sponsor environment at ${target}`);
}
const privateKeyResult = spawnSync(
  "starkli",
  ["signer", "keystore", "inspect-private", "--raw", OPERATOR_KEYSTORE],
  {
    encoding: "utf8",
    stdio: ["inherit", "pipe", "inherit"],
  },
);
if (privateKeyResult.status !== 0) {
  throw new Error("could not unlock the operator keystore");
}
const accountPrivateKey = privateKeyResult.stdout.trim();
if (!/^0x[0-9a-f]+$/.test(accountPrivateKey)) {
  throw new Error("starkli returned an invalid operator private key");
}

mkdirSync(dirname(target), { mode: 0o700, recursive: true });
const content = [
  "NODE_ENV=development",
  "WRENCHLESS_SPONSOR_BIND_HOST=127.0.0.1",
  "PORT=8788",
  "WRENCHLESS_SPONSOR_ORIGIN=http://localhost:5174",
  "WRENCHLESS_SPONSOR_RPC_URL=https://rpc.starknet.lava.build",
  "WRENCHLESS_SPONSOR_POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a",
  "WRENCHLESS_SPONSOR_HELPER_ADDRESS=0x018f6925422c85da8c9e0c1572adf4316a9821ffabc4b29db37d11c6a0c2844a",
  "WRENCHLESS_SPONSOR_TOKEN_ADDRESS=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d",
  "WRENCHLESS_SPONSOR_V3_HELPER_ADDRESS=",
  'WRENCHLESS_SPONSOR_TOKEN_POLICIES_JSON=[{"address":"0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d","symbol":"STRK","decimals":18,"minAmountBaseUnits":"1000000000000000000","maxAmountBaseUnits":"1000000000000000000000"},{"address":"0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8","symbol":"USDC","decimals":6,"minAmountBaseUnits":"1000000","maxAmountBaseUnits":"1000000000"}]',
  "WRENCHLESS_SPONSOR_ACCOUNT_ADDRESS=0x01c7f9e5477834ae4ecc6dd16f82200ca02d2f85cec27bfae0eeb371dd41ab1d",
  `WRENCHLESS_SPONSOR_ACCOUNT_PRIVATE_KEY=${accountPrivateKey}`,
  "WRENCHLESS_SPONSOR_MAX_POOL_FEE_FRI=6000000000000000000",
  "WRENCHLESS_SPONSOR_MAX_TRANSACTION_FEE_FRI=1000000000000000000",
  "WRENCHLESS_SPONSOR_MAX_DAILY_FUND_SPEND_FRI=1000000000000000000000",
  "WRENCHLESS_SPONSOR_MIN_FUND_AMOUNT_FRI=1000000000000000000",
  "WRENCHLESS_SPONSOR_MIN_FUND_DURATION_SECONDS=7200",
  "WRENCHLESS_SPONSOR_MAX_FUND_DURATION_SECONDS=7776000",
  `WRENCHLESS_RECOVERY_INDEX_KEY=${randomBytes(32).toString("hex")}`,
  "WRENCHLESS_RECOVERY_INDEX_PATH=./.data/recovery-index.json",
  "WRENCHLESS_RECOVERY_INDEX_KEY_PATH=./.data/recovery-index.key",
  "WRENCHLESS_ALLOW_REFILL_FUND_BROADCAST=false",
  "WRENCHLESS_ALLOW_TRAVEL_SAFE_V3_BROADCAST=false",
  "WRENCHLESS_TRUST_PROXY=false",
  "",
].join("\n");
writeFileSync(target, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
process.stdout.write(`Protected sponsor environment created at ${target}\n`);
