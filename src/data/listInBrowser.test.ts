import { describe, expect, it } from "vitest";

import { listInBrowser, matches } from "./listInBrowser.ts";

const rows = [
  { id: 1, position: 2, document_id: 7, paid_on: "2026-07-26", amount: "1200.00", note: null },
  { id: 2, position: 1, document_id: 7, paid_on: "2026-06-02", amount: "500", note: "Deposit" },
  { id: 3, position: 3, document_id: 8, paid_on: null, amount: "80.5", note: "late" },
];

describe("a client's list, narrowed and ordered in the browser", () => {
  it("keeps the rows a condition names, as the data API would", () => {
    expect(listInBrowser(rows, { where: { column: "document_id", op: "eq", value: 7 } }).map((r) => r.id)).toEqual([1, 2]);
    expect(listInBrowser(rows, { where: { column: "document_id", op: "eq", value: "7" } }).map((r) => r.id)).toEqual([1, 2]);
    expect(listInBrowser(rows, { where: { column: "id", op: "in", value: [3, 1] } }).map((r) => r.id)).toEqual([1, 3]);
    expect(listInBrowser(rows, { where: { column: "note", op: "is_null" } }).map((r) => r.id)).toEqual([1]);
    expect(listInBrowser(rows, { where: { or: [{ column: "id", op: "eq", value: 3 }, { and: [{ column: "document_id", op: "eq", value: 7 }, { column: "amount", op: "gt", value: "600" }] }] } }).map((r) => r.id)).toEqual([1, 3]);
    // A decimal compares as a number, not as text ("80.5" < "600").
    expect(matches(rows[2]!, { column: "amount", op: "lt", value: 600 })).toBe(true);
    expect(matches(rows[0]!, { column: "paid_on", op: "gte", value: "2026-07-01" })).toBe(true);
    // An empty value meets no comparison, and no "not equal" either (as SQL).
    expect(matches(rows[2]!, { column: "paid_on", op: "lt", value: "2026-07-01" })).toBe(false);
    expect(matches(rows[0]!, { column: "note", op: "neq", value: "x" })).toBe(false);
    expect(matches(rows[1]!, { column: "note", op: "ilike", value: "dep%" })).toBe(true);
  });

  it("orders by the keys asked, numbers as numbers, an empty value last, and keeps the first `limit`", () => {
    expect(listInBrowser(rows, { order: "position.asc" }).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(listInBrowser(rows, { order: "id.desc" }).map((r) => r.id)).toEqual([3, 2, 1]);
    expect(listInBrowser(rows, { order: "paid_on.asc" }).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(listInBrowser(rows, { order: "paid_on.desc" }).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(listInBrowser(rows, { order: "amount.desc" }).map((r) => r.id)).toEqual([1, 2, 3]);
    expect(listInBrowser(rows, { order: "document_id.desc,position.asc" }).map((r) => r.id)).toEqual([3, 2, 1]);
    expect(listInBrowser(rows, { where: { column: "document_id", op: "eq", value: 7 }, order: "id.desc", limit: 1 }).map((r) => r.id)).toEqual([2]);
    // Nothing asked: every row, as it came.
    expect(listInBrowser(rows).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});
