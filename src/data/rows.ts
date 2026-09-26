/**
 * A row as the server sent it → a row as the app holds it (`types.ts`).
 *
 * The three databases answer the same column three ways: a decimal is
 * `"1950.0000"`, `1950` or `"1950.00"`; a yes/no is `true`, `1` or `"t"`; a
 * time is an ISO instant or a bare wall time on the server's clock (SQLite and
 * MySQL keep no zone); a date is `2026-07-28`.
 * Every screen assumes one spelling, so every row that arrives — through the
 * studio's session, the clients' key or the demo — goes through `normalise`
 * first:
 *
 *   int       a number
 *   decimal   a STRING, as the server's own digits ("1950.0000" stays that;
 *             a number becomes its plain string). Never parsed to a float
 *             and back: `lib/money.ts` formats it for display, nothing else
 *   bool      true / false
 *   day       "YYYY-MM-DD", the day the server spells, never moved by a zone
 *   instant   an ISO string in UTC
 *
 * The kinds come from the manifest, through the generated `COLUMN_KINDS`.
 */
import { COLUMN_KINDS, type TableRef, type Tables } from "./types.ts";
import { dateOf, instant } from "./venueTime.ts";

type Kind = "int" | "decimal" | "bool" | "day" | "instant";

const TRUE = new Set<unknown>([true, 1, "1", "t", "true"]);

function value(kind: Kind, raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  switch (kind) {
    case "int": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "decimal": {
      if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
      const text = String(raw).trim();
      return /^[+-]?\d*(\.\d*)?$/.test(text) && /\d/.test(text) ? text : null;
    }
    case "bool":
      return TRUE.has(raw);
    case "day":
      return dateOf(raw instanceof Date ? raw.toISOString() : String(raw));
    case "instant": {
      const ms = raw instanceof Date ? raw.getTime() : instant(String(raw));
      return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
    }
  }
}

/** One row of `ref`, in the app's spelling. Unknown columns pass through untouched. */
export function normalise<R extends TableRef>(ref: R, raw: Record<string, unknown>): Tables[R] {
  const kinds = COLUMN_KINDS[ref] as Readonly<Record<string, Kind>>;
  const out: Record<string, unknown> = { ...raw };
  /*
   * Adminium blanks the personal columns a reader may not see (`_masked`
   * names them). An address stays empty, so nothing is mailed to it by the
   * desk; any other masked text reads as nothing rather than the word "null".
   */
  const masked = Array.isArray(raw["_masked"]) ? (raw["_masked"] as unknown[]).filter((c): c is string => typeof c === "string") : [];
  for (const column of masked) {
    if (kinds[column] !== undefined) continue;
    out[column] = column.endsWith("email") || column === "to" || column === "reply_to" ? null : "";
  }
  delete out["_masked"];
  for (const [column, kind] of Object.entries(kinds)) {
    if (column in raw) out[column] = value(kind, raw[column]);
  }
  return out as unknown as Tables[R];
}

export function normaliseAll<R extends TableRef>(ref: R, rows: readonly Record<string, unknown>[]): Tables[R][] {
  return rows.map((row) => normalise(ref, row));
}
