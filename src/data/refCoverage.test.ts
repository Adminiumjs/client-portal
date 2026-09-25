/**
 * EVERY TABLE THE DESK READS HAS A REAL TABLE BEHIND IT.
 *
 * `REQUIRED` (adminiumSource.ts) is what the desk checks at boot and reads;
 * `TABLE_OF_REF` (tableOfRef.ts) maps each short name to the table a hosted
 * build reads it from. Nothing connects the two until a hosted build runs —
 * at which point an unmapped ref throws `UNKNOWN_REF` on the first load, for
 * a repo whose whole suite was green. Both are also held to the manifest's
 * own list of tables, so a new table is read, checked and mapped, or this
 * fails naming it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { REQUIRED } from "./adminiumSource.ts";
import { TABLE_OF_REF } from "./tableOfRef.ts";
import { TABLE_REFS } from "./types.ts";

describe("ref coverage", () => {
  it("maps every table the desk checks at boot", () => {
    const unmapped = Object.keys(REQUIRED).filter((ref) => !(ref in TABLE_OF_REF));
    expect(unmapped, "these refs would throw UNKNOWN_REF in a hosted build").toEqual([]);
  });

  it("checks and maps every table the manifest declares, and nothing else", () => {
    expect(Object.keys(REQUIRED).sort()).toEqual([...TABLE_REFS].sort());
    expect(Object.keys(TABLE_OF_REF).sort()).toEqual([...TABLE_REFS].sort());
  });

  it("checks only columns the tables have", () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, "..", "..", "manifest.json"), "utf8")) as { requiredSchema: { tables: { ref: string; columns: { ref: string }[] }[] } };
    const missing: string[] = [];
    for (const table of manifest.requiredSchema.tables) {
      const columns = new Set(table.columns.map((c) => c.ref));
      for (const column of REQUIRED[table.ref as keyof typeof REQUIRED] ?? []) if (!columns.has(column)) missing.push(`${table.ref}.${column}`);
    }
    expect(missing).toEqual([]);
  });
});
