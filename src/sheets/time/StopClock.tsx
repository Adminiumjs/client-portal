/**
 * Stop the clock, asking what Stop alone could not settle: a clock left
 * running past sixteen hours (the hours are not guessed at — the person says
 * how many it really was), or a clock started with nothing said about what it
 * is on. The entry gets its hours and note, and the person is free to start
 * another.
 */
import { Square } from "lucide-react";
import { useState } from "react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, Field } from "../../components/ui.tsx";
import type { TimeEntry } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { instantLabel } from "../../lib/dates.ts";
import { studioZone } from "../../lib/clock.ts";
import { clockHours, hoursProblem, stopClock } from "../../state/timeActions.ts";
import { toast } from "../../state/ui.ts";
import { hoursLabel, refusalWords, type Words } from "../../screens/time/words.ts";

export default function StopClock({ entry, why, company, onClose }: { entry: TimeEntry; why: Words; company: string; onClose: () => void }) {
  const { t, number, locale } = useI18n();
  const proposed = why.key === "time.error.tooLong" ? "" : (clockHours(entry) ?? "");
  const [draft, setDraft] = useState({ hours: proposed, note: entry.note ?? "" });
  const [error, setError] = useState<Words | null>(why);
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const stop = async () => {
    const hours = draft.hours.trim() === "" ? "HOURS_OUT_OF_RANGE" : hoursProblem(draft.hours);
    if (hours !== null) {
      setError({ key: hours === "HOURS_NOT_A_NUMBER" ? "time.error.hoursNumber" : "time.error.hours", field: "hours" });
      return;
    }
    if (draft.note.trim() === "") {
      setError({ key: "time.error.note", field: "note" });
      return;
    }
    setBusy(true);
    const out = await stopClock(entry.id, { hours: draft.hours, note: draft.note });
    setBusy(false);
    if (out.ok) {
      toast(t("time.clock.stopped", { hours: hoursLabel(t, number, out.value.hours), client: company }), { icon: "check", tone: "pos" });
      onClose();
      return;
    }
    setError(refusalWords(out));
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
        <p className="time-sheet-lead">{t("time.sheet.stop.lead", { time: started })}</p>
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
