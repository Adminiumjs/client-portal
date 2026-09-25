/**
 * Reads by a list longer than Adminium takes: the list is cut, each piece
 * asked, and the answers merged back as one read would have answered.
 */
import { describe, expect, it } from "vitest";

import { inOrder, readInChunks, splitIn, tooLongIn } from "./inChunks.ts";
import type { ListCondition } from "./snapshotPort.ts";

const ids = (n: number, from = 1) => Array.from({ length: n }, (_, i) => i + from);

describe("cutting a long `in` list", () => {
  it("leaves a condition whose lists fit as it is", () => {
    const where: ListCondition = { and: [{ column: "id", op: "in", value: ids(100) }, { column: "status", op: "eq", value: "draft" }] };
    expect(splitIn(where)).toEqual([where]);
    expect(tooLongIn(where)).toBe(false);
  });

  it("cuts a list into pieces of a hundred, keeping every other condition on each piece", () => {
    const where: ListCondition = { and: [{ column: "project_id", op: "in", value: ids(250) }, { column: "status", op: "eq", value: "sent" }] };
    expect(tooLongIn(where)).toBe(true);
    const pieces = splitIn(where);
    expect(pieces).toHaveLength(3);
    for (const piece of pieces) expect(tooLongIn(piece, 100)).toBe(false);
    expect(pieces.map((p) => ("and" in p ? (p.and[0] as { value: number[] }).value.length : 0))).toEqual([100, 100, 50]);
    expect(pieces.every((p) => "and" in p && JSON.stringify(p.and[1]) === JSON.stringify({ column: "status", op: "eq", value: "sent" }))).toBe(true);
  });

  it("cuts two long lists into every pair of pieces, inside an `or` as well", () => {
    const where: ListCondition = { or: [{ column: "a", op: "in", value: ids(150) }, { and: [{ column: "b", op: "in", value: ids(201) }, { column: "c", op: "is_null" }] }] };
    const pieces = splitIn(where);
    expect(pieces).toHaveLength(2 * 3);
    expect(pieces.every((p) => !tooLongIn(p, 100))).toBe(true);
  });

  it("merges the answers: each row once, in the order asked, up to the limit", async () => {
    const rows = ids(260).map((id) => ({ id, day: `2026-07-${String((id % 28) + 1).padStart(2, "0")}`, hours: String((id % 7) + 0.5) }));
    const asked: number[] = [];
    const read = async (where: ListCondition | undefined) => {
      const wanted = new Set(((where as { value: number[] }).value ?? []).map(Number));
      asked.push(wanted.size);
      // Every piece answers one row twice over, as an overlapping read might.
      return rows.filter((r) => wanted.has(r.id) || r.id === 1).reverse();
    };
    const merged = await readInChunks(read, { column: "id", op: "in", value: ids(260) }, "day.desc,id.asc", 250);
    expect(asked).toEqual([100, 100, 60]);
    expect(merged).toHaveLength(250);
    expect(new Set(merged.map((r) => r.id)).size).toBe(250);
    expect(merged).toEqual(inOrder(rows, "day.desc,id.asc").slice(0, 250));
  });

  it("orders stored decimals as numbers, not as text", () => {
    expect(inOrder([{ id: 1, v: "12.50" }, { id: 2, v: "9.00" }, { id: 3, v: null }], "v.asc").map((r) => r.id)).toEqual([2, 1, 3]);
  });
});
