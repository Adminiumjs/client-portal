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

/** What a person fills in for one input, and how the builder draws it. */
export const ADD_ON_STEP_INPUT_KINDS = ['text', 'email', 'number', 'choice', 'record'] as const;
export type AddOnStepInputKind = (typeof ADD_ON_STEP_INPUT_KINDS)[number];

export const addOnStepInputSchema = z
  .object({
    key,
    label: localized(60),
    kind: z.enum(ADD_ON_STEP_INPUT_KINDS),
    required: z.boolean().optional(),
    /** For `choice`: what may be chosen. */
    options: z.array(z.object({ value: z.string().min(1).max(60), label: localized(60) }).strict()).min(1).max(20).optional(),
    /** For `record`: the add-on's table a row is picked from; the row's key is what is written. */
    table: ref.optional(),
  })
  .strict();
export type AddOnStepInput = z.infer<typeof addOnStepInputSchema>;

/** What the run's own words a written column may take. */
export const ADD_ON_STEP_TOKENS = ['now', 'ruleName', 'recordLabel'] as const;

/** How one column of the written row is filled: from an input, with a fixed text, or with one of the run's own words. */
export const addOnStepValueSchema = z.union([
  z.object({ input: key }).strict(),
  // Plain text only: a `{{…}}` here would read the rule's record with nobody having chosen it.
  z.object({ text: z.string().max(400).regex(/^[^{}]*$/, 'a fixed text holds no braces') }).strict(),
  z.object({ token: z.enum(ADD_ON_STEP_TOKENS) }).strict(),
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
  .refine((step) => step.inputs.every((input) => (input.kind === 'record') === (input.table !== undefined)), { message: 'a record input names its table, and only a record does', path: ['inputs'] });
export type AddOnStep = z.infer<typeof addOnStepSchema>;

export const addOnStepsSchema = z
  .array(addOnStepSchema)
  .min(1)
  .max(8)
  .refine((steps) => new Set(steps.map((step) => step.key)).size === steps.length, { message: 'duplicate step key' });
