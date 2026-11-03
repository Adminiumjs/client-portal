/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/steps.ts.
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
 * STEPS AN ADD-ON GIVES TO AUTOMATIONS (`addOn.steps`).
 *
 * A step is a NAMED ROW-WRITE: the add-on says what the step is called, what a
 * person fills in, and the one row of one of its own tables the step creates.
 * The engine writes that row through the same write service as a rule's own
 * "create a record", so the add-on's column rules, its ledgers and its outbox
 * do the rest (a voucher's code is made by a column rule; the add-on's outbox
 * mails it). No code of the add-on runs in a rule.
 *
 * Only the shape is checked here. That the table and the columns are the
 * add-on's own, and that every input is used, is `@adminium/manifest`'s to
 * check against the manifest's `requiredSchema`.
 */
import { z } from 'zod';

import { DOCUMENT_LOCALE_IDS, type DocumentLocaleId } from './document-render.ts';

/** A text in every one of the product's languages, each at most `max` characters. */
function localized(max: number) {
  return z
    .object(Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, z.string().min(1).max(max)])) as Record<DocumentLocaleId, z.ZodString>)
    .strict();
}

const key = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a key is kebab-case, at most 40 characters');
/** A table or a column of the add-on's own schema, by its ref. */
const ref = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/, 'a ref of the add-on\'s own schema');

/**
 * What a person fills in for one input, and how the builder draws it. A
 * `person` (from Adminium 0.3.41) is whose row of a people table the step
 * is about: the rule's record itself when its table holds people, or the
 * person one link of it names ("the job's main contact"). The rule keeps
 * `@record` or `@link:<column>`; the step's values read that person's
 * fields (`{ person, field }`).
 */
export const ADD_ON_STEP_INPUT_KINDS = ['text', 'email', 'number', 'choice', 'record', 'person'] as const;
export type AddOnStepInputKind = (typeof ADD_ON_STEP_INPUT_KINDS)[number];

/** How a `person` input is kept in a rule: the record itself, or the person one link column of it names. */
export const ADD_ON_STEP_PERSON = /^@record$|^@link:[A-Za-z_][A-Za-z0-9_]{0,62}$/;

/** A condition a `record` input's rows meet, in the picker and at the run: one column, one value. */
export const addOnStepWhereSchema = z.object({ column: ref, eq: z.union([z.string().max(60), z.number(), z.boolean()]) }).strict();
export type AddOnStepWhere = z.infer<typeof addOnStepWhereSchema>;

export const addOnStepInputSchema = z
  .object({
    key,
    label: localized(60),
    kind: z.enum(ADD_ON_STEP_INPUT_KINDS),
    required: z.boolean().optional(),
    /** One line under the field (from Adminium 0.3.41): "Only live surveys are listed." */
    help: localized(160).optional(),
    /**
     * For `choice`: what may be chosen. With a `help` line on each (from
     * Adminium 0.3.41), the rule editor draws the choice as cards, each with
     * its line under it.
     */
    options: z.array(z.object({ value: z.string().min(1).max(60), label: localized(60), help: localized(160).optional() }).strict()).min(1).max(20).optional(),
    /** For `record`: the add-on's table a row is picked from; the row's key is what is written. */
    table: ref.optional(),
    /**
     * For `record` (from Adminium 0.3.41): the unique column of that table a
     * rule names the row by, in place of its key: a rule shipped in a
     * manifest names a survey by its slug. The run finds the row by it, and
     * the row's key is still what is written.
     */
    by: ref.optional(),
    /** For `record` (from Adminium 0.3.41): what a row must hold to be picked, in the editor's list and at the run (only live surveys). */
    where: z.array(addOnStepWhereSchema).min(1).max(3).optional(),
  })
  .strict();
export type AddOnStepInput = z.infer<typeof addOnStepInputSchema>;

/**
 * What the run's own words a written column may take. `recordTable` and
 * `recordKey` (from Adminium 0.3.41) are the rule's record as rows of other
 * tables name it: its table's stored name (`<app>:<table>`, what an add-on's
 * record tab matches on) and its key as text.
 */
export const ADD_ON_STEP_TOKENS = ['now', 'ruleName', 'recordLabel', 'recordTable', 'recordKey'] as const;

/**
 * What a `person` input gives a column: their address, name and language
 * (the install's own language where their table keeps none), the name of the
 * company they work for, and their row as the consent log names it (its
 * table and key). The address and the name are personal: they go only into
 * columns the add-on keeps personal.
 */
export const ADD_ON_STEP_PERSON_FIELDS = ['email', 'name', 'language', 'company', 'table', 'key'] as const;
export type AddOnStepPersonField = (typeof ADD_ON_STEP_PERSON_FIELDS)[number];
/** The person's fields that are personal: written only into columns the add-on keeps personal, and never logged. */
export const ADD_ON_STEP_PERSONAL_FIELDS: readonly AddOnStepPersonField[] = ['email', 'name'];

/** How one column of the written row is filled: from an input, with a fixed text, with one of the run's own words, or with a field of a person input. */
export const addOnStepValueSchema = z.union([
  z.object({ input: key }).strict(),
  // Plain text only: a `{{…}}` here would read the rule's record with nobody having chosen it.
  z.object({ text: z.string().max(400).regex(/^[^{}]*$/, 'a fixed text holds no braces') }).strict(),
  z.object({ token: z.enum(ADD_ON_STEP_TOKENS) }).strict(),
  z.object({ person: key, field: z.enum(ADD_ON_STEP_PERSON_FIELDS) }).strict(),
]);
export type AddOnStepValue = z.infer<typeof addOnStepValueSchema>;

export const addOnStepSchema = z
  .object({
    key,
    /** What the step is called in the step list and on its card: "Issue a voucher". */
    name: localized(60),
    /** One line under the name: "Sends a voucher from one of your offers". */
    does: localized(160),
    inputs: z.array(addOnStepInputSchema).max(8),
    writes: z.object({ table: ref, values: z.record(ref, addOnStepValueSchema) }).strict(),
  })
  .strict()
  .refine((step) => new Set(step.inputs.map((input) => input.key)).size === step.inputs.length, { message: 'duplicate input key', path: ['inputs'] })
  .refine((step) => step.inputs.every((input) => (input.kind === 'choice') === (input.options !== undefined)), { message: 'a choice input lists its options, and only a choice does', path: ['inputs'] })
  .refine((step) => step.inputs.every((input) => (input.kind === 'record') === (input.table !== undefined)), { message: 'a record input names its table, and only a record does', path: ['inputs'] })
  .refine((step) => step.inputs.every((input) => input.kind === 'record' || (input.by === undefined && input.where === undefined)), { message: 'only a record input names a row by a column, or says which rows may be picked', path: ['inputs'] })
  .refine((step) => Object.values(step.writes.values).every((value) => !('person' in value) || step.inputs.some((input) => input.key === value.person && input.kind === 'person')), {
    message: 'a person\'s field is read from one of the step\'s person inputs',
    path: ['writes', 'values'],
  })
  .refine((step) => Object.values(step.writes.values).every((value) => !('input' in value) || step.inputs.find((input) => input.key === value.input)?.kind !== 'person'), {
    message: 'a person input fills columns by its fields ({ person, field }), never as a whole',
    path: ['writes', 'values'],
  });
export type AddOnStep = z.infer<typeof addOnStepSchema>;

export const addOnStepsSchema = z
  .array(addOnStepSchema)
  .min(1)
  .max(8)
  .refine((steps) => new Set(steps.map((step) => step.key)).size === steps.length, { message: 'duplicate step key' });
