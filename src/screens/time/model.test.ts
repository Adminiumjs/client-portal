/**
 * What the Time screen works out from stored rows: the sample's figures at
 * 10:00 on Tuesday 28 July 2026 (the studio in New York), the filters, the
 * rows, the hourly rate from the rate card, a move's preview — exact to the
 * cent and to the hundredth of an hour, and the same whatever zone the
 * computer running it is set to.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normaliseAll } from "../../data/rows.ts";
import { resolveSample, type SampleBundleRows } from "../../data/sampleRows.ts";
import type { Id, Invoice, Project, Rate, TimeEntry } from "../../data/types.ts";
import { amountAt, dayWithYear, elapsed, filterChoices, hourly, hoursParts, movePreview, openProjects, personOf, rowsFor, sumHours, timeSums } from "./model.ts";

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;
const sample = resolveSample(bundle, { now: Date.parse("2026-07-28T14:00:00Z"), zone: "America/New_York", locale: "en-US", currency: "USD" });
const entries = normaliseAll("time_entries", sample["time_entries"]!);
const lines = normaliseAll("invoice_lines", sample["invoice_lines"]!);
const projects = Object.fromEntries(normaliseAll("projects", sample["projects"]!).map((p) => [p.id, p])) as Record<Id, Project>;
const clients = Object.fromEntries(normaliseAll("clients", sample["clients"]!).map((c) => [c.id, c]));
const rates = normaliseAll("rates", sample["rates"]!);
const settings = normaliseAll("settings", sample["settings"]!)[0]!;
const invoiced = new Set(lines.map((l) => l.time_entry_id).filter((id): id is Id => id !== null));
const company = (id: Id) => clients[id]?.company ?? null;

describe("the sample at 28 July", () => {
  it("shows 28.5 hours logged in July on three projects, 53 hours not invoiced — $6,625 at $125 an hour — and the bakehouse rebrand heaviest at 28", () => {
    const sums = timeSums(entries, invoiced, "2026-07-28");
    expect(sums.month).toBe("28.50");
    expect(sums.monthProjects).toBe(3);
    expect(sums.notInvoiced).toBe("53.00");
    const rate = hourly(rates, settings);
    expect(rate).toBe("125.00");
    expect(amountAt(sums.notInvoiced, rate!)).toBe("6625.00");
    expect(sums.heaviest).toMatchObject({ hours: "28.00" });
    expect(projects[sums.heaviest!.projectId]!.name).toBe("Bakehouse rebrand");
    // Everything the sample holds: 65 hours, 12 of them on invoices.
    expect(sumHours(entries)).toBe("65.00");
  });

  it("offers Everything and one filter per client's project, counting entries", () => {
    const choices = filterChoices(entries, projects, company);
    expect(choices.map((c) => [c.company, c.project, c.count])).toEqual([
      [null, null, 17],
      ["Hearth & Loaf", null, 8],
      ["Fold & Rule", null, 4],
      ["Northlight Records", null, 1],
      ["Ferngrove Coffee", null, 4],
    ]);
    const hearth = choices[1]!.id;
    expect(rowsFor(entries, hearth)).toHaveLength(8);
    expect(rowsFor(entries, hearth).every((e) => projects[e.project_id]!.name === "Bakehouse rebrand")).toBe(true);
  });

  it("previews a move of everything: one group per client, each onto a new draft, at the hourly rate", () => {
    const groups = movePreview(entries, invoiced, "125.00", () => null);
    expect(groups.map((g) => [company(g.clientId), g.entries.length, g.hours, g.amount, g.draft])).toEqual([
      ["Hearth & Loaf", 7, "22.00", "2750.00", null],
      ["Fold & Rule", 4, "18.50", "2312.50", null],
      ["Northlight Records", 1, "3.00", "375.00", null],
      ["Ferngrove Coffee", 3, "9.50", "1187.50", null],
    ]);
  });
});

describe("the figures, exactly", () => {
  const entry = (id: number, patch: Partial<TimeEntry>): TimeEntry => ({ id, project_id: 1, client_id: 1, milestone_id: null, person_id: 1, date: "2026-07-20", hours: "1.00", note: "x", running_for: null, started_at: null, client_key: null, ...patch });

  it("adds hours to the hundredth, leaves a running clock out, and counts only this month's", () => {
    const list = [entry(1, { hours: "0.10" }), entry(2, { hours: "0.20" }), entry(3, { hours: null, running_for: 1, started_at: "2026-07-28T13:00:00.000Z" }), entry(4, { date: "2026-06-30", hours: "7.25" })];
    const sums = timeSums(list, new Set(), "2026-07-28");
    expect([sums.month, sums.notInvoiced]).toEqual(["0.30", "7.55"]);
    expect(rowsFor(list, "all").map((e) => e.id)).toEqual([2, 1, 4]);
  });

  it("works out a rate over hours to the cent, and hours × rate half away from zero", () => {
    const rate = (amount: string, position = 0, active = true): Rate => ({ id: position + 1, label: "r", amount, hours_per_unit: null, position, active });
    expect(hourly([rate("780.00")], { hours_per_day: 6 })).toBe("130.00");
    // The studio's working day decides, not the hours a rate says it stands for.
    expect(hourly([{ ...rate("780.00"), hours_per_unit: "8" }], { hours_per_day: 6 })).toBe("130.00");
    expect(hourly([rate("100.00")], { hours_per_day: 3 })).toBe("33.33");
    // The day rate is the first on the card still in use.
    expect(hourly([rate("90.00", 0, false), rate("700.00", 1)], { hours_per_day: 7 })).toBe("100.00");
    expect(hourly([], { hours_per_day: 6 })).toBeNull();
    expect(hourly([rate("750.00")], null)).toBeNull();
    expect(amountAt("0.25", "33.33")).toBe("8.33");
    expect(amountAt("1.50", "33.33")).toBe("50.00");
    expect(amountAt("0.03", "125.00")).toBe("3.75");
  });

  it("names a new draft's place: the client's draft for the project first, and none when there is none", () => {
    const draft = { id: 9, client_id: 1, project_id: 1, status: "draft", title: "Time on Bakehouse" } as Invoice;
    const groups = movePreview([entry(1, {}), entry(2, { hours: "2.00" })], new Set([1]), "125.00", (client, project) => (client === 1 && project === 1 ? draft : null));
    expect(groups).toEqual([expect.objectContaining({ clientId: 1, hours: "2.00", amount: "250.00", draft })]);
  });
});

describe("reading", () => {
  it("finds the signed-in person by email, whatever its case", () => {
    const people = [{ id: 1, name: "Nadia Cole", email: "Nadia@Outline.example", role_label: null, initials: "NC", user_id: null, shown_to_clients: true, position: 0, days_per_week: null }];
    expect(personOf(people, "nadia@outline.example")?.id).toBe(1);
    expect(personOf(people, "tomas@outline.example")).toBeNull();
    expect(personOf(people, null)).toBeNull();
  });

  it("lists the projects time can go on — active and paused, oldest first", () => {
    const p = (id: number, status: Project["status"]) => ({ id, status }) as Project;
    expect(openProjects([p(3, "done"), p(2, "paused"), p(1, "active")]).map((x) => x.id)).toEqual([1, 2]);
  });

  it("reads hours as minutes under a tenth of an hour, and a clock's face from Adminium's stamp", () => {
    expect(hoursParts("0.05")).toEqual({ unit: "min", value: 3 });
    expect(hoursParts("2.25")).toEqual({ unit: "h", value: 2.25 });
    const start = "2026-07-28T14:00:00.000Z";
    expect(elapsed(start, Date.parse(start) + (3600 + 4 * 60 + 37) * 1000)).toEqual({ h: 1, m: 4, s: 37 });
    // A computer whose clock is behind Adminium's never shows less than nothing.
    expect(elapsed(start, Date.parse(start) - 5000)).toEqual({ h: 0, m: 0, s: 0 });
    expect(elapsed(null, Date.now())).toEqual({ h: 0, m: 0, s: 0 });
  });

  it("writes a day with its year as the calendar has it, in any zone", () => {
    expect(dayWithYear("2026-07-27", "en-US")).toBe("Jul 27, 2026");
    expect(dayWithYear("2026-01-01", "en-GB")).toBe("1 Jan 2026");
    expect(dayWithYear("", "en-US")).toBe("");
  });
});
