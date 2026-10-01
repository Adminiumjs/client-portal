/*
 * VENDORED VERBATIM from packages/manifest/src/public-access.ts.
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
 * `publicAccess` — what the app's public screens may do with one table, and
 * `publicKeys`, the browser keys beyond the one every app gets.
 *
 * An entry is served through a browser key the install creates: `customer`
 * (the default, the app's public side) or one named in `publicKeys`. `GET`
 * reads, `POST` creates; `PATCH` only behind a claim, on a narrow writable
 * list. `availability` answers free or full per slot and never a row.
 *
 * CLAIMS. An entry with `claim` is the key's IDENTITY: proving you know a
 * row's details (a mobile and a date of birth) opens a session on that row.
 * An entry with `claimedBy` is a child of that identity: it reaches only the
 * rows whose column holds the claimed row's key. `verify: 'email-code'` adds a
 * second step, a code emailed to the row's own address, which raises the
 * session from `lookup` to `verified`; an entry that says `level: 'verified'`
 * refuses a session that has not taken it.
 *
 * Two more ways to claim. `verify: 'email-link'`: the person types only
 * their address and Adminium emails a one-use link (and a code for another
 * device); the session opens at `verified` from the link, and a typed
 * address alone opens nothing. `by: 'token'`: an unguessable code in a
 * column opens that one row, with no email at all (a handover page shared by
 * link) — on a key of its own, since a key has one identity.
 *
 * An entry with `visibleWith` reaches a child's rows only where the parent
 * entry reaches the parent row: a draft's lines stay as hidden as the draft.
 */
import { z } from 'zod';

import { kindOf, rulesOf, type Capacity } from './capacity.ts';
import { formulaColumns, type FormulaExpr } from './formula.ts';
import {
  refSchema,
  scalarSchema,
  settingRefSchema,
  valueFits,
  type ColumnShape,
  type ReferenceIssue,
  type TableIndex,
} from './refs.ts';
import { momentIssues, momentOffsetSchema, plainMomentSchema, wallTimeSchema, type Moment } from './refs.ts';
import { conditionIssues, linkedConditionSchema, reachedOnlyByUndo, stateConditionSchema, type StateMove } from './states.ts';

/** The key every entry uses unless it names another. */
export const CUSTOMER_KEY = 'customer';

/** The longest a plain-text value may be unless its column says longer: a name. */
export const PLAIN_TEXT_MAX = 80;
/** The most digits a plain-text column may take in all: "table 12", "2 without onions", never a phone number. */
export const PLAIN_TEXT_DIGITS_MOST = 4;
/** The longest a plain-text column may say it runs: a note to the kitchen. */
export const PLAIN_TEXT_LONGEST = 200;

/**
 * A column held to plain text: its ref (a name: no digits, 80 characters), or
 * its ref with the digits it may hold in all and how long it may run (a note).
 */
const plainTextColumnSchema = z.union([
  refSchema,
  z
    .object({
      column: refSchema,
      digits: z.number().int().min(1).max(PLAIN_TEXT_DIGITS_MOST).optional(),
      max: z.number().int().min(1).max(PLAIN_TEXT_LONGEST).optional(),
    })
    .strict(),
]);
const plainTextSchema = z.array(plainTextColumnSchema).min(1).max(8);

export type PlainTextColumnRef = z.infer<typeof plainTextColumnSchema>;

/** The column a plain-text entry names. */
export const plainTextRef = (entry: PlainTextColumnRef): string => (typeof entry === 'string' ? entry : entry.column);

/** The longest a plain-text entry takes. */
export const plainTextMax = (entry: PlainTextColumnRef): number => (typeof entry === 'string' ? PLAIN_TEXT_MAX : (entry.max ?? PLAIN_TEXT_MAX));

const keyNameSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, 'a key name is kebab-case');

const valueFilterSchema = z
  .object({
    column: refSchema,
    op: z.enum(['eq', 'neq', 'in', 'gte', 'lte']),
    value: z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number()]))]),
  })
  .strict();

/**
 * A filter against the venue's own calendar, worked out on every request in
 * the venue's zone: `today` is today's date, `from-today` today onwards
 * (`days` limits how far).
 */
const relativeFilterSchema = z.union([
  z.object({ column: refSchema, op: z.literal('today') }).strict(),
  z.object({ column: refSchema, op: z.literal('from-today'), days: z.number().int().min(1).max(366).optional() }).strict(),
]);

const valuesSchema = z.array(scalarSchema).min(1).max(32);
/** The states a row may be changed from: values, and `null` for "still empty". */
const whenValuesSchema = z.array(z.union([scalarSchema, z.null()])).min(1).max(32);

/**
 * Proving you know a row's details, e.g. `{match: [code, mobile]}`. With
 * `verify`, a code sent to the row's `email` column raises the session to
 * `verified`.
 */
const lookupClaimSchema = z
  .object({
    match: z.array(refSchema).min(1).max(3),
    verify: z.literal('email-code').optional(),
    email: refSchema.optional(),
  })
  .strict()
  .refine((c) => (c.verify === undefined) === (c.email === undefined), {
    message: 'an emailed code names the column holding the address, and only it does',
    path: ['email'],
  });

/** Signing in by a link emailed to the address in `email`. */
const linkClaimSchema = z.object({ verify: z.literal('email-link'), email: refSchema }).strict();

/** The one or two columns of a row whose addresses its own link may go to. */
const ownAddressSchema = z.union([refSchema, z.tuple([refSchema, refSchema])]);

/**
 * Opening one row by the code in `column`, while it has not expired or been
 * stopped. `own`: the row's owner's own link — emailed only to the row's own
 * address or handed once to whoever made the row — which opens a verified
 * session and may change the row through the key's entries.
 */
const tokenClaimSchema = z
  .object({
    by: z.literal('token'),
    column: refSchema,
    expires: refSchema.optional(),
    stopped: refSchema.optional(),
    own: z.literal(true).optional(),
    /**
     * With `own`: the text columns of this row whose addresses its own link
     * may be emailed to (the holder's, and the friend a ticket is offered to).
     */
    address: ownAddressSchema.optional(),
  })
  .strict();

export const claimSchema = z.union([lookupClaimSchema, linkClaimSchema, tokenClaimSchema]);
export type Claim = z.infer<typeof claimSchema>;

/** How an identity entry claims: by details, by an emailed link, or by a token. */
export function claimKind(claim: Claim): 'lookup' | 'link' | 'token' {
  if ('by' in claim) return 'token';
  if ('match' in claim) return 'lookup';
  return 'link';
}

/**
 * The columns of one table its shared links open a row by (`claim: { by:
 * 'token' }`): codes that leave only as the link — never shown, never
 * listed, never a value the app's own package gives (its sample rows).
 */
export function shareCodeColumns(entries: readonly PublicAccess[], table: string): string[] {
  const out: string[] = [];
  for (const entry of entries) {
    const claim = entry.claim;
    if (entry.table !== table || claim === undefined || !('by' in claim) || claimKind(claim) !== 'token') continue;
    if (!out.includes(claim.column)) out.push(claim.column);
  }
  return out;
}

/**
 * Why a column of another row may never be printed in a list one level down
 * (an email's `joins`, a document's list of names): a list is read for
 * whoever the email or document goes to, one row further from them than the
 * row they asked for, so no reader decides what it shows. A secret, personal
 * data, a code (the one a shared link opens its row with, one Adminium makes,
 * one a person typed), or a column an entry withholds from all but its
 * holder. Null for a column any reader may see listed.
 */
export function unlistedColumn(
  m: { publicAccess?: readonly PublicAccess[] | undefined; requiredSchema: { tables: readonly { ref: string; columns: readonly { ref: string; rules?: Record<string, unknown> | undefined }[] }[] } },
  table: string,
  column: string,
): string | null {
  const entries = m.publicAccess ?? [];
  if (shareCodeColumns(entries, table).includes(column)) return 'the code a shared link opens its row with';
  if (entries.some((entry) => entry.table === table && entry.withhold?.columns.includes(column) === true)) return 'withheld from all but its holder';
  const columns = m.requiredSchema.tables.find((candidate) => candidate.ref === table)?.columns ?? [];
  const rules = columns.find((candidate) => candidate.ref === column)?.rules;
  if (rules?.['secret'] === true) return 'a secret';
  if (rules?.['personal'] === true) return 'personal data';
  if (rules?.['code'] !== undefined) return 'a code';
  if (columns.some((candidate) => (candidate.rules?.['lookup'] as { from?: unknown } | undefined)?.from === column)) return 'a code a person typed';
  return null;
}

/*
 * What the install guesses is personal data from a column's name, the way
 * its classifier does on the table it makes — kept here so the validator
 * refuses what the install would. A column's own `personal` wins either way.
 */
const PERSONAL_TEXT_NAMES = [
  /(^|_)e?mail(_address)?(_|$)/,
  /(^|_)(phone|mobile|tele?phone|fax)(_number)?(_|$)/,
  /(^|_)ip(_address)?$/,
  /(^|_)(address|street|city|zip|postal_code|postcode)(_|$)/,
];
const PERSONAL_NAMES = [
  /(^|_)(ssn|social_security|tax_id|vat|passport|national_id|driver_licen[cs]e)(_|$)/,
  /(^|_)(card_number|pan|iban|account_number|routing_number|bic|swift)(_|$)/,
  /(^|_)(birth(date|day)?|dob|date_of_birth)(_|$)/,
];
const PEOPLE_TABLE = /(^|_)(users?|people|persons?|employees?|staff|members?|contacts?|customers?|profiles?|teachers?|students?|drivers?|agents?|authors?|patients?)(_|$)/;
const PERSON_NAME = /^(first_name|last_name|full_name|display_name|name|username)$/;

/** `userId` → `user_id`: the form a name is matched in. */
function nameForm(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

/**
 * Whether a column holds personal data: marked so (`personal: true`), or —
 * unless marked otherwise — guessed so by its name as the install does: an
 * address, a phone number, a birth date, an ID or account number, a person's
 * first, last or full name on a table of people. Secrets are not personal
 * data (they are never shown at all).
 */
export function personalColumn(
  table: { ref: string; columns: readonly { ref: string; type: string; rules?: Record<string, unknown> | undefined }[] },
  column: string,
): 'marked' | 'guessed' | null {
  const found = table.columns.find((candidate) => candidate.ref === column);
  if (found === undefined) return null;
  const personal = found.rules?.['personal'];
  if (personal === true) return 'marked';
  if (personal === false || found.rules?.['secret'] === true) return null;
  const name = nameForm(column);
  // Kept as text on every engine: an enum is a text column the install reads by its name as any other.
  const text = found.type === 'text' || found.type === 'enum';
  if (text && PERSONAL_TEXT_NAMES.some((pattern) => pattern.test(name))) return 'guessed';
  if (PERSONAL_NAMES.some((pattern) => pattern.test(name))) return 'guessed';
  if (text && /^(first_name|last_name|full_name)$/.test(name)) {
    const names = table.columns.map((candidate) => nameForm(candidate.ref));
    const hasEmail = table.columns.some((candidate, i) => (candidate.type === 'text' || candidate.type === 'enum') && PERSONAL_TEXT_NAMES[0]!.test(names[i]!));
    if (PEOPLE_TABLE.test(nameForm(table.ref)) || (hasEmail && names.some((n) => PERSON_NAME.test(n)))) return 'guessed';
  }
  return null;
}

/**
 * A time no more than `within` minutes ahead — a past time always passes. A
 * kiosk takes an arrival from an hour before the visit, and a late one too.
 * Up to a day: a longer window is no window.
 */
const timeWindowSchema = z.object({ within: z.number().int().min(1).max(1440) }).strict();

/**
 * One end of a window read from a moment (see `refs.ts`). Keyed by a date or
 * a time of the row, it is that column's moment and names no column; keyed
 * by one of the row's links, `column` is the linked row's. `or` lists
 * moments of this row read in turn when the first is empty.
 */
const windowMomentSchema = z
  .object({
    column: refSchema.optional(),
    time: wallTimeSchema.optional(),
    plus: momentOffsetSchema.optional(),
    minus: momentOffsetSchema.optional(),
    or: z.array(plainMomentSchema).min(1).max(3).optional(),
  })
  .strict()
  .refine((m) => m.plus === undefined || m.minus === undefined, { message: 'a moment is shifted forward (plus) or back (minus), not both' });

/**
 * A change allowed only after one moment, before another, or between the two
 * — and, keyed by a link, only while the linked row meets `where` (refunds
 * switched on for the event).
 */
const momentWindowSchema = z
  .object({ after: windowMomentSchema.optional(), before: windowMomentSchema.optional(), where: z.array(stateConditionSchema).min(1).max(8).optional() })
  .strict()
  .refine((w) => w.after !== undefined || w.before !== undefined || w.where !== undefined, { message: 'a window says after, before or where' });

/** The moment one end of a window stands for, keyed by `key` of the entry's table. */
function windowMoment(key: string, ref: z.infer<typeof windowMomentSchema>, linked: boolean): Moment {
  const { column, ...rest } = ref;
  return linked ? { ...rest, column: column ?? '', via: key } : { ...rest, column: key };
}

/**
 * Which rows of a codes table count when a typed code is looked up: a value a
 * column must hold (`active = true`), or a date it must not be past
 * (`notBefore: 'now'` on a `valid_until`, `orEmpty` for none) or before.
 */
export const codeWhereSchema = z
  .array(
    z.union([
      z.object({ column: refSchema, eq: scalarSchema }).strict(),
      z.object({ column: refSchema, notBefore: z.enum(['now', 'today']), orEmpty: z.literal(true).optional() }).strict(),
      z.object({ column: refSchema, notAfter: z.enum(['now', 'today']), orEmpty: z.literal(true).optional() }).strict(),
    ]),
  )
  .max(4);

/*
 * ── A write with its child rows ──────────────────────────────────────────
 * A create may carry the rows that belong to it (an order's lines, each
 * line's options), two levels at most, in one write. `agrees` and `counts`
 * say which choices fit together; they are checked by Adminium, never trusted
 * from the browser.
 */

/** A path of foreign keys, followed one after another; the last names the column compared. */
const pathSchema = z.array(refSchema).min(1).max(3);

/**
 * What an `agrees` rule compares a row's value with: a column of the row it
 * belongs to (`parent`, followed along `path`), a column of a row this row
 * points at (`via`), or a fixed value.
 */
const agreeTargetSchema = z.union([
  z.object({ parent: refSchema, path: pathSchema.optional() }).strict(),
  z.object({ via: refSchema, column: refSchema }).strict(),
  z.object({ value: scalarSchema }).strict(),
]);

/**
 * A value of the row that must agree with another: `column` (followed along
 * `path` through foreign keys) equals, is at most, or is at least the target.
 * `when` applies it only to rows whose value (along its own `path`) is one of
 * `in`.
 */
export const agreeSchema = z
  .object({
    column: refSchema,
    path: pathSchema.optional(),
    when: z.object({ path: pathSchema.optional(), in: z.array(scalarSchema).min(1).max(32) }).strict().optional(),
    eq: agreeTargetSchema.optional(),
    lte: agreeTargetSchema.optional(),
    gte: agreeTargetSchema.optional(),
  })
  .strict();
export type Agree = z.infer<typeof agreeSchema>;

/**
 * How many sibling rows may fall in one group: `by` follows this row's
 * foreign keys to the group (an option's group), whose `min` and `max`
 * columns bound the count. `every` names the groups judged even when no row
 * falls in them (a required size left out): those whose `column` equals the
 * parent row's.
 */
export const countsSchema = z
  .object({
    by: pathSchema,
    every: z.object({ column: refSchema, eq: z.object({ parent: refSchema }).strict() }).strict().optional(),
    min: refSchema,
    max: refSchema,
  })
  .strict();
export type Counts = z.infer<typeof countsSchema>;

/** The largest a child column may add up to across one write: a number, or a column of the settings row. */
const sumMaxSchema = z
  .object({ column: refSchema, max: z.union([z.number().int().min(1), settingRefSchema]) })
  .strict();

/** The fields every level of child rows declares. */
const childEntryShape = {
  /** The child's foreign key to the row it belongs to. */
  via: refSchema,
  writable: z.array(refSchema),
  /** What the reply shows of each child row; without it, the child's key only. */
  select: z.array(refSchema).optional(),
  defaults: z.record(refSchema, z.union([z.string(), z.number(), z.boolean()])).optional(),
  writableValues: z.record(refSchema, valuesSchema).optional(),
  requires: z.array(refSchema).min(1).max(8).optional(),
  /** A whole-number column Adminium numbers 1, 2, 3… in the order the rows were sent. */
  position: refSchema.optional(),
  /** Rows per parent row. */
  min: z.number().int().min(0).optional(),
  max: z.number().int().min(1).max(200),
  agrees: z.array(agreeSchema).min(1).max(8).optional(),
  counts: z.array(countsSchema).min(1).max(2).optional(),
  /** Columns that hold plain text only (no links), as on a create nobody signed in for. */
  plainText: plainTextSchema.optional(),
  /** The most a column may add up to across the rows of one write (a dozen items to an order). */
  sumMax: sumMaxSchema.optional(),
};

const childTablesSchema = <T extends z.ZodTypeAny>(entry: T) =>
  z.record(refSchema, entry).refine((children) => {
    const count = Object.keys(children).length;
    return count >= 1 && count <= 4;
  }, { message: 'one to four child tables at each level' });

/** A child row one level down (an option of a line): no children of its own. */
const grandchildEntrySchema = z.object(childEntryShape).strict();

/** A child row of a create (an order's line), with at most one more level below it. */
export const childEntrySchema = z.object({ ...childEntryShape, children: childTablesSchema(grandchildEntrySchema).optional() }).strict();
export type ChildEntry = z.infer<typeof childEntrySchema>;

/**
 * The person a create is made for, found by the address typed into `email`
 * or made when none has it (`fill` sets the new row's columns from the
 * entry's), linked through `link`. The guest is never told which happened.
 */
const findOrCreateSchema = z
  .object({
    table: refSchema,
    email: refSchema,
    link: refSchema,
    fill: z
      .record(refSchema, refSchema)
      .refine((fill) => Object.keys(fill).length <= 4, { message: 'a new person is filled from at most four columns' })
      .optional(),
    /**
     * On a change through the row's own link: find the person only on the
     * save that moves the row to this state (a ticket accepted), not on every
     * save made while the row has no person.
     */
    on: z.object({ to: z.string().min(1).max(64) }).strict().optional(),
  })
  .strict();

/**
 * Columns left out of a row: once it has a holder who is not the reader
 * (`unlessHolder`, on rows read through a parent), and — `when` — while the
 * row, or a row one of its links points at, holds these values (a ticket of
 * an order not paid yet; a ticket a friend has not taken yet, read by its own
 * link). A `when` holds for the readers of the key the entry is served
 * through; a holder is every reader's.
 */
const withholdSchema = z
  .object({
    columns: z.array(refSchema).min(1).max(8),
    unlessHolder: refSchema.optional(),
    when: z
      .object({ where: z.array(stateConditionSchema).min(1).max(8).optional(), linked: z.array(linkedConditionSchema).min(1).max(4).optional() })
      .strict()
      .refine((when) => when.where !== undefined || when.linked !== undefined, { message: 'a when names where, linked, or both' })
      .optional(),
  })
  .strict()
  .refine((w) => w.unlessHolder !== undefined || w.when !== undefined, { message: 'a withhold names its holder, a when, or both' });

/**
 * What "delete my details" empties on a person's own row, and the time it
 * stamps. `links`: it also stops the person's rows' own links (each gets a
 * new code, which closes every session its old one opened) — an app's choice.
 */
const forgetSchema = z.object({ columns: z.array(refSchema).min(1).max(16), stamp: refSchema.optional(), links: z.literal(true).optional() }).strict();

/**
 * "Make a new link" for a signed-in person's row: its own link (`column`)
 * gets a new code, which closes every session the old one opened, and the new
 * link is emailed as the app's outbox message `kind` (sent once per code).
 * On a row's own link it is "send it again": another link of the row (the
 * one a confirmation email carries) is made again and mailed to the row's own
 * address, only while the row holds `when`.
 */
const newLinkSchema = z
  .object({ column: refSchema, kind: z.string().min(1).max(40), when: z.object({ where: z.array(stateConditionSchema).min(1).max(8) }).strict().optional() })
  .strict();

export const publicAccessSchema = z
  .object({
    table: refSchema,
    kind: z.enum(['records', 'availability']).optional(),
    methods: z.array(z.enum(['GET', 'POST', 'PATCH'])).min(1),
    select: z.array(refSchema).optional(),
    writable: z.array(refSchema).optional(),
    filters: z.array(z.union([valueFilterSchema, relativeFilterSchema])).optional(),
    /** Values the server writes, whatever the browser sends (`status: confirmed`). */
    defaults: z.record(refSchema, z.union([z.string(), z.number(), z.boolean()])).optional(),
    /** How a person proves who they are on this key (see {@link claimSchema}). */
    claim: claimSchema.optional(),
    /**
     * The rows of a claimed person: `column` holds the key of the row the key's
     * identity entry on `table` claims. `optional` on a create lets it go
     * through with no session at all (a first visit, by someone not yet on file).
     */
    claimedBy: z.object({ table: refSchema, column: refSchema, optional: z.literal(true).optional() }).strict().optional(),
    /** The session this entry needs: `verified` once the emailed code is confirmed. */
    level: z.enum(['lookup', 'verified']).optional(),
    /** A create for a person found (or made) by the address typed (see `findOrCreateSchema`). */
    identity: findOrCreateSchema.optional(),
    /** A create answers, once, the new row's own link: this share-code column's code. */
    shareLink: refSchema.optional(),
    /** On an identity entry: what "delete my details" empties. */
    forget: forgetSchema.optional(),
    /** On a signed-in person's rows: "Make a new link" for a row's own link. */
    newLink: newLinkSchema.optional(),
    /**
     * Rows readable only where a parent entry (the one on `table`, on the same
     * key) reads the row they belong to. `via` is this table's foreign key to
     * the parent, or the parent's foreign key to this table.
     */
    visibleWith: z.object({ table: refSchema, via: refSchema }).strict().optional(),
    /** File columns a claimed person may download (the file the row names, never by its id). */
    files: z.array(refSchema).min(1).max(8).optional(),
    /** The kinds of document a claimed person may list and open for these rows. */
    documents: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/, 'a document kind')).min(1).max(8).optional(),
    /**
     * Rows a person must prove more to see. An identity marked sensitive shows
     * only its own `select` on a lookup; each entry it claims must then say
     * whether it is sensitive itself — and, when it is not, `reason` why not.
     */
    sensitive: z.boolean().optional(),
    reason: z.string().min(1).max(200).optional(),
    /** On an optional claim, the columns a session's create empties (the details of a first visit). */
    onClaim: z.object({ clear: z.array(refSchema).min(1).max(12) }).strict().optional(),
    /** The only values a browser may write into these columns. */
    writableValues: z.record(refSchema, valuesSchema).optional(),
    /**
     * Columns a write through this entry must fill: accepting a proposal
     * carries the name typed as a signature, and a write without it is
     * refused rather than stored half.
     */
    requires: z.array(refSchema).min(1).max(8).optional(),
    /**
     * The state a row must be IN to be changed — part of the update itself,
     * never of a read, so a finished visit still lists but cannot be moved.
     * `from-now` on a time: only while it is still ahead. `{within: 60}` on a
     * time: no more than 60 minutes ahead, and a change made earlier is
     * refused with that time (`PUBLIC_TOO_EARLY`), even when `select` leaves
     * it out — naming the window is agreeing to that. On a date,
     * `from-today` is today or later on the venue's calendar and
     * `before-today` is past (a proposal still in date may be accepted; one
     * past it may ask for a new price).
     */
    writableWhen: z
      .record(refSchema, z.union([whenValuesSchema, z.literal('from-now'), z.literal('from-today'), z.literal('before-today'), timeWindowSchema, momentWindowSchema]))
      .optional(),
    /** A proof-of-work the browser solves before the write (or the claim) is taken. */
    humanCheck: z.literal(true).optional(),
    /** The rows a create carries with it, by child table (see `childEntrySchema`). */
    children: childTablesSchema(childEntrySchema).optional(),
    /** Checks the created row's own values must pass (guests no more than a room sleeps). */
    agrees: z.array(agreeSchema).min(1).max(8).optional(),
    /** The same write may be asked for without writing, to see every figure Adminium would work out. */
    dryRun: z.literal(true).optional(),
    /** A money column the write may send its expected value for; a different figure writes nothing. */
    expect: refSchema.optional(),
    /** A column holding a key the browser mints, so a retried write lands on the same row. */
    clientKey: refSchema.optional(),
    /** A create answers where the new row stands: the rows ordered at or before it. */
    rank: z
      .object({ orderBy: refSchema, where: z.object({ column: refSchema, eq: scalarSchema }).strict().optional() })
      .strict()
      .optional(),
    /** A claimed person may hold at most `n` rows whose column is one of `values` (and, with `upcoming`, still ahead). */
    maxOpen: z
      .object({ column: refSchema, values: valuesSchema, n: z.number().int().min(1).max(50), upcoming: refSchema.optional() })
      .strict()
      .optional(),
    /**
     * The limits on a create nobody signed in for: per phone number or
     * address a day, per key an hour, and columns that hold plain text only.
     */
    anonymous: z
      .object({
        perValue: z.object({ columns: z.array(refSchema).min(1).max(4), n: z.number().int().min(1).max(20) }).strict().optional(),
        perKeyHour: z.number().int().min(1).max(1000).optional(),
        /**
         * At most this many an hour from one visitor (an IPv6 subscriber's
         * whole /64) through this entry: never more than the 60 every
         * visitor is held to on any key, only fewer.
         */
        perIpHour: z.number().int().min(1).max(60).optional(),
        plainText: plainTextSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * The limits on a change a guest makes, signed in or not: per value a day
     * (each change that writes one of the columns counts against the value it
     * writes — an address a ticket is sent on to), and columns that hold
     * plain text only (the name it is sent to).
     */
    limits: z
      .object({
        perValue: z.object({ columns: z.array(refSchema).min(1).max(4), n: z.number().int().min(1).max(20) }).strict().optional(),
        plainText: plainTextSchema.optional(),
      })
      .strict()
      .refine((l) => l.perValue !== undefined || l.plainText !== undefined, { message: 'limits name a per-value cap, plain-text columns, or both' })
      .optional(),
    /** Refused while a bool in the settings row is false (only for a session-less create with `anonymous`). */
    requireSetting: z
      .array(settingRefSchema.extend({ when: z.literal('anonymous').optional() }).strict())
      .max(4)
      .optional(),
    /** Which browser key serves the entry: `customer`, or one of `publicKeys`. */
    key: keyNameSchema.optional(),
    /**
     * The confirmation Adminium emails when a guest creates a row here: the
     * column holding their address, the columns the email shows, the app's
     * one-row venue table, and the path under the guest side that manages it.
     */
    confirm: z
      .object({
        template: z.enum(['booking-confirmation']),
        to: refSchema,
        code: refSchema.optional(),
        when: refSchema.optional(),
        party: refSchema.optional(),
        name: refSchema.optional(),
        venue: z
          .object({ table: refSchema, name: refSchema.optional(), address: refSchema.optional(), phone: refSchema.optional() })
          .strict()
          .optional(),
        link: z.string().max(200).optional(),
      })
      .strict()
      .optional(),
    /** Availability: which of the table's limits it answers (absent: the first). */
    rule: z.number().int().min(0).max(2).optional(),
    /** Availability: say what is left, but only when little is (below a number, or a share of the pool). */
    showLeft: z
      .union([
        z.object({ below: z.number().int().min(1) }).strict(),
        z.object({ belowShare: z.number().int().min(1).max(100) }).strict(),
      ])
      .optional(),
    /** Availability of a parent limit: the column of the pool's rows a page asks by (an event's ticket types). */
    under: refSchema.optional(),
    /**
     * Rows readable only with a code that unlocks them: a row of `table`
     * whose `column` holds the typed code, and whose `link` points at the row
     * (a presale code revealing its ticket type).
     */
    unlockBy: z
      .object({ table: refSchema, column: refSchema, link: refSchema, where: codeWhereSchema.optional() })
      .strict()
      .optional(),
    /** Image columns any visitor may see, through the rows this entry reads. */
    pictures: z.array(refSchema).min(1).max(4).optional(),
    /**
     * On rows reached through a parent: `columns` are left out unless
     * `unlessHolder` is empty or names the session's own person (a ticket
     * sent to a friend keeps its code from the buyer who sent it).
     */
    withhold: withholdSchema.optional(),
  })
  .strict();
export type PublicAccess = z.infer<typeof publicAccessSchema>;

/**
 * A browser key besides `customer`. It is never published to the app's public
 * side: the staff side hands it only to someone signed in with `role`, and
 * every request on it must carry that person's staff session too — a token
 * copied out of the page opens nothing on its own. `enabledBy` switches it
 * off with a bool in the settings row.
 */
export const publicKeySchema = z
  .object({
    /**
     * Required, except on a key whose identity is a token: that key opens one
     * row to whoever holds its link, and reads nothing else.
     */
    requiresStaff: z.object({ role: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a role key') }).strict().optional(),
    enabledBy: settingRefSchema.optional(),
    /**
     * The key's budget a minute when its app meets its peak (a show going on
     * sale): from Adminium's own (3,000 reads, 300 writes) up to five times
     * that. Each visitor still gets a twelfth of it. Read at install.
     */
    peak: z
      .object({ reads: z.number().int().min(3000).max(15_000), writes: z.number().int().min(300).max(1500) })
      .strict()
      .optional(),
  })
  .strict();
export const publicKeysSchema = z
  .record(keyNameSchema, publicKeySchema)
  .refine((keys) => !(CUSTOMER_KEY in keys) || Object.keys(keys[CUSTOMER_KEY] ?? {}).every((field) => field === 'peak'), {
    message: '"customer" is the app\'s own key: only its peak is said here',
  });
export type PublicKey = z.infer<typeof publicKeySchema>;

interface PublicAccessContext {
  index: TableIndex;
  /** Columns Adminium decides on a table: a browser may never write them. */
  decided: (table: string) => ReadonlySet<string>;
  /** The columns of a table a money figure Adminium works out reads (a formula, a total, a copy into one). */
  figures?: (table: string) => ReadonlySet<string>;
  /** Whether the app's outbox writes a message when a row of the table is created. */
  mailsOnCreate?: (table: string) => boolean;
  /** Whether the table carries a capacity or a booking rule to answer availability from. */
  answersAvailability: (table: string) => boolean;
  /** The table's limits, as it declares them (absent: the caller does not say). */
  capacityOf?: (table: string) => Capacity | undefined;
  publicKeys: Readonly<Record<string, PublicKey>> | undefined;
  roles: readonly { key: string; screensOnly?: boolean | undefined; cloneFrom?: string | undefined; permissions?: readonly string[] | undefined }[];
  /** The app's outbox, for a new link it emails (absent: the app has none). */
  outbox?:
    | { table: string; kinds: Readonly<Record<string, string>>; columns: { repeatKey?: string | undefined }; links?: Readonly<Record<string, string>> | undefined; recipient?: ResendOutbox['recipient'] | undefined; producers?: ResendOutbox['producers'] }
    | undefined;
}

/** A row's own link a person reaches: its table, the code column that opens it, and the columns that link its rows to the person. */
export interface PersonOwnLink {
  table: string;
  column: string;
  people: string[];
}

/**
 * The own links of the rows a person of `identityTable` holds: each table a
 * token claims with `own: true`, by its code column, and the columns of it
 * that point at the person — the ones a signed-in read claims by, or a found
 * person is linked through.
 */
export function ownLinksOfPerson(entries: readonly PublicAccess[], identityTable: string): PersonOwnLink[] {
  const out: PersonOwnLink[] = [];
  for (const entry of entries) {
    const claim = entry.claim;
    if (claim === undefined || !('by' in claim) || claim.own !== true) continue;
    if (out.some((link) => link.table === entry.table && link.column === claim.column)) continue;
    const people = new Set<string>();
    for (const other of entries) {
      if (other.table !== entry.table) continue;
      if (other.claimedBy !== undefined && other.claimedBy.table === identityTable) people.add(other.claimedBy.column);
      if (other.identity !== undefined && other.identity.table === identityTable) people.add(other.identity.link);
    }
    if (people.size > 0) out.push({ table: entry.table, column: claim.column, people: [...people].sort() });
  }
  return out;
}

/** The outbox as a resend reads it: its recipient, its links and the producers that declare a kind's recipient. */
export interface ResendOutbox {
  table: string;
  recipient: { table: string; via: string; email: string; fallback?: { via: string; email: string } | undefined };
  producers?:
    | readonly { kind: string; link: string; hold?: boolean | undefined; repeatBy?: string | undefined; recipient?: { setting: unknown } | { column: string; name?: string | undefined; language?: string | undefined } | undefined }[]
    | undefined;
}

/** Where a resend of a row's own link is read from: the kind's column recipient, or none (the outbox's own), and the columns the address comes from. */
export interface ResendAddress {
  /** The kind's own producer mails an address a column of the row holds. */
  recipient?: { column: string; name?: string | undefined; language?: string | undefined } | undefined;
  /** The row's columns the address is read from (or through). */
  columns: string[];
  /** The person's table and address column, when the address is read from the person the row links. */
  person?: { table: string; column: string } | undefined;
}

/** A table's columns as a resend reads them: each name, and the table it references (null: no link). */
export type ResendColumns = (table: string) => readonly { name: string; references: string | null }[] | undefined;

/**
 * How a message of `kind` about a row of `table` is addressed when it is
 * sent again through the row's own link — as the kind's own producer
 * declares it (the first producer of the kind, as the sender reads it), and
 * only from the row: a column of the row, the person it links (the column
 * named as the outbox's recipient link, else its one key to the recipient's
 * table), or the outbox's fallback through this table. Null when nothing on
 * the row addresses it (a setting's address, a column of another row, two
 * keys to the recipient). The validator and the server ask this one function.
 */
export function resendAddressOf(outbox: ResendOutbox, kind: string, table: string, columnsOf: ResendColumns): ResendAddress | null {
  const find = (at: string, name: string) => columnsOf(at)?.find((c) => c.name === name);
  const declared = (outbox.producers ?? []).find((producer) => producer.kind === kind);
  const own = declared?.recipient;
  if (own !== undefined && 'setting' in own) return null;
  if (own !== undefined) {
    // The producing row is the one the producer links: it must be this row.
    if (find(outbox.table, declared!.link)?.references !== table || find(table, own.column) === undefined) return null;
    return { recipient: { ...own }, columns: [own.column] };
  }
  const columns: string[] = [];
  let person: ResendAddress['person'];
  const keys = (columnsOf(table) ?? []).filter((c) => c.references === outbox.recipient.table);
  const link = find(table, outbox.recipient.via) !== undefined ? outbox.recipient.via : keys.length === 1 ? keys[0]!.name : undefined;
  if (link !== undefined) {
    columns.push(link);
    person = { table: outbox.recipient.table, column: outbox.recipient.email };
  }
  const fallback = outbox.recipient.fallback;
  if (fallback !== undefined && find(outbox.table, fallback.via)?.references === table && find(table, fallback.email) !== undefined) columns.push(fallback.email);
  if (columns.length === 0) return null;
  return { columns, ...(person === undefined ? {} : { person }) };
}

/** Everything in `publicAccess` and `publicKeys` that names something undeclared, or breaks a rule. */
export function publicAccessIssues(entries: readonly PublicAccess[], ctx: PublicAccessContext): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  const has = index.has;

  for (const [name, key] of Object.entries(ctx.publicKeys ?? {})) {
    const at = ['publicKeys', name];
    // The app's own key, named only for its peak: nothing more to check.
    if (name === CUSTOMER_KEY) continue;
    if (key.requiresStaff === undefined) {
      // No one signs this key in: it may only open one row by its token, and read.
      const identity = entries.find((entry) => (entry.key ?? CUSTOMER_KEY) === name && entry.claim !== undefined);
      if (identity?.claim === undefined || claimKind(identity.claim) !== 'token') {
        out.push({ path: [...at, 'requiresStaff'], message: `a key no staff signs in opens one row by its token: "${name}" needs an entry that claims by token` });
      }
      // The owner's own link may change its row (what it may change is checked below); any other only reads.
      const ownLink = identity?.claim !== undefined && 'by' in identity.claim && identity.claim.own === true;
      entries.forEach((entry, i) => {
        if (!ownLink && (entry.key ?? CUSTOMER_KEY) === name && entry.methods.some((method) => method !== 'GET')) {
          out.push({ path: ['publicAccess', i, 'methods'], message: `"${name}" opens a row to whoever holds its link, so it only reads` });
        }
      });
      if (!entries.some((entry) => entry.key === name)) out.push({ path: at, message: `no entry is served through "${name}"` });
      // Nothing would read it: a shared link is switched off in its own row (the claim's `stopped`).
      if (key.enabledBy !== undefined) {
        out.push({ path: [...at, 'enabledBy'], message: `"${name}" opens a row by its link, which is switched off in that row, not by a setting` });
      }
      continue;
    }
    const role = ctx.roles.find((candidate) => candidate.key === key.requiresStaff!.role);
    if (role === undefined) {
      out.push({ path: [...at, 'requiresStaff', 'role'], message: `"${key.requiresStaff.role}" is not one of the app's roles` });
    } else if (role.screensOnly !== true || role.cloneFrom !== undefined || (role.permissions ?? []).some((grant) => grant !== 'app:@:staff')) {
      // The screen stands where anyone can walk up to it: its sign-in may open the app's screens and nothing else.
      out.push({
        path: [...at, 'requiresStaff', 'role'],
        message: `"${role.key}" signs in a screen anyone can walk up to, so it opens only the app's screens: screensOnly, and no grant but app:@:staff`,
      });
    }
    if (key.enabledBy !== undefined) {
      const column = index.column(key.enabledBy.table, key.enabledBy.column);
      if (column?.type !== 'bool') {
        out.push({ path: [...at, 'enabledBy'], message: `"${key.enabledBy.table}.${key.enabledBy.column}" is not a bool of this app` });
      }
    }
    if (!entries.some((entry) => entry.key === name)) {
      out.push({ path: at, message: `no entry is served through "${name}"` });
    }
  }

  // One identity per key: a session is minted by one key, on one table.
  const identities = new Map<string, { entry: PublicAccess; index: number }>();
  entries.forEach((entry, i) => {
    if (entry.claim === undefined) return;
    const key = entry.key ?? CUSTOMER_KEY;
    if (identities.has(key)) {
      out.push({ path: ['publicAccess', i, 'claim'], message: `the "${key}" key already claims through entry ${String(identities.get(key)!.index)}; a key has one identity` });
    } else {
      identities.set(key, { entry, index: i });
    }
  });

  /*
   * A shared link's code opens its row, and leaves only as that link: no
   * entry on its table — the link's own, another key's, one anyone may call —
   * shows it, filters by it or orders by it. One that did would hand out
   * every link its table has, or read one back a character at a time.
   */
  const shareCodes = new Map<string, Set<string>>();
  for (const entry of entries) {
    if (entry.claim === undefined || claimKind(entry.claim) !== 'token' || !('by' in entry.claim)) continue;
    shareCodes.set(entry.table, (shareCodes.get(entry.table) ?? new Set()).add(entry.claim.column));
  }
  entries.forEach((entry, i) => {
    const codes = shareCodes.get(entry.table);
    if (codes === undefined) return;
    const own = entry.claim !== undefined && 'by' in entry.claim ? entry.claim.column : undefined;
    const named: [string, string][] = [
      ...(entry.select ?? []).map((ref) => ['select', ref] as [string, string]),
      ...(entry.filters ?? []).map((filter) => ['filters', filter.column] as [string, string]),
      ...(entry.rank === undefined ? [] : [['rank', entry.rank.orderBy] as [string, string], ...(entry.rank.where === undefined ? [] : [['rank', entry.rank.where.column] as [string, string]])]),
    ];
    for (const [list, ref] of named) {
      // The link's own entry naming it in `select` is said below, in the words it has always had.
      if (!codes.has(ref) || (list === 'select' && ref === own)) continue;
      out.push({ path: ['publicAccess', i, list], message: `"${entry.table}.${ref}" is the code a shared link opens its row with: no entry shows, filters or orders by it` });
    }
  });

  entries.forEach((entry, i) => {
    const at = (...rest: (string | number)[]) => ['publicAccess', i, ...rest];
    const table = index.table(entry.table);
    if (table === undefined) {
      out.push({ path: at('table'), message: `"${entry.table}" is not a table of this app` });
      return;
    }
    const column = (ref: string) => index.column(entry.table, ref);
    const key = entry.key ?? CUSTOMER_KEY;
    if (key !== CUSTOMER_KEY && ctx.publicKeys?.[key] === undefined) {
      out.push({ path: at('key'), message: `"${key}" is not one of the app's publicKeys` });
    }

    for (const list of ['select', 'writable'] as const) {
      for (const ref of entry[list] ?? []) {
        if (!has(entry.table, ref)) out.push({ path: at(list), message: `"${entry.table}" has no column "${ref}"` });
      }
    }
    // An entry anyone may call (no claim, no parent, no session asked) shows no personal data: the install refuses it too.
    const sessionOnly = entry.level !== undefined && entry.claim === undefined && entry.claimedBy === undefined && entry.visibleWith === undefined;
    const anyone = entry.claim === undefined && entry.visibleWith === undefined && (entry.claimedBy === undefined || entry.claimedBy.optional === true) && !sessionOnly;
    // An availability entry shows no row, whatever it names.
    if (anyone && entry.kind !== 'availability') {
      // No select shows every column but a code Adminium makes and a secret, as the install reads it.
      const shown =
        entry.select ??
        (table.columns as readonly { ref: string; rules?: Record<string, unknown> | undefined }[]).filter((c) => c.rules?.['code'] === undefined && c.rules?.['secret'] !== true).map((c) => c.ref);
      for (const ref of shown) {
        const personal = personalColumn(table as Parameters<typeof personalColumn>[0], ref);
        if (personal !== null) {
          out.push({
            path: at('select'),
            message:
              personal === 'marked'
                ? `"${entry.table}.${ref}" is personal data, and anyone may call this entry, so it is not selected`
                : `"${entry.table}.${ref}" is read as personal data by its name, and anyone may call this entry, so it is not selected (a column that is not personal says \`personal: false\`)`,
          });
        }
      }
    }
    for (const ref of [
      ...(entry.claim !== undefined && 'match' in entry.claim ? entry.claim.match : []),
      ...(entry.filters ?? []).map((f) => f.column),
      ...Object.keys(entry.defaults ?? {}),
    ]) {
      if (!has(entry.table, ref)) out.push({ path: at(), message: `"${entry.table}" has no column "${ref}"` });
    }

    const writable = new Set(entry.writable ?? []);
    const patches = entry.methods.includes('PATCH');
    const creates = entry.methods.includes('POST');
    const identity = identities.get(key);

    // A change to an existing row, from a browser, only behind a claim: the
    // guest reaches their own row (or a child of it) and nothing else.
    if (patches && entry.claim === undefined && entry.visibleWith === undefined && (entry.claimedBy === undefined || entry.claimedBy.optional === true)) {
      out.push({ path: at('methods'), message: 'PATCH is allowed only with a claim' });
    }
    // Nothing a server decides may be written by a browser.
    const decided = ctx.decided(entry.table);
    for (const ref of writable) {
      if (decided.has(ref)) out.push({ path: at('writable'), message: `"${ref}" is decided by Adminium and cannot be written publicly` });
    }
    // A filter narrows every read AND write, so a column it names cannot also
    // change: the row would leave the endpoint mid-write — unless both ends
    // of the change are pinned, the state it starts from (`writableWhen`) and
    // the values it may take (`writableValues`): a kiosk reads booked to
    // ready and moves booked to checked in.
    for (const filter of entry.filters ?? []) {
      const pinned = entry.writableWhen?.[filter.column] !== undefined && entry.writableValues?.[filter.column] !== undefined;
      if (writable.has(filter.column) && !pinned) {
        out.push({
          path: at('filters'),
          message: `"${filter.column}" is filtered and writable; pin the state it changes from (writableWhen) and the values it may take (writableValues)`,
        });
      }
      if (filter.op === 'today' || filter.op === 'from-today') {
        const type = column(filter.column)?.type;
        if (type !== undefined && type !== 'date' && type !== 'timestamptz') {
          out.push({ path: at('filters'), message: `"${filter.column}" is not a date or a timestamptz, so "${filter.op}" cannot apply` });
        }
      }
    }

    if (entry.claim !== undefined) {
      const claim = entry.claim;
      if (entry.claimedBy !== undefined) out.push({ path: at('claimedBy'), message: 'an identity is not also claimed by another' });
      if (entry.visibleWith !== undefined) out.push({ path: at('visibleWith'), message: 'an identity is not also visible through another' });
      if ('email' in claim && claim.email !== undefined) {
        const email = column(claim.email);
        if (email === undefined) out.push({ path: at('claim', 'email'), message: `"${entry.table}" has no column "${claim.email}"` });
        else if (email.type !== 'text') out.push({ path: at('claim', 'email'), message: `"${entry.table}.${email.ref}" is not a text column` });
      }
      const kind = claimKind(claim);
      // Anyone can type an address: the link is only as hard to farm as its request.
      if (kind === 'link' && entry.humanCheck !== true) {
        out.push({ path: at('humanCheck'), message: 'a sign-in link is emailed on request, so the request asks the human check' });
      }
      if (kind === 'token' && 'by' in claim) {
        const token = column(claim.column) as (ReturnType<typeof column> & { rules?: { code?: { length: number } } }) | undefined;
        if (token === undefined) out.push({ path: at('claim', 'column'), message: `"${entry.table}" has no column "${claim.column}"` });
        else if (token.type !== 'text' || (token.rules?.code?.length ?? 0) < 16) {
          out.push({ path: at('claim', 'column'), message: `"${entry.table}.${claim.column}" is the link's secret: a text column Adminium fills with a 16-character code` });
        }
        // The code opens the row; showing it back would hand the link to whatever reads the page.
        if (entry.select?.includes(claim.column) === true) {
          out.push({ path: at('select'), message: `"${entry.table}.${claim.column}" is the link's secret: it opens the row, and is never shown` });
        }
        if (claim.expires !== undefined) {
          const found = column(claim.expires);
          if (found === undefined) out.push({ path: at('claim', 'expires'), message: `"${entry.table}" has no column "${claim.expires}"` });
          else if (found.type !== 'date' && found.type !== 'timestamptz') out.push({ path: at('claim', 'expires'), message: `"${entry.table}.${claim.expires}" is not a date` });
        }
        if (claim.stopped !== undefined && column(claim.stopped)?.type !== 'bool') {
          out.push({ path: at('claim', 'stopped'), message: `"${entry.table}.${claim.stopped}" is not a bool of this app` });
        }
        if (key === CUSTOMER_KEY || ctx.publicKeys?.[key]?.requiresStaff !== undefined) {
          out.push({ path: at('key'), message: 'a token opens its row to whoever holds the link, on a key of its own that no staff signs in' });
        }
      }
    }

    if (entry.claimedBy !== undefined) {
      const by = entry.claimedBy;
      if (identity === undefined) {
        out.push({ path: at('claimedBy'), message: `the "${key}" key has no identity entry to be claimed by` });
      } else if (identity.entry.table !== by.table) {
        out.push({ path: at('claimedBy', 'table'), message: `the "${key}" key claims "${identity.entry.table}", not "${by.table}"` });
      }
      const link = column(by.column);
      if (link === undefined) {
        out.push({ path: at('claimedBy', 'column'), message: `"${entry.table}" has no column "${by.column}"` });
      } else if (entry.table === by.table ? link.role !== 'pk' : link.type !== 'fk' || link.references !== by.table) {
        out.push({
          path: at('claimedBy', 'column'),
          message:
            entry.table === by.table
              ? `"${by.column}" is not the key of "${entry.table}"`
              : `"${entry.table}.${by.column}" does not point at "${by.table}"`,
        });
      }
      if (writable.has(by.column)) out.push({ path: at('writable'), message: `"${by.column}" is filled from the claim and cannot be written` });
      if (by.optional === true && (entry.methods.length !== 1 || !creates)) {
        out.push({ path: at('claimedBy', 'optional'), message: 'only a create can go through without a session' });
      }
      if (entry.select === undefined) {
        out.push({ path: at('select'), message: 'a claimed entry lists what it shows; without select it would show every column' });
      }
      // The sensitive rule: the identity decides, each child answers.
      if (identity?.entry.sensitive === true && entry.sensitive === undefined) {
        out.push({ path: at('sensitive'), message: `"${identity.entry.table}" is sensitive, so this entry says whether it is too` });
      }
    } else {
      for (const name of ['level', 'onClaim', 'maxOpen'] as const) {
        // A level on an entry with no claim of its own: a read for a session's holder alone (checked below).
        if (name === 'level' && entry.claim === undefined) continue;
        if (entry[name] !== undefined) out.push({ path: at(name), message: `${name} applies to an entry with claimedBy` });
      }
    }

    // A session opened by an emailed link is verified, and every entry it reads says so.
    const root = rootIdentity(entries, i, identities);
    if (root !== undefined && root.claim !== undefined && claimKind(root.claim) === 'link' && entry.claim === undefined && entry.level !== 'verified') {
      out.push({ path: at('level'), message: `the "${key}" key signs people in by an emailed link, so this entry is read at level "verified"` });
    }

    if (entry.visibleWith !== undefined) {
      const v = entry.visibleWith;
      if (entry.claimedBy !== undefined) out.push({ path: at('visibleWith'), message: 'an entry is claimed or visible with a parent, not both' });
      const parents = entries.filter((other) => other !== entry && other.table === v.table && (other.key ?? CUSTOMER_KEY) === key && readsRows(other));
      if (parents.length === 0) {
        out.push({ path: at('visibleWith', 'table'), message: `no entry reads "${v.table}" on the "${key}" key` });
      } else if (parents.length > 1) {
        out.push({ path: at('visibleWith', 'table'), message: `more than one entry reads "${v.table}" on the "${key}" key, so the parent is not clear` });
      }
      const down = column(v.via);
      const up = index.column(v.table, v.via);
      const pointsUp = down?.type === 'fk' && down.references === v.table;
      const pointsDown = up?.type === 'fk' && up.references === entry.table;
      if (!pointsUp && !pointsDown) {
        out.push({ path: at('visibleWith', 'via'), message: `neither "${entry.table}.${v.via}" points at "${v.table}" nor "${v.table}.${v.via}" at "${entry.table}"` });
      }
      /*
       * Where the parent points at this table, the parent's column is the
       * link its rows are read by: a browser that could write it would
       * re-point its own row at another person's. On any of the app's keys:
       * one person may hold a session on each.
       */
      if (pointsDown && !pointsUp) {
        entries.forEach((other, j) => {
          if (other.table !== v.table) return;
          const writes =
            (other.writable ?? []).includes(v.via) ||
            Object.prototype.hasOwnProperty.call(other.writableValues ?? {}, v.via) ||
            Object.prototype.hasOwnProperty.call(other.defaults ?? {}, v.via);
          if (writes) {
            out.push({ path: ['publicAccess', j, 'writable'], message: `"${v.table}.${v.via}" is the link a child reads its rows by, so no browser writes it` });
          }
        });
      }
      if (entry.methods.includes('PATCH') && entry.writable === undefined) {
        out.push({ path: at('writable'), message: 'a change through an entry visible with a parent names what it may write' });
      }
      // A child's create names the parent it is made under by its link, which the create proves the session reaches.
      if (creates && pointsUp && !writable.has(v.via)) {
        out.push({ path: at('writable'), message: `this entry creates rows under "${v.table}", so "${v.via}" is writable: the parent a create names` });
      }
      /*
       * A column of the child pointing at the key's own person (a note's
       * `client_id`) is a copy the desk keeps, filled from the parent, never
       * written by a browser — unless it is the link a create-only entry names
       * its parent by (an extra added to the stay the stay's own link opened).
       */
      const person = entries.find((other) => other.claim !== undefined && (other.key ?? CUSTOMER_KEY) === key)?.table;
      if (person !== undefined) {
        for (const ref of entry.writable ?? []) {
          const found = column(ref);
          const namesParent = ref === v.via && creates && !patches;
          if (found?.type === 'fk' && found.references === person && !namesParent) {
            out.push({ path: at('writable'), message: `"${entry.table}.${ref}" points at the signed-in person's own table, so it is filled from the parent and never written publicly` });
          }
        }
      }
      if (hops(entries, i) > 2) out.push({ path: at('visibleWith'), message: 'an entry is at most two steps from the entry its person claims' });
      if (root === undefined) out.push({ path: at('visibleWith'), message: 'the entries it is visible with lead to no claimed person' });
    }
    for (const ref of entry.files ?? []) {
      if (writable.has(ref)) out.push({ path: at('files'), message: `"${ref}" is offered for download, so a browser never writes it` });
      const found = column(ref);
      if (found === undefined) out.push({ path: at('files'), message: `"${entry.table}" has no column "${ref}"` });
      else if (found.type !== 'text') out.push({ path: at('files'), message: `"${entry.table}.${ref}" is not a text column holding a file` });
      if (entry.select !== undefined && !entry.select.includes(ref)) out.push({ path: at('files'), message: `"${ref}" is not one of the columns the entry shows` });
    }
    if ((entry.files !== undefined || entry.documents !== undefined) && entry.claimedBy === undefined && entry.visibleWith === undefined && entry.claim === undefined) {
      out.push({ path: at(entry.files !== undefined ? 'files' : 'documents'), message: 'files and documents are a signed-in person\'s own: the entry needs a claim' });
    }

    // A proved create opened by a claim is only as proved as the claim: the identity asks one too.
    if (entry.humanCheck === true && entry.claimedBy !== undefined && identity !== undefined && identity.entry.humanCheck !== true) {
      out.push({ path: at('humanCheck'), message: `the "${key}" key's identity asks no proof, so this entry's proof could be skipped by claiming first` });
    }
    if (
      entry.level === 'verified' &&
      identity !== undefined &&
      identity.entry.claim !== undefined &&
      claimKind(identity.entry.claim) !== 'link' &&
      !('verify' in identity.entry.claim && identity.entry.claim.verify !== undefined) &&
      !('own' in identity.entry.claim && identity.entry.claim.own === true)
    ) {
      out.push({ path: at('level'), message: `the "${key}" key's identity sends no code, so no session is ever verified` });
    }
    if (entry.sensitive === true && entry.claimedBy !== undefined && entry.level !== 'verified') {
      out.push({ path: at('level'), message: 'a sensitive entry needs a verified session' });
    }
    if ((entry.sensitive === false) !== (entry.reason !== undefined)) {
      out.push({ path: at('reason'), message: 'an entry marked not sensitive says why, and only it does' });
    }

    if (entry.onClaim !== undefined) {
      if (entry.claimedBy?.optional !== true) out.push({ path: at('onClaim'), message: 'onClaim applies to an entry a session is optional on' });
      for (const ref of entry.onClaim.clear) {
        const found = column(ref);
        if (found === undefined) out.push({ path: at('onClaim', 'clear'), message: `"${entry.table}" has no column "${ref}"` });
        else if (found.nullable !== true) out.push({ path: at('onClaim', 'clear'), message: `"${entry.table}.${ref}" is not nullable, so it cannot be emptied` });
      }
    }

    for (const ref of entry.requires ?? []) {
      if (!writable.has(ref)) out.push({ path: at('requires'), message: `"${ref}" is not writable, so a write cannot fill it` });
    }
    const states = (table as { states?: { column: string; moves: Readonly<Record<string, readonly StateMove[]>> } }).states;
    for (const [ref, values] of Object.entries(entry.writableValues ?? {})) {
      if (!writable.has(ref)) out.push({ path: at('writableValues', ref), message: `"${ref}" is not writable` });
      const found = column(ref);
      if (found !== undefined) for (const value of values) {
        if (!valueFits(found, value)) out.push({ path: at('writableValues', ref), message: `${JSON.stringify(value)} is not a value of "${entry.table}.${ref}"` });
        // A guest's write names no state it saw: a state only an undo reaches is never theirs to write.
        else if (states?.column === ref && reachedOnlyByUndo(states, value)) out.push({ path: at('writableValues', ref), message: `every move to ${JSON.stringify(value)} is an undo, which only a person makes` });
      }
    }
    /*
     * A child's create inside a window read from its parent row (an extra
     * added until the arrival day's check-in time): keyed by the link to the
     * parent, every end a time of the parent's. The link names the parent a
     * create is for, so the create writes it; the window is the parent's.
     */
    const createWindow =
      creates &&
      !patches &&
      entry.visibleWith !== undefined &&
      Object.entries(entry.writableWhen ?? {}).every(
        ([ref, when]) =>
          ref === entry.visibleWith!.via &&
          typeof when === 'object' &&
          !Array.isArray(when) &&
          !('within' in when) &&
          [when.after, when.before].some((end) => end !== undefined) &&
          [when.after, when.before].every((end) => end === undefined || end.column !== undefined),
      );
    if (entry.writableWhen !== undefined && !patches && !createWindow) {
      out.push({ path: at('writableWhen'), message: "writableWhen limits a change, and this entry changes nothing (a child's create takes a window read from its parent, keyed by the link)" });
    }
    for (const [ref, when] of Object.entries(entry.writableWhen ?? {})) {
      const found = column(ref);
      if (found === undefined) {
        out.push({ path: at('writableWhen', ref), message: `"${entry.table}" has no column "${ref}"` });
      } else if (when === 'from-now') {
        if (found.type !== 'timestamptz') out.push({ path: at('writableWhen', ref), message: `"from-now" needs a timestamptz, and "${ref}" is not one` });
      } else if (when === 'from-today' || when === 'before-today') {
        if (found.type !== 'date') out.push({ path: at('writableWhen', ref), message: `"${when}" needs a date, and "${ref}" is not one` });
      } else if (!Array.isArray(when) && !('within' in when)) {
        out.push(...windowIssues(entry.table, ref, when, found, index, at('writableWhen', ref)));
        // The dates that open a guest's own window are never theirs to move.
        // A time of day read from the row itself opens it too: a later arrival time typed in would reopen a closed window.
        const rowTime = (time: unknown): string[] =>
          typeof time === 'object' && time !== null && !('table' in time) && !('edge' in time) && typeof (time as { column?: unknown }).column === 'string' ? [(time as { column: string }).column] : [];
        const opening = [
          ref,
          ...[when.after, when.before].flatMap((end) => [
            ...(end !== undefined && end.column === undefined ? rowTime(end.time) : []),
            ...(end?.or ?? []).filter((m) => m.via === undefined).flatMap((m) => [m.column, ...rowTime(m.time)]),
          ]),
        ];
        for (const column of new Set(opening)) {
          if (createWindow && column === ref) continue;
          if (writable.has(column) || entry.writableValues?.[column] !== undefined || entry.defaults?.[column] !== undefined) {
            out.push({ path: at('writableWhen', ref), message: `"${column}" decides when this row may change, so a write through this entry may not set it` });
          }
        }
      } else if (!Array.isArray(when)) {
        if (found.type !== 'timestamptz') out.push({ path: at('writableWhen', ref), message: `"within" needs a timestamptz, and "${ref}" is not one` });
      } else {
        for (const value of when) {
          if (value === null) {
            if (found.nullable !== true) out.push({ path: at('writableWhen', ref), message: `"${entry.table}.${ref}" is never empty` });
          } else if (!valueFits(found, value)) {
            out.push({ path: at('writableWhen', ref), message: `${JSON.stringify(value)} is not a value of "${entry.table}.${ref}"` });
          }
        }
      }
    }
    // The early refusal names one time, so an entry keeps one window.
    const windows = Object.values(entry.writableWhen ?? {}).filter(
      (when) => typeof when === 'object' && !Array.isArray(when) && ('within' in when || when.after !== undefined || when.before !== undefined),
    );
    if (windows.length > 1) {
      out.push({ path: at('writableWhen'), message: 'one time window per entry: a change refused as too early names one time' });
    }
    // A browser that may set a status must be told which statuses: a
    // cancellation is not a licence to mark a visit seen. Held for the new
    // claimed entries; an identity's own PATCH keeps working as it always has.
    if (patches && entry.claimedBy !== undefined) {
      for (const ref of writable) {
        if (column(ref)?.type === 'enum' && entry.writableValues?.[ref] === undefined) {
          out.push({ path: at('writableValues'), message: `"${ref}" is an enum a browser changes; list the values it may set` });
        }
      }
    }

    if (entry.humanCheck === true && !creates && entry.claim === undefined) {
      out.push({ path: at('humanCheck'), message: 'a human check guards a create or a claim, and this entry is neither' });
    }
    if (entry.rank !== undefined) {
      if (!creates) out.push({ path: at('rank'), message: 'a rank is the answer to a create' });
      for (const ref of [entry.rank.orderBy, ...(entry.rank.where === undefined ? [] : [entry.rank.where.column])]) {
        if (!has(entry.table, ref)) out.push({ path: at('rank'), message: `"${entry.table}" has no column "${ref}"` });
      }
    }
    if (entry.maxOpen !== undefined) {
      const max = entry.maxOpen;
      if (!creates) out.push({ path: at('maxOpen'), message: 'maxOpen limits creates' });
      const found = column(max.column);
      if (found === undefined) out.push({ path: at('maxOpen', 'column'), message: `"${entry.table}" has no column "${max.column}"` });
      if (found !== undefined) for (const value of max.values) {
        if (!valueFits(found, value)) out.push({ path: at('maxOpen', 'values'), message: `${JSON.stringify(value)} is not a value of "${entry.table}.${max.column}"` });
      }
      if (max.upcoming !== undefined && column(max.upcoming)?.type !== 'timestamptz') {
        out.push({ path: at('maxOpen', 'upcoming'), message: `"${entry.table}.${max.upcoming}" is not a timestamptz` });
      }
    }
    if (entry.anonymous !== undefined) {
      const caps = entry.anonymous;
      if (!creates) out.push({ path: at('anonymous'), message: 'anonymous limits a create' });
      for (const [name, columns] of [['perValue', caps.perValue?.columns ?? []], ['plainText', (caps.plainText ?? []).map(plainTextRef)]] as const) {
        for (const ref of columns) {
          const found = column(ref);
          if (found === undefined) out.push({ path: at('anonymous', name), message: `"${entry.table}" has no column "${ref}"` });
          else if (found.type !== 'text') out.push({ path: at('anonymous', name), message: `"${entry.table}.${ref}" is not a text column` });
        }
      }
    }
    if (entry.limits !== undefined) {
      const limits = entry.limits;
      if (!patches) out.push({ path: at('limits'), message: 'limits apply to a change (PATCH); a create has anonymous' });
      for (const [name, columns] of [['perValue', limits.perValue?.columns ?? []], ['plainText', (limits.plainText ?? []).map(plainTextRef)]] as const) {
        for (const ref of columns) {
          const found = column(ref);
          if (found === undefined) out.push({ path: at('limits', name), message: `"${entry.table}" has no column "${ref}"` });
          else if (found.type !== 'text') out.push({ path: at('limits', name), message: `"${entry.table}.${ref}" is not a text column` });
          else if (!(entry.writable ?? []).includes(ref)) out.push({ path: at('limits', name), message: `"${ref}" is not writable, so a guest never sends it` });
        }
      }
    }
    for (const [r, setting] of (entry.requireSetting ?? []).entries()) {
      if (index.column(setting.table, setting.column)?.type !== 'bool') {
        out.push({ path: at('requireSetting', r), message: `"${setting.table}.${setting.column}" is not a bool of this app` });
      }
      if (setting.when === 'anonymous' && entry.claimedBy?.optional !== true) {
        out.push({ path: at('requireSetting', r, 'when'), message: 'only an entry a session is optional on is ever anonymous' });
      }
    }

    if (entry.confirm !== undefined) {
      const c = entry.confirm;
      for (const [name, ref] of [['to', c.to], ['code', c.code], ['when', c.when], ['party', c.party], ['name', c.name]] as const) {
        if (ref !== undefined && !has(entry.table, ref)) out.push({ path: at('confirm', name), message: `"${entry.table}" has no column "${ref}"` });
      }
      if (!creates) out.push({ path: at('confirm'), message: 'a confirmation is sent on a create, and this entry creates nothing' });
      if (c.venue !== undefined) {
        if (index.table(c.venue.table) === undefined) {
          out.push({ path: at('confirm', 'venue', 'table'), message: `"${c.venue.table}" is not a table of this app` });
        } else {
          for (const [name, ref] of [['name', c.venue.name], ['address', c.venue.address], ['phone', c.venue.phone]] as const) {
            if (ref !== undefined && !has(c.venue.table, ref)) {
              out.push({ path: at('confirm', 'venue', name), message: `"${c.venue.table}" has no column "${ref}"` });
            }
          }
        }
      }
    }
    if (entry.kind === 'availability') {
      if (!ctx.answersAvailability(entry.table)) out.push({ path: at('kind'), message: `"${entry.table}" declares no capacity or booking to answer from` });
      if (entry.methods.some((method) => method !== 'GET')) out.push({ path: at('methods'), message: 'availability is read-only' });
    }
    out.push(...availabilityShapeIssues(entry, ctx, at));
    if (entry.unlockBy !== undefined) out.push(...unlockIssues(entry, entry.unlockBy, entries, ctx, at));
    if (entry.pictures !== undefined) out.push(...pictureIssues(entry, entry.pictures, entries, ctx, at));
  });
  out.push(...treeIssues(entries, ctx, identities, shareCodes));
  out.push(...personIssues(entries, ctx, identities));
  out.push(...ownAddressAndWithholdIssues(entries, ctx, identities));
  return out;
}

/** `rule`, `showLeft` and `under`: which limit an availability entry answers, and how. */
function availabilityShapeIssues(
  entry: PublicAccess,
  ctx: PublicAccessContext,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const named = (['rule', 'showLeft', 'under'] as const).filter((name) => entry[name] !== undefined);
  if (named.length === 0) return out;
  if (entry.kind !== 'availability') {
    for (const name of named) out.push({ path: at(name), message: `${name} shapes an availability answer, and this entry reads rows` });
    return out;
  }
  if (ctx.capacityOf === undefined) return out;
  const rules = rulesOf(ctx.capacityOf(entry.table));
  if (rules.length === 0) {
    for (const name of named) out.push({ path: at(name), message: `${name} answers a limit, and "${entry.table}" has none` });
    return out;
  }
  const index = entry.rule ?? 0;
  const rule = rules[index];
  if (rule === undefined) {
    out.push({ path: at('rule'), message: `"${entry.table}" has ${String(rules.length)} limit${rules.length === 1 ? '' : 's'}, so rule is 0 to ${String(rules.length - 1)}` });
    return out;
  }
  const kind = kindOf(rule);
  if (entry.showLeft !== undefined && kind === 'slot') {
    out.push({ path: at('showLeft'), message: 'what is left is shown of a pool: a parent or night limit' });
  }
  if (entry.under !== undefined) {
    if (rule.kind !== 'parent') {
      out.push({ path: at('under'), message: 'under asks a parent limit by a column of its pools' });
    } else {
      const target = ctx.index.column(entry.table, rule.via)?.references;
      if (target !== undefined && !ctx.index.has(target, entry.under)) out.push({ path: at('under'), message: `"${target}" has no column "${entry.under}"` });
    }
  }
  if (rule.kind === 'night' && 'size' in rule.pool && rule.pool.size === 1) {
    out.push({ path: at('rule'), message: 'availability answers a pool, not one row' });
  }
  return out;
}

/** An entry that shows rows only with the code that unlocks them. */
function unlockIssues(
  entry: PublicAccess,
  unlock: NonNullable<PublicAccess['unlockBy']>,
  entries: readonly PublicAccess[],
  ctx: PublicAccessContext,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  if (entry.methods.length !== 1 || entry.methods[0] !== 'GET') out.push({ path: at('methods'), message: 'an unlock only reads' });
  for (const name of ['claim', 'claimedBy', 'visibleWith'] as const) {
    if (entry[name] !== undefined) out.push({ path: at(name), message: 'an unlock is its own entry' });
  }
  if (entry.kind === 'availability') out.push({ path: at('kind'), message: 'an unlock is its own entry' });
  if (index.table(unlock.table) === undefined) {
    out.push({ path: at('unlockBy', 'table'), message: `"${unlock.table}" is not a table of this app` });
    return out;
  }
  const link = index.column(unlock.table, unlock.link);
  if (link === undefined) out.push({ path: at('unlockBy', 'link'), message: `"${unlock.table}" has no column "${unlock.link}"` });
  else if (link.type !== 'fk' || link.references !== entry.table) {
    out.push({ path: at('unlockBy', 'link'), message: `"${unlock.table}.${unlock.link}" does not point at "${entry.table}"` });
  }
  const code = index.column(unlock.table, unlock.column) as (ColumnShape & { unique?: true; rules?: { code?: unknown; normalize?: string } }) | undefined;
  if (code === undefined) {
    out.push({ path: at('unlockBy', 'column'), message: `"${unlock.table}" has no column "${unlock.column}"` });
  } else {
    if (code.type !== 'text' || (code.unique !== true && code.rules?.code === undefined)) {
      out.push({ path: at('unlockBy', 'column'), message: `a code finds one row: make "${unlock.table}.${code.ref}" unique (or unique with its scope)` });
    }
    if (code.rules?.code === undefined && code.rules?.normalize !== 'code') {
      out.push({ path: at('unlockBy', 'column'), message: `"${unlock.table}.${code.ref}" is compared as a code: give it normalize "code"` });
    }
    if (shareCodeColumns(entries, unlock.table).includes(code.ref)) {
      out.push({ path: at('unlockBy', 'column'), message: "a shared link's code is never looked up" });
    }
  }
  (unlock.where ?? []).forEach((condition, k) => {
    const path = at('unlockBy', 'where', k);
    const filter = index.column(unlock.table, condition.column);
    if (filter === undefined) out.push({ path: [...path, 'column'], message: `"${unlock.table}" has no column "${condition.column}"` });
    else if ('eq' in condition) {
      if (!valueFits(filter, condition.eq)) out.push({ path: [...path, 'eq'], message: `${JSON.stringify(condition.eq)} is not a value of "${unlock.table}.${filter.ref}"` });
    } else if (filter.type !== 'date' && filter.type !== 'timestamptz') {
      out.push({ path: [...path, 'column'], message: `"${unlock.table}.${filter.ref}" is not a date` });
    }
  });
  return out;
}

/** Pictures every visitor may see: image columns the entry shows, which no browser writes. */
function pictureIssues(
  entry: PublicAccess,
  pictures: readonly string[],
  entries: readonly PublicAccess[],
  ctx: PublicAccessContext,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  if (entry.methods.length !== 1 || entry.methods[0] !== 'GET' || entry.kind === 'availability') {
    out.push({ path: at('pictures'), message: 'pictures are shown through an entry that only reads rows' });
  }
  if (entry.claim !== undefined || entry.claimedBy !== undefined || entry.visibleWith !== undefined) {
    out.push({ path: at('pictures'), message: "pictures are for every visitor; a signed-in person's own files are `files`" });
  }
  // A picture is fetched by an <img>, which carries no session: rows only a code opens are no rows it can show.
  if (entry.unlockBy !== undefined) out.push({ path: at('pictures'), message: 'pictures are for every visitor; rows a code unlocks are read only by whoever gave the code' });
  // Nor rows read by a session's holder alone (an entry with a level and no claim of its own).
  if (entry.level !== undefined && entry.claim === undefined && entry.claimedBy === undefined && entry.visibleWith === undefined) {
    out.push({ path: at('pictures'), message: "pictures are for every visitor; rows read by a signed-in session alone are no picture an <img> can show" });
  }
  if ((entry.key ?? CUSTOMER_KEY) !== CUSTOMER_KEY) out.push({ path: at('key'), message: "pictures are served through the app's customer key" });
  const writes = new Set([...(entry.writable ?? []), ...Object.keys(entry.defaults ?? {})]);
  const shareCodes = shareCodeColumns(entries, entry.table);
  for (const ref of pictures) {
    const found = ctx.index.column(entry.table, ref) as
      | (ColumnShape & { semantic?: string; rules?: { code?: unknown; secret?: boolean; personal?: boolean } })
      | undefined;
    if (found === undefined) {
      out.push({ path: at('pictures'), message: `"${entry.table}" has no column "${ref}"` });
      continue;
    }
    if (found.type !== 'text' || found.semantic !== 'image') {
      out.push({ path: at('pictures'), message: `"${entry.table}.${ref}" is not an image column: text with semantic "image"` });
    }
    if (writes.has(ref)) out.push({ path: at('pictures'), message: `"${ref}" is a picture anyone sees, so a browser never writes it` });
    if (entry.select !== undefined && !entry.select.includes(ref)) out.push({ path: at('pictures'), message: `"${ref}" is not one of the columns the entry shows` });
    if ((entry.files ?? []).includes(ref)) out.push({ path: at('pictures'), message: `"${ref}" is a signed-in person's file, not a picture for everyone` });
    if (found.rules?.secret === true || found.rules?.code !== undefined || shareCodes.includes(ref)) {
      out.push({ path: at('pictures'), message: `"${entry.table}.${ref}" is kept from readers, so it is no picture for everyone` });
    }
    if (found.rules?.personal === true) out.push({ path: at('pictures'), message: `"${entry.table}.${ref}" is personal data, so it is no picture for everyone` });
  }
  return out;
}

/**
 * Whether an entry reads a table's rows: a GET that is not an availability
 * answer (free or full per slot, never a row), so it can be a child's parent.
 */
function readsRows(entry: PublicAccess): boolean {
  return entry.methods.includes('GET') && entry.kind !== 'availability';
}

/**
 * The identity entry an entry's person is claimed through: its own claim,
 * its key's identity for a claimed entry, or — for one visible with a parent —
 * whatever its parent leads to. `undefined` when the chain ends nowhere.
 */
function rootIdentity(
  entries: readonly PublicAccess[],
  index: number,
  identities: ReadonlyMap<string, { entry: PublicAccess; index: number }>,
  seen: ReadonlySet<number> = new Set(),
): PublicAccess | undefined {
  const entry = entries[index]!;
  const key = entry.key ?? CUSTOMER_KEY;
  if (entry.claim !== undefined) return entry;
  if (entry.claimedBy !== undefined) return identities.get(key)?.entry;
  if (entry.visibleWith === undefined || seen.has(index)) return undefined;
  const parent = entries.findIndex(
    (other, i) => i !== index && other.table === entry.visibleWith!.table && (other.key ?? CUSTOMER_KEY) === key && readsRows(other),
  );
  return parent === -1 ? undefined : rootIdentity(entries, parent, identities, new Set([...seen, index]));
}

/** How many `visibleWith` steps an entry is from a claimed entry (a loop counts as too many). */
function hops(entries: readonly PublicAccess[], index: number, seen: ReadonlySet<number> = new Set()): number {
  const entry = entries[index]!;
  if (entry.visibleWith === undefined) return 0;
  if (seen.has(index)) return Number.POSITIVE_INFINITY;
  const key = entry.key ?? CUSTOMER_KEY;
  const parent = entries.findIndex(
    (other, i) => i !== index && other.table === entry.visibleWith!.table && (other.key ?? CUSTOMER_KEY) === key && readsRows(other),
  );
  return parent === -1 ? 1 : 1 + hops(entries, parent, new Set([...seen, index]));
}

/**
 * Everything wrong with a window read from moments: keyed by a date or a time
 * of the row, its ends name no column and no linked condition; keyed by a
 * link, each end names the linked row's column.
 */
function windowIssues(
  table: string,
  key: string,
  when: z.infer<typeof momentWindowSchema>,
  found: { type: string; references?: string | undefined },
  index: TableIndex,
  path: (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const linked = found.type === 'fk';
  if (!linked && found.type !== 'date' && found.type !== 'timestamptz') {
    out.push({ path, message: `"${table}.${key}" is neither a date, a time nor a link, so no window is read from it` });
    return out;
  }
  for (const side of ['after', 'before'] as const) {
    const end = when[side];
    if (end === undefined) continue;
    if (linked && end.column === undefined) {
      out.push({ path: [...path, side, 'column'], message: `"${key}" is a link: name the column of the row it points at` });
      continue;
    }
    if (!linked && end.column !== undefined) {
      out.push({ path: [...path, side, 'column'], message: `the window is "${table}.${key}" itself, so it names no other column` });
      continue;
    }
    out.push(...momentIssues(table, windowMoment(key, end, linked), index, [...path, side]));
  }
  if (when.where !== undefined) {
    if (!linked || found.references === undefined || index.table(found.references) === undefined) {
      out.push({ path: [...path, 'where'], message: `conditions on a linked row are keyed by a link of "${table}"` });
    } else {
      const target = found.references;
      when.where.forEach((condition, w) => out.push(...conditionIssues(target, condition, index, [...path, 'where', w])));
    }
  }
  return out;
}

/* ── a write with its child rows, a person found by address ──────────────── */

/** What the checks below read of a column: its shape, and the rules the manifest gives it. */
interface RuledColumn extends ColumnShape {
  unique?: true | undefined;
  default?: unknown;
  rules?:
    | {
        copy?: { via: string; from: string } | undefined;
        formula?: unknown;
        perNight?: { rate: { via: string } } | undefined;
        stamp?: { set: unknown } | undefined;
        sequence?: unknown;
        code?: { length: number } | undefined;
        validation?: { min?: number | undefined; max?: number | undefined; format?: string | undefined; maxLength?: number | undefined } | undefined;
        normalize?: string | undefined;
        secret?: boolean | undefined;
      }
    | undefined;
}

/** What the checks below read of a table. */
interface RuledTable {
  ref: string;
  columns: readonly RuledColumn[];
  capacity?: unknown;
  booking?: unknown;
  states?: { column: string } | undefined;
}

type Path = (string | number)[];

const ruledTable = (index: TableIndex, ref: string) => index.table(ref) as RuledTable | undefined;
const ruledColumn = (index: TableIndex, table: string, ref: string) => index.column(table, ref) as RuledColumn | undefined;
const NUMBERS = ['int', 'bigint', 'decimal', 'money', 'float'];

/** Whether a value fits a column an agreement compares: a key (of any type) is a number or a text. */
function agreeValueFits(column: ColumnShape, value: unknown): boolean {
  if (column.type === 'fk' || column.role === 'pk') return typeof value === 'number' || typeof value === 'string';
  return valueFits(column, value);
}

/** Whether two columns can be compared: two keys of one table, two numbers, or two texts. */
function comparable(a: ColumnShape, b: ColumnShape, index: TableIndex): boolean {
  // A foreign key compares with another to the same table, or with that table's own key.
  const keyOf = (c: ColumnShape): string | undefined => (c.type === 'fk' ? c.references : undefined);
  if (a.type === 'fk' || b.type === 'fk') {
    const [fk, other] = a.type === 'fk' ? [a, b] : [b, a];
    if (other.type === 'fk') return keyOf(fk) === keyOf(other);
    return other.role === 'pk' && fk.references !== undefined && index.pk(fk.references)?.ref === other.ref && index.pk(fk.references)?.type === other.type;
  }
  const kind = (c: ColumnShape) => (NUMBERS.includes(c.type) ? 'number' : c.type === 'enum' || c.type === 'text' ? 'text' : c.type);
  return kind(a) === kind(b);
}

/**
 * Follow `path` from `column` of `table`: every step but the last is a
 * foreign key, the last is the column reached. The column reached, or an
 * issue.
 */
function followPath(index: TableIndex, table: string, column: string, path: readonly string[] | undefined): { column: ColumnShape; table: string } | string {
  const start = index.column(table, column);
  if (start === undefined) return `"${table}" has no column "${column}"`;
  if (path === undefined || path.length === 0) return { column: start, table };
  let at = start;
  let atTable = table;
  for (const step of path) {
    if (at.type !== 'fk' || at.references === undefined) return `"${atTable}.${at.ref}" is not a foreign key, so the path cannot go on to "${step}"`;
    atTable = at.references;
    const next = index.column(atTable, step);
    if (next === undefined) return `"${atTable}" has no column "${step}"`;
    at = next;
  }
  return { column: at, table: atTable };
}

/** Everything wrong with one `agrees` rule of a row on `table`, whose parent row (if any) is on `parent`. */
function agreeIssues(index: TableIndex, table: string, parent: string | undefined, agree: Agree, at: (...rest: Path) => Path): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const reached = followPath(index, table, agree.column, agree.path);
  if (typeof reached === 'string') out.push({ path: at('path'), message: reached });
  if (agree.when !== undefined) {
    const when = followPath(index, table, agree.column, agree.when.path);
    if (typeof when === 'string') out.push({ path: at('when'), message: when });
    else for (const value of agree.when.in) {
      if (!agreeValueFits(when.column, value)) out.push({ path: at('when', 'in'), message: `${JSON.stringify(value)} is not a value of "${when.table}.${when.column.ref}"` });
    }
  }
  const tests = (['eq', 'lte', 'gte'] as const).filter((name) => agree[name] !== undefined);
  if (tests.length !== 1) {
    out.push({ path: at(), message: 'an agreement says one of eq, lte or gte' });
    return out;
  }
  const test = tests[0]!;
  const target = agree[test]!;
  let other: ColumnShape | undefined;
  if ('parent' in target) {
    if (parent === undefined) {
      out.push({ path: at(test, 'parent'), message: 'the row a create makes has no parent row to agree with' });
    } else {
      const found = followPath(index, parent, target.parent, target.path);
      if (typeof found === 'string') out.push({ path: at(test), message: found });
      else other = found.column;
    }
  } else if ('via' in target) {
    const via = index.column(table, target.via);
    if (via?.type !== 'fk' || via.references === undefined) out.push({ path: at(test, 'via'), message: `"${target.via}" is not a foreign key of "${table}"` });
    else {
      other = index.column(via.references, target.column);
      if (other === undefined) out.push({ path: at(test, 'column'), message: `"${via.references}" has no column "${target.column}"` });
    }
  } else if (typeof reached !== 'string' && !agreeValueFits(reached.column, target.value)) {
    out.push({ path: at(test, 'value'), message: `${JSON.stringify(target.value)} is not a value of "${reached.table}.${reached.column.ref}"` });
  }
  if (typeof reached !== 'string') {
    if (test !== 'eq' && !NUMBERS.includes(reached.column.type)) {
      out.push({ path: at(test), message: `"${reached.table}.${reached.column.ref}" is not a number, so it is not at most or at least another` });
    }
    if (other !== undefined && !comparable(reached.column, other, index)) {
      out.push({ path: at(test), message: `"${reached.table}.${reached.column.ref}" (${reached.column.type}) cannot be compared with "${other.ref}" (${other.type})` });
    }
  }
  return out;
}

/** Everything wrong with one `counts` rule of a row on `table`, whose parent row is on `parent`. */
function countsIssues(index: TableIndex, table: string, parent: string, counts: Counts, at: (...rest: Path) => Path): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  let group = table;
  for (const step of counts.by) {
    const link = index.column(group, step);
    if (link?.type !== 'fk' || link.references === undefined) {
      out.push({ path: at('by'), message: `"${group}.${step}" is not a foreign key, so it leads to no group` });
      return out;
    }
    group = link.references;
  }
  for (const name of ['min', 'max'] as const) {
    const found = index.column(group, counts[name]);
    if (found === undefined) out.push({ path: at(name), message: `"${group}" has no column "${counts[name]}"` });
    else if (found.type !== 'int' && found.type !== 'bigint') out.push({ path: at(name), message: `"${group}.${counts[name]}" is not a whole number` });
  }
  if (counts.every !== undefined) {
    const column = index.column(group, counts.every.column);
    if (column?.type !== 'fk') out.push({ path: at('every', 'column'), message: `"${group}.${counts.every.column}" is not a foreign key of the group` });
    const own = index.column(parent, counts.every.eq.parent);
    if (own === undefined) out.push({ path: at('every', 'eq', 'parent'), message: `"${parent}" has no column "${counts.every.eq.parent}"` });
    else if (column !== undefined && !comparable(column, own, index)) {
      out.push({ path: at('every', 'eq', 'parent'), message: `"${group}.${column.ref}" cannot be compared with "${parent}.${own.ref}"` });
    }
  }
  return out;
}

/**
 * A number a guest types that a money figure Adminium works out reads (a
 * line's quantity, a stay's guests) is bounded: at least 0 and at most a
 * stated maximum, or a browser could make a total negative or overflow it.
 */
function boundIssues(index: TableIndex, ctx: PublicAccessContext, table: string, writable: readonly string[], at: Path): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const figures = ctx.figures?.(table);
  if (figures === undefined) return out;
  for (const ref of writable) {
    const column = ruledColumn(index, table, ref);
    if (!figures.has(ref) || column === undefined || !NUMBERS.includes(column.type)) continue;
    const bounds = column.rules?.validation;
    if (bounds?.min === undefined || bounds.min < 0 || bounds.max === undefined) {
      out.push({
        path: at,
        message: `"${table}.${ref}" is written by a guest and feeds a price Adminium works out, so it declares validation.min (at least 0) and validation.max`,
      });
    }
  }
  return out;
}

/** The rows a create carries (`children`), the checks it runs (`agrees`), and the dry run, price check and retry key. */
function treeIssues(
  entries: readonly PublicAccess[],
  ctx: PublicAccessContext,
  identities: ReadonlyMap<string, { entry: PublicAccess; index: number }>,
  shareCodes: ReadonlyMap<string, ReadonlySet<string>>,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  entries.forEach((entry, i) => {
    const at = (...rest: Path) => ['publicAccess', i, ...rest];
    if (index.table(entry.table) === undefined) return;
    const creates = entry.methods.includes('POST');
    const changes = entry.methods.includes('PATCH');
    const key = entry.key ?? CUSTOMER_KEY;
    const writable = entry.writable ?? [];

    // A guest's own numbers feeding a figure are bounded, on every entry that writes.
    if (creates || changes) out.push(...boundIssues(index, ctx, entry.table, writable, at('writable')));

    if (entry.children !== undefined) {
      if (!creates) out.push({ path: at('children'), message: 'child rows come with a create, and this entry creates nothing' });
      if (entry.claim !== undefined) out.push({ path: at('children'), message: 'an identity makes no child rows: its person is not made by a create here' });
      if (entry.visibleWith !== undefined) out.push({ path: at('children'), message: 'an entry visible with a parent is itself a child row; its create carries none' });
      // Whoever may create without a session proves it once, for the whole tree.
      const anonymous = entry.claimedBy === undefined || entry.claimedBy.optional === true || entry.identity !== undefined;
      if (anonymous && entry.humanCheck !== true) {
        out.push({ path: at('humanCheck'), message: 'a create anyone may make with its child rows asks the human check, once for the whole write' });
      }
    }
    if (entry.dryRun === true && !creates && !changes) out.push({ path: at('dryRun'), message: 'a dry run tries a create or a change, and this entry makes neither' });
    if (entry.clientKey !== undefined && !creates) out.push({ path: at('clientKey'), message: 'a retry key belongs to a create' });
    // A row visible with a parent is created alone, not the tree's way: what belongs to a single create's tree would never run there.
    const alone = entry.visibleWith !== undefined;
    if (entry.clientKey !== undefined && alone) out.push({ path: at('clientKey'), message: 'a row visible with a parent is created alone, and never looks a retry key up' });
    if (entry.expect !== undefined && alone && !changes) out.push({ path: at('expect'), message: 'a row visible with a parent is created alone, and never checks a price: a price check here belongs to a change' });
    if (entry.dryRun === true && alone && !changes) out.push({ path: at('dryRun'), message: 'a row visible with a parent is created alone, and is never tried first: a dry run here belongs to a change' });

    if (entry.expect !== undefined) {
      const column = index.column(entry.table, entry.expect);
      if (!creates && !changes) out.push({ path: at('expect'), message: 'a price check belongs to a create or a change' });
      if (column === undefined) out.push({ path: at('expect'), message: `"${entry.table}" has no column "${entry.expect}"` });
      else if (column.type !== 'decimal' && column.type !== 'money') out.push({ path: at('expect'), message: `"${entry.table}.${entry.expect}" is not a money column` });
      else if (!ctx.decided(entry.table).has(entry.expect)) out.push({ path: at('expect'), message: `"${entry.table}.${entry.expect}" is not a figure Adminium works out, so there is nothing to check` });
      if (!(entry.select ?? []).includes(entry.expect)) out.push({ path: at('expect'), message: `"${entry.expect}" is checked, so the entry shows it (select)` });
    }

    if (entry.clientKey !== undefined) {
      const column = ruledColumn(index, entry.table, entry.clientKey);
      const ref = entry.clientKey;
      if (column === undefined) out.push({ path: at('clientKey'), message: `"${entry.table}" has no column "${ref}"` });
      else {
        if (column.type !== 'text') out.push({ path: at('clientKey'), message: `"${entry.table}.${ref}" is not a text column` });
        if (column.unique !== true) out.push({ path: at('clientKey'), message: `"${entry.table}.${ref}" finds one row by its key, so it is unique` });
      }
      if (!writable.includes(ref)) out.push({ path: at('clientKey'), message: `"${ref}" is sent by the browser, so it is writable` });
      // The key answers the row it made to whoever holds it: never shown, filtered or ordered by.
      const read = [...(entry.select ?? []), ...(entry.filters ?? []).map((f) => f.column), ...(entry.rank === undefined ? [] : [entry.rank.orderBy])];
      if (read.includes(ref)) out.push({ path: at('clientKey'), message: `"${ref}" is a retry key, so no entry shows, filters or orders by it` });
      entries.forEach((other, j) => {
        if (j === i || other.table !== entry.table) return;
        const shown = [...(other.select ?? []), ...(other.filters ?? []).map((f) => f.column), ...(other.rank === undefined ? [] : [other.rank.orderBy])];
        if (shown.includes(ref)) out.push({ path: ['publicAccess', j, 'select'], message: `"${entry.table}.${ref}" is a retry key, so no entry shows, filters or orders by it` });
      });
    }

    (entry.agrees ?? []).forEach((agree, a) => out.push(...agreeIssues(index, entry.table, undefined, agree, (...rest) => at('agrees', a, ...rest))));

    if (entry.children === undefined) return;
    // The people of the key (and a person found by address) are never made as a child row.
    const people = new Set([identities.get(key)?.entry.table, entry.identity?.table].filter((t): t is string => t !== undefined));
    const seen = new Set<string>([entry.table]);
    const walk = (children: Readonly<Record<string, ChildEntry>>, parent: string, level: number, base: Path) => {
      for (const [name, child] of Object.entries(children)) {
        const here = (...rest: Path) => [...base, name, ...rest];
        const table = ruledTable(index, name);
        if (table === undefined) {
          out.push({ path: here(), message: `"${name}" is not a table of this app` });
          continue;
        }
        if (seen.has(name)) out.push({ path: here(), message: `"${name}" is in this write twice` });
        seen.add(name);
        if (people.has(name)) out.push({ path: here(), message: `"${name}" holds the people who sign in, and a create never makes one as a child row` });
        const via = index.column(name, child.via);
        if (via?.type !== 'fk' || via.references !== parent) out.push({ path: here('via'), message: `"${name}.${child.via}" does not point at "${parent}"` });
        const lists: [string, readonly string[]][] = [
          ['writable', child.writable],
          ['select', child.select ?? []],
          ['requires', child.requires ?? []],
          ['plainText', (child.plainText ?? []).map(plainTextRef)],
          ['defaults', Object.keys(child.defaults ?? {})],
          ['writableValues', Object.keys(child.writableValues ?? {})],
          ['position', child.position === undefined ? [] : [child.position]],
        ];
        for (const [list, refs] of lists) {
          for (const ref of refs) if (!index.has(name, ref)) out.push({ path: here(list), message: `"${name}" has no column "${ref}"` });
        }
        // What Adminium fills: its decided columns, the state, the link to the parent, the position, a person's key.
        const decided = new Set([...ctx.decided(name), child.via, ...(child.position === undefined ? [] : [child.position])]);
        if (table.states !== undefined) decided.add(table.states.column);
        for (const ref of child.writable) {
          if (decided.has(ref)) out.push({ path: here('writable'), message: `"${ref}" is decided by Adminium and cannot be written publicly` });
          const column = index.column(name, ref);
          if (column?.type === 'fk' && column.references !== undefined && people.has(column.references)) {
            out.push({ path: here('writable'), message: `"${name}.${ref}" points at the people who sign in, so it is filled by Adminium and never written publicly` });
          }
        }
        for (const ref of child.requires ?? []) {
          if (!child.writable.includes(ref)) out.push({ path: here('requires'), message: `"${ref}" is not writable, so a write cannot fill it` });
        }
        for (const [ref, values] of Object.entries(child.writableValues ?? {})) {
          if (!child.writable.includes(ref)) out.push({ path: here('writableValues', ref), message: `"${ref}" is not writable` });
          const column = index.column(name, ref);
          if (column !== undefined) for (const value of values) {
            if (!valueFits(column, value)) out.push({ path: here('writableValues', ref), message: `${JSON.stringify(value)} is not a value of "${name}.${ref}"` });
          }
        }
        for (const ref of (child.plainText ?? []).map(plainTextRef)) {
          const column = index.column(name, ref);
          if (column !== undefined && column.type !== 'text') out.push({ path: here('plainText'), message: `"${name}.${ref}" is not a text column` });
          else if (!child.writable.includes(ref)) out.push({ path: here('plainText'), message: `"${ref}" is not writable, so a guest never types it` });
        }
        for (const ref of child.select ?? []) {
          if (shareCodes.get(name)?.has(ref) === true) out.push({ path: here('select'), message: `"${name}.${ref}" is the code a shared link opens its row with: no entry shows, filters or orders by it` });
        }
        if (child.position !== undefined) {
          const column = index.column(name, child.position);
          if (column !== undefined && column.type !== 'int' && column.type !== 'bigint') out.push({ path: here('position'), message: `"${name}.${child.position}" is not a whole number` });
        }
        if (child.min !== undefined && child.min > child.max) out.push({ path: here('min'), message: 'a child table asks for no more rows than it allows' });
        if (child.sumMax !== undefined) {
          const sum = child.sumMax;
          const column = index.column(name, sum.column);
          if (column === undefined) out.push({ path: here('sumMax', 'column'), message: `"${name}" has no column "${sum.column}"` });
          else if (!NUMBERS.includes(column.type) || column.type === 'float') out.push({ path: here('sumMax', 'column'), message: `"${name}.${sum.column}" is not a number to add up` });
          if (typeof sum.max === 'object') {
            const setting = index.column(sum.max.table, sum.max.column);
            if (setting === undefined) out.push({ path: here('sumMax', 'max'), message: `"${sum.max.table}" has no column "${sum.max.column}"` });
            else if (setting.type !== 'int' && setting.type !== 'bigint') out.push({ path: here('sumMax', 'max'), message: `"${sum.max.table}.${sum.max.column}" is not a whole number` });
          }
        }
        out.push(...boundIssues(index, ctx, name, child.writable, here('writable')));
        (child.agrees ?? []).forEach((agree, a) => out.push(...agreeIssues(index, name, parent, agree, (...rest) => here('agrees', a, ...rest))));
        (child.counts ?? []).forEach((counts, c) => out.push(...countsIssues(index, name, parent, counts, (...rest) => here('counts', c, ...rest))));
        if (child.children !== undefined) {
          if (level >= 2) out.push({ path: here('children'), message: 'child rows go two levels below the create at most' });
          else walk(child.children, name, level + 1, here('children'));
        }
      }
    };
    walk(entry.children, entry.table, 1, at('children'));
  });
  return out;
}

/**
 * The columns of `table` whose value comes, directly or through a formula,
 * from the row `link` points at: a copy or a nightly price read through it,
 * a stamp copying one, a formula over one.
 */
function readThrough(table: RuledTable, link: string): Set<string> {
  const out = new Set<string>();
  for (const column of table.columns) {
    const rules = column.rules;
    if (rules?.copy?.via === link || rules?.perNight?.rate.via === link) out.add(column.ref);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const column of table.columns) {
      if (out.has(column.ref)) continue;
      const rules = column.rules;
      const set = rules?.stamp?.set as { copy?: string } | undefined;
      const reads = [
        ...(rules?.formula === undefined ? [] : formulaColumns(rules.formula as FormulaExpr)),
        ...(typeof set === 'object' && set !== null && typeof set.copy === 'string' ? [set.copy] : []),
      ];
      if (reads.some((ref) => out.has(ref))) {
        out.add(column.ref);
        changed = true;
      }
    }
  }
  return out;
}

/** A person found by address (`identity`), a row's own link (`shareLink`, `own`), forgetting, and reads for a session alone. */
function personIssues(
  entries: readonly PublicAccess[],
  ctx: PublicAccessContext,
  identities: ReadonlyMap<string, { entry: PublicAccess; index: number }>,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  const ownKeys = new Set(
    [...identities].filter(([, identity]) => identity.entry.claim !== undefined && 'by' in identity.entry.claim && identity.entry.claim.own === true).map(([key]) => key),
  );
  /** The tables people sign in as by an emailed link, by key. */
  const linkIdentity = (key: string) => {
    const found = identities.get(key)?.entry;
    return found?.claim !== undefined && claimKind(found.claim) === 'link' ? found : undefined;
  };

  entries.forEach((entry, i) => {
    const at = (...rest: Path) => ['publicAccess', i, ...rest];
    const table = ruledTable(index, entry.table);
    if (table === undefined) return;
    const key = entry.key ?? CUSTOMER_KEY;
    const writable = entry.writable ?? [];

    if (entry.identity !== undefined) {
      const id = entry.identity;
      const here = (...rest: Path) => at('identity', ...rest);
      // Found or made on a create; or on a change through the row's own link (a ticket accepted by a friend).
      const change = ownKeys.has(key) && entry.methods.includes('PATCH') && !entry.methods.includes('POST');
      if (!change && (entry.methods.length !== 1 || entry.methods[0] !== 'POST')) {
        out.push({ path: at('methods'), message: 'a person is found by address on a create alone, or on a change through the row\'s own link' });
      }
      if (!change && entry.claim !== undefined) out.push({ path: at('identity'), message: 'an identity entry claims its person; it does not find one by address' });
      if (id.on !== undefined) {
        const states = table.states;
        const stateColumn = states === undefined ? undefined : ruledColumn(index, entry.table, states.column);
        if (!change) out.push({ path: here('on'), message: 'a create finds its person when it is made; "on" names the move of a change through the row\'s own link' });
        else if (states === undefined || stateColumn === undefined) out.push({ path: here('on'), message: `"${entry.table}" has no states, so no move finds the person` });
        else {
          if (!valueFits(stateColumn, id.on.to)) out.push({ path: here('on', 'to'), message: `"${id.on.to}" is not a state of "${entry.table}.${states.column}"` });
          const values = entry.writableValues?.[states.column];
          if (!writable.includes(states.column) || (values !== undefined && !values.includes(id.on.to))) {
            out.push({ path: here('on', 'to'), message: `this entry never moves "${entry.table}" to "${id.on.to}", so the person would never be found` });
          }
        }
      }
      if (entry.visibleWith !== undefined) out.push({ path: at('identity'), message: 'a row visible with a parent belongs to the parent\'s person; it does not find one by address' });
      // The person signs in by a link to that address: on this key, or (for an own link) on any of the app's keys.
      const signIn = change
        ? entries.find((other) => other.table === id.table && other.claim !== undefined && claimKind(other.claim) === 'link')
        : linkIdentity(key);
      if (signIn === undefined || signIn.table !== id.table) {
        out.push({ path: here('table'), message: `a person found by address signs in by a link to it: "${id.table}" needs an identity entry that claims by an emailed link${change ? '' : ` on the "${key}" key`}` });
      }
      const people = ruledTable(index, id.table);
      const email = ruledColumn(index, entry.table, id.email);
      if (email === undefined) out.push({ path: here('email'), message: `"${entry.table}" has no column "${id.email}"` });
      else {
        if (email.type !== 'text') out.push({ path: here('email'), message: `"${entry.table}.${id.email}" is not a text column` });
        if (email.rules?.validation?.format !== 'email') out.push({ path: here('email'), message: `"${entry.table}.${id.email}" holds an address, so it checks one (validation.format: "email")` });
      }
      // On a change through the row's own link, the address may instead be one the link was emailed to: holding the link proves it.
      const proved = change && ownAddressesOf(identities.get(key)?.entry.claim).includes(id.email);
      if (!writable.includes(id.email) && !proved) out.push({ path: here('email'), message: `"${id.email}" is typed by the guest, so it is writable` });
      if (!change && !(entry.requires ?? []).includes(id.email)) out.push({ path: here('email'), message: `"${id.email}" finds the person, so a create requires it` });
      // The person's own address: one row per address, kept trimmed and in lower case, emptied when forgotten.
      const claimed = signIn?.claim !== undefined && 'email' in signIn.claim ? signIn.claim.email : undefined;
      const stored = claimed === undefined ? undefined : ruledColumn(index, id.table, claimed);
      if (stored !== undefined) {
        if (stored.unique !== true) out.push({ path: here('table'), message: `"${id.table}.${stored.ref}" finds one person by address, so it is unique` });
        if (stored.rules?.normalize !== 'email') out.push({ path: here('table'), message: `"${id.table}.${stored.ref}" is compared as typed, so it is stored trimmed and in lower case (normalize: "email")` });
        if (stored.nullable !== true) out.push({ path: here('table'), message: `"${id.table}.${stored.ref}" is emptied when a person is forgotten, so it is nullable` });
        if (email !== undefined && (stored.maxLength ?? Number.POSITIVE_INFINITY) < (email.maxLength ?? Number.POSITIVE_INFINITY)) {
          out.push({ path: here('table'), message: `"${id.table}.${stored.ref}" holds fewer characters than "${entry.table}.${id.email}"` });
        }
      }
      const link = index.column(entry.table, id.link);
      if (link === undefined) out.push({ path: here('link'), message: `"${entry.table}" has no column "${id.link}"` });
      else {
        if (link.type !== 'fk' || link.references !== id.table) out.push({ path: here('link'), message: `"${entry.table}.${id.link}" does not point at "${id.table}"` });
        if (link.nullable !== true) out.push({ path: here('link'), message: `"${entry.table}.${id.link}" stays empty when the address only looks like one on file, so it is nullable` });
      }
      // Showing it would say whether the address was already a customer's.
      if ((entry.select ?? []).includes(id.link)) out.push({ path: at('select'), message: `"${id.link}" would tell whether the address was on file, so it is never shown` });
      if (writable.includes(id.link)) out.push({ path: at('writable'), message: `"${id.link}" is filled by Adminium and cannot be written publicly` });
      if (!change) {
        const by = entry.claimedBy;
        if (by === undefined || by.table !== id.table || by.column !== id.link || by.optional !== true) {
          out.push({ path: at('claimedBy'), message: `a signed-in guest's create links them as it always has: claimedBy {table: "${id.table}", column: "${id.link}", optional: true}` });
        }
        if (entry.humanCheck !== true) out.push({ path: at('humanCheck'), message: 'a create that finds a person by address asks the human check' });
        if (!(entry.anonymous?.perValue?.columns ?? []).includes(id.email)) {
          out.push({ path: at('anonymous', 'perValue'), message: `a create that finds a person by address is limited per address: anonymous.perValue counts "${id.email}"` });
        }
      }
      if (people !== undefined) {
        const peopleDecided = ctx.decided(id.table);
        const filled = new Set<string>([...(claimed === undefined ? [] : [claimed]), ...Object.keys(id.fill ?? {})]);
        for (const [target, source] of Object.entries(id.fill ?? {})) {
          const column = ruledColumn(index, id.table, target);
          if (column === undefined) out.push({ path: here('fill', target), message: `"${id.table}" has no column "${target}"` });
          else if (column.type !== 'text' || column.role === 'pk' || target === claimed) {
            out.push({ path: here('fill', target), message: `"${id.table}.${target}" is not a text column a new person is filled with` });
          } else if (peopleDecided.has(target) || column.rules?.secret === true || shareCodeColumns(entries, id.table).includes(target)) {
            out.push({ path: here('fill', target), message: `"${id.table}.${target}" is Adminium's or a secret, so a create never fills it` });
          } else if (column.unique === true) {
            // A clash would refuse only the create that makes a person: a way to ask whether one exists.
            out.push({ path: here('fill', target), message: `"${id.table}.${target}" is unique, so filling it would refuse only a new person` });
          }
          if (!writable.includes(source)) out.push({ path: here('fill', target), message: `"${source}" is not writable, so it holds nothing to fill with` });
        }
        // A person made from only what the guest typed: a column a new row could never fill refuses only strangers.
        for (const column of people.columns) {
          if (column.role !== undefined || column.nullable === true || column.default !== undefined || peopleDecided.has(column.ref) || filled.has(column.ref)) continue;
          out.push({ path: here('fill'), message: `"${id.table}.${column.ref}" must be given when a person is made, and nothing fills it` });
        }
        // Making a person must look like finding one: nothing numbered, counted or mailed on its create.
        if (people.columns.some((column) => column.rules?.sequence !== undefined)) {
          out.push({ path: here('table'), message: `"${id.table}" numbers its rows, which a new person would take and a known one would not` });
        }
        if (people.capacity !== undefined || people.booking !== undefined) {
          out.push({ path: here('table'), message: `"${id.table}" carries a limit, which a new person would count against and a known one would not` });
        }
        if (ctx.mailsOnCreate?.(id.table) === true) {
          out.push({ path: here('table'), message: `a message is sent when a "${id.table}" row is made, which would tell a stranger's order apart from its owner's` });
        }
      }
      // Nothing the creating row works out or shows reads the found person: a stranger typing the address would see it.
      for (const ref of readThrough(table, id.link)) {
        out.push({ path: at('identity', 'link'), message: `"${entry.table}.${ref}" reads the person "${id.link}" points at, whom a stranger may have typed the address of: nothing on "${entry.table}" reads through it` });
      }
      const walkChildren = (children: Readonly<Record<string, ChildEntry>> | undefined, parent: string, base: Path) => {
        for (const [name, child] of Object.entries(children ?? {})) {
          const own = ruledTable(index, name);
          if (own === undefined) continue;
          const tainted = new Set([id.link, ...readThrough(table, id.link)]);
          for (const ref of child.select ?? []) {
            const copy = own.columns.find((column) => column.ref === ref)?.rules?.copy;
            if (copy !== undefined && copy.via === child.via && parent === entry.table && tainted.has(copy.from)) {
              out.push({ path: [...base, name, 'select'], message: `"${name}.${ref}" copies "${entry.table}.${copy.from}", the person found by address, so it is never shown` });
            }
          }
          walkChildren(child.children, name, [...base, name, 'children']);
        }
      };
      walkChildren(entry.children, entry.table, at('children'));
    }

    if (entry.shareLink !== undefined) {
      const ref = entry.shareLink;
      if (!entry.methods.includes('POST')) out.push({ path: at('shareLink'), message: 'a row\'s own link is answered by the create that makes it' });
      const opens = entries.some((other) => other.table === entry.table && other.claim !== undefined && 'by' in other.claim && other.claim.column === ref && other.claim.own === true);
      if (!opens) out.push({ path: at('shareLink'), message: `"${entry.table}.${ref}" is answered as the row's own link, so a token claim on "${entry.table}" opens by it with own: true` });
    }

    if (entry.forget !== undefined) {
      const claim = entry.claim;
      const here = (...rest: Path) => at('forget', ...rest);
      const verifies = claim !== undefined && (claimKind(claim) === 'link' || ('verify' in claim && claim.verify === 'email-code'));
      if (!verifies) out.push({ path: at('forget'), message: 'a person forgets their details on the identity they sign in with by email' });
      const decided = ctx.decided(entry.table);
      for (const ref of entry.forget.columns) {
        const column = index.column(entry.table, ref);
        if (column === undefined) out.push({ path: here('columns'), message: `"${entry.table}" has no column "${ref}"` });
        else if (column.role === 'pk') out.push({ path: here('columns'), message: `"${ref}" is the key of the person, which is kept` });
        else if (column.nullable !== true && column.type !== 'bool') out.push({ path: here('columns'), message: `"${entry.table}.${ref}" is never empty, so it cannot be forgotten` });
        else if (decided.has(ref)) out.push({ path: here('columns'), message: `"${ref}" is decided by Adminium, which keeps it` });
      }
      const address = claim !== undefined && 'email' in claim ? claim.email : undefined;
      if (address !== undefined && !entry.forget.columns.includes(address)) {
        out.push({ path: here('columns'), message: `"${address}" signs the person in, so forgetting them empties it` });
      }
      if (entry.forget.links === true && ownLinksOfPerson(entries, entry.table).length === 0) {
        out.push({ path: here('links'), message: `no row a "${entry.table}" person holds opens by its own link, so there is no link to stop` });
      }
      if (entry.forget.stamp !== undefined) {
        const stamp = index.column(entry.table, entry.forget.stamp);
        if (stamp === undefined) out.push({ path: here('stamp'), message: `"${entry.table}" has no column "${entry.forget.stamp}"` });
        else if (stamp.type !== 'timestamptz' || stamp.nullable !== true) out.push({ path: here('stamp'), message: `"${entry.table}.${entry.forget.stamp}" is not a nullable timestamptz` });
        if (entry.forget.columns.includes(entry.forget.stamp)) out.push({ path: here('stamp'), message: 'the time a person was forgotten is kept, not emptied' });
      }
    }

    if (entry.newLink !== undefined) {
      const here = (...rest: Path) => at('newLink', ...rest);
      const signIn = identities.get(key)?.entry;
      const verifies = signIn?.claim !== undefined && (claimKind(signIn.claim) === 'link' || ('verify' in signIn.claim && signIn.claim.verify === 'email-code'));
      // A row's own link asks for another link of its row again: never its own code, which the asking session opened by.
      const ownLink = entry.claim !== undefined && 'by' in entry.claim && entry.claim.own === true ? entry.claim : undefined;
      if (ownLink !== undefined) {
        const others = entries.filter((other) => other.table === entry.table && (other.key ?? CUSTOMER_KEY) !== key && other.claim !== undefined && 'by' in other.claim && other.claim.own === true);
        if (!entry.methods.includes('GET')) out.push({ path: at('newLink'), message: 'a new link is asked for through a row\'s own link that reads the row (GET)' });
        if (entry.newLink.column === ownLink.column) {
          out.push({ path: here('column'), message: `"${entry.table}.${ownLink.column}" is the code this link opens the row by: the session asking would be closed by its own new link` });
        } else if (!others.some((other) => (other.claim as { column: string }).column === entry.newLink!.column)) {
          out.push({ path: here('column'), message: `"${entry.table}.${entry.newLink.column}" is no own link another key opens "${entry.table}" by (a token claim with own: true)` });
        }
      } else if (!entry.methods.includes('GET') || entry.claimedBy === undefined || entry.claimedBy.optional === true || !verifies) {
        out.push({ path: at('newLink'), message: 'a new link is made for a row a person reads signed in by email (claimedBy), or through a row\'s own link, and nowhere else' });
      } else if (!ownLinksOfPerson(entries, signIn!.table).some((link) => link.table === entry.table && link.column === entry.newLink!.column)) {
        out.push({ path: here('column'), message: `"${entry.table}.${entry.newLink.column}" is no own link of a row this person holds (a token claim with own: true)` });
      }
      const box = ctx.outbox;
      if (box === undefined) out.push({ path: here('kind'), message: 'a new link is emailed by the app\'s outbox, and the app has none' });
      else {
        if (box.kinds[entry.newLink.kind] === undefined) out.push({ path: here('kind'), message: `"${entry.newLink.kind}" is not one of the outbox's kinds` });
        if (box.columns.repeatKey === undefined) out.push({ path: here('kind'), message: 'each new link is its own message, so the outbox keeps a repeatKey column' });
        // Sent by the kind's own rules: never past a person's approval, and never skipped at send as a message already sent.
        const declared = (box.producers ?? []).find((producer) => producer.kind === entry.newLink!.kind);
        if (declared?.hold === true) out.push({ path: here('kind'), message: `"${entry.newLink.kind}" waits for a person to approve it, so it is never sent again from a link` });
        if (declared?.repeatBy !== undefined && declared.repeatBy !== entry.newLink.column) {
          out.push({ path: here('kind'), message: `"${entry.newLink.kind}" is sent once per "${declared.repeatBy}", so one sent again for a new "${entry.newLink.column}" would be skipped: its producer repeats by "${entry.newLink.column}" or by nothing` });
        }
        const linked = Object.values(box.links ?? {}).some((column) => index.column(box.table, column)?.references === entry.table);
        if (!linked) out.push({ path: here('kind'), message: `the outbox links no message to "${entry.table}", so the new link could not be sent about its row` });
        // Sent to the person who asked for it: the outbox addresses the people this entry's rows are claimed by.
        if (entry.claimedBy !== undefined && box.recipient !== undefined && box.recipient.table !== entry.claimedBy.table) {
          out.push({ path: here('kind'), message: `the outbox writes to "${box.recipient.table}", not "${entry.claimedBy.table}" who asks for the new link` });
        }
        // Through a row's own link, sent to the row's own address: as the kind's own producer addresses it, from the row alone.
        if (entry.claimedBy === undefined && entry.claim !== undefined && 'by' in entry.claim && box.recipient !== undefined) {
          const columnsOf = (at: string) => index.table(at)?.columns.map((c) => ({ name: c.ref, references: c.references ?? null }));
          const address = resendAddressOf({ table: box.table, recipient: box.recipient, producers: box.producers }, entry.newLink.kind, entry.table, columnsOf);
          if (address === null) {
            out.push({ path: here('kind'), message: `"${entry.newLink.kind}" is not addressed from a "${entry.table}" row (its producer's recipient, the person the row links, or the outbox's fallback through "${entry.table}"), so it cannot be sent again to the row's own address` });
          } else {
            // Nobody changes online where it goes: else a link holder could send it to any address in turn.
            const writers = entries.filter((other) => other.methods.includes('PATCH'));
            const onRow = writers.filter((other) => other.table === entry.table).flatMap((other) => other.writable ?? []).filter((ref) => address.columns.includes(ref));
            const onPerson = address.person === undefined ? [] : writers.filter((other) => other.table === address.person!.table && (other.writable ?? []).includes(address.person!.column)).map(() => `${address.person!.table}.${address.person!.column}`);
            for (const ref of [...new Set([...onRow.map((c) => `${entry.table}.${c}`), ...onPerson])]) {
              out.push({ path: here('kind'), message: `"${ref}" is where it is sent again, and an entry lets a guest change it: nothing a guest writes may say where it goes` });
            }
          }
        }
      }
      // What the row must hold: through a row's own link, always said (a confirm email only while it is still to confirm).
      if (entry.claimedBy === undefined && entry.claim !== undefined && 'by' in entry.claim && entry.claim.own === true && entry.newLink.when === undefined) {
        out.push({ path: here('when'), message: 'sent again through a row\'s own link only while the row holds a when (an order still to confirm)' });
      }
      // Only columns the guest sees: a refusal must tell nothing about one they do not.
      const shown = entry.select ?? (table.columns.filter((c) => c.rules?.code === undefined && c.rules?.secret !== true).map((c) => c.ref));
      const withheld = new Set(entry.withhold?.columns ?? []);
      (entry.newLink.when?.where ?? []).forEach((condition, w) => {
        out.push(...conditionIssues(entry.table, condition, index, here('when', 'where', w)));
        if (!shown.includes(condition.column) || withheld.has(condition.column)) {
          out.push({ path: here('when', 'where', w), message: `"${entry.table}.${condition.column}" is not a column this entry shows, so a new link is never asked for by it` });
        }
      });
    }

    // A read for the holder of a session alone (no claim of its own): the settings a signed-in guest may see.
    if (entry.level !== undefined && entry.claim === undefined && entry.claimedBy === undefined && entry.visibleWith === undefined) {
      if (entry.methods.length !== 1 || entry.methods[0] !== 'GET') out.push({ path: at('methods'), message: 'a read for a signed-in guest alone only reads' });
      if (!identities.has(key)) out.push({ path: at('level'), message: `the "${key}" key signs nobody in, so no session could read this` });
      if (entry.select === undefined) out.push({ path: at('select'), message: 'a read for a signed-in guest lists what it shows; without select it would show every column' });
      const signIn = identities.get(key)?.entry.claim;
      const verifiedOnly = signIn !== undefined && (claimKind(signIn) === 'link' || ('own' in signIn && signIn.own === true));
      if (verifiedOnly && entry.level !== 'verified') out.push({ path: at('level'), message: `the "${key}" key's sessions are verified, so this entry is read at level "verified"` });
    }

    // The owner's own link: it changes its row and its children, within what each entry names.
    if (ownKeys.has(key)) {
      if (entry.methods.includes('PATCH') && entry.writable === undefined) out.push({ path: at('writable'), message: 'a change through a row\'s own link names what it may write' });
      if (entry.methods.includes('POST') && entry.visibleWith === undefined) out.push({ path: at('methods'), message: 'a row\'s own link makes only child rows of the row it opens (visibleWith)' });
      if (entry.methods.includes('PATCH')) {
        for (const ref of writable) {
          if (index.column(entry.table, ref)?.type === 'enum' && entry.writableValues?.[ref] === undefined) {
            out.push({ path: at('writableValues'), message: `"${ref}" is an enum a browser changes; list the values it may set` });
          }
        }
      }
      if (entry.visibleWith !== undefined && entry.level !== 'verified') {
        out.push({ path: at('level'), message: `the "${key}" key opens a row's own link at level "verified", so this entry is read at it` });
      }
    }
  });

  // An own link's code, its end and its stop are never written through any entry.
  for (const key of ownKeys) {
    const claim = identities.get(key)!.entry.claim as { column: string; expires?: string | undefined; stopped?: string | undefined };
    const table = identities.get(key)!.entry.table;
    const guarded = [claim.column, claim.expires, claim.stopped].filter((ref): ref is string => ref !== undefined);
    entries.forEach((entry, i) => {
      if (entry.table !== table) return;
      for (const ref of guarded) {
        if ((entry.writable ?? []).includes(ref) || Object.prototype.hasOwnProperty.call(entry.writableValues ?? {}, ref)) {
          out.push({ path: ['publicAccess', i, 'writable'], message: `"${table}.${ref}" opens or closes the row's own link, so no browser writes it` });
        }
      }
    });
  }
  return out;
}

/** Whether a code's `renew` names a change of `ref` among its triggers. */
function renewsOn(renew: { on: unknown } | undefined, ref: string): boolean {
  if (renew === undefined) return false;
  const triggers = (Array.isArray(renew.on) ? renew.on : [renew.on]) as { column?: unknown; changed?: unknown }[];
  return triggers.some((trigger) => trigger.column === ref && trigger.changed === true);
}

/** The columns a row's own link may be emailed to, as a list (none for any other claim). */
function ownAddressesOf(claim: Claim | undefined): readonly string[] {
  if (claim === undefined || !('by' in claim) || claim.own !== true || claim.address === undefined) return [];
  return typeof claim.address === 'string' ? [claim.address] : claim.address;
}

/**
 * Where a row's own link may be emailed (`claim.address`), and the columns
 * left out of rows read through a parent (`withhold`).
 */
function ownAddressAndWithholdIssues(
  entries: readonly PublicAccess[],
  ctx: PublicAccessContext,
  identities: ReadonlyMap<string, { entry: PublicAccess; index: number }>,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  /** Whether an entry lets a browser set a column. */
  const writes = (entry: PublicAccess, ref: string) =>
    (entry.writable ?? []).includes(ref) ||
    Object.prototype.hasOwnProperty.call(entry.writableValues ?? {}, ref) ||
    Object.prototype.hasOwnProperty.call(entry.defaults ?? {}, ref);
  /** The tables a key signs a person in on: an identity that is not a token (a token opens a row, not a person). */
  const people = new Set([...identities.values()].filter(({ entry }) => entry.claim !== undefined && claimKind(entry.claim) !== 'token').map(({ entry }) => entry.table));

  entries.forEach((entry, i) => {
    const at = (...rest: Path) => ['publicAccess', i, ...rest];
    if (index.table(entry.table) === undefined) return;
    const key = entry.key ?? CUSTOMER_KEY;
    const column = (ref: string) => index.column(entry.table, ref);

    const claim = entry.claim;
    if (claim !== undefined && 'by' in claim && claim.address !== undefined) {
      const refs = typeof claim.address === 'string' ? [claim.address] : claim.address;
      if (claim.own !== true) out.push({ path: at('claim', 'address'), message: "a link is emailed to its row's own address only when it is the row's own link (own: true)" });
      if (refs.length === 2 && refs[0] === refs[1]) out.push({ path: at('claim', 'address'), message: `"${refs[0]!}" is named twice` });
      for (const ref of new Set(refs)) {
        const found = column(ref);
        if (found === undefined) out.push({ path: at('claim', 'address'), message: `"${entry.table}" has no column "${ref}"` });
        else if (found.type !== 'text') out.push({ path: at('claim', 'address'), message: `"${entry.table}.${ref}" is not a text column holding an address` });
        else if (ref === claim.column) out.push({ path: at('claim', 'address'), message: `"${entry.table}.${ref}" is the link's secret, not an address` });
        // Whoever holds the link could otherwise send it on to an address of their choosing.
        entries.forEach((other, j) => {
          if (other.table === entry.table && (other.key ?? CUSTOMER_KEY) === key && writes(other, ref)) {
            out.push({ path: ['publicAccess', j, 'writable'], message: `"${entry.table}.${ref}" is an address the row's own link is emailed to, so a change through that link may not set it` });
          }
        });
        /*
         * An address another entry's change writes (the buyer sends a ticket on
         * to a friend): the link must be new each time it goes to a new address,
         * or whoever it was sent to before still holds a link to the row.
         */
        const changedBy = entries.findIndex((other) => other.table === entry.table && other.methods.some((m) => m === 'PATCH') && writes(other, ref));
        const codeColumn = ruledColumn(index, entry.table, claim.column) as { rules?: { code?: { renew?: { on: unknown } } } } | undefined;
        if (found !== undefined && changedBy >= 0 && !renewsOn(codeColumn?.rules?.code?.renew, ref)) {
          out.push({
            path: at('claim', 'address'),
            message: `"${entry.table}.${ref}" is written by a change (publicAccess ${String(changedBy)}) and the row's own link is emailed to it, so "${entry.table}.${claim.column}" renews when it changes: rules.code.renew.on {"column": "${ref}", "changed": true}`,
          });
        }
      }
    }

    const withhold = entry.withhold;
    if (withhold === undefined) return;
    // A row's own link (a ticket a friend has not taken yet) holds back columns while a condition holds: it names nobody, so no holder.
    const ownLink = claim !== undefined && claimKind(claim) === 'token' && 'own' in claim && claim.own === true;
    if (ownLink && withhold.unlessHolder !== undefined) {
      out.push({ path: at('withhold', 'unlessHolder'), message: "a row's own link names nobody, so it holds columns back by when alone" });
    } else if (!ownLink && entry.visibleWith === undefined && entry.claimedBy === undefined) {
      out.push({ path: at('withhold'), message: "columns are withheld from rows read through a parent (visibleWith or claimedBy), or by a row's own link while a condition holds" });
    } else if (entry.claimedBy !== undefined && entry.claimedBy.column === withhold.unlessHolder) {
      out.push({ path: at('withhold', 'unlessHolder'), message: `"${withhold.unlessHolder}" is the column this entry is claimed by, so every row it reads is already its holder's` });
    }
    if (new Set(withhold.columns).size !== withhold.columns.length) out.push({ path: at('withhold', 'columns'), message: 'a column is withheld once' });
    for (const ref of withhold.columns) {
      if (entry.select === undefined || !entry.select.includes(ref)) out.push({ path: at('withhold', 'columns'), message: `"${ref}" is not one of the columns the entry shows` });
    }
    // What a `when` reads decides who sees the columns: never a browser's to write.
    const ruled = ruledTable(index, entry.table);
    if (withhold.when !== undefined && ruled !== undefined) {
      (withhold.when.where ?? []).forEach((condition, w) => {
        out.push(...conditionIssues(entry.table, condition, index, at('withhold', 'when', 'where', w)));
        entries.forEach((other, j) => {
          if (other.table === entry.table && writes(other, condition.column)) {
            out.push({ path: ['publicAccess', j, 'writable'], message: `"${entry.table}.${condition.column}" decides who reads the withheld columns, so no browser writes it` });
          }
        });
      });
      (withhold.when.linked ?? []).forEach((link, l) => {
        const via = column(link.via);
        const target = via?.type === 'fk' && via.references !== undefined ? ruledTable(index, via.references) : undefined;
        if (target === undefined) {
          out.push({ path: at('withhold', 'when', 'linked', l, 'via'), message: `"${entry.table}.${link.via}" is not a foreign key of this app` });
          return;
        }
        link.where.forEach((condition, w) => {
          out.push(...conditionIssues(target.ref, condition, index, at('withhold', 'when', 'linked', l, 'where', w)));
          entries.forEach((other, j) => {
            if (other.table === target.ref && writes(other, condition.column)) {
              out.push({ path: ['publicAccess', j, 'writable'], message: `"${target.ref}.${condition.column}" decides who reads "${entry.table}"'s withheld columns, so no browser writes it` });
            }
          });
        });
        entries.forEach((other, j) => {
          // A child's create names the parent it is made under (one the guest reaches): that is no change of who reads it.
          const createsUnder = other.visibleWith?.via === link.via && !other.methods.includes('PATCH');
          if (other.table === entry.table && writes(other, link.via) && !createsUnder) {
            out.push({ path: ['publicAccess', j, 'writable'], message: `"${entry.table}.${link.via}" decides who reads the withheld columns, so no browser writes it` });
          }
        });
      });
    }
    const holder = withhold.unlessHolder;
    if (holder === undefined) return;
    const link = column(holder);
    const root = rootIdentity(entries, i, identities);
    if (link === undefined) {
      out.push({ path: at('withhold', 'unlessHolder'), message: `"${entry.table}" has no column "${holder}"` });
    } else if (link.type !== 'fk') {
      out.push({ path: at('withhold', 'unlessHolder'), message: `"${entry.table}.${holder}" is not a foreign key to a person` });
    } else if (root?.claim !== undefined && claimKind(root.claim) === 'token') {
      // A key that opens a row by its link signs no person in: the columns are withheld whenever the holder is set.
      if (!people.has(link.references ?? '')) {
        out.push({ path: at('withhold', 'unlessHolder'), message: `"${entry.table}.${holder}" does not point at a person any key signs in` });
      }
    } else if (root !== undefined && link.references !== root.table) {
      out.push({ path: at('withhold', 'unlessHolder'), message: `"${entry.table}.${holder}" does not point at "${root.table}", the person the "${key}" key signs in` });
    }
    // Who may read the withheld columns is never a browser's to say.
    entries.forEach((other, j) => {
      if (other.table === entry.table && writes(other, holder)) {
        out.push({ path: ['publicAccess', j, 'writable'], message: `"${entry.table}.${holder}" decides who reads the withheld columns, so no browser writes it` });
      }
    });
  });
  return out;
}

/**
 * Advice about a plain-text column that holds more than its plain text takes:
 * a guest who types to the column's `maxLength` is refused at the end of the
 * form ("orders.note" holds 140, its plain text takes 80).
 */
export function plainTextLengthWarnings(
  publicAccess: readonly PublicAccess[],
  tables: readonly { ref: string; columns: readonly { ref: string; type: string; maxLength?: number | undefined }[] }[],
): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const check = (table: string, list: readonly PlainTextColumnRef[] | undefined, path: string) => {
    (list ?? []).forEach((entry, k) => {
      const ref = plainTextRef(entry);
      const holds = tables.find((t) => t.ref === table)?.columns.find((c) => c.ref === ref)?.maxLength;
      const takes = plainTextMax(entry);
      if (holds === undefined || holds <= takes) return;
      out.push({
        path: `${path}.${String(k)}`,
        message:
          `"${table}.${ref}" holds ${String(holds)} characters but its plain text takes ${String(takes)}, so a guest who types more is refused: ` +
          `lower its maxLength to ${String(takes)}, or give it { "column": "${ref}", "max": ${String(Math.min(holds, PLAIN_TEXT_LONGEST))} }` +
          (holds > PLAIN_TEXT_LONGEST ? ` and a maxLength of ${String(PLAIN_TEXT_LONGEST)}` : ''),
      });
    });
  };
  const walk = (children: Readonly<Record<string, ChildEntry>> | undefined, base: string) => {
    for (const [name, child] of Object.entries(children ?? {})) {
      check(name, child.plainText, `${base}.children.${name}.plainText`);
      walk(child.children, `${base}.children.${name}`);
    }
  };
  publicAccess.forEach((entry, e) => {
    const base = `publicAccess.${String(e)}`;
    check(entry.table, entry.anonymous?.plainText, `${base}.anonymous.plainText`);
    check(entry.table, entry.limits?.plainText, `${base}.limits.plainText`);
    walk(entry.children, base);
  });
  return out;
}
