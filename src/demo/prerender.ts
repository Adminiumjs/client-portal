/**
 * The demo's printed copies, drawn by the add-on itself (`writePrinted.ts` runs it).
 *
 * The demo has no server to run the Invoices & Receipts add-on, so its
 * printed copies are drawn here, at build time, by the add-on itself — from
 * a PINNED checkout (`printed/pin.json`: the repository's commit, the
 * add-on's version and the SHA-256 of the renderer it ships) — for the
 * documents of the clients the card signs in as, in each of the eight
 * languages, as the sample reads in that language. `printed.test.ts` draws
 * them again from the same checkout and fails when one drifts.
 *
 *   ADD_ONS_REPO=/path/to/add-ons npx vite-node src/demo/writePrinted.ts
 *   … --pin   (after moving the checkout on: record its commit and hash)
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { DEMO_LOCALES } from "../demo-types.ts";
import { createEngine } from "./engine.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS, demoSample, resolveDemoSample } from "./sample.ts";
import { printedInput, printedName, printedRows } from "./printedSubjects.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
export const PRINTED_DIR = here("./printed");
export const PIN_FILE = join(PRINTED_DIR, "pin.json");

export interface Pin {
  package: string;
  version: string;
  commit: string;
  /** The SHA-256 of `packages/invoices/dist/server.js`. */
  serverSha256: string;
}

export const addOnsRepo = () => process.env["ADD_ONS_REPO"] ?? join(here("../../.."), "add-ons");
export const serverPath = (repo: string) => join(repo, "packages", "invoices", "dist", "server.js");

/** What the checkout holds now: its commit, the add-on's version, the renderer's hash. */
export function checkoutPin(repo: string): Pin {
  const pkg = JSON.parse(readFileSync(join(repo, "packages", "invoices", "package.json"), "utf8")) as { name: string; version: string };
  const commit = execFileSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const serverSha256 = createHash("sha256").update(readFileSync(serverPath(repo))).digest("hex");
  return { package: pkg.name, version: pkg.version, commit, serverSha256 };
}

export const readPin = (): Pin => JSON.parse(readFileSync(PIN_FILE, "utf8")) as Pin;

type RenderSync = (input: unknown) => readonly { format: string; bytes: Uint8Array; locale: string }[] | { code: string; detail?: string };

/** Every printed copy, drawn by the add-on at `repo`: `<locale>/<name>.html` → the HTML. */
export async function drawAll(repo: string): Promise<Map<string, string>> {
  const { renderSync } = (await import(/* @vite-ignore */ serverPath(repo))) as { renderSync: RenderSync };
  const out = new Map<string, string>();
  for (const locale of DEMO_LOCALES) {
    const engine = createEngine({ now: () => DEMO_START, zone: DEMO_ZONE, currency: DEMO_CURRENCY, settings: () => DEMO_SETTINGS, announce: () => {} });
    engine.load(resolveDemoSample(demoSample(locale), DEMO_START, DEMO_ZONE));
    for (const { kind, row } of printedRows(engine.rows)) {
      const input = printedInput(kind, row, engine.rows, { locale, zone: DEMO_ZONE, now: DEMO_START, currency: DEMO_CURRENCY, settings: DEMO_SETTINGS });
      const drawn = renderSync(input);
      if (!Array.isArray(drawn)) throw new Error(`${kind} ${String(row["number"])} (${locale}) was refused: ${JSON.stringify(drawn)}`);
      const html = (drawn as readonly { format: string; bytes: Uint8Array }[]).find((doc) => doc.format === "html");
      if (html === undefined) throw new Error(`${kind} ${String(row["number"])} (${locale}) came back with no HTML`);
      out.set(`${locale}/${printedName(kind, String(row["number"]))}.html`, new TextDecoder().decode(html.bytes));
    }
  }
  return out;
}
