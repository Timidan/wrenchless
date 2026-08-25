import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { RecoveryIndex } from "./recovery-index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  );
});

describe("minimal encrypted recovery index", () => {
  it("stores one opaque locator per Ready account and survives restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wrenchless-recovery-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "index.json");
    const key = "11".repeat(32);
    const account = "0x128cac";
    const first = { stateId: "0x111", recoverySalt: "0x222" };
    const second = { stateId: "0x333", recoverySalt: "0x444" };

    const index = new RecoveryIndex(path, key);
    await index.put(account, first);
    const stored = await readFile(path, "utf8");
    expect(stored).not.toContain(account.slice(2));
    expect(stored).not.toContain(first.stateId);
    expect(stored).not.toContain(first.recoverySalt);

    await index.put(account, second);
    await expect(new RecoveryIndex(path, key).get(account)).resolves.toEqual(
      second,
    );
  });
});
