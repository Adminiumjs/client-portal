/**
 * The studio's clock: what time it is, and what day, where the studio is.
 *
 * A real desk runs on the real time, read on the studio's zone (the one
 * Adminium keeps for the connection), so "today", "overdue" and "due in three
 * days" mean the same thing on every screen whatever zone the computer is set
 * to. The demo runs on a pinned Tuesday — 28 July 2026 — which the website's
 * card moves on a week at a time and puts back.
 */
import { venueDay, venueStamp, venueTime } from "../data/venueTime.ts";

/** The demo's morning: Tuesday 28 July 2026, 10:00 at the sample studio. */
export const DEMO_ZONE = "America/New_York";
export const DEMO_START = venueStamp("2026-07-28", "10:00", DEMO_ZONE);

let zone = "UTC";
let read: () => number = () => Date.now();
const listeners = new Set<() => void>();

/** The studio's zone, from the staff config or the public config. */
export function setZone(next: string): void {
  zone = next;
}
export const studioZone = (): string => zone;

/** Where "now" comes from: the real clock, or the demo's. */
export function setClockSource(source: () => number): void {
  read = source;
  listeners.forEach((l) => l());
}
export const now = (): number => read();
export const today = (): string => venueDay(read(), zone);
export const timeNow = (): string => venueTime(read(), zone);

/** Called when the demo's clock jumps, so screens re-read the time at once. */
export function onClockJump(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export const clockJumped = (): void => listeners.forEach((l) => l());

/** The demo's clock: the pinned morning plus the card's weeks. */
export function demoClock(): { now: () => number; advance: (minutes: number) => void; reset: () => void } {
  let at = DEMO_START;
  return {
    now: () => at,
    advance(minutes) {
      at += minutes * 60_000;
      clockJumped();
    },
    reset() {
      at = DEMO_START;
      clockJumped();
    },
  };
}
