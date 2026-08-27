import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

const decimalSchema = z.string().regex(/^(?:0|[1-9][0-9]*)$/);

const legacyLedgerSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.fund-budget.v1"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    reservedFri: decimalSchema,
  })
  .strict();

const ledgerSchema = z
  .object({
    schemaVersion: z.literal("wrenchless.fund-budget.v2"),
    day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    settledFri: decimalSchema,
    pending: z.record(z.string().min(1), decimalSchema),
  })
  .strict();

type Ledger = z.infer<typeof ledgerSchema>;

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function totalPendingFri(ledger: Ledger): bigint {
  return Object.values(ledger.pending).reduce(
    (total, value) => total + BigInt(value),
    0n,
  );
}

function assertReservationId(reservationId: string): void {
  if (reservationId.trim().length === 0) {
    throw new Error("FUND reservation id must not be empty");
  }
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

  private currentLedger(ledger: Ledger): Ledger {
    const day = utcDay(this.now());
    if (ledger.day === day) return ledger;
    return {
      ...ledger,
      day,
      settledFri: "0",
    };
  }

  private async read(): Promise<Ledger> {
    const day = utcDay(this.now());
    try {
      const value: unknown = JSON.parse(await readFile(this.path, "utf8"));
      const current = ledgerSchema.safeParse(value);
      if (current.success) return this.currentLedger(current.data);

      const legacy = legacyLedgerSchema.parse(value);
      return {
        schemaVersion: "wrenchless.fund-budget.v2",
        day,
        settledFri: legacy.day === day ? legacy.reservedFri : "0",
        pending: {},
      };
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      ) {
        return {
          schemaVersion: "wrenchless.fund-budget.v2",
          day,
          settledFri: "0",
          pending: {},
        };
      }
      throw new Error("FUND budget ledger is unreadable", { cause: error });
    }
  }

  private async write(ledger: Ledger): Promise<void> {
    const updated = ledgerSchema.parse(ledger);
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(updated)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }

  async remainingFri(): Promise<bigint> {
    const ledger = await this.read();
    const committed = BigInt(ledger.settledFri) + totalPendingFri(ledger);
    const remaining = this.dailyLimitFri - committed;
    return remaining > 0n ? remaining : 0n;
  }

  async reserve(reservationId: string, maximumSpendFri: bigint): Promise<void> {
    assertReservationId(reservationId);
    if (maximumSpendFri <= 0n) {
      throw new Error("FUND spend reservation must be positive");
    }
    const ledger = await this.read();
    if (ledger.pending[reservationId] !== undefined) {
      throw new Error("FUND reservation already exists");
    }
    const committed = BigInt(ledger.settledFri) + totalPendingFri(ledger);
    if (committed + maximumSpendFri > this.dailyLimitFri) {
      throw new FundBudgetExceededError();
    }
    await this.write({
      ...ledger,
      pending: {
        ...ledger.pending,
        [reservationId]: maximumSpendFri.toString(),
      },
    });
  }

  async settle(reservationId: string, actualSpendFri: bigint): Promise<void> {
    assertReservationId(reservationId);
    if (actualSpendFri < 0n) {
      throw new Error("confirmed FUND spend must not be negative");
    }
    const ledger = await this.read();
    const reserved = ledger.pending[reservationId];
    if (reserved === undefined) {
      throw new Error("FUND reservation does not exist");
    }
    if (actualSpendFri > BigInt(reserved)) {
      throw new Error("confirmed FUND spend exceeds its reservation");
    }
    const pending = { ...ledger.pending };
    delete pending[reservationId];
    await this.write({
      ...ledger,
      settledFri: (BigInt(ledger.settledFri) + actualSpendFri).toString(),
      pending,
    });
  }

  async settleMaximum(reservationId: string): Promise<void> {
    assertReservationId(reservationId);
    const ledger = await this.read();
    const reserved = ledger.pending[reservationId];
    if (reserved === undefined) {
      throw new Error("FUND reservation does not exist");
    }
    await this.settle(reservationId, BigInt(reserved));
  }
}
