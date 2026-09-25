/**
 * Re-write `src/data/types.ts` from `manifest.json`:
 *
 *   npx vite-node scripts/write-row-types.ts
 *
 * Run it after `npm run manifest` whenever a table or a column changes; the
 * drift test (`src/data/types.test.ts`) fails until you do.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { rowTypesText, type ManifestLike } from "../src/data/rowTypes.ts";

const root = join(import.meta.dirname, "..");
const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as ManifestLike;
writeFileSync(join(root, "src", "data", "types.ts"), rowTypesText(manifest));
console.info("[row-types] wrote src/data/types.ts");
