/**
 * Schedule and Capacity drawn from the desk's stores over the test studio,
 * and the one write they make: a studio date, through Adminium's sink, under
 * an action key — an away day naming who and until when.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import AddDate, { inputOf, problemsOf } from "../../sheets/schedule/AddDate.tsx";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { useDesk } from "../../state/desk.ts";
import { addStudioDate, loadStudioDates } from "../../state/officeActions.ts";
import { useSheets } from "../../state/sheets.ts";
import { useUi } from "../../state/ui.ts";
import Capacity from "../Capacity.tsx";
import Schedule from "../Schedule.tsx";
import { showDay, useScheduleView } from "./state.ts";

function current(): void {
  for (const store of [useDesk, useUi, useSheets, useScheduleView] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
  await loadStudioDates("2026-07-01", "2026-12-31");
  useUi.setState({ view: "schedule", theme: "light" });
  showDay(null);
});

describe("Schedule", () => {
  it("opens on the studio's month with today marked, its figures, and the day's panel when a day is open", () => {
    let html = draw(<Schedule />);
    expect(html).toContain('data-screen="schedule"');
    expect(html).toContain("July 2026");
    expect(html).toMatch(/data-day="2026-07-28"[^>]*>.*?sch-num--today/);
    expect(text(html)).toContain("Working days 23 July, weekends out");
    showDay("2026-07-31");
    html = draw(<Schedule />);
    expect(html).toMatch(/aria-pressed="true"[^>]*data-day="2026-07-31"/);
    expect(html).toContain('id="sch-day-title"');
  });

  it("says a clear weekday is where new work should land, and a weekend is a weekend", () => {
    showDay("2026-07-22");
    expect(text(draw(<Schedule />))).toContain("This is the kind of day new work should land on");
    showDay("2026-07-25");
    expect(text(draw(<Schedule />))).toContain("A weekend.");
  });

  it("shows the public holidays Holiday calendars keeps, under their names", () => {
    useDesk.setState((s) => ({ addOns: { ...s.addOns, "holiday-calendars": { values: { days: [{ date: "2026-07-24", name: "Founders' Day" }] }, declared: ["days"] } } }));
    showDay(null, "2026-07");
    const html = text(draw(<Schedule />));
    expect(html).toContain("Founders' Day");
    expect(html).toContain("Working days 22 July, weekends and 1 public holiday out");
  });
});

describe("Capacity", () => {
  it("gives a verdict, the sentence to paste, and thirteen weeks", () => {
    const html = draw(<Capacity />);
    expect(html).toContain('data-screen="capacity"');
    expect(html.match(/class="cap-row[ "]/g)).toHaveLength(13);
    expect(html).toMatch(/data-verdict="(soon|later|none)"/);
    expect(text(html)).toContain("The sentence to paste into the reply");
  });

  it("takes a public holiday out of every person's week", () => {
    const before = draw(<Capacity />).match(/data-week="2026-08-17".*?aria-label="([^"]+)"/)![1];
    useDesk.setState((s) => ({ addOns: { ...s.addOns, "holiday-calendars": { values: { days: [{ date: "2026-08-18", name: "A day off" }] }, declared: ["days"] } } }));
    const after = draw(<Capacity />).match(/data-week="2026-08-17".*?aria-label="([^"]+)"/)![1];
    expect(before).not.toBe(after);
    const people = Object.keys(useDesk.getState().rows.people).length;
    const cap = (label: string) => Number(/^([\d.]+) days/.exec(label)![1]);
    expect(cap(before!) - cap(after!)).toBe(people);
  });
});

describe("Add a date", () => {
  it("asks for a date, what it is, and — for an away day — who, with a last day not before the first", () => {
    expect(problemsOf({ date: "", title: " ", kind: "away", person: "", until: "" })).toEqual({ date: "schedule.sheet.error.date", title: "schedule.sheet.error.title", person: "schedule.sheet.error.person" });
    expect(problemsOf({ date: "2026-08-20", title: "Away", kind: "away", person: "1", until: "2026-08-19" })).toEqual({ until: "schedule.sheet.error.until" });
    expect(problemsOf({ date: "2026-08-20", title: "Call", kind: "call", person: "", until: "" })).toEqual({});
  });

  it("sends who and until only for an away day", () => {
    expect(inputOf({ date: "2026-08-20", title: "Call", kind: "call", person: "1", until: "2026-08-21" })).toEqual({ date: "2026-08-20", title: "Call", kind: "call" });
    expect(inputOf({ date: "2026-08-20", title: "Press", kind: "press", person: "1", until: "2026-08-21" })).toEqual({ date: "2026-08-20", title: "Press", kind: "press" });
    expect(inputOf({ date: "2026-08-20", title: "Away", kind: "away", person: "2", until: "" })).toEqual({ date: "2026-08-20", title: "Away", kind: "away", person_id: 2, to_date: null });
  });

  it("writes one `events` row through the sink, under an action key, and the day shows it", async () => {
    studio.writes.length = 0;
    const out = await addStudioDate(inputOf({ date: "2026-08-19", title: "Nadia at the type conference", kind: "away", person: "1", until: "2026-08-20" }));
    expect(out.ok).toBe(true);
    expect(studio.writes).toHaveLength(1);
    expect(studio.writes[0]).toMatchObject({ op: "insert", table: "events", values: { date: "2026-08-19", to_date: "2026-08-20", kind: "away", person_id: 1, title: "Nadia at the type conference" } });
    expect(String(studio.writes[0]!.values!["client_key"])).toMatch(/^[0-9a-f-]{36}$/);
    showDay("2026-08-20");
    expect(text(draw(<Schedule />))).toContain("Nadia at the type conference");
  });

  it("draws its fields, the away ones only for an away day", () => {
    const call = draw(<AddDate prefill={{ date: "2026-08-03", title: "Held for Vento & Sons", kind: "call" }} onClose={() => undefined} onSaved={() => undefined} />);
    expect(call).toContain('value="Held for Vento &amp; Sons"');
    expect(call).not.toContain("Who is away");
    const away = draw(<AddDate prefill={{ date: "2026-08-03", kind: "away" }} onClose={() => undefined} onSaved={() => undefined} />);
    expect(away).toContain("Who is away");
    expect(away).toContain("Until");
  });

  it("is refused before anything is sent when an away day names nobody", async () => {
    studio.writes.length = 0;
    const out = await addStudioDate({ date: "2026-08-19", title: "Away", kind: "away" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.code).toBe("PERSON_REQUIRED");
    expect(studio.writes).toHaveLength(0);
  });
});
