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

import {
  refSchema,
  scalarSchema,
  settingRefSchema,
  valueFits,
  type ReferenceIssue,
  type TableIndex,
} from './refs.ts';

/** The key every entry uses unless it names another. */
export const CUSTOMER_KEY = 'customer';

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

/** Opening one row by the code in `column`, while it has not expired or been stopped. */
const tokenClaimSchema = z
  .object({ by: z.literal('token'), column: refSchema, expires: refSchema.optional(), stopped: refSchema.optional() })
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
 * A time no more than `within` minutes ahead — a past time always passes. A
 * kiosk takes an arrival from an hour before the visit, and a late one too.
 * Up to a day: a longer window is no window.
 */
const timeWindowSchema = z.object({ within: z.number().int().min(1).max(1440) }).strict();

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
      .record(refSchema, z.union([whenValuesSchema, z.literal('from-now'), z.literal('from-today'), z.literal('before-today'), timeWindowSchema]))
      .optional(),
    /** A proof-of-work the browser solves before the write (or the claim) is taken. */
    humanCheck: z.literal(true).optional(),
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
        plainText: z.array(refSchema).min(1).max(8).optional(),
      })
      .strict()
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
  })
  .strict();
export const publicKeysSchema = z
  .record(keyNameSchema, publicKeySchema)
  .refine((keys) => !(CUSTOMER_KEY in keys), { message: '"customer" is the app\'s own key and is not declared here' });
export type PublicKey = z.infer<typeof publicKeySchema>;

interface PublicAccessContext {
  index: TableIndex;
  /** Columns Adminium decides on a table: a browser may never write them. */
  decided: (table: string) => ReadonlySet<string>;
  /** Whether the table carries a capacity or a booking rule to answer availability from. */
  answersAvailability: (table: string) => boolean;
  publicKeys: Readonly<Record<string, PublicKey>> | undefined;
  roles: readonly { key: string; screensOnly?: boolean | undefined; cloneFrom?: string | undefined; permissions?: readonly string[] | undefined }[];
}

/** Everything in `publicAccess` and `publicKeys` that names something undeclared, or breaks a rule. */
export function publicAccessIssues(entries: readonly PublicAccess[], ctx: PublicAccessContext): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const { index } = ctx;
  const has = index.has;

  for (const [name, key] of Object.entries(ctx.publicKeys ?? {})) {
    const at = ['publicKeys', name];
    if (key.requiresStaff === undefined) {
      // No one signs this key in: it may only open one row by its token, and read.
      const identity = entries.find((entry) => (entry.key ?? CUSTOMER_KEY) === name && entry.claim !== undefined);
      if (identity?.claim === undefined || claimKind(identity.claim) !== 'token') {
        out.push({ path: [...at, 'requiresStaff'], message: `a key no staff signs in opens one row by its token: "${name}" needs an entry that claims by token` });
      }
      entries.forEach((entry, i) => {
        if ((entry.key ?? CUSTOMER_KEY) === name && entry.methods.some((method) => method !== 'GET')) {
          out.push({ path: ['publicAccess', i, 'methods'], message: `"${name}" opens a row to whoever holds its link, so it only reads` });
        }
      });
      if (!entries.some((entry) => entry.key === name)) out.push({ path: at, message: `no entry is served through "${name}"` });
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
        if (name === 'level' && entry.visibleWith !== undefined) continue;
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
      const parents = entries.filter((other) => other !== entry && other.table === v.table && (other.key ?? CUSTOMER_KEY) === key && other.methods.includes('GET'));
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
       * re-point its own row at another person's.
       */
      if (pointsDown && !pointsUp) {
        entries.forEach((other, j) => {
          if (other.table !== v.table || (other.key ?? CUSTOMER_KEY) !== key) return;
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
    if (entry.level === 'verified' && identity !== undefined && identity.entry.claim !== undefined && claimKind(identity.entry.claim) !== 'link' && !('verify' in identity.entry.claim && identity.entry.claim.verify !== undefined)) {
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
    for (const [ref, values] of Object.entries(entry.writableValues ?? {})) {
      if (!writable.has(ref)) out.push({ path: at('writableValues', ref), message: `"${ref}" is not writable` });
      const found = column(ref);
      if (found !== undefined) for (const value of values) {
        if (!valueFits(found, value)) out.push({ path: at('writableValues', ref), message: `${JSON.stringify(value)} is not a value of "${entry.table}.${ref}"` });
      }
    }
    if (entry.writableWhen !== undefined && !patches) {
      out.push({ path: at('writableWhen'), message: 'writableWhen limits a change, and this entry changes nothing' });
    }
    for (const [ref, when] of Object.entries(entry.writableWhen ?? {})) {
      const found = column(ref);
      if (found === undefined) {
        out.push({ path: at('writableWhen', ref), message: `"${entry.table}" has no column "${ref}"` });
      } else if (when === 'from-now') {
        if (found.type !== 'timestamptz') out.push({ path: at('writableWhen', ref), message: `"from-now" needs a timestamptz, and "${ref}" is not one` });
      } else if (when === 'from-today' || when === 'before-today') {
        if (found.type !== 'date') out.push({ path: at('writableWhen', ref), message: `"${when}" needs a date, and "${ref}" is not one` });
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
    const windows = Object.values(entry.writableWhen ?? {}).filter((when) => typeof when === 'object' && !Array.isArray(when));
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
      for (const [name, columns] of [['perValue', caps.perValue?.columns ?? []], ['plainText', caps.plainText ?? []]] as const) {
        for (const ref of columns) {
          const found = column(ref);
          if (found === undefined) out.push({ path: at('anonymous', name), message: `"${entry.table}" has no column "${ref}"` });
          else if (found.type !== 'text') out.push({ path: at('anonymous', name), message: `"${entry.table}.${ref}" is not a text column` });
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
  });
  return out;
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
    (other, i) => i !== index && other.table === entry.visibleWith!.table && (other.key ?? CUSTOMER_KEY) === key && other.methods.includes('GET'),
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
    (other, i) => i !== index && other.table === entry.visibleWith!.table && (other.key ?? CUSTOMER_KEY) === key && other.methods.includes('GET'),
  );
  return parent === -1 ? 1 : 1 + hops(entries, parent, new Set([...seen, index]));
}
