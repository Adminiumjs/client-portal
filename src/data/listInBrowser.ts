/**
 * A list's narrowing and order, worked out in the browser.
 *
 * The doors an app's `publicAccess` makes are narrow on the server — a
 * client's own rows, a proposal's own lines — and name no column a caller may
 * filter or sort by, so Adminium refuses a public list that sends `where=` or
 * `order=` ("That filter / sort is not permitted here"). The clients' side
 * therefore reads the whole door (it is only that client's rows) and picks
 * and orders here, in the data API's own grammar, so the screens ask for rows
 * the same way on both sides.
 *
 * Rows arrive normalised (`rows.ts`): numbers are numbers, decimals their
 * digits, days `YYYY-MM-DD`, instants ISO — so a comparison of two values of
 * one column is a comparison of like with like.
 */
import type { ListCondition } from "./snapshotPort.ts";

type Row = Record<string, unknown>;

const same = (a: unknown, b: unknown) => a !== null && a !== undefined && b !== null && b !== undefined && String(a) === String(b);

/** Order two values of one column: numbers as numbers, anything else as text. */
function compare(a: unknown, b: unknown): number {
  const x = typeof a === "number" ? a : typeof a === "string" && /^-?\d+(\.\d+)?$/.test(a) ? Number(a) : null;
  const y = typeof b === "number" ? b : typeof b === "string" && /^-?\d+(\.\d+)?$/.test(b) ? Number(b) : null;
  if (x !== null && y !== null) return x - y;
  return String(a).localeCompare(String(b));
}

/** Whether a row meets a condition, as the data API would decide it. */
export function matches(row: Row, where: ListCondition): boolean {
  if ("and" in where) return where.and.every((w) => matches(row, w));
  if ("or" in where) return where.or.some((w) => matches(row, w));
  const value = row[where.column];
  switch (where.op) {
    case "eq":
      return same(value, where.value);
    case "neq":
      return value !== null && value !== undefined && !same(value, where.value);
    case "in":
      return Array.isArray(where.value) && where.value.some((v) => same(value, v));
    case "is_null":
      return value === null || value === undefined;
    case "not_null":
      return value !== null && value !== undefined;
    case "ilike": {
      if (value === null || value === undefined) return false;
      const pattern = String(where.value ?? "").toLowerCase().split("%").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*");
      return new RegExp(`^${pattern}$`, "s").test(String(value).toLowerCase());
    }
    default: {
      if (value === null || value === undefined || where.value === null || where.value === undefined) return false;
      const c = compare(value, where.value);
      return where.op === "gt" ? c > 0 : where.op === "gte" ? c >= 0 : where.op === "lt" ? c < 0 : c <= 0;
    }
  }
}

/**
 * The rows a list asks for: those meeting `where`, in `order`
 * (`column.desc,column2.asc`; an empty value last either way), the first
 * `limit` of them.
 */
export function listInBrowser<T extends Row>(rows: readonly T[], options: { where?: ListCondition; order?: string; limit?: number } = {}): T[] {
  const kept = options.where === undefined ? [...rows] : rows.filter((row) => matches(row, options.where!));
  const keys = (options.order ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .map((part) => {
      const [column = "", direction = "asc"] = part.split(".");
      return { column, sign: direction === "desc" ? -1 : 1 };
    });
  if (keys.length > 0) {
    kept.sort((a, b) => {
      for (const { column, sign } of keys) {
        const x = a[column];
        const y = b[column];
        const xEmpty = x === null || x === undefined;
        const yEmpty = y === null || y === undefined;
        if (xEmpty || yEmpty) {
          if (xEmpty !== yEmpty) return xEmpty ? 1 : -1;
          continue;
        }
        const c = compare(x, y);
        if (c !== 0) return sign * c;
      }
      return 0;
    });
  }
  return options.limit === undefined ? kept : kept.slice(0, options.limit);
}
