/**
 * The rate card's day rate — one answer for every screen that needs it.
 *
 * The day rate is the rate that stands for one working day: an active rate
 * whose hours per unit are the studio's hours in a working day (the first
 * such, in the card's order). When no rate on the card is a whole day there
 * is no day rate: Time refuses to bill hours at a guess, and Scoping and
 * Capacity say nothing rather than work a day out of a half day or a print
 * check.
 */
import type { Decimal, Rate } from "../data/types.ts";

/** The same number of hours, however the stored decimal is spelled ("6", "6.00"). */
const sameHours = (perUnit: Decimal | number | null, hoursPerDay: number): boolean => perUnit !== null && String(perUnit).trim() !== "" && Number(perUnit) === hoursPerDay;

/** The day rate: the first active rate whose hours per unit are a working day; null when the card has none, or no working day is set. */
export function dayRateOf(rates: readonly Rate[], hoursPerDay: number | null | undefined): Rate | null {
  if (hoursPerDay === null || hoursPerDay === undefined || !(hoursPerDay > 0)) return null;
  return [...rates].filter((r) => r.active && sameHours(r.hours_per_unit, hoursPerDay)).sort((a, b) => a.position - b.position || a.id - b.id)[0] ?? null;
}
