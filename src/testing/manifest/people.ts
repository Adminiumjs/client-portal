/*
 * VENDORED VERBATIM from packages/manifest/src/people.ts.
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
 * THE PEOPLE AN APP KEEPS (`people`), AND THE TABLES THE LAW KEEPS (`keep`).
 *
 * `people` is one top-level list, an entry per table of the app that holds
 * people (or companies): "this table is people; this column is the address,
 * this the name, this the consent". E-mail to contacts, a person's data by
 * address (find, export, erase), forms and chat all read it, so none of them
 * names an app's tables. It is a list beside `outbox` and `publicAccess`
 * rather than a word on the table because an entry reaches other tables too:
 * the copies of a person kept on them.
 *
 * Much of it was said before, per feature: the outbox's `recipient` names its
 * people table and that table's address column, and a public entry's claim
 * names the address a person signs in with. The validator holds the three
 * equal, so they cannot drift apart.
 *
 * An entry:
 *  - `table`, and `kind`: `people`, or `companies` (a company may have no
 *    address of its own; its people are mailed);
 *  - `email`: the address column (a `people` entry has one);
 *  - `name`: the column that names the person (default: the table's
 *    `keyField`, never the address column; a name kept in parts is joined
 *    by a formula column of the app's); `company`: a link to the company
 *    they work for;
 *  - `language`: a column of the table with the language they are written to
 *    in (a table that keeps it only on an order adds one, filled when the
 *    person is made), and
 *    `firstName`: a column, or `firstWordOfName` (the name's first word), for
 *    a mail's `{{first_name}}`;
 *  - `consent`: a yes/no column that mirrors one purpose of the consent log
 *    (`newsletter` or `surveys`). With none, the consent log alone holds it;
 *  - `copies`: columns on OTHER tables that hold this person's address, name or phone
 *    (a quote's recipient, a signer), each with the link back to the person
 *    when there is one. Found and exported with the person, and blanked when
 *    they are erased (but not on a table the law keeps);
 *  - `customer`: a yes/no or number column that says the person is a customer
 *    (a count of won deals), for "existing customers";
 *  - `optOutMark`: the moment the app's own screen showed the person the line
 *    "you can say no to our mail" where it took their address. Declaring it
 *    says the app's staff screens show that line; it is a strict stamp, so
 *    no writer can set it by hand: only a signed-in staff member's save on
 *    such a screen sets it (or the carry below), never a public page. Only marked rows may be mailed
 *    as existing customers. `{column, carryFrom: {table, column}}` also names
 *    the mark of the row a person is made from (a claimed enquiry's), copied
 *    in the save that makes them;
 *  - `carry`: what an app update carries over once (see `carrySchema`).
 *
 * The consent column is not the outbox's `recipient.optIn`: that is a switch
 * for service mail (a reminder), and the two may differ.
 *
 * `keep` is a table word: `{law: <reason>}` says the law makes the business
 * keep the table's rows (an invoice: tax law). An erasure leaves such rows as
 * they are, the person's copies on them included, and lists them under
 * "What stays" with the reason. It is not `states.noDelete`: that refuses a
 * delete of a row in some states (a sent invoice is voided, not deleted) and
 * says nothing of the law, nor of a row's other states.
 *
 * Pure.
 */
import { z } from 'zod';

import { bcp47TagSchema, refSchema, type ReferenceIssue, type TableIndex } from './refs.ts';

/** What a people entry holds. */
export const PEOPLE_KINDS = ['people', 'companies'] as const;
/** The purposes a consent column may mirror: one each. */
export const CONSENT_PURPOSES = ['newsletter', 'surveys'] as const;
/** A first name read as the first word of the name column. */
export const FIRST_WORD_OF_NAME = 'firstWordOfName';
/** What a copy of a person holds. */
export const COPY_HOLDS = ['email', 'name', 'phone'] as const;
/** The most people tables one app declares, and copies one entry lists. */
export const PEOPLE_MAX = 8;
export const PEOPLE_COPIES_MAX = 32;

/** Why the law keeps a table's rows: each is a reason "What stays" names, in the reader's language. */
export const KEPT_BY_LAW_REASONS = ['tax', 'health', 'contract', 'safety'] as const;
export type KeptByLawReason = (typeof KEPT_BY_LAW_REASONS)[number];

/** The longest consent sentence, in characters, and the highest version it may have. */
export const CONSENT_WORDING_MAX = 500;

/** A public entry's consent tick: the row's bool, the purpose, and the sentence shown with its version (see `public-access.ts`). */
export const publicConsentSchema = z
  .object({
    column: refSchema,
    purpose: z.enum(CONSENT_PURPOSES),
    wording: z
      .object({
        version: z.number().int().min(1).max(9999),
        text: z
          .record(bcp47TagSchema, z.string().min(1).max(CONSENT_WORDING_MAX))
          .refine((texts) => texts['en-US'] !== undefined, { message: 'the wording is given in several languages, en-US among them' }),
      })
      .strict(),
  })
  .strict();
export type PublicConsent = z.infer<typeof publicConsentSchema>;

/** A table's `keep`: the law keeps its rows, for this reason. */
export const keepSchema = z.object({ law: z.enum(KEPT_BY_LAW_REASONS) }).strict();
export type Keep = z.infer<typeof keepSchema>;

/** The most one-time carries one entry lists. */
export const PEOPLE_CARRY_MAX = 4;

/**
 * The opt-out mark with a second source: the mark of the row a person is made
 * from (a claimed enquiry's, onto the contact made of it), which the server's
 * door copies in the save that makes the person from that row.
 */
const optOutMarkSchema = z.object({ column: refSchema, carryFrom: z.object({ table: refSchema, column: refSchema }).strict().optional() }).strict();

/**
 * What an app update carries over once, from what the app kept before the
 * consent log and the do-not-email list:
 *  - `stopList`: every row whose column holds a value puts its address on the
 *    do-not-email list (an old "unsubscribed" mark);
 *  - `consent`: the newest answer each person gave on a linked table (an
 *    order's "news from the venue" tick, newest by `latest`) becomes their
 *    consent column's value, as a yes with no record, which the first send's
 *    review asks about.
 * Each is run by the update and adds nothing a second time. The columns it
 * reads are declared in the same manifest: an app keeps a column it carries
 * from for one more release, and drops it in the next.
 */
const carrySchema = z.union([
  z.object({ stopList: z.object({ column: refSchema }).strict() }).strict(),
  z.object({ consent: z.object({ from: refSchema, via: refSchema, column: refSchema, latest: refSchema }).strict() }).strict(),
]);
export type PeopleCarry = z.infer<typeof carrySchema>;

const copySchema = z
  .object({
    table: refSchema,
    column: refSchema,
    holds: z.enum(COPY_HOLDS),
    /** A link column of the copy's table back to the person, when it has one. */
    via: refSchema.optional(),
  })
  .strict();
export type PeopleCopy = z.infer<typeof copySchema>;

export const peopleEntrySchema = z
  .object({
    table: refSchema,
    kind: z.enum(PEOPLE_KINDS),
    email: refSchema.optional(),
    name: refSchema.optional(),
    company: refSchema.optional(),
    language: refSchema.optional(),
    firstName: z.union([z.object({ column: refSchema }).strict(), z.literal(FIRST_WORD_OF_NAME)]).optional(),
    consent: z.object({ column: refSchema, purpose: z.enum(CONSENT_PURPOSES) }).strict().optional(),
    copies: z.array(copySchema).max(PEOPLE_COPIES_MAX).optional(),
    customer: refSchema.optional(),
    optOutMark: z.union([refSchema, optOutMarkSchema]).optional(),
    carry: z.array(carrySchema).min(1).max(PEOPLE_CARRY_MAX).optional(),
  })
  .strict()
  .refine((entry) => entry.kind !== 'people' || entry.email !== undefined, { message: 'a people table names the column that holds the address ("email")', path: ['email'] });
export type PeopleEntry = z.infer<typeof peopleEntrySchema>;

/** The opt-out mark's column, however the entry writes it. */
export function optOutMarkColumn(entry: Pick<PeopleEntry, 'optOutMark'>): string | undefined {
  return typeof entry.optOutMark === 'object' ? entry.optOutMark.column : entry.optOutMark;
}

export const peopleSchema = z
  .array(peopleEntrySchema)
  .min(1)
  .max(PEOPLE_MAX)
  .refine((entries) => new Set(entries.map((entry) => entry.table)).size === entries.length, { message: 'a table is declared as people once' });
export type People = z.infer<typeof peopleSchema>;

/** What the checks read of a column. */
interface PeopleColumn {
  ref: string;
  type: string;
  references?: string | undefined;
  rules?: { stamp?: { strict?: true | undefined } | undefined } | undefined;
}

const NUMBERS = ['int', 'bigint', 'decimal', 'money', 'float'];

/**
 * Everything wrong with an app's `people` that the manifest can see: a table
 * or a column it lacks, a column of the wrong kind, and an address that is
 * not the one its outbox or its sign-in already names for the same table.
 */
export function peopleIssues<C extends PeopleColumn>(
  m: {
    people?: People | undefined;
    outbox?: { recipient: { table: string; email: string } } | undefined;
    publicAccess?: readonly { table: string; claim?: unknown }[] | undefined;
    requiredSchema: { tables: readonly { ref: string; keyField?: string | undefined }[] };
  },
  index: TableIndex<C>,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  (m.people ?? []).forEach((entry, e) => {
    const at = (...rest: (string | number)[]) => ['people', e, ...rest];
    if (index.table(entry.table) === undefined) {
      out.push({ path: at('table'), message: `"${entry.table}" is not a table of this app` });
      return;
    }
    /** A column of `table`, of one of `types`; said by name when it is missing or of another kind. */
    const col = (table: string, ref: string, types: readonly string[], path: (string | number)[], what: string): PeopleColumn | undefined => {
      const found = index.column(table, ref);
      if (found === undefined) out.push({ path, message: `"${table}" has no column "${ref}"` });
      else if (!types.includes(found.type)) out.push({ path, message: `"${table}.${ref}" is not ${what}` });
      return found;
    };

    if (entry.email !== undefined) col(entry.table, entry.email, ['text'], at('email'), 'a text column (an address)');
    const keyField = m.requiredSchema.tables.find((table) => table.ref === entry.table)?.keyField;
    const name = entry.name ?? keyField;
    if (name === undefined) out.push({ path: at('name'), message: `"${entry.table}" has no keyField: name the column that names a person ("name")` });
    else if (entry.name !== undefined) col(entry.table, entry.name, ['text'], at('name'), 'a text column');
    // A person is not named by their address: a table whose keyField is the address names the name column (a formula that joins two, when the name is kept in parts).
    if (name !== undefined && name === entry.email) out.push({ path: at('name'), message: `"${entry.table}" is named by its address ("${name}"${entry.name === undefined ? ', its keyField' : ''}): name the column that holds the person's name ("name"), a formula column when the name is kept in parts` });
    if (entry.company !== undefined) {
      const link = col(entry.table, entry.company, ['fk'], at('company'), 'a link to the company');
      const target = link?.references === undefined ? undefined : (m.people ?? []).find((other) => other.table === link.references);
      if (target !== undefined && target.kind !== 'companies') out.push({ path: at('company'), message: `"${entry.table}.${entry.company}" links to "${target.table}", which is declared as people, not companies` });
    }
    if (entry.language !== undefined) col(entry.table, entry.language, ['text'], at('language'), 'a text column (a language)');
    if (typeof entry.firstName === 'object') col(entry.table, entry.firstName.column, ['text'], at('firstName', 'column'), 'a text column');
    else if (entry.firstName === FIRST_WORD_OF_NAME && name === undefined) out.push({ path: at('firstName'), message: 'a first name read from the name needs a name column' });

    // What is read only to mail a person: with no address, it says nothing.
    for (const key of ['consent', 'customer', 'optOutMark', 'carry'] as const) {
      if (entry[key] !== undefined && entry.email === undefined) out.push({ path: at(key), message: `"${key}" is read to mail the table's people, and this entry names no address ("email")` });
    }
    if (entry.consent !== undefined) col(entry.table, entry.consent.column, ['bool'], at('consent', 'column'), 'a bool (a yes or no)');
    if (entry.customer !== undefined) col(entry.table, entry.customer, ['bool', ...NUMBERS], at('customer'), 'a bool or a number');
    /** A mark: a moment no writer gives (a strict stamp). */
    const markAt = (table: string, ref: string, path: (string | number)[]) => {
      const mark = col(table, ref, ['timestamptz'], path, 'a moment (timestamptz)');
      if (mark !== undefined && mark.type === 'timestamptz' && mark.rules?.stamp?.strict !== true) {
        out.push({ path, message: `"${table}.${ref}" is set by the screen that shows the opt-out line, never by hand: make it a strict stamp (rules.stamp.strict)` });
      }
    };
    const markColumn = optOutMarkColumn(entry);
    if (markColumn !== undefined) {
      const path = typeof entry.optOutMark === 'object' ? at('optOutMark', 'column') : at('optOutMark');
      markAt(entry.table, markColumn, path);
      const from = typeof entry.optOutMark === 'object' ? entry.optOutMark.carryFrom : undefined;
      if (from !== undefined) {
        if (from.table === entry.table) out.push({ path: at('optOutMark', 'carryFrom', 'table'), message: 'a mark is carried from the row a person is made from, on another table' });
        else if (index.table(from.table) === undefined) out.push({ path: at('optOutMark', 'carryFrom', 'table'), message: `"${from.table}" is not a table of this app` });
        else markAt(from.table, from.column, at('optOutMark', 'carryFrom', 'column'));
      }
    }

    (entry.carry ?? []).forEach((carry, k) => {
      const here = (...rest: (string | number)[]) => at('carry', k, ...rest);
      if ('stopList' in carry) {
        if (index.column(entry.table, carry.stopList.column) === undefined) out.push({ path: here('stopList', 'column'), message: `"${entry.table}" has no column "${carry.stopList.column}": a carried column stays declared for the release that carries it` });
        return;
      }
      const from = carry.consent;
      if (entry.consent === undefined) {
        out.push({ path: here('consent'), message: 'an answer is carried into the consent column: declare it ("consent")' });
        return;
      }
      if (index.table(from.from) === undefined) {
        out.push({ path: here('consent', 'from'), message: `"${from.from}" is not a table of this app` });
        return;
      }
      const via = col(from.from, from.via, ['fk'], here('consent', 'via'), `a link to "${entry.table}"`);
      if (via?.type === 'fk' && via.references !== entry.table) out.push({ path: here('consent', 'via'), message: `"${from.from}.${from.via}" links to "${via.references ?? ''}", not to "${entry.table}"` });
      col(from.from, from.column, ['bool'], here('consent', 'column'), 'a bool (a yes or no)');
      col(from.from, from.latest, ['date', 'timestamptz', ...NUMBERS], here('consent', 'latest'), 'a date, a moment or a number (what makes an answer the newest)');
    });

    const seen = new Set<string>();
    (entry.copies ?? []).forEach((copy, c) => {
      const here = (...rest: (string | number)[]) => at('copies', c, ...rest);
      if (copy.table === entry.table) {
        out.push({ path: here('table'), message: `a copy is kept on another table: "${entry.table}.${copy.column}" is the person's own column` });
        return;
      }
      if (index.table(copy.table) === undefined) {
        out.push({ path: here('table'), message: `"${copy.table}" is not a table of this app` });
        return;
      }
      const id = `${copy.table}.${copy.column}`;
      if (seen.has(id)) out.push({ path: here('column'), message: `"${id}" is listed twice` });
      seen.add(id);
      col(copy.table, copy.column, ['text'], here('column'), `a text column (${copy.holds === 'email' ? 'an address' : copy.holds === 'phone' ? 'a phone number' : 'a name'})`);
      if (copy.via !== undefined) {
        const link = col(copy.table, copy.via, ['fk'], here('via'), `a link to "${entry.table}"`);
        if (link?.type === 'fk' && link.references !== entry.table) out.push({ path: here('via'), message: `"${copy.table}.${copy.via}" links to "${link.references ?? ''}", not to "${entry.table}"` });
      }
    });

    // The same table's address, said three times, is one address.
    const recipient = m.outbox?.recipient;
    if (recipient !== undefined && recipient.table === entry.table && entry.email !== recipient.email) {
      out.push({ path: at('email'), message: `the outbox writes to "${entry.table}.${recipient.email}" (outbox.recipient.email), so the people of "${entry.table}" have that address: name it here` });
    }
    (m.publicAccess ?? []).forEach((access, a) => {
      const claimed = (access.claim as { email?: unknown } | undefined)?.email;
      if (access.table !== entry.table || typeof claimed !== 'string' || claimed === entry.email) return;
      out.push({ path: at('email'), message: `publicAccess ${String(a)} signs "${entry.table}" in by "${claimed}" (claim.email), so the people of "${entry.table}" have that address: name it here` });
    });
  });
  return out;
}

/**
 * Everything wrong with a public entry's consent tick: an entry that writes
 * nothing, a column that is no bool the entry writes, and a tick kept for no
 * person of the app's `people`. The person is the one the entry finds by
 * address (`identity`), the claimed person whose rows it writes
 * (`claimedBy`), or the row itself on a people table's own entry.
 */
export function publicConsentIssues<C extends PeopleColumn>(
  m: {
    people?: People | undefined;
    publicAccess?: readonly { table: string; methods: readonly string[]; writable?: readonly string[] | undefined; consent?: PublicConsent | undefined; identity?: { table: string } | undefined; claimedBy?: { table: string } | undefined }[] | undefined;
  },
  index: TableIndex<C>,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  (m.publicAccess ?? []).forEach((entry, e) => {
    const consent = entry.consent;
    if (consent === undefined) return;
    const at = (...rest: (string | number)[]) => ['publicAccess', e, 'consent', ...rest];
    if (!entry.methods.includes('POST') && !entry.methods.includes('PATCH')) out.push({ path: at(), message: 'a tick is given on a create or a change: this entry writes nothing' });
    const column = index.column(entry.table, consent.column);
    if (column === undefined) out.push({ path: at('column'), message: `"${entry.table}" has no column "${consent.column}"` });
    else if (column.type !== 'bool') out.push({ path: at('column'), message: `"${entry.table}.${consent.column}" is not a bool (a tick)` });
    else if (!(entry.writable ?? []).includes(consent.column)) out.push({ path: at('column'), message: `"${entry.table}.${consent.column}" is not writable through this entry, so no tick reaches it` });
    const person = entry.identity?.table ?? entry.claimedBy?.table ?? entry.table;
    if (!(m.people ?? []).some((declared) => declared.table === person && declared.kind === 'people')) {
      out.push({ path: at(), message: `a tick is kept for a person: "${person}" is not one of the app's people tables (people), and the entry finds no other (identity, claimedBy)` });
    }
  });
  return out;
}
