/**
 * A studio with more rows than one `in` list may name: the stand-in world
 * refuses a list of more than 200 values exactly as Adminium does, and every
 * screen's read still answers whole — the lines of the 250th entry, the
 * invoices of the 210th finished project.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { PortError } from "../data/ports.ts";
import { loadArchive } from "../screens/archive/load.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import { deskReads, rowsOf, useDesk } from "./desk.ts";
import * as office from "./officeActions.ts";
import type { Outcome } from "./outcome.ts";
import * as time from "./timeActions.ts";

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

const ok = <T,>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason} ${outcome.code}`);
  return outcome.value;
};
const many = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

describe("the stand-in world reads as Adminium reads", () => {
  it("refuses an `in` list of more than 200 values, and a column the table does not have", async () => {
    const refused = await studio.world.reads.where("invoice_lines", { column: "time_entry_id", op: "in", value: many(201) }).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(PortError);
    expect([(refused as PortError).status, (refused as PortError).code]).toEqual([422, "VALIDATION_FAILED"]);
    expect(await studio.world.reads.where("invoice_lines", { column: "time_entry_id", op: "in", value: many(200) })).toEqual([]);
    const unknown = await studio.world.reads.where("running_costs", { column: "colour", op: "eq", value: "x" }).catch((e: unknown) => e);
    expect([(unknown as PortError).status, (unknown as PortError).code]).toEqual([422, "UNKNOWN_IDENTIFIER"]);
  });

  it("refuses a write naming a column the table does not have", async () => {
    const refused = await studio.world.writes.insert("running_costs", { label: "Insurance", monthly_amount: "40.00", position: 3, supplier_id: 1 }).catch((e: unknown) => e);
    expect(refused).toMatchObject({ status: 422, code: "UNKNOWN_IDENTIFIER", field: "supplier_id" });
    const patch = await studio.world.writes.update("events", 1, { colour: "red" }).catch((e: unknown) => e);
    expect(patch).toMatchObject({ status: 422, code: "UNKNOWN_IDENTIFIER", field: "colour" });
    expect(tableOf(studio, "running_costs")).toHaveLength(2);
  });
});

describe("the desk's reads past 200", () => {
  it("Time reads every entry and the line invoicing the newest of 250", async () => {
    for (let i = 0; i < 247; i += 1) await studio.world.writes.insert("time_entries", { project_id: 1, person_id: 1, date: "2026-07-01", logged_hours: "1", note: `Proofs ${i}` });
    const newest = Math.max(...tableOf(studio, "time_entries").map((e) => Number(e["id"])));
    ok(await time.moveTimeOntoInvoice([newest], { rate: "125.00", newTitle: () => "Time" }));
    useDesk.setState((s) => ({ rows: { ...s.rows, invoice_lines: {} } }));
    const entries = await time.loadTime("2000-01-01");
    expect(entries).toHaveLength(250);
    expect(time.invoicedBy(entries).has(newest)).toBe(true);
  });

  it("Expenses knows which of 205 purchases a line passes on", async () => {
    for (let i = 0; i < 202; i += 1) await studio.world.writes.insert("expenses", { date: "2026-07-01", what: `Paper ${i}`, amount: "2.00", project_id: 1, rebill: true });
    const last = Math.max(...tableOf(studio, "expenses").map((e) => Number(e["id"])));
    ok(await office.passOn([last], { newTitle: () => "Purchases" }));
    useDesk.setState((s) => ({ rows: { ...s.rows, invoice_lines: {} } }));
    const purchases = await office.loadPurchases(null);
    expect(purchases).toHaveLength(205);
    expect(office.purchaseState(purchases.find((p) => p.id === last)!)).toBe("passed-on");
  });

  it("the Archive reads the sent invoices of every one of 210 finished projects", async () => {
    for (let i = 0; i < 209; i += 1) {
      const project = await studio.world.writes.insert("projects", { client_id: 4, name: `Old job ${i}` });
      await studio.world.writes.update("projects", project.id, { status: "done" });
    }
    const last = Math.max(...tableOf(studio, "projects").map((p) => Number(p["id"])));
    const invoice = await studio.world.writes.insert("invoices", { client_id: 4, project_id: last, title: "Old job" });
    await studio.world.writes.insert("invoice_lines", { document_id: invoice.id, position: 0, description: "Work", qty: "1", rate: "100.00", discount_kind: "amount" });
    await studio.world.writes.update("invoices", invoice.id, { status: "sent" });
    await loadArchive();
    expect(rowsOf(useDesk.getState(), "invoices").some((i) => i.id === invoice.id && i.status === "sent")).toBe(true);
  });

  it("every read the desk makes goes through the cut, whatever door was set", async () => {
    await expect(deskReads().where("invoice_lines", { column: "time_entry_id", op: "in", value: many(450) })).resolves.toEqual(expect.any(Array));
  });
});
