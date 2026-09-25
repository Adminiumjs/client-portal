/*
 * VENDORED VERBATIM from packages/manifest/src/refs.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * The small shapes every block of a manifest reuses: a snake_case name, a
 * label in several languages, a number that may come from the app's settings
 * row, and the structural view of a table the cross-reference checks read.
 *
 * A module of its own so `schema.ts` and the blocks split out of it
 * (`booking.ts`, `outbox.ts`, `public-access.ts`) import one definition
 * without importing each other.
 */
import { z } from 'zod';

/** A snake_case identifier: a table or column ref. */
export const refSchema = z.string().regex(/^[a-z][a-z0-9_]*$/, 'must be a snake_case identifier');

/** A BCP 47 tag, the way every label map in a manifest is keyed (`de-DE`). */
export const bcp47TagSchema = z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'keyed by BCP 47 tag');

/** A label in several languages. US English is the one every reader falls back to. */
export const labelsSchema = z
  .record(bcp47TagSchema, z.string().min(1).max(120))
  .refine((labels) => labels['en-US'] !== undefined, { message: 'labels must include en-US' });

/** A text that is either one string, or the same text in several languages. */
export const textOrLabels = z.union([z.string().min(1).max(256), labelsSchema]);

/** One column of the app's one-row settings table, read when the rule runs. */
export const settingRefSchema = z.object({ table: refSchema, column: refSchema }).strict();

/**
 * A value read from a setting when a rule runs: a column of the app's own
 * one-row settings table, or a setting of an add-on the app requires
 * (`{addOn: "invoices", setting: "default_tax_rate"}`), kept by Adminium.
 */
export const addOnSettingRefSchema = z
  .object({
    addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key'),
    setting: z.string().regex(/^[a-z][a-z0-9_]*$/, 'a setting key is snake_case'),
  })
  .strict();
export const settingSourceSchema = z.union([settingRefSchema, addOnSettingRefSchema]);
export type SettingSource = z.infer<typeof settingSourceSchema>;

/**
 * A number the manifest states, or one the app's own settings row holds — so
 * a venue can change its capacity without a new release. `{table, column}`
 * reads the one row of that (one-row) table at write time.
 */
export const numberOrSetting = z.union([z.number().int().nonnegative(), settingRefSchema]);

/** A value a rule compares a column with. */
export const scalarSchema = z.union([z.string(), z.number(), z.boolean()]);

/** What the cross-reference checks read of a column. */
export interface ColumnShape {
  ref: string;
  type: string;
  role?: string | undefined;
  nullable?: boolean | undefined;
  enum?: readonly string[] | undefined;
  references?: string | undefined;
  maxLength?: number | undefined;
}

/** What the cross-reference checks read of a table. */
export interface TableShape<C extends ColumnShape = ColumnShape> {
  ref: string;
  columns: readonly C[];
}

/** One cross-reference problem: where in the manifest, and what is wrong. */
export interface ReferenceIssue {
  path: (string | number)[];
  message: string;
}

/**
 * Lookups over the manifest's tables, shared by every block's checks so each
 * says "no such column" the same way.
 */
export function tableIndex<C extends ColumnShape>(tables: readonly TableShape<C>[]) {
  const byRef = new Map(tables.map((t) => [t.ref, t]));
  const column = (table: string, ref: string): C | undefined => byRef.get(table)?.columns.find((c) => c.ref === ref);
  return {
    table: (ref: string) => byRef.get(ref),
    column,
    has: (table: string, ref: string) => column(table, ref) !== undefined,
    /** The table's primary key column, when it declares one. */
    pk: (table: string) => byRef.get(table)?.columns.find((c) => c.role === 'pk'),
  };
}
export type TableIndex<C extends ColumnShape = ColumnShape> = ReturnType<typeof tableIndex<C>>;

/** Column types a total, a price or a count can be kept in. */
export const NUMERIC_TYPES: readonly string[] = ['int', 'bigint', 'decimal', 'money', 'float'];

/**
 * Whether `value` is one a column of this shape can hold: one of an enum's
 * values, a boolean for a bool, a number for a number, any text for text.
 */
export function valueFits(column: ColumnShape, value: unknown): boolean {
  switch (column.type) {
    case 'enum':
      return typeof value === 'string' && (column.enum ?? []).includes(value);
    case 'bool':
      return typeof value === 'boolean';
    case 'int':
    case 'bigint':
      return typeof value === 'number' && Number.isInteger(value);
    case 'decimal':
    case 'money':
    case 'float':
      return typeof value === 'number';
    default:
      return typeof value === 'string';
  }
}
