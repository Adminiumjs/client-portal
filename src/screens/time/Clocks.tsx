/**
 * The running clocks, at the top of the entries.
 *
 * A clock is a stored entry with no hours yet (its person in `running_for`,
 * its start Adminium's stamp), so it is the same on every computer and after
 * a reload. Each running clock is a row: whose it is, what it is on, when it
 * started, the time so far, and Stop. When the signed-in person has none
 * running (or the studio has none at all), a row offers Start.
 */
import { Play, Square } from "lucide-react";
import { useEffect, useState } from "react";

import type { Id, Person, TimeEntry } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { instantLabel } from "../../lib/dates.ts";
import { now, studioZone } from "../../lib/clock.ts";
import { elapsed } from "./model.ts";

export interface ClockView {
  entry: TimeEntry;
  person: Person | null;
  company: string | null;
  project: string | null;
}

/** The time so far, as the clock face shows it: 04:37, or 1:04:37 past the hour. */
export function useClockFace(): (startedAt: string | null) => string {
  const { number } = useI18n();
  const two = (n: number) => number(n, { minimumIntegerDigits: 2, useGrouping: false });
  return (startedAt) => {
    const { h, m, s } = elapsed(startedAt, now());
    return h > 0 ? `${number(h, { useGrouping: false })}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  };
}

export function Clocks({ clocks, me, busy, onStart, onStop }: { clocks: readonly ClockView[]; me: Person | null; busy: Id | "start" | null; onStart: () => void; onStop: (entry: TimeEntry) => void }) {
  const { t, locale } = useI18n();
  const face = useClockFace();
  // A running clock's face moves on each second; nothing ticks when none runs.
  const [, tick] = useState(0);
  useEffect(() => {
    if (clocks.length === 0) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [clocks.length]);

  const mine = me !== null && clocks.some((c) => c.entry.running_for === me.id);
  const title = (c: ClockView) => [c.company, c.project].filter((x) => x !== null && x !== "").join(" · ");
  return (
    <>
      {clocks.map((c) => {
        const started = instantLabel(c.entry.started_at, studioZone(), locale, { hour: "2-digit", minute: "2-digit" });
        const time = face(c.entry.started_at);
        return (
          <div key={c.entry.id} className="time-clock time-clock--on" data-clock={c.entry.id}>
            <span className="time-clock-dot" aria-hidden="true" />
            <span className="time-clock-words">
              <span className="time-clock-title">{title(c)}</span>
              <span className="time-clock-sub">{t("time.clock.runningSub", { name: c.person?.name ?? "", time: started })}</span>
            </span>
            <span className="time-clock-face" role="timer" aria-label={t("time.clock.elapsed", { time })}>
              {time}
            </span>
            <button type="button" className="time-clock-btn time-clock-btn--stop ol-btn" disabled={busy !== null} aria-busy={busy === c.entry.id || undefined} onClick={() => onStop(c.entry)}>
              <Square size={15} aria-hidden="true" />
              {t("time.clock.stop")}
            </button>
          </div>
        );
      })}
      {!mine && (
        <div className="time-clock" data-clock="idle">
          <span className="time-clock-dot" aria-hidden="true" />
          <span className="time-clock-words">
            <span className="time-clock-title">{clocks.length === 0 ? t("time.clock.nothing") : t("time.clock.yours")}</span>
            <span className="time-clock-sub">{t("time.clock.idleSub")}</span>
          </span>
          <span className="time-clock-face" aria-hidden="true">
            {face(null)}
          </span>
          <button type="button" className="time-clock-btn ol-btn" disabled={busy !== null} onClick={onStart}>
            <Play size={15} aria-hidden="true" />
            {t("time.clock.start")}
          </button>
        </div>
      )}
    </>
  );
}
