/**
 * The brief: the studio's questions before the work starts, answered on the
 * client's own time. Answers are saved as they are typed (and kept — the
 * studio also keeps the first answer given), "Send it to the studio" sends
 * the brief once, and afterwards the page reads the answers back, with a way
 * to change one while the project runs.
 *
 * A client with more than one running project picks which project's brief.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, CloudUpload, ClipboardList, Send, SquarePen } from "lucide-react";

import { Alert, Button, Filters } from "../../components/ui.tsx";
import type { Id } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { saveBriefAnswer, sendBrief } from "../../state/clientActions.ts";
import { usePortal, usePortalRows } from "../../state/portal.ts";
import { toast, useUi } from "../../state/ui.ts";
import { createSaver, type SaverState } from "./brief/saver.ts";
import { Section, useClientRows } from "./shared/bits.tsx";
import { leadProject } from "./shared/model.ts";
import { sayRefusal, useSignedIn } from "./shared/page.ts";

export default function Brief() {
  const { t, number } = useI18n();
  const signedIn = useSignedIn();
  const me = usePortal((s) => s.me);
  const studio = usePortal((s) => s.studio);
  const preview = useUi((s) => s.preview !== null);
  const pickedProject = useUi((s) => s.selected.project);
  const rows = useClientRows();
  const answers = usePortalRows("brief_answers");

  const briefs = useMemo(() => rows.briefs.filter((b) => rows.projects.some((p) => p.id === b.project_id)).sort((a, b) => a.id - b.id), [rows]);
  const [chosen, setChosen] = useState<Id | null>(null);
  const brief = useMemo(() => {
    const byChoice = briefs.find((b) => b.id === chosen);
    if (byChoice !== undefined) return byChoice;
    const byProject = briefs.find((b) => b.project_id === pickedProject);
    if (byProject !== undefined) return byProject;
    const lead = leadProject(rows.projects.filter((p) => briefs.some((b) => b.project_id === p.id)));
    return briefs.find((b) => b.project_id === lead?.id) ?? briefs[0];
  }, [briefs, chosen, pickedProject, rows.projects]);
  const project = rows.projects.find((p) => p.id === brief?.project_id);
  const questions = useMemo(() => [...(studio?.briefQuestions ?? [])].sort((a, b) => a.position - b.position), [studio]);

  const [text, setText] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [saverState, setSaverState] = useState<SaverState>({ pending: 0, error: null, saved: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // What is stored, for the brief on show; what the client is typing wins while they type.
  const stored = useMemo(() => Object.fromEntries(answers.filter((a) => a.brief_id === brief?.id).map((a) => [a.question_key, a.answer ?? ""])), [answers, brief?.id]);
  useEffect(() => {
    setText({});
    setEditing(false);
    setError(null);
  }, [brief?.id]);
  const saver = useMemo(() => (brief === undefined ? null : createSaver((question, answer) => saveBriefAnswer(brief.id, question, answer), setSaverState)), [brief?.id]);
  useEffect(() => () => void saver?.flush(), [saver]);

  if (!signedIn || me === null) return null;

  const valueOf = (key: string) => text[key] ?? stored[key] ?? "";
  const filled = questions.filter((q) => valueOf(q.key).trim() !== "").length;
  const done = brief?.status === "sent" && !editing;
  const studioName = studio?.settings?.name ?? "";
  const saveError = saverState.error === null ? null : sayRefusal(t, saverState.error);

  if (brief === undefined) {
    return (
      <section className="screen ol-screen cl-page" data-screen="client-brief" aria-labelledby="cl-brief-title">
        <h1 className="cl-h1" id="cl-brief-title">
          {t("nav.brief")}
        </h1>
        <div className="cl-card cl-pad cl-subtle">{t("client.brief.none")}</div>
      </section>
    );
  }

  const send = async () => {
    if (busy) return;
    await saver?.flush();
    if (filled === 0) {
      toast(t("client.brief.answerOne"), { icon: "info" });
      return;
    }
    if (brief.status === "sent") {
      setEditing(false);
      return;
    }
    setBusy(true);
    const out = await sendBrief(brief.id);
    setBusy(false);
    if (out.ok) {
      setError(null);
      toast(t("client.brief.sentToast"), { icon: "check" });
      if (typeof window !== "undefined") window.scrollTo?.({ top: 0 });
      return;
    }
    setError(sayRefusal(t, out));
  };

  const chooser =
    briefs.length > 1 ? (
      <Filters
        label={t("client.brief.which")}
        value={String(brief.id)}
        onChange={(v) => setChosen(Number(v))}
        items={briefs.map((b) => ({ id: String(b.id), label: rows.projects.find((p) => p.id === b.project_id)?.name ?? "" }))}
      />
    ) : null;

  if (done) {
    return (
      <section className="screen ol-screen cl-page" data-screen="client-brief" aria-labelledby="cl-brief-title">
        {chooser}
        <div className="cl-card cl-brief-done">
          <span className="cl-done-badge" aria-hidden="true">
            <Check size={28} />
          </span>
          <h1 className="cl-h1 cl-h1--done" id="cl-brief-title">
            {t("client.brief.doneTitle")}
          </h1>
          <p className="cl-muted cl-body">{t("client.brief.doneBody")}</p>
          <Button icon={SquarePen} onClick={() => setEditing(true)}>
            {t("client.brief.change")}
          </Button>
        </div>
        <Section icon={ClipboardList} title={t("client.brief.told")} id="cl-brief-told">
          <dl className="cl-told">
            {questions.map((q) => {
              const value = valueOf(q.key).trim();
              return (
                <div key={q.key} className="cl-told-row">
                  <dt className="cl-label">{q.question}</dt>
                  <dd className={value === "" ? "cl-subtle" : "cl-told-answer"}>{value === "" ? t("client.brief.blank") : value}</dd>
                </div>
              );
            })}
          </dl>
        </Section>
      </section>
    );
  }

  return (
    <section className="screen ol-screen cl-page" data-screen="client-brief" aria-labelledby="cl-brief-title">
      {chooser}
      <div>
        <span className="cl-mono-kicker">{t("client.brief.kicker", { project: project?.name ?? "", company: me.company })}</span>
        <h1 className="cl-h1 cl-brief-title" id="cl-brief-title">
          {t("client.brief.title", { count: number(questions.length) }, questions.length)}
        </h1>
        <p className="cl-muted cl-lead cl-measure">{t("client.brief.lead")}</p>
      </div>

      <div className="cl-card cl-progress">
        <span className="cl-progress-text">{t("client.brief.progress", { n: number(filled), total: number(questions.length) })}</span>
        {saverState.saved && saverState.pending === 0 && saverState.error === null && (
          <span className="cl-saved" role="status">
            <CloudUpload size={12} aria-hidden="true" />
            {t("client.brief.saved")}
          </span>
        )}
        <span className="cl-bar cl-bar--thin" aria-hidden="true">
          <span className="cl-bar-fill" style={{ width: `${questions.length === 0 ? 0 : Math.round((filled / questions.length) * 100)}%` }} />
        </span>
      </div>
      {saveError !== null && <Alert>{saveError}</Alert>}

      {questions.map((q, i) => {
        const fieldId = `cl-brief-q-${q.key}`;
        const onChange = (value: string) => {
          setText((s) => ({ ...s, [q.key]: value }));
          if (!preview) saver?.change(q.key, value);
        };
        return (
          <section key={q.key} className="cl-card cl-pad cl-question">
            <span className="cl-question-head">
              <span className="cl-mono-small">{String(i + 1).padStart(2, "0")}</span>
              <span className="cl-question-text">
                <label className="cl-question-title" htmlFor={fieldId}>
                  {q.question}
                </label>
                {q.hint !== null && (
                  <span className="cl-subtle" id={`${fieldId}-hint`}>
                    {q.hint}
                  </span>
                )}
              </span>
            </span>
            {q.kind === "area" ? (
              <textarea id={fieldId} className="input ol-fld" rows={3} readOnly={preview} aria-describedby={q.hint !== null ? `${fieldId}-hint` : undefined} value={valueOf(q.key)} onChange={(e) => onChange(e.target.value)} onBlur={() => void saver?.flush()} />
            ) : (
              <input id={fieldId} className="input ol-fld" readOnly={preview} aria-describedby={q.hint !== null ? `${fieldId}-hint` : undefined} value={valueOf(q.key)} onChange={(e) => onChange(e.target.value)} onBlur={() => void saver?.flush()} />
            )}
          </section>
        );
      })}

      {error !== null && <Alert>{error}</Alert>}
      <button type="button" className="btn btn--primary ol-btn cl-btn-huge" disabled={busy} aria-busy={busy || undefined} onClick={() => void send()}>
        <Send size={17} aria-hidden="true" />
        {brief.status === "sent" ? t("client.brief.doneEditing") : t("client.brief.send", { studio: studioName })}
      </button>
      <p className="cl-fine">{t("client.brief.foot")}</p>
    </section>
  );
}
