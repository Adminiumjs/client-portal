/**
 * The demo's rules are the manifest's: `rules.ts` is written from
 * manifest.json and must say exactly what the manifest says today.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { rulesSource, type ManifestForRules } from "./rulesOf.ts";
import { DEMO_RULES } from "./rules.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const manifest = JSON.parse(readFileSync(here("../../manifest.json"), "utf8")) as ManifestForRules;

describe("the demo's rules", () => {
  it("are written from the manifest as it is now (run `npx vite-node src/demo/writeRules.ts` after a change)", () => {
    expect(readFileSync(here("./rules.ts"), "utf8")).toBe(rulesSource(manifest));
  });

  it("carry what the stand-in world keeps: the moves, the stamps, the seal, the numbers, the cap, the outbox", () => {
    expect(Object.keys(DEMO_RULES.states).sort()).toEqual(["briefs", "deliverables", "invoices", "projects", "proposals", "terms_versions"]);
    expect(DEMO_RULES.stamps["proposals"]?.some((s) => typeof s.set === "object" && s.set !== null && "hashOf" in s.set)).toBe(true);
    expect(DEMO_RULES.numbered["invoices"]).toEqual([{ column: "number_seq", startSetting: "invoices.number_start_invoice" }]);
    expect(DEMO_RULES.capped).toEqual(["invoices"]);
    expect(DEMO_RULES.outbox?.producers.filter((p) => p.hold === true).map((p) => p.kind)).toEqual(["invoice-rung-1", "invoice-rung-2", "invoice-rung-3"]);
  });
});
