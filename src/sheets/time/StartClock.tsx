/**
 * Start the clock: which project, whose clock, and what it is on. One entry
 * is saved with no hours yet; Adminium stamps when it started and keeps one
 * running clock a person, whichever computer started the first. The note is
 * asked now so the entry reads right when the clock stops.
 */
import { Play } from "lucide-react";
import { useState } from "react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../../components/ui.tsx";
import type { Id, Person, Project, TimeEntry } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import type { Unfinished } from "../../state/outcome.ts";
import { startClock } from "../../state/timeActions.ts";
import { toast } from "../../state/ui.ts";
import { refusalWords, type Words } from "../../screens/time/words.ts";

export default function StartClock({ projects, people, project, who, companyOf, onClose, onRefused }: { projects: readonly Project[]; people: readonly Person[]; project: Id | null; who: Id | null; companyOf: (project: Project | undefined) => string; onClose: () => void; onRefused?: () => void }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState({ project: project ?? projects[0]?.id ?? null, who: who ?? people[0]?.id ?? null, note: "" });
  const [error, setError] = useState<Words | null>(null);
  const [busy, setBusy] = useState(false);
  const [unfinished, setUnfinished] = useState<Unfinished<TimeEntry> | null>(null);
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const person = people.find((p) => p.id === draft.who) ?? null;

  const set = (patch: Partial<typeof draft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setError(null);
  };

  const finish = async (run: () => ReturnType<typeof startClock>) => {
    setBusy(true);
    const out = await run();
    setBusy(false);
    if (out.ok) {
      toast(t("time.clock.started", { client: companyOf(byProject.get(out.value.project_id)) }), { icon: "check", tone: "pos" });
      onClose();
      return;
    }
    setUnfinished(out.unfinished);
    const words = refusalWords(out);
    setError(words);
    // Someone's clock is already running: read the clocks again so it shows.
    if (out.reason === "duplicate") onRefused?.();
  };

  const start = () => {
    if (draft.note.trim() === "") {
      setError({ key: "time.error.note", field: "note" });
      return;
    }
    if (draft.project === null || draft.who === null) return;
    const input = { project_id: draft.project, person_id: draft.who, note: draft.note };
    void finish(() => startClock(input));
  };

  return (
    <Sheet title={t("time.sheet.start.title")} sub={person?.name} icon={Play} onClose={onClose}>
      <form
        className="time-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          start();
        }}
      >
        <Field label={t("time.form.project")}>
          {({ id }) => (
            <select id={id} className="input ol-fld" value={draft.project ?? ""} onChange={(e) => set({ project: Number(e.target.value) })}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {`${companyOf(p)} · ${p.name}`}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("time.form.who")}>
          {({ id }) => (
            <select id={id} className="input ol-fld" value={draft.who ?? ""} onChange={(e) => set({ who: Number(e.target.value) })}>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={t("time.sheet.start.note")} error={error?.field === "note" ? t(error.key) : undefined}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input ol-fld" autoComplete="off" placeholder={t("time.form.note")} value={draft.note} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set({ note: e.target.value })} />
          )}
        </Field>
        {error !== null && error.field !== "note" && <Alert>{t(error.key, { name: person?.name ?? "" })}</Alert>}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void finish(() => unfinished.resume())} />}
        <Button type="submit" kind="primary" size="wide" icon={Play} busy={busy} disabled={draft.project === null || draft.who === null}>
          {t("time.sheet.start.go")}
        </Button>
      </form>
    </Sheet>
  );
}
