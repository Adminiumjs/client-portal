/**
 * Putting hours and purchases on a client's draft, when the drafts moved on
 * between one move and the next: each move is its own action, so a later one
 * never lands on a draft an earlier one made that has since gone to another
 * client or out of the door.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Id } from "../data/types.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import { useDesk } from "./desk.ts";
import { takeOffDraft } from "./invoiceDrafts.ts";
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
const MOVE = { rate: "125.00", newTitle: () => "Time" };
const PASS = { newTitle: () => "Purchases" };
const invoiceOf = (column: "time_entry_id" | "expense_id", id: Id) => {
  const line = tableOf(studio, "invoice_lines").find((l) => l[column] === id);
  return line === undefined ? undefined : tableOf(studio, "invoices").find((i) => i["id"] === line["document_id"]);
};

describe("a later move of the same hours is a new action", () => {
  it("never lands on a draft that has since become another client's", async () => {
    const first = ok(await time.moveTimeOntoInvoice([3], MOVE));
    const draft = first.invoices[0]!;
    expect(draft.client_id).toBe(1);
    ok(await takeOffDraft(first.lines[0]!.id));
    // The emptied draft is given to another client in the composer.
    await studio.world.writes.update("invoices", draft.id, { client_id: 2 });

    const again = ok(await time.moveTimeOntoInvoice([3], MOVE));
    expect(again.lines).toHaveLength(1);
    expect(invoiceOf("time_entry_id", 3)).toMatchObject({ client_id: 1, status: "draft" });
    expect(invoiceOf("time_entry_id", 3)!["id"]).not.toBe(draft.id);
    expect(tableOf(studio, "invoices").find((i) => i["id"] === draft.id)).toMatchObject({ client_id: 2 });
  });

  it("passes a purchase on again after the draft it first went on was sent with something else", async () => {
    const first = ok(await office.passOn([1], PASS));
    const draft = first.invoices[0]!;
    ok(await takeOffDraft(first.lines[0]!.id));
    ok(await office.passOn([2], PASS));
    expect(invoiceOf("expense_id", 2)!["id"]).toBe(draft.id);
    await studio.world.writes.update("invoices", draft.id, { status: "sent" });
    useDesk.setState((s) => ({ rows: { ...s.rows, invoices: { ...s.rows.invoices, [draft.id]: { ...s.rows.invoices[draft.id]!, status: "sent" } } } }));

    const again = ok(await office.passOn([1], PASS));
    expect(again.lines.map((l) => l.expense_id)).toEqual([1]);
    expect(invoiceOf("expense_id", 1)).toMatchObject({ client_id: 2, status: "draft" });
    expect(invoiceOf("expense_id", 1)!["id"]).not.toBe(draft.id);
  });

  it("runs every move under a key of its own", async () => {
    ok(await time.moveTimeOntoInvoice([3], MOVE));
    const firstKey = studio.writes.find((w) => w.table === "invoices")!.values!["client_key"];
    const made = invoiceOf("time_entry_id", 3)!;
    const line = tableOf(studio, "invoice_lines").find((l) => l["time_entry_id"] === 3)!;
    ok(await takeOffDraft(line["id"] as Id));
    await studio.world.writes.update("invoices", made["id"] as Id, { client_id: 3 });
    studio.writes.length = 0;
    ok(await time.moveTimeOntoInvoice([3], MOVE));
    const secondKey = studio.writes.find((w) => w.table === "invoices")!.values!["client_key"];
    expect(secondKey).toHaveLength(36);
    expect(secondKey).not.toBe(firstKey);
  });
});

describe("a row read back by its key is checked before anything goes on it", () => {
  it("refuses to finish onto a draft that went to another client while the answer was lost", async () => {
    // The new draft saves, but its answer never arrives.
    studio.failWrite(1, "after");
    const first = await time.moveTimeOntoInvoice([3], MOVE);
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished move");
    const made = tableOf(studio, "invoices").at(-1)!;
    expect(made).toMatchObject({ client_id: 1, status: "draft" });
    await studio.world.writes.update("invoices", made["id"] as Id, { client_id: 2 });

    const resumed = await first.unfinished.resume();
    expect(!resumed.ok && [resumed.reason, resumed.code]).toEqual(["moved", "PRECONDITION_FAILED"]);
    expect(invoiceOf("time_entry_id", 3)).toBeUndefined();
    // A fresh press is a new action, and puts the hours on the right client's draft.
    ok(await time.moveTimeOntoInvoice([3], MOVE));
    expect(invoiceOf("time_entry_id", 3)).toMatchObject({ client_id: 1, status: "draft" });
  });

  it("finishes onto its own draft when nothing moved, with one line", async () => {
    studio.failWrite(1, "after");
    const first = await time.moveTimeOntoInvoice([3], MOVE);
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished move");
    const done = ok(await first.unfinished.resume());
    expect(done.lines).toHaveLength(1);
    expect(tableOf(studio, "invoices").filter((i) => i["client_id"] === 1 && i["status"] === "draft")).toHaveLength(1);
  });
  it("refuses a line read back that does not carry this entry on this draft", async () => {
    // A door that answers an insert with some other line (as a read-back by a key would).
    const insert = studio.world.writes.insert.bind(studio.world.writes);
    studio.world.writes.insert = async (ref, values) => {
      const row = await insert(ref, values);
      return ref === "invoice_lines" ? ({ ...row, time_entry_id: 1 } as typeof row) : row;
    };
    const moved = await time.moveTimeOntoInvoice([3], MOVE);
    expect(!moved.ok && [moved.reason, moved.code]).toEqual(["moved", "PRECONDITION_FAILED"]);
  });
});

describe("a draft sent a moment ago", () => {
  it("is read again before choosing, so one press puts the hours on a new draft", async () => {
    const first = ok(await time.moveTimeOntoInvoice([2], MOVE));
    const draft = first.invoices[0]!;
    // Sent from another computer: this desk still holds it as a draft.
    await studio.world.writes.update("invoices", draft.id, { status: "sent" });
    expect(useDesk.getState().rows.invoices[draft.id]!.status).toBe("draft");

    const moved = ok(await time.moveTimeOntoInvoice([1], MOVE));
    expect(moved.lines).toHaveLength(1);
    expect(invoiceOf("time_entry_id", 1)).toMatchObject({ status: "draft", client_id: 2 });
    expect(invoiceOf("time_entry_id", 1)!["id"]).not.toBe(draft.id);
  });

  it("is read again when it goes out between the read and the line, and the one press still lands", async () => {
    const first = ok(await time.moveTimeOntoInvoice([2], MOVE));
    const draft = first.invoices[0]!;
    // The draft is sent elsewhere just as this desk's line goes on it.
    const insert = studio.world.writes.insert.bind(studio.world.writes);
    let sent = false;
    studio.world.writes.insert = async (ref, values) => {
      if (ref === "invoice_lines" && !sent) {
        sent = true;
        await studio.world.writes.update("invoices", draft.id, { status: "sent" });
      }
      return insert(ref, values);
    };
    const moved = ok(await time.moveTimeOntoInvoice([1], MOVE));
    expect(moved.lines).toHaveLength(1);
    expect(invoiceOf("time_entry_id", 1)).toMatchObject({ status: "draft", client_id: 2 });
    expect(invoiceOf("time_entry_id", 1)!["id"]).not.toBe(draft.id);
  });
});

describe("a void invoice lets go of what it billed, and billed rows keep what was billed", () => {
  const refusal = async (write: Promise<unknown>) => {
    try {
      await write;
      return null;
    } catch (error) {
      const e = error as { code?: string; details?: Record<string, unknown> };
      return { code: e.code, column: e.details?.["column"] ?? null, linkedFrom: e.details?.["linkedFrom"] ?? null };
    }
  };

  it("keeps an entry's hours, day and project while a draft or a sent invoice bills it; its note stays the studio's", async () => {
    const moved = ok(await time.moveTimeOntoInvoice([3], MOVE));
    for (const values of [{ logged_hours: "9" }, { date: "2026-07-20" }, { project_id: 1 }]) {
      expect(await refusal(studio.world.writes.update("time_entries", 3, values))).toMatchObject({ code: "RECORD_LOCKED", linkedFrom: "invoice_lines" });
    }
    // The desk words it as already invoiced; a note is not what the line billed.
    const edited = await time.editTime(3, { hours: "9" });
    expect(!edited.ok && [edited.code, edited.field]).toEqual(["ALREADY_INVOICED", "logged_hours"]);
    expect(ok(await time.editTime(3, { note: "Window sketches, both" })).note).toBe("Window sketches, both");
    await studio.world.writes.update("invoices", moved.invoices[0]!.id, { status: "sent" });
    expect(await refusal(studio.world.writes.update("time_entries", 3, { logged_hours: "9" }))).toMatchObject({ code: "RECORD_LOCKED", column: "logged_hours" });
  });

  it("keeps a purchase's cost, project, client and 'pass on' while an invoice bills it", async () => {
    ok(await office.passOn([1], PASS));
    for (const values of [{ amount: "99" }, { project_id: null, client_id: 2 }, { rebill: false }]) {
      expect(await refusal(studio.world.writes.update("expenses", 1, values))).toMatchObject({ code: "RECORD_LOCKED", linkedFrom: "invoice_lines" });
    }
    const edited = await office.editPurchase(1, { amount: "99" });
    expect(!edited.ok && edited.code).toBe("ALREADY_INVOICED");
    expect(ok(await office.editPurchase(1, { what: "Proof prints, fourteen sheets" })).what).toBe("Proof prints, fourteen sheets");
  });

  it("lets a void invoice's line empty its link and nothing else, frees what it billed, and bills it again", async () => {
    const moved = ok(await time.moveTimeOntoInvoice([3], MOVE));
    const invoiceId = moved.invoices[0]!.id;
    const lineId = moved.lines[0]!.id;
    await studio.world.writes.update("invoices", invoiceId, { status: "sent" });
    // Sent: the line keeps its link.
    expect(await refusal(studio.world.writes.update("invoice_lines", lineId, { time_entry_id: null }))).toMatchObject({ code: "RECORD_LOCKED" });
    await studio.world.writes.update("invoices", invoiceId, { status: "void", void_reason: "Raised in error" });
    // Void: the hours are free to change, and the line still takes nothing but an emptied link.
    await studio.world.writes.update("time_entries", 3, { logged_hours: "4.5" });
    for (const values of [{ qty: "1" }, { time_entry_id: 1 }, { time_entry_id: null, qty: "1" }]) {
      expect(await refusal(studio.world.writes.update("invoice_lines", lineId, values))).toMatchObject({ code: "RECORD_LOCKED" });
    }
    expect(await refusal(studio.world.writes.insert("invoice_lines", { document_id: invoiceId, description: "More", qty: "1", rate: "1" }))).toMatchObject({ code: "RECORD_LOCKED" });
    expect(await refusal(studio.world.writes.remove("invoice_lines", lineId))).toMatchObject({ code: "RECORD_LOCKED" });
    // The desk's move empties the link first, then bills the hours on a new draft — kept again there.
    const again = ok(await time.moveTimeOntoInvoice([3], MOVE));
    expect(again.lines.map((l) => [l.time_entry_id, l.qty])).toEqual([[3, "4.500"]]);
    expect(tableOf(studio, "invoice_lines").find((l) => l["id"] === lineId)).toMatchObject({ document_id: invoiceId, time_entry_id: null });
    expect(invoiceOf("time_entry_id", 3)?.["id"]).toBe(again.invoices[0]!.id);
    expect(await refusal(studio.world.writes.update("time_entries", 3, { logged_hours: "2" }))).toMatchObject({ code: "RECORD_LOCKED" });
  });

  it("finishes a move whose answer to the release was lost, without writing it twice", async () => {
    const passed = ok(await office.passOn([1], PASS));
    await studio.world.writes.update("invoices", passed.invoices[0]!.id, { status: "sent" });
    await studio.world.writes.update("invoices", passed.invoices[0]!.id, { status: "void", void_reason: "Raised in error" });
    studio.failWrite(1, "after");
    const lost = await office.passOn([1], PASS);
    if (lost.ok) throw new Error("the lost answer was not noticed");
    expect(lost.unfinished?.step).toBe(`release:${String(passed.lines[0]!.id)}`);
    const done = ok(await lost.unfinished!.resume());
    expect(done.lines.map((l) => l.expense_id)).toEqual([1]);
    expect(tableOf(studio, "invoice_lines").filter((l) => l["expense_id"] === 1)).toHaveLength(1);
  });
});
