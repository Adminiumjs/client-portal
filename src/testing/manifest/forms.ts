/*
 * VENDORED VERBATIM from packages/manifest/src/forms.ts.
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
 * FORMS: THE ADD-ON BLOCK'S `forms` WORD.
 *
 * A forms add-on names which of its own tables hold the forms, the answers,
 * and (optionally) the survey invitations and the strangers' files:
 *
 * ```json
 * "addOn": { "forms": { "forms": "forms", "answers": "answers", "invitations": "invitations", "files": "answer_files" } }
 * ```
 *
 * The engine reads, draws and writes every form for a stranger (no add-on
 * code runs for one), so each table must have the columns the engine reads
 * and writes, by these names and of these kinds ({@link FORMS_COLUMNS}). The
 * add-on's builder writes the forms; Adminium alone writes the answers and
 * the files, as it does a ledger's receipts: no role of the add-on, no app's
 * grant and no step of the add-on writes them. No public entry of the add-on
 * opens any of the four: strangers are served by the engine alone.
 *
 * Which tables an answer may BECOME a row of is the apps' word, not the
 * add-on's: an app opens a table to forms through a `publicAccess` entry
 * under the reserved key `forms` (see `public-access.ts`).
 *
 * Pure: no I/O, and nothing imported from the manifest's own schema file, so
 * that file may import this one.
 */
import { z } from 'zod';

import { refSchema, type ReferenceIssue } from './refs.ts';

/** The block: the add-on's own tables, by ref. */
export const addOnFormsSchema = z
  .object({
    forms: refSchema,
    answers: refSchema,
    invitations: refSchema.optional(),
    files: refSchema.optional(),
  })
  .strict();
export type AddOnForms = z.infer<typeof addOnFormsSchema>;

/** The four parts a forms block names. */
export type FormsPart = keyof AddOnForms;
export const FORMS_PARTS = ['forms', 'answers', 'invitations', 'files'] as const satisfies readonly FormsPart[];

/**
 * The longest name of the table an answer became that every answers table
 * holds (`became_table`: `<app>:<table ref>`). An app whose forms entry's
 * table would be stored longer is refused, so no answer ever cuts one.
 */
export const FORMS_BECAME_TABLE_MAX = 64;

/** The category a package that declares forms is filed under. */
export const FORMS_CATEGORY = 'marketing';

/** What one column of a forms table must be. */
export interface FormsColumn {
  /** The column types it may be. */
  types: readonly string[];
  /** The engine writes it empty: the column must take that. */
  nullable?: true;
  /** No two rows hold the same value. */
  unique?: true;
  /** A text the engine writes this long must fit: unbounded, or at least this many characters. */
  atLeast?: number;
  /** An enum's values, exactly. */
  values?: readonly string[];
  /** A link to another part of the block. */
  links?: FormsPart;
}

const text = (atLeast?: number, nullable?: true): FormsColumn => ({ types: ['text'], ...(atLeast === undefined ? {} : { atLeast }), ...(nullable === undefined ? {} : { nullable }) });
const moment = (nullable?: true): FormsColumn => ({ types: ['timestamptz'], ...(nullable === undefined ? {} : { nullable }) });
const json = (nullable?: true): FormsColumn => ({ types: ['json'], ...(nullable === undefined ? {} : { nullable }) });
const whole = (nullable?: true): FormsColumn => ({ types: ['int', 'bigint'], ...(nullable === undefined ? {} : { nullable }) });
const choice = (values: readonly string[]): FormsColumn => ({ types: ['enum'], values });
const link = (to: FormsPart, nullable?: true): FormsColumn => ({ types: ['fk'], links: to, ...(nullable === undefined ? {} : { nullable }) });

/**
 * The columns each part has, which the engine reads and writes by these names.
 * A table may have more of its own; on the tables Adminium alone writes
 * (answers, files) each other column is one an insert may leave out.
 */
export const FORMS_COLUMNS: Readonly<Record<FormsPart, Readonly<Record<string, FormsColumn>>>> = {
  forms: {
    slug: { types: ['text'], unique: true },
    kind: choice(['form', 'survey']),
    state: choice(['draft', 'live', 'closed']),
    definition: json(),
    settings: json(),
    /** The definition and settings frozen at publish: strangers are served only this. */
    published: json(true),
    published_at: moment(true),
  },
  answers: {
    form_id: link('forms'),
    submitted_at: moment(),
    language: text(10),
    values: json(),
    email: text(320, true),
    name: text(200, true),
    became_table: text(FORMS_BECAME_TABLE_MAX, true),
    became_key: text(200, true),
    confirm: choice(['none', 'pending', 'confirmed', 'expired']),
    consent_purpose: text(20, true),
    consent_wording: text(2000, true),
    consent_version: whole(true),
    ip: text(64, true),
    user_agent: text(512, true),
    sent_from: text(2048, true),
  },
  invitations: {
    form_id: link('forms'),
    email: text(320),
    name: text(200, true),
    language: text(10),
    person_table: text(64),
    person_key: text(200),
    /** The record a survey's answer fills a link column from (the job the survey is about). */
    record_table: text(64, true),
    record_key: text(200, true),
    token_hash: text(64, true),
    class: choice(['marketing', 'service']),
    invited_at: moment(),
    answered_at: moment(true),
    expires_at: moment(true),
  },
  files: {
    answer_id: link('answers', true),
    file_id: text(64),
    question: text(16),
    name: text(255),
    size: whole(),
    kind: text(20),
    uploaded_at: moment(),
    expires_at: moment(true),
  },
};

/** The column an answer row links its invitation by, when the block names invitations. */
export const ANSWER_INVITATION_COLUMN = 'invitation_id';

/** What the checks read of a table. */
export interface FormsTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    role?: string | undefined;
    nullable?: boolean | undefined;
    enum?: readonly string[] | undefined;
    references?: string | undefined;
    maxLength?: number | undefined;
    unique?: boolean | undefined;
    default?: unknown;
  }[];
  appGrants?: { actions: readonly string[] } | undefined;
}

/** The parts of the add-on the checks read beside its tables. */
export interface FormsAddOnShape {
  categories: readonly string[];
  tables: readonly FormsTableShape[];
  roles?: readonly { key: string; cloneFrom?: string | undefined; permissions?: readonly string[] | undefined }[] | undefined;
  publicAccess?: readonly { table: string }[] | undefined;
  steps?: readonly { key: string; writes: { table: string } }[] | undefined;
  /** Whether a rule of the column decides it (a code, a stamp, a default rule): an insert may leave it out. */
  decided?: ((table: string, column: string) => boolean) | undefined;
  /** The add-on's one-row settings table (`addOn.settingsTable`), when it has one. */
  settingsTable?: string | undefined;
}

/**
 * The column of a forms add-on's settings table that says how many months
 * its answers are kept; empty keeps them until they are removed. The keeping
 * sweep reads it, so when the table has it, it is a whole number that may be
 * empty.
 */
export const FORMS_ANSWERS_MONTHS_COLUMN = 'answers_months';

/** The actions on a table no grant gives on a table only Adminium writes. */
const WRITES = ['create', 'update', 'import'] as const;

/** Everything wrong with an add-on's forms block, against its own tables, roles, entries and steps. */
export function formsBlockIssues(block: AddOnForms, m: FormsAddOnShape): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const tables = new Map(m.tables.map((table, t) => [table.ref, { table, t }]));
  const at = (...rest: (string | number)[]) => ['addOn', 'forms', ...rest];

  if (!m.categories.includes(FORMS_CATEGORY)) out.push({ path: ['categories'], message: `an add-on that declares forms is filed under the "${FORMS_CATEGORY}" category` });

  const named = FORMS_PARTS.flatMap((part) => (block[part] === undefined ? [] : [[part, block[part]] as const]));
  const seen = new Map<string, FormsPart>();
  for (const [part, ref] of named) {
    const other = seen.get(ref);
    if (other !== undefined) out.push({ path: at(part), message: `"${ref}" holds the ${other} already: each part of forms is a table of its own` });
    seen.set(ref, part);
  }

  for (const [part, ref] of named) {
    const found = tables.get(ref);
    if (found === undefined) {
      out.push({ path: at(part), message: `"${ref}" is not one of this add-on's tables` });
      continue;
    }
    const { table, t } = found;
    const columnAt = (c: number, ...rest: (string | number)[]) => ['requiredSchema', 'tables', t, 'columns', c, ...rest];
    const contract: Record<string, FormsColumn> = { ...FORMS_COLUMNS[part] };
    if (part === 'answers' && block.invitations !== undefined) contract[ANSWER_INVITATION_COLUMN] = link('invitations', true);

    for (const [name, want] of Object.entries(contract)) {
      const c = table.columns.findIndex((column) => column.ref === name);
      const column = table.columns[c];
      if (column === undefined) {
        out.push({ path: at(part), message: `"${ref}" holds the ${part}, so it has a column "${name}" (${describe(want)})` });
        continue;
      }
      const say = (message: string, ...rest: (string | number)[]) => out.push({ path: columnAt(c, ...rest), message: `"${ref}.${name}" ${message}` });
      if (!want.types.includes(column.type)) {
        say(`is read and written by Adminium as ${describe(want)}, not ${column.type}`, 'type');
        continue;
      }
      if (want.nullable === true && column.nullable !== true) say('is written empty until there is something to put in it: make it nullable', 'nullable');
      if (want.unique === true && column.unique !== true) say('names one row: make it unique', 'unique');
      if (want.atLeast !== undefined && column.maxLength !== undefined && column.maxLength < want.atLeast) say(`takes up to ${String(want.atLeast)} characters: leave out maxLength, or make it at least that`, 'maxLength');
      if (want.values !== undefined) {
        const values = new Set(column.enum ?? []);
        if (values.size !== want.values.length || !want.values.every((value) => values.has(value))) say(`takes exactly ${want.values.map((value) => `"${value}"`).join(', ')}`, 'enum');
      }
      if (want.links !== undefined) {
        const target = block[want.links];
        if (column.references !== target) say(`links to the ${want.links} ("${String(target)}")`, 'references');
      }
    }

    // The engine serves a stranger a form's published words and nothing else: no public entry of the add-on opens a forms table.
    (m.publicAccess ?? []).forEach((entry, e) => {
      if (entry.table === ref) out.push({ path: ['publicAccess', e, 'table'], message: `"${ref}" holds the ${part}, which Adminium alone serves to strangers: no public entry opens it` });
    });

    // A table only Adminium writes: every other column is one its insert may leave out.
    if (part === 'answers' || part === 'files') {
      table.columns.forEach((column, c) => {
        if (contract[column.ref] !== undefined || column.role === 'pk' || column.nullable === true || column.default !== undefined || m.decided?.(ref, column.ref) === true) return;
        out.push({ path: columnAt(c), message: `"${ref}" is written by Adminium alone, which never fills "${column.ref}": make it nullable or give it a default` });
      });
      out.push(...onlyAdminiumWrites(ref, t, part, m));
    }
  }
  // How long answers are kept, as the keeping sweep reads it: a whole number of months, or empty for "until removed".
  const settings = m.settingsTable === undefined ? undefined : tables.get(m.settingsTable);
  if (settings !== undefined) {
    const c = settings.table.columns.findIndex((column) => column.ref === FORMS_ANSWERS_MONTHS_COLUMN);
    const column = settings.table.columns[c];
    const where = ['requiredSchema', 'tables', settings.t, 'columns', c];
    if (column !== undefined && column.type !== 'int' && column.type !== 'bigint') {
      out.push({ path: [...where, 'type'], message: `"${settings.table.ref}.${FORMS_ANSWERS_MONTHS_COLUMN}" is how many months answers are kept, a whole number: int, not ${column.type}` });
    } else if (column !== undefined && column.nullable !== true) {
      out.push({ path: [...where, 'nullable'], message: `"${settings.table.ref}.${FORMS_ANSWERS_MONTHS_COLUMN}" is empty while answers are kept until removed: make it nullable` });
    }
  }
  return out;
}

/**
 * Nothing of the add-on writes a table only Adminium writes: no role's
 * create, update or import, no app's grant beyond reading, no step (and, as
 * for every forms table, no public entry). Staff read the answers and delete
 * them, never write them.
 */
function onlyAdminiumWrites(ref: string, t: number, part: FormsPart, m: FormsAddOnShape): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const why = `the ${part} are written by Adminium alone`;
  const roles = m.roles ?? [];
  roles.forEach((role, r) => {
    const from = role.cloneFrom === undefined ? undefined : roles.find((other) => other.key === role.cloneFrom);
    const grants = new Set([...(from?.permissions ?? []), ...(role.permissions ?? [])]);
    for (const action of WRITES) {
      if (grants.has(`table:@${ref}:${action}`) || grants.has(`table:@*:${action}`)) {
        out.push({ path: ['roles', r, 'permissions'], message: `"${role.key}" may ${action} "${ref}", and ${why}: a role reads and deletes them` });
      }
    }
  });
  const table = m.tables[t];
  (table?.appGrants?.actions ?? []).forEach((action, a) => {
    if (action !== 'read') out.push({ path: ['requiredSchema', 'tables', t, 'appGrants', 'actions', a], message: `${why}: an app's role may only read "${ref}"` });
  });
  (m.steps ?? []).forEach((step, s) => {
    if (step.writes.table === ref) out.push({ path: ['addOn', 'steps', s, 'writes', 'table'], message: `${why}: the step "${step.key}" may not write a row of "${ref}"` });
  });
  return out;
}

/** A column's contract in words, for a refusal. */
function describe(want: FormsColumn): string {
  const kind = want.links !== undefined ? `a link to the ${want.links}` : want.values !== undefined ? `an enum of ${want.values.join(', ')}` : want.types.join(' or ');
  return [kind, ...(want.atLeast === undefined ? [] : [`at least ${String(want.atLeast)} characters`]), ...(want.nullable === true ? ['nullable'] : []), ...(want.unique === true ? ['unique'] : [])].join(', ');
}
