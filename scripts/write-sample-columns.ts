/**
 * `npm run sample` — write the part of `src/data/sampleRows.ts` that comes
 * from the manifest: every column of every table with what the database puts
 * there when a sample row does not say, and the rules Adminium settles the
 * rows by (copies, fills from a setting, formulas, totals, running numbers).
 *
 * The browser cannot carry the whole manifest to read these from, so they
 * are written into the source, between its two marker lines.
 * src/data/sample-drift.test.ts fails when the written part is out of date,
 * so run this after every change to the manifest.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const WRITTEN_START = "// ── written by `npm run sample` from manifest.json; do not edit by hand ──";
export const WRITTEN_END = "// ── end of the written part ──";

type Json = unknown;

interface ManifestColumn {
  ref: string;
  type: string;
  role?: string;
  nullable?: boolean;
  default?: Json;
  scale?: number | "currency";
  references?: string;
  rules?: Record<string, Json>;
}

export interface ManifestForSample {
  requiredSchema: { tables: { ref: string; columns: ManifestColumn[] }[] };
}

/** A setting a column may be filled from: the connection's currency, or `<addOn>.<setting>`. */
function settingName(from: Json): string {
  if (typeof from === "string") return from;
  const ref = from as { addOn: string; setting: string };
  return `${ref.addOn}.${ref.setting}`;
}

/** The written part, for this manifest: the lines between (and including) the two markers' block. */
export function writtenPart(manifest: ManifestForSample): string {
  const tables = manifest.requiredSchema.tables;
  const columnOf = (table: string, column: string) => tables.find((t) => t.ref === table)?.columns.find((c) => c.ref === column);

  const columns = tables.map((table) => {
    const fills = table.columns
      .filter((column) => column.role !== "pk")
      .map((column) => {
        const fill =
          column.default === "now" ? "NOW" : column.default !== undefined ? JSON.stringify(column.default) : column.nullable === true ? "null" : "REQUIRED";
        return `${column.ref}: ${fill}`;
      });
    return `  ${table.ref}: { ${fills.join(", ")} },`;
  });

  const copies: string[] = [];
  const defaults: string[] = [];
  const formulas: string[] = [];
  const rollups: string[] = [];
  const sequences: string[] = [];
  const formats: string[] = [];
  const codes: string[] = [];
  for (const table of tables) {
    for (const column of table.columns) {
      const rules = column.rules ?? {};
      const scale = JSON.stringify(column.scale ?? 2);
      if (rules["copy"] !== undefined) {
        const copy = rules["copy"] as { via: string; from: string; mode?: string };
        const parent = columnOf(table.ref, copy.via)?.references ?? "";
        copies.push(
          `    { table: "${table.ref}", column: "${column.ref}", via: "${copy.via}", parent: "${parent}", from: "${copy.from}", always: ${String(copy.mode === "always")} },`,
        );
      }
      const fill = rules["default"] as { from?: Json } | undefined;
      if (fill?.from !== undefined) defaults.push(`    { table: "${table.ref}", column: "${column.ref}", from: "${settingName(fill.from)}" },`);
      if (rules["formula"] !== undefined) {
        formulas.push(`    { table: "${table.ref}", column: "${column.ref}", scale: ${scale}, expr: ${JSON.stringify(rules["formula"])} },`);
      }
      if (rules["rollup"] !== undefined) {
        const rollup = rules["rollup"] as { from: string; via: string; sum: string; where?: Json; balance?: { column: string; of: string } };
        const where = rollup.where === undefined ? "" : `, where: ${JSON.stringify(rollup.where)}`;
        const balance = rollup.balance === undefined ? "" : `, balance: { column: "${rollup.balance.column}", of: "${rollup.balance.of}" }`;
        rollups.push(
          `    { table: "${table.ref}", column: "${column.ref}", child: "${rollup.from}", via: "${rollup.via}", sum: "${rollup.sum}", scale: ${scale}${where}${balance} },`,
        );
      }
      if (rules["sequence"] !== undefined) {
        const sequence = rules["sequence"] as { scope?: string };
        sequences.push(`    { table: "${table.ref}", column: "${column.ref}", scope: ${JSON.stringify(sequence.scope ?? null)} },`);
      }
      if (rules["format"] !== undefined) {
        const format = rules["format"] as { from: string; prefix?: string; prefixSetting?: Json; pad?: number };
        const prefix = format.prefix !== undefined ? JSON.stringify(format.prefix) : "null";
        const setting = format.prefixSetting !== undefined ? JSON.stringify(settingName(format.prefixSetting)) : "null";
        formats.push(
          `    { table: "${table.ref}", column: "${column.ref}", from: "${format.from}", prefix: ${prefix}, prefixSetting: ${setting}, pad: ${String(format.pad ?? 0)} },`,
        );
      }
      if (rules["code"] !== undefined) codes.push(`    { table: "${table.ref}", column: "${column.ref}" },`);
    }
  }
  const list = (name: string, lines: string[]) => [`  ${name}: [`, ...lines, "  ],"];
  return [
    WRITTEN_START,
    "export const COLUMNS: Record<string, Record<string, Fill>> = {",
    ...columns,
    "};",
    "",
    "export const RULES: Rules = {",
    ...list("copies", copies),
    ...list("defaults", defaults),
    ...list("formulas", formulas),
    ...list("rollups", rollups),
    ...list("sequences", sequences),
    ...list("formats", formats),
    ...list("codes", codes),
    "};",
    "",
  ].join("\n");
}

/** The resolver's source with its written part replaced by this manifest's. */
export function withWrittenPart(source: string, manifest: ManifestForSample): string {
  const start = source.indexOf(WRITTEN_START);
  const end = source.indexOf(WRITTEN_END);
  if (start < 0 || end < start) throw new Error("src/data/sampleRows.ts has lost the marker lines around its written part");
  return source.slice(0, start) + writtenPart(manifest) + source.slice(end);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Run as a script (`npm run sample`), not when the drift test imports it to compare.
const invoked = process.env["VITEST"] === undefined;
if (invoked) {
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as ManifestForSample;
  const file = join(root, "src", "data", "sampleRows.ts");
  const before = readFileSync(file, "utf8");
  const after = withWrittenPart(before, manifest);
  if (after !== before) writeFileSync(file, after);
  console.info(after === before ? "src/data/sampleRows.ts is up to date" : "wrote the manifest's columns and rules into src/data/sampleRows.ts");
}
