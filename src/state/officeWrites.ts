/**
 * The saves the back office's actions share: a write folded into the desk as
 * it lands, a one-row create under an action key, and the refusals the desk
 * makes before anything is sent (a value the person must fix first).
 */
import type { RowValues } from "../data/ports.ts";
import { latinDigits } from "../lib/typed.ts";
import { newRun, SinkError } from "../data/sink.ts";
import type { Id, TableRef, Tables } from "../data/types.ts";
import { deskWrites, drop, upsert, useDesk } from "./desk.ts";
import { attempt, attemptSteps, refusalOf, type Outcome } from "./outcome.ts";

export async function insertRow<R extends TableRef>(ref: R, values: RowValues): Promise<Tables[R]> {
  const row = await deskWrites().insert(ref, values);
  upsert(ref, row);
  return row;
}

export async function updateRow<R extends TableRef>(ref: R, id: Id, patch: RowValues): Promise<Tables[R]> {
  const row = await deskWrites().update(ref, id, patch);
  upsert(ref, { ...row, id });
  return useDesk.getState().rows[ref][id] as Tables[R];
}

export async function removeRow(ref: TableRef, id: Id): Promise<void> {
  await deskWrites().remove(ref, id);
  drop(ref, id);
}

/** A one-row create, still under an action key: an answer lost on the way may have saved. */
export function createOne<R extends TableRef>(ref: R, values: RowValues): Promise<Outcome<Tables[R]>> {
  const run = newRun();
  return attemptSteps(run, () => [{ name: ref, run: (ctx) => insertRow(ref, { ...values, client_key: ctx.key }) }], (done) => done[ref] as Tables[R]);
}

/** A one-row change. */
export const change = <R extends TableRef>(ref: R, id: Id, patch: RowValues): Promise<Outcome<Tables[R]>> => attempt(() => updateRow(ref, id, patch));

/** A one-row removal (a studio manager's: the studio role deletes nothing). */
export const removal = (ref: TableRef, id: Id): Promise<Outcome<void>> => attempt(() => removeRow(ref, id));

/** A value refused before anything is sent: the code names what is wrong, `field` where. */
export function invalid<T>(code: string, field: string): Outcome<T> {
  return refusalOf<T>(new SinkError(code, "refused", 422, code, field));
}

/**
 * A number as typed, as plain decimal text; null when empty.
 *
 * The last separator is the decimal mark when one or two digits follow it
 * ("12,5", "1.250,50"); a comma before exactly three digits is grouping
 * ("1,200", "1,234,567", and "1.234.567") — unless the whole part is zero ("0,125").
 * It used to turn the FIRST comma into a point and nothing else, so a cost
 * typed "1,200" was saved as 1.2. Text that is not a number is passed on as
 * typed, for the server to refuse by name.
 */
export function decimalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = latinDigits(value).trim().replace(/[\s\u00A0\u202F']/g, "");
  if (text === "") return null;
  if (!/^-?[\d.,]+$/.test(text)) return text;
  const marks = text.match(/[.,]/g) ?? [];
  if (marks.length === 0) return text;
  const at = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
  const head = text.slice(0, at);
  const tail = text.slice(at + 1);
  const oneKind = new Set(marks).size === 1;
  // "1,234,567": the same mark more than once, three digits after the last, is grouping throughout.
  if (marks.length > 1 && oneKind && tail.length === 3) return text.replace(/[.,]/g, "");
  // "1,200": one comma, three digits after it, a whole part that is not zero. (A point there stays a
  // point — "1.255" hours is refused for its decimals, never read as 1,255.)
  if (marks.length === 1 && marks[0] === "," && tail.length === 3 && /^-?[1-9]\d{0,2}$/.test(head)) return head + tail;
  return `${head.replace(/[.,]/g, "")}.${tail}`;
}

/** Typed text, trimmed; null when empty. */
export const textOrNull = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
};
