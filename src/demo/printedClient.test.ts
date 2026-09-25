/**
 * The demo's printed copies make each document out to the client the way
 * Adminium does: every client slot the app's manifest maps through
 * `client_id` is filled from the same column here, so a hosted copy and the
 * demo's own stay identical.
 */
import { describe, expect, it } from "vitest";

import { DEMO_START, DEMO_ZONE } from "../lib/clock.ts";
import { DOCUMENTS } from "../manifest/documents.ts";
import { printedInput, type PrintedKind } from "./printedSubjects.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS, demoSample } from "./sample.ts";
import { createWorld } from "./world.ts";

const TABLE: Record<PrintedKind, "invoices" | "payments" | "proposals"> = { invoice: "invoices", receipt: "payments", quote: "proposals" };

describe("the demo's copies name the client as the manifest does", () => {
  it("fills every client slot the manifest maps, from the same column", () => {
    const world = createWorld(demoSample("en-US"), () => DEMO_START, DEMO_ZONE, { name: "Nadia Cole" });
    const rows = { ...world.rows, clients: world.rows.clients.map((c) => ({ ...c, address: "4 Mill Lane\nHebden Bridge", tax_number: "GB 123 4567 89" })) };
    for (const kind of Object.keys(TABLE) as PrintedKind[]) {
      const entry = DOCUMENTS.find((d) => d.kind === kind && d.table === TABLE[kind])!;
      const row = rows[TABLE[kind]].find((r) => r["client_id"] !== null && r["number"] !== null)!;
      const client = rows.clients.find((c) => String(c.id) === String(row["client_id"]))!;
      const { fields } = printedInput(kind, row, rows, { locale: "en-US", zone: DEMO_ZONE, now: DEMO_START, currency: DEMO_CURRENCY, settings: DEMO_SETTINGS }).subject;
      for (const [slot, source] of Object.entries(entry.mapping)) {
        expect("via" in source && source.via, `${kind}.${slot}`).toBe("client_id");
        const value = (client as Record<string, unknown>)[(source as { column: string }).column];
        expect(fields[slot], `${kind}.${slot}`).toEqual(slot === "customerLines" ? String(value).split("\n") : value);
      }
    }
  });
});
