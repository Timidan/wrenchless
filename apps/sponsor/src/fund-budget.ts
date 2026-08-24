import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const ledgerSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.fund-budget.v1"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reservedFri: z.string().regex(/^(?:0|[1-9][0-9]*)$/),
  })
  .strict();

type Ledger = z.infer<typeof ledgerSchema>;

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export class FundBudgetExceededError extends Error {
  constructor() {
    super("daily_fund_budget_exhausted");
    this.name = "FundBudgetExceededError";
  }
}

export class FundSpendBudget {
  constructor(
    private readonly path: string,
    private readonly dailyLimitFri: bigint,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (dailyLimitFri <= 0n) {
      throw new Error("daily FUND budget must be positive");
    }
  }

  private async read(): Promise<Ledger> {
    const day = utcDay(this.now());
    try {
      const stored = ledgerSchema.parse(
        JSON.parse(await readFile(this.path, "utf8")),
      );
      return stored.day === day
        ? stored
        : {
            schemaVersion: "wrenchless.fund-budget.v1",
            day,
            reservedFri: "0",
          };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {
          schemaVersion: "wrenchless.fund-budget.v1",
          day,
          reservedFri: "0",
        };
      }
      throw new Error("FUND budget ledger is unreadable", { cause: error });
    }
  }

  async remainingFri(): Promise<bigint> {
    const ledger = await this.read();
    const remaining = this.dailyLimitFri - BigInt(ledger.reservedFri);
    return remaining > 0n ? remaining : 0n;
  }

  async reserve(maximumSpendFri: bigint): Promise<void> {
    if (maximumSpendFri <= 0n) {
      throw new Error("FUND spend reservation must be positive");
    }
    const ledger = await this.read();
    const next = BigInt(ledger.reservedFri) + maximumSpendFri;
    if (next > this.dailyLimitFri) {
      throw new FundBudgetExceededError();
    }
    const updated = ledgerSchema.parse({
      ...ledger,
      reservedFri: next.toString(),
    });
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(updated)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}
