/**
 * The client's Home: everything they have with the studio, on one page.
 *
 * What is waiting on them (or that nothing is), where the work is and what
 * happens next, every document with the one figure under it, the statement
 * and the brief, and who at the studio they are talking to.
 */
import { useMemo } from "react";
import { ArrowRight, ChevronRight, ClipboardList, Eye, FileText, Files, Footprints, FolderOpen, Hand, Mail, ReceiptText, ScrollText, CheckCheck, Banknote, PackageCheck, Dot } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Avatar, DayText, StatusPill } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { usePortal } from "../../state/portal.ts";
import { go, open, useUi } from "../../state/ui.ts";
import { documents, homeTotal, nextSteps, waitingOnYou, type Todo } from "./home/model.ts";
import { Section, useClientRows, useDay, useDueIn } from "./shared/bits.tsx";
import { dayOf, invoiceState, isOpen, leadProject, milestonesOf, nextMilestone, progress, proposalState } from "./shared/model.ts";
import { useSignedIn } from "./shared/page.ts";

function TodoRow({ todo }: { todo: Todo }) {
  const { t, money, number } = useI18n();
  const date = useDay();
  const questions = usePortal((s) => s.studio?.briefQuestions.length ?? 0);
  let icon: LucideIcon = Eye;
  let tone: "accent" | "danger" = "accent";
  let title = "";
  let body = "";
  let amount: string | null = null;
  let onOpen = () => {};
  switch (todo.kind) {
    case "invoice": {
      const inv = todo.invoice;
      icon = ReceiptText;
      tone = todo.overdue ? "danger" : "accent";
      title = todo.overdue ? t("client.home.todoLate", { id: inv.number ?? "", count: number(todo.days) }, todo.days) : t("client.home.todoPay", { id: inv.number ?? "" });
      body = t(todo.overdue ? "client.home.todoPayLateBody" : "client.home.todoPayBody", { title: inv.title ?? "", date: date(inv.due_on) });
      amount = money(inv.balance, inv.currency);
      onOpen = () => open("invoice", inv.id);
      break;
    }
    case "proposal": {
      const p = todo.proposal;
      icon = FileText;
      title = t("client.home.todoDecide", { id: p.number ?? p.title });
      body = t("client.home.todoDecideBody", { title: p.title, date: date(p.valid_until, "long") });
      amount = money(p.total, p.currency);
      onOpen = () => open("proposal", p.id);
      break;
    }
    case "review": {
      icon = Eye;
      title = t("client.home.todoLook", { file: todo.file === "" ? todo.deliverable.title : todo.file });
      body = t("client.home.todoLookBody", { title: todo.file === "" ? (todo.project?.name ?? "") : todo.deliverable.title, date: date(todo.sharedOn, "long") });
      onOpen = () => open("review", todo.deliverable.id);
      break;
    }
    case "brief": {
      icon = ClipboardList;
      title = t("client.home.todoBrief", { count: number(questions) }, questions);
      body = t("client.home.briefFor", { project: todo.project.name });
      onOpen = () => {
        useUi.setState((s) => ({ selected: { ...s.selected, project: todo.project.id } }));
        go("brief");
      };
      break;
    }
  }
  const Icon = icon;
  return (
    <div role="listitem">
      <button type="button" className="cl-todo ol-row" onClick={onOpen}>
        <span className={`cl-badge cl-badge--${tone}`} aria-hidden="true">
          <Icon size={16} />
        </span>
        <span className="cl-todo-main">
          <span className="cl-todo-title">{title}</span>
          <span className="cl-todo-body">{body}</span>
        </span>
        {amount !== null && <span className={`cl-todo-amount money cl-tone-${tone}`}>{amount}</span>}
        <ChevronRight size={16} aria-hidden="true" className="cl-chevron" />
      </button>
    </div>
  );
}

export default function Home() {
  const { t, money, number } = useI18n();
  const signedIn = useSignedIn();
  const me = usePortal((s) => s.me);
  const studio = usePortal((s) => s.studio);
  const rows = useClientRows();
  const dueIn = useDueIn();
  const date = useDay();

  const todo = useMemo(() => waitingOnYou(rows), [rows]);
  const docs = useMemo(() => documents(rows), [rows]);
  const total = useMemo(() => homeTotal(rows), [rows]);
  const steps = useMemo(() => nextSteps(rows), [rows]);
  const project = useMemo(() => leadProject(rows.projects), [rows]);
  const brief = useMemo(() => {
    const running = rows.briefs.filter((b) => rows.projects.some((p) => p.id === b.project_id));
    return running.find((b) => b.project_id === project?.id) ?? running[0];
  }, [rows, project]);

  if (!signedIn || me === null) return null;
  const name = studio?.settings?.name ?? "";
  const ms = project === undefined ? [] : milestonesOf(rows.milestones, project.id);
  const pct = progress(ms);
  const next = nextMilestone(ms);
  const people = [...(studio?.people ?? [])].sort((a, b) => a.position - b.position);
  const replyTo = studio?.settings?.reply_to ?? null;

  return (
    <section className="screen ol-screen cl-page" data-screen="client-home" aria-labelledby="cl-home-title">
      <div className="cl-home-head">
        <Avatar name={me.company} size={52} />
        <span className="cl-home-who">
          <h1 className="cl-h1" id="cl-home-title">
            {me.company}
          </h1>
          <span className="cl-muted">{t("client.home.meta", { contact: me.contact_name, studio: name })}</span>
        </span>
      </div>

      {todo.length > 0 ? (
        <Section icon={Hand} title={t("client.home.waiting")} end={<span className="cl-mono-count">{t("client.home.things", { count: number(todo.length) }, todo.length)}</span>} id="cl-home-todo" className="cl-section--accent-icon">
          <div role="list">
            {todo.map((item) => (
              <TodoRow key={item.key} todo={item} />
            ))}
          </div>
        </Section>
      ) : (
        <div className="cl-note cl-note--pos" role="status">
          <CheckCheck size={19} aria-hidden="true" />
          <span>{t("client.home.allClear")}</span>
        </div>
      )}

      {project !== undefined && (
        <Section icon={FolderOpen} title={t("client.home.workTitle")} end={<StatusPill status={project.status} />} id="cl-home-work">
          <div className="cl-pad cl-stack">
            <div className="cl-work">
              <span className="cl-work-main">
                <span className="cl-work-title">{project.name}</span>
                <span className="cl-muted cl-small">
                  {project.status === "paused" ? (
                    next === undefined ? t("status.paused") : t("client.home.pausedNext", { milestone: next.title })
                  ) : next !== undefined ? (
                    t("client.home.next", { milestone: next.title, due: dueIn(next.due_on) })
                  ) : (
                    t("client.home.delivered", { date: date(project.done_on ?? ms[ms.length - 1]?.due_on ?? null, "long") })
                  )}
                </span>
              </span>
              <span className="cl-work-pct money">{number(pct / 100, { style: "percent" })}</span>
            </div>
            <div className="cl-bar" aria-hidden="true">
              <span className={`cl-bar-fill${project.status === "paused" ? " cl-bar-fill--warn" : ""}`} style={{ width: `${pct}%` }} />
            </div>
            <button type="button" className="btn ol-gi cl-btn-block" onClick={() => open("project", project.id)}>
              <ArrowRight size={16} aria-hidden="true" />
              {t("client.home.openProject")}
            </button>
          </div>
        </Section>
      )}

      {steps.length > 0 && (
        <Section icon={Footprints} title={t("client.home.nextTitle")} id="cl-home-next">
          <ol className="cl-steps">
            {steps.map((step) => {
              if (step.kind === "milestone") {
                return (
                  <li key={step.key} className="cl-step">
                    <span className={`cl-step-dot${step.first ? " cl-step-dot--now" : ""}`} aria-hidden="true">
                      {step.first ? <Dot size={11} /> : <ChevronRight size={11} />}
                    </span>
                    <span className="cl-step-head">
                      <span className="cl-step-title">{step.milestone.title}</span>
                      <DayText day={step.milestone.due_on} style="long" />
                    </span>
                    <span className="cl-step-body">{step.first ? t("client.home.stepNow", { date: date(step.milestone.due_on) }) : t("client.home.stepLater")}</span>
                  </li>
                );
              }
              if (step.kind === "invoice") {
                const inv = step.invoice;
                return (
                  <li key={step.key} className="cl-step">
                    <span className={`cl-step-dot${step.overdue ? " cl-step-dot--danger" : ""}`} aria-hidden="true">
                      <Banknote size={11} />
                    </span>
                    <span className="cl-step-head">
                      <span className="cl-step-title">{t("client.home.stepDue", { amount: money(inv.balance, inv.currency) })}</span>
                      <DayText day={inv.due_on} style="long" />
                    </span>
                    <span className="cl-step-body">{step.overdue ? t("client.home.stepLate", { id: inv.number ?? "", count: number(step.days) }, step.days) : t("client.home.stepPay", { id: inv.number ?? "" })}</span>
                  </li>
                );
              }
              return (
                <li key={step.key} className="cl-step">
                  <span className="cl-step-dot" aria-hidden="true">
                    <PackageCheck size={11} />
                  </span>
                  <span className="cl-step-head">
                    <span className="cl-step-title">{t("client.home.handover")}</span>
                    <span className="when">{t("client.home.handoverWhen")}</span>
                  </span>
                  <span className="cl-step-body">{t("client.home.handoverBody")}</span>
                </li>
              );
            })}
          </ol>
        </Section>
      )}

      <Section icon={Files} title={t("client.home.docs")} end={<span className="cl-mono-count">{t("client.home.docCount", { count: number(docs.length) }, docs.length)}</span>} id="cl-home-docs">
        <div role="list">
          {docs.map((doc) => {
            if (doc.kind === "invoice") {
              const inv = doc.invoice;
              const state = invoiceState(inv, rows.today);
              const open_ = isOpen(inv);
              return (
                <div role="listitem" key={doc.key}>
                  <button type="button" className="cl-doc ol-row" onClick={() => open("invoice", inv.id)}>
                    <ReceiptText size={16} aria-hidden="true" className="cl-doc-icon" />
                    <span className="cl-doc-title">{inv.title ?? inv.number}</span>
                    <span className={`cl-doc-amount money${state === "overdue" ? " cl-tone-danger" : open_ ? "" : " cl-tone-subtle"}`}>{money(open_ ? inv.balance : inv.total, inv.currency)}</span>
                    <span className="cl-doc-meta">
                      {inv.number}
                      {" · "}
                      {state === "void" ? t("client.home.metaVoid") : open_ ? t("client.home.metaDue", { date: date(inv.due_on) }) : t("client.home.metaPaid", { date: date(doc.settledOn ?? inv.due_on) })}
                    </span>
                    <span className="cl-doc-pill">
                      <StatusPill status={state} />
                    </span>
                  </button>
                </div>
              );
            }
            const p = doc.proposal;
            return (
              <div role="listitem" key={doc.key}>
                <button type="button" className="cl-doc ol-row" onClick={() => open("proposal", p.id)}>
                  <FileText size={16} aria-hidden="true" className="cl-doc-icon" />
                  <span className="cl-doc-title">{p.title}</span>
                  <span className="cl-doc-amount money cl-tone-muted">{money(p.total, p.currency)}</span>
                  <span className="cl-doc-meta">
                    {p.number}
                    {p.sent_at !== null && ` · ${t("client.home.metaSent", { date: date(dayOf(p.sent_at, rows.zone)) })}`}
                  </span>
                  <span className="cl-doc-pill">
                    <StatusPill status={proposalState(p, rows.today)} />
                  </span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="cl-total">
          <span className="cl-total-label">{t(total.kind === "open" ? "client.home.openBalance" : "client.home.paidToDate")}</span>
          <span className={`cl-total-value money${total.overdue ? " cl-tone-danger" : ""}`}>{money(total.value, total.currency)}</span>
        </div>
      </Section>

      <div className="cl-links">
        <button type="button" className="cl-link-card ol-gi" onClick={() => go("statement")}>
          <ScrollText size={17} aria-hidden="true" className="cl-accent" />
          <span className="cl-link-card-text">
            <span className="cl-link-card-title">{t("client.home.statementLink")}</span>
            <span className="cl-link-card-body">{t("client.home.statementBody")}</span>
          </span>
          <ChevronRight size={15} aria-hidden="true" className="cl-chevron" />
        </button>
        {brief !== undefined && (
          <button
            type="button"
            className="cl-link-card ol-gi"
            onClick={() => {
              useUi.setState((s) => ({ selected: { ...s.selected, project: brief.project_id } }));
              go("brief");
            }}
          >
            <ClipboardList size={17} aria-hidden="true" className="cl-accent" />
            <span className="cl-link-card-text">
              <span className="cl-link-card-title">{t(brief.status === "sent" ? "client.home.briefSent" : "client.home.briefFill")}</span>
              <span className="cl-link-card-body">
                {brief.status === "sent" ? t("client.home.briefSentBody") : t("client.home.briefFillBody", { count: number(studio?.briefQuestions.length ?? 0) }, studio?.briefQuestions.length ?? 0)}
              </span>
            </span>
            <ChevronRight size={15} aria-hidden="true" className="cl-chevron" />
          </button>
        )}
      </div>

      <section className="cl-card cl-pad cl-stack" aria-labelledby="cl-home-people">
        <h2 className="cl-label" id="cl-home-people">
          {t("client.home.people")}
        </h2>
        {people.length > 0 && (
          <ul className="cl-people">
            {people.map((person) => (
              <li key={person.name} className="cl-person">
                <Avatar name={person.name} size={32} />
                <span className="cl-person-text">
                  <span className="cl-person-name">{person.name}</span>
                  {person.role_label !== null && <span className="cl-person-role">{person.role_label}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {replyTo !== null && (
          <a className="btn ol-gi cl-btn-block" href={`mailto:${replyTo}`}>
            <Mail size={16} aria-hidden="true" />
            {t("client.home.emailUs")}
          </a>
        )}
      </section>
    </section>
  );
}
