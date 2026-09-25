/**
 * Log time, in the entries' own card: the project, the hours, who, the day
 * and the milestone (today and the one under way unless changed), and what
 * the hours went on. One entry is saved (its client is copied from the
 * project by Adminium); the desk checks the hours and the note first, and
 * Adminium checks them again.
 */
import { Check } from "lucide-react";
import { useId, useMemo, useState } from "react";

import { Button, UnfinishedLine } from "../../components/ui.tsx";
import type { Day, Id, Milestone, Person, Project, TimeEntry } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { today } from "../../lib/clock.ts";
import { useDesk } from "../../state/desk.ts";
import type { Unfinished } from "../../state/outcome.ts";
import { currentMilestone, hoursProblem, logTime } from "../../state/timeActions.ts";
import { toast } from "../../state/ui.ts";
import { milestonesOf } from "./model.ts";
import { hoursLabel, refusalWords, type TimeField, type Words } from "./words.ts";

export interface LogDraft {
  project: Id | null;
  hours: string;
  who: Id | null;
  date: Day;
  /** Undefined: the project's milestone under way. */
  milestone?: Id | null;
  note: string;
}

/** What the form checks before anything is sent (Adminium checks it all again). */
export function logProblem(draft: LogDraft, day: Day): Words | null {
  // Nothing typed reads as no hours at all: outside the range, as the design says.
  const hours = draft.hours.trim() === "" ? "HOURS_OUT_OF_RANGE" : hoursProblem(draft.hours);
  if (hours !== null) return { key: hours === "HOURS_NOT_A_NUMBER" ? "time.error.hoursNumber" : "time.error.hours", field: "hours" };
  if (draft.note.trim() === "") return { key: "time.error.note", field: "note" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date > day) return { key: "time.error.date", field: "date" };
  return null;
}

export function LogForm({ projects, people, initial, companyOf, onClose }: { projects: readonly Project[]; people: readonly Person[]; initial: LogDraft; companyOf: (project: Project | undefined) => string; onClose: () => void }) {
  const { t, number } = useI18n();
  const ids = useId();
  const day = today();
  const [draft, setDraft] = useState<LogDraft>(initial);
  const [error, setError] = useState<Words | null>(null);
  const [busy, setBusy] = useState(false);
  const [unfinished, setUnfinished] = useState<Unfinished<TimeEntry> | null>(null);
  const milestoneRows = useDesk((s) => s.rows.milestones);
  const milestones: Milestone[] = useMemo(() => (draft.project === null ? [] : milestonesOf(Object.values(milestoneRows), draft.project)), [milestoneRows, draft.project]);
  const shownMilestone = draft.milestone !== undefined ? draft.milestone : draft.project === null ? null : (currentMilestone(draft.project)?.id ?? null);

  const set = (patch: Partial<LogDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };
  const byProject = new Map(projects.map((p) => [p.id, p]));

  const finish = async (run: () => ReturnType<typeof logTime>) => {
    setBusy(true);
    const out = await run();
    setBusy(false);
    if (out.ok) {
      const entry = out.value;
      toast(t("time.form.saved", { hours: hoursLabel(t, number, entry.hours ?? draft.hours), client: companyOf(byProject.get(entry.project_id)) }), { icon: "check", tone: "pos" });
      onClose();
      return;
    }
    setUnfinished(out.unfinished);
    setError(refusalWords(out));
  };

  const save = () => {
    const problem = logProblem(draft, day);
    if (problem !== null) {
      setError(problem);
      return;
    }
    if (draft.project === null || draft.who === null) return;
    const input = { project_id: draft.project, person_id: draft.who, hours: draft.hours, note: draft.note, date: draft.date, ...(draft.milestone === undefined ? {} : { milestone_id: draft.milestone }) };
    void finish(() => logTime(input));
  };

  const errorId = `${ids}-error`;
  const aria = (field: TimeField) => (error !== null && error.field === field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {});

  return (
    <form
      className="time-form"
      noValidate
      aria-label={t("time.log")}
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div className="time-form-grid">
        <label className="time-field">
          <span className="time-field-label">{t("time.form.project")}</span>
          <select className="time-input ol-fld" value={draft.project ?? ""} onChange={(e) => set({ project: Number(e.target.value), milestone: undefined })}>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {`${companyOf(p)} · ${p.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="time-field">
          <span className="time-field-label">{t("time.form.hours")}</span>
          <input className="time-input time-input--mono ol-fld" inputMode="decimal" autoComplete="off" placeholder={number(2.5)} value={draft.hours} onChange={(e) => set({ hours: e.target.value })} {...aria("hours")} />
        </label>
        <label className="time-field">
          <span className="time-field-label">{t("time.form.who")}</span>
          <select className="time-input ol-fld" value={draft.who ?? ""} onChange={(e) => set({ who: Number(e.target.value) })}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="time-form-grid time-form-grid--two">
        <label className="time-field">
          <span className="time-field-label">{t("time.form.milestone")}</span>
          <select className="time-input ol-fld" value={shownMilestone ?? ""} disabled={milestones.length === 0} onChange={(e) => set({ milestone: e.target.value === "" ? null : Number(e.target.value) })}>
            <option value="">{t("time.form.noMilestone")}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </select>
        </label>
        <label className="time-field">
          <span className="time-field-label">{t("time.form.date")}</span>
          <input type="date" className="time-input time-input--mono ol-fld" max={day} value={draft.date} onChange={(e) => set({ date: e.target.value })} {...aria("date")} />
        </label>
      </div>
      <input className="time-input ol-fld" autoComplete="off" aria-label={t("time.form.note")} placeholder={t("time.form.note")} value={draft.note} onChange={(e) => set({ note: e.target.value })} {...aria("note")} />
      {error !== null && (
        <span className="time-form-error" id={errorId} role="alert">
          {t(error.key, { name: "" })}
        </span>
      )}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void finish(() => unfinished.resume())} />}
      <div className="time-form-actions">
        <Button type="submit" kind="primary" icon={Check} busy={busy}>
          {t("time.form.save")}
        </Button>
        <Button onClick={onClose}>{t("common.cancel")}</Button>
      </div>
    </form>
  );
}
