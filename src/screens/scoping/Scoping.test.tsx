/**
 * The scoping worksheet, drawn from the test studio: an empty sheet says so
 * and prices nothing; a worked sheet shows the rate card's arithmetic, the
 * studio's week and months of running costs; the history shows finished
 * stages against the hours logged on them and offers the reserve only when
 * stages ran over; a long client list is a list to pick from; a person who
 * cannot write proposals keeps a calculator. Drawing writes nothing — and
 * "Turn this into a proposal" finished after a lost answer saves ONE draft.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import { upsert, upsertAll, useDesk } from "../../state/desk.ts";
import { useSheets } from "../../state/sheets.ts";
import { useUi } from "../../state/ui.ts";
import { usePortal } from "../../state/portal.ts";
import { turnIntoProposal, workSheet, type Worksheet, type WorksheetInputs } from "../../state/scoping.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../../testing/fakeStudio.ts";
import { ScopingPage, type Reading } from "../Scoping.tsx";
import { EMPTY_SHEET } from "./model.ts";
import { resetWorksheet, useWorksheet } from "./store.ts";

/** Stores drawn on the server side of React read their initial state: make it the current one (test-only). */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets, useWorksheet] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (reading: Reading = { state: "ready", past: [] }) => {
  current();
  return renderToStaticMarkup(
    <I18nProvider>
      <ScopingPage reading={reading} onRetry={() => undefined} />
    </I18nProvider>,
  );
};
/** The page's text, tags stripped, entities read. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, " ");

/** A sheet: two design days and four licence handlings for Kiln Street, one purchase at cost and one ours. */
const WORKED: Worksheet = {
  clientId: 4,
  stage: "Studio sale poster, second run",
  rows: [
    { rateId: 1, qty: "2" },
    { rateId: 3, qty: "4" },
  ],
  expenses: [
    { what: "Poster proofs", amount: "60", passOn: true },
    { what: "Reference books", amount: "38", passOn: false },
  ],
  contingency: false,
  split: "5050",
};

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
  resetWorksheet();
  useUi.setState({ view: "scoping" });
  // What the worksheet reads when it opens: every client and the running costs.
  upsertAll("running_costs", tableOf(studio, "running_costs") as never);
});

describe("an empty sheet", () => {
  it("draws the heading, says nothing is kept, and prices nothing", () => {
    const html = draw();
    expect(html).toContain('data-screen="scoping"');
    expect(html).toContain(">Scoping worksheet</h1>");
    const words = text(html);
    expect(words).toContain("Nothing here is kept until you turn it into a proposal.");
    expect(words).toContain("Empty sheet. Tap something on the rate card to start putting hours against it.");
    expect(words).toContain("no hours yet");
    expect(words).toContain("Nothing on the sheet yet. The price is the rate card doing arithmetic, not a guess.");
    expect(words).toContain("Put hours against the card and this fills itself in.");
    // The rate card: each rate, the time it stands for, a button that puts it on.
    expect(words).toContain("Design day 6 h of studio time $780.00");
    expect(words).toContain("Type licence handling hours vary $90.00");
    expect(html).toContain('aria-label="Put Design day ($780.00) on the sheet"');
    expect(studio.writes).toEqual([]);
  });

  it("says the history is being read, could not be read, or has nothing yet — and offers no reserve then", () => {
    expect(text(draw({ state: "loading" }))).toContain("Loading…");
    expect(text(draw({ state: "failed" }))).toContain("The studio’s history could not be read.");
    const none = text(draw());
    expect(none).toContain("No finished stages with estimates yet.");
    expect(none).not.toContain("you always run over");
  });
});

describe("a worked sheet", () => {
  beforeEach(() => useWorksheet.setState({ sheet: WORKED }));

  it("prices the rows against the rate card and counts time by the studio's own working day", () => {
    const words = text(draw());
    // 2 × 780 + 4 × 90; two design days are 12 hours of a six-hour day.
    expect(words).toContain("12 h · 2 days");
    expect(words).toContain("$780.00 each · 12 h in total $1,560.00");
    expect(words).toContain("$90.00 each · no hours on the card $360.00");
    expect(words).toContain("Fees $1,920.00");
    expect(words).toContain("Passed on at cost: $60.00 · ours to carry: $38.00.");
    // Fees and the purchase at cost; tax at the studio's rate (the client has none of its own).
    expect(words).toContain("Price for this stage $1,980.00");
    expect(words).toContain("Tax 8.5%, added on the invoice $168.30");
    expect(words).toContain("What the invoice will read $2,148.30");
    expect(words).toContain("12 h of work — 2 studio days, or 1 each if you both take it.");
    expect(words).toContain("2 of you at 4 days a week is 8 studio days a week, so this stage fills about 0.3 weeks of the calendar.");
    expect(words).toContain("$960.00 a day");
    expect(words).toContain("At or above the $780.00 day rate on the card.");
    // $1,980 over $2,060 a month: a month, to one place.
    expect(words).toContain("1 month of fixed costs");
    expect(words).toContain("Your running costs come to $2,060.00 a month before anyone is paid.");
    expect(words).toContain("To start, before anything moves $1,074.15");
    expect(studio.writes).toEqual([]);
  });

  it("warns when the effective day rate falls under the card's", () => {
    useWorksheet.setState({ sheet: { ...WORKED, rows: [{ rateId: 2, qty: "6" }] } });
    const words = text(draw());
    // Six print checks: 12 hours for $1,440 — $720 a day, under the $780 design day.
    expect(words).toContain("$720.00 a day");
    expect(words).toContain("Under the $780.00 on your own card. Either the hours are optimistic or the price is.");
  });

  it("marks who it is for and the split, as pressed buttons", () => {
    const html = draw();
    expect(html).toMatch(/aria-pressed="true"[^>]*>Kiln Street Ceramics</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>50 \/ 50</);
    expect(html).toContain('value="Studio sale poster, second run"');
  });
});

describe("how the last stages actually went", () => {
  beforeEach(() => {
    useWorksheet.setState({ sheet: WORKED });
    const m = useDesk.getState().rows.milestones;
    // Two finished stages with estimates: one ran 25 % over, one came in as scoped.
    upsert("milestones", { ...m[1]!, estimated_days: "2" });
    upsert("milestones", { ...m[6]!, estimated_days: "1" });
    upsertAll("time_entries", [
      { id: 91, project_id: 1, client_id: 2, milestone_id: 1, person_id: 1, date: "2026-06-20", hours: "15.00", note: null, running_for: null, started_at: null, client_key: null },
      { id: 92, project_id: 3, client_id: 3, milestone_id: 6, person_id: 2, date: "2026-06-05", hours: "6.00", note: null, running_for: null, started_at: null, client_key: null },
    ]);
  });

  it("lists each finished stage against the hours logged on it, and the average overrun", () => {
    const words = text(draw({ state: "ready", past: [1, 6] }));
    expect(words).toContain("13% over, on average");
    expect(words).toContain("Structure and dielines Fold & Rule Stationers · PRJ-01 quoted 2d 2.5d +25%");
    expect(words).toContain("Card design Marigold Tea Rooms · PRJ-03 quoted 1d 1d as scoped");
    expect(words).toContain("The sheet says 2 days. History says budget 2.3 and be pleasantly surprised.");
    expect(words).toContain("Add the 13% you always run over");
    expect(words).toContain("Contingency, not added —");
  });

  it("with the reserve on, adds it to the price and says what it holds back", () => {
    useWorksheet.setState({ sheet: { ...WORKED, contingency: true } });
    const html = draw({ state: "ready", past: [1, 6] });
    const words = text(html);
    // 2 × 0.13 design days and 4 × 0.13 handlings, at the card's own rates.
    expect(words).toContain("Contingency, 13% from your record $249.60");
    expect(words).toContain("Contingency is on: $249.60 and 1.6 h added on top");
    expect(words).toContain("Price for this stage $2,229.60");
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Contingency on · 13%/);
  });

  it("offers no reserve when past stages came in at or under their estimates", () => {
    upsertAll("time_entries", [{ id: 91, project_id: 1, client_id: 2, milestone_id: 1, person_id: 1, date: "2026-06-20", hours: "10.00", note: null, running_for: null, started_at: null, client_key: null }]);
    const words = text(draw({ state: "ready", past: [1, 6] }));
    expect(words).toContain("on the nose");
    expect(words).toContain("Past stages came in at or under their estimates — nothing to hold back.");
    expect(words).not.toContain("you always run over");
  });
});

describe("who may use it, and for whom", () => {
  it("offers a list to pick from once there are more clients than chips", () => {
    const first = useDesk.getState().rows.clients[1]!;
    upsertAll("clients", Array.from({ length: 6 }, (_, i) => ({ ...first, id: 100 + i, company: `Client ${String(i)}` })));
    const html = draw();
    expect(html).toContain("<select");
    expect(html).toContain(">Choose a client</option>");
  });

  it("keeps a calculator for a person whose role cannot write proposals", () => {
    useDesk.setState((s) => ({ me: { ...s.me, access: { roles: [], tables: { proposals: ["read"] } } as never } }));
    const html = draw();
    expect(text(html)).toContain("Your role can’t write proposals, so the sheet stays a calculator for you.");
    expect(html).toMatch(/<button type="button" class="btn btn--primary ol-btn scope-turn" disabled=""/);
  });
});

describe("turning it into a proposal, after a lost answer", () => {
  it("finishes the same draft rather than starting a second", async () => {
    const state = useDesk.getState();
    const inputs: WorksheetInputs = {
      rates: Object.values(state.rows.rates),
      settings: Object.values(state.rows.settings)[0]!,
      people: Object.values(state.rows.people),
      runningCosts: [],
      milestones: [],
      time: [],
      taxRate: null,
    };
    expect(workSheet(WORKED, inputs).fees).toBe(1920);
    const drafts = () => tableOf(studio, "proposals").filter((p) => p["status"] === "draft").length;
    const before = drafts();
    // The second line saves but its answer is lost.
    studio.failWrite(3, "after");
    const first = await turnIntoProposal(WORKED, inputs, { contingencyWords: (label) => `Time held in reserve — ${label}` });
    expect(first.ok).toBe(false);
    if (first.ok || first.unfinished === null) throw new Error("expected a half-way stop");
    const done = await first.unfinished.resume();
    expect(done.ok).toBe(true);
    expect(drafts()).toBe(before + 1);
    const id = done.ok ? done.value.id : -1;
    const lines = tableOf(studio, "proposal_lines").filter((l) => l["document_id"] === id);
    expect(lines.map((l) => [l["description"], l["qty"], l["rate"]])).toEqual([
      ["Design day", "2.000", "780.00"],
      ["Type licence handling", "4.000", "90.00"],
    ]);
    // Each row carries its own step's key: none repeats.
    const keys = studio.writes.filter((w) => w.op === "insert").map((w) => w.values!["client_key"]);
    expect(new Set(keys).size).toBe(3);
    expect(EMPTY_SHEET.rows).toEqual([]);
  });
});
