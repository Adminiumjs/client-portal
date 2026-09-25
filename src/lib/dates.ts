/**
 * Days and times on screen, in the page's language and on the studio's clock.
 *
 *   dayLabel       a calendar day ("Tue 28 Jul", "28 July 2026"): a day is
 *                  the studio's, so it is formatted as that day wherever the
 *                  reader is — never shifted by the reader's zone
 *   instantLabel   an instant, read on the studio's clock ("28 Jul, 11:04")
 *   daysLate       whole days a due day is behind today (0 when it is not)
 */
import type { Day, Instant } from "../data/types.ts";
import { daysBetween } from "../data/venueTime.ts";

export type DayStyle = "short" | "long" | "weekday";

const DAY_OPTIONS: Record<DayStyle, Intl.DateTimeFormatOptions> = {
  short: { day: "numeric", month: "short" },
  long: { day: "numeric", month: "long", year: "numeric" },
  weekday: { weekday: "short", day: "numeric", month: "short" },
};

/** A calendar day in the page's language. An empty day is an empty string. */
export function dayLabel(day: Day | null | undefined, locale: string, style: DayStyle = "short"): string {
  if (day === null || day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  // Noon UTC, formatted in UTC: the same calendar day in every zone.
  return new Intl.DateTimeFormat(locale, { ...DAY_OPTIONS[style], timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

/** An instant on the studio's clock, in the page's language. */
export function instantLabel(at: Instant | null | undefined, zone: string, locale: string, opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }): string {
  if (at === null || at === undefined) return "";
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? new Intl.DateTimeFormat(locale, { ...opts, timeZone: zone }).format(ms) : "";
}

/** Whole days `due` is behind `today`; 0 when it is today or later. */
export function daysLate(due: Day | null | undefined, today: Day): number {
  if (due === null || due === undefined) return 0;
  return Math.max(0, daysBetween(due, today));
}

/** The year of a day, for the footer's copyright. */
export const yearOf = (day: Day): number => Number(day.slice(0, 4));
