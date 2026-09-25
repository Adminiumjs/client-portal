/**
 * Every word the manifest shows a person, in the eight languages the app
 * ships.
 *
 * The manifest is written in English (`tables.ts`, `pages.ts` …) and each
 * English label is looked up here when `manifest.json` is written. A label
 * with no entry stops the write rather than shipping English to seven
 * languages: a column label that reads "Date of birth" to a Danish desk is the
 * half-translated screen this app's typed strings exist to prevent.
 *
 * `WORDS` is data, kept in `words.ts` so the translations can be read and
 * reviewed apart from the structure that uses them.
 */
import { WORDS } from "./words.ts";

export const LOCALES = ["en-US", "de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"] as const;
export type Tag = (typeof LOCALES)[number];
export type Labels = Record<Tag, string>;

/** The seven languages beside English, as a translation carries them. */
export type Translation = Record<Exclude<Tag, "en-US">, string>;

/** English labels asked for while writing, so a missing one is reported with all the others. */
const missing = new Set<string>();

/** One label in all eight languages. */
export function l(en: string): Labels {
  const found = WORDS[en];
  if (found === undefined) {
    missing.add(en);
    return { "en-US": en } as Labels;
  }
  return { "en-US": en, ...found };
}

/** A page's other seven titles, keyed as `titles` wants them. */
export function titles(en: string): Translation {
  const { "en-US": _en, ...rest } = l(en);
  return rest;
}

/** Every English label that has no translation yet — empty before `manifest.json` may be written. */
export function untranslated(): string[] {
  return [...missing].sort();
}
