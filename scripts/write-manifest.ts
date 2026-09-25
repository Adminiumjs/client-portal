/**
 * `npm run manifest`: re-write `manifest.json` from `src/manifest/`.
 *
 * `--draft` writes it even while some labels are untranslated (English only),
 * for checking a change against the validator before its words are in; the
 * drift test never accepts a draft.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { buildManifest, manifestText } from "../src/manifest/build.ts";
import { untranslated } from "../src/manifest/labels.ts";

const draft = process.argv.includes("--draft");
const file = join(import.meta.dirname, "..", "manifest.json");
if (draft) {
  writeFileSync(file, `${JSON.stringify(buildManifest(), null, 2)}\n`);
  const missing = untranslated();
  console.info(`[manifest] wrote a DRAFT: ${String(missing.length)} labels untranslated`);
} else {
  writeFileSync(file, manifestText());
  console.info("[manifest] wrote manifest.json");
}
