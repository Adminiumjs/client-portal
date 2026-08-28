// SPDX-License-Identifier: AGPL-3.0-only
/**
 * `db/seed.sql` and `src/data/demo.ts` describe the same fiction (§5.2 item 3).
 *
 * ── WHAT THIS IS, AND WHAT IT IS NOT ───────────────────────────────────────
 * §5.2 item 3 asks for maker-shop's `db/generate-seed.mjs` here, which WRITES
 * the SQL from the TypeScript so the two cannot differ in any value. That
 * script is 372 lines of one studio's domain arithmetic, so porting it is a
 * bespoke generator per repo rather than a copy, and it is not funded yet.
 *
 * This is the cheap half, and it catches the drift that actually happens: a row
 * added to one side and not the other. It compares COUNTS — nothing here says
 * the values agree. Read that limitation as stated, not as covered.
 *
 * The counter is `db/seed-rows.mjs`, byte-identical in every repo; edit
 * `workplan/tools/seed-drift/` and re-run its `apply`, never this copy.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// @ts-expect-error — a plain .mjs helper, shared byte-for-byte across the fleet.
import { rowCounts, uncountableTables } from "./seed-rows.mjs";
import { demoSource } from "../src/data/source.ts";

const SEED = join(dirname(fileURLToPath(import.meta.url)), "seed.sql");
const sql = readFileSync(SEED, "utf8");
const counts = rowCounts(sql) as Map<string, number>;
const uncountable = uncountableTables(sql) as Set<string>;

/** Every table whose rows the app also seeds in TypeScript. */
const MIRRORED: readonly (readonly [string, () => number])[] = [
  ["clients", () => demoSource.clients().length],
  ["proposals", () => demoSource.proposals().length],
  ["proposal_items", () => demoSource.proposals().reduce((n, p) => n + p.items.length, 0)],
  ["projects", () => demoSource.projects().length],
  ["milestones", () => demoSource.projects().reduce((n, p) => n + p.milestones.length, 0)],
  ["deliverables", () => demoSource.projects().reduce((n, p) => n + p.deliverables.length, 0)],
  ["invoices", () => demoSource.invoices().length],
  ["invoice_items", () => demoSource.invoices().reduce((n, i) => n + i.items.length, 0)],
  ["payments", () => demoSource.invoices().reduce((n, i) => n + i.payments.length, 0)],
];

/**
 * Tables the SQL seeds and the app has no collection for. Listed rather than
 * omitted: an unexplained absence is indistinguishable from an oversight, and
 * this is the line where somebody notices the app grew a reader for one.
 */
const SQL_ONLY: readonly string[] = [];

/**
 * Tables seeded by an `INSERT … SELECT`, whose row count is not in the text.
 * Declared so the shape is a decision rather than a silent zero.
 */
const UNCOUNTABLE: readonly string[] = [];

describe("the two seeds describe the same fiction", () => {
  it.each(MIRRORED)("%s has the same number of rows on both sides", (table, expected) => {
    expect(counts.get(table), `${table} is not inserted by db/seed.sql at all`).toBeDefined();
    expect(counts.get(table)).toBe(expected());
  });

  it("still reads every INSERT … SELECT the seed uses, and no more", () => {
    expect([...uncountable].sort()).toEqual([...UNCOUNTABLE].sort());
  });

  it("accounts for every table the SQL inserts", () => {
    const named = new Set([...MIRRORED.map(([t]) => t), ...SQL_ONLY, ...UNCOUNTABLE]);
    const unaccounted = [...counts.keys()].filter((t) => !named.has(t));
    expect(
      unaccounted,
      "db/seed.sql inserts a table this test has never heard of — map it or declare it SQL-only",
    ).toEqual([]);
  });
});
