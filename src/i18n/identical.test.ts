/**
 * An untranslated string passes every parity check: its key is present in
 * every language — it just says the English. So the words are compared too.
 *
 *   - No string anywhere a person reads — the app's own strings on both sides,
 *     the manifest's labels, the emails, the demo card — may equal its English
 *     in another language, unless `testing/sameAsEnglish.ts` names that exact text in
 *     that language with a reason: the same word in that language ("Studio"),
 *     a unit, a paper size, an example of what to type. A string with no
 *     letters outside its placeholders reads the same everywhere and passes.
 *   - An entry on that list nothing matches any more fails as well.
 *   - And, as before, no screen may be mostly English (the coarse check that
 *     catches a screen pasted wholesale, whatever the list says).
 */
import { describe, expect, it } from "vitest";

import { DEMO_MESSAGES } from "../demo/strings.ts";
import { emailWords } from "../manifest/emails.ts";
import { WORDS } from "../manifest/words.ts";
import { LOCALE_TAGS } from "./locales.ts";
import { MESSAGES } from "./messages/index.ts";
import { SAME_AS_ENGLISH } from "../testing/sameAsEnglish.ts";

/** Text that reads the same in every language: numbers, symbols, a lone placeholder, a code. */
const neutral = (text: string): boolean => /^[\s\d{}\p{P}\p{S}]*$/u.test(text.replace(/\{[^}]+\}/g, "")) || text.length <= 3;

/** No letter outside its placeholders (`{n}`, `{{invoice.number}}`): the same in any language. */
const noWords = (text: string): boolean => !/\p{L}/u.test(text.replace(/\{\{[^}]*\}\}|\{\w+\}/g, ""));

interface Said {
  where: string;
  locale: string;
  key: string;
  text: string;
  english: string;
}

/** Every string beside its English, from every place the app keeps words. */
function everything(): Said[] {
  const out: Said[] = [];
  const others = LOCALE_TAGS.filter((t) => t !== "en-US");
  const english = MESSAGES["en-US"];
  for (const locale of others) {
    for (const [key, text] of Object.entries(MESSAGES[locale])) out.push({ where: "strings", locale, key, text, english: english[key] ?? "" });
  }
  for (const [en, translated] of Object.entries(WORDS)) {
    for (const [locale, text] of Object.entries(translated)) out.push({ where: "manifest", locale, key: en, text, english: en });
  }
  const flat = (value: unknown, path: string): [string, string][] =>
    typeof value === "string" ? [[path, value]] : Array.isArray(value) ? value.flatMap((v, i) => flat(v, `${path}[${String(i)}]`)) : Object.entries(value as object).flatMap(([k, v]) => flat(v, path === "" ? k : `${path}.${k}`));
  const emails = emailWords();
  const emailEnglish = new Map(flat(emails["en-US"], ""));
  for (const locale of others) for (const [key, text] of flat(emails[locale], "")) out.push({ where: "emails", locale, key, text, english: emailEnglish.get(key) ?? "" });
  const demo = DEMO_MESSAGES as Record<string, Record<string, string>>;
  for (const locale of others) for (const [key, text] of Object.entries(demo[locale] ?? {})) out.push({ where: "demo card", locale, key, text, english: demo["en-US"]![key] ?? "" });
  return out;
}

describe("nothing reads as its English in another language, but what is named", () => {
  const all = everything();
  const same = all.filter((s) => s.text === s.english && !noWords(s.text));
  const allowed = (s: Said) => SAME_AS_ENGLISH.some((a) => a.text === s.text && (a.locales as readonly string[]).includes(s.locale));

  it("sees every place words are kept (the control: an empty walk would pass by silence)", () => {
    const where = new Set(all.map((s) => s.where));
    expect([...where].sort()).toEqual(["demo card", "emails", "manifest", "strings"]);
    expect(all.length).toBeGreaterThan(7 * 2000);
    // …and would see a string left in English.
    expect(noWords("Send the invoice")).toBe(false);
    expect(noWords("{number} · {title} — {{invoice.number}}")).toBe(true);
  });

  it("every string equal to its English is on the list, in its language", () => {
    expect(same.filter((s) => !allowed(s)).map((s) => `${s.where} ${s.locale} ${s.key}: ${s.text}`)).toEqual([]);
  });

  it("every entry on the list still matches, in each language it names", () => {
    const stale: string[] = [];
    for (const entry of SAME_AS_ENGLISH) {
      for (const locale of entry.locales) if (!same.some((s) => s.text === entry.text && s.locale === locale)) stale.push(`${locale}: ${entry.text}`);
      if (entry.why.trim().length < 12) stale.push(`${entry.text}: no reason given`);
    }
    expect(stale).toEqual([]);
  });
});

describe("every screen is written in every language", () => {
  it("leaves no screen mostly in English", () => {
    const english = MESSAGES["en-US"];
    const flagged: string[] = [];
    const screens = new Map<string, string[]>();
    for (const key of Object.keys(english)) {
      const screen = key.split(".")[0]!;
      screens.set(screen, [...(screens.get(screen) ?? []), key]);
    }
    expect(screens.size).toBeGreaterThan(8);
    for (const [locale, bundle] of Object.entries(MESSAGES)) {
      if (locale === "en-US") continue;
      for (const [screen, keys] of screens) {
        const words = keys.filter((k) => !neutral(english[k]!));
        const same = words.filter((k) => bundle[k] === english[k]);
        if (words.length >= 3 && same.length / words.length >= 0.3) flagged.push(`${locale} ${screen}: ${String(same.length)}/${String(words.length)} (${same.slice(0, 4).join(", ")})`);
      }
    }
    expect(flagged).toEqual([]);
  });
});
