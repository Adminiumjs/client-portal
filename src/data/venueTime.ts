/**
 * The studio's clock: days and times in the studio's own time zone.
 *
 * An invoice is "due on Friday where the studio is", whatever zone the reader
 * happens to be in. So every "today", "overdue" and "due in 3 days" is worked
 * out here, in the studio's zone (the zone Adminium keeps on the connection).
 *
 * Days are calendar arithmetic on `YYYY-MM-DD`, never "now + n × 24 h", which
 * drifts by an hour across a daylight-saving change.
 */

/** `YYYY-MM-DD` of an instant, on the venue's calendar. */
export function venueDay(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `HH:MM` (24-hour) of an instant, on the venue's clock. */
export function venueTime(ms: number, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(ms);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('hour')}:${get('minute')}`;
}

/** The calendar day `n` days after `day`. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + n));
  return next.toISOString().slice(0, 10);
}

/** Minutes the zone is ahead of UTC at an instant. */
function offsetAt(ms: number, timeZone?: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(ms);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

/** The instant a venue-local wall time happens: `day` at `time` (`HH:MM`). */
export function venueStamp(day: string, time: string, timeZone?: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const [hh, mm] = time.split(':').map(Number) as [number, number];
  const wall = Date.UTC(y, m - 1, d, hh, mm);
  // Guess with the offset at the wall time read as UTC, then correct once with the offset there.
  const first = wall - offsetAt(wall, timeZone) * 60_000;
  return wall - offsetAt(first, timeZone) * 60_000;
}

/** The instant a venue-local day starts, as an ISO string. */
export function venueMidnight(day: string, timeZone?: string): string {
  return new Date(venueStamp(day, '00:00', timeZone)).toISOString();
}

/** Day of the week (0 = Sunday) of a calendar day. */
export function weekday(day: string): number {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  const at = (day: string) => {
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86_400_000);
}

/**
 * The zone Adminium's server keeps its clock in. A SQLite source has no zone:
 * a timestamp comes back as the server's wall time (`2026-09-25 01:00:00`),
 * and a desk in another zone that read it as its own was hours out. Set at
 * boot from the staff config's `serverTimezone`; unset, a wall time is read
 * on this device's clock, as before.
 */
let serverZone: string | null = null;
export function setServerZone(zone: string | null): void {
  serverZone = zone;
}

/**
 * The calendar day a DATE column's value names: the day it spells. Adminium
 * hands a date out as `YYYY-MM-DD` on every engine, and a day has no clock, so
 * it is never read through a zone — the studio's, the server's or this
 * device's. The desk and a client's page, in any zone, show the same day. A
 * value that goes on past its day (a time written after it) names the day it
 * starts with.
 */
export function dateOf(value: string): string | null {
  return /^(\d{4}-\d{2}-\d{2})(?:$|[T ])/.exec(value)?.[1] ?? null;
}

const WALL = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?$/;

/** The instant a row's timestamp denotes: an ISO instant as it is, a bare wall time on the server's clock. */
export function instant(value: string): number {
  const m = WALL.exec(value);
  if (m === null || serverZone === null) return Date.parse(value);
  return venueStamp(m[1]!, m[2]!, serverZone) + Number(m[3] ?? 0) * 1000 + Number((m[4] ?? '0').padEnd(3, '0'));
}
