/**
 * `ADD_ONS_REPO=… npx vite-node src/demo/writePrinted.ts [--pin]` — write
 * the demo's printed copies under `src/demo/printed/`, drawn by the pinned
 * add-ons checkout. `--pin` first records the checkout as it is now.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DEMO_LOCALES } from "../demo-types.ts";
import { addOnsRepo, checkoutPin, drawAll, PIN_FILE, PRINTED_DIR, readPin, serverPath } from "./prerender.ts";

const repo = addOnsRepo();
if (!existsSync(serverPath(repo))) throw new Error(`no built add-on at ${serverPath(repo)} — build packages/invoices in the add-ons checkout first`);
const found = checkoutPin(repo);
if (process.argv.includes("--pin")) {
  mkdirSync(PRINTED_DIR, { recursive: true });
  writeFileSync(PIN_FILE, `${JSON.stringify(found, null, 2)}\n`);
}
const pin = readPin();
if (pin.commit !== found.commit || pin.serverSha256 !== found.serverSha256) {
  throw new Error(`the add-ons checkout is not the pinned one (pinned ${pin.commit.slice(0, 7)}, found ${found.commit.slice(0, 7)}) — check out the pin, or re-pin with --pin`);
}
const drawn = await drawAll(repo);
for (const locale of DEMO_LOCALES) {
  rmSync(join(PRINTED_DIR, locale), { recursive: true, force: true });
  mkdirSync(join(PRINTED_DIR, locale), { recursive: true });
}
for (const [name, html] of drawn) writeFileSync(join(PRINTED_DIR, name), html);
console.info(`${String(drawn.size)} printed copies written under src/demo/printed/`);
