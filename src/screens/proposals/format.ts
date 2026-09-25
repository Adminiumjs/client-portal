/**
 * A calendar day with its year, short ("30 Jun 2026"), in the page's
 * language — how the proposals list and a proposal's page date things.
 */
import type { Day } from "../../data/types.ts";

export function dayWithYear(day: Day | null | undefined, locale: string): string {
  if (day === null || day === undefined || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
