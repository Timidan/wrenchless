export type RegistrationActionSummary = {
  coverAddress: string;
  actionKinds: ["WriteOnce", "WriteOnce", "EmitViewingKeySet"];
  screening: "None";
};

const WRITE_ONCE_DISCRIMINANT = 0n;
const EMIT_VIEWING_KEY_SET_DISCRIMINANT = 4n;
const OPTION_NONE_DISCRIMINANT = 1n;

class FeltReader {
  private index = 0;

  constructor(private readonly calldata: readonly string[]) {}

  read(label: string): bigint {
    const value = this.calldata[this.index];
    if (value === undefined) {
      throw new Error(`missing ${label}`);
    }
    if (!/^0x[0-9a-f]+$/.test(value)) {
      throw new Error(`${label} is not a canonical felt`);
    }
    this.index += 1;
    return BigInt(value);
  }

  assertFinished(): void {
    if (this.index !== this.calldata.length) {
      throw new Error("unexpected trailing calldata");
    }
  }
}

function assertEqual(actual: bigint, expected: bigint, message: string): void {
  if (actual !== expected) {
    throw new Error(message);
  }
}

export function assertRegistrationOnly(
  calldata: readonly string[],
  coverAddress: string,
): RegistrationActionSummary {
  const reader = new FeltReader(calldata);

  assertEqual(
    reader.read("server action count"),
    3n,
    "expected exactly three server actions",
  );

  assertEqual(
    reader.read("first action discriminant"),
    WRITE_ONCE_DISCRIMINANT,
    "first action is not WriteOnce",
  );
  reader.read("public-key storage address");
  assertEqual(
    reader.read("public-key value length"),
    1n,
    "public-key WriteOnce must contain one felt",
  );
  const publicKey = reader.read("public-key WriteOnce value");

  assertEqual(
    reader.read("second action discriminant"),
    WRITE_ONCE_DISCRIMINANT,
    "second action is not WriteOnce",
  );
  reader.read("encrypted-key storage address");
  assertEqual(
    reader.read("encrypted-key value length"),
    3n,
    "encrypted-key WriteOnce must contain three felts",
  );
  const encryptedKey = [
    reader.read("auditor public key"),
    reader.read("ephemeral public key"),
    reader.read("encrypted private key"),
  ] as const;

  assertEqual(
    reader.read("third action discriminant"),
    EMIT_VIEWING_KEY_SET_DISCRIMINANT,
    "third action is not EmitViewingKeySet",
  );
  assertEqual(
    reader.read("viewing-key user"),
    BigInt(coverAddress),
    "viewing-key user does not match cover",
  );
  assertEqual(
    reader.read("emitted public key"),
    publicKey,
    "public key does not match WriteOnce value",
  );
  for (const [index, expected] of encryptedKey.entries()) {
    assertEqual(
      reader.read(`emitted encrypted-key felt ${index}`),
      expected,
      "encrypted key does not match WriteOnce value",
    );
  }

  assertEqual(
    reader.read("screening option"),
    OPTION_NONE_DISCRIMINANT,
    "registration screening must be None",
  );
  reader.assertFinished();

  return {
    coverAddress,
    actionKinds: ["WriteOnce", "WriteOnce", "EmitViewingKeySet"],
    screening: "None",
  };
}
