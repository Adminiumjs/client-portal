/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/assistant-block.ts.
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
 * WHAT AN ADD-ON TELLS THE ASSISTANT (`addOn.assistant`).
 *
 * Two things, and nothing that acts:
 *
 *  - `tables`: one line on what each of its tables IS, and a line for a column
 *    that needs one ("a voucher is a single-use code issued to one person; a
 *    gift card holds a balance"). English, for the model: it is read with the
 *    schema, as data about the table, wherever the assistant looks at it.
 *  - `questions`: things a person might ask on the add-on's pages, in every
 *    language, shown as starters in the assistant's panel there.
 *
 * It is text. It names no tool, grants no read, and switches nothing on: the
 * engine reads these two keys and no other, and what it reads it shows as the
 * add-on's own words. Which tables, columns and pages the refs are is
 * `@adminium/manifest`'s to check.
 */
import { z } from 'zod';

import { DOCUMENT_LOCALE_IDS, type DocumentLocaleId } from './document-render.ts';

/** A table, a column or a page of the add-on's own, by its ref. */
const ref = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/, 'a ref of the add-on\'s own');
const key = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a key is kebab-case, at most 40 characters');

/** The most starter questions an add-on gives. */
export const ADD_ON_QUESTIONS_MAX = 8;
/** The longest line on what a table is, and on a column. */
export const ADD_ON_TABLE_NOTE_MAX = 200;
export const ADD_ON_COLUMN_NOTE_MAX = 160;

export const addOnAssistantSchema = z
  .object({
    tables: z
      .record(
        ref,
        z
          .object({
            /** What the table is, in one line. English, for the model. */
            is: z.string().min(1).max(ADD_ON_TABLE_NOTE_MAX),
            /** A line for each column that needs one. */
            columns: z.record(ref, z.string().min(1).max(ADD_ON_COLUMN_NOTE_MAX)).optional(),
          })
          .strict(),
      )
      .refine((tables) => Object.keys(tables).length <= 60, 'at most 60 tables')
      .optional(),
    questions: z
      .array(
        z
          .object({
            key,
            /** The question as a person would ask it, in every language. */
            text: z.object(Object.fromEntries(DOCUMENT_LOCALE_IDS.map((id) => [id, z.string().min(1).max(120)])) as Record<DocumentLocaleId, z.ZodString>).strict(),
            /** The one page of the add-on it is shown on; left out, it is shown on all of them. */
            page: ref.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(ADD_ON_QUESTIONS_MAX)
      .refine((questions) => new Set(questions.map((question) => question.key)).size === questions.length, { message: 'duplicate question key' })
      .optional(),
  })
  .strict()
  .refine((block) => block.tables !== undefined || block.questions !== undefined, { message: 'says what its tables are, or gives questions, or both' });
export type AddOnAssistant = z.infer<typeof addOnAssistantSchema>;
