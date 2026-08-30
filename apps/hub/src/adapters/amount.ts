/**
 * STRK is quoted to the user and fri is sent to the chain, so exactly one
 * module converts between them and every surface uses it.
 *
 * Both directions are string-to-string through BigInt. A token amount that
 * passes through a JavaScript number has already lost the last four digits of
 * an 18-decimal value, and no amount of formatting afterwards puts them back.
 */

import { z } from "zod";

const DECIMALS = 18n;
const ONE = 10n ** DECIMALS;
/** Six is where a phone screen stops being able to show the digits anyway. */
const DISPLAY_DECIMALS = 6;

export type ParsedAmount =
  | { ok: true; fri: string }
  | { ok: false; message: string };

/**
 * Accepts what a person types: `1`, `1.5`, `.5`, `0.000000000000000001`.
 * Rejects anything that would silently round, because a rounded payment amount
 * is a different payment.
 */
export function parseStrkAmount(input: string): ParsedAmount {
  const text = input.trim();
  if (text.length === 0) return { ok: false, message: "Enter an amount." };
  if (!/^\d*(?:\.\d*)?$/.test(text)) {
    return { ok: false, message: "Use digits and one decimal point." };
  }
  const [whole = "", fraction = ""] = text.split(".");
  if (fraction.length > Number(DECIMALS)) {
    return { ok: false, message: "STRK has at most 18 decimal places." };
  }
  const fri =
    BigInt(whole === "" ? "0" : whole) * ONE +
    BigInt(fraction === "" ? "0" : fraction.padEnd(Number(DECIMALS), "0"));
  if (fri === 0n) return { ok: false, message: "Enter an amount above zero." };
  return { ok: true, fri: fri.toString() };
}

/**
 * Exact when it fits, marked when it does not. A number that has quietly lost
 * digits is worse than a number wearing a "≈".
 */
export function formatStrk(friValue: string | bigint): string {
  const fri = BigInt(friValue);
  const whole = fri / ONE;
  const fraction = (fri % ONE).toString().padStart(Number(DECIMALS), "0");
  const trimmed = fraction.replace(/0+$/, "");
  if (trimmed.length === 0) return whole.toString();
  if (trimmed.length <= DISPLAY_DECIMALS) return `${whole}.${trimmed}`;
  const shown = trimmed.slice(0, DISPLAY_DECIMALS).replace(/0+$/, "");
  return `≈ ${whole}.${shown === "" ? "0" : shown}`;
}

/**
 * The same value, dressed for a figure rather than a row.
 *
 * A balance reading "2 STRK" looks like a placeholder next to one reading
 * "8.00 STRK", and the two appear on the same screen minutes apart. So anything
 * shown at figure size is padded to two places — which is a change of dress and
 * not of value, because the digits added are the ones already there.
 */
export function formatStrkFigure(friValue: string | bigint): string {
  const shown = formatStrk(friValue);
  const [head = "", tail] = shown.split(".");
  if (tail === undefined) return `${head}.00`;
  return tail.length === 1 ? `${head}.${tail}0` : shown;
}

/**
 * Every digit, for a field a person will edit and save again.
 *
 * `formatStrk` truncates for display and marks the truncation, which is right
 * for a figure you only read. Putting a truncated value back into an input is
 * how a saved setting quietly loses precision the next time it is saved.
 */
export function formatStrkExact(friValue: string | bigint): string {
  const fri = BigInt(friValue);
  const whole = fri / ONE;
  const fraction = (fri % ONE)
    .toString()
    .padStart(Number(DECIMALS), "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? whole.toString() : `${whole}.${fraction}`;
}

/**
 * Suggested figures for a screen whose smallest workable value moves.
 *
 * The floor is a live reading — a fee plus what has to survive it — so a fixed
 * list of chips will sooner or later offer one nobody can use. The floor is
 * always the first suggestion, and the round numbers above it follow; anything
 * at or under it is dropped rather than shown greyed out.
 */
export function amountChoices(
  minimumFri: string,
  larger: readonly string[],
): readonly string[] {
  const floor = BigInt(minimumFri);
  return [
    formatStrkExact(minimumFri),
    ...larger.filter((value) => BigInt(value) * ONE > floor),
  ];
}

/** Unix seconds, as the decimal u64 the helper and the schemas expect. */
export function unixSecondsFromNow(hours: number): string {
  return String(Math.floor(Date.now() / 1000) + Math.round(hours * 3600));
}

export function formatUnixSeconds(seconds: string): string {
  const parsed = Number(seconds);
  if (!Number.isFinite(parsed)) return seconds;
  return new Date(parsed * 1000).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatTimestamp(iso: string): string {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return iso;
  return new Date(parsed).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The stored and relayed records are validated by schema, and a schema names
 * its fields the way the code does. Those names are the only part of a
 * rejection worth showing, said the way the product says them.
 */
const FIELD_WORDS = new Map<string, string>([
  ["tokenAddress", "token"],
  ["tokenSymbol", "token"],
  ["tokenDecimals", "token"],
  ["devicePrivateKey", "device key"],
  ["stateId", "Safe reference"],
  ["helperAddress", "Safe contract"],
  ["recoveryAccount", "recovery account"],
  ["recoverySalt", "recovery secret"],
  ["amountBaseUnits", "amount"],
  ["dailyAmountBaseUnits", "daily allowance"],
  ["firstReleaseSeconds", "first release date"],
  ["returnDateSeconds", "return date"],
  ["fundTransactionHash", "transaction"],
  ["actionTransactionHash", "transaction"],
  ["pendingAction", "pending action"],
]);

/**
 * A schema rejection, said to a person.
 *
 * A `ZodError` carries its issue list as its `message`, so showing it the way
 * every other error is shown paints a JSON array onto the screen — which is
 * exactly what happened when two leading-zero felts reached the ticket store.
 * The important part is not the issue list. It is that the details were
 * refused before anything was sent, and that nothing has moved.
 */
function schemaReason(error: z.ZodError): string {
  const [issue] = error.issues;
  for (const step of issue?.path ?? []) {
    const named = FIELD_WORDS.get(String(step));
    if (named !== undefined) {
      return `Wrenchless could not accept the ${named} for this Safe, so nothing was sent.`;
    }
  }
  return "Some of this Safe's details were not in the form Wrenchless accepts, so nothing was sent.";
}

/**
 * Errors thrown by the operation modules are already written for a person.
 * The frontend shows them verbatim rather than matching on their text: a UI
 * that branches on a backend message string is a UI that breaks silently the
 * day the wording improves.
 *
 * A schema rejection is the one exception, because its own message is a
 * serialized issue list rather than a sentence.
 */
export function reasonFrom<T>(error: T): string {
  if (error instanceof z.ZodError) return schemaReason(error);
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }
  return "The operation did not complete.";
}

/** Middle-truncated for display. The full value stays in `title` and links. */
export function shortHex(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

export const EXPLORER_BASE = "https://voyager.online/tx/";
