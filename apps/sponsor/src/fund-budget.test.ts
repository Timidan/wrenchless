import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FundBudgetExceededError, FundSpendBudget } from "./fund-budget.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("FundSpendBudget", () => {
  it("persists conservative reservations and refuses spend above the daily cap", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wrenchless-fund-budget-"));
    directories.push(directory);
    const path = join(directory, "ledger.json");
    const now = () => new Date("2026-08-24T10:00:00.000Z");

    await new FundSpendBudget(path, 10n, now).reserve(6n);

    const restarted = new FundSpendBudget(path, 10n, now);
    expect(await restarted.remainingFri()).toBe(4n);
    await expect(restarted.reserve(5n)).rejects.toBeInstanceOf(
      FundBudgetExceededError,
    );
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      day: "2026-08-24",
      reservedFri: "6",
    });
  });
});
