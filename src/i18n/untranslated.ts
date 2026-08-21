// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Deferred translations, marked so the compiler and a human can both see them
 * (28-public-surface.md §7C, 28-T24).
 *
 * ── THE PROBLEM THIS SOLVES ────────────────────────────────────────────────
 * Non-English locales are typed against the English key set, so a missing key
 * is a COMPILE error, not a soft fallback. That is the right default — it is
 * what stops a screen silently going half-English. But it also means shipping a
 * new feature requires inventing seven translations on the spot, and the usual
 * workaround (paste the English into all eight) is worse: the tracker cannot
 * tell pasted English from a real translation, so the debt becomes invisible.
 *
 * ── HOW IT WORKS ───────────────────────────────────────────────────────────
 * Author a string as `en("Place order")` and it becomes OPTIONAL in the other
 * seven locales — absent rather than English-identical — and falls back to
 * English at runtime. Author it normally and it stays REQUIRED.
 *
 * ── WHY A BRAND AND NOT `Partial<>` ────────────────────────────────────────
 * `Partial<Record<keyof EN, string>>` would make EVERY key optional, so an
 * existing translation could be deleted with no compile error — a silent
 * regression channel. The brand makes exactly the deferred keys optional and
 * leaves the rest as strict as they were.
 *
 * It also makes the debt COUNTABLE: `grep -c 'en('` per repo, which is what
 * `untranslated.json` records. And because deferred keys end up ABSENT rather
 * than English-identical, maker-shop's rule that no more than 4% of keys may
 * equal their English passes untouched instead of needing an exemption list
 * that repo's own test argues against.
 *
 * SYNCED FILE — edit it in `workplan/tools/i18n-guard/` and run `i18n-guard.sh
 * sync`. A per-repo edit drifts and only `status` will notice.
 */

/** A string the other locales have not translated yet. */
export type Untranslated<T extends string> = T & { readonly __untranslated: unique symbol };

/**
 * Mark an English string as not-yet-translated.
 *
 * ```ts
 * export const screens = {
 *   "en-US": {
 *     "book.title": "Book a visit",        // required in all eight
 *     "book.newField": en("Choose a time"), // optional in the other seven
 *   },
 *   "de-DE": { "book.title": "Termin buchen" },  // newField may be omitted
 * };
 * ```
 */
export const en = <T extends string>(source: T): Untranslated<T> => source as Untranslated<T>;

/**
 * The per-locale shape: deferred keys optional, everything else required.
 *
 * Kept here rather than inline in each `messages/index.ts` so the fourteen
 * repos that share this guard share one definition of it.
 */
export type Translated<EN> = {
  [K in keyof EN as EN[K] extends Untranslated<string> ? never : K]: string;
} & {
  [K in keyof EN as EN[K] extends Untranslated<string> ? K : never]?: string;
};
