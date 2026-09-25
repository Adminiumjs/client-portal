/**
 * The studio's month, worked out from the sample the app ships, at 10:00 on
 * 28 July 2026 in New York: what July and August show, what comes next, and
 * the calendar arithmetic under them — which must not move with the zone the
 * tests run in (`TZ=Asia/Kolkata`, `TZ=America/Los_Angeles`).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveSample, type SampleBundleRows } from "../../data/sampleRows.ts";
import type { Id } from "../../data/types.ts";
import { dayMonthLabel, holidaysOf, itemsByDay, monthGrid, monthLabel, monthStats, nextInOrder, shiftMonth, type ScheduleInputs } from "./model.ts";

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;
const rows = resolveSample(bundle, { now: Date.parse("2026-07-28T14:00:00Z"), zone: "America/New_York", locale: "en-US", currency: "USD" });
const all = (t: string) => rows[t]!;

export const sampleInputs = (): ScheduleInputs => ({
  projects: all("projects").map((p) => ({ id: p["id"] as Id, status: p["status"] as "active", client_id: p["client_id"] as Id })),
  milestones: all("milestones").map((m) => ({ id: m["id"] as Id, project_id: m["project_id"] as Id, title: String(m["title"]), due_on: (m["due_on"] as string | null) ?? null, state: m["state"] as "now" })),
  invoices: all("invoices").map((i) => ({ id: i["id"] as Id, number: String(i["number"]), status: i["status"] as "sent", balance: String(i["balance"]), due_on: (i["due_on"] as string | null) ?? null, client_id: i["client_id"] as Id })),
  events: all("events").map((e) => ({ id: e["id"] as Id, date: String(e["date"]), to_date: (e["to_date"] as string | null) ?? null, title: String(e["title"]), kind: e["kind"] as "call", person_id: (e["person_id"] as Id | null) ?? null })),
  holidays: [],
});

const TODAY = "2026-07-28";

describe("the sample's month, at 28 July", () => {
  const bag = itemsByDay(sampleInputs());

  it("July: 23 working days, two milestones, nobody away; the overdue INV-S2038 on its day", () => {
    expect(monthStats("2026-07", bag)).toEqual({ workingDays: 23, holidays: 0, committed: 2, awayDays: 0, awayPeople: [] });
    expect(bag.get("2026-07-16")?.map((i) => [i.kind, i.title])).toEqual([["payment", "INV-S2038"]]);
    expect(bag.get("2026-07-29")?.map((i) => [i.kind, i.title])).toEqual([["now", "Wordmark refinement"]]);
  });

  it("August: 21 working days, five milestones, Tomas away three days — on each of 10, 11 and 12 August", () => {
    expect(monthStats("2026-08", bag)).toEqual({ workingDays: 21, holidays: 0, committed: 5, awayDays: 3, awayPeople: [2] });
    for (const day of ["2026-08-10", "2026-08-11", "2026-08-12"]) expect(bag.get(day)?.map((i) => [i.kind, i.title])).toEqual([["away", "Tomas away"]]);
    expect(bag.get("2026-08-13")).toBeUndefined();
    // Two things on the 3rd: INV-S2040 due, the call with Rosa Vento.
    expect(bag.get("2026-08-03")?.map((i) => i.kind)).toEqual(["payment", "call"]);
  });

  it("leaves out done milestones, a finished project's, paid and void invoices", () => {
    const titles = [...bag.values()].flat().map((i) => i.title);
    expect(titles).not.toContain("Discovery & audit"); // done
    expect(titles).not.toContain("Print handoff"); // done project
    expect(titles).not.toContain("INV-S2036"); // paid
    expect(titles).not.toContain("INV-S2027"); // void
  });

  it("lists the next seven from today, in order", () => {
    expect(nextInOrder(bag, TODAY).map((n) => [n.day, n.item.title])).toEqual([
      ["2026-07-29", "Wordmark refinement"],
      ["2026-07-30", "Press check — Fold & Rule"],
      ["2026-07-31", "Box & sleeve layouts"],
      ["2026-08-03", "INV-S2040"],
      ["2026-08-03", "Call with Rosa Vento"],
      ["2026-08-07", "Label marks"],
      ["2026-08-07", "INV-S2039"],
    ]);
  });

  it("lists an away stretch once, on its first day — or today when it has begun", () => {
    const later = nextInOrder(bag, "2026-08-08", 20).filter((n) => n.item.kind === "away");
    expect(later.map((n) => [n.day, n.item.from, n.item.to])).toEqual([["2026-08-10", "2026-08-10", "2026-08-12"]]);
    const during = nextInOrder(bag, "2026-08-11", 20).filter((n) => n.item.kind === "away");
    expect(during.map((n) => n.day)).toEqual(["2026-08-11"]);
  });
});

describe("public holidays from Holiday calendars", () => {
  it("reads the add-on's days, dropping anything that is not a day", () => {
    expect(holidaysOf({ days: [{ date: "2026-09-07", name: "Labor Day" }, { date: "7 Sept", name: "x" }, null, { date: "2026-07-04", name: "  " }, { date: "2026-07-04", from: "us" }] })).toEqual([
      { date: "2026-07-04", name: "2026-07-04" },
      { date: "2026-07-04", name: "2026-07-04" },
      { date: "2026-09-07", name: "Labor Day" },
    ]);
    expect(holidaysOf(null)).toEqual([]);
    expect(holidaysOf({ days: "nope" })).toEqual([]);
  });

  it("puts a holiday on its day under its name, and takes it out of the working days", () => {
    const bag = itemsByDay({ ...sampleInputs(), holidays: [{ date: "2026-09-07", name: "Labor Day" }, { date: "2026-09-05", name: "A Saturday" }] });
    expect(bag.get("2026-09-07")?.map((i) => [i.kind, i.title])).toEqual([["holiday", "Labor Day"]]);
    const september = monthStats("2026-09", bag);
    expect([september.workingDays, september.holidays]).toEqual([21, 1]);
  });

  it("does not count a person away on a holiday twice", () => {
    const bag = itemsByDay({ ...sampleInputs(), holidays: [{ date: "2026-08-11", name: "A day off" }] });
    expect(monthStats("2026-08", bag).awayDays).toBe(2);
  });
});

describe("the calendar arithmetic", () => {
  it("draws a month Monday first, in whole weeks", () => {
    const august = monthGrid("2026-08");
    expect(august).toHaveLength(42);
    expect(august.slice(0, 6).map((c) => c.day)).toEqual([null, null, null, null, null, "2026-08-01"]);
    expect(august[5]!.weekend).toBe(true);
    expect(august[35]!.day).toBe("2026-08-31");
    expect(monthGrid("2026-02")).toHaveLength(35);
  });

  it("moves across a year", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("names a month and a day the same whatever the reader's zone", () => {
    expect(monthLabel("2026-08", "en-US")).toBe("August 2026");
    expect(dayMonthLabel("2026-08-17", "en-GB")).toBe("17 August");
    expect(dayMonthLabel("2026-09-01", "en-US")).toBe("September 1");
  });
});
