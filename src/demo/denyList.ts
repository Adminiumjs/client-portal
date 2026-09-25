/**
 * What only the demo build may carry, and what no build may — the markers
 * the build test greps the built bundles for (`testing/surfaceBuild.test.ts`).
 *
 * DEMO ONLY: the sample studio's names, addresses and numbers, the demo's
 * own phrases (the card's labels, its toasts), and its printed copies. A
 * hosted surface that carried any of them would show a real studio somebody
 * else's clients. Derived from the very files that hold them, so a renamed
 * client or a reworded toast moves the gate with it instead of disarming it.
 *
 * NEVER, in any build: wording the design drew that the product must not
 * say — a promise the link does not keep, a guess about whose file it is, a
 * feature said to be missing from "this preview", a client's history made
 * up, a clock stuck at one minute, a version written into a sentence.
 */
import { DEMO_BUNDLE } from "./sample.ts";
import { DEMO_MESSAGES } from "./strings.ts";

/** Wording no build may carry. */
export const COPY_DENY_LIST = ["does not expire", "belongs to someone else", "not in this preview", "partner since", "11:04", "(v3)"] as const;

const rowsOf = (ref: string) => DEMO_BUNDLE.tables.find((t) => t.ref === ref)?.rows ?? [];
const text = (value: unknown): string | null => (typeof value === "string" && value.length >= 6 ? value : null);

/** The sample studio's names, addresses and numbers, and the demo's own English phrases. */
export function demoOnlyMarkers(): string[] {
  const out = new Set<string>();
  for (const client of rowsOf("clients")) {
    for (const column of ["company", "contact_name", "email"]) {
      const value = text(client[column]);
      if (value !== null) out.add(value);
    }
  }
  for (const ref of ["invoices", "proposals", "payments"]) {
    for (const row of rowsOf(ref)) {
      const value = text(row["number"]);
      if (value !== null) out.add(value);
    }
  }
  const english = DEMO_MESSAGES["en-US"];
  for (const key of ["demo.clock.reset", "demo.do.sampleProposal", "demo.do.acceptsAndSigns", "demo.do.expireLink", "demo.fill.changesNote", "demo.fill.proposalTitle"]) {
    const value = english[key];
    if (value !== undefined) out.add(value);
  }
  return [...out];
}
