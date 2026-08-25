import { z } from "zod";
import { fileURLToPath } from "node:url";

const STARK_FIELD_PRIME = (1n << 251n) + 17n * (1n << 192n) + 1n;

const feltSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/, "expected a lowercase 0x-prefixed hexadecimal felt")
  .refine(
    (value) => BigInt(value) > 0n && BigInt(value) < STARK_FIELD_PRIME,
    "felt must be non-zero and inside the Stark field",
  );

const positiveDecimalSchema = z
  .string()
  .regex(/^[1-9][0-9]*$/, "expected a positive canonical decimal integer");

const secretKeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected 32 bytes of lowercase hexadecimal");

const sponsorEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  WRENCHLESS_SPONSOR_BIND_HOST: z.string().trim().min(1).default("127.0.0.1"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8788),
  WRENCHLESS_SPONSOR_ORIGIN: z.url(),
  WRENCHLESS_SPONSOR_RPC_URL: z.url(),
  WRENCHLESS_SPONSOR_POOL_ADDRESS: feltSchema,
  WRENCHLESS_SPONSOR_HELPER_ADDRESS: feltSchema,
  WRENCHLESS_SPONSOR_TOKEN_ADDRESS: feltSchema,
  WRENCHLESS_SPONSOR_ACCOUNT_ADDRESS: feltSchema,
  WRENCHLESS_SPONSOR_ACCOUNT_PRIVATE_KEY: feltSchema,
  WRENCHLESS_SPONSOR_MAX_POOL_FEE_FRI: positiveDecimalSchema,
  WRENCHLESS_SPONSOR_MAX_TRANSACTION_FEE_FRI: positiveDecimalSchema.default(
    "10000000000000000000",
  ),
  WRENCHLESS_SPONSOR_MAX_DAILY_FUND_SPEND_FRI: positiveDecimalSchema.default(
    "21000000000000000000",
  ),
  WRENCHLESS_SPONSOR_MIN_FUND_AMOUNT_FRI: positiveDecimalSchema.default(
    "1000000000000000000",
  ),
  WRENCHLESS_SPONSOR_MIN_FUND_DURATION_SECONDS: positiveDecimalSchema.default(
    "7200",
  ),
  WRENCHLESS_SPONSOR_MAX_FUND_DURATION_SECONDS: positiveDecimalSchema.default(
    "7776000",
  ),
  WRENCHLESS_SPONSOR_FUND_BUDGET_PATH: z.string().trim().min(1).default(
    fileURLToPath(new URL("../.data/fund-budget.json", import.meta.url)),
  ),
  WRENCHLESS_RECOVERY_INDEX_KEY: z
    .union([secretKeySchema, z.literal("").transform(() => undefined)])
    .optional(),
  WRENCHLESS_RECOVERY_INDEX_PATH: z.string().trim().min(1).default(
    fileURLToPath(new URL("../.data/recovery-index.json", import.meta.url)),
  ),
  WRENCHLESS_RECOVERY_INDEX_KEY_PATH: z.string().trim().min(1).default(
    fileURLToPath(new URL("../.data/recovery-index.key", import.meta.url)),
  ),
  WRENCHLESS_ALLOW_REFILL_FUND_BROADCAST: z
    .enum(["true", "false"])
    .default("false"),
  WRENCHLESS_TRUST_PROXY: z.enum(["true", "false"]).default("false"),
});

export type SponsorConfig = {
  production: boolean;
  bindHost: string;
  port: number;
  allowedOrigin: string;
  rpcUrl: string;
  poolAddress: string;
  helperAddress: string;
  tokenAddress: string;
  accountAddress: string;
  accountPrivateKey: string;
  maxPoolFeeFri: bigint;
  maxTransactionFeeFri: bigint;
  maxDailyFundSpendFri: bigint;
  minFundAmountFri: bigint;
  minFundDurationSeconds: bigint;
  maxFundDurationSeconds: bigint;
  fundBudgetPath: string;
  recoveryIndexKey: string | undefined;
  recoveryIndexPath: string;
  recoveryIndexKeyPath: string;
  refillFundBroadcastEnabled: boolean;
  trustProxy: boolean;
};

export function readSponsorConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SponsorConfig {
  const value = sponsorEnvironmentSchema.parse(environment);
  return {
    production: value.NODE_ENV === "production",
    bindHost: value.WRENCHLESS_SPONSOR_BIND_HOST,
    port: value.PORT,
    allowedOrigin: value.WRENCHLESS_SPONSOR_ORIGIN,
    rpcUrl: value.WRENCHLESS_SPONSOR_RPC_URL,
    poolAddress: value.WRENCHLESS_SPONSOR_POOL_ADDRESS,
    helperAddress: value.WRENCHLESS_SPONSOR_HELPER_ADDRESS,
    tokenAddress: value.WRENCHLESS_SPONSOR_TOKEN_ADDRESS,
    accountAddress: value.WRENCHLESS_SPONSOR_ACCOUNT_ADDRESS,
    accountPrivateKey: value.WRENCHLESS_SPONSOR_ACCOUNT_PRIVATE_KEY,
    maxPoolFeeFri: BigInt(value.WRENCHLESS_SPONSOR_MAX_POOL_FEE_FRI),
    maxTransactionFeeFri: BigInt(
      value.WRENCHLESS_SPONSOR_MAX_TRANSACTION_FEE_FRI,
    ),
    maxDailyFundSpendFri: BigInt(
      value.WRENCHLESS_SPONSOR_MAX_DAILY_FUND_SPEND_FRI,
    ),
    minFundAmountFri: BigInt(value.WRENCHLESS_SPONSOR_MIN_FUND_AMOUNT_FRI),
    minFundDurationSeconds: BigInt(
      value.WRENCHLESS_SPONSOR_MIN_FUND_DURATION_SECONDS,
    ),
    maxFundDurationSeconds: BigInt(
      value.WRENCHLESS_SPONSOR_MAX_FUND_DURATION_SECONDS,
    ),
    fundBudgetPath: value.WRENCHLESS_SPONSOR_FUND_BUDGET_PATH,
    recoveryIndexKey: value.WRENCHLESS_RECOVERY_INDEX_KEY,
    recoveryIndexPath: value.WRENCHLESS_RECOVERY_INDEX_PATH,
    recoveryIndexKeyPath: value.WRENCHLESS_RECOVERY_INDEX_KEY_PATH,
    refillFundBroadcastEnabled:
      value.WRENCHLESS_ALLOW_REFILL_FUND_BROADCAST === "true",
    trustProxy: value.WRENCHLESS_TRUST_PROXY === "true",
  };
}

export function assertSponsorNodeVersion(version = process.versions.node): void {
  const major = Number.parseInt(version.split(".", 1)[0] ?? "", 10);
  if (!Number.isSafeInteger(major) || major < 22) {
    throw new Error("the Wrenchless sponsor requires Node.js 22 or newer");
  }
}
