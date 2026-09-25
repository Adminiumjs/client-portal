/**
 * `npx vite-node src/demo/writeRules.ts` — write `rules.ts` from manifest.json.
 *
 * Run it after the manifest changes; `rules.test.ts` fails until you do.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { rulesSource, type ManifestForRules } from "./rulesOf.ts";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const manifest = JSON.parse(readFileSync(here("../../manifest.json"), "utf8")) as ManifestForRules;
writeFileSync(here("./rules.ts"), rulesSource(manifest));
console.info("src/demo/rules.ts written");
