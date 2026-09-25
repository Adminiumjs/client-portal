/**
 * `types.ts` is written from `manifest.json`, and this keeps the two from
 * drifting: a table or a column changed in the manifest and not written out
 * fails here with the command that fixes it.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { rowTypesText, type ManifestLike } from "./rowTypes.ts";
import { COLUMN_KINDS, TABLE_REFS } from "./types.ts";

const ROOT = join(__dirname, "..", "..");
const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8")) as ManifestLike;

describe("the row types are the manifest's tables", () => {
  it("are byte for byte what the manifest writes — run `npx vite-node scripts/write-row-types.ts`", () => {
    expect(readFileSync(join(__dirname, "types.ts"), "utf8") === rowTypesText(manifest)).toBe(true);
  });

  it("name every table the manifest declares, and no other", () => {
    expect([...TABLE_REFS]).toEqual(manifest.requiredSchema.tables.map((t) => t.ref));
  });

  it("hold every amount as a decimal the way Adminium sends it", () => {
    expect(COLUMN_KINDS.invoices.balance).toBe("decimal");
    expect(COLUMN_KINDS.payments.amount).toBe("decimal");
    expect(COLUMN_KINDS.proposals.total).toBe("decimal");
  });

  it("refuse a table nobody named", () => {
    const extra: ManifestLike = { requiredSchema: { tables: [...manifest.requiredSchema.tables, { ref: "widgets", columns: [] }] } };
    expect(() => rowTypesText(extra)).toThrow(/widgets/);
  });
});
