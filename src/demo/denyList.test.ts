/**
 * The deny-list's markers are real — each is in the demo's own files, so the
 * build test that greps the bundles for them can see the demo when it is
 * there — and no source a real build compiles carries any of them.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { COPY_DENY_LIST, demoOnlyMarkers } from "./denyList.ts";

const SRC = fileURLToPath(new URL("..", import.meta.url));

/** The files only the demo build compiles, or only tests read. */
const DEMO_ONLY = [/^demo\//, /^demo-card\.ts$/, /^demoBridge\.ts$/, /^data\/demo\.ts$/, /^testing\//, /\.test\.tsx?$/];

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx|css|json)$/.test(name) ? [path] : [];
  });
}

describe("the demo's deny-list", () => {
  const markers = demoOnlyMarkers();

  it("names the sample's clients, addresses and numbers, and the demo's own phrases", () => {
    expect(markers).toEqual(expect.arrayContaining(["Hearth & Loaf", "amara@hearthandloaf.example", "INV-S2039", "QUO-S1142", "REC-S0018", "Back to 28 July"]));
    expect(markers.length).toBeGreaterThan(30);
  });

  it("finds none of them, and none of the wording no build may say, in a source a real build compiles", () => {
    const hits: string[] = [];
    for (const file of sources(SRC)) {
      const name = relative(SRC, file).split("\\").join("/");
      if (DEMO_ONLY.some((pattern) => pattern.test(name))) continue;
      // Comments never reach a bundle: what is checked is the code.
      const text = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'])\/\/[^\n]*/g, "$1");
      for (const marker of [...markers, ...COPY_DENY_LIST]) if (text.includes(marker)) hits.push(`${name}: ${marker}`);
    }
    expect(hits).toEqual([]);
  });
});
