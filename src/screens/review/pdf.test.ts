/**
 * pdf.js never weighs on the first screen: nothing imports the PDF drawing
 * statically — it is loaded, with pdf.js, only when a review shows a PDF.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(__dirname, "../..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("the PDF drawing", () => {
  const all = sources(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

  it("is loaded on demand: no module imports it, or pdf.js, statically", () => {
    const staticImports = all.filter(({ text }) => /^\s*import[^(]*from\s+["'](?:[./]*review\/)?(?:\.\/)?pdf\.ts["']/m.test(text) || /^\s*import[^(]*from\s+["']pdfjs-dist["']/m.test(text));
    expect(staticImports.map((f) => f.path.replace(SRC, "src"))).toEqual([]);
  });

  it("is reached through a dynamic import, and pdf.js inside it the same way", () => {
    expect(all.some(({ text }) => text.includes('import("./pdf.ts")'))).toBe(true);
    const pdf = readFileSync(join(__dirname, "pdf.ts"), "utf8");
    expect(pdf).toContain('import("pdfjs-dist")');
  });
});
