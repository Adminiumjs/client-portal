/**
 * The progress ring of a project: a track, the done share in the project's
 * tone (paused waits, finished is good, the rest is the studio's accent), and
 * the percentage in the middle. The percentage is worked out from the
 * milestones (`model.ts`), never stored.
 */
import { useI18n } from "../../i18n/index.tsx";
import { ringDash } from "./model.ts";

export function Ring({ pct, tone, size, label }: { pct: number; tone: "warn" | "pos" | "accent"; size: "small" | "big"; label: string }) {
  const { number } = useI18n();
  return (
    <span className={`prj-ring prj-ring--${size}`} role="img" aria-label={label}>
      <svg viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15.5" fill="none" className="prj-ring-track" strokeWidth={size === "big" ? 2.6 : 3} />
        <circle cx="18" cy="18" r="15.5" fill="none" className={`prj-ring-fill prj-ring-fill--${tone}`} strokeWidth={size === "big" ? 2.6 : 3} strokeLinecap="round" strokeDasharray={ringDash(pct)} />
      </svg>
      <span className="prj-ring-pct" aria-hidden="true">
        {number(pct)}%
      </span>
    </span>
  );
}
