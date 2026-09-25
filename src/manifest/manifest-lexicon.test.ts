/**
 * The manifest says nothing the release sweep would refuse, in any language.
 *
 * Every label, title and email the manifest ships is read by the same word
 * list the release sweep runs over built output (`testing/lexicon.ts`):
 * the English substrings (`free`, `plan`, `tier`, `billing` …, as SUBSTRINGS —
 * "freed" and "explanation" fail too) and each other language's spelling of
 * the same ideas (German "kostenlos", Chinese "免费", Arabic "مجان" …). A
 * cancellation window is "a cancellation window", never "free until", and a
 * queued message is "waiting", never "geplant".
 */
import { describe, expect, it } from "vitest";

import { IDEA_IN_LANGUAGE, OTHER_LANGUAGES, SUBSTRING_BANNED, type OtherLanguage } from "../testing/lexicon.ts";
import { buildManifest } from "./build.ts";

type Json = unknown;

/** Every string in the manifest, with the language it is in when it is one of a set of labels. */
function strings(value: Json, tag: string | null, out: { tag: string | null; text: string }[]): void {
  if (typeof value === "string") out.push({ tag, text: value });
  else if (Array.isArray(value)) value.forEach((v) => strings(v, tag, out));
  else if (value !== null && typeof value === "object") {
    for (const [key, v] of Object.entries(value as Record<string, Json>)) {
      const isTag = /^[a-z]{2}-[A-Z]{2}$/.test(key);
      strings(v, isTag ? key : tag, out);
    }
  }
}

const manifest = buildManifest();
const all: { tag: string | null; text: string }[] = [];
// Only what a person reads: labels, titles, names, emails — not refs, icons or rules.
for (const part of ["requiredSchema", "pages", "navGroups", "emailTemplates", "description"] as const) strings(manifest[part], null, all);
const readable = all.filter(({ text }) => /\s/.test(text) || /[A-Z]/.test(text.charAt(0)) || /[^\x00-\x7F]/.test(text));

describe("the manifest's words pass the release sweep's word list", () => {
  it("reads enough words to mean something", () => {
    expect(readable.length).toBeGreaterThan(1500);
  });

  it("contains none of the banned English substrings, in any language", () => {
    const hits = readable.flatMap(({ tag, text }) =>
      SUBSTRING_BANNED.filter((word) => text.toLowerCase().includes(word)).map((word) => `${tag ?? "?"}: "${word}" in ${JSON.stringify(text)}`),
    );
    expect(hits).toEqual([]);
  });

  it("says none of the banned ideas in the other seven languages", () => {
    const hits: string[] = [];
    for (const { tag, text } of readable) {
      if (tag === null || !(OTHER_LANGUAGES as readonly string[]).includes(tag)) continue;
      for (const [idea, patterns] of Object.entries(IDEA_IN_LANGUAGE[tag as OtherLanguage])) {
        for (const pattern of patterns) if (pattern.test(text)) hits.push(`${tag}: ${idea} (${String(pattern)}) in ${JSON.stringify(text)}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
