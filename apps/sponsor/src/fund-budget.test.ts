import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  it("replaces a pending maximum with the confirmed actual spend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wrenchless-fund-budget-"));
    directories.push(directory);
    const path = join(directory, "ledger.json");
    const now = () => new Date("2026-08-24T10:00:00.000Z");

    const budget = new FundSpendBudget(path, 20n, now);
    await budget.reserve("safe-a", 16n);
    expect(await budget.remainingFri()).toBe(4n);

    await budget.settle("safe-a", 7n);

    expect(await budget.remainingFri()).toBe(13n);
    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      schemaVersion: "wrenchless.fund-budget.v2",
      day: "2026-08-24",
      settledFri: "7",
      pending: {},
    });
  });

  it("retains an unresolved maximum across restart and UTC rollover", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wrenchless-fund-budget-"));
    directories.push(directory);
    const path = join(directory, "ledger.json");
    let currentTime = new Date("2026-08-24T23:59:00.000Z");
    const now = () => currentTime;

    await new FundSpendBudget(path, 10n, now).reserve("safe-a", 6n);
    currentTime = new Date("2026-08-25T00:01:00.000Z");

    const restarted = new FundSpendBudget(path, 10n, now);
    expect(await restarted.remainingFri()).toBe(4n);
    await expect(restarted.reserve("safe-b", 5n)).rejects.toBeInstanceOf(
      FundBudgetExceededError,
    );
    await restarted.settle("safe-a", 2n);

    expect(await restarted.remainingFri()).toBe(8n);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      schemaVersion: "wrenchless.fund-budget.v2",
      day: "2026-08-25",
      settledFri: "2",
      pending: {},
    });
  });

  it("charges an uncertain broadcast to the current day without leaving it pending", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wrenchless-fund-budget-"));
    directories.push(directory);
    const path = join(directory, "ledger.json");
    let currentTime = new Date("2026-08-24T10:00:00.000Z");
    const now = () => currentTime;

    const budget = new FundSpendBudget(path, 20n, now);
    await budget.reserve("safe-a", 16n);
    await budget.settleMaximum("safe-a");

    expect(await budget.remainingFri()).toBe(4n);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      day: "2026-08-24",
      settledFri: "16",
      pending: {},
    });

    currentTime = new Date("2026-08-25T00:01:00.000Z");
    expect(await budget.remainingFri()).toBe(20n);
  });

  it("migrates the deployed v1 ledger without releasing its current-day spend", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wrenchless-fund-budget-"));
    directories.push(directory);
    const path = join(directory, "ledger.json");
    const now = () => new Date("2026-08-24T10:00:00.000Z");
    await writeFile(
      path,
      `${JSON.stringify({
        schemaVersion: "wrenchless.fund-budget.v1",
        day: "2026-08-24",
        reservedFri: "6",
      })}\n`,
    );

    const budget = new FundSpendBudget(path, 10n, now);
    expect(await budget.remainingFri()).toBe(4n);
    await budget.reserve("safe-b", 1n);

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
      schemaVersion: "wrenchless.fund-budget.v2",
      day: "2026-08-24",
      settledFri: "6",
      pending: { "safe-b": "1" },
    });
  });
});
