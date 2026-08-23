import { useSyncExternalStore } from "react";
import { z } from "zod";

/**
 * The reader's own notes, kept on the reader's own device.
 *
 * Acknowledging an event sends nothing. The product deliberately has no path
 * back to the wallet device: a reply would be a visible difference on the very
 * screen the design works to keep uniform, and it would tell anyone watching
 * that someone is reading. So this is a local list of message identifiers and
 * free text, and it never leaves the browser.
 */

const STORAGE_KEY = "wrenchless.hub-acknowledgements.v1";

const entrySchema = z
  .object({
    acknowledgedAt: z.iso.datetime(),
    note: z.string().max(500),
  })
  .strict();

const bookSchema = z.record(z.string().regex(/^[0-9a-f]{32}$/), entrySchema);

export type Acknowledgement = z.infer<typeof entrySchema>;
export type AcknowledgementBook = Readonly<Record<string, Acknowledgement>>;

const EMPTY = bookSchema.parse({});
let cache: AcknowledgementBook | null = null;
const listeners = new Set<() => void>();

function read(): AcknowledgementBook {
  if (cache !== null) return cache;
  const stored = localStorage.getItem(STORAGE_KEY);
  let value = EMPTY;
  if (stored !== null) {
    try {
      const parsed = bookSchema.safeParse(JSON.parse(stored));
      if (parsed.success) value = parsed.data;
    } catch {
      value = EMPTY;
    }
  }
  cache = value;
  return value;
}

export function acknowledge(messageId: string, note: string): void {
  const next = bookSchema.parse({
      ...read(),
      [messageId]: entrySchema.parse({
        acknowledgedAt: new Date().toISOString(),
        note: note.slice(0, 500),
      }),
    });
  cache = next;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  for (const listener of listeners) listener();
}

/** Stable by identity, so React does not resubscribe on every commit. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emptyBook() {
  return EMPTY;
}

export function useAcknowledgements(): AcknowledgementBook {
  return useSyncExternalStore(subscribe, read, emptyBook);
}

/**
 * The response plan, in the reader's own words.
 *
 * The product deliberately does not prescribe what to do about a signal, and
 * it automates nothing. What it can do is keep the plan the two people agreed
 * on where the reader will see it at the moment it matters.
 */

const PLAN_KEY = "wrenchless.hub-response-plan.v1";

let planCache: string | null = null;
const planListeners = new Set<() => void>();

function readPlan(): string {
  if (planCache === null) planCache = localStorage.getItem(PLAN_KEY) ?? "";
  return planCache;
}

export function writeResponsePlan(plan: string): void {
  planCache = plan.slice(0, 2000);
  localStorage.setItem(PLAN_KEY, planCache);
  for (const listener of planListeners) listener();
}

function subscribeToPlan(listener: () => void): () => void {
  planListeners.add(listener);
  return () => {
    planListeners.delete(listener);
  };
}

function emptyPlan(): string {
  return "";
}

export function useResponsePlan(): string {
  return useSyncExternalStore(subscribeToPlan, readPlan, emptyPlan);
}
