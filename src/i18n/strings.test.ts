/**
 * Every area's strings, checked the way a slip would show on a screen or in
 * the release sweep:
 *
 *   - each area names its keys by itself (`home.*` in home.ts), so two areas
 *     never collide; the shared chrome owns its own prefixes;
 *   - every language names the same placeholders as English;
 *   - a plural has one variant per plural form of its language, or none;
 *   - nothing says what the release sweep refuses — the banned English runs
 *     (as substrings), the word "pro", and each language's own spelling of the
 *     same ideas;
 *   - nothing says what this product must never say ("the link never
 *     expires", another client's document "belongs to someone else", a fixed
 *     time, a fixed terms version) and nothing leaks a private reference.
 *
 * The lanes' areas are held to all of it the moment they add a key.
 */
import { describe, expect, it } from "vitest";

import { HOMOGRAPH_TOKENS, IDEA_IN_LANGUAGE, OTHER_LANGUAGES, PRO_PHRASES, SUBSTRING_BANNED, type OtherLanguage } from "../testing/lexicon.ts";
import { AREAS } from "./messages/index.ts";

/** Plural forms per language, in the order the runtime reads `|` variants. */
const FORMS: Record<string, number> = { "en-US": 2, "de-DE": 2, "fr-FR": 2, "da-DK": 2, "cs-CZ": 3, "ar-EG": 6, "zh-CN": 1, "zh-TW": 1 };
const placeholders = (text: string): string[] => [...new Set(text.match(/\{\w+\}/g) ?? [])].sort();

/** The chrome's own prefixes: the words every screen shares. */
const CHROME_PREFIXES = ["nav", "screen", "frame", "portal", "save", "status", "sheetName", "notFound", "notAvailable", "common", "startup", "lines"];

/** Every string, with where it lives. */
const ALL = Object.entries(AREAS).flatMap(([area, bundle]) =>
  Object.entries(bundle as Record<string, Record<string, string>>).flatMap(([tag, strings]) => Object.entries(strings).map(([key, text]) => ({ area, tag, key, text }))),
);

/** Copy this product never ships, in any language's English source. */
const NEVER = [
  /never expires/i,
  /does not expire/i,
  /doesn['’]t expire/i,
  /belongs to someone else/i,
  /not in this preview/i,
  /\b11:04\b/,
  /\(v\d+\)/,
  /partner since/i,
];

/** A private reference: the plan's ids and section marks never reach a screen. */
const PRIVATE = [/§/, /\bplan 5\d\b/i, /\b(?:DP|OF|N|F|K|D|U|W|E)-?\d{1,3}\b/, /O-fix/i, /\bOCP\b/, /57-T\d+/];

describe("every area's keys", () => {
  it("are namespaced by the area, and no key is in two areas", () => {
    const wrong: string[] = [];
    const seen = new Map<string, string>();
    for (const [area, bundle] of Object.entries(AREAS)) {
      for (const key of Object.keys((bundle as Record<string, Record<string, string>>)["en-US"]!)) {
        const prefix = key.split(".")[0]!;
        if (area === "chrome" ? !CHROME_PREFIXES.includes(prefix) : prefix !== area) wrong.push(`${area}: ${key}`);
        if (seen.has(key)) wrong.push(`${key} in ${seen.get(key)!} and ${area}`);
        seen.set(key, area);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("name the same placeholders as English, in every language", () => {
    const wrong: string[] = [];
    for (const { area, tag, key, text } of ALL) {
      const english = (AREAS as Record<string, Record<string, Record<string, string>>>)[area]!["en-US"]![key];
      if (english === undefined) {
        wrong.push(`${tag} ${key}: no English`);
        continue;
      }
      if (JSON.stringify(placeholders(text)) !== JSON.stringify(placeholders(english))) wrong.push(`${tag} ${key}: ${placeholders(text).join()} ≠ ${placeholders(english).join()}`);
    }
    expect(wrong).toEqual([]);
  });

  it("give a plural one variant per plural form, or a single form", () => {
    const wrong = ALL.filter(({ tag, text }) => {
      const variants = text.split("|").length;
      return variants !== 1 && variants !== FORMS[tag];
    }).map(({ tag, key }) => `${tag} ${key}`);
    expect(wrong).toEqual([]);
  });
});

describe("what the strings say", () => {
  const allowedToken = (text: string, index: number): boolean => {
    const before = text.slice(0, index).match(/[\p{L}\p{N}]*$/u)?.[0] ?? "";
    const after = text.slice(index).match(/^[\p{L}\p{N}]*/u)?.[0] ?? "";
    const token = `${before}${after}`.toLowerCase();
    return HOMOGRAPH_TOKENS.some((h) => h.token.toLowerCase() === token);
  };

  it("contain none of the release sweep's banned runs, in any language", () => {
    const hits: string[] = [];
    for (const { tag, key, text } of ALL) {
      const lower = text.toLowerCase();
      for (const word of SUBSTRING_BANNED) {
        for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) if (!allowedToken(text, at)) hits.push(`${tag} ${key}: "${word}"`);
      }
      for (const m of text.matchAll(/(?<![\p{L}\p{N}])pro(?![\p{L}\p{N}])/giu)) {
        if (!PRO_PHRASES.some((p) => text.slice(m.index).toLowerCase().startsWith(p.phrase.toLowerCase()))) hits.push(`${tag} ${key}: "pro"`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("say none of the banned ideas in the other seven languages", () => {
    const hits: string[] = [];
    for (const { tag, key, text } of ALL) {
      if (!(OTHER_LANGUAGES as readonly string[]).includes(tag)) continue;
      for (const [idea, patterns] of Object.entries(IDEA_IN_LANGUAGE[tag as OtherLanguage])) {
        for (const pattern of patterns) if (pattern.test(text)) hits.push(`${tag} ${key}: ${idea}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("never promise a link that does not expire, name another client's document, or fix a time or a version", () => {
    const hits = ALL.filter(({ text }) => NEVER.some((p) => p.test(text))).map(({ tag, key, text }) => `${tag} ${key}: ${text}`);
    expect(hits).toEqual([]);
  });

  it("carry no private reference", () => {
    const hits = ALL.filter(({ text }) => PRIVATE.some((p) => p.test(text))).map(({ tag, key, text }) => `${tag} ${key}: ${text}`);
    expect(hits).toEqual([]);
  });
});

describe("the checks see what they guard", () => {
  it("would catch a planted word, a planted promise and a planted reference", () => {
    expect(SUBSTRING_BANNED.some((w) => "Upgrade your plan".toLowerCase().includes(w))).toBe(true);
    expect(NEVER.some((p) => p.test("The link never expires."))).toBe(true);
    expect(PRIVATE.some((p) => p.test("See DP-110"))).toBe(true);
    expect(ALL.length).toBeGreaterThan(8 * 120);
  });
});
