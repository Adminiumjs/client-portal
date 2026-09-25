/**
 * The Time screen's actions against the test studio: what each writes, what
 * Adminium (the stand-in world) decides, and the refusals — the running
 * clock's one-per-person, and "Move onto an invoice" putting each entry on
 * one line only, however it is pressed.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Id, TimeEntry } from "../data/types.ts";
import { DEMO_START } from "../lib/clock.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import { useDesk } from "./desk.ts";
import { takeOffDraft } from "./invoiceDrafts.ts";
import type { Outcome } from "./outcome.ts";
import * as time from "./timeActions.ts";

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

const ok = <T,>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason} ${outcome.code} ${String(outcome.field)}`);
  return outcome.value;
};
const trail = () => studio.writes.map((w) => `${w.op} ${w.table}`);
const lines = () => tableOf(studio, "invoice_lines");
const MOVE = { rate: "125.00", newTitle: () => "Time" };

describe("logging time", () => {
  it("logs one entry today on the milestone under way; the client is copied from the project by Adminium", async () => {
    const entry = ok(await time.logTime({ project_id: 1, person_id: 2, hours: "1.5", note: " Proofs at 12mm " }));
    expect(trail()).toEqual(["insert time_entries"]);
    expect(studio.writes[0]!.values).toMatchObject({ project_id: 1, milestone_id: 2, person_id: 2, date: "2026-07-28", hours: "1.5", note: "Proofs at 12mm" });
    expect(studio.writes[0]!.values!["client_key"]).toHaveLength(36);
    // The project's client, as Adminium copies it; not a value the desk sent.
    expect(studio.writes[0]!.values).not.toHaveProperty("client_id");
    expect(entry).toMatchObject({ client_id: 2, hours: "1.50", running_for: null });
  });

  it("refuses hours outside above-zero-to-sixteen and a missing note, before anything is sent", async () => {
    for (const hours of ["0", "16.5", "two", "1.255"]) {
      const refused = await time.logTime({ project_id: 1, person_id: 1, hours, note: "x" });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect([refused.reason, refused.field]).toEqual(["invalid", "hours"]);
    }
    const noNote = await time.logTime({ project_id: 1, person_id: 1, hours: "2", note: "  " });
    expect(!noNote.ok && [noNote.code, noNote.field]).toEqual(["NOTE_REQUIRED", "note"]);
    expect(studio.writes).toEqual([]);
    expect(ok(await time.logTime({ project_id: 1, person_id: 1, hours: "16", note: "A long press day" })).hours).toBe("16.00");
  });

  it("will not change an entry once a line invoices it — the line's hours are the record", async () => {
    ok(await time.moveTimeOntoInvoice([1], MOVE));
    const refused = await time.editTime(1, { hours: "5" });
    expect(!refused.ok && refused.code).toBe("ALREADY_INVOICED");
    expect(ok(await time.editTime(2, { note: "Dieline check, again" })).note).toBe("Dieline check, again");
  });
});

describe("the running clock", () => {
  it("starts with no hours and Adminium's start stamp; a second clock for the same person is refused", async () => {
    const clock = ok(await time.startClock({ project_id: 2, person_id: 1 }));
    expect(clock).toMatchObject({ running_for: 1, hours: null, milestone_id: 4, date: "2026-07-28" });
    expect(clock.started_at).toBe(new Date(DEMO_START).toISOString());
    const again = await time.startClock({ project_id: 1, person_id: 1 });
    expect(!again.ok && [again.reason, again.code]).toEqual(["duplicate", "UNIQUE_VIOLATION"]);
    // Someone else's clock is theirs.
    expect(ok(await time.startClock({ project_id: 1, person_id: 2 })).running_for).toBe(2);
    expect(time.clockOf(1)?.id).toBe(clock.id);
  });

  it("stops with the hours from the stamp, to the quarter hour, and frees the person for another", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 1, note: "Box artwork" }));
    const stopped = ok(await time.stopClock(clock.id, { at: DEMO_START + (2 * 60 + 20) * 60_000 }));
    expect(stopped).toMatchObject({ hours: "2.25", running_for: null, note: "Box artwork" });
    expect(studio.writes.at(-1)!.values).toEqual({ hours: "2.25", note: "Box artwork", running_for: null });
    expect(ok(await time.startClock({ project_id: 1, person_id: 1 })).running_for).toBe(1);
  });

  it("asks for the hours rather than guessing a clock left running past sixteen, and for a note", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 2 }));
    const long = await time.stopClock(clock.id, { at: DEMO_START + 17 * 3_600_000, note: "Artwork" });
    expect(!long.ok && [long.code, long.field]).toEqual(["CLOCK_TOO_LONG", "hours"]);
    const noNote = await time.stopClock(clock.id, { at: DEMO_START + 3_600_000 });
    expect(!noNote.ok && noNote.code).toBe("NOTE_REQUIRED");
    expect(ok(await time.stopClock(clock.id, { hours: "7", note: "Artwork" })).hours).toBe("7.00");
    expect(time.clockHours({ started_at: new Date(DEMO_START).toISOString() } as TimeEntry, DEMO_START + 60_000)).toBe("0.25");
  });
});

describe("moving time onto an invoice", () => {
  it("puts one line per entry on a new draft for a client with none, and on the client's own draft otherwise", async () => {
    const extra = ok(await time.logTime({ project_id: 4, person_id: 1, hours: "2", note: "Extra formats" }));
    const moved = ok(await time.moveTimeOntoInvoice([1, 2, 3, extra.id], MOVE));
    // Client 2 (entries 1, 2) and client 1 (entry 3) have no plain draft: one each is made; client 4 has INV-2041.
    expect(trail().filter((t) => t === "insert invoices")).toHaveLength(2);
    expect(moved.lines.map((l) => [l.time_entry_id, l.qty, l.rate])).toEqual(
      expect.arrayContaining([
        // A line keeps three places of quantity (the add-on's shape).
        [1, "3.500", "125.00"],
        [2, "2.000", "125.00"],
        [3, "4.000", "125.00"],
        [extra.id, "2.000", "125.00"],
      ]),
    );
    const onDraft7 = lines().filter((l) => l["document_id"] === 7);
    expect(onDraft7.map((l) => [l["position"], l["time_entry_id"]])).toEqual([
      [0, null],
      [1, extra.id],
    ]);
    // The drafts' totals are Adminium's, read back: 3.5 h + 2 h at 125 = 687.50 before tax.
    const forClient2 = moved.invoices.find((i) => i.client_id === 2)!;
    expect(forClient2).toMatchObject({ status: "draft", project_id: 1, subtotal: "687.50", title: "Time" });
    expect(time.isInvoiced(useDesk.getState().rows.time_entries[1]!)).toBe(true);
  });

  it("writes nothing twice when pressed twice, at once or one after the other", async () => {
    const [a, b] = await Promise.all([time.moveTimeOntoInvoice([1, 2], MOVE), time.moveTimeOntoInvoice([1, 2], MOVE)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    ok(await time.moveTimeOntoInvoice([1, 2], MOVE));
    const carried = lines().filter((l) => l["time_entry_id"] !== null && l["time_entry_id"] !== undefined);
    expect(carried.map((l) => l["time_entry_id"]).sort()).toEqual([1, 2]);
    expect(tableOf(studio, "invoices").filter((i) => i["client_id"] === 2 && i["status"] === "draft")).toHaveLength(1);
  });

  it("puts an entry on one line when two different moves overlap", async () => {
    const [a, b] = await Promise.all([time.moveTimeOntoInvoice([1, 2], MOVE), time.moveTimeOntoInvoice([2, 3], MOVE)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    const carried = lines().map((l) => l["time_entry_id"]).filter((id) => id !== null && id !== undefined);
    expect([...carried].sort()).toEqual([1, 2, 3]);
  });

  it("finishes a move whose answer was lost half-way, without a second line", async () => {
    studio.failWrite(2, "after");
    const first = await time.moveTimeOntoInvoice([1, 2], MOVE);
    expect(first.ok).toBe(false);
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished move");
    ok(await first.unfinished.resume());
    expect(lines().filter((l) => l["time_entry_id"] === 1)).toHaveLength(1);
    expect(lines().filter((l) => l["time_entry_id"] === 2)).toHaveLength(1);
  });

  it("frees an entry when its line comes off the draft, so it can be moved again", async () => {
    const moved = ok(await time.moveTimeOntoInvoice([3], MOVE));
    ok(await takeOffDraft(moved.lines[0]!.id));
    expect(time.isInvoiced(useDesk.getState().rows.time_entries[3]!)).toBe(false);
    const again = ok(await time.moveTimeOntoInvoice([3], MOVE));
    expect(again.lines.map((l) => l.time_entry_id)).toEqual([3]);
  });

  it("leaves a running clock and an already invoiced entry where they are", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 2 }));
    ok(await time.moveTimeOntoInvoice([1], MOVE));
    const moved = ok(await time.moveTimeOntoInvoice([1, clock.id], MOVE));
    expect(moved).toMatchObject({ lines: [], skipped: [1] });
  });

  it("keeps an invoiced entry: Adminium refuses to delete what a line points at", async () => {
    ok(await time.moveTimeOntoInvoice([3], MOVE));
    const refused = await time.removeTime(3);
    expect(!refused.ok && refused.code).toBe("FK_VIOLATION");
    ok(await time.removeTime(2));
    expect(tableOf(studio, "time_entries").map((e) => e["id"] as Id)).not.toContain(2);
  });
});

describe("the rate card's hourly rate", () => {
  it("divides a rate by the hours it stands for, to the cent", () => {
    expect(time.hourlyRate({ amount: "750.00", hours_per_unit: "6" })).toBe("125.00");
    expect(time.hourlyRate({ amount: "400.00", hours_per_unit: "3.00" })).toBe("133.33");
    expect(time.hourlyRate({ amount: "250", hours_per_unit: "0.75" })).toBe("333.33");
    expect(time.hourlyRate({ amount: "90.00", hours_per_unit: null })).toBeNull();
  });
});
