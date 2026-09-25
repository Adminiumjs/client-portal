/**
 * The Time screen against the test studio: what it draws from the stored
 * rows (the sums, the filters, the rows and whether a line carries each, the
 * clocks — whoever's they are — and the foot), and what its buttons write:
 * "Move onto an invoice" one line per entry at the rate card's hourly rate,
 * in order and under keys, nothing twice; Stop the hours from Adminium's
 * stamp, or back to the person when it cannot settle them.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import type { Id, TimeEntry } from "../data/types.ts";
import { I18nProvider } from "../i18n/index.tsx";
import { DEMO_START, setClockSource } from "../lib/clock.ts";
import { drop, useDesk } from "../state/desk.ts";
import { usePortal } from "../state/portal.ts";
import { useSheets } from "../state/sheets.ts";
import { loadTime, startClock } from "../state/timeActions.ts";
import { useUi } from "../state/ui.ts";
import MoveOntoInvoice, { draftTitle } from "../sheets/time/MoveOntoInvoice.tsx";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import { moveNotInvoiced, stopOrAsk, toMove } from "./time/act.ts";
import { Entries } from "./time/Entries.tsx";
import { logProblem } from "./time/LogForm.tsx";
import { hourly } from "./time/model.ts";
import { refusalWords } from "./time/words.ts";
import Time from "./Time.tsx";

/** Stores drawn on the server side of React read their initial state: make it the current one (test-only). */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node = <Time />) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const count = (html: string, needle: string) => html.split(needle).length - 1;
const ok = <T,>(out: { ok: true; value: T } | { ok: false; code: string }): T => {
  if (!out.ok) throw new Error(`refused: ${out.code}`);
  return out.value;
};

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
  await loadTime("2000-01-01");
  useUi.setState({ view: "time" });
});

const held = () => Object.values(useDesk.getState().rows.time_entries);
const invoicedNow = () => new Set(Object.values(useDesk.getState().rows.invoice_lines).flatMap((l) => (l.time_entry_id === null ? [] : [l.time_entry_id])));
const rate = () => hourly(Object.values(useDesk.getState().rows.rates), Object.values(useDesk.getState().rows.settings)[0] ?? null)!;

describe("the Time screen, drawn", () => {
  it("heads the page and works the lead out from the rate card and the people", () => {
    const html = draw();
    expect(html).toContain('data-screen="time"');
    expect(html).toContain(">Time</h1>");
    expect(html).toContain("Logged by hand, at the end of the day, by 2 people.");
    // The design day ($780) over six hours.
    expect(html).toContain("$130.00 an hour is the day rate divided by 6");
  });

  it("adds up this month, what no line carries yet, and the heaviest project", () => {
    const html = draw();
    expect(html).toContain("Logged in July");
    expect(html).toMatch(/data-sum="month".*?9\.5 h.*?across 2 projects/);
    expect(html).toMatch(/data-sum="open".*?9\.5 h.*?\$1,235\.00 at \$130\.00 an hour/);
    expect(html).toMatch(/data-sum="heaviest".*?5\.5 h.*?Packaging system/);
  });

  it("filters by project, named by the client, counting entries", () => {
    const html = draw();
    expect(html).toMatch(/aria-pressed="true"[^>]*>Everything<span class="filter-count">3<\/span>/);
    expect(html).toContain("Fold &amp; Rule Stationers<span class=\"filter-count\">2</span>");
    expect(html).toContain("Hearth &amp; Co Bakery<span class=\"filter-count\">1</span>");
  });

  it("draws each entry with who, what, client · milestone · day and its hours, not invoiced", () => {
    const html = draw();
    expect(html).toContain("Box artwork, second pass");
    expect(html).toContain("Fold &amp; Rule Stationers · Artwork · Jul 27, 2026");
    expect(html).toContain(">3.5 h<");
    expect(count(html, '<span class="time-chip">Not invoiced</span>')).toBe(3);
    expect(html).toContain("Not invoiced across everything");
    expect(html).toContain("Move onto an invoice");
  });

  it("offers Start when nothing runs", () => {
    const html = draw();
    expect(html).toContain("Nothing running");
    expect(html).toContain(">Start<");
    expect(html).not.toContain(">Stop<");
  });

  it("shows a clock started on any computer — it is a stored row — and no second Start for its person", async () => {
    ok(await startClock({ project_id: 2, person_id: 1, note: "Window sketch C" }));
    const html = draw();
    expect(html).toContain("Hearth &amp; Co Bakery · Seasonal window");
    expect(html).toContain("Nadia Cole · started 10:00 AM · it becomes a real entry when you stop");
    expect(html).toContain(">Stop<");
    expect(html).not.toContain("Nothing running");
    expect(html).not.toContain(">Start<");
    // The running clock is not an entry yet.
    expect(html).not.toContain("Window sketch C");
  });

  it("offers Start beside someone else's clock", async () => {
    ok(await startClock({ project_id: 1, person_id: 2, note: "Dielines" }));
    const html = draw();
    expect(html).toContain("Tomas Reyes · started");
    expect(html).toContain("Your clock isn’t running");
    expect(html).toContain(">Start<");
  });

  it("says Invoiced — as a button to the invoice — once a line carries the entry, and nothing to invoice when all are", async () => {
    ok(await moveNotInvoiced(held(), invoicedNow(), rate(), () => "Time"));
    const html = draw();
    // A draft has no number yet: the chip says Invoiced, and opens the draft.
    expect(count(html, '<button type="button" class="time-chip time-chip--on ol-chip">Invoiced</button>')).toBe(3);
    expect(count(html, '<span class="time-chip">Not invoiced</span>')).toBe(0);
    expect(html).toContain("Everything here is invoiced");
    expect(html).toContain("Nothing to invoice");
  });

  it("draws an empty studio, a read in progress and a failed read", () => {
    const empty = draw(<Entries load="ready" rows={[]} invoicedBy={new Map()} onRetry={() => undefined} />);
    expect(empty).toContain("No time logged yet.");
    expect(draw(<Entries load="loading" rows={[]} invoicedBy={new Map()} onRetry={() => undefined} />)).toContain("Loading…");
    const failed = draw(<Entries load="failed" rows={[]} invoicedBy={new Map()} onRetry={() => undefined} />);
    expect(failed).toContain("The time couldn’t be read.");
    expect(failed).toContain("Try again");
  });

  it("says, before the move, where each client's lines will go", () => {
    const html = draw(<MoveOntoInvoice entries={held()} invoiced={invoicedNow()} rate={rate()} companyOf={(id) => (id === 2 ? "Fold & Rule" : "Hearth & Loaf")} onClose={() => undefined} />);
    expect(html).toContain("One line for each entry, at $130.00 an hour.");
    expect(html).toMatch(/Fold &amp; Rule.*?2 entries · onto a new draft.*?5\.5 h.*?\$715\.00/);
    expect(html).toMatch(/Hearth &amp; Loaf.*?1 entry · onto a new draft.*?4 h.*?\$520\.00/);
    expect(html).toContain("Move 9.5 h · $1,235.00");
  });
});

describe("what the buttons write", () => {
  it("moves the filter's hours onto a new draft per client: the draft first, then one keyed line per entry at the hourly rate", async () => {
    const onPackaging = held().filter((e) => e.project_id === 1);
    const moved = ok(await moveNotInvoiced(onPackaging, invoicedNow(), rate(), (projectId) => (projectId === 1 ? "Time on Packaging system" : "Time")));
    expect(studio.writes.map((w) => `${w.op} ${w.table}`)).toEqual(["insert invoices", "insert invoice_lines", "insert invoice_lines"]);
    expect(studio.writes[0]!.values).toMatchObject({ client_id: 2, project_id: 1, title: "Time on Packaging system" });
    const keys = studio.writes.map((w) => w.values!["client_key"] as string);
    expect(keys.every((k) => k.length === 36)).toBe(true);
    expect(new Set(keys).size).toBe(3);
    expect(studio.writes.slice(1).map((w) => [w.values!["time_entry_id"], w.values!["qty"], w.values!["rate"]])).toEqual([
      [1, "3.50", "130.00"],
      [2, "2.00", "130.00"],
    ]);
    // Adminium's amounts, read back: 5.5 h at $130.
    expect(moved.invoices[0]).toMatchObject({ subtotal: "715.00", status: "draft" });
    // Pressed again: nothing to move, nothing written.
    const before = studio.writes.length;
    expect(toMove(onPackaging, invoicedNow())).toEqual([]);
    ok(await moveNotInvoiced(onPackaging, invoicedNow(), rate(), () => "Time"));
    expect(studio.writes.length).toBe(before);
  });

  it("puts a client's lines on their own draft when they have one, and never on a stage invoice", async () => {
    const first = ok(await moveNotInvoiced(held().filter((e) => e.id === 1), invoicedNow(), rate(), () => "Time"));
    const draftId = first.invoices[0]!.id;
    const writesBefore = studio.writes.length;
    ok(await moveNotInvoiced(held().filter((e) => e.id === 2), invoicedNow(), rate(), () => "Time"));
    expect(studio.writes.slice(writesBefore).map((w) => `${w.op} ${w.table}`)).toEqual(["insert invoice_lines"]);
    expect(studio.writes.at(-1)!.values).toMatchObject({ document_id: draftId, time_entry_id: 2 });
    const stage = tableOf(studio, "invoices").filter((i) => i["from_quote_id"] !== null && i["from_quote_id"] !== undefined).map((i) => i["id"]);
    expect(tableOf(studio, "invoice_lines").filter((l) => l["time_entry_id"] !== null && l["time_entry_id"] !== undefined && stage.includes(l["document_id"]))).toEqual([]);
  });

  it("finishes a move whose answer was lost, under the same keys, without a second line", async () => {
    studio.failWrite(2, "after");
    const out = await moveNotInvoiced(held(), invoicedNow(), rate(), () => "Time");
    expect(out.ok).toBe(false);
    if (out.ok || out.unfinished === null) throw new Error("expected a move to finish");
    ok(await out.unfinished.resume());
    const carried = tableOf(studio, "invoice_lines").map((l) => l["time_entry_id"]).filter((id) => id !== null && id !== undefined);
    expect([...carried].sort()).toEqual([1, 2, 3]);
  });

  it("stops a clock with the hours from Adminium's stamp, to the quarter hour", async () => {
    const clock = ok(await startClock({ project_id: 1, person_id: 1, note: "Box artwork" }));
    setClockSource(() => DEMO_START + 100 * 60_000);
    const answer = await stopOrAsk(clock);
    expect(answer).toMatchObject({ kind: "stopped", entry: { hours: "1.75", running_for: null } });
    expect(studio.writes.at(-1)).toMatchObject({ op: "update", table: "time_entries", id: clock.id, values: { hours: "1.75", note: "Box artwork", running_for: null } });
  });

  it("hands a clock left past sixteen hours back to the person, writing nothing", async () => {
    const clock = ok(await startClock({ project_id: 1, person_id: 1, note: "Box artwork" }));
    setClockSource(() => DEMO_START + 17 * 3_600_000);
    const writes = studio.writes.length;
    expect(await stopOrAsk(clock)).toEqual({ kind: "ask", why: { key: "time.error.tooLong", field: "hours" } });
    expect(studio.writes.length).toBe(writes);
  });

  it("says a clock was already stopped elsewhere", async () => {
    const clock = ok(await startClock({ project_id: 1, person_id: 1, note: "Box artwork" }));
    ok(await stopOrAsk(clock).then((a) => (a.kind === "stopped" ? { ok: true as const, value: a } : { ok: false as const, code: a.kind })));
    // This page still drew it running.
    const stale: TimeEntry = { ...clock };
    expect(await stopOrAsk(stale)).toMatchObject({ kind: "refused", code: "CLOCK_NOT_RUNNING", why: { key: "time.error.notRunning" } });
  });
});

describe("the words for a refusal", () => {
  it("says a second clock is someone's running one, and checks the form before anything is sent", async () => {
    ok(await startClock({ project_id: 1, person_id: 1, note: "a" }));
    const again = await startClock({ project_id: 2, person_id: 1, note: "b" });
    if (again.ok) throw new Error("a second clock should be refused");
    expect(refusalWords(again)).toEqual({ key: "time.error.clockRunning", field: null });
    const draft = { project: 1 as Id, who: 1 as Id, date: "2026-07-28", note: "Artwork", hours: "2" };
    expect(logProblem({ ...draft, hours: "" }, "2026-07-28")).toEqual({ key: "time.error.hours", field: "hours" });
    expect(logProblem({ ...draft, hours: "17" }, "2026-07-28")).toEqual({ key: "time.error.hours", field: "hours" });
    expect(logProblem({ ...draft, hours: "1.255" }, "2026-07-28")).toEqual({ key: "time.error.hoursNumber", field: "hours" });
    expect(logProblem({ ...draft, note: " " }, "2026-07-28")).toEqual({ key: "time.error.note", field: "note" });
    expect(logProblem({ ...draft, date: "2026-07-29" }, "2026-07-28")).toEqual({ key: "time.error.date", field: "date" });
    expect(logProblem(draft, "2026-07-28")).toBeNull();
  });

  it("titles a new draft for its project, or plainly when the lines span several", () => {
    const t = (key: string, params?: Record<string, string>) => (key === "time.move.draftTitle" ? `Time on ${params?.["project"] ?? ""}` : "Time");
    expect(draftTitle(t, { name: "Seasonal window" } as never)).toBe("Time on Seasonal window");
    expect(draftTitle(t, undefined)).toBe("Time");
  });

  it("keeps a removed entry out of the page", () => {
    drop("time_entries", 3);
    expect(draw()).not.toContain("Window sketches A and B");
  });
});
