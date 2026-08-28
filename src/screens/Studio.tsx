/**
 * The studio side: Home, Proposals, a proposal, Projects, a project, Invoices,
 * an invoice — plus the shared document primitives (the line table and the
 * payments ledger) that both sides render.
 */

import {
  ArrowLeft,
  Banknote,
  CircleCheck,
  FileText,
  FolderKanban,
  MessageSquare,
  Receipt,
  Send,
  Sparkles,
} from "lucide-react";

import { TODAY } from "../data/live.ts";
import type {
  ActivityEntry,
  Invoice,
  InvoiceStatus,
  Proposal,
  ProposalStatus,
  Project,
  ProjectStatus,
} from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import {
  dateFull,
  dateLong,
  dateShort,
  label,
  money,
  percent,
  relative,
  taxLabel,
} from "../lib/format.ts";
import {
  activeProjects,
  aging,
  awaitingClient,
  balance,
  daysOverdue,
  docTotals,
  isOverdue,
  ledger,
  lineTotal,
  oldestOverdueDays,
  open as openInvoices,
  outstanding,
  projectProgress,
  upcomingMilestones,
} from "../lib/invoice.ts";
import { clientById, useStore } from "../state/store.ts";
import {
  Avatar,
  Button,
  Chip,
  Empty,
  Kpi,
  LogoTile,
  Mono,
  Panel,
} from "../components/Primitives.tsx";

/* -------------------------------------------------------- shared fragments */

const PROPOSAL_TONE: Record<ProposalStatus, "info" | "pos" | "danger" | undefined> = {
  draft: undefined,
  sent: "info",
  accepted: "pos",
  declined: "danger",
};

const PROPOSAL_KEY: Record<ProposalStatus, "chrome.status.draft"> = {
  draft: "chrome.status.draft",
  sent: "chrome.status.sent" as "chrome.status.draft",
  accepted: "chrome.status.accepted" as "chrome.status.draft",
  declined: "chrome.status.declined" as "chrome.status.draft",
};

const PROJECT_KEY: Record<ProjectStatus, "chrome.status.active"> = {
  active: "chrome.status.active",
  paused: "chrome.status.paused" as "chrome.status.active",
  done: "chrome.status.done" as "chrome.status.active",
};

const INVOICE_KEY: Record<InvoiceStatus, "chrome.status.draft"> = {
  draft: "chrome.status.draft",
  sent: "chrome.status.sent" as "chrome.status.draft",
  paid: "chrome.status.paid" as "chrome.status.draft",
};

const AGING_KEY = {
  current: "chrome.aging.current",
  d1_30: "chrome.aging.d1_30",
  d31_60: "chrome.aging.d31_60",
  d61plus: "chrome.aging.d61plus",
} as const;

const METHOD_KEY = {
  card: "chrome.method.card",
  cash: "chrome.method.cash",
  transfer: "chrome.method.transfer",
} as const;

/** The line table plus totals — identical on both sides, by design. */
export function LineTable({
  items,
  taxRate,
}: {
  items: Proposal["items"];
  taxRate: number;
}) {
  const { t } = useI18n();
  const totals = docTotals(items, taxRate);

  return (
    <div className="ol-tablewrap ol-scroll">
      <table className="ol-table">
        <thead>
          <tr>
            <th>{t("proposal.col.desc")}</th>
            <th className="ol-num">{t("proposal.col.qty")}</th>
            <th className="ol-num">{t("proposal.col.rate")}</th>
            <th className="ol-num">{t("proposal.col.total")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, i) => (
            <tr key={`${item.desc}-${i}`}>
              <td>
                {label(item.desc)}
                {item.disc > 0 && (
                  <Chip tone="pos" >{t("proposal.discount", { pct: percent(item.disc / 100) })}</Chip>
                )}
              </td>
              <td className="ol-num ol-mono">{item.qty}</td>
              <td className="ol-num ol-mono">{money(item.rate)}</td>
              <td className="ol-num ol-mono">{money(lineTotal(item))}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={3}>{t("proposal.subtotal")}</td>
            <td className="ol-num ol-mono">{money(totals.subtotal)}</td>
          </tr>
          <tr>
            <td colSpan={3}>{t("proposal.tax", { rate: taxLabel(taxRate) })}</td>
            <td className="ol-num ol-mono">{money(totals.tax)}</td>
          </tr>
          <tr className="ol-table__grand">
            <td colSpan={3}>{t("proposal.total")}</td>
            <td className="ol-num ol-mono">{money(totals.total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** The payments ledger with a running balance down the end column. */
export function Ledger({ invoice }: { invoice: Invoice }) {
  const { t } = useI18n();
  const rows = ledger(invoice);

  return (
    <div className="ol-tablewrap ol-scroll">
      <table className="ol-table">
        <tbody>
          {rows.map((row, i) => (
            <tr key={`${row.kind}-${row.at}-${i}`}>
              <td>
                {row.kind === "opening"
                  ? t("invoice.ledger.opening")
                  : t(METHOD_KEY[row.method ?? "card"])}
              </td>
              <td className="ol-mono">{dateShort(row.at)}</td>
              <td className="ol-num ol-mono">
                {row.kind === "opening" ? money(row.amount) : `− ${money(row.amount)}`}
              </td>
              <td className="ol-num ol-mono ol-table__bal">{money(row.balance)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatusChips({ invoice }: { invoice: Invoice }) {
  const { t } = useI18n();
  const overdue = isOverdue(invoice, TODAY);
  return (
    <>
      <Chip tone={invoice.status === "paid" ? "pos" : overdue ? "danger" : "info"}>
        {t(INVOICE_KEY[invoice.status])}
      </Chip>
      {overdue && (
        <Chip tone="danger">
          {t("chrome.overdueDays", { count: daysOverdue(invoice, TODAY) }, daysOverdue(invoice, TODAY))}
        </Chip>
      )}
    </>
  );
}

/* -------------------------------------------------------------------- home */

const ACTIVITY_ICON = {
  banknote: Banknote,
  send: Send,
  "circle-check-big": CircleCheck,
  "message-square": MessageSquare,
  sparkles: Sparkles,
} as const;

export function Home() {
  const { t } = useI18n();
  const invoices = useStore((s) => s.invoices);
  const projects = useStore((s) => s.projects);
  const activity = useStore((s) => s.activity);
  const openInvoice = useStore((s) => s.openInvoice);
  const openProject = useStore((s) => s.openProject);

  const rows = aging(invoices, TODAY);
  const oldest = oldestOverdueDays(invoices, TODAY);
  const waiting = awaitingClient(projects);
  const upcoming = upcomingMilestones(projects, TODAY, 14);
  const openCount = openInvoices(invoices).length;

  return (
    <div className="ol-screen">
      <header className="ol-head">
        <h1 className="ol-head__title">{t("home.title")}</h1>
        <p className="ol-head__sub ol-mono">{dateFull(TODAY)}</p>
      </header>

      <div className="ol-kpis" style={{ marginBlockEnd: 16 }}>
        <Kpi
          label={t("home.kpi.outstanding")}
          value={money(outstanding(invoices))}
          hint={t("home.kpi.outstanding.hint", { count: openCount }, openCount)}
        />
        <Kpi
          label={t("home.kpi.overdue")}
          value={oldest > 0 ? String(rows.filter((r) => r.bucket !== "current").reduce((n, r) => n + r.count, 0)) : "0"}
          tone={oldest > 0 ? "danger" : undefined}
          hint={oldest > 0 ? t("home.kpi.overdue.hint", { days: oldest }) : t("home.kpi.overdue.clear")}
        />
        <Kpi label={t("home.kpi.projects")} value={activeProjects(projects).length} />
      </div>

      <section className="ol-agingstrip" aria-label={t("home.aging.title")}>
        {rows.map((row) => (
          <div
            key={row.bucket}
            className="ol-agingchip"
            data-empty={row.count === 0 ? "true" : undefined}
            data-late={row.bucket !== "current" && row.count > 0 ? "true" : undefined}
          >
            <span className="ol-agingchip__label">{t(AGING_KEY[row.bucket])}</span>
            <Mono className="ol-agingchip__amount">{money(row.amount)}</Mono>
            <span className="ol-agingchip__count">
              {t("chrome.count.invoices", { count: row.count }, row.count)}
            </span>
          </div>
        ))}
      </section>

      <div className="ol-home-grid">
        <Panel title={t("home.activity.title")}>
          <div className="ol-timeline">
            {activity.map((entry: ActivityEntry) => {
              const Icon = ACTIVITY_ICON[entry.icon as keyof typeof ACTIVITY_ICON] ?? Sparkles;
              return (
                <article key={entry.id} className="ol-tl-row">
                  <span
                    className="ol-tl-dot"
                    style={{
                      background: `var(--${entry.tone}-soft)`,
                      color: `var(--${entry.tone})`,
                    }}
                    aria-hidden="true"
                  >
                    <Icon size={14} />
                  </span>
                  <div className="ol-tl-body">
                    <p className="ol-tl-text">{t(entry.text as "data.act.payment", entry.params)}</p>
                    <span className="ol-tl-when ol-mono">{relative(entry.at, TODAY)}</span>
                  </div>
                </article>
              );
            })}
          </div>
        </Panel>

        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <Panel title={t("home.waiting.title")}>
            {waiting.length === 0 ? (
              <p className="ol-col__empty">{t("home.waiting.empty")}</p>
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {waiting.map(({ project, deliverable }) => (
                  <button
                    key={deliverable.id}
                    type="button"
                    className="ol-row"
                    onClick={() => openProject(project.id)}
                  >
                    <span className="ol-row__main">{label(deliverable.title)}</span>
                    <Mono className="ol-row__meta">{deliverable.file}</Mono>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("home.week.title")}>
            {upcoming.length === 0 ? (
              <p className="ol-col__empty">{t("home.week.empty")}</p>
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {upcoming.map(({ project, milestone }) => (
                  <button
                    key={`${project.id}-${milestone.title}`}
                    type="button"
                    className="ol-row"
                    onClick={() => openProject(project.id)}
                  >
                    <span className="ol-row__main">{label(milestone.title)}</span>
                    <Mono className="ol-row__meta">{dateShort(milestone.due)}</Mono>
                  </button>
                ))}
              </div>
            )}
          </Panel>

          <Panel title={t("invoices.filter.overdue")}>
            {rows.every((r) => r.bucket === "current" || r.count === 0) ? (
              <p className="ol-col__empty">{t("home.kpi.overdue.clear")}</p>
            ) : (
              <div style={{ display: "grid", gap: 9 }}>
                {invoices
                  .filter((i) => isOverdue(i, TODAY))
                  .map((i) => (
                    <button
                      key={i.num}
                      type="button"
                      className="ol-row"
                      onClick={() => openInvoice(i.num)}
                    >
                      <Mono className="ol-row__num">{i.num}</Mono>
                      <span className="ol-row__main">{label(i.title)}</span>
                      <Mono className="ol-row__meta">{money(balance(i))}</Mono>
                    </button>
                  ))}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- proposals */

export function Proposals() {
  const { t } = useI18n();
  const proposals = useStore((s) => s.proposals);
  const filter = useStore((s) => s.proposalFilter);
  const setFilter = useStore((s) => s.setProposalFilter);
  const openProposal = useStore((s) => s.openProposal);

  const list = proposals.filter((p) => filter === "all" || p.status === filter);

  return (
    <div className="ol-screen">
      <header className="ol-head">
        <h1 className="ol-head__title">{t("proposals.title")}</h1>
        <p className="ol-head__sub">{t("proposals.subtitle")}</p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBlockEnd: 16 }}>
        <Chip onClick={() => setFilter("all")} pressed={filter === "all"}>
          {t("proposals.filter.all")}
        </Chip>
        {(["draft", "sent", "accepted", "declined"] as ProposalStatus[]).map((s) => (
          <Chip key={s} onClick={() => setFilter(s)} pressed={filter === s}>
            {t(PROPOSAL_KEY[s])}
          </Chip>
        ))}
      </div>

      {list.length === 0 ? (
        <Empty icon={<FileText size={22} aria-hidden="true" />} title={t("proposals.empty")} />
      ) : (
        <div style={{ display: "grid", gap: 11 }}>
          {list.map((p) => {
            const client = clientById(p.client);
            return (
              <button key={p.num} type="button" className="ol-docrow" onClick={() => openProposal(p.num)}>
                <Mono className="ol-docrow__num">{p.num}</Mono>
                <div className="ol-docrow__body">
                  <span className="ol-docrow__title">{label(p.title)}</span>
                  <span className="ol-docrow__client">
                    {client !== null && <Avatar name={client.company} tint={client.tint} />}
                    {client?.company}
                  </span>
                </div>
                <Chip tone={PROPOSAL_TONE[p.status]}>{t(PROPOSAL_KEY[p.status])}</Chip>
                <Mono className="ol-docrow__amount">
                  {money(docTotals(p.items, p.taxRate).total)}
                </Mono>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProposalPage() {
  const { t } = useI18n();
  const num = useStore((s) => s.proposalNum);
  const proposals = useStore((s) => s.proposals);
  const go = useStore((s) => s.go);
  const sendProposal = useStore((s) => s.sendProposal);
  const openProject = useStore((s) => s.openProject);

  const proposal = proposals.find((p) => p.num === num);
  if (!proposal) {
    return (
      <div className="ol-screen">
        <Empty title={t("proposals.empty")} action={<Button onClick={() => go("proposals")}>{t("proposal.back")}</Button>} />
      </div>
    );
  }

  const client = clientById(proposal.client);

  return (
    <div className="ol-screen">
      <button type="button" className="ol-backlink" onClick={() => go("proposals")}>
        <ArrowLeft size={14} aria-hidden="true" />
        {t("proposal.back")}
      </button>

      <header className="ol-dochead">
        <div style={{ minWidth: 0 }}>
          <Mono className="ol-dochead__num">{proposal.num}</Mono>
          <h1 className="ol-head__title">{label(proposal.title)}</h1>
          <p className="ol-head__sub">
            {client?.company} · {t("proposal.validUntil", { date: dateLong(proposal.validUntil) })}
          </p>
        </div>
        <div className="ol-dochead__actions">
          <Chip tone={PROPOSAL_TONE[proposal.status]}>{t(PROPOSAL_KEY[proposal.status])}</Chip>
          {proposal.status === "draft" && (
            <Button onClick={() => sendProposal(proposal.num)}>
              <Send size={15} aria-hidden="true" />
              {t("proposal.send")}
            </Button>
          )}
          {proposal.project !== null && (
            <Button tone="ghost" onClick={() => openProject(proposal.project!)}>
              {t("proposal.spawned")}
            </Button>
          )}
        </div>
      </header>

      {proposal.status === "declined" && proposal.declineNote.length > 0 && (
        <p className="ol-declined">{t("proposal.declined", { note: label(proposal.declineNote) })}</p>
      )}

      <Panel title={t("proposal.scope")}>
        {proposal.scope.map((para) => (
          <p key={para} className="ol-prose">
            {label(para)}
          </p>
        ))}
      </Panel>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("proposal.items")}>
          <LineTable items={proposal.items} taxRate={proposal.taxRate} />
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- projects */

export function Projects() {
  const { t } = useI18n();
  const projects = useStore((s) => s.projects);
  const openProject = useStore((s) => s.openProject);

  const groups: ProjectStatus[] = ["active", "paused", "done"];

  return (
    <div className="ol-screen">
      <header className="ol-head">
        <h1 className="ol-head__title">{t("projects.title")}</h1>
        <p className="ol-head__sub">{t("projects.subtitle")}</p>
      </header>

      <div style={{ display: "grid", gap: 20 }}>
        {groups.map((status) => {
          const inGroup = projects.filter((p) => p.status === status);
          return (
            <section key={status}>
              <h2 className="ol-section-title">{t(PROJECT_KEY[status])}</h2>
              {inGroup.length === 0 ? (
                <p className="ol-col__empty">{t("projects.empty")}</p>
              ) : (
                <div className="ol-cardgrid">
                  {inGroup.map((p) => (
                    <ProjectTile key={p.id} project={p} onOpen={() => openProject(p.id)} />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ProjectTile({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const { t } = useI18n();
  const client = clientById(project.client);
  const progress = projectProgress(project);

  return (
    <button type="button" className="ol-projtile ol-card" onClick={onOpen}>
      <Ring value={progress} tint={client?.tint ?? "#b25e09"} />
      <span className="ol-projtile__name">{label(project.name)}</span>
      <span className="ol-projtile__client">{client?.company}</span>
      <span className="ol-projtile__foot">
        <Chip>{t("project.due", { date: dateShort(project.due) })}</Chip>
        <Chip tone="accent">
          {t("chrome.count.deliverables", { count: project.deliverables.length }, project.deliverables.length)}
        </Chip>
      </span>
    </button>
  );
}

/**
 * A progress ring. `pathLength="100"` normalises the circumference so the dash
 * array is a plain percentage — no 2πr arithmetic anywhere.
 */
export function Ring({ value, tint }: { value: number; tint: string }) {
  return (
    <span className="ol-ring" role="img" aria-label={percent(value)}>
      <svg viewBox="0 0 44 44" aria-hidden="true" focusable="false">
        <circle cx="22" cy="22" r="19" fill="none" stroke="var(--surface-3)" strokeWidth="4" />
        <circle
          cx="22" cy="22" r="19" fill="none" stroke={tint} strokeWidth="4"
          strokeLinecap="round" pathLength="100"
          strokeDasharray={`${value * 100} 100`}
          transform="rotate(-90 22 22)"
        />
      </svg>
      <span className="ol-ring__label ol-mono">{percent(value)}</span>
    </span>
  );
}

export function ProjectPage() {
  const { t } = useI18n();
  const id = useStore((s) => s.projectId);
  const projects = useStore((s) => s.projects);
  const go = useStore((s) => s.go);

  const project = projects.find((p) => p.id === id);
  if (!project) {
    return (
      <div className="ol-screen">
        <Empty title={t("projects.empty")} action={<Button onClick={() => go("projects")}>{t("project.back")}</Button>} />
      </div>
    );
  }

  const client = clientById(project.client);

  return (
    <div className="ol-screen">
      <button type="button" className="ol-backlink" onClick={() => go("projects")}>
        <ArrowLeft size={14} aria-hidden="true" />
        {t("project.back")}
      </button>

      <header className="ol-dochead">
        <div style={{ minWidth: 0 }}>
          <h1 className="ol-head__title">{label(project.name)}</h1>
          <p className="ol-head__sub">
            {client?.company} · {t("project.due", { date: dateLong(project.due) })}
          </p>
        </div>
        <Ring value={projectProgress(project)} tint={client?.tint ?? "#b25e09"} />
      </header>

      <ProjectBody project={project} clientSide={false} />
    </div>
  );
}

/** Milestones + deliverables. Shared with the client's progress view. */
export function ProjectBody({
  project,
  clientSide,
}: {
  project: Project;
  clientSide: boolean;
}) {
  const { t } = useI18n();
  const setStatus = useStore((s) => s.setDeliverableStatus);
  const askChanges = useStore((s) => s.askChanges);
  const client = clientById(project.client);

  return (
    <div className="ol-deal-grid">
      <Panel title={t("project.milestones")}>
        <ol className="ol-milestones">
          {project.milestones.map((m) => (
            <li key={m.title} className="ol-milestone" data-done={m.done ? "true" : undefined}>
              <span className="ol-milestone__mark" aria-hidden="true">
                {m.done ? <CircleCheck size={15} /> : <span className="ol-milestone__dot" />}
              </span>
              <span className="ol-milestone__title">{label(m.title)}</span>
              <Mono className="ol-milestone__due">{dateShort(m.due)}</Mono>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel title={t("project.deliverables")}>
        {project.deliverables.length === 0 ? (
          <p className="ol-col__empty">{t("project.deliverables.empty")}</p>
        ) : (
          <div className="ol-delgrid">
            {project.deliverables.map((d) => (
              <article key={d.id} className="ol-del">
                <LogoTile
                  tint={client?.tint ?? "#b25e09"}
                  ini=""
                  file={d.file}
                  size={72}
                  badge={
                    <Chip
                      tone={
                        d.status === "approved" ? "pos" : d.status === "changes" ? "warn" : undefined
                      }
                    >
                      {t(
                        d.status === "approved"
                          ? "chrome.status.approved"
                          : d.status === "changes"
                            ? "chrome.status.changes"
                            : "chrome.status.pending",
                      )}
                    </Chip>
                  }
                />
                <div className="ol-del__body">
                  <span className="ol-del__title">{label(d.title)}</span>
                  {d.note.trim().length > 0 && (
                    <p className="ol-del__note">“{label(d.note)}”</p>
                  )}
                  {clientSide && d.status !== "approved" && (
                    <div className="ol-del__actions">
                      <Button size="sm" tone="pos" onClick={() => setStatus(project.id, d.id, "approved")}>
                        {t("progress.approve")}
                      </Button>
                      <Button
                        size="sm"
                        tone="ghost"
                        onClick={() => askChanges({ project: project.id, deliverable: d.id })}
                      >
                        {t("progress.requestChanges")}
                      </Button>
                    </div>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------- invoices */

export function Invoices() {
  const { t } = useI18n();
  const invoices = useStore((s) => s.invoices);
  const filter = useStore((s) => s.invoiceFilter);
  const setFilter = useStore((s) => s.setInvoiceFilter);
  const openInvoice = useStore((s) => s.openInvoice);

  const list = invoices.filter((i) => {
    if (filter === "open") return i.status !== "draft" && balance(i) > 0;
    if (filter === "overdue") return isOverdue(i, TODAY);
    return true;
  });

  return (
    <div className="ol-screen">
      <header className="ol-head">
        <h1 className="ol-head__title">{t("invoices.title")}</h1>
        <p className="ol-head__sub">{t("invoices.subtitle")}</p>
      </header>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginBlockEnd: 16 }}>
        {(["all", "open", "overdue"] as const).map((f) => (
          <Chip key={f} onClick={() => setFilter(f)} pressed={filter === f}>
            {t(`invoices.filter.${f}` as "invoices.filter.all")}
          </Chip>
        ))}
      </div>

      {list.length === 0 ? (
        <Empty icon={<Receipt size={22} aria-hidden="true" />} title={t("invoices.empty")} />
      ) : (
        <div style={{ display: "grid", gap: 11 }}>
          {list.map((i) => {
            const client = clientById(i.client);
            return (
              <button key={i.num} type="button" className="ol-docrow" onClick={() => openInvoice(i.num)}>
                <Mono className="ol-docrow__num">{i.num}</Mono>
                <div className="ol-docrow__body">
                  <span className="ol-docrow__title">{label(i.title)}</span>
                  <span className="ol-docrow__client">
                    {client !== null && <Avatar name={client.company} tint={client.tint} />}
                    {client?.company} · <Mono>{dateShort(i.due)}</Mono>
                  </span>
                </div>
                <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <StatusChips invoice={i} />
                </span>
                <Mono className="ol-docrow__amount">{money(balance(i))}</Mono>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function InvoicePage() {
  const { t } = useI18n();
  const num = useStore((s) => s.invoiceNum);
  const invoices = useStore((s) => s.invoices);
  const go = useStore((s) => s.go);
  const askRecord = useStore((s) => s.askRecord);

  const invoice = invoices.find((i) => i.num === num);
  if (!invoice) {
    return (
      <div className="ol-screen">
        <Empty title={t("invoices.empty")} action={<Button onClick={() => go("invoices")}>{t("invoice.back")}</Button>} />
      </div>
    );
  }

  const client = clientById(invoice.client);
  const due = balance(invoice);

  return (
    <div className="ol-screen">
      <button type="button" className="ol-backlink" onClick={() => go("invoices")}>
        <ArrowLeft size={14} aria-hidden="true" />
        {t("invoice.back")}
      </button>

      <header className="ol-dochead">
        <div style={{ minWidth: 0 }}>
          <Mono className="ol-dochead__num">{invoice.num}</Mono>
          <h1 className="ol-head__title">{label(invoice.title)}</h1>
          <p className="ol-head__sub">
            {client?.company} · {t("invoice.issued", { date: dateLong(invoice.issued) })} ·{" "}
            {t("invoice.due", { date: dateLong(invoice.due) })}
          </p>
        </div>
        <div className="ol-dochead__actions">
          <StatusChips invoice={invoice} />
          {due > 0 && invoice.status !== "draft" && (
            <Button onClick={() => askRecord(invoice.num)}>
              <Banknote size={15} aria-hidden="true" />
              {t("invoice.record")}
            </Button>
          )}
        </div>
      </header>

      <Panel title={t("proposal.items")}>
        <LineTable items={invoice.items} taxRate={invoice.taxRate} />
      </Panel>

      <div style={{ marginBlockStart: 16 }}>
        <Panel title={t("invoice.ledger")}>
          <Ledger invoice={invoice} />
          <div className="ol-balance">
            <span>{due === 0 ? t("invoice.settled") : t("invoice.balanceDue")}</span>
            <Mono className="ol-balance__value">{money(due)}</Mono>
          </div>
        </Panel>
      </div>
    </div>
  );
}

export { FolderKanban };
