/*
 * VENDORED VERBATIM from packages/manifest/src/check.ts.
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
 * THE DESIGN QUESTION.
 *
 * An order line may name a design a shopper made with an add-on (the
 * Customiser): what they typed, chose and uploaded on a ready-made design and
 * a base. Whether that design may be ordered as it is, and which priced
 * features it uses, is the add-on's to say and Adminium's to hold the line to.
 *
 * The host says where the question is asked — `check`, on the line's table:
 * the add-on that answers, the line's link to its design, and where the line
 * keeps the features it pays for (rows of a child table, one a feature). The add-on says
 * what it reads to answer — `addOn.checker`: its designs table, and a short
 * list of keyed reads that start from the design row (its ready-made design,
 * that design's parts, the base, its areas, the features).
 *
 * Adminium reads those rows, asks, checks the answer, and refuses a line
 * whose design does not stand or whose features do not match what it pays
 * for. This file holds the words and what one manifest can check of them.
 * Pure, and nothing imported from the manifest's own schema file.
 */
import { z } from 'zod';

import { refSchema, type ReferenceIssue } from './refs.ts';

const addOnKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key');

/** The most keyed reads a checker declares. */
export const CHECKER_READS_MAX = 8;

// ── the host's rule ──────────────────────────────────────────────────────────

/** Where a line keeps the features it pays for: rows of a child table, each naming one feature. */
const paidSchema = z.object({ table: refSchema, via: refSchema, feature: refSchema }).strict();

export const checkSchema = z
  .object({
    by: z.object({ addOn: addOnKey }).strict(),
    /** The rule is live only while this feature's add-ons are there. */
    needs: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id').optional(),
    /** The line's link to the add-on's designs: a column with rules.addOnLink into the add-on. */
    design: refSchema,
    /** The features the line pays for. Absent: it pays for none, and a design that uses one is refused. */
    paid: paidSchema.optional(),
  })
  .strict();
export type Check = z.infer<typeof checkSchema>;

// ── the add-on's side ────────────────────────────────────────────────────────

const readId = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'a read id is snake_case');

/** One keyed read: the rows of one of the add-on's own tables whose `by.column` holds a value of `by.from` (`design.<column>` or `<earlier read>.<column>`). */
export const checkReadSchema = z
  .object({
    id: readId,
    table: refSchema,
    by: z.object({ column: refSchema, from: z.string().regex(/^[a-z][a-z0-9_]{0,39}\.[a-z][a-z0-9_]*$/, '"design.<column>" or "<an earlier read>.<column>"') }).strict(),
  })
  .strict();
export type CheckRead = z.infer<typeof checkReadSchema>;

export const checkerSchema = z
  .object({
    /** The add-on's own table of designs: what a line's design link points at. */
    design: refSchema,
    reads: z.array(checkReadSchema).max(CHECKER_READS_MAX),
  })
  .strict();
export type Checker = z.infer<typeof checkerSchema>;

// ── what one manifest can check ──────────────────────────────────────────────

/** What the checks read of a table. */
export interface CheckTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    nullable?: boolean | undefined;
    references?: string | undefined;
    rules?: Readonly<Record<string, unknown>> | undefined;
  }[];
}

/** Everything wrong with a line table's design rule that this manifest can see. */
export function checkIssues(
  table: CheckTableShape,
  check: Check,
  ctx: {
    key: string;
    kind: 'app' | 'add-on';
    tables: ReadonlyMap<string, CheckTableShape>;
    named: ReadonlySet<string>;
    features: ReadonlyMap<string, readonly string[]>;
  },
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const here = (...rest: (string | number)[]) => at('check', ...rest);
  const column = (of: CheckTableShape, ref: string) => of.columns.find((candidate) => candidate.ref === ref);

  // Who answers.
  if (ctx.kind !== 'app') out.push({ path: here(), message: "an app's order lines are checked: an add-on's own tables carry no design rule" });
  else if (check.by.addOn === ctx.key || !ctx.named.has(check.by.addOn)) {
    out.push({ path: here('by', 'addOn'), message: `"${check.by.addOn}" is not an add-on this manifest names: add it to addOns.requires or addOns.suggests` });
  }
  if (check.needs !== undefined) {
    const feature = ctx.features.get(check.needs);
    if (feature === undefined) out.push({ path: here('needs'), message: `"${check.needs}" is not one of the app's addOns.features` });
    else if (!feature.includes(check.by.addOn)) out.push({ path: here('needs'), message: `the feature "${check.needs}" does not need "${check.by.addOn}", so it cannot switch this rule` });
  }

  // The line's design: a link into the add-on that answers.
  const design = column(table, check.design);
  if (design === undefined) out.push({ path: here('design'), message: `"${table.ref}" has no column "${check.design}"` });
  else if ((design.rules?.['addOnLink'] as { addOn?: unknown } | undefined)?.addOn !== check.by.addOn) {
    out.push({ path: here('design'), message: `"${table.ref}.${check.design}" names the line's design: a column with rules.addOnLink into "${check.by.addOn}"` });
  }

  // The features the line pays for: rows of a child of the line, each naming one.
  const paid = check.paid;
  if (paid !== undefined) {
    const children = ctx.tables.get(paid.table);
    if (children === undefined) out.push({ path: here('paid', 'table'), message: `"${paid.table}" is not one of this manifest's tables` });
    else {
      const via = column(children, paid.via);
      if (via === undefined || via.type !== 'fk' || via.references !== table.ref) out.push({ path: here('paid', 'via'), message: `"${paid.table}.${paid.via}" is not a foreign key to "${table.ref}", so its rows are no feature of the line` });
      const feature = column(children, paid.feature);
      if (feature === undefined) out.push({ path: here('paid', 'feature'), message: `"${paid.table}" has no column "${paid.feature}"` });
      else if (!['text', 'int', 'bigint', 'fk', 'enum'].includes(feature.type)) out.push({ path: here('paid', 'feature'), message: `"${paid.table}.${paid.feature}" names a feature: a text, enum, whole-number or link column, not ${feature.type}` });
    }
  }
  return out;
}

/** Everything wrong with an add-on's `checker` that its own manifest can see. */
export function checkerIssues(checker: Checker, tables: ReadonlyMap<string, CheckTableShape>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const at = (...rest: (string | number)[]) => ['addOn', 'checker', ...rest];
  const own = (ref: string, path: (string | number)[]): CheckTableShape | undefined => {
    const found = tables.get(ref);
    if (found === undefined) out.push({ path, message: `"${ref}" is not one of this add-on's own tables: a checker reads its own tables and no others` });
    return found;
  };
  const has = (of: CheckTableShape | undefined, ref: string): boolean => of === undefined || of.columns.some((candidate) => candidate.ref === ref);

  const read = new Map<string, CheckTableShape | undefined>([['design', own(checker.design, at('design'))]]);
  checker.reads.forEach((one, r) => {
    if (read.has(one.id)) out.push({ path: at('reads', r, 'id'), message: one.id === 'design' ? '"design" is the design row itself: name the read otherwise' : `two reads are called "${one.id}"` });
    const table = own(one.table, at('reads', r, 'table'));
    if (!has(table, one.by.column)) out.push({ path: at('reads', r, 'by', 'column'), message: `"${one.table}" has no column "${one.by.column}"` });
    const [head = '', ref = ''] = one.by.from.split('.');
    if (!read.has(head)) out.push({ path: at('reads', r, 'by', 'from'), message: `"${one.by.from}": a read is keyed by a column of the design or of an earlier read` });
    else if (!has(read.get(head), ref)) out.push({ path: at('reads', r, 'by', 'from'), message: `"${read.get(head)!.ref}" has no column "${ref}"` });
    if (!read.has(one.id)) read.set(one.id, table);
  });
  return out;
}
