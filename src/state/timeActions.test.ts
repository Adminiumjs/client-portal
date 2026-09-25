/**
 * The Time screen's actions against the test studio: what each writes, what
 * Adminium (the stand-in world) decides, and the refusals — the running
 * clock's one-per-person, and "Move onto an invoice" putting each entry on
 * one line only, however it is pressed.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Id } from "../data/types.ts";
import { DEMO_START } from "../lib/clock.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import { upsert, useDesk } from "./desk.ts";
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
    // The typed hours; Adminium's `hours` is worked out from them.
    expect(studio.writes[0]!.values).toMatchObject({ project_id: 1, milestone_id: 2, person_id: 2, date: "2026-07-28", logged_hours: "1.5", note: "Proofs at 12mm" });
    expect(studio.writes[0]!.values).not.toHaveProperty("hours");
    expect(studio.writes[0]!.values!["client_key"]).toHaveLength(36);
    // The project's client, as Adminium copies it; not a value the desk sent.
    expect(studio.writes[0]!.values).not.toHaveProperty("client_id");
    expect(entry).toMatchObject({ client_id: 2, hours: "1.50", logged_hours: "1.50", running_for: null });
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
    // A correction is the typed hours; Adminium's figure follows.
    expect(ok(await time.editTime(2, { hours: "2.75" }))).toMatchObject({ hours: "2.75", logged_hours: "2.75" });
    expect(studio.writes.at(-1)!.values).toEqual({ logged_hours: "2.75" });
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

  it("stops without sending any hours: Adminium stamps the stop and counts them from its two stamps, to the quarter hour", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 1, note: "Box artwork" }));
    expect(studio.writes.at(-1)!.values).not.toHaveProperty("hours");
    // 1 h 37 min on the clock (09:00 → 10:37, say) is 1.50 to the quarter hour.
    studio.setNow(DEMO_START + (60 + 37) * 60_000);
    const stopped = ok(await time.stopClock(clock.id));
    expect(studio.writes.at(-1)!.values).toEqual({ note: "Box artwork", running_for: null, clock_stopped: true });
    expect(stopped).toMatchObject({ hours: "1.50", logged_hours: null, running_for: null, clock_stopped: true, note: "Box artwork" });
    expect(stopped.stopped_at).toBe(new Date(DEMO_START + (60 + 37) * 60_000).toISOString());
    expect(ok(await time.startClock({ project_id: 1, person_id: 1 })).running_for).toBe(1);
  });

  it("counts a quarter at least, and a person's own hours over the clock's", async () => {
    const quick = ok(await time.startClock({ project_id: 1, person_id: 1, note: "Call" }));
    studio.setNow(DEMO_START + 2 * 60_000);
    expect(ok(await time.stopClock(quick.id)).hours).toBe("0.25");
    const typed = ok(await time.startClock({ project_id: 1, person_id: 2, note: "Proofs" }));
    studio.setNow(DEMO_START + 5 * 3_600_000);
    const stopped = ok(await time.stopClock(typed.id, { hours: "3" }));
    expect(studio.writes.at(-1)!.values).toEqual({ logged_hours: "3", note: "Proofs", running_for: null, clock_stopped: true });
    expect(stopped).toMatchObject({ hours: "3.00", logged_hours: "3.00" });
  });

  it("stores nothing for a clock left running past sixteen hours: Adminium refuses the count, and the hours are asked for", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 2, note: "Artwork" }));
    studio.setNow(DEMO_START + 17 * 3_600_000);
    const long = await time.stopClock(clock.id);
    expect(!long.ok && [long.code, long.field]).toEqual(["CLOCK_TOO_LONG", "hours"]);
    // Refused whole: the clock still runs, with no stop and no hours.
    expect(tableOf(studio, "time_entries").find((e) => e["id"] === clock.id)).toMatchObject({ running_for: 2, hours: null, stopped_at: null, clock_stopped: false });
    const typed = ok(await time.stopClock(clock.id, { hours: "7" }));
    expect(typed).toMatchObject({ hours: "7.00", running_for: null, clock_stopped: true });
    expect(typed.stopped_at).toBe(new Date(DEMO_START + 17 * 3_600_000).toISOString());
  });

  it("will not stop again a clock another computer stopped — nor touch its hours once a line carries them", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 1, note: "Box artwork" }));
    const running = { ...useDesk.getState().rows.time_entries[clock.id]! };
    // Another computer stops it at two hours…
    studio.setNow(DEMO_START + 2 * 3_600_000);
    const there = await studio.world.writes.update("time_entries", clock.id, { running_for: null, clock_stopped: true });
    expect(there).toMatchObject({ hours: "2.00" });
    // …while this page still holds it running, and its person types five hours.
    upsert("time_entries", running);
    studio.setNow(DEMO_START + 5 * 3_600_000);
    const sent = studio.writes.length;
    const stale = await time.stopClock(clock.id, { hours: "5" });
    expect(!stale.ok && stale.code).toBe("CLOCK_NOT_RUNNING");
    expect(studio.writes.length).toBe(sent);
    // The page now holds the truth.
    expect(useDesk.getState().rows.time_entries[clock.id]).toMatchObject({ running_for: null, hours: "2.00" });
    // Moved onto an invoice there, and pressed again here from the stale row: refused, the line and the entry agree.
    ok(await time.moveTimeOntoInvoice([clock.id], MOVE));
    upsert("time_entries", running);
    const invoiced = await time.stopClock(clock.id, { hours: "5" });
    expect(!invoiced.ok && invoiced.code).toBe("ALREADY_INVOICED");
    const line = lines().find((l) => l["time_entry_id"] === clock.id)!;
    const stored = tableOf(studio, "time_entries").find((e) => e["id"] === clock.id)!;
    expect([stored["hours"], stored["logged_hours"], line["qty"]]).toEqual(["2.00", null, "2.000"]);
  });

  it("stamps the stop once: a second stop written to Adminium keeps the first moment and the hours", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 1, note: "Box artwork" }));
    studio.setNow(DEMO_START + 3_600_000);
    const first = ok(await time.stopClock(clock.id));
    studio.setNow(DEMO_START + 9 * 3_600_000);
    // Sent again with a change beside it, so the write is not a no-op.
    const again = await studio.world.writes.update("time_entries", clock.id, { running_for: null, clock_stopped: true, note: "Box artwork, again" });
    expect([again.stopped_at, again.hours, again.note]).toEqual([first.stopped_at, "1.00", "Box artwork, again"]);
  });

  it("asks what a clock was on before stopping it, and refuses typed hours out of range before anything is sent", async () => {
    const clock = ok(await time.startClock({ project_id: 1, person_id: 2 }));
    const sent = studio.writes.length;
    const noNote = await time.stopClock(clock.id);
    expect(!noNote.ok && noNote.code).toBe("NOTE_REQUIRED");
    const tooMany = await time.stopClock(clock.id, { hours: "16.5", note: "Artwork" });
    expect(!tooMany.ok && [tooMany.code, tooMany.field]).toEqual(["HOURS_OUT_OF_RANGE", "hours"]);
    expect(studio.writes.length).toBe(sent);
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
