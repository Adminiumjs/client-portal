/**
 * Stop the clock, asking what Stop alone could not settle: a clock Adminium
 * found ran past sixteen hours (the hours are not guessed at — the person says
 * how many it really was), or a clock started with nothing said about what it
 * is on. Then the hours may be left empty: Adminium counts them from the
 * clock's start and stop. Hours typed here are the person's own figure. The
 * person may then start another.
 */
import { Square } from "lucide-react";
import { useState } from "react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, Field } from "../../components/ui.tsx";
import type { TimeEntry } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { instantLabel } from "../../lib/dates.ts";
import { studioZone } from "../../lib/clock.ts";
import { hoursProblem, stopClock } from "../../state/timeActions.ts";
import { toast } from "../../state/ui.ts";
import { hoursLabel, refusalWords, type Words } from "../../screens/time/words.ts";

export default function StopClock({ entry, why, company, onClose }: { entry: TimeEntry; why: Words; company: string; onClose: () => void }) {
  const { t, number, locale } = useI18n();
  // Past sixteen hours the clock's own count is refused: the hours must be typed.
  const [hoursNeeded, setHoursNeeded] = useState(why.key === "time.error.tooLong");
  const [draft, setDraft] = useState({ hours: "", note: entry.note ?? "" });
  const [error, setError] = useState<Words | null>(why);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const stop = async () => {
    const empty = draft.hours.trim() === "";
    const hours = empty ? (hoursNeeded ? "HOURS_OUT_OF_RANGE" : null) : hoursProblem(draft.hours);
    if (hours !== null) {
      setError({ key: hours === "HOURS_NOT_A_NUMBER" ? "time.error.hoursNumber" : "time.error.hours", field: "hours" });
      return;
    }
    if (draft.note.trim() === "") {
      setError({ key: "time.error.note", field: "note" });
      return;
    }
    setBusy(true);
    const out = await stopClock(entry.id, { ...(empty ? {} : { hours: draft.hours }), note: draft.note });
    setBusy(false);
    if (out.ok) {
      toast(t("time.clock.stopped", { hours: hoursLabel(t, number, out.value.hours), client: company }), { icon: "check", tone: "pos" });
      onClose();
      return;
    }
    const words = refusalWords(out);
    if (words.key === "time.error.tooLong") setHoursNeeded(true);
    setError(words);
  };

  const started = instantLabel(entry.started_at, studioZone(), locale, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <Sheet title={t("time.sheet.stop.title")} sub={company} icon={Square} onClose={onClose}>
      <form
        className="time-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void stop();
        }}
      >
        <p className="time-sheet-lead">{t(hoursNeeded ? "time.sheet.stop.lead" : "time.sheet.stop.leadClock", { time: started })}</p>
        <Field label={t("time.form.hours")} error={error?.field === "hours" ? t(error.key) : undefined}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input ol-fld money" inputMode="decimal" autoComplete="off" value={draft.hours} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set({ hours: e.target.value })} />
          )}
        </Field>
        <Field label={t("time.sheet.start.note")} error={error?.field === "note" ? t(error.key) : undefined}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input ol-fld" autoComplete="off" placeholder={t("time.form.note")} value={draft.note} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set({ note: e.target.value })} />
          )}
        </Field>
        {error !== null && error.field !== "hours" && error.field !== "note" && <Alert>{t(error.key, { name: "" })}</Alert>}
        <Button type="submit" kind="primary" size="wide" icon={Square} busy={busy}>
          {t("time.sheet.stop.save")}
        </Button>
      </form>
    </Sheet>
  );
}
