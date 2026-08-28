// SPDX-License-Identifier: AGPL-3.0-only
/**
 * The deferred-translation ledger, checked (28-public-surface.md §7C, 28-T24).
 *
 * ── WHAT THIS GATES ────────────────────────────────────────────────────────
 * `en("…")` makes a key optional in the other seven locales. That is the point
 * — deferred text ends up ABSENT rather than English-identical, so nothing
 * downstream mistakes it for finished work — but an optional key is also
 * invisible: no compiler complains, no other test notices, and a reviewer sees
 * one word change in a string file. `src/i18n/untranslated.json` is what makes
 * it visible, and this is what stops it going stale.
 *
 * ── WHY IT SHELLS OUT INSTEAD OF IMPORTING ─────────────────────────────────
 * `scripts/untranslated.mjs` is the command a human runs and the one CI would
 * run. Importing its internals would leave the CLI — argument handling, exit
 * codes, the file it decides to write — untested, which is the half that
 * actually breaks. Running it is also what keeps this file free of a `.mjs`
 * import that `tsc -b` would have to be taught about.
 *
 * ── THE TWO SELF-CHECKS, AND WHY THEY ARE NOT PADDING ──────────────────────
 * A scanner that returned `[]` for every input would pass the drift check
 * forever, in every repo, while the fleet quietly accumulated untracked debt —
 * and it would look exactly like a repo that had none. So the scanner is also
 * pointed at a fixture it MUST find something in, and at one it MUST refuse.
 * That second case is the real hazard: a marker that is not the value of a key
 * cannot be named in the ledger, so without the refusal it would be counted by
 * `i18n-guard.sh count` and absent here, and the two would disagree with
 * nothing to say so.
 *
 * SYNCED FILE — edit it in `workplan/tools/i18n-guard/` and run
 * `i18n-guard.sh sync`. A per-repo edit drifts and only `status` will notice.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

const SCRIPT = "scripts/untranslated.mjs";
const LEDGER = "src/i18n/untranslated.json";

interface Ledger {
  count: number;
  keys: string[];
}

const temps: string[] = [];

function fixture(source: string): string {
  const dir = mkdtempSync(join(tmpdir(), "untranslated-"));
  temps.push(dir);
  writeFileSync(join(dir, "strings.ts"), source);
  return dir;
}

/** Run the CLI; returns stdout, or throws with the tool's own message. */
function run(...args: string[]): string {
  return execFileSync("node", [SCRIPT, ...args], { encoding: "utf8", stdio: "pipe" });
}

afterAll(() => {
  for (const dir of temps) rmSync(dir, { recursive: true, force: true });
});

describe("the deferred-translation ledger", () => {
  it("is committed and current", () => {
    // The whole gate: defer a string without recording it and this fails, with
    // the exact command to fix it in the tool's own error text.
    expect(() => run("--check")).not.toThrow();
  });

  it("counts what it lists", () => {
    const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
    expect(ledger.keys).toEqual([...new Set(ledger.keys)].sort());
    expect(ledger.count).toBe(ledger.keys.length);
  });

  it("actually finds a deferred string", () => {
    // Without this, a scanner that always returned nothing would pass the drift
    // check in all fifteen repos and read as "no debt anywhere".
    const dir = fixture(
      [
        'export const screens = {',
        '  "en-US": {',
        '    "book.title": "Book a visit",',
        '    "book.slot": en("Choose a time"),',
        "  },",
        "};",
      ].join("\n"),
    );
    const ledger = JSON.parse(run("--print", "--root", dir)) as Ledger;
    expect(ledger).toEqual({ count: 1, keys: ["book.slot"] });
  });

  it("does not mistake a word ending in en( for a marker", () => {
    // THE BUG THIS PINS, found by the fleet counter before this file existed:
    // anchoring on `\ben\(` matches inside the Czech "ohlášen(a)", because the
    // word boundary fires between the accented `š` and the `e`. A repo with no
    // deferred text reported debt it did not have.
    const dir = fixture('export const cs = { "form.notified": "ohlášen(a)" };');
    expect(JSON.parse(run("--print", "--root", dir))).toEqual({ count: 0, keys: [] });
  });

  it("reads code only — not comments, not the inside of strings", () => {
    // THE SECOND BUG THIS PINS, and the one that made the scanner a lexer. The
    // moment these locale files documented the marker, every header contained
    // the literal `en("` — nine files in one repo reported debt that did not
    // exist, and the tool's own documentation was the thing that caused it.
    const dir = fixture(
      [
        "/**",
        ' * A key you cannot translate yet is authored `en("…")` here.',
        " */",
        '// also en("in a line comment")',
        "export const notes = {",
        '  "a.real": en("Deferred"),',
        "  \"b.talks\": 'about en(\"x\") inside a string',",
        "};",
      ].join("\n"),
    );
    expect(JSON.parse(run("--print", "--root", dir))).toEqual({ count: 1, keys: ["a.real"] });
  });

  it("refuses a marker that is not the value of a key", () => {
    const dir = fixture('export const loose = [en("Place order")];');
    expect(() => run("--print", "--root", dir)).toThrow(/must be the value of a key/);
  });
});
