/**
 * "Can we take this?" over the sample the app ships, at 28 July 2026: the
 * weeks, the answer for each size of job, the proposal still out counted as
 * booked, what fills the weeks, and the squares each week draws. Calendar
 * arithmetic only — the same in every zone the tests run in.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { resolveSample, type SampleBundleRows } from "../../data/sampleRows.ts";
import type { Enquiry, Id, Proposal, ProposalLine, Rate } from "../../data/types.ts";
import { capacityWeeks } from "../../state/capacity.ts";
import { dayRate, enquiriesAsking, fitOf, loadBefore, proposalDays, squaresOf, startFloor, weekRows, type OutProposal } from "./model.ts";

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;
const rows = resolveSample(bundle, { now: Date.parse("2026-07-28T14:00:00Z"), zone: "America/New_York", locale: "en-US", currency: "USD" });
const all = (t: string) => rows[t]!;
const TODAY = "2026-07-28";

const people = all("people").map((p) => ({ id: p["id"] as Id, days_per_week: (p["days_per_week"] as number | null) ?? null }));
const projects = all("projects").map((p) => ({ id: p["id"] as Id, status: String(p["status"]), started_on: (p["started_on"] as string | null) ?? null, client_id: p["client_id"] as Id, number: p["number"] as string }));
const milestones = all("milestones").map((m) => ({
  id: m["id"] as Id,
  project_id: m["project_id"] as Id,
  title: String(m["title"]),
  due_on: (m["due_on"] as string | null) ?? null,
  state: String(m["state"]),
  estimated_days: m["estimated_days"] === null || m["estimated_days"] === undefined ? null : String(m["estimated_days"]),
  position: Number(m["position"]),
}));
const events = all("events").map((e) => ({ id: e["id"] as Id, date: String(e["date"]), to_date: (e["to_date"] as string | null) ?? null, title: String(e["title"]), kind: String(e["kind"]), person_id: (e["person_id"] as Id | null) ?? null }));
const rates = all("rates") as unknown as Rate[];
const proposals = all("proposals") as unknown as Proposal[];
const lines = all("proposal_lines") as unknown as ProposalLine[];

const view = (holidays: string[] = []) => capacityWeeks({ today: TODAY, studioDaysPerWeek: 4, people, projects, milestones, events, holidays });
const quo1142 = proposals.find((p) => p.number === "QUO-S1142")!;
const out: OutProposal[] = [{ id: quo1142.id, number: quo1142.number, days: proposalDays(quo1142, lines.filter((l) => l.document_id === quo1142.id), rates, 6)! }];

describe("the sample's weeks, at 28 July", () => {
  const weeks = weekRows(view(), 8, out, false);

  it("has the figures the data layer works out: a full week now, room from August, Tomas's week short-handed", () => {
    expect(weeks.slice(0, 5).map((w) => [w.start, w.capacity, w.used, w.open])).toEqual([
      ["2026-07-27", 8, 9.61, 0],
      ["2026-08-03", 8, 5.14, 2.86],
      ["2026-08-10", 5, 3.67, 1.33],
      ["2026-08-17", 8, 2.08, 5.92],
      ["2026-08-24", 8, 1, 7],
    ]);
    expect(weeks).toHaveLength(13);
    expect(Math.round(weeks.reduce((s, w) => s + w.open, 0))).toBe(81);
  });

  it("answers each size: small from 3 August, medium and large from 17 August", () => {
    const at = (fit: { start: number; end: number } | null) => (fit === null ? null : [weeks[fit.start]!.start, weeks[fit.end]!.start]);
    expect(at(fitOf(weeks, 3))).toEqual(["2026-08-03", "2026-08-10"]);
    expect(at(fitOf(weeks, 8))).toEqual(["2026-08-17", "2026-08-24"]);
    expect(at(fitOf(weeks, 16))).toEqual(["2026-08-17", "2026-08-31"]);
    expect([startFloor(3), startFloor(8), startFloor(16), startFloor(1)]).toEqual([2, 4, 4, 1]);
  });

  it("says no when the quarter has nothing long enough", () => {
    expect(fitOf(weeks, 200)).toBeNull();
  });

  it("draws each week as eight squares: used, open, and dashed for Tomas's days away", () => {
    expect(squaresOf(weeks[0]!)).toEqual(Array(8).fill("used"));
    expect(squaresOf(weeks[2]!)).toEqual(["used", "used", "used", "used", "open", "none", "none", "none"]);
    expect(squaresOf(weeks[4]!)).toEqual(["used", ...Array(7).fill("open")]);
  });
});

describe("the proposal still out", () => {
  it("is QUO-S1142, 5 studio days: its lines name no rate, so its subtotal over the day rate", () => {
    expect(dayRate(rates, 6)).toBe(750);
    expect(out).toEqual([{ id: quo1142.id, number: "QUO-S1142", days: 5 }]);
  });

  it("counts a proposal's hours when every line is named after a rate with hours", () => {
    const named = [
      { description: "Day rate, design", qty: "3" },
      { description: "half day", qty: "2" },
    ];
    expect(proposalDays({ subtotal: "9999", total: null }, named, rates, 6)).toBe(4);
    expect(proposalDays({ subtotal: null, total: null }, [], rates, 6)).toBeNull();
    expect(proposalDays({ subtotal: "100", total: null }, [], rates, 6)).toBe(1);
  });

  it("counted as booked, from the fourth week, four days at most a week — which moves the medium answer to 24 August", () => {
    const booked = weekRows(view(), 8, out, true);
    expect(booked.map((w) => w.held)).toEqual([0, 0, 0, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(booked[3]!.heldFor).toEqual([quo1142.id]);
    expect(squaresOf(booked[3]!)).toEqual(["used", "used", "held", "held", "held", "held", "open", "open"]);
    const fit = fitOf(booked, 8)!;
    expect([booked[fit.start]!.start, booked[fit.end]!.start]).toEqual(["2026-08-24", "2026-08-31"]);
  });
});

describe("public holidays", () => {
  it("take a day from everyone that week, and the answer moves with them", () => {
    const weeks = weekRows(view(["2026-08-18", "2026-08-19"]), 8, [], false);
    expect([weeks[3]!.capacity, weeks[3]!.holidays]).toEqual([4, 2]);
    expect(squaresOf(weeks[3]!).filter((s) => s === "none")).toHaveLength(4);
  });
});

describe("who is asking, and what fills the weeks", () => {
  it("asks for the newest three open enquiries that are not a poor fit", () => {
    expect(enquiriesAsking(all("enquiries") as unknown as Enquiry[]).map((e) => e.name)).toEqual(["Rosa Vento", "Kit Alderman", "Priya Raval"]);
  });

  it("lists the milestones and dates between today and the start, the away stretch once", () => {
    const load = loadBefore({ today: TODAY, projects, milestones, events }, "2026-08-17");
    expect(load.map((l) => [l.day, l.kind, l.title, l.to])).toEqual([
      ["2026-07-29", "now", "Wordmark refinement", null],
      ["2026-07-30", "press", "Press check — Fold & Rule", null],
      ["2026-07-31", "now", "Box & sleeve layouts", null],
      ["2026-08-03", "call", "Call with Rosa Vento", null],
      ["2026-08-07", "milestone", "Label marks", null],
      ["2026-08-10", "away", "Tomas away", "2026-08-12"],
      ["2026-08-14", "milestone", "Packaging application", null],
    ]);
  });
});
