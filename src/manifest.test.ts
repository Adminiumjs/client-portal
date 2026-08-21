/**
 * `manifest.json`, put through the validator the PRODUCT runs.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * [Added 2026-08-21, fleet rollout.] Thirteen of the fifteen marketplace repos
 * had NOTHING that read `manifest.json`. That is how they came to carry three
 * incompatible dialects — 18 to 415 issues each against the product's own
 * validator — with every suite green: nothing ever looked. Two of the thirteen
 * are still invalid as this lands, and this file is what says so out loud
 * instead of leaving it to an audit somebody has to remember to run.
 *
 * ── WHY IT RUNS A COPY, AND WHY IT ALSO RUNS THE ORIGINAL ─────────────────
 *
 * `@adminium/manifest` is on no registry and cannot be installed from a path
 * either: its own package.json declares `zod: "catalog:"` and
 * `@adminium/add-on-contracts: "workspace:*"`, two pnpm protocols npm does not
 * resolve. So it is VENDORED under `testing/manifest/`, which is what lets the
 * schema block below run on every machine, clean clone included.
 *
 * A copy nobody compares drifts — one host's copy sat a whole schema behind the
 * product, refusing a manifest that was in fact valid — so when a product
 * checkout is reachable the last block asks the sharper question: do the copy
 * and the original AGREE, about a hundred and fifty documents derived from this
 * one? `scripts/sync-manifest-validator.mjs` is how the copy is refreshed.
 *
 * SYNCED FILE — edit it in `workplan/tools/manifest-gate/` and re-run the
 * rollout. A per-repo edit drifts and nothing will notice.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import manifest from "../manifest.json";
import {
  MANIFEST_CAPABILITIES,
  MANIFEST_CATEGORIES,
  MANIFEST_VERSION,
  RESERVED_KEYS,
  validateManifest,
} from "./testing/manifest/index.ts";

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE SCHEMA, ON EVERY MACHINE                                               */
/* ─────────────────────────────────────────────────────────────────────────── */

describe("manifest.json passes the vendored validator, always", () => {
  const result = validateManifest(manifest);

  it("validates against the frozen v1 schema with no issues at all", () => {
    // The issue LIST, not a bare boolean: a failure that prints
    // `expected true, got false` costs a debugging session that printing the
    // issues does not.
    expect(result.ok ? [] : result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("is an app at the frozen spec version, keyed outside the reserved set", () => {
    expect(manifest.kind).toBe("app");
    expect(manifest.manifestVersion).toBe(MANIFEST_VERSION);
    expect(RESERVED_KEYS as readonly string[]).not.toContain(manifest.key);
  });

  it("is first-party, which is the only publisher v1 accepts", () => {
    expect(manifest.publisher.id).toBe("adminium");
  });

  it("takes its facets and capabilities from the closed vocabularies", () => {
    for (const facet of manifest.categories) {
      expect(MANIFEST_CATEGORIES as readonly string[]).toContain(facet);
    }
    for (const cap of manifest.capabilities ?? []) {
      expect(MANIFEST_CAPABILITIES as readonly string[]).toContain(cap);
    }
  });

  it("refuses real mistakes, so it is wired up and not a stub", () => {
    // A validator nobody has watched REFUSE something might not be wired up at
    // all: an import that resolved to `{ validateManifest: () => ({ ok: true }) }`
    // would look exactly like the case above passing.
    for (const patch of [
      { publisher: { ...manifest.publisher, id: "somebody-else" } },
      { addOn: { attaches: [], provides: [] } },
      { manifestVersion: 2 },
      { categories: ["not-a-facet"] },
      { capabilities: ["telepathy"] },
      { frontends: [] },
    ]) {
      expect(validateManifest({ ...manifest, ...patch }).ok, JSON.stringify(patch)).toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE THREE SIDES, MADE CHECKABLE                                            */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * The dashboard is mandatory and comes from Adminium, so it is never declared
 * here. What a manifest declares is the OPTIONAL halves, and the rule that
 * makes the taxonomy meaningful is that at least one exists: an app with
 * neither is not a micro-SaaS, it is a schema.
 */
describe("it declares which sides it ships", () => {
  const frontends = manifest.frontends as { side: string; kind: string; entry?: string }[];

  it("ships at least one side, which is what makes it an app and not a schema", () => {
    expect(frontends.length).toBeGreaterThanOrEqual(1);
  });

  it("declares each side at most once", () => {
    const sides = frontends.map((f) => f.side);
    expect(sides.length, `repeated side: ${sides.join(", ")}`).toBe(new Set(sides).size);
  });

  it("names no dashboard side — that half is Adminium's and is never optional", () => {
    expect(frontends.map((f) => f.side)).not.toContain("dashboard");
  });

  it("gives every declared side something to load", () => {
    // `entry` is OPTIONAL in the schema and present on every app in the fleet.
    // A side with nothing to load is a side the installer cannot serve, so this
    // is deliberately stricter than the spec.
    for (const frontend of frontends) {
      expect(typeof frontend.entry, `${frontend.side} has no entry`).toBe("string");
      expect((frontend.entry ?? "").length, `${frontend.side} entry is blank`).toBeGreaterThan(0);
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  MISTAKES THAT ARE CORRECTLY SHAPED AND STILL WRONG                         */
/* ─────────────────────────────────────────────────────────────────────────── */

interface Column {
  ref: string;
  type: string;
  references?: string;
}

/**
 * A schema constrains SHAPES. Each document below is correctly shaped and still
 * wrong, so both validators accept it — which is exactly the gap a gate written
 * around the schema leaves open.
 */
describe("mistakes the schema cannot see", () => {
  const tables = manifest.requiredSchema.tables as { ref: string; columns: Column[] }[];
  const byRef = new Map(tables.map((t) => [t.ref, t]));
  const pages = manifest.pages as { ref: string; bindings?: Record<string, string> }[];

  it("gives every table a distinct ref", () => {
    const refs = tables.map((t) => t.ref);
    expect(refs.length, `duplicate table refs: ${refs.join(", ")}`).toBe(new Set(refs).size);
  });

  it("gives every page a distinct ref", () => {
    // Two pages with one ref is an install that silently drops a screen.
    const refs = pages.map((p) => p.ref);
    expect(refs.length, `duplicate page refs: ${refs.join(", ")}`).toBe(new Set(refs).size);
  });

  it("names each facet once", () => {
    expect(manifest.categories.length).toBe(new Set(manifest.categories).size);
  });

  it("gives every table a distinct column ref", () => {
    for (const table of tables) {
      const refs = table.columns.map((c) => c.ref);
      expect(refs.length, `${table.ref} repeats a column: ${refs.join(", ")}`).toBe(
        new Set(refs).size,
      );
    }
  });

  it("points every foreign key at a table it also declares", () => {
    for (const table of tables) {
      for (const column of table.columns) {
        if (column.type !== "fk") continue;
        expect(byRef.has(column.references ?? ""), `${table.ref}.${column.ref}`).toBe(true);
      }
    }
  });

  it("binds every page to a table it declares", () => {
    for (const page of pages) {
      for (const target of Object.values(page.bindings ?? {})) {
        expect(byRef.has(target), `${page.ref} → ${target}`).toBe(true);
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  THE VENDORED VALIDATOR MUST NOT REACH THE SHIPPED BUNDLE                   */
/* ─────────────────────────────────────────────────────────────────────────── */

/**
 * `src/testing/` holds a copy of the validator, and it imports `zod` — a
 * devDependency, and a runtime dependency this app does not carry. One import
 * from a screen would put both into a customer's browser.
 *
 * Asserted HERE rather than in a `sources.test.ts`, because most repos in this
 * fleet do not have one. A gate that depends on a file that may not exist is
 * not a gate, and the barrel's own header would be claiming something untrue.
 */
describe("nothing shipped can reach the test-only directory", () => {
  const SRC = fileURLToPath(new URL(".", import.meta.url));
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const full = join(dir, entry);
      return statSync(full).isDirectory() ? walk(full) : [full];
    });

  const shipped = walk(SRC).filter(
    (f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test.") && !f.includes(`${"testing"}/`),
  );

  it("read something, so an empty result is never a pass", () => {
    expect(shipped.length).toBeGreaterThan(0);
  });

  it("imports neither testing/ nor zod from any shipped source", () => {
    const offenders = shipped.filter((file) => {
      const code = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/.*$/gm, "$1");
      return /from\s+['"][^'"]*\/testing\/|from\s+['"]zod['"]/.test(code);
    });
    expect(offenders.map((f) => f.slice(SRC.length))).toEqual([]);
  });
});

/* ─────────────────────────────────────────────────────────────────────────── */
/*  AND THE COPY IS HELD TO THE ORIGINAL                                       */
/* ─────────────────────────────────────────────────────────────────────────── */

const PRODUCT_ROOT =
  process.env.ADMINIUM_REPO || fileURLToPath(new URL("../../adminium", import.meta.url));
const REAL_VALIDATOR = join(PRODUCT_ROOT, "packages", "manifest", "dist", "index.js");
const available = existsSync(REAL_VALIDATOR);

/** CI sets this beside the product checkout; see .github/workflows/ci.yml. */
const VALIDATOR_REQUIRED = process.env.ADMINIUM_REQUIRE_VALIDATOR === "true";

interface RealValidator {
  validateManifest: (value: unknown) => { ok: boolean; issues?: readonly { path: string }[] };
}

if (!available) {
  console.info(
    `[manifest] the vendored validator was not compared with the real one: nothing at ` +
      `${REAL_VALIDATOR}. Clone the Adminium product beside this repo (or point ADMINIUM_REPO ` +
      "at it) and build packages/manifest, and the copy is checked for drift.",
  );
}

const loadReal = async (): Promise<RealValidator["validateManifest"]> => {
  const mod = (await import(/* @vite-ignore */ pathToFileURL(REAL_VALIDATOR).href)) as RealValidator;
  return mod.validateManifest;
};

/**
 * `describe.skipIf` is right for a developer with no product checkout. It was
 * WRONG for CI, where it meant the drift check never ran anywhere automated
 * while the job reported green. The workflow sets this flag in the same
 * condition that checks the product out, so the two cannot disagree.
 */
it.skipIf(!VALIDATOR_REQUIRED)("has the product validator that CI promised", () => {
  expect(
    available,
    `ADMINIUM_REQUIRE_VALIDATOR is set, so the real validator must be present, and nothing ` +
      `is at ${REAL_VALIDATOR}. The checkout or build step did not run.`,
  ).toBe(true);
});

/**
 * Documents DERIVED from this manifest rather than a hand-written list: a fixed
 * list can only detect a drift it happens to touch, and the drift that actually
 * happened was in a rule no such list exercised.
 */
function mutations(): { what: string; document: unknown }[] {
  const out: { what: string; document: unknown }[] = [];
  const base = manifest as unknown as Record<string, unknown>;
  const clone = (): Record<string, unknown> => structuredClone(base) as Record<string, unknown>;

  out.push({ what: "as it ships", document: manifest });

  for (const key of Object.keys(base)) {
    const dropped = clone();
    delete dropped[key];
    out.push({ what: `without ${key}`, document: dropped });
    for (const [label, value] of [
      ["a number", 42],
      ["null", null],
      ["an array", []],
      ["an object", {}],
    ] as const) {
      const retyped = clone();
      retyped[key] = value;
      out.push({ what: `${key} as ${label}`, document: retyped });
    }
  }

  const tables = (base["requiredSchema"] as { tables: { ref: string; columns: { type: string }[] }[] })
    .tables;
  for (let t = 0; t < Math.min(tables.length, 12); t += 1) {
    const dropped = clone();
    (dropped["requiredSchema"] as { tables: unknown[] }).tables.splice(t, 1);
    out.push({ what: `without table ${tables[t]?.ref ?? String(t)}`, document: dropped });

    const duped = clone();
    const list = (duped["requiredSchema"] as { tables: { ref: string }[] }).tables;
    list.push(structuredClone(list[t]!));
    out.push({ what: `table ${tables[t]?.ref ?? String(t)} twice`, document: duped });

    const columns = tables[t]?.columns ?? [];
    for (let c = 0; c < Math.min(columns.length, 6); c += 1) {
      const broken = clone();
      const target = (broken["requiredSchema"] as { tables: { columns: { type: string }[] }[] })
        .tables[t]?.columns[c];
      if (target === undefined) continue;
      // `varchar` is what somebody who thinks in SQL writes; the abstract types
      // are the contract.
      target.type = "varchar";
      out.push({ what: `${tables[t]?.ref ?? ""}.column[${String(c)}] varchar`, document: broken });
    }
  }

  for (const [what, patch] of [
    ["a stranger's publisher", { publisher: { ...manifest.publisher, id: "somebody-else" } }],
    ["an add-on block on an app", { addOn: { attaches: [], provides: [] } }],
    ["a facet outside the vocabulary", { categories: ["not-a-facet"] }],
    ["a capability nobody implements", { capabilities: ["telepathy"] }],
    ["no side at all", { frontends: [] }],
    ["a reserved key", { key: "admin" }],
  ] as const) {
    out.push({ what, document: { ...manifest, ...patch } });
  }

  return out;
}

describe.skipIf(!available)("the vendored validator has not drifted from @adminium/manifest", () => {
  it("agrees with the real one about every derived document", async () => {
    const real = await loadReal();
    const paths = (r: { ok: boolean; issues?: readonly { path: string }[] }): string =>
      [...(r.issues ?? [])]
        .map((i) => i.path)
        .sort()
        .join("|");

    const disagreements: string[] = [];
    const cases = mutations();
    for (const { what, document } of cases) {
      const theirs = real(document);
      const ours = validateManifest(document);
      if (ours.ok !== theirs.ok) {
        disagreements.push(`${what}: vendored ok=${String(ours.ok)}, real ok=${String(theirs.ok)}`);
      } else if (paths(ours) !== paths(theirs)) {
        disagreements.push(`${what}: same verdict, different paths`);
      }
    }
    expect(disagreements, `${String(cases.length)} documents compared`).toEqual([]);
  });

  it("asks about enough documents, and enough that are REFUSED", () => {
    // A drift check whose cases all PASS proves nothing: two validators that
    // accept everything agree perfectly.
    const cases = mutations();
    expect(cases.length).toBeGreaterThan(30);
    const refused = cases.filter(({ document }) => !validateManifest(document).ok);
    expect(refused.length, "too few refused documents to prove anything").toBeGreaterThan(15);
  });
});
