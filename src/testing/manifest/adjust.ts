/*
 * VENDORED VERBATIM from packages/manifest/src/adjust.ts.
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
 * THE PRICE QUESTION.
 *
 * An order's price may be lowered by an add-on that keeps offers, discount
 * codes and vouchers. The host says where the question is asked and where
 * the answer goes — `adjust`, on the order's table: which rows are its lines,
 * which columns hold a line's price, quantity and discount, who the customer
 * is, which codes were typed. The add-on says what it reads to answer —
 * `addOn.adjuster`: its offers, its codes, the rows it keeps of what was
 * applied.
 *
 * Adminium asks, checks the answer and writes it: every discount column is
 * Adminium's own, and no browser ever sets one.
 *
 * This file holds the words and what one manifest can check of them. Pure,
 * and nothing imported from the manifest's own schema file.
 */
import { z } from 'zod';

import { ledgerReadSchema, postingMappingSchema, readFromSchema, type Posting } from './ledgers.ts';
import { refSchema, scalarSchema, type ReferenceIssue } from './refs.ts';

const addOnKey = z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key');
const stateName = z.string().min(1).max(40);

/** The most line parts one price rule reads. */
export const ADJUST_PARTS_MAX = 3;

// ── the host's rule ──────────────────────────────────────────────────────────

/** What a line is, to an offer: the item it sells, its category, its type, or a tag. */
const whatSchema = z.object({ column: refSchema, as: z.enum(['item', 'category', 'type', 'tag']) }).strict();

const onlySchema = z.union([z.object({ column: refSchema, eq: scalarSchema }).strict(), z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(16) }).strict()]);

/** Lines kept in a child table of the order. */
const tablePartSchema = z
  .object({
    table: refSchema,
    via: refSchema,
    price: refSchema,
    /** Absent: the quantity is 1 and `price` is the line's amount. */
    quantity: refSchema.optional(),
    discount: refSchema,
    what: z.array(whatSchema).min(1).max(4),
    /** A line no offer reduces (a gift card being loaded). */
    excludes: z.object({ column: refSchema, set: z.literal(true) }).strict().optional(),
    /** A line a code pays for: the link that says which. */
    paidBy: z.object({ column: refSchema }).strict().optional(),
    /** Only such rows are lines. */
    only: onlySchema.optional(),
    /** A row with this column filled is no line (a voided one). */
    unlessSet: refSchema.optional(),
  })
  .strict();

/** The order row is its own one line (a stay priced by the night). */
const selfPartSchema = z
  .object({
    self: z.literal(true),
    price: refSchema,
    quantity: refSchema.optional(),
    discount: refSchema,
    what: z.array(whatSchema).max(4),
    /** A price by the night: the stay's dates, and the column that carries the nightly price rule. */
    nights: z.object({ from: refSchema, to: refSchema, rate: refSchema }).strict().optional(),
  })
  .strict();

export const adjustPartSchema = z.union([tablePartSchema, selfPartSchema]);
export type AdjustPart = z.infer<typeof adjustPartSchema>;

export const adjustSchema = z
  .object({
    by: z.object({ addOn: addOnKey }).strict(),
    /** The rule is live only while this feature's add-ons are there. */
    needs: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id').optional(),
    lines: z.array(adjustPartSchema).min(1).max(ADJUST_PARTS_MAX),
    order: z
      .object({
        /** The order's own reduction: the sum of its lines'. Adminium writes it. */
        discount: refSchema,
        /** Who is buying, when that was proved: the link to them, their address, the yes/no Adminium sets when it was. */
        customer: z
          .object({ link: refSchema, address: refSchema, proved: refSchema, counts: z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(16) }).strict().optional() })
          .strict()
          .optional(),
        /** A reduction staff give by hand: its kind, value and reason, and who gave it (Adminium writes that). */
        staff: z.object({ kind: refSchema, value: refSchema, reason: refSchema, by: refSchema }).strict().optional(),
        currency: postingMappingSchema.optional(),
      })
      .strict(),
    /** The codes typed on the order: a child table, the column typed into, and the links Adminium fills. */
    codes: z.object({ table: refSchema, via: refSchema, typed: refSchema, code: refSchema, voucher: refSchema, removed: refSchema.optional() }).strict().optional(),
    /** The posting of this table that records what was used. */
    uses: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a posting id').optional(),
    /** From here on the price is never worked out again. */
    frozen: z
      .union([z.object({ to: z.array(stateName).min(1).max(16) }).strict(), z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(16) }).strict(), z.object({ column: refSchema, set: z.literal(true) }).strict()])
      .optional(),
    /** The money column a desk's or a guest's expected total is compared with. */
    expect: refSchema.optional(),
    /** Money given back: the refund rows, the columns Adminium decides on them, and what the order cost. */
    refunds: z
      .object({
        table: refSchema,
        via: refSchema,
        amount: refSchema,
        tax: refSchema.optional(),
        of: refSchema,
        taxOf: refSchema.optional(),
        against: refSchema.optional(),
        lines: z.object({ table: refSchema, via: refSchema, line: refSchema, quantity: refSchema }).strict().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((adjust) => adjust.lines.filter((part) => 'self' in part).length <= 1, { message: 'the order row is its own line at most once', path: ['lines'] });
export type Adjust = z.infer<typeof adjustSchema>;

// ── the add-on's side ────────────────────────────────────────────────────────

/** A read of the adjuster's own tables: a ledger read, whose keys may also be the moment (`now`) or the typed codes (`input.codes`). */
export const adjusterReadSchema = ledgerReadSchema
  .omit({ by: true })
  .extend({ by: z.array(z.object({ column: refSchema, from: z.union([readFromSchema, z.literal('now'), z.array(z.union([readFromSchema, z.literal('now')])).min(1).max(3)]) }).strict()).max(3) })
  .strict();

const whereSchema = z.object({ column: refSchema, eq: scalarSchema.optional(), in: z.array(scalarSchema).min(1).max(16).optional() }).strict();

export const adjusterSchema = z
  .object({
    /** What is read before the question is put: offers, their rules, their limits. */
    offers: z.array(adjusterReadSchema).max(6),
    /** Discount codes: found by the typed text; never starting with a reserved word. */
    codes: z
      .object({ table: refSchema, column: refSchema, where: z.array(whereSchema).max(3).optional(), reserved: z.array(z.string().regex(/^[A-Z]{2,4}$/, 'two to four capital letters')).min(1).max(8).optional() })
      .strict(),
    /** Vouchers and packs: found by the typed text with its prefix cut. */
    vouchers: z.object({ table: refSchema, column: refSchema, prefixes: z.array(z.string().regex(/^[A-Z]{2,4}-$/, 'a prefix such as VC-')).min(1).max(4) }).strict(),
    /** The rows Adminium rewrites with what was applied, by the source row and line. */
    applied: z
      .object({
        table: refSchema,
        source: z.object({ table: refSchema, row: refSchema, line: refSchema }).strict(),
        columns: z.object({ offer: refSchema, code: refSchema, voucher: refSchema, name: refSchema, kind: refSchema, amount: refSchema, reason: refSchema, typed: refSchema, at: refSchema }).strict(),
      })
      .strict(),
    /** Read only for a proved customer: the groups they are in, and what they used before. */
    person: z
      .object({
        groups: z.object({ table: refSchema, member: refSchema, group: refSchema }).strict(),
        uses: z.object({ table: refSchema, customer: refSchema, offer: refSchema, state: refSchema, counted: z.array(scalarSchema).min(1).max(8) }).strict(),
        orders: z.literal(true).optional(),
      })
      .strict()
      .optional(),
    /** What each role may give by hand. */
    ceilings: z.object({ table: refSchema, role: refSchema, maxPercent: refSchema, maxAmount: refSchema, comp: refSchema.optional() }).strict().optional(),
    /** The customer reaches the add-on as a keyed hash, never as an address. */
    customerKey: z.literal('hash'),
  })
  .strict();
export type Adjuster = z.infer<typeof adjusterSchema>;

// ── what one manifest can check ──────────────────────────────────────────────

/** What the checks read of a table. */
export interface AdjustTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    role?: string | undefined;
    nullable?: boolean | undefined;
    enum?: readonly string[] | undefined;
    references?: string | undefined;
    maxLength?: number | undefined;
    scale?: number | 'currency' | undefined;
    default?: unknown;
    rules?: Readonly<Record<string, unknown>> | undefined;
  }[];
  states?: unknown;
  capacity?: unknown;
  postings?: readonly Posting[] | undefined;
  adjust?: Adjust | undefined;
}

const MONEY = ['money', 'decimal'];
const NUMBERS = ['int', 'bigint', 'decimal', 'money', 'float'];

/**
 * The columns a price rule makes Adminium's own, by table: the order's
 * discount, who gave a staff reduction, whether the customer was proved;
 * each line's discount; the links a typed code fills; a refund's amount and
 * tax.
 */
export function adjustDecidedColumns(table: string, adjust: Adjust): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (of: string, column: string | undefined) => {
    if (column === undefined) return;
    out.set(of, [...(out.get(of) ?? []), column]);
  };
  add(table, adjust.order.discount);
  add(table, adjust.order.staff?.by);
  add(table, adjust.order.customer?.proved);
  for (const part of adjust.lines) add('self' in part ? table : part.table, part.discount);
  if (adjust.codes !== undefined) {
    add(adjust.codes.table, adjust.codes.code);
    add(adjust.codes.table, adjust.codes.voucher);
  }
  if (adjust.refunds !== undefined) {
    add(adjust.refunds.table, adjust.refunds.amount);
    add(adjust.refunds.table, adjust.refunds.tax);
  }
  return out;
}

/** Everything wrong with a table's price rule that this manifest can see. */
export function adjustIssues(
  table: AdjustTableShape,
  adjust: Adjust,
  ctx: {
    key: string;
    kind: 'app' | 'add-on';
    tables: ReadonlyMap<string, AdjustTableShape>;
    named: ReadonlySet<string>;
    features: ReadonlyMap<string, readonly string[]>;
    /** The columns of a table a formula column reads, by column. */
    formulaReads: (table: string, column: string) => readonly string[] | null;
    /** The public entries' writable columns, by table. */
    publicWritable: (table: string) => ReadonlySet<string>;
  },
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const here = (...rest: (string | number)[]) => at('adjust', ...rest);
  const column = (of: AdjustTableShape | undefined, ref: string) => of?.columns.find((candidate) => candidate.ref === ref);
  const need = (of: AdjustTableShape, ref: string, path: (string | number)[]) => {
    const found = column(of, ref);
    if (found === undefined) out.push({ path, message: `"${of.ref}" has no column "${ref}"` });
    return found;
  };
  /** A child of the order through `via`. */
  const child = (ref: string, via: string, path: (string | number)[]): AdjustTableShape | undefined => {
    const found = ctx.tables.get(ref);
    if (found === undefined) {
      out.push({ path: [...path, 'table'], message: `"${ref}" is not one of this manifest's tables` });
      return undefined;
    }
    const link = column(found, via);
    if (link === undefined || link.type !== 'fk' || link.references !== table.ref) {
      out.push({ path: [...path, 'via'], message: `"${ref}.${via}" is not a foreign key to "${table.ref}", so its rows are no part of the order` });
      return undefined;
    }
    return found;
  };

  // 1. Who answers.
  const own = adjust.by.addOn === ctx.key;
  if (own ? ctx.kind !== 'add-on' : !ctx.named.has(adjust.by.addOn)) {
    out.push({ path: here('by', 'addOn'), message: own ? 'a price is adjusted by an add-on, not by the app itself' : `"${adjust.by.addOn}" is not an add-on this manifest names: add it to addOns.requires or addOns.suggests` });
  }
  if (adjust.needs !== undefined) {
    const feature = ctx.features.get(adjust.needs);
    if (feature === undefined) out.push({ path: here('needs'), message: `"${adjust.needs}" is not one of the app's addOns.features` });
    else if (!feature.includes(adjust.by.addOn)) out.push({ path: here('needs'), message: `the feature "${adjust.needs}" does not need "${adjust.by.addOn}", so it cannot switch this rule` });
  }

  // 3. A discount column: a number with its scale, empty or zero to start with, ruled by nothing else.
  const scales = new Set<string>();
  const discount = (of: AdjustTableShape, ref: string, path: (string | number)[]) => {
    const found = need(of, ref, path);
    if (found === undefined) return;
    if (!MONEY.includes(found.type) || found.scale === undefined) out.push({ path, message: `"${of.ref}.${ref}" holds a reduction: a money or decimal column with a "scale"` });
    else scales.add(String(found.scale));
    if (found.nullable !== true && found.default !== 0) out.push({ path, message: `"${of.ref}.${ref}" starts with no reduction: make it nullable, or give it "default": 0` });
    if (found.rules !== undefined && Object.keys(found.rules).length > 0) out.push({ path, message: `"${of.ref}.${ref}" is written by Adminium from the add-on's answer: it takes no rule of its own` });
  };
  discount(table, adjust.order.discount, here('order', 'discount'));

  // 2, 4, 5. The lines.
  const partTables = new Set<string>();
  adjust.lines.forEach((part, p) => {
    const path = here('lines', p);
    const of = 'self' in part ? table : child(part.table, part.via, path);
    if (of === undefined) return;
    if (!('self' in part)) {
      partTables.add(part.table);
      // What makes every writer of a line hold the order first: the order adds the lines up.
      const totals = table.columns.some((candidate) => {
        const rollup = candidate.rules?.['rollup'] as { from?: string; via?: string } | undefined;
        return rollup?.from === part.table && rollup.via === part.via;
      });
      if (!totals) out.push({ path, message: `"${table.ref}" adds up no column of "${part.table}" through "${part.via}": an order totals its lines (a rollup), or its price cannot be kept in step with them` });
    }
    discount(of, part.discount, [...path, 'discount']);
    const price = need(of, part.price, [...path, 'price']);
    if (price !== undefined && !NUMBERS.includes(price.type)) out.push({ path: [...path, 'price'], message: `"${of.ref}.${part.price}" is not a number` });
    if (part.quantity !== undefined) {
      const quantity = need(of, part.quantity, [...path, 'quantity']);
      if (quantity !== undefined && !['int', 'bigint', 'decimal'].includes(quantity.type)) out.push({ path: [...path, 'quantity'], message: `"${of.ref}.${part.quantity}" is not a whole or a decimal number` });
    }
    part.what.forEach((what, w) => {
      const found = need(of, what.column, [...path, 'what', w, 'column']);
      if (found === undefined) return;
      const link = found.type === 'fk' || found.rules?.['addOnLink'] !== undefined;
      if (what.as === 'tag' ? !['text', 'enum'].includes(found.type) : !link) {
        out.push({ path: [...path, 'what', w], message: what.as === 'tag' ? `a tag is a text or an enum column; "${of.ref}.${what.column}" is ${found.type}` : `"${of.ref}.${what.column}" says which ${what.as} a line is: a foreign key, or a link into an add-on's table` });
      }
    });
    if ('self' in part) {
      if (part.nights !== undefined) {
        need(of, part.nights.from, [...path, 'nights', 'from']);
        need(of, part.nights.to, [...path, 'nights', 'to']);
        const rule = column(of, part.nights.rate)?.rules?.['perNight'] as { from?: string; to?: string } | undefined;
        if (part.nights.rate !== part.price) out.push({ path: [...path, 'nights', 'rate'], message: `a stay's price by the night is its "price" column: "rate" names "${part.price}"` });
        else if (rule === undefined || rule.from !== part.nights.from || rule.to !== part.nights.to) {
          out.push({ path: [...path, 'nights'], message: `"${of.ref}.${part.nights.rate}" carries no price by the night over "${part.nights.from}" to "${part.nights.to}"` });
        }
      }
      return;
    }
    if (part.excludes !== undefined) need(of, part.excludes.column, [...path, 'excludes', 'column']);
    if (part.paidBy !== undefined) need(of, part.paidBy.column, [...path, 'paidBy', 'column']);
    if (part.only !== undefined) need(of, part.only.column, [...path, 'only', 'column']);
    if (part.unlessSet !== undefined) need(of, part.unlessSet, [...path, 'unlessSet']);
  });
  if (scales.size > 1) out.push({ path: here('lines'), message: `an order's reduction and its lines' keep one scale: ${[...scales].join(', ')}` });

  // 6. Who is buying, and who gave a reduction by hand.
  const customer = adjust.order.customer;
  if (customer !== undefined) {
    const link = need(table, customer.link, here('order', 'customer', 'link'));
    const people = link?.type === 'fk' && link.references !== undefined ? ctx.tables.get(link.references) : undefined;
    if (link !== undefined && people === undefined) out.push({ path: here('order', 'customer', 'link'), message: `"${table.ref}.${customer.link}" is not a foreign key to one of this manifest's tables` });
    if (people !== undefined) {
      const address = need(people, customer.address, here('order', 'customer', 'address'));
      if (address !== undefined && address.type !== 'text') out.push({ path: here('order', 'customer', 'address'), message: `"${people.ref}.${customer.address}" is not a text column holding an address` });
    }
    const proved = need(table, customer.proved, here('order', 'customer', 'proved'));
    if (proved !== undefined && (proved.type !== 'bool' || proved.nullable !== true || (proved.rules !== undefined && Object.keys(proved.rules).length > 0))) {
      out.push({ path: here('order', 'customer', 'proved'), message: `"${table.ref}.${customer.proved}" is a nullable yes/no with no rule of its own: Adminium sets it when the customer was proved` });
    }
    if (customer.counts !== undefined) need(table, customer.counts.column, here('order', 'customer', 'counts', 'column'));
  }
  const staff = adjust.order.staff;
  if (staff !== undefined) {
    const kind = need(table, staff.kind, here('order', 'staff', 'kind'));
    if (kind !== undefined && (kind.type !== 'enum' || !['percent', 'amount'].every((value) => (kind.enum ?? []).includes(value)))) {
      out.push({ path: here('order', 'staff', 'kind'), message: `"${table.ref}.${staff.kind}" is an enum holding "percent" and "amount" (and "comp" where staff may give one)` });
    }
    const value = need(table, staff.value, here('order', 'staff', 'value'));
    if (value !== undefined && !MONEY.includes(value.type)) out.push({ path: here('order', 'staff', 'value'), message: `"${table.ref}.${staff.value}" is a decimal` });
    const reason = need(table, staff.reason, here('order', 'staff', 'reason'));
    if (reason !== undefined && reason.type !== 'text' && reason.rules?.['addOnLink'] === undefined) out.push({ path: here('order', 'staff', 'reason'), message: `"${table.ref}.${staff.reason}" is text, or a link into the add-on's reasons` });
    const by = need(table, staff.by, here('order', 'staff', 'by'));
    if (by !== undefined && (by.type !== 'text' || (by.rules !== undefined && Object.keys(by.rules).length > 0))) out.push({ path: here('order', 'staff', 'by'), message: `"${table.ref}.${staff.by}" is text with no rule of its own: Adminium writes who gave the reduction` });
    // A browser never says how much staff took off.
    const open = ctx.publicWritable(table.ref);
    for (const ref of [staff.kind, staff.value, staff.reason]) {
      if (open.has(ref)) out.push({ path: here('order', 'staff'), message: `"${table.ref}.${ref}" is a reduction staff give: no public entry may write it` });
    }
  }

  // 7. The codes typed on the order.
  const codes = adjust.codes;
  if (codes !== undefined) {
    const of = child(codes.table, codes.via, here('codes'));
    if (of !== undefined) {
      const typed = need(of, codes.typed, here('codes', 'typed'));
      if (typed !== undefined && (typed.type !== 'text' || typed.maxLength === undefined || typed.maxLength > 64)) out.push({ path: here('codes', 'typed'), message: `a code is typed into a text column of up to 64 characters` });
      for (const name of ['code', 'voucher'] as const) {
        const found = need(of, codes[name], here('codes', name));
        const link = found?.rules?.['addOnLink'] as { addOn?: string } | undefined;
        if (found !== undefined && (found.nullable !== true || link?.addOn !== adjust.by.addOn)) {
          out.push({ path: here('codes', name), message: `"${of.ref}.${codes[name]}" is the link Adminium fills when the typed code is found: a nullable column with rules.addOnLink into "${adjust.by.addOn}"` });
        }
      }
      if (codes.removed !== undefined) {
        const removed = need(of, codes.removed, here('codes', 'removed'));
        if (removed !== undefined && (removed.nullable !== true || !['timestamptz', 'bool'].includes(removed.type))) out.push({ path: here('codes', 'removed'), message: `"${of.ref}.${codes.removed}" is a nullable timestamp or yes/no: a row with it set is kept as history` });
      }
    }
  }

  // 8. Where uses are recorded.
  if (adjust.uses !== undefined) {
    const posting = (table.postings ?? []).find((candidate) => candidate.id === adjust.uses);
    if (posting === undefined) out.push({ path: here('uses'), message: `"${adjust.uses}" is not a posting of "${table.ref}": uses are recorded by a posting of the order's own table` });
    else if (posting.into.addOn !== adjust.by.addOn) out.push({ path: here('uses'), message: `the posting "${adjust.uses}" goes into "${posting.into.addOn}", not into "${adjust.by.addOn}", which answers the price` });
  }

  // 9. From when the price stands.
  const frozen = adjust.frozen;
  if (frozen !== undefined) {
    if ('to' in frozen) {
      if (table.states === undefined) out.push({ path: here('frozen'), message: `"${table.ref}" declares no states: name a column and its values instead` });
    } else need(table, frozen.column, here('frozen', 'column'));
  }

  // 10, 11. The figure a price check compares, and that it moves with the reduction.
  if (adjust.expect !== undefined) {
    const expected = need(table, adjust.expect, here('expect'));
    if (expected !== undefined) {
      if (!MONEY.includes(expected.type)) out.push({ path: here('expect'), message: `"${table.ref}.${adjust.expect}" is not a money column` });
      // Through any number of formulas: the total reads the net, the net reads the reduction.
      const seen = new Set<string>();
      const reaches = (ref: string): boolean => {
        if (ref === adjust.order.discount) return true;
        if (seen.has(ref)) return false;
        seen.add(ref);
        return (ctx.formulaReads(table.ref, ref) ?? []).some(reaches);
      };
      if (!reaches(adjust.expect)) {
        out.push({ path: here('expect'), message: `"${table.ref}.${adjust.expect}" is not worked out from "${adjust.order.discount}", so a price check on it would check nothing: make it a formula over the order's reduction (net = subtotal − discount; total = net + tax)` });
      }
    }
  }

  // 12. Money given back.
  const refunds = adjust.refunds;
  if (refunds !== undefined) {
    const of = child(refunds.table, refunds.via, here('refunds'));
    if (of !== undefined) {
      need(of, refunds.amount, here('refunds', 'amount'));
      if (refunds.tax !== undefined) need(of, refunds.tax, here('refunds', 'tax'));
      if (refunds.against !== undefined) {
        const against = need(of, refunds.against, here('refunds', 'against'));
        if (against !== undefined && against.type !== 'fk') out.push({ path: here('refunds', 'against'), message: `"${of.ref}.${refunds.against}" is not a foreign key to the payment it gives back` });
      }
    }
    for (const name of ['of', 'taxOf'] as const) {
      const ref = refunds[name];
      if (ref === undefined) continue;
      const found = need(table, ref, here('refunds', name));
      if (found !== undefined && !MONEY.includes(found.type)) out.push({ path: here('refunds', name), message: `"${table.ref}.${ref}" is not a money column` });
    }
    if (refunds.lines !== undefined) {
      const returned = ctx.tables.get(refunds.lines.table);
      if (returned === undefined) out.push({ path: here('refunds', 'lines', 'table'), message: `"${refunds.lines.table}" is not one of this manifest's tables` });
      else {
        need(returned, refunds.lines.via, here('refunds', 'lines', 'via'));
        need(returned, refunds.lines.quantity, here('refunds', 'lines', 'quantity'));
        const line = need(returned, refunds.lines.line, here('refunds', 'lines', 'line'));
        if (line !== undefined && (line.type !== 'fk' || line.references === undefined || !partTables.has(line.references))) {
          out.push({ path: here('refunds', 'lines', 'line'), message: `"${returned.ref}.${refunds.lines.line}" names the line returned: a foreign key to one of the rule's line tables` });
        }
      }
    }
  }
  return out;
}

/** Everything wrong with an add-on's `adjuster` that its own manifest can see. */
export function adjusterIssues(adjuster: Adjuster, tables: ReadonlyMap<string, AdjustTableShape>): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const at = (...rest: (string | number)[]) => ['addOn', 'adjuster', ...rest];
  const own = (ref: string, path: (string | number)[]): AdjustTableShape | undefined => {
    const found = tables.get(ref);
    if (found === undefined) out.push({ path, message: `"${ref}" is not one of this add-on's own tables: an adjuster reads and writes its own tables and no others` });
    return found;
  };
  const need = (of: AdjustTableShape | undefined, ref: string, path: (string | number)[]) => {
    const found = of?.columns.find((candidate) => candidate.ref === ref);
    if (of !== undefined && found === undefined) out.push({ path, message: `"${of.ref}" has no column "${ref}"` });
    return found;
  };

  const reads = new Map<string, AdjustTableShape | undefined>();
  adjuster.offers.forEach((read, r) => {
    const table = own(read.table, at('offers', r, 'table'));
    read.by.forEach((by, b) => {
      need(table, by.column, at('offers', r, 'by', b, 'column'));
      for (const from of Array.isArray(by.from) ? by.from : [by.from]) {
        const [head] = from.split('.');
        if (from === 'now' || from === 'input.codes' || head === 'setting') continue;
        if (head === undefined || !reads.has(head)) out.push({ path: at('offers', r, 'by', b, 'from'), message: `"${from}": an adjuster's read is keyed by "now", "input.codes", a setting or a column of an earlier read` });
      }
    });
    if (read.by.length === 0 && read.limit === undefined) out.push({ path: at('offers', r), message: `the read "${read.as}" has no key: bound it with a "limit"` });
    reads.set(read.as, table);
  });

  need(own(adjuster.codes.table, at('codes', 'table')), adjuster.codes.column, at('codes', 'column'));
  need(own(adjuster.vouchers.table, at('vouchers', 'table')), adjuster.vouchers.column, at('vouchers', 'column'));
  // A typed value is a code or a voucher by the table its row is found in: one table for both could tell neither apart.
  if (adjuster.codes.table === adjuster.vouchers.table) out.push({ path: at('vouchers', 'table'), message: `"${adjuster.vouchers.table}" keeps the discount codes: vouchers are kept in a table of their own, so a typed value is one or the other by where it is found` });
  // A discount code may never look like a voucher's or a card's: every routing prefix is a reserved start.
  const reserved = new Set(adjuster.codes.reserved ?? []);
  adjuster.vouchers.prefixes.forEach((prefix, p) => {
    if (!reserved.has(prefix.replace(/-$/, ''))) out.push({ path: at('vouchers', 'prefixes', p), message: `"${prefix}" routes a typed code to a voucher, so no discount code may start with it: add "${prefix.replace(/-$/, '')}" to codes.reserved` });
  });

  const applied = own(adjuster.applied.table, at('applied', 'table'));
  if (applied !== undefined) {
    if (applied.states !== undefined || applied.capacity !== undefined) out.push({ path: at('applied', 'table'), message: `"${applied.ref}" is rewritten by Adminium on every save: it carries no states and no limit` });
    const source = need(applied, adjuster.applied.source.table, at('applied', 'source', 'table'));
    if (source !== undefined && source.rules?.['tableRef'] !== true) out.push({ path: at('applied', 'source', 'table'), message: `"${applied.ref}.${source.ref}" holds a table's stored name: give it rules.tableRef` });
    need(applied, adjuster.applied.source.row, at('applied', 'source', 'row'));
    need(applied, adjuster.applied.source.line, at('applied', 'source', 'line'));
    for (const [name, ref] of Object.entries(adjuster.applied.columns)) {
      const found = need(applied, ref, at('applied', 'columns', name));
      const rules = Object.keys(found?.rules ?? {}).filter((rule) => rule !== 'addOnLink' && rule !== 'tableRef');
      if (rules.length > 0) out.push({ path: at('applied', 'columns', name), message: `"${applied.ref}.${ref}" is written by Adminium from the answer: it takes no ${rules.join(', ')} rule` });
    }
  }
  if (adjuster.person !== undefined) {
    const groups = own(adjuster.person.groups.table, at('person', 'groups', 'table'));
    need(groups, adjuster.person.groups.member, at('person', 'groups', 'member'));
    need(groups, adjuster.person.groups.group, at('person', 'groups', 'group'));
    const uses = own(adjuster.person.uses.table, at('person', 'uses', 'table'));
    for (const name of ['customer', 'offer', 'state'] as const) need(uses, adjuster.person.uses[name], at('person', 'uses', name));
  }
  if (adjuster.ceilings !== undefined) {
    const ceilings = own(adjuster.ceilings.table, at('ceilings', 'table'));
    const role = need(ceilings, adjuster.ceilings.role, at('ceilings', 'role'));
    if (role !== undefined && role.type !== 'text') out.push({ path: at('ceilings', 'role'), message: `"${ceilings?.ref ?? ''}.${role.ref}" names a role: text` });
    need(ceilings, adjuster.ceilings.maxPercent, at('ceilings', 'maxPercent'));
    need(ceilings, adjuster.ceilings.maxAmount, at('ceilings', 'maxAmount'));
    if (adjuster.ceilings.comp !== undefined) {
      const comp = need(ceilings, adjuster.ceilings.comp, at('ceilings', 'comp'));
      if (comp !== undefined && comp.type !== 'bool') out.push({ path: at('ceilings', 'comp'), message: `"${ceilings?.ref ?? ''}.${comp.ref}" says whether the role may give a comp: a yes/no` });
    }
  }
  return out;
}
