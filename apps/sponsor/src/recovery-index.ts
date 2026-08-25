import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import {
  computeRecoveryLookupHash,
} from "@wrenchless/canary-core";
import { constants, RpcProvider, shortString } from "starknet";
import { z } from "zod";

const CHALLENGE_LIFETIME_SECONDS = 5 * 60;
const RPC_TIMEOUT_MILLISECONDS = 30_000;
const VALID_SIGNATURE = shortString.encodeShortString("VALID");

const boundedRpcFetch: typeof fetch = (input, init = {}) =>
  fetch(input, {
    ...init,
    signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
  });

const canonicalFeltSchema = z
  .string()
  .regex(/^0x[0-9a-f]+$/i)
  .refine((value) => BigInt(value) < constants.PRIME);
const nonZeroFeltSchema = canonicalFeltSchema.refine(
  (value) => BigInt(value) !== 0n,
);
const locatorSchema = z
  .object({
    stateId: nonZeroFeltSchema,
    recoverySalt: nonZeroFeltSchema,
  })
  .strict();
const indexSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.recovery-index.v1"),
    records: z.record(
      z.string().regex(/^[0-9a-f]{64}$/),
      z.string().regex(/^[0-9a-f]{24}\.[0-9a-f]+\.[0-9a-f]{32}$/),
    ),
  })
  .strict();
const challengePayloadSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.recovery-challenge.v1"),
    account: nonZeroFeltSchema,
    challenge: nonZeroFeltSchema,
    expiresAt: z.string().regex(/^[1-9][0-9]*$/),
  })
  .strict();

export type RecoveryLocator = z.infer<typeof locatorSchema>;
export type RecoveryChallenge = {
  token: string;
  challenge: string;
  expiresAt: string;
};

export class RecoveryLookupDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryLookupDeniedError";
  }
}

export async function readOrCreateRecoveryIndexKey(input: {
  configuredKey: string | undefined;
  keyPath: string;
  production: boolean;
}): Promise<string> {
  if (input.configuredKey !== undefined) return input.configuredKey;
  if (input.production) {
    throw new Error("WRENCHLESS_RECOVERY_INDEX_KEY is required in production");
  }
  try {
    const stored = (await readFile(input.keyPath, "utf8")).trim();
    if (!/^[0-9a-f]{64}$/.test(stored)) {
      throw new Error("stored recovery index key is invalid");
    }
    return stored;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
  await mkdir(dirname(input.keyPath), { mode: 0o700, recursive: true });
  const generated = randomBytes(32).toString("hex");
  try {
    await writeFile(input.keyPath, `${generated}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return generated;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
      throw error;
    }
    const stored = (await readFile(input.keyPath, "utf8")).trim();
    if (!/^[0-9a-f]{64}$/.test(stored)) {
      throw new Error("stored recovery index key is invalid");
    }
    return stored;
  }
}

function canonicalFelt(value: string, label: string): string {
  const parsed = nonZeroFeltSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} is not a non-zero felt`);
  return `0x${BigInt(parsed.data).toString(16)}`;
}

function canonicalFieldElement(value: string, label: string): string {
  const parsed = canonicalFeltSchema.safeParse(value);
  if (!parsed.success) throw new Error(`${label} is not a felt`);
  return `0x${BigInt(parsed.data).toString(16)}`;
}

function deriveKey(masterKey: Buffer, purpose: string): Buffer {
  return createHmac("sha256", masterKey)
    .update(`WRENCHLESS_RECOVERY_INDEX_V1:${purpose}`)
    .digest();
}

function accountTag(tagKey: Buffer, account: string): string {
  return createHmac("sha256", tagKey).update(account).digest("hex");
}

async function readIndex(path: string) {
  try {
    return indexSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {
        schemaVersion: "wrenchless.recovery-index.v1" as const,
        records: {},
      };
    }
    throw new Error("recovery index could not be opened", { cause: error });
  }
}

async function writeIndex(
  path: string,
  value: z.infer<typeof indexSchema>,
): Promise<void> {
  await mkdir(dirname(path), { mode: 0o700, recursive: true });
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify(value), {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export class RecoveryIndex {
  private readonly encryptionKey: Buffer;
  private readonly tagKey: Buffer;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    masterKeyHex: string,
  ) {
    if (!/^[0-9a-f]{64}$/.test(masterKeyHex)) {
      throw new Error("recovery index key must contain 32 lowercase hex bytes");
    }
    const masterKey = Buffer.from(masterKeyHex, "hex");
    this.encryptionKey = deriveKey(masterKey, "encryption");
    this.tagKey = deriveKey(masterKey, "account-tag");
  }

  put(accountValue: string, locatorValue: RecoveryLocator): Promise<void> {
    const account = canonicalFelt(accountValue, "recovery account");
    const locator = locatorSchema.parse(locatorValue);
    const operation = this.queue.then(async () => {
      const index = await readIndex(this.path);
      const tag = accountTag(this.tagKey, account);
      const iv = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
      cipher.setAAD(Buffer.from(tag, "hex"));
      const ciphertext = Buffer.concat([
        cipher.update(JSON.stringify(locator), "utf8"),
        cipher.final(),
      ]);
      index.records[tag] = [
        iv.toString("hex"),
        ciphertext.toString("hex"),
        cipher.getAuthTag().toString("hex"),
      ].join(".");
      await writeIndex(this.path, index);
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }

  async get(accountValue: string): Promise<RecoveryLocator | null> {
    const account = canonicalFelt(accountValue, "recovery account");
    await this.queue;
    const index = await readIndex(this.path);
    const tag = accountTag(this.tagKey, account);
    const sealed = index.records[tag];
    if (sealed === undefined) return null;
    const [ivHex, ciphertextHex, authTagHex] = sealed.split(".");
    if (
      ivHex === undefined ||
      ciphertextHex === undefined ||
      authTagHex === undefined
    ) {
      throw new Error("recovery index record is invalid");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.encryptionKey,
        Buffer.from(ivHex, "hex"),
      );
      decipher.setAAD(Buffer.from(tag, "hex"));
      decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextHex, "hex")),
        decipher.final(),
      ]).toString("utf8");
      return locatorSchema.parse(JSON.parse(plaintext));
    } catch (error) {
      throw new Error("recovery index record could not be decrypted", {
        cause: error,
      });
    }
  }
}

export class ReadyAccountSignatureVerifier {
  private readonly provider: RpcProvider;

  constructor(rpcUrl: string) {
    this.provider = new RpcProvider({
      nodeUrl: rpcUrl,
      baseFetch: boundedRpcFetch,
    });
  }

  async verify(
    accountValue: string,
    hashValue: string,
    signatureValues: readonly string[],
  ): Promise<boolean> {
    const account = canonicalFelt(accountValue, "recovery account");
    const messageHash = canonicalFelt(hashValue, "Ready message hash");
    if (signatureValues.length === 0 || signatureValues.length > 64) {
      return false;
    }
    const signature = signatureValues.map((value) =>
      canonicalFieldElement(value, "Ready signature felt"),
    );
    const result = await this.provider.callContract(
      {
        contractAddress: account,
        entrypoint: "is_valid_signature",
        calldata: [
          messageHash,
          `0x${signature.length.toString(16)}`,
          ...signature,
        ],
      },
      "latest",
    );
    return result.length === 1 && BigInt(result[0] ?? 0) === BigInt(VALID_SIGNATURE);
  }
}

export class RecoveryLookupService {
  private readonly challengeKey: Buffer;

  constructor(
    private readonly index: RecoveryIndex,
    masterKeyHex: string,
    private readonly signatureVerifier: ReadyAccountSignatureVerifier,
  ) {
    const masterKey = Buffer.from(masterKeyHex, "hex");
    this.challengeKey = deriveKey(masterKey, "challenge");
  }

  createChallenge(accountValue: string, nowSeconds = Math.floor(Date.now() / 1_000)):
    RecoveryChallenge {
    const account = canonicalFelt(accountValue, "recovery account");
    const payload = challengePayloadSchema.parse({
      schemaVersion: "wrenchless.recovery-challenge.v1",
      account,
      challenge: `0x${BigInt(`0x${randomBytes(31).toString("hex")}`).toString(16)}`,
      expiresAt: String(nowSeconds + CHALLENGE_LIFETIME_SECONDS),
    });
    const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
    const signature = createHmac("sha256", this.challengeKey)
      .update(encoded)
      .digest("hex");
    return {
      token: `${encoded}.${signature}`,
      challenge: payload.challenge,
      expiresAt: payload.expiresAt,
    };
  }

  async lookup(input: {
    account: string;
    token: string;
    signature: readonly string[];
    nowSeconds?: number;
  }): Promise<RecoveryLocator | null> {
    const account = canonicalFelt(input.account, "recovery account");
    const [encoded, suppliedSignature, trailing] = input.token.split(".");
    if (
      encoded === undefined ||
      suppliedSignature === undefined ||
      trailing !== undefined ||
      !/^[0-9a-f]{64}$/.test(suppliedSignature)
    ) {
      throw new RecoveryLookupDeniedError("recovery challenge is invalid");
    }
    const expectedSignature = createHmac("sha256", this.challengeKey)
      .update(encoded)
      .digest();
    const supplied = Buffer.from(suppliedSignature, "hex");
    if (
      supplied.length !== expectedSignature.length ||
      !timingSafeEqual(supplied, expectedSignature)
    ) {
      throw new RecoveryLookupDeniedError("recovery challenge is invalid");
    }
    let payload: z.infer<typeof challengePayloadSchema>;
    try {
      payload = challengePayloadSchema.parse(
        JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
      );
    } catch {
      throw new RecoveryLookupDeniedError("recovery challenge is invalid");
    }
    if (BigInt(payload.account) !== BigInt(account)) {
      throw new RecoveryLookupDeniedError(
        "recovery challenge belongs to another account",
      );
    }
    if (BigInt(payload.expiresAt) < BigInt(input.nowSeconds ?? Math.floor(Date.now() / 1_000))) {
      throw new RecoveryLookupDeniedError("recovery challenge expired");
    }
    if (input.signature.length === 0 || input.signature.length > 64) {
      throw new RecoveryLookupDeniedError("Ready signature is invalid");
    }
    const hash = computeRecoveryLookupHash({
      chainId: "SN_MAIN",
      recoveryAccount: account,
      challenge: payload.challenge,
      expiresAt: payload.expiresAt,
    });
    if (!(await this.signatureVerifier.verify(account, hash, input.signature))) {
      throw new RecoveryLookupDeniedError(
        "Ready did not approve this recovery lookup",
      );
    }
    return this.index.get(account);
  }
}
