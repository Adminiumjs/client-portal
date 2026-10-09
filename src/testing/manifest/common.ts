/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/common.ts.
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
 * Shapes shared by more than one contract. Kept in one place so a `FileRef`
 * from a carrier label and a `FileRef` from a production file are the same
 * type — the host stores both through one file seam.
 */

import { z } from 'zod';

export interface FileRef {
  fileId: string;
  filename: string;
  mediaType: string;
  bytes: number;
}

export const fileRefSchema = z
  .object({
    fileId: z.string().min(1),
    filename: z.string().min(1),
    mediaType: z.string().min(1),
    bytes: z.number().int().positive(),
  })
  .strict();

/** An i18n message: a catalog key plus the English fallback rendered when the key is absent. */
export const i18nMessageSchema = z
  .object({
    key: z.string().min(1).max(120),
    fallback: z.string().min(1).max(400),
  })
  .strict();
export type I18nMessage = z.infer<typeof i18nMessageSchema>;

/**
 * A message's words in the other languages its add-on speaks, by language tag
 * (`de-DE`). The dashboard's own catalogue holds no add-on's keys, and an
 * add-on's bundle is not loaded while the sidebar is drawn — so a text that
 * is shown BEFORE the add-on's code runs (a page's title in the rail, a
 * group's heading, a tab on a record) carries its translations here, beside
 * the message, and Adminium hands the reader theirs. The message's
 * `fallback` stays the English.
 */
export const wordsByLanguageSchema = z.record(z.string().regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'keyed by BCP 47 tag'), z.string().min(1).max(400));
export type WordsByLanguage = z.infer<typeof wordsByLanguageSchema>;
