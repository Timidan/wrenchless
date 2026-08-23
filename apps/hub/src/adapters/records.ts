import { useSyncExternalStore } from "react";
import { z } from "zod";

import { readCoverTransactionState } from "../lib/ready-cover";

/**
 * The activity list, and the rule that makes it trustworthy.
 *
 * A row exists here only because an operation returned a transaction hash. The
 * frontend never writes an optimistic row, never invents a pending entry while
 * a wallet dialog is open, and never keeps a row whose hash it did not receive
 * from the chain-facing module. So a list with nothing in it means nothing has
 * been submitted, which is the only reading a person can safely act on.
 *
 * Status is re-read from the network rather than remembered. A locally cached
 * "confirmed" would survive a reorg that the chain did not.
 */

const recordSchema = z
  .object({
    transactionHash: z.string().regex(/^0x[0-9a-f]+$/),
    kind: z.enum(["payment", "allowance", "refill", "funding", "refund"]),
    amountFri: z.string().regex(/^[0-9]+$/),
    recipient: z.string().nullable(),
    submittedAt: z.iso.datetime(),
    status: z.enum(["pending", "confirmed", "reverted"]),
    reason: z.string().nullable(),
  })
  .strict();

export type ActivityRecord = z.infer<typeof recordSchema>;
export type RecordLedger = "wallet" | "reserve";

const listSchema = z.array(recordSchema).max(200);
const MAX_RECORDS = 200;

function storageKey(ledger: RecordLedger): string {
  return `wrenchless.hub-activity.${ledger}.v1`;
}

const caches = new Map<RecordLedger, readonly ActivityRecord[]>();
const listeners = new Map<RecordLedger, Set<() => void>>();
const EMPTY: readonly ActivityRecord[] = [];

function read(ledger: RecordLedger): readonly ActivityRecord[] {
  const cached = caches.get(ledger);
  if (cached !== undefined) return cached;
  const stored = localStorage.getItem(storageKey(ledger));
  let value: readonly ActivityRecord[] = EMPTY;
  if (stored !== null) {
    try {
      const parsed = listSchema.safeParse(JSON.parse(stored));
      if (parsed.success) value = parsed.data;
    } catch {
      value = EMPTY;
    }
  }
  caches.set(ledger, value);
  return value;
}

function write(ledger: RecordLedger, next: readonly ActivityRecord[]): void {
  const bounded = next.slice(0, MAX_RECORDS);
  caches.set(ledger, bounded);
  localStorage.setItem(storageKey(ledger), JSON.stringify(bounded));
  for (const listener of listeners.get(ledger) ?? []) listener();
}

export function recordSubmission(
  ledger: RecordLedger,
  record: Omit<ActivityRecord, "status" | "reason">,
): void {
  const existing = read(ledger);
  if (existing.some((row) => row.transactionHash === record.transactionHash)) {
    return;
  }
  write(ledger, [
    recordSchema.parse({ ...record, status: "pending", reason: null }),
    ...existing,
  ]);
}

/**
 * One subscribe function per ledger, created once and reused.
 *
 * `useSyncExternalStore` compares this by identity. A fresh arrow on every
 * render makes React tear the subscription down and set it up again on every
 * commit, which stays invisible until something in the tree renders often.
 */
const subscribers = new Map<
  RecordLedger,
  (listener: () => void) => () => void
>();

function subscribeTo(
  ledger: RecordLedger,
): (listener: () => void) => () => void {
  const existing = subscribers.get(ledger);
  if (existing !== undefined) return existing;
  const subscribe = (listener: () => void): (() => void) => {
    const set = listeners.get(ledger) ?? new Set<() => void>();
    listeners.set(ledger, set);
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };
  subscribers.set(ledger, subscribe);
  return subscribe;
}

const snapshotters = new Map<RecordLedger, () => readonly ActivityRecord[]>();

function snapshotOf(ledger: RecordLedger): () => readonly ActivityRecord[] {
  const existing = snapshotters.get(ledger);
  if (existing !== undefined) return existing;
  const snapshot = (): readonly ActivityRecord[] => read(ledger);
  snapshotters.set(ledger, snapshot);
  return snapshot;
}

function emptyActivity(): readonly ActivityRecord[] {
  return EMPTY;
}

export function useActivity(ledger: RecordLedger): readonly ActivityRecord[] {
  return useSyncExternalStore(
    subscribeTo(ledger),
    snapshotOf(ledger),
    emptyActivity,
  );
}

/**
 * Re-reads every unfinished row against the network.
 *
 * Failures are left pending on purpose. An unreachable node is not evidence
 * that a payment failed, and showing it as failed would be a lie a person
 * might act on.
 */
export async function refreshActivity(ledger: RecordLedger): Promise<void> {
  const rows = read(ledger);
  const pending = rows.filter((row) => row.status === "pending");
  if (pending.length === 0) return;

  const settled = new Map<string, ActivityRecord>();
  for (const row of pending) {
    try {
      const state = await readCoverTransactionState({
        transactionHash: row.transactionHash,
      });
      if (state.state === "confirmed") {
        settled.set(row.transactionHash, { ...row, status: "confirmed" });
      } else if (state.state === "reverted") {
        settled.set(row.transactionHash, {
          ...row,
          status: "reverted",
          reason: state.reason ?? null,
        });
      }
    } catch {
      // Left pending: see above.
    }
  }
  if (settled.size === 0) return;
  write(
    ledger,
    read(ledger).map((row) => settled.get(row.transactionHash) ?? row),
  );
}
