/**
 * Reads whose `in` lists are longer than Adminium takes.
 *
 * Adminium's data API takes at most 200 values in one `in` condition and
 * refuses a longer list outright (422 `VALIDATION_FAILED`). The desk asks by
 * lists it cannot bound — the lines carrying every entry the Time screen
 * read, the invoices of every project in the archive — so every read goes
 * through here: a condition with a longer list is asked as several, each list
 * cut to `IN_CHUNK` values, and the answers are merged back into one (each
 * row once, in the order asked, up to the limit asked).
 *
 * Cutting a list is exact for the grammar the desk speaks: `and`, `or` and
 * conditions, none negated, so a row matches the whole list exactly when it
 * matches one of the pieces.
 */
import type { ListCondition } from "./snapshotPort.ts";

/** The most values Adminium takes in one `in` condition. */
export const MAX_IN_VALUES = 200;
/** How many values one piece of a cut list carries (well inside the limit, and inside the request's size). */
export const IN_CHUNK = 100;

/** Whether a condition carries an `in` list longer than Adminium takes. */
export function tooLongIn(where: ListCondition | undefined, most = MAX_IN_VALUES): boolean {
  if (where === undefined) return false;
  if ("and" in where) return where.and.some((c) => tooLongIn(c, most));
  if ("or" in where) return where.or.some((c) => tooLongIn(c, most));
  return where.op === "in" && Array.isArray(where.value) && where.value.length > most;
}

/**
 * A condition as the conditions to ask instead, each with every `in` list at
 * most `size` values long; the condition itself when none is longer.
 */
export function splitIn(where: ListCondition, size = IN_CHUNK): ListCondition[] {
  if ("and" in where || "or" in where) {
    const group = "and" in where ? where.and : where.or;
    let variants: ListCondition[][] = [[]];
    for (const child of group) {
      const pieces = splitIn(child, size);
      variants = variants.flatMap((before) => pieces.map((piece) => [...before, piece]));
    }
    return variants.map((children) => ("and" in where ? { and: children } : { or: children }));
  }
  if (where.op !== "in" || !Array.isArray(where.value) || where.value.length <= size) return [where];
  const values = [...new Set(where.value as unknown[])];
  const out: ListCondition[] = [];
  for (let i = 0; i < values.length; i += size) out.push({ ...where, value: values.slice(i, i + size) });
  return out;
}

/** Two stored values in the order a list asked for: numbers as numbers, the rest as text; empty ones last. */
function compareValues(x: unknown, y: unknown): number {
  const empty = (v: unknown) => v === null || v === undefined;
  if (empty(x) || empty(y)) return empty(x) === empty(y) ? 0 : empty(x) ? 1 : -1;
  const nx = typeof x === "number" ? x : typeof x === "string" && x.trim() !== "" ? Number(x) : Number.NaN;
  const ny = typeof y === "number" ? y : typeof y === "string" && y.trim() !== "" ? Number(y) : Number.NaN;
  if (Number.isFinite(nx) && Number.isFinite(ny)) return nx - ny;
  const sx = String(x);
  const sy = String(y);
  return sx < sy ? -1 : sx > sy ? 1 : 0;
}

/** Rows in the order `column.desc,column2.asc` names (then by key). */
export function inOrder<T extends { id: unknown }>(rows: readonly T[], order: string | undefined): T[] {
  const keys = (order ?? "")
    .split(",")
    .filter((k) => k.trim() !== "")
    .map((k) => {
      const [column = "id", dir] = k.trim().split(".");
      return { column, desc: dir === "desc" };
    });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of keys) {
      const d = compareValues((a as Record<string, unknown>)[column], (b as Record<string, unknown>)[column]);
      if (d !== 0) return desc ? -d : d;
    }
    return compareValues(a.id, b.id);
  });
}

/**
 * Read by a condition whose lists may be long: once when none is, else a read
 * per piece, merged — each row once, in `order`, at most `limit`.
 */
export async function readInChunks<T extends { id: unknown }>(
  read: (where: ListCondition | undefined) => Promise<T[]>,
  where: ListCondition | undefined,
  order: string | undefined,
  limit: number | undefined,
): Promise<T[]> {
  if (where === undefined || !tooLongIn(where, IN_CHUNK)) return read(where);
  const seen = new Map<string, T>();
  for (const piece of splitIn(where)) {
    for (const row of await read(piece)) {
      const key = String(row.id);
      if (!seen.has(key)) seen.set(key, row);
    }
  }
  const merged = inOrder([...seen.values()], order);
  return limit === undefined ? merged : merged.slice(0, limit);
}
