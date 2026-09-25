/**
 * "Add a date": something the studio has to be somewhere for — a call or a
 * meeting, a press check, or someone away (who, and until when). Milestones
 * and invoice dates arrive on their own; this is for everything else.
 *
 * One Adminium write under an action key (`addStudioDate`): an answer lost on
 * the way may have saved, so the sheet offers "Finish it" rather than a
 * second date. Refusals are worded here; the sheet stays open on one.
 */
import { useId, useState } from "react";
import { CalendarPlus } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../../components/ui.tsx";
import type { Day, Id, StudioEvent, StudioEventKind } from "../../data/types.ts";
import { useI18n, type MessageKey } from "../../i18n/index.tsx";
import { addStudioDate, type StudioDateInput } from "../../state/officeActions.ts";
import { useRows } from "../../state/desk.ts";
import { refusalKey, type Outcome, type Unfinished } from "../../state/outcome.ts";

export interface DatePrefill {
  date: Day;
  title?: string;
  kind?: StudioEventKind;
}

const KINDS: readonly StudioEventKind[] = ["call", "press", "away"];

type Problems = Partial<Record<"date" | "title" | "person" | "until", MessageKey>>;

/** What the person must fix before anything is sent. */
export function problemsOf(values: { date: string; title: string; kind: StudioEventKind; person: string; until: string }): Problems {
  const out: Problems = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) out.date = "schedule.sheet.error.date";
  if (values.title.trim() === "") out.title = "schedule.sheet.error.title";
  if (values.kind === "away" && values.person === "") out.person = "schedule.sheet.error.person";
  if (values.kind === "away" && values.until !== "" && /^\d{4}-\d{2}-\d{2}$/.test(values.date) && values.until < values.date) out.until = "schedule.sheet.error.until";
  return out;
}

/** What the sheet sends: an away day names who and, when given, its last day; the others neither. */
export function inputOf(values: { date: string; title: string; kind: StudioEventKind; person: string; until: string }): StudioDateInput {
  return {
    date: values.date,
    title: values.title,
    kind: values.kind,
    ...(values.kind === "away" ? { person_id: Number(values.person) as Id, to_date: values.until === "" ? null : values.until } : {}),
  };
}

/** The field a refusal's code points at, in this sheet's words. */
const BY_CODE: Record<string, { field: keyof Problems; key: MessageKey }> = {
  TITLE_REQUIRED: { field: "title", key: "schedule.sheet.error.title" },
  DATE_NOT_A_DAY: { field: "date", key: "schedule.sheet.error.date" },
  UNTIL_BEFORE_DATE: { field: "until", key: "schedule.sheet.error.until" },
  PERSON_REQUIRED: { field: "person", key: "schedule.sheet.error.person" },
};

export default function AddDate({ prefill, onClose, onSaved }: { prefill: DatePrefill; onClose: () => void; onSaved: (event: StudioEvent) => void }) {
  const { t } = useI18n();
  const base = useId();
  const people = useRows("people").sort((a, b) => a.position - b.position || a.id - b.id);
  const [date, setDate] = useState<string>(prefill.date);
  const [title, setTitle] = useState<string>(prefill.title ?? "");
  const [kind, setKind] = useState<StudioEventKind>(prefill.kind ?? "call");
  const [person, setPerson] = useState<string>("");
  const [until, setUntil] = useState<string>("");
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<{ field: keyof Problems | null; key: MessageKey } | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished<StudioEvent> | null>(null);

  const problems = shown ? problemsOf({ date, title, kind, person, until }) : {};
  const errorOf = (field: keyof Problems): string | undefined => {
    const key = problems[field] ?? (refused?.field === field ? refused.key : undefined);
    return key === undefined ? undefined : t(key);
  };
  const touched = () => setRefused(null);

  const finish = async (run: () => Promise<Outcome<StudioEvent>>) => {
    setBusy(true);
    const out = await run();
    setBusy(false);
    if (out.ok) {
      setUnfinished(null);
      onSaved(out.value);
      return;
    }
    setUnfinished(out.unfinished);
    const known = BY_CODE[out.code];
    setRefused(known !== undefined ? known : { field: null, key: refusalKey(out.reason) });
  };

  const submit = async () => {
    setShown(true);
    if (Object.keys(problemsOf({ date, title, kind, person, until })).length > 0) {
      setTimeout(() => document.querySelector<HTMLElement>('.sch-sheet [aria-invalid="true"]')?.focus(), 0);
      return;
    }
    await finish(() => addStudioDate(inputOf({ date, title, kind, person, until })));
  };

  const needsPeople = kind === "away" && people.length === 0;

  return (
    <Sheet title={t("schedule.sheet.title")} sub={t("schedule.sheet.sub")} icon={CalendarPlus} onClose={onClose}>
      <div className="add-body sch-sheet">
        <Field label={t("schedule.sheet.date")} error={errorOf("date")}>
          {({ id, describedBy, invalid }) => (
            <input id={id} type="date" className="input add-mono" value={date} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => (touched(), setDate(e.target.value))} />
          )}
        </Field>
        <Field label={t("schedule.sheet.what")} error={errorOf("title")}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input" value={title} placeholder={t("schedule.sheet.whatPh")} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => (touched(), setTitle(e.target.value))} />
          )}
        </Field>
        <Field label={t("schedule.sheet.kind")}>
          {({ id, describedBy }) => (
            <select id={id} className="input" value={kind} aria-describedby={describedBy} onChange={(e) => (touched(), setKind(e.target.value as StudioEventKind))}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t(`schedule.sheet.kind.${k}`)}
                </option>
              ))}
            </select>
          )}
        </Field>
        {kind === "away" && (
          <div className="add-pair" id={`${base}-away`}>
            <Field label={t("schedule.sheet.who")} error={errorOf("person")}>
              {({ id, describedBy, invalid }) => (
                <select id={id} className="input" value={person} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => (touched(), setPerson(e.target.value))}>
                  <option value="">{t("schedule.sheet.whoPick")}</option>
                  {people.map((p) => (
                    <option key={p.id} value={String(p.id)}>
                      {p.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label={t("schedule.sheet.until")} hint={t("schedule.sheet.untilHint")} error={errorOf("until")}>
              {({ id, describedBy, invalid }) => (
                <input id={id} type="date" className="input add-mono" value={until} min={date === "" ? undefined : date} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => (touched(), setUntil(e.target.value))} />
              )}
            </Field>
          </div>
        )}
        {needsPeople && <Alert tone="warn">{t("schedule.sheet.noPeople")}</Alert>}
        {refused !== null && refused.field === null && unfinished === null && <Alert>{t(refused.key, { id: "", balance: "" })}</Alert>}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void finish(() => unfinished.resume())} />}
        <Button kind="primary" size="wide" icon={CalendarPlus} busy={busy} disabled={unfinished !== null || needsPeople} className="add-submit" onClick={() => void submit()}>
          {t("schedule.sheet.button")}
        </Button>
        <p className="add-foot">{t("schedule.sheet.foot")}</p>
      </div>
    </Sheet>
  );
}
