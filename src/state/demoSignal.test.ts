/**
 * The website demo's shortcuts that fill a form reach their screen by a named
 * signal. Every signal the bridge sends has a screen listening for it, and
 * what each screen lays into its form is the fill, as given.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { filledProposal, newProposalForm, toProposalDraft } from "../screens/composer/draft.ts";
import { callDraft } from "../screens/enquiries/model.ts";

const SRC = resolve(import.meta.dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const namesIn = (text: string, call: string) => [...text.matchAll(new RegExp(`${call}\\(\\s*"([a-z.]+)"`, "g"))].map((m) => m[1]!);

describe("the demo's signals", () => {
  it("each one the bridge sends has a screen listening", () => {
    const sent = new Set(namesIn(readFileSync(join(SRC, "demoBridge.ts"), "utf8"), "sendDemoSignal"));
    const heard = new Set(sources(join(SRC, "screens")).flatMap((file) => namesIn(readFileSync(file, "utf8"), "useDemoSignal")));
    expect([...sent].sort()).toEqual(["composer.fill", "enquiries.call", "signin.fill"]);
    for (const name of sent) expect(heard, name).toContain(name);
  });

  it("fills a proposal: the client, the title, a scope line a paragraph, the lines as typed", () => {
    const form = filledProposal(newProposalForm("2026-07-28", { termsVersionId: 3 }), {
      client_id: "4",
      title: "Season two artwork",
      scope: "Every episode\n\nOne key image",
      lines: JSON.stringify([
        { description: "Episode art", qty: "8", rate: "180.00" },
        { description: "Key art", qty: "1", rate: "950.00" },
      ]),
    });
    expect(form).toMatchObject({ clientId: 4, newClient: null, title: "Season two artwork", scope: ["Every episode", "One key image"] });
    expect(form.lines.map(({ description, qty, rate, discount }) => ({ description, qty, rate, discount }))).toEqual([
      { description: "Episode art", qty: "8", rate: "180.00", discount: "" },
      { description: "Key art", qty: "1", rate: "950.00", discount: "" },
    ]);
    expect(new Set(form.lines.map((l) => l.key)).size).toBe(2);
    // It saves as any typed proposal would.
    expect(toProposalDraft(form)?.lines).toHaveLength(2);
  });

  it("keeps what a fill leaves out, and the lines when the list cannot be read", () => {
    const before = { ...newProposalForm("2026-07-28", { clientId: 2, termsVersionId: 3 }), title: "Kept" };
    const after = filledProposal(before, { lines: "not a list" });
    expect(after).toMatchObject({ clientId: 2, title: "Kept", scope: before.scope });
    expect(after.lines).toBe(before.lines);
  });

  it("fills the call form with the fields it has — no phone: an enquiry keeps none", () => {
    expect(callDraft({ name: "Rosa", business: "Orchard Row Cider", phone: "+1 503", email: "rosa@example.com", body: "Labels" })).toEqual({
      name: "Rosa",
      business: "Orchard Row Cider",
      email: "rosa@example.com",
      body: "Labels",
    });
  });
});
