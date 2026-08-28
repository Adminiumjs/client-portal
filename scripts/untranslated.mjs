#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred-translation ledger (28-public-surface.md §7C, 28-T24).
 *
 * Reads every shipped string module under `src/i18n` and writes
 * `src/i18n/untranslated.json` — the sorted key list of everything authored as
 * `en("…")`, plus its count.
 *
 * ── WHY A COMMITTED FILE AND NOT JUST A GREP ───────────────────────────────
 * `en(…)` makes a key optional in the other seven locales, which is the whole
 * point: the debt becomes *absent* rather than English-identical, so nothing
 * downstream mistakes it for finished work. But an optional key is also
 * invisible — no compiler, no test, and no reviewer sees it appear. A committed
 * ledger turns each deferral into a line in a diff: adding one to a pull
 * request shows up as `"count": 3 → 4` next to the key that caused it, and
 * `--check` fails the build of anyone who defers a string without recording it.
 *
 * ── ATTRIBUTION IS ENFORCED, NOT BEST-EFFORT ───────────────────────────────
 * Every marker must be the value of a key. A marker anywhere else — passed
 * through a helper, nested in an array — would be counted by the fleet counter
 * and be missing from this ledger, so the two would disagree and the ledger
 * would quietly under-report. Rather than guess at a name, this refuses, names
 * the file, and asks for the string to be authored in key position.
 *
 * SYNCED FILE — edit it in `workplan/tools/i18n-guard/` and run
 * `i18n-guard.sh sync`. A per-repo edit drifts and only `status` will notice.
 *
 *   node scripts/untranslated.mjs                 write the ledger
 *   node scripts/untranslated.mjs --check         exit 1 if it is out of date
 *   node scripts/untranslated.mjs --print         print it, write nothing
 *   node scripts/untranslated.mjs --print --root <dir>    scan somewhere else
 */

import { readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const DEFAULT_ROOT = "src/i18n";
export const DEFAULT_OUT = "src/i18n/untranslated.json";

/**
 * A marker call, anywhere.
 *
 * Two things this is deliberately not. NOT `\ben\(`: `\b` fires between the
 * accented `š` and the `e` of the Czech string "ohlášen(a)", so the fleet
 * counter reported phantom debt in a repo that had none — which is why the
 * opening quote of the argument is required, since that is how `en("…")` is
 * actually authored and `ohlášen(a)` has no quote there.
 *
 * And NOT a list of allowed preceding characters, which is what the shell
 * counter used first. `[]:,({` plus whitespace covers the positions a marker is
 * normally authored in and misses `[en("…")]` — so the attribution check below
 * could never fire on the case it exists for, because the detector could not
 * see it either. A negative lookbehind covers every position instead, and
 * `\p{L}\p{N}` keeps the Czech string safe for the right reason rather than by
 * accident: the character before is a LETTER, not merely one that was left out
 * of a list. `.` is excluded so an unrelated `catalogue.en("…")` is not ours.
 */
const CALL_SITE = /(?<![\p{L}\p{N}_$.])en\("/gu;

/**
 * The same call, attributed to the key it is the value of.
 *
 * Matched against the MASKED text — where a key's characters have been blanked
 * along with every other string body — so the character classes are permissive
 * and the name itself is read back out of the original at the same offset. That
 * is what `maskNonCode` preserving offsets exactly is for.
 */
const KEYED_CALL =
  /(?:^|[{,])\s*(?:"([^"\n]*)"|'([^'\n]*)'|([A-Za-z_$][\w$]*))\s*:\s*en\("/gm;

/** Read a match's key name out of the unmasked source at the same offset. */
function keyAt(original, match) {
  const raw = original.slice(match.index, match.index + match[0].length);
  const name = /(?:"([^"\n]+)"|'([^'\n]+)'|([A-Za-z_$][\w$]*))\s*:\s*en\("$/.exec(raw);
  return name === null ? null : (name[1] ?? name[2] ?? name[3]);
}

/**
 * Shipped string modules only.
 *
 * `untranslated.ts` documents the marker in its JSDoc and this file's own test
 * authors fixtures with it. Neither is a shipped string, and counting them
 * would make every repo report debt it does not have.
 */
function sourceFiles(dir) {
  const found = [];
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      found.push(...sourceFiles(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry)) continue;
    if (entry === "untranslated.ts") continue;
    if (/\.test\.tsx?$/.test(entry)) continue;
    found.push(path);
  }
  return found;
}

/**
 * Blank out comment bodies and string CONTENTS, keeping every offset and every
 * delimiter, so the regexes below only ever see code.
 *
 * ── WHY THIS IS NOT OPTIONAL ───────────────────────────────────────────────
 * Both false-positive families are real and both were observed. Prose: the
 * moment these files documented the marker, every locale header contained the
 * literal `en("` and nine files reported debt that did not exist. Data: the
 * Czech string "ohlášen(a)" is what taught the fleet counter not to anchor on
 * `\b`. Masking kills both structurally instead of by heuristic — a comment is
 * not code, and neither is the inside of a string.
 *
 * A character-wise pass rather than regexes, for the reason a sibling gate
 * already had to learn the hard way: a regex comment-stripper knows nothing
 * about strings, so two ordinary literals containing comment tokens can delete
 * the region between them — there, silently removing a real finding.
 */
export function maskNonCode(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") out.push(" "), (i += 1);
      continue;
    }
    if (ch === "/" && next === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        out.push(text[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      out.push(" ", " ");
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      // The delimiters stay: `en("` is recognised BY its opening quote, and
      // masking that away would make every marker invisible.
      out.push(ch);
      i += 1;
      while (i < text.length && text[i] !== ch) {
        if (text[i] === "\\") {
          out.push(" ", " ");
          i += 2;
          continue;
        }
        out.push(text[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      if (i < text.length) out.push(ch), (i += 1);
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

/** Raw scan: the keys found, and any marker that could not be attributed. */
export function scan(root = DEFAULT_ROOT) {
  const keys = [];
  const unattributed = [];
  for (const file of sourceFiles(root)) {
    const original = readFileSync(file, "utf8");
    const text = maskNonCode(original);
    const calls = [...text.matchAll(CALL_SITE)].length;
    const keyed = [...text.matchAll(KEYED_CALL)]
      .map((m) => keyAt(original, m))
      .filter((name) => name !== null);
    keys.push(...keyed);
    if (keyed.length !== calls) {
      unattributed.push(
        `${file}: ${String(calls)} marker(s), ${String(keyed.length)} attributable to a key`,
      );
    }
  }
  return { keys: [...new Set(keys)].sort(), unattributed };
}

/** The ledger, or a thrown explanation of why one cannot be written. */
export function ledger(root = DEFAULT_ROOT) {
  const { keys, unattributed } = scan(root);
  if (unattributed.length > 0) {
    throw new Error(
      "every deferred string must be the value of a key, so it can be named in " +
        `${DEFAULT_OUT}:\n  ${unattributed.join("\n  ")}`,
    );
  }
  return { count: keys.length, keys };
}

export const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;

function main(argv) {
  const rootAt = argv.indexOf("--root");
  const root = rootAt === -1 ? DEFAULT_ROOT : argv[rootAt + 1];
  const outAt = argv.indexOf("--out");
  const out = outAt === -1 ? DEFAULT_OUT : argv[outAt + 1];
  const text = serialize(ledger(root));

  if (argv.includes("--print")) {
    process.stdout.write(text);
    return 0;
  }

  let current = null;
  try {
    current = readFileSync(out, "utf8");
  } catch {
    current = null;
  }

  if (argv.includes("--check")) {
    if (current === text) return 0;
    process.stderr.write(
      `${out} is out of date. Run \`node scripts/untranslated.mjs\` and commit the result.\n\n` +
        `expected:\n${text}\ngot:\n${current ?? "(missing)"}\n`,
    );
    return 1;
  }

  if (current !== text) {
    writeFileSync(out, text);
    process.stdout.write(`wrote ${out}\n`);
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
