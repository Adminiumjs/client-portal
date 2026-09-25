/**
 * Capacity — "Can we take this?" — worked out from the studio's own rows,
 * week by week, from the current week on.
 *
 *   capacity  each person's days a week (`people.days_per_week`, else the
 *             studio's `settings.days_per_week`), less the weekdays they are
 *             away (`events` of kind away, `date` to `to_date`, for that
 *             person) and the public holidays (Holiday calendars' days, when
 *             the add-on is attached) — never below none
 *   used      every open milestone of a project not finished, its
 *             `estimated_days` spread EVENLY over its working days (Monday
 *             to Friday) from the day after the milestone before it was due
 *             (or the project's start) to its own due date — never before
 *             today. A milestone already late puts all its days on this week;
 *             one with no due date or no estimate cannot be placed and is
 *             listed apart
 *   free      capacity less used, never below none
 *
 * Which weekday a four-day person takes off is not recorded, so an away day
 * or a holiday on any weekday takes one of their days: the answer errs on
 * the side of saying no.
 *
 * Pure: the screen hands it the rows it read.
 */
import type { Day, Id } from "../data/types.ts";
import { addDays, daysBetween, weekday } from "../data/venueTime.ts";

export interface CapacityInputs {
  today: Day;
  /** How many weeks to show (13: a quarter). */
  weeks?: number;
  studioDaysPerWeek: number;
  people: readonly { id: Id; days_per_week: number | null }[];
  projects: readonly { id: Id; status: string; started_on: Day | null }[];
  milestones: readonly { id: Id; project_id: Id; due_on: Day | null; state: string; estimated_days: string | null; position: number }[];
  events: readonly { date: Day; to_date: Day | null; kind: string; person_id: Id | null }[];
  /** Public holidays, when Holiday calendars is attached. */
  holidays?: readonly Day[];
}

export interface CapacityWeek {
  /** The week's Monday. */
  start: Day;
  capacity: number;
  used: number;
  free: number;
  /** Person-days away this week. */
  away: number;
  /** Public holidays on weekdays this week. */
  holidays: number;
  /** What fills it: each milestone's share of this week, in days. */
  filledBy: { milestoneId: Id; days: number }[];
}

export interface CapacityView {
  weeks: CapacityWeek[];
  /** Open milestones that could not be placed: no due date, or no estimate. */
  unplaced: Id[];
}

const isWeekday = (day: Day): boolean => {
  const w = weekday(day);
  return w >= 1 && w <= 5;
};

/** The Monday of the week a day is in. */
export function mondayOf(day: Day): Day {
  const w = weekday(day);
  return addDays(day, w === 0 ? -6 : 1 - w);
}

/** Every day from `from` to `to`, both included. */
function daysFrom(from: Day, to: Day): Day[] {
  const out: Day[] = [];
  for (let day = from; day <= to && out.length < 3700; day = addDays(day, 1)) out.push(day);
  return out;
}

const round = (n: number): number => Math.round(n * 100) / 100;

export function capacityWeeks(inputs: CapacityInputs): CapacityView {
  const count = inputs.weeks ?? 13;
  const first = mondayOf(inputs.today);
  const starts = Array.from({ length: count }, (_, i) => addDays(first, i * 7));
  const last = addDays(first, count * 7 - 1);
  const indexOf = (day: Day): number | null => (day < first || day > last ? null : Math.floor(daysBetween(first, day) / 7));
  const holidays = new Set((inputs.holidays ?? []).filter(isWeekday));

  const weeks: CapacityWeek[] = starts.map((start) => {
    const days = daysFrom(start, addDays(start, 6)).filter(isWeekday);
    const holidayCount = days.filter((d) => holidays.has(d)).length;
    let capacity = 0;
    let away = 0;
    for (const person of inputs.people) {
      const own = person.days_per_week ?? inputs.studioDaysPerWeek;
      const awayDays = days.filter(
        (d) =>
          !holidays.has(d) &&
          inputs.events.some((e) => e.kind === "away" && e.person_id === person.id && d >= e.date && d <= (e.to_date ?? e.date)),
      ).length;
      away += Math.min(own, awayDays);
      capacity += Math.max(0, own - awayDays - holidayCount);
    }
    return { start, capacity, used: 0, free: 0, away, holidays: holidayCount, filledBy: [] };
  });

  const unplaced: Id[] = [];
  const open = new Set(inputs.projects.filter((p) => p.status !== "done").map((p) => p.id));
  const byProject = new Map<Id, CapacityInputs["milestones"][number][]>();
  for (const m of inputs.milestones) byProject.set(m.project_id, [...(byProject.get(m.project_id) ?? []), m]);
  for (const [projectId, list] of byProject) {
    if (!open.has(projectId)) continue;
    const project = inputs.projects.find((p) => p.id === projectId);
    const ordered = [...list].sort((a, b) => a.position - b.position);
    ordered.forEach((m, i) => {
      if (m.state === "done") return;
      const estimate = Number(m.estimated_days ?? "");
      if (m.due_on === null || !Number.isFinite(estimate) || estimate <= 0) {
        unplaced.push(m.id);
        return;
      }
      const before = ordered.slice(0, i).reverse().find((x) => x.due_on !== null)?.due_on ?? null;
      let from = before !== null ? addDays(before, 1) : (project?.started_on ?? inputs.today);
      if (from < inputs.today) from = inputs.today;
      const working = m.due_on < inputs.today ? [] : daysFrom(from, m.due_on).filter(isWeekday);
      const place = (day: Day, days: number) => {
        const at = indexOf(day);
        if (at === null) return;
        const week = weeks[at]!;
        week.used += days;
        const found = week.filledBy.find((f) => f.milestoneId === m.id);
        if (found === undefined) week.filledBy.push({ milestoneId: m.id, days });
        else found.days += days;
      };
      // Late, or due before a working day comes: all of it is this week's.
      if (working.length === 0) place(inputs.today, estimate);
      else for (const day of working) place(day, estimate / working.length);
    });
  }

  for (const week of weeks) {
    week.used = round(week.used);
    week.free = round(Math.max(0, week.capacity - week.used));
    week.filledBy = week.filledBy.map((f) => ({ ...f, days: round(f.days) }));
  }
  return { weeks, unplaced };
}
