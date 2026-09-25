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

/** Typed decimal text, trimmed (a comma read as the point); null when empty. */
export function decimalText(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = latinDigits(value).trim().replace(",", ".");
  return text === "" ? null : text;
}

/** Typed text, trimmed; null when empty. */
export const textOrNull = (value: string | null | undefined): string | null => {
  const text = value?.trim() ?? "";
  return text === "" ? null : text;
};
