/**
 * THE BACK OFFICE'S FIGURES COME OUT OF THE SAMPLE'S ROWS, at the design's
 * moment (10:00 on Tuesday 28 July 2026, the studio in New York): what Time,
 * Expenses, Suppliers, Money, Schedule, Capacity and the scoping worksheet's
 * history show when the sample is added — and the wave-1 figures untouched
 * (`sample-figures.test.ts` holds those).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { capacityWeeks } from "../state/capacity.ts";
import { pastStages } from "../state/scoping.ts";
import { resolveSample, type ResolvedRow, type SampleBundleRows } from "./sampleRows.ts";
import type { Id } from "./types.ts";

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;
const now = Date.parse("2026-07-28T14:00:00Z");
const rows = resolveSample(bundle, { now, zone: "America/New_York", locale: "en-US", currency: "USD" });
const all = (table: string) => rows[table]!;
const n = (value: unknown) => Number(value ?? 0);
const sum = (list: ResolvedRow[], column: string) => Math.round(list.reduce((total, row) => total + n(row[column]), 0) * 100) / 100;
const byId = (table: string, id: unknown) => all(table).find((r) => r["id"] === id)!;

describe("Time, at 28 July", () => {
  const entries = all("time_entries");
  const carried = new Set<unknown>(all("invoice_lines").map((l) => l["time_entry_id"]).filter((id) => id !== null && id !== undefined));

  it("logs 28.5 hours in July, by the two partners, across four projects", () => {
    expect(sum(entries.filter((e) => String(e["date"]).startsWith("2026-07")), "hours")).toBe(28.5);
    expect(new Set(entries.map((e) => e["person_id"])).size).toBe(2);
    expect(new Set(entries.map((e) => e["project_id"])).size).toBe(4);
    // Each entry's client is its project's, as Adminium copies it.
    for (const e of entries) expect(e["client_id"]).toBe(byId("projects", e["project_id"])["client_id"]);
  });

  it("has 12 of its 65 hours on invoices already — two lines of sent stage invoices carry them", () => {
    expect(sum(entries, "hours")).toBe(65);
    expect(sum(entries.filter((e) => carried.has(e["id"])), "hours")).toBe(12);
    const carriers = all("invoice_lines").filter((l) => l["time_entry_id"] !== null && l["time_entry_id"] !== undefined);
    expect(carriers.map((l) => byId("invoices", l["document_id"])["number"]).sort()).toEqual(["INV-S2035", "INV-S2039"]);
    // Not yet invoiced: 53 hours, $6,625 at the day rate over six hours.
    expect(sum(entries.filter((e) => !carried.has(e["id"])), "hours")).toBe(53);
  });

  it("weighs heaviest on the bakehouse rebrand, and has no clock running", () => {
    const byProject = new Map<unknown, number>();
    for (const e of entries) byProject.set(e["project_id"], (byProject.get(e["project_id"]) ?? 0) + n(e["hours"]));
    const [heaviest] = [...byProject.entries()].sort((a, b) => b[1] - a[1]);
    expect([byId("projects", heaviest![0])["name"], heaviest![1]]).toEqual(["Bakehouse rebrand", 28]);
    expect(entries.every((e) => e["running_for"] === null && e["hours"] !== null)).toBe(true);
  });
});

describe("Expenses and Suppliers, at 28 July", () => {
  const expenses = all("expenses");
  const passed = new Set<unknown>(all("invoice_lines").map((l) => l["expense_id"]).filter((id) => id !== null && id !== undefined));

  it("has $762.90 to pass on, $300 passed on at cost, $29 the studio's own", () => {
    expect(sum(expenses.filter((e) => e["rebill"] === true && !passed.has(e["id"])), "amount")).toBe(762.9);
    expect(sum(expenses.filter((e) => passed.has(e["id"])), "amount")).toBe(300);
    expect(sum(expenses.filter((e) => e["rebill"] !== true), "amount")).toBe(29);
    // Passed on at cost: the line's rate is the purchase's cost, never marked up.
    const line = all("invoice_lines").find((l) => l["expense_id"] !== null && l["expense_id"] !== undefined)!;
    expect([byId("invoices", line["document_id"])["number"], n(line["rate"]), n(line["qty"])]).toEqual(["INV-S2031", 300, 1]);
  });

  it("numbers purchases and suppliers on the sample's own series, and names a supplier for each", () => {
    expect(expenses.map((e) => e["number"])).toEqual(["EX-S040", "EX-S041", "EX-S042", "EX-S043", "EX-S044", "EX-S045", "EX-S046"]);
    expect(all("suppliers").map((s) => s["number"])).toEqual(["SUP-S01", "SUP-S02", "SUP-S03", "SUP-S04", "SUP-S05", "SUP-S06", "SUP-S07"]);
    expect(expenses.every((e) => e["supplier_id"] !== null)).toBe(true);
    const spend = (name: string) => sum(expenses.filter((e) => byId("suppliers", e["supplier_id"])["name"] === name), "amount");
    expect([spend("Kestrel Press"), spend("Bell Type Foundry"), spend("Pike & Vane")]).toEqual([386.4, 420, 0]);
  });

  it("dates every purchase on or before the day it is added", () => {
    for (const e of expenses) expect(String(e["date"]) <= "2026-07-28").toBe(true);
  });
});

describe("Money, at 28 July", () => {
  it("costs $2,850 a month to open the door; the open invoices would cover about 2.4 months", () => {
    const costs = sum(all("running_costs"), "monthly_amount");
    expect(costs).toBe(2850);
    const open = sum(all("invoices").filter((i) => i["status"] === "sent" && n(i["balance"]) > 0), "balance");
    expect(Math.round((open / costs) * 10) / 10).toBe(2.4);
  });
});

describe("Schedule and Capacity, at 28 July", () => {
  it("has five studio dates ahead, Tomas away 10–12 August", () => {
    expect(all("events").map((e) => [e["date"], e["kind"]])).toEqual([
      ["2026-07-30", "press"],
      ["2026-08-03", "call"],
      ["2026-08-10", "away"],
      ["2026-08-24", "call"],
      ["2026-09-02", "press"],
    ]);
    const away = all("events").find((e) => e["kind"] === "away")!;
    expect([away["to_date"], byId("people", away["person_id"])["name"]]).toEqual(["2026-08-12", "Tomas Wilde"]);
  });

  it("estimates every open milestone, so each one places", () => {
    const open = all("milestones").filter((m) => m["state"] !== "done");
    expect(open.every((m) => n(m["estimated_days"]) > 0)).toBe(true);
    expect(sum(open, "estimated_days")).toBe(21.5);
  });

  it("works out a full week now, room from August, and Tomas's week short-handed", () => {
    const view = capacityWeeks({
      today: "2026-07-28",
      studioDaysPerWeek: n(all("settings")[0]!["days_per_week"]),
      people: all("people").map((p) => ({ id: p["id"] as Id, days_per_week: (p["days_per_week"] as number | null) ?? null })),
      projects: all("projects").map((p) => ({ id: p["id"] as Id, status: String(p["status"]), started_on: (p["started_on"] as string | null) ?? null })),
      milestones: all("milestones").map((m) => ({
        id: m["id"] as Id,
        project_id: m["project_id"] as Id,
        due_on: (m["due_on"] as string | null) ?? null,
        state: String(m["state"]),
        estimated_days: m["estimated_days"] === null || m["estimated_days"] === undefined ? null : String(m["estimated_days"]),
        position: n(m["position"]),
      })),
      events: all("events").map((e) => ({ date: String(e["date"]), to_date: (e["to_date"] as string | null) ?? null, kind: String(e["kind"]), person_id: (e["person_id"] as Id | null) ?? null })),
    });
    expect(view.unplaced).toEqual([]);
    expect(view.weeks.slice(0, 5).map((w) => [w.start, w.capacity, w.used, w.free])).toEqual([
      ["2026-07-27", 8, 9.61, 0],
      ["2026-08-03", 8, 5.14, 2.86],
      ["2026-08-10", 5, 3.67, 1.33],
      ["2026-08-17", 8, 2.08, 5.92],
      ["2026-08-24", 8, 1, 7],
    ]);
    expect(view.weeks).toHaveLength(13);
  });
});

describe("The scoping worksheet's history, at 28 July", () => {
  it("learns from five finished stages, estimated against the hours logged on them", () => {
    const settings = all("settings")[0]!;
    const past = pastStages({
      settings: { hours_per_day: n(settings["hours_per_day"]), days_per_week: n(settings["days_per_week"]) },
      milestones: all("milestones").map((m) => ({
        id: m["id"] as Id,
        project_id: m["project_id"] as Id,
        title: String(m["title"]),
        state: String(m["state"]) as "done",
        estimated_days: m["estimated_days"] === null || m["estimated_days"] === undefined ? null : String(m["estimated_days"]),
      })),
      time: all("time_entries").map((t) => ({ milestone_id: (t["milestone_id"] as Id | null) ?? null, hours: String(t["hours"]) })),
    });
    expect(past.map((p) => [p.title, p.quotedDays, p.actualDays])).toEqual([
      ["Discovery & audit", 1, 1.17],
      ["Logo direction", 2, 2.33],
      ["Pattern studies", 1.5, 1.5],
      ["Cup sizes & marks", 2, 1.67],
      ["Print handoff", 1, 0.92],
    ]);
  });
});
