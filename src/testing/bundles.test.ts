/**
 * What this app's own builds may carry — the checks beyond the fleet's shared
 * surface gate (`surfaceBuild.test.ts`, synced byte for byte from the canonical
 * copy, so nothing app-specific may live there):
 *
 *   - the demo's sample, its card's words and its printed copies are in the
 *     demo build alone (`src/demo/denyList.ts` names them, from the files that
 *     hold them), and the wording on the deny-list is in no build at all;
 *   - a client's page carries the clients' strings and the chrome, and no desk
 *     area's (`CUSTOMER_AREAS`): read from the area files themselves, and the
 *     clients' modules from the customer build's own source maps.
 *
 * Like the shared gate, this BUILDS rather than reading source: only the
 * built bytes say what a visitor downloads.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COPY_DENY_LIST, demoOnlyMarkers } from "../demo/denyList.ts";
import { AREAS, CUSTOMER_AREAS } from "../i18n/messages/index.ts";

const REPO = resolve(__dirname, "..", "..");

function build(outDir: string, side: string, extra: string[] = []): string {
  execFileSync("npx", ["vite", "build", "--outDir", outDir, "--emptyOutDir", "--logLevel", "error", ...extra], {
    cwd: REPO,
    // Every flag explicit: a stray VITE_ADMINIUM_* in the shell must not decide what is measured.
    env: { ...process.env, VITE_ADMINIUM_SURFACE_SIDE: side, VITE_ADMINIUM_API_BASE_URL: "", VITE_ADMINIUM_PUBLISHABLE_KEY: "" },
    stdio: "pipe",
  });
  const assets = join(outDir, "assets");
  if (!existsSync(assets)) throw new Error(`no assets/ in ${outDir} — the build did not produce a bundle`);
  const js = readdirSync(assets).filter((f) => f.endsWith(".js"));
  if (js.length === 0) throw new Error(`no .js in ${assets}`);
  return js.map((f) => readFileSync(join(assets, f), "utf8")).join("\n");
}

/** Every source module a build's source maps name, relative to the repo. */
function sourcesOf(dir: string): string[] {
  const assets = join(dir, "assets");
  const out = new Set<string>();
  for (const map of readdirSync(assets).filter((f) => f.endsWith(".js.map"))) {
    const { sources } = JSON.parse(readFileSync(join(assets, map), "utf8")) as { sources: string[] };
    for (const source of sources) out.add(resolve(assets, source).replace(REPO + "/", ""));
  }
  if (out.size === 0) throw new Error(`no source maps in ${assets} — the customer build was not mapped`);
  return [...out];
}

/** Which markers a bundle carries — a small value, so a failure prints the finding, not the bundle. */
const present = (bundle: string, markers: readonly string[]) => markers.filter((m) => bundle.includes(m));

let demo = "";
let staff = "";
let customer = "";
let outs: string[] = [];

beforeAll(() => {
  outs = ["demo", "staff", "customer"].map(() => mkdtempSync(join(tmpdir(), "bundles-gate-")));
  demo = build(outs[0]!, "");
  staff = build(outs[1]!, "staff");
  customer = build(outs[2]!, "customer", ["--sourcemap"]);
}, 180_000);

afterAll(() => {
  for (const d of outs) rmSync(d, { recursive: true, force: true });
});

describe("the demo's sample and words stay in the demo build", () => {
  it("the demo build carries them", () => {
    // The control: a marker list that matched nothing would pass the next test by silence.
    expect(present(demo, demoOnlyMarkers())).not.toEqual([]);
  });

  it("no surface build carries any of them", () => {
    expect({ staff: present(staff, demoOnlyMarkers()), customer: present(customer, demoOnlyMarkers()) }).toEqual({ staff: [], customer: [] });
  });

  it("no build carries the wording on the deny-list", () => {
    expect({
      demo: present(demo, [...COPY_DENY_LIST]),
      staff: present(staff, [...COPY_DENY_LIST]),
      customer: present(customer, [...COPY_DENY_LIST]),
    }).toEqual({ demo: [], staff: [], customer: [] });
  });
});

describe("a customer bundle carries only the clients' strings", () => {
  const keysOf = (areas: Record<string, object>) => Object.values(areas).flatMap((area) => Object.keys((area as Record<string, Record<string, string>>)["en-US"]!));
  const quoted = (keys: string[]) => keys.map((key) => `"${key}"`);
  const customerKeys = keysOf(CUSTOMER_AREAS);
  const deskKeys = keysOf(Object.fromEntries(Object.entries(AREAS).filter(([name]) => !(name in CUSTOMER_AREAS))));

  it("the customer build carries every key of its areas, and the staff build every desk key", () => {
    // The controls: keys the bundles spelled differently would make the next test pass by silence.
    expect(customerKeys.length).toBeGreaterThan(100);
    expect(quoted(customerKeys).filter((key) => !customer.includes(key))).toEqual([]);
    expect(present(staff, quoted(deskKeys)).length).toBe(deskKeys.length);
  });

  it("the customer build carries no key of any desk area", () => {
    expect(present(customer, quoted(deskKeys))).toEqual([]);
  });

  it("no module in the customer build names a key outside the clients' areas", () => {
    const own = new Set(customerKeys);
    const named: string[] = [];
    for (const file of sourcesOf(outs[2]!)) {
      if (!file.startsWith("src/") || file.startsWith("src/i18n/")) continue;
      const src = readFileSync(join(REPO, file), "utf8");
      for (const key of deskKeys) if (src.includes(`"${key}"`) || src.includes(`\`${key}\``)) named.push(`${file}: ${key}`);
      // A key built at run time (`client.terms.${…}`): its prefix must be one of the clients' own.
      for (const m of src.matchAll(/`([a-zA-Z]+(?:\.[a-zA-Z0-9]+)*\.)\$\{/g)) {
        const prefix = m[1]!;
        if (deskKeys.some((key) => key.startsWith(prefix)) || ![...own].some((key) => key.startsWith(prefix))) named.push(`${file}: ${prefix}…`);
      }
    }
    expect(named).toEqual([]);
  });
});
