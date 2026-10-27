/*
 * VENDORED VERBATIM from packages/manifest/src/mail-classes.ts.
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
 * The two classes of mail to a contact. Kept apart from `mail-class.ts` so the
 * outbox and automation words can name them without importing the reader that
 * reads those words back (which would be an import cycle).
 */
export const MAIL_CLASSES = ['marketing', 'service'] as const;
export type MailClass = (typeof MAIL_CLASSES)[number];
