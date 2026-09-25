/**
 * Which month the Schedule shows and which day is open, kept beside the
 * screen so another screen (Capacity's "Hold the week") can open it at a
 * month. Null month: the studio's current one.
 */
import { create } from "zustand";

import type { Day } from "../../data/types.ts";

export interface ScheduleView {
  /** `YYYY-MM`; null for the current month. */
  month: string | null;
  /** The day whose panel is open. */
  day: Day | null;
}

export const useScheduleView = create<ScheduleView>(() => ({ month: null, day: null }));

/** Show a month, with a day open (or none). */
export function showDay(day: Day | null, month?: string): void {
  useScheduleView.setState({ month: month ?? (day === null ? null : day.slice(0, 7)), day });
}
