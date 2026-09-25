/**
 * One project: its number, state and the Status menu (Pause…, Resume, Mark
 * done…, and Reopen for a studio manager), its name and where it stands, the
 * pause note, the progress ring; then the milestones (tick one done, un-tick
 * it, edit them), the deliverables (open one's review, share one not shared
 * yet, add one), the client's brief, and the ways on: preview it as the
 * client, the handover page, invoicing the next stage, and each invoice.
 *
 * Every change is one of the desk's actions; the page shows what Adminium
 * saved. The ring and "{done} of {n}" are worked out, never stored.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  CircleCheck,
  ClipboardList,
  Eye,
  Milestone as MilestoneIcon,
  PackageCheck,
  Paperclip,
  Pause,
  Play,
  Plus,
  ReceiptText,
  RotateCcw,
  Share2,
  type LucideIcon,
} from "lucide-react";

import type { Deliverable, Id, Milestone, Project as ProjectRow } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { today } from "../lib/clock.ts";
import { Button, Empty, StatusPill } from "../components/ui.tsx";
import { moveProject, setMilestoneState, shareDeliverable } from "../state/actions.ts";
import { loadProject, useCan, useDesk, useManager, useRow, useRows } from "../state/desk.ts";
import { refusalKey, type Outcome } from "../state/outcome.ts";
import { previewClient } from "../state/preview.ts";
import { openSheet } from "../state/sheets.ts";
import { go, open, toast, useUi } from "../state/ui.ts";
import { DeliverableIcon, tileStyle } from "./project/DeliverableIcon.tsx";
import { briefRows, cardDate, daysUntil, deliverablePill, deliverablesOf, doneCount, firstName, invoiceChips, milestonesOf, nextMilestone, progress, ringTone, stageLeft } from "./project/model.ts";
import { markProjectDone, reopenedState } from "./project/moves.ts";
import { Popover } from "./project/Popover.tsx";
import { Ring } from "./project/Ring.tsx";
import { versionsOf } from "./review/model.ts";
import { useFileInfo } from "./review/files.ts";

type Pop = null | "pause" | "done" | { untick: Id };

export default function Project() {
  const { t, number, locale, money } = useI18n();
  const id = useUi((s) => s.selected.project);
  const project = useRow("projects", id);
  const client = useRow("clients", project?.client_id);
  const proposal = useRow("proposals", project?.proposal_id);
  const allMilestones = useRows("milestones");
  const allDeliverables = useRows("deliverables");
  const versions = useRows("deliverable_versions");
  const invoices = useRows("invoices");
  const briefs = useRows("briefs");
  const answers = useRows("brief_answers");
  const questions = useRows("brief_questions");
  const manager = useManager();
  const canEdit = useCan("projects", "update");
  const canAddMilestone = useCan("milestones", "create");
  const canTick = useCan("milestones", "update");
  const canAddDeliverable = useCan("deliverables", "create");
  const canShare = useCan("deliverables", "update");
  const load = useDesk((s) => s.load);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (id === null) return;
    setLoaded(false);
    void loadProject(id).finally(() => setLoaded(true));
  }, [id]);

  const milestones = useMemo(() => (id === null ? [] : milestonesOf(allMilestones, id)), [allMilestones, id]);
  const deliverables = useMemo(() => (id === null ? [] : deliverablesOf(allDeliverables, id)), [allDeliverables, id]);

  if (project === undefined || id === null) {
    return (
      <section className="screen ol-screen" data-screen="project" aria-labelledby="project-title">
        <BackToProjects />
        <h1 className="ol-sr-only" id="project-title">
          {t("nav.project")}
        </h1>
        {(id === null || loaded || load === "failed") && <Empty title={t("projects.page.missing")} body={t("projects.page.missingBody")} />}
      </section>
    );
  }

  const first = firstName(client?.contact_name);
  const pct = progress(milestones);
  const next = nextMilestone(milestones);
  const brief = briefs.find((b) => b.project_id === project.id);
  const briefIn = brief?.status === "sent";
  const rows = briefRows(brief, answers, questions);
  const activeQuestions = questions.filter((q) => q.active).length;
  const chips = invoiceChips(invoices, project.id);
  const canNextStage = stageLeft(project, proposal, invoices);
  const meta = [
    client?.company ?? "",
    project.started_on === null ? null : t("projects.page.started", { day: dayLabel(project.started_on, locale, "long") }),
    t("projects.card.milestones", { done: number(doneCount(milestones)), total: number(milestones.length) }, milestones.length),
    next?.due_on == null ? null : t("projects.page.nextDue", { day: dayLabel(next.due_on, locale) }),
  ].filter((part): part is string => part !== null && part !== "");

  const preview = (view: "project" | "brief") => void previewClient(project.client_id, "project", view);

  return (
    <section className="screen ol-screen prj-page" data-screen="project" aria-labelledby="project-title">
      <BackToProjects />

      <div className="prj-hero card">
        <div className="prj-hero-main">
          <div className="prj-hero-line">
            <span className="prj-number">{project.number ?? t("projects.noNumber")}</span>
            <StatusPill status={project.status} />
            {canEdit && <StatusMenu project={project} milestones={milestones} manager={manager} first={first} />}
          </div>
          <h1 className="prj-title" id="project-title">
            {project.name}
          </h1>
          <p className="prj-meta">{meta.join(" · ")}</p>
          {project.status === "paused" && project.pause_note !== null && project.pause_note !== "" && (
            <div className="prj-note">
              <Pause size={14} aria-hidden="true" />
              <span>{project.pause_note}</span>
            </div>
          )}
        </div>
        <Ring pct={pct} tone={ringTone(project, pct)} size="big" label={t("projects.ring", { pct: number(pct) })} />
      </div>

      <div className="prj-cols">
        <section className="prj-panel card" aria-labelledby="prj-ms-title">
          <div className="prj-panel-head">
            <MilestoneIcon size={15} aria-hidden="true" />
            <h2 id="prj-ms-title">{t("projects.milestones.title")}</h2>
            {canAddMilestone && (
              <Button size="small" icon={Plus} className="prj-head-btn" onClick={() => openSheet({ kind: "add", what: "milestone", about: { projectId: project.id } })}>
                {t("projects.milestones.add")}
              </Button>
            )}
          </div>
          {milestones.length === 0 ? (
            <p className="prj-panel-empty">{t("projects.milestones.empty")}</p>
          ) : (
            <MilestoneList milestones={milestones} projectId={project.id} canTick={canTick} />
          )}
        </section>

        <section className="prj-panel card" aria-labelledby="prj-dv-title">
          <div className="prj-panel-head">
            <Paperclip size={15} aria-hidden="true" />
            <h2 id="prj-dv-title">{t("projects.deliverables.title")}</h2>
            {canAddDeliverable && (
              <Button size="small" icon={Plus} className="prj-head-btn" onClick={() => openSheet({ kind: "deliverable", projectId: project.id })}>
                {t("projects.deliverables.add")}
              </Button>
            )}
          </div>
          <div className="prj-dv-grid">
            {deliverables.map((d) => (
              <DeliverableCard key={d.id} deliverable={d} newest={versionsOf(versions, d.id).at(-1)?.file ?? versionsOf(versions, d.id).at(-1)?.link ?? null} tint={client?.tint ?? null} first={first} canShare={canShare} />
            ))}
            {deliverables.length === 0 && <div className="prj-dv-empty">{t("projects.deliverables.empty")}</div>}
          </div>
        </section>

        <section className="prj-panel card" aria-labelledby="prj-brief-title">
          <div className="prj-panel-head">
            <ClipboardList size={15} aria-hidden="true" />
            <h2 id="prj-brief-title">{t("projects.brief.title")}</h2>
            <span className={`pill prj-brief-pill${briefIn ? " pill--pos" : ""}`}>{t(briefIn ? "projects.brief.in" : "projects.brief.out")}</span>
          </div>
          {briefIn ? (
            <dl className="prj-brief">
              {rows.length === 0 ? (
                <div className="prj-brief-row">
                  <dt>{t("projects.brief.emptyTitle")}</dt>
                  <dd className="prj-brief-quiet">{t("projects.brief.emptyBody")}</dd>
                </div>
              ) : (
                rows.map((row) => (
                  <div key={row.key} className="prj-brief-row">
                    <dt>{row.question}</dt>
                    <dd>{row.answer}</dd>
                  </div>
                ))
              )}
            </dl>
          ) : (
            <div className="prj-brief-out">
              <p>{t("projects.brief.waiting", { count: number(activeQuestions) }, activeQuestions)}</p>
              <Button icon={Eye} className="prj-brief-see" onClick={() => preview("brief")}>
                {t("projects.brief.see")}
              </Button>
            </div>
          )}
        </section>
      </div>

      <div className="prj-actions">
        <Button icon={Eye} onClick={() => preview("project")}>
          {t("projects.page.preview")}
        </Button>
        <Button icon={PackageCheck} onClick={() => open("handover", project.id)}>
          {t("projects.page.handover")}
        </Button>
        {canNextStage && (
          <Button icon={ReceiptText} onClick={() => openSheet({ kind: "nextStage", projectId: project.id })}>
            {t("projects.page.nextStage")}
          </Button>
        )}
        {chips.map((chip) => (
          <Button key={chip.id} icon={ReceiptText} onClick={() => open("invoice", chip.id)} data-invoice={chip.id}>
            {chip.kind === "open"
              ? t("projects.page.invoiceOpen", { number: chip.number ?? t("projects.noNumber"), amount: money(chip.balance, chip.currency) })
              : t(INVOICE_WORD[chip.kind], { number: chip.number ?? "" })}
          </Button>
        ))}
      </div>
    </section>
  );
}

const INVOICE_WORD: Record<"paid" | "void" | "draft", MessageKey> = { paid: "projects.page.invoicePaid", void: "projects.page.invoiceVoid", draft: "projects.page.invoiceDraft" };

function BackToProjects() {
  const { t } = useI18n();
  return (
    <button type="button" className="prj-back ol-gi" onClick={() => go("projects")}>
      <ArrowLeft size={14} aria-hidden="true" />
      {t("projects.page.back")}
    </button>
  );
}

/** Say a refused save in words, as a toast. */
function refused(t: ReturnType<typeof useI18n>["t"], out: Outcome<unknown>): void {
  if (out.ok) return;
  toast(t(refusalKey(out.reason), { id: "" }), { icon: "circle-alert", tone: "danger" });
}

// ── the Status menu and its two popovers ────────────────────────────────────

interface MenuItem {
  key: string;
  label: string;
  icon: LucideIcon;
  run: () => void;
}

function StatusMenu({ project, milestones, manager, first }: { project: ProjectRow; milestones: readonly Milestone[]; manager: boolean; first: string }) {
  const { t } = useI18n();
  const [menu, setMenu] = useState(false);
  const [pop, setPop] = useState<Pop>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const number = project.number ?? t("projects.noNumber");

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      if (wrap.current !== null && event.target instanceof Node && !wrap.current.contains(event.target)) setMenu(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenu(false);
        button.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    wrap.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const move = async (kind: "resume" | "reopen") => {
    setMenu(false);
    const out = await moveProject(project.id, kind);
    if (!out.ok) return refused(t, out);
    toast(kind === "resume" ? t("projects.status.resumed", { id: number, first }) : t("projects.status.reopened", { id: number }), { icon: kind === "resume" ? "play" : "rotate-ccw" });
  };

  const items: MenuItem[] = [];
  if (project.status === "active") items.push({ key: "pause", label: t("projects.status.pause"), icon: Pause, run: () => openPop("pause") });
  if (project.status === "paused") items.push({ key: "resume", label: t("projects.status.resume"), icon: Play, run: () => void move("resume") });
  if (project.status !== "done") items.push({ key: "done", label: t("projects.status.done"), icon: CircleCheck, run: () => openPop("done") });
  if (project.status === "done" && manager) items.push({ key: "reopen", label: t("projects.status.reopen"), icon: RotateCcw, run: () => void move("reopen") });

  function openPop(kind: "pause" | "done") {
    setMenu(false);
    setNote("");
    setError(null);
    setPop(kind);
  }

  const submitPause = async () => {
    if (note.trim() === "") {
      setError(t("projects.pause.needNote"));
      return;
    }
    setBusy(true);
    const out = await moveProject(project.id, "pause", note);
    setBusy(false);
    if (!out.ok) return setError(t(refusalKey(out.reason), { id: number }));
    setPop(null);
    toast(t("projects.pause.done", { id: number }), { icon: "pause" });
  };

  const submitDone = async () => {
    setBusy(true);
    const out = await markProjectDone(project.id, milestones);
    setBusy(false);
    if (!out.ok) return setError(t(refusalKey(out.reason), { id: number }));
    setPop(null);
    toast(t("projects.markDone.done", { id: number }), { icon: "circle-check" });
  };

  if (items.length === 0) return null;
  return (
    <span className="prj-status" ref={wrap}>
      <button ref={button} type="button" className="prj-status-btn ol-gi" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
        {t("projects.status.menu")}
        <ChevronDown size={13} aria-hidden="true" />
      </button>
      {menu && (
        <div className="prj-menu" role="menu" aria-label={t("projects.status.menu")} onKeyDown={(e) => menuKeys(e)}>
          {items.map((item) => (
            <button key={item.key} type="button" role="menuitem" className="prj-menu-item ol-gi" tabIndex={-1} onClick={item.run} data-move={item.key}>
              <item.icon size={14} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>
      )}
      {pop === "pause" && (
        <Popover title={t("projects.pause.title", { id: number })} sub={t("projects.pause.sub", { first })} action={t("projects.pause.action")} actionIcon={Pause} busy={busy} onSubmit={() => void submitPause()} onClose={() => setPop(null)}>
          <label className="prj-pop-field">
            <span className="prj-pop-label">{t("projects.pause.label")}</span>
            <textarea
              className="input"
              rows={3}
              value={note}
              maxLength={500}
              placeholder={t("projects.pause.placeholder")}
              aria-invalid={error !== null}
              aria-describedby={error === null ? undefined : "prj-pause-error"}
              onChange={(e) => {
                setNote(e.target.value);
                setError(null);
              }}
            />
          </label>
          {error !== null && (
            <span className="prj-pop-error" id="prj-pause-error" role="alert">
              {error}
            </span>
          )}
        </Popover>
      )}
      {pop === "done" && (
        <Popover title={t("projects.markDone.title", { id: number })} sub={t("projects.markDone.sub")} action={t("projects.markDone.action")} actionIcon={CircleCheck} busy={busy} onSubmit={() => void submitDone()} onClose={() => setPop(null)}>
          {error !== null && (
            <span className="prj-pop-error" role="alert">
              {error}
            </span>
          )}
        </Popover>
      )}
    </span>
  );
}

/** Arrow keys move through a menu's items; Home and End jump. */
function menuKeys(event: React.KeyboardEvent<HTMLDivElement>): void {
  const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  const at = items.indexOf(document.activeElement as HTMLElement);
  const to = event.key === "ArrowDown" ? (at + 1) % items.length : event.key === "ArrowUp" ? (at - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
  if (to === null) return;
  event.preventDefault();
  items[to]?.focus();
}

// ── milestones ──────────────────────────────────────────────────────────────

function MilestoneList({ milestones, projectId, canTick }: { milestones: readonly Milestone[]; projectId: Id; canTick: boolean }) {
  const { t, locale, number } = useI18n();
  const [pop, setPop] = useState<Pop>(null);
  const [busy, setBusy] = useState(false);
  const day = today();

  const tick = async (m: Milestone) => {
    const out = await setMilestoneState(m.id, "done");
    if (!out.ok) return refused(t, out);
    toast(t("projects.milestones.ticked", { title: m.title }), { icon: "check" });
  };
  const untick = async (m: Milestone) => {
    setBusy(true);
    const out = await setMilestoneState(m.id, reopenedState(m, milestones));
    setBusy(false);
    if (!out.ok) return refused(t, out);
    setPop(null);
    toast(t("projects.milestones.unticked", { title: m.title }), { icon: "rotate-ccw" });
  };

  const stateLine = (m: Milestone): string => {
    if (m.state === "done") return t("projects.milestones.done");
    const when = m.due_on === null ? null : dueWords(daysUntil(m.due_on, day));
    const lead = t(m.state === "now" ? "projects.milestones.now" : "projects.milestones.next");
    return when === null ? lead : `${lead} · ${when}`;
  };
  const dueWords = (days: number): string =>
    days === 0 ? t("projects.due.today") : days > 0 ? t("projects.due.inDays", { count: number(days) }, days) : t("projects.due.ago", { count: number(-days) }, -days);

  return (
    <div className="prj-ms">
      <span className="prj-ms-line" aria-hidden="true" />
      <ol className="prj-ms-list">
        {milestones.map((m) => {
          const done = m.state === "done";
          const markerClass = `prj-ms-marker prj-ms-marker--${m.state}`;
          return (
            <li key={m.id} className="prj-ms-row" data-milestone={m.id}>
              {canTick ? (
                <button
                  type="button"
                  className={`${markerClass} ol-gi`}
                  aria-label={t(done ? "projects.milestones.untickLabel" : "projects.milestones.tickLabel", { title: m.title })}
                  title={t(done ? "projects.milestones.untickLabel" : "projects.milestones.tickLabel", { title: m.title })}
                  onClick={() => (done ? setPop({ untick: m.id }) : void tick(m))}
                >
                  {done ? <Check size={11} aria-hidden="true" /> : m.state === "now" ? <span className="prj-ms-dot" aria-hidden="true" /> : null}
                </button>
              ) : (
                <span className={markerClass} aria-hidden="true">
                  {done ? <Check size={11} /> : m.state === "now" ? <span className="prj-ms-dot" /> : null}
                </span>
              )}
              <span className="prj-ms-text">
                <button type="button" className={`prj-ms-title prj-ms-title--${m.state}`} onClick={() => openSheet({ kind: "milestones", projectId }, { focus: m.id })} aria-label={t("projects.milestones.editLabel", { title: m.title })}>
                  {m.title}
                </button>
                <span className="prj-ms-state">{stateLine(m)}</span>
              </span>
              {m.due_on !== null && <span className="prj-ms-due">{dayLabel(m.due_on, locale)}</span>}
              {typeof pop === "object" && pop !== null && pop.untick === m.id && (
                <Popover title={t("projects.milestones.untickTitle", { title: m.title })} action={t("projects.milestones.untickAction")} actionIcon={RotateCcw} busy={busy} onSubmit={() => void untick(m)} onClose={() => setPop(null)} align="end" />
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ── deliverables ────────────────────────────────────────────────────────────

function DeliverableCard({ deliverable: d, newest, tint, first, canShare }: { deliverable: Deliverable; newest: string | null; tint: string | null; first: string; canShare: boolean }) {
  const { t, locale } = useI18n();
  const info = useFileInfo(newest);
  const [busy, setBusy] = useState(false);
  const date = cardDate(d);
  const pill = deliverablePill(d);
  const fileName = info?.name ?? "";
  const dateLine =
    date.kind === "notShared"
      ? t("projects.deliverables.notSharedYet")
      : date.kind === "approved"
        ? t("projects.deliverables.approvedOn", { day: dayLabel(date.day, locale) })
        : date.kind === "changes"
          ? t("projects.deliverables.changesOn", { day: dayLabel(date.at.slice(0, 10), locale) })
          : date.kind === "shared"
            ? t("projects.deliverables.sharedOn", { day: dayLabel(date.at.slice(0, 10), locale) })
            : "";

  const share = async () => {
    setBusy(true);
    const out = await shareDeliverable(d.id);
    setBusy(false);
    if (!out.ok) return refused(t, out);
    toast(t("projects.deliverables.shared", { first }), { icon: "share-2" });
  };

  return (
    <div className="prj-dv ol-card" data-deliverable={d.id}>
      <button type="button" className="prj-dv-open" onClick={() => open("review", d.id)} aria-label={t("projects.deliverables.openLabel", { title: d.title })}>
        <span className="prj-dv-tile" style={tileStyle(tint)}>
          <DeliverableIcon name={d.icon} className="prj-dv-icon" />
          {fileName !== "" && <span className="prj-dv-file">{fileName}</span>}
          <span className={`pill prj-dv-badge pill--${PILL_TONE[pill]}`}>{t(`status.${pill}`)}</span>
        </span>
        <span className="prj-dv-body">
          <span className="prj-dv-title">{d.title}</span>
          {dateLine !== "" && <span className="prj-dv-date">{dateLine}</span>}
          {d.status === "changes" && d.review_note !== null && d.review_note !== "" && <span className="prj-dv-note">{d.review_note}</span>}
        </span>
      </button>
      {d.status === "unshared" && canShare && (
        <div className="prj-dv-share">
          <Button kind="primary" size="small" icon={Share2} busy={busy} onClick={() => void share()} className="prj-dv-share-btn">
            {t("projects.deliverables.share")}
          </Button>
        </div>
      )}
    </div>
  );
}

const PILL_TONE: Record<"notShared" | "pending" | "approved" | "changes", string> = { notShared: "neutral", pending: "info", approved: "pos", changes: "warn" };
