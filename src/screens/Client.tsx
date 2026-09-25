/**
 * One client's record: who they are and how things stand — their state, what
 * is open and overdue, what they have paid to date and how fast they pay,
 * their work; who the studio talks to there (and the terms and tax their
 * documents take); the studio's private notes and what has happened, from the
 * stamps; and every document of theirs, with their statement.
 *
 * "New proposal" opens the composer for them; "Preview as the client" shows
 * their side of the portal, read-only. "Edit" changes their address, tax
 * number, terms and tax rate — new documents take them from then on.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, FilePlus, FileText, Files, FolderKanban, IdCard, NotebookPen, PencilLine, Plus, ReceiptText, ScrollText } from "lucide-react";

import { Alert, Avatar, Button, DayText, Pill, StatusPill, When, type StatusWord } from "../components/ui.tsx";
import type { Id, Instant } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { addClientNote } from "../state/actions.ts";
import { isInDate, loadClient, loadWhere, useDesk, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { previewClient } from "../state/preview.ts";
import { openSheet } from "../state/sheets.ts";
import { go, open, openComposer, toast, useUi } from "../state/ui.ts";
import { clientFigures, progressOf } from "./clients/figures.ts";
import { CLIENT_STATE_TONE } from "./clients/state.ts";
import { invoiceWord, isDiscarded, isOpen, sumsLabel } from "./invoices/figures.ts";
import { openPrint } from "./print/target.ts";

export default function ClientRecord() {
  const { t, money, number } = useI18n();
  const id = useUi((s) => s.selected.client);
  const client = useRow("clients", id);
  const day = useDesk((s) => s.today) || today();
  const [loading, setLoading] = useState(true);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    setLoading(true);
    void (async () => {
      try {
        await loadClient(id);
        const projectIds = Object.values(useDesk.getState().rows.projects)
          .filter((p) => p.client_id === id)
          .map((p) => p.id);
        if (projectIds.length > 0) await loadWhere("milestones", { column: "project_id", op: "in", value: projectIds }, "position.asc");
      } catch {
        // The record draws what the desk holds; a read that failed shows less, not nothing.
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  const invoices = useRows("invoices");
  const projects = useRows("projects");
  const proposals = useRows("proposals");
  const payments = useRows("payments");
  const milestones = useRows("milestones");
  const notes = useRows("client_notes");

  const f = useMemo(() => (id === null ? null : clientFigures(id, { invoices, projects, proposals, payments }, day)), [id, invoices, projects, proposals, payments, day]);

  if (client === undefined || f === null) {
    return (
      <section className="screen ol-screen cr-screen" data-screen="client" aria-labelledby="client-title">
        <BackToClients />
        <h1 className="screen-title" id="client-title">
          {loading && id !== null ? t("common.loading") : t("clients.record.missing")}
        </h1>
      </section>
    );
  }

  const theirInvoices = invoices.filter((i) => i.client_id === client.id).sort((a, b) => b.id - a.id);
  const theirProposals = proposals.filter((p) => p.client_id === client.id).sort((a, b) => b.id - a.id);
  const theirNotes = notes.filter((n) => n.client_id === client.id).sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "") || b.id - a.id);
  const trail = activity(client.id);

  const addNote = async () => {
    if (note.trim() === "") {
      setError(t("clients.record.noteEmpty"));
      return;
    }
    setSaving(true);
    setError(null);
    const out = await addClientNote(client.id, note);
    setSaving(false);
    if (out.ok) {
      setNote("");
      toast(t("clients.record.noted"), { icon: "notebook-pen" });
    } else setError(t(refusalKey(out.reason)));
  };

  function activity(clientId: Id): { key: string; at: Instant; text: string; tone: "pos" | "warn" | "info" | "neutral" }[] {
    const out: { key: string; at: Instant; text: string; tone: "pos" | "warn" | "info" | "neutral" }[] = [];
    for (const p of proposals.filter((x) => x.client_id === clientId)) {
      const label = p.number ?? p.title;
      if (p.sent_at !== null) out.push({ key: `ps${String(p.id)}`, at: p.sent_at, text: t("clients.trail.proposalSent", { id: label, title: p.title }), tone: "info" });
      if (p.decided_at !== null && (p.status === "accepted" || p.status === "declined" || p.status === "withdrawn")) out.push({ key: `pd${String(p.id)}`, at: p.decided_at, text: t(`clients.trail.proposal.${p.status}`, { id: label }), tone: p.status === "accepted" ? "pos" : "warn" });
    }
    for (const i of invoices.filter((x) => x.client_id === clientId)) {
      if (i.sent_at !== null) out.push({ key: `is${String(i.id)}`, at: i.sent_at, text: t("clients.trail.invoiceSent", { id: i.number ?? "", title: i.title ?? "" }), tone: "info" });
      if (i.voided_at !== null && !isDiscarded(i)) out.push({ key: `iv${String(i.id)}`, at: i.voided_at, text: t("clients.trail.invoiceVoided", { id: i.number ?? "" }), tone: "warn" });
    }
    const theirs = new Map(invoices.filter((x) => x.client_id === clientId).map((i) => [i.id, i]));
    for (const p of payments) {
      const inv = theirs.get(p.document_id);
      if (inv === undefined) continue;
      if (p.recorded_at !== null) out.push({ key: `pr${String(p.id)}`, at: p.recorded_at, text: t("clients.trail.paid", { amount: money(p.amount, inv.currency), id: inv.number ?? "" }), tone: "pos" });
      if (p.voided && p.voided_at !== null) out.push({ key: `pv${String(p.id)}`, at: p.voided_at, text: t("clients.trail.paymentVoided", { amount: money(p.amount, inv.currency), id: inv.number ?? "" }), tone: "warn" });
    }
    return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  }

  const meta = [client.trade, client.contact_name].filter((x) => x !== null && x !== "").join(" · ");
  const stats: { k: string; v: string; sub: string; tone: "fg" | "danger" | "warn" }[] = [
    { k: t("clients.record.stat.open"), v: sumsLabel(f.open, money), sub: f.anyOverdue ? t("clients.record.stat.overdue", { amount: sumsLabel(f.overdue, money) }) : t("clients.record.stat.nothingOverdue"), tone: f.anyOverdue ? "danger" : "fg" },
    { k: t("clients.record.stat.paid"), v: sumsLabel(f.paid, money), sub: t("clients.record.stat.issued", { n: number(f.issued) }, f.issued), tone: "fg" },
    {
      k: t("clients.record.stat.paysIn"),
      v: f.paysIn === null ? "—" : t("clients.record.stat.days", { n: number(f.paysIn) }, f.paysIn),
      sub: f.paysIn === null ? t("clients.record.stat.noneSettled") : t("clients.record.stat.average"),
      tone: f.paysIn !== null && f.paysIn > 21 ? "warn" : "fg",
    },
    { k: t("clients.record.stat.work"), v: number(f.projects.length), sub: t("clients.record.stat.workSub", { active: number(f.active), proposals: number(f.proposals) }), tone: "fg" },
  ];

  const docsCount = theirInvoices.length + theirProposals.length;

  return (
    <section className="screen ol-screen cr-screen" data-screen="client" aria-labelledby="client-title">
      <BackToClients />

      <div className="card cr-head">
        <div className="cr-head-top">
          <Avatar name={client.company} tint={client.tint} size={54} />
          <span className="cr-head-names">
            <span className="cr-head-line">
              <h1 className="cr-name" id="client-title">
                {client.company}
              </h1>
              <Pill tone={CLIENT_STATE_TONE[f.state]}>{t(`clients.state.${f.state}`)}</Pill>
            </span>
            <span className="cr-meta">
              {meta}
              {f.since !== null && (
                <>
                  {meta === "" ? "" : " · "}
                  {t("clients.record.since")} <DayText day={f.since} style="long" />
                </>
              )}
            </span>
          </span>
          <span className="cr-head-actions">
            <Button kind="primary" icon={FilePlus} onClick={() => openComposer({ kind: "proposal", id: null, clientId: client.id })}>
              {t("clients.record.newProposal")}
            </Button>
            <Button icon={Eye} onClick={() => void previewClient(client.id, "client")}>
              {t("clients.record.preview")}
            </Button>
          </span>
        </div>
        <dl className="cr-stats">
          {stats.map((s) => (
            <div key={s.k} className="cr-stat">
              <dt className="cr-stat-k">{s.k}</dt>
              <dd className={`cr-stat-v money cr-stat-v--${s.tone}`}>{s.v}</dd>
              <dd className="cr-stat-sub">{s.sub}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="cr-cols">
        <div className="cr-col">
          <section className="card cr-panel" aria-labelledby="cr-work-h">
            <PanelHead icon={FolderKanban} id="cr-work-h" title={t("clients.record.work")} count={t("clients.record.count", { n: number(f.projects.length) })} />
            {f.projects.length === 0 ? (
              <p className="cr-empty">{t("clients.record.noWork")}</p>
            ) : (
              <ul className="cr-rows" role="list">
                {f.projects.map((p) => {
                  const prog = progressOf(p.id, milestones);
                  return (
                    <li key={p.id}>
                      <button type="button" className="cr-work ol-row" onClick={() => open("project", p.id)}>
                        <span className={`cr-dot cr-dot--${p.status === "paused" ? "warn" : prog.pct === 100 || p.status === "done" ? "pos" : "accent"}`} aria-hidden="true" />
                        <span className="cr-work-main">
                          <span className="cr-work-title">{p.name}</span>
                          <span className="cr-work-meta">
                            {p.number ?? ""} · {t(`status.${p.status}`)}
                            {prog.next === null ? (
                              ` · ${t("clients.record.delivered")}`
                            ) : (
                              <>
                                {" · "}
                                {t("clients.record.next", { title: prog.next.title })} <DayText day={prog.next.due_on} />
                              </>
                            )}
                          </span>
                        </span>
                        <span className="cr-work-pct">{prog.total === 0 ? "" : `${number(prog.pct)}%`}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card cr-panel" aria-labelledby="cr-who-h">
            <PanelHead
              icon={IdCard}
              id="cr-who-h"
              title={t("clients.record.who")}
              action={
                <Button size="small" icon={PencilLine} onClick={() => openSheet({ kind: "add", what: "clientEdit", about: { clientId: client.id } })}>
                  {t("clients.record.edit")}
                </Button>
              }
            />
            <dl className="cr-facts">
              <Fact k={t("clients.record.contact")}>{client.contact_name}</Fact>
              <Fact k={t("clients.record.email")} mono>
                <a href={`mailto:${client.email}`} className="cr-mail">
                  {client.email}
                </a>
              </Fact>
              <Fact k={t("clients.record.trade")}>{client.trade ?? "—"}</Fact>
              <Fact k={t("clients.record.address")} pre>
                {client.address ?? "—"}
              </Fact>
              <Fact k={t("clients.record.taxNumber")} mono>
                {client.tax_number ?? "—"}
              </Fact>
              <Fact k={t("clients.record.terms")}>{client.terms === null ? t("clients.record.studios") : t("clients.record.theirs", { value: t(`invoices.terms.${client.terms}`) })}</Fact>
              <Fact k={t("clients.record.tax")}>{client.tax_rate === null ? t("clients.record.studios") : t("clients.record.theirs", { value: `${number(Number(client.tax_rate), { maximumFractionDigits: 3 })} %` })}</Fact>
            </dl>
          </section>

          <section className="card cr-panel" aria-labelledby="cr-notes-h">
            <PanelHead icon={NotebookPen} id="cr-notes-h" title={t("clients.record.notes")} />
            <div className="cr-note-form">
              <label className="ol-sr-only" htmlFor="cr-note">
                {t("clients.record.noteLabel")}
              </label>
              <textarea id="cr-note" className="input ol-fld" rows={2} value={note} placeholder={t("clients.record.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
              <Button size="small" icon={Plus} busy={saving} onClick={() => void addNote()}>
                {t("clients.record.addNote")}
              </Button>
              {error !== null && <Alert>{error}</Alert>}
            </div>
            <ul className="cr-trail" role="list">
              {theirNotes.map((n) => (
                <li key={`n${String(n.id)}`} className="cr-trail-row">
                  <NotebookPen size={15} className="cr-trail-icon cr-trail-icon--accent" aria-hidden="true" />
                  <span className="cr-trail-main">
                    <span className="cr-trail-body">{n.body}</span>
                    <span className="cr-trail-when">
                      <When at={n.at} />
                      {n.by !== null && n.by !== "" ? ` · ${n.by}` : ""}
                    </span>
                  </span>
                </li>
              ))}
              {trail.map((a) => (
                <li key={a.key} className="cr-trail-row">
                  <ScrollText size={15} className={`cr-trail-icon cr-trail-icon--${a.tone}`} aria-hidden="true" />
                  <span className="cr-trail-main">
                    <span className="cr-trail-body cr-trail-body--muted">{a.text}</span>
                    <span className="cr-trail-when">
                      <When at={a.at} />
                    </span>
                  </span>
                </li>
              ))}
              {theirNotes.length === 0 && trail.length === 0 && (
                <li className="cr-trail-row">
                  <span className="cr-trail-main">
                    <span className="cr-trail-body cr-trail-body--quiet">{t("clients.record.noHistory")}</span>
                  </span>
                </li>
              )}
            </ul>
          </section>
        </div>

        <section className="card cr-panel cr-docs" aria-labelledby="cr-docs-h">
          <PanelHead
            icon={Files}
            id="cr-docs-h"
            title={t("clients.record.documents")}
            count={t("clients.record.count", { n: number(docsCount) })}
            action={
              <Button size="small" icon={ScrollText} onClick={() => openPrint({ kind: "statement", id: client.id, period: "all" })}>
                {t("clients.record.statement")}
              </Button>
            }
          />
          {docsCount === 0 ? (
            <p className="cr-empty">{t("clients.record.noDocuments")}</p>
          ) : (
            <ul className="cr-rows" role="list">
              {theirProposals.map((p) => {
                const word: StatusWord = p.status === "sent" && !isInDate(p, day) ? "outOfDate" : p.status;
                return (
                  <li key={`p${String(p.id)}`}>
                    <button type="button" className="cr-doc ol-row" onClick={() => (p.status === "draft" ? openComposer({ kind: "proposal", id: p.id }) : open("proposal", p.id))}>
                      <FileText size={15} className="cr-doc-icon" aria-hidden="true" />
                      <span className="cr-doc-title">{p.title === "" ? t("clients.record.untitledProposal") : p.title}</span>
                      <span className="cr-doc-pill">
                        <StatusPill status={word} />
                      </span>
                      <span className="cr-doc-meta">
                        {p.status === "draft" ? (
                          t("clients.record.draft")
                        ) : (
                          <>
                            {p.number ?? ""} · {t("clients.record.sent")} <When at={p.sent_at} opts={{ day: "numeric", month: "short" }} />
                          </>
                        )}
                      </span>
                      <span className="cr-doc-amount money">{money(p.total, p.currency)}</span>
                    </button>
                  </li>
                );
              })}
              {theirInvoices.map((i) => {
                const word = invoiceWord(i, day);
                const owing = isOpen(i);
                return (
                  <li key={`i${String(i.id)}`}>
                    <button type="button" className="cr-doc ol-row" onClick={() => open("invoice", i.id)}>
                      <ReceiptText size={15} className="cr-doc-icon" aria-hidden="true" />
                      <span className="cr-doc-title">{i.title ?? i.number ?? ""}</span>
                      <span className="cr-doc-pill">
                        <StatusPill status={word} />
                      </span>
                      <span className="cr-doc-meta">
                        {i.number ?? ""} ·{" "}
                        {i.status === "void" ? (
                          t("invoices.due.void")
                        ) : i.status === "draft" ? (
                          t("invoices.due.notSent")
                        ) : (
                          <>
                            {t("clients.record.due")} <DayText day={i.due_on} />
                          </>
                        )}
                      </span>
                      <span className={`cr-doc-amount money${word === "overdue" ? " cr-doc-amount--danger" : owing ? " cr-doc-amount--strong" : ""}`}>{money(owing ? i.balance : i.total, i.currency)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </section>
  );
}

function BackToClients() {
  const { t } = useI18n();
  return (
    <Button size="small" icon={ArrowLeft} className="cr-back" onClick={() => go("clients")}>
      {t("clients.record.back")}
    </Button>
  );
}

function PanelHead({ icon: Icon, id, title, count, action }: { icon: typeof Files; id: string; title: string; count?: string; action?: React.ReactNode }) {
  return (
    <div className="cr-panel-head">
      <Icon size={15} aria-hidden="true" className="cr-panel-icon" />
      <h2 className="cr-panel-title" id={id}>
        {title}
      </h2>
      {count !== undefined && <span className="cr-panel-count">{count}</span>}
      {action !== undefined && <span className="cr-panel-action">{action}</span>}
    </div>
  );
}

function Fact({ k, mono = false, pre = false, children }: { k: string; mono?: boolean; pre?: boolean; children: React.ReactNode }) {
  return (
    <div className="cr-fact">
      <dt className="cr-fact-k">{k}</dt>
      <dd className={`cr-fact-v${mono ? " cr-fact-v--mono" : ""}${pre ? " cr-fact-v--pre" : ""}`}>{children}</dd>
    </div>
  );
}
