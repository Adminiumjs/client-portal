/**
 * Capacity's rule, week by week: each person's days less their away days and
 * the public holidays; each open milestone's estimate spread evenly over its
 * working days from the one before it to its own due date, never before
 * today; a late one all on this week.
 */
import { describe, expect, it } from "vitest";

import { capacityWeeks, mondayOf, type CapacityInputs } from "./capacity.ts";

// Tuesday 28 July 2026: the week starts Monday 27 July.
const base: CapacityInputs = {
  today: "2026-07-28",
  weeks: 4,
  studioDaysPerWeek: 4,
  people: [
    { id: 1, days_per_week: null },
    { id: 2, days_per_week: 3 },
  ],
  projects: [{ id: 1, status: "active", started_on: "2026-07-01" }],
  milestones: [],
  events: [],
};

describe("capacity", () => {
  it("starts on this week's Monday", () => {
    expect(mondayOf("2026-07-28")).toBe("2026-07-27");
    expect(mondayOf("2026-08-02")).toBe("2026-07-27");
    expect(capacityWeeks(base).weeks.map((w) => w.start)).toEqual(["2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17"]);
  });

  it("counts each person's own days a week, else the studio's", () => {
    expect(capacityWeeks(base).weeks.map((w) => w.capacity)).toEqual([7, 7, 7, 7]);
  });

  it("takes away days off the person away, and public holidays off everyone", () => {
    const view = capacityWeeks({
      ...base,
      events: [
        { date: "2026-08-10", to_date: "2026-08-12", kind: "away", person_id: 2 },
        // A call takes no one's day; nor does a weekend.
        { date: "2026-08-11", to_date: null, kind: "call", person_id: 1 },
        { date: "2026-08-15", to_date: "2026-08-16", kind: "away", person_id: 1 },
      ],
      holidays: ["2026-08-03", "2026-08-09"],
    });
    expect(view.weeks.map((w) => [w.capacity, w.away, w.holidays])).toEqual([
      [7, 0, 0],
      [5, 0, 1],
      [4, 3, 0],
      [7, 0, 0],
    ]);
  });

  it("spreads a milestone's estimate evenly over its working days, from the milestone before it, never before today", () => {
    const view = capacityWeeks({
      ...base,
      milestones: [
        { id: 10, project_id: 1, due_on: "2026-07-24", state: "done", estimated_days: "2", position: 0 },
        // From today (not the 25th) to Friday 7 August: 9 working days, 4.5 days of work.
        { id: 11, project_id: 1, due_on: "2026-08-07", state: "now", estimated_days: "4.5", position: 1 },
        // From Saturday 8 August to Friday 14 August: 5 working days, 1 day of work.
        { id: 12, project_id: 1, due_on: "2026-08-14", state: "next", estimated_days: "1", position: 2 },
      ],
    });
    expect(view.weeks.map((w) => w.used)).toEqual([2, 2.5, 1, 0]);
    expect(view.weeks.map((w) => w.free)).toEqual([5, 4.5, 6, 7]);
    expect(view.weeks[1]!.filledBy).toEqual([{ milestoneId: 11, days: 2.5 }]);
  });

  it("puts a late milestone's days on this week, and lists what it cannot place", () => {
    const view = capacityWeeks({
      ...base,
      projects: [...base.projects, { id: 2, status: "done", started_on: "2026-05-01" }],
      milestones: [
        { id: 20, project_id: 1, due_on: "2026-07-20", state: "now", estimated_days: "3", position: 0 },
        { id: 21, project_id: 1, due_on: null, state: "next", estimated_days: "2", position: 1 },
        { id: 22, project_id: 1, due_on: "2026-08-20", state: "next", estimated_days: null, position: 2 },
        // A finished project's open milestone is not the studio's work any more.
        { id: 23, project_id: 2, due_on: "2026-08-05", state: "now", estimated_days: "5", position: 0 },
      ],
    });
    expect(view.weeks[0]!.used).toBe(3);
    expect(view.unplaced).toEqual([21, 22]);
    expect(view.weeks.slice(1).every((w) => w.used === 0)).toBe(true);
  });
});
