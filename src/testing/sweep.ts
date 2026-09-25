/**
 * The release sweep, over what a build emits: every file (JavaScript, CSS,
 * HTML, JSON, source maps if there are any) read for the three things no
 * shipped byte may carry —
 *
 *   - a banned word (`lexicon.ts`), in any language, AS WORDS A PERSON CAN
 *     SEE: the string literals of the app's own code, the text of its pages,
 *     the labels of its JSON. Not identifiers: a minified bundle is full of
 *     names like `explanation` or `freeze` that nobody reads, and a vendor's
 *     own code (React, the icons, pdf.js) is not this app's copy. So a
 *     string made of one bare token (`freeze`, `plan_id`, `nav.home`) is
 *     only a hit when the token IS a banned word ("Free", "Pro"); a string
 *     with a space or a letter beyond ASCII is prose, and is held to the
 *     substring rule the strings test holds every message to;
 *   - a private citation (a planning document's ids and section marks), in
 *     any string of any file;
 *   - a path from the machine that built it, anywhere at all.
 *
 * Tests only; nothing that ships imports it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { parseAst } from "rollup/parseAst";

import { HOMOGRAPH_TOKENS, PRO_PHRASES, SUBSTRING_BANNED, TIERING_PATTERNS } from "./lexicon.ts";

/** Chunks that are other people's code, named by the build's `manualChunks` and pdf.js's own files. */
export const VENDOR = /^(?:react|icons)-[\w-]+\.js$|^pdf(?:\.worker)?[\w.-]*\.m?js$/;

/** A private reference: a planning document's ids and section marks. */
export const PRIVATE: readonly RegExp[] = [/§/, /\bplan 5\d\b/i, /\b57-T\d*/, /\bDP-\d/, /\bF-\d/, /\bN-\d/, /\bO-fix\b/i, /\bOCP\b/];

/** A path from the machine that built it. */
export const LOCAL_PATH: readonly RegExp[] = [/\/Users\//, /\/private\/tmp/, /scratchpad/i];

export interface Emitted {
  /** The file, relative to the build's directory. */
  file: string;
  text: string;
}

/** Every file a build emitted, but its fonts and images. */
export function emitted(dir: string): Emitted[] {
  const out: Emitted[] = [];
  const walk = (d: string): void => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(?:m?js|css|html|json|map|svg|txt|webmanifest)$/.test(name)) out.push({ file: relative(dir, p), text: readFileSync(p, "utf8") });
    }
  };
  walk(dir);
  return out;
}

/** Every string a script holds: its string literals and the text of its template literals. */
export function stringsOf(js: string): string[] {
  const out: string[] = [];
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    const n = node as { type?: string; value?: unknown; cooked?: unknown };
    if (n.type === "Literal" && typeof n.value === "string") out.push(n.value);
    if (n.type === "TemplateElement") {
      const cooked = (n.value as { cooked?: string } | undefined)?.cooked;
      if (typeof cooked === "string") out.push(cooked);
    }
    for (const [key, child] of Object.entries(n)) if (key !== "type" && child !== null && typeof child === "object") visit(child);
  };
  visit(parseAst(js));
  return out;
}

/** Every string value of a JSON document (its keys are names, not words). */
export function jsonStrings(json: string): string[] {
  const out: string[] = [];
  const visit = (v: unknown): void => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v !== null && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(JSON.parse(json));
  return out;
}

/** The words of a page or a stylesheet a person can see: an HTML file's text and attributes, a stylesheet's `content:` strings. */
export function pageStrings(file: string, text: string): string[] {
  if (file.endsWith(".css")) return [...text.matchAll(/content:\s*(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]!);
  return [...text.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>/g, " ").matchAll(/>([^<]+)<|\s(?:title|alt|aria-label|content|placeholder)="([^"]*)"/g)].map((m) => (m[1] ?? m[2] ?? "").trim()).filter((s) => s !== "");
}

/** One bare token — a name, a key, a class, a path — rather than words. */
const token = (s: string): boolean => /^[\x21-\x7e]+$/.test(s);

const allowedAt = (text: string, index: number): boolean => {
  const before = text.slice(0, index).match(/[\p{L}\p{N}]*$/u)?.[0] ?? "";
  const after = text.slice(index).match(/^[\p{L}\p{N}]*/u)?.[0] ?? "";
  const word = `${before}${after}`.toLowerCase();
  return HOMOGRAPH_TOKENS.some((h) => h.token.toLowerCase() === word);
};

/**
 * The banned words a string a person can see says, if any.
 *
 * Each language's own spellings are run as a UNION: a built file carries all
 * eight languages interleaved and a byte cannot be traced back to the one it
 * came from — so French "tarif" (a rate) answers for German "Tarif" (a plan),
 * which is the stricter direction. The tokens `lexicon.ts` names as a word in
 * another language pass, exactly as in the strings test.
 */
export function bannedIn(s: string): string[] {
  const hits: string[] = [];
  const ideas = (): void => {
    for (const pattern of TIERING_PATTERNS) {
      const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
      for (const m of s.matchAll(global)) if (!allowedAt(s, m.index)) hits.push(`${m[0]} (${String(pattern)})`);
    }
  };
  if (token(s)) {
    // A document's number, or the prefix it is numbered under (PRO-1142, "PRO-"), is data.
    if (/^[A-Z]{2,}-[A-Z]*\d*$/.test(s)) return hits;
    // A bare token is a name, a key or a class — unless it is the word itself.
    const word = s.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").toLowerCase();
    if ((SUBSTRING_BANNED as readonly string[]).includes(word) || word === "pro") hits.push(word);
    if (/^\p{Lu}\p{Ll}+$/u.test(s.replace(/[^\p{L}]/gu, ""))) ideas(); // a capitalised word is a label ("Tarif")
    return hits;
  }
  const lower = s.toLowerCase();
  for (const word of SUBSTRING_BANNED) {
    for (let at = lower.indexOf(word); at !== -1; at = lower.indexOf(word, at + 1)) if (!allowedAt(s, at)) hits.push(word);
  }
  for (const m of s.matchAll(/(?<![\p{L}\p{N}])pro(?![\p{L}\p{N}])/giu)) {
    if (!PRO_PHRASES.some((p) => s.slice(m.index).toLowerCase().startsWith(p.phrase.toLowerCase()))) hits.push("pro");
  }
  ideas();
  return hits;
}

export interface Finding {
  file: string;
  rule: "banned word" | "private citation" | "local path";
  what: string;
  /** The string it was found in, cut short. */
  in: string;
}

const cut = (s: string) => (s.length > 120 ? `${s.slice(0, 117)}…` : s);

/** Sweep one build's emitted files. */
export function sweep(files: readonly Emitted[]): Finding[] {
  const out: Finding[] = [];
  for (const { file, text } of files) {
    // A source map's `sources` are paths relative to where the build was written — a test's temporary
    // directory climbs through the machine's own. What else it carries (the sources' text) is read.
    const bytes = file.endsWith(".map") ? JSON.stringify({ ...(JSON.parse(text) as object), sources: [] }) : text;
    for (const re of LOCAL_PATH) {
      const m = re.exec(bytes);
      if (m !== null) out.push({ file, rule: "local path", what: m[0], in: cut(bytes.slice(Math.max(0, m.index - 40), m.index + 60)) });
    }
    const name = file.split("/").pop()!;
    const strings = /\.m?js$/.test(file) ? stringsOf(text) : file.endsWith(".json") || file.endsWith(".map") ? jsonStrings(text) : pageStrings(file, text);
    for (const s of strings) {
      for (const re of PRIVATE) {
        const m = re.exec(s);
        if (m !== null) out.push({ file, rule: "private citation", what: m[0], in: cut(s) });
      }
      if (VENDOR.test(name) || file.endsWith(".map")) continue;
      for (const what of bannedIn(s)) out.push({ file, rule: "banned word", what, in: cut(s) });
    }
  }
  return out;
}
