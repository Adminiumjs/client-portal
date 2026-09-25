/**
 * An untranslated screen passes every parity check: each key is present in
 * every language — it just says the English. So the words are also compared:
 * per screen (a key's first segment), no language may leave most of its text
 * identical to the English. A few identical words are fine and expected —
 * cognates ("Studio", "Total"), codes and placeholders.
 */
import { describe, expect, it } from "vitest";

import { MESSAGES } from "./messages/index.ts";

/** Text that reads the same in every language: numbers, symbols, a lone placeholder, a code. */
const neutral = (text: string): boolean => /^[\s\d{}\p{P}\p{S}]*$/u.test(text.replace(/\{[^}]+\}/g, "")) || text.length <= 3;

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
