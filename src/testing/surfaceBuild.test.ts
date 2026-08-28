/**
 * THE BUILD-TIME SPLIT IS REAL, AND STAYS REAL.
 *
 * Three rules keep the demo out of a customer's bundle. All three were learned
 * by measuring, all three are one careless edit from silently reversing, and
 * none of them shows up as a type error, a lint warning or a failing unit test.
 * Before this file the only thing defending them was a comment.
 *
 * ── The rules, and how each one fails ───────────────────────────────────────
 *
 * 1. NO CALL AROUND A FLAG. Vite substitutes `import.meta.env.X` with a literal,
 *    but Rollup will not fold a CALL — so `Boolean(a && b)` leaves the branch
 *    live and the demo dock ships. `!!(a && b)` folds. The difference is
 *    invisible in review and invisible at runtime; it shows up only in the bytes.
 *
 * 2. DOT ACCESS, NEVER BRACKETS — and this is the one that actually decides it.
 *    With DOT access Vite substitutes `import.meta.env.VITE_X` with a literal,
 *    and with `undefined` when the variable is unset; either folds. With BRACKET
 *    access it substitutes the whole `import.meta.env` OBJECT instead, leaving
 *    `const x = {}; x.VITE_X` — a runtime lookup no minifier folds, and the
 *    branch survives.
 *
 * 3. Every flag is also `define`d in `vite.config.ts`. MEASURED, and stated
 *    honestly: this is defence in depth, NOT what makes the elimination work.
 *    Removing the whole `define` block changes nothing while rule 2 holds — the
 *    dock still disappears from both surfaces and still ships in the demo. It
 *    earns its place by making a future slip into bracket access harmless
 *    rather than silent, and that is the only claim made for it.
 *
 *    An earlier version of this header claimed `define` was load-bearing. It
 *    was measured on code that used bracket access at the time, which made rule
 *    2's failure look like rule 3's.
 *
 * ── Why this builds instead of reading source ───────────────────────────────
 *
 * Rules 1 and 2 are properties of the OUTPUT. Source that looks correct can
 * still produce a bundle with the dock in it, which is precisely what happened:
 * the guard read `{DEMO && <DemoDock />}` — correct by inspection — while
 * `DEMO` was compiled as a runtime lookup and the dock shipped anyway. Only the
 * built bytes can answer this, so this file builds all three modes and greps
 * them.
 *
 * ── Why it must never skip ──────────────────────────────────────────────────
 *
 * A missing `dist/`, a missing component, a missing marker: every one of those
 * FAILS here rather than skipping. A gate that skips when its subject is absent
 * reports green while checking nothing, which is how this fleet's manifest test
 * stayed blind for months. If something below cannot be located, that is a
 * finding, not a reason to stand down.
 *
 * ── Markers are derived, not written down ───────────────────────────────────
 *
 * The strings this file greps for are pulled out of the very files it guards.
 * Hardcoding `"ol-dock"` would mean a renamed class silently disarms the gate —
 * the test would keep passing while the dock shipped. Deriving them means a
 * rename either keeps working or fails loudly, and never quietly.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..", "..");
const DOCK = join(REPO, "src", "components", "DemoDock.tsx");
const DEMO_DATA = join(REPO, "src", "data", "demo.ts");

/** Every `.js` byte of a build, concatenated. */
function bundleOf(dir: string): string {
  const assets = join(dir, "assets");
  if (!existsSync(assets)) {
    throw new Error(`no assets/ in ${dir} — the build did not produce a bundle`);
  }
  const js = readdirSync(assets).filter((f) => f.endsWith(".js"));
  if (js.length === 0) throw new Error(`no .js in ${assets}`);
  return js.map((f) => readFileSync(join(assets, f), "utf8")).join("\n");
}

function build(outDir: string, env: Record<string, string>): string {
  execFileSync(
    "npx",
    ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error"],
    {
      cwd: REPO,
      // Every flag is passed EXPLICITLY, including the empty ones. Inheriting a
      // stray VITE_ADMINIUM_* from the developer's shell would make this gate
      // measure their machine instead of the code.
      env: {
        ...process.env,
        VITE_ADMINIUM_SURFACE_SIDE: "",
        VITE_ADMINIUM_API_BASE_URL: "",
        VITE_ADMINIUM_PUBLISHABLE_KEY: "",
        ...env,
      },
      stdio: "pipe",
    },
  );
  return bundleOf(outDir);
}

/**
 * Class names lifted out of the dock component itself.
 *
 * Class names survive minification (they are string literals in JSX), which is
 * what makes them usable as markers at all — identifiers do not.
 */
function dockMarkers(): string[] {
  const src = readFileSync(DOCK, "utf8");
  const found = new Set<string>();
  for (const m of src.matchAll(/className="([a-z]{2,4}-dock[a-z_-]*)/g)) {
    const cls = m[1];
    if (cls !== undefined) found.add(cls.split(" ")[0] ?? cls);
  }
  if (found.size === 0) {
    throw new Error(
      `no dock class names found in ${DOCK} — this gate cannot see the dock, ` +
        `so it cannot prove the dock is absent. Fix the pattern, do not delete the test.`,
    );
  }
  return [...found];
}

/**
 * Distinctive literals from the seeded fiction.
 *
 * SINGLE-LINE literals only. The first version omitted `\n` from the character
 * class, so the match ran from one quote across half the file and produced a
 * "marker" no bundle could ever contain — a check that failed for a reason that
 * had nothing to do with the code it guards.
 *
 * Several are returned rather than one because any single literal might be
 * dropped by tree-shaking; the dataset is present if ANY of them survived.
 */
function demoDataMarkers(): string[] {
  const src = readFileSync(DEMO_DATA, "utf8");
  const found = [...src.matchAll(/"([^"\\\n]{12,60})"/g)]
    .map((m) => m[1] ?? "")
    .filter((v) => !v.includes("/") && !v.includes("{"))
    .slice(0, 12);
  if (found.length === 0) {
    throw new Error(`no usable string literal in ${DEMO_DATA} — cannot mark the demo dataset`);
  }
  return found;
}

let demo = "";
let staff = "";
let customer = "";
let outs: string[] = [];

beforeAll(() => {
  // The component and the dataset must EXIST. If either is gone this gate is
  // meaningless, and it says so rather than passing vacuously.
  for (const f of [DOCK, DEMO_DATA]) {
    if (!existsSync(f)) throw new Error(`${f} is missing — this gate has nothing to guard`);
  }
  outs = ["demo", "staff", "customer"].map(() => mkdtempSync(join(tmpdir(), "surface-gate-")));
  demo = build(outs[0]!, {});
  staff = build(outs[1]!, { VITE_ADMINIUM_SURFACE_SIDE: "staff" });
  customer = build(outs[2]!, { VITE_ADMINIUM_SURFACE_SIDE: "customer" });
}, 180_000);

afterAll(() => {
  for (const d of outs) rmSync(d, { recursive: true, force: true });
});

/**
 * Which markers a bundle carries — a SMALL value, so a failure prints the
 * finding instead of the bundle.
 *
 * `expect(bundle).toContain(x)` is unusable here: vitest prints the received
 * value, and the received value is a quarter of a megabyte of minified
 * JavaScript. The first run of this file emitted exactly that, three times. A
 * gate whose output cannot be read is a gate that gets deleted.
 */
function present(bundle: string, markers: string[]): string[] {
  return markers.filter((m) => bundle.includes(m));
}

describe("rule 1 + 3 — a flag folds, so the dock is ABSENT and not merely hidden", () => {
  it("the demo build contains the dock", () => {
    // The control. Without it, a gate that greps for absence passes just as
    // happily when the marker is wrong as when the code is right.
    expect(present(demo, dockMarkers())).not.toEqual([]);
  });

  it("no surface build contains the dock", () => {
    expect({
      staff: present(staff, dockMarkers()),
      customer: present(customer, dockMarkers()),
    }).toEqual({ staff: [], customer: [] });
  });
});

describe("rule 2 — no flag survives as a runtime lookup in any build", () => {
  it("no build reads a flag off an object at run time", () => {
    // The OUTPUT-level twin of the source rule below, and the more important of
    // the two: it catches an unfolded flag however it got there, including from
    // a dependency this repo does not lint.
    //
    // A flag Vite replaced leaves a literal behind; one it did not leaves a
    // PROPERTY READ — `x.VITE_ADMINIUM_…`. The signature has to be the dot or
    // the bracket, never the bare name: a legitimate error message telling an
    // operator which variable to set contains the name too, and the first
    // version of this check failed on exactly that — a helpful string, reported
    // as a compilation defect.
    const LOOKUP = /[.[]\s*"?VITE_ADMINIUM/;
    const kept = ([
      ["demo", demo],
      ["staff", staff],
      ["customer", customer],
    ] as const)
      .filter(([, bundle]) => LOOKUP.test(bundle))
      .map(([label]) => label);
    expect(kept, "these builds kept an unreplaced flag lookup").toEqual([]);
  });
});

describe("no source reaches a flag in a way that cannot fold", () => {
  const sources = (): string[] => {
    const out: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(p);
      }
    };
    walk(join(REPO, "src"));
    return out;
  };

  it("surface.ts never wraps a flag read in a call", () => {
    /*
     * Scoped to `surface.ts` ON PURPOSE, and the scope is the rule.
     *
     * A call around an env read is only a defect when its result GATES a
     * branch — that is the thing Rollup cannot fold. Passing a flag into a
     * function that consumes it (`createPublicClient({ baseUrl: … })`) is
     * ordinary code and folds nothing either way, because nothing branches on
     * it. Checking every file flagged that as a violation on the first run.
     *
     * Every gating constant in this fleet lives in `surface.ts` — that is what
     * the file is for — so guarding it there is both precise and complete. A
     * new gating constant elsewhere would escape this, which is one more
     * reason to keep them all in the one module.
     */
    const src = readFileSync(join(REPO, "src", "surface.ts"), "utf8");
    const offenders = [...src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\([^()]*import\.meta\.env\./g)]
      .map((m) => `${m[1]}(… import.meta.env …)`)
      // `!!` is an operator, not a call, and is the prescribed form.
      .filter((hit) => !hit.startsWith("if("));
    expect(
      offenders,
      "Rollup will not fold a call, so the branch stays live and the demo ships. Use !!(a && b).",
    ).toEqual([]);
  });

  it("never reaches a flag with bracket access", () => {
    const offenders: string[] = [];
    for (const file of sources()) {
      if (file.endsWith("surfaceBuild.test.ts")) continue;
      const src = readFileSync(file, "utf8");
      if (/import\.meta\.env\s*\[/.test(src)) offenders.push(file.replace(REPO + "/", ""));
    }
    expect(
      offenders,
      "`define` matches on expression text, so bracket access is never substituted.",
    ).toEqual([]);
  });
});

describe("what a hosted build must not carry", () => {
  it("no publishable key literal in a hosted staff build", () => {
    // A hosted surface reads through the operator's session. A key in that
    // bundle means it silently fell back to the standalone transport.
    expect(staff.includes("adm_pub_"), "staff build contains an adm_pub_ literal").toBe(false);
  });

  it("the seeded dataset is still in the demo build", () => {
    // The control for the whole file: if the demo build lost its data, the
    // "absent from surfaces" assertions above prove nothing.
    expect(present(demo, demoDataMarkers())).not.toEqual([]);
  });
});
