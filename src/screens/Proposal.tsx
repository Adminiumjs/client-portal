/**
 * One proposal: its number, state and when it went out; the title, the
 * client and who to talk to, how long it holds and what it comes to; the
 * scope, the lines with Adminium's subtotal, tax and total; then what its
 * state says — the client's note on a decline, the reason on a withdrawal,
 * the signature (with the terms version it was signed against, and its
 * fingerprint), a warning when it is out of date, a project started with
 * no invoice yet — and the buttons that state offers.
 *
 * Opening the page reads the proposal again with its lines, its client, the
 * terms version it names, its project and its stage invoices, and the last
 * reminder sent about it.
 */
import { useEffect, useState } from "react";
import {
  ArrowLeft,
  BellRing,
  CalendarPlus,
  CalendarX,
  Copy,
  Eye,
  FolderOpen,
  FolderPlus,
  MessageSquareQuote,
  PenLine,
  Printer,
  ReceiptText,
  Send,
  SquarePen,
  Undo2,
} from "lucide-react";

import { Alert, Button, Empty, LinesTable, Money, StatusPill } from "../components/ui.tsx";
import type { Id, Message } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { dayLabel, instantLabel } from "../lib/dates.ts";
import { studioZone } from "../lib/clock.ts";
import { venueDay } from "../data/venueTime.ts";
import { sendProposalReminder } from "../state/actions.ts";
import { loadProposal, loadWhere, useDesk, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { previewClient } from "../state/preview.ts";
import { openSheet } from "../state/sheets.ts";
import { go, open, openComposer, toast, useUi } from "../state/ui.ts";
import { proposalState, proposalWord, shortFingerprint, termsVersionLabel } from "./proposals/model.ts";
import { scopeParagraphs } from "./composer/draft.ts";
import { dayWithYear } from "./proposals/format.ts";

const first = (name: string | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** The latest reminder about a proposal: gone out, or still going. */
function lastReminder(messages: readonly Message[], proposalId: Id): Message | null {
  return messages.filter((m) => m.proposal_id === proposalId && m.kind === "proposal-reminder" && m.status !== "skipped" && m.status !== "failed").sort((a, b) => b.id - a.id)[0] ?? null;
}

/** Open the printed copy of a proposal. */
function openPrint(proposalId: Id): void {
  useUi.setState((s) => ({ view: "print", menu: false, selected: { ...s.selected, proposal: proposalId, invoice: null } }));
}

export default function Proposal() {
  const { t, locale } = useI18n();
  const zone = studioZone();
  const id = useUi((s) => s.selected.proposal);
  const today = useDesk((s) => s.today);
  const p = useRow("proposals", id);
  const client = useRow("clients", p?.client_id);
  const lines = useRows("proposal_lines").filter((l) => l.document_id === id).sort((a, b) => a.position - b.position);
  const invoices = useRows("invoices");
  const projects = useRows("projects");
  const versions = useRows("terms_versions");
  const messages = useRows("messages");
  const [loading, setLoading] = useState(true);
  const [reminding, setReminding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    setLoading(true);
    setError(null);
    void Promise.all([
      loadProposal(id),
      loadWhere("messages", { and: [{ column: "proposal_id", op: "eq", value: id }, { column: "kind", op: "eq", value: "proposal-reminder" }] }, "id.desc", 5),
    ])
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id]);

  const back = (
    <button type="button" className="btn btn--small ol-gi prop-back" onClick={() => go("proposals")}>
      <ArrowLeft size={14} aria-hidden="true" />
      {t("proposals.back")}
    </button>
  );

  if (id === null || p === undefined) {
    return (
      <section className="screen ol-screen prop-page" data-screen="proposal" aria-labelledby="prop-missing">
        {back}
        <div className="card">
          <Empty title={<span id="prop-missing">{loading && id !== null ? t("common.loading") : t("proposals.missing")}</span>} body={loading && id !== null ? undefined : t("proposals.missingBody")} />
        </div>
      </section>
    );
  }

  const project = projects.find((pr) => pr.proposal_id === p.id) ?? null;
  const state = proposalState(p, today, project, invoices);
  const firstName = first(client?.contact_name);
  const version = termsVersionLabel(versions.find((v) => v.id === p.terms_version_id), versions);
  const fingerprint = shortFingerprint(p.fingerprint);
  const reminder = lastReminder(messages, p.id);
  const remindedToday = reminder !== null && (reminder.sent_at === null || venueDay(Date.parse(reminder.sent_at), zone) === today);
  const decided = p.decided_at === null ? "" : instantLabel(p.decided_at, zone, locale, { day: "numeric", month: "short", year: "numeric" });

  async function remind(): Promise<void> {
    if (p === undefined || reminding) return;
    setReminding(true);
    setError(null);
    const out = await sendProposalReminder(p.id);
    setReminding(false);
    if (!out.ok) {
      setError(t(refusalKey(out.reason), { id: p.number ?? "" }));
      return;
    }
    toast(t("proposals.toast.reminded", { first: firstName }), { icon: "send" });
  }

  const signedOn = p.signed_at ?? p.decided_at;

  return (
    <section className="screen ol-screen prop-page" data-screen="proposal" aria-labelledby="prop-title">
      {back}
      <article className="prop-doc">
        <header className="prop-head">
          <div className="prop-meta">
            {p.number !== null && <span className="prop-number">{p.number}</span>}
            <StatusPill status={proposalWord(p, today)} />
            <span className="prop-dates">{p.sent_at === null ? t("proposals.notSent") : t("proposals.sentOn", { date: instantLabel(p.sent_at, zone, locale, { day: "numeric", month: "short", year: "numeric" }) })}</span>
          </div>
          <h1 className="prop-title" id="prop-title">
            {p.title.trim() === "" ? t("proposals.untitled") : p.title}
          </h1>
          <dl className="prop-facts">
            <div>
              <dt>{t("proposals.client")}</dt>
              <dd>{client?.company ?? ""}</dd>
            </div>
            <div>
              <dt>{t("proposals.contact")}</dt>
              <dd>{client === undefined ? "" : `${client.contact_name} · ${client.email}`}</dd>
            </div>
            <div>
              <dt>{t("proposals.validUntil")}</dt>
              <dd className="prop-mono">
                <time className="when" dateTime={p.valid_until ?? undefined}>
                  {dayWithYear(p.valid_until, locale)}
                </time>
              </dd>
            </div>
            <div>
              <dt>{t("proposals.total")}</dt>
              <dd className="prop-mono">
                <Money value={p.total} currency={p.currency} />
              </dd>
            </div>
          </dl>
        </header>

        <div className="prop-body">
          <section aria-labelledby="prop-scope">
            <h2 className="kicker prop-h2" id="prop-scope">
              {t("proposals.scope")}
            </h2>
            <div className="prop-scope">
              {p.scope === null || p.scope.trim() === "" ? (
                <p className="prop-muted">{t("proposals.noScope")}</p>
              ) : (
                scopeParagraphs(p.scope).map((para, i) => <p key={i}>{para}</p>)
              )}
            </div>
          </section>
          <section aria-labelledby="prop-lines">
            <h2 className="kicker prop-h2" id="prop-lines">
              {t("proposals.lines")}
            </h2>
            <div className="prop-lines">
              <LinesTable
                lines={lines.map((l) => ({ key: l.id, description: l.description ?? "", qty: l.qty, rate: l.rate, amount: l.amount, discount: l.discount }))}
                subtotal={p.subtotal}
                tax={p.tax}
                taxName={p.tax_name}
                taxRate={p.tax_rate}
                total={p.total}
                currency={p.currency}
              />
            </div>
          </section>

          {state.note !== null && (
            <div className="prop-band prop-band--danger">
              <MessageSquareQuote size={16} aria-hidden="true" />
              <span className="prop-band-text">
                <span className="prop-band-title">{t(state.note === "declined" ? "proposals.declinedNote" : "proposals.withdrawnNote", { date: decided })}</span>
                <span className="prop-band-body">{(state.note === "declined" ? p.decline_note : p.withdraw_reason) ?? t("proposals.noNote")}</span>
              </span>
            </div>
          )}
          {state.signed && (
            <div className="prop-band prop-band--pos">
              <PenLine size={16} aria-hidden="true" />
              <span className="prop-band-line">
                {version === null
                  ? t("proposals.signedLineNoTerms", { date: signedOn === null ? "" : instantLabel(signedOn, zone, locale, { day: "numeric", month: "short", year: "numeric" }), name: p.signed_name ?? "" })
                  : t("proposals.signedLine", { date: signedOn === null ? "" : instantLabel(signedOn, zone, locale, { day: "numeric", month: "short", year: "numeric" }), name: p.signed_name ?? "", version })}
                {fingerprint !== null && (
                  <>
                    {" · "}
                    <span className="prop-fingerprint">{t("proposals.fingerprint", { fingerprint })}</span>
                  </>
                )}
              </span>
            </div>
          )}
          {state.unsigned && (
            <div className="prop-band prop-band--info">
              <PenLine size={16} aria-hidden="true" />
              <span className="prop-band-line">{t("proposals.unsignedLine", { how: t(`proposals.how.${p.accepted_how ?? "email"}` as MessageKey), date: decided })}</span>
            </div>
          )}
          {state.outOfDate && (
            <div className="prop-band prop-band--warn">
              <CalendarX size={16} aria-hidden="true" />
              <span className="prop-band-line">{t("proposals.outOfDateLine", { date: dayLabel(p.valid_until, locale, "short"), first: firstName })}</span>
            </div>
          )}
          {state.firstInvoiceMissing && project !== null && (
            <div className="prop-band prop-band--warn prop-band--action">
              <ReceiptText size={16} aria-hidden="true" />
              <span className="prop-band-line">{t("proposals.firstInvoiceMissing", { project: project.number ?? project.name })}</span>
              <Button size="small" onClick={() => openSheet({ kind: "nextStage", projectId: project.id })}>
                {t("proposals.draftIt")}
              </Button>
            </div>
          )}

          {error !== null && <Alert>{error}</Alert>}

          <div className="prop-actions" role="group" aria-label={t("proposals.actions")}>
            {state.draft && (
              <>
                <Button kind="primary" icon={SquarePen} onClick={() => openComposer({ kind: "proposal", id: p.id })}>
                  {t("proposals.openInComposer")}
                </Button>
                <Button icon={Send} onClick={() => openSheet({ kind: "send", table: "proposals", id: p.id })}>
                  {t("proposals.sendDraft", { first: firstName })}
                </Button>
              </>
            )}
            {state.live && (
              <>
                <Button kind="primary" icon={BellRing} busy={reminding} disabled={remindedToday} onClick={() => void remind()}>
                  {reminder === null ? t("proposals.remind") : reminder.sent_at === null ? t("proposals.reminderGoing") : remindedToday ? t("proposals.reminded", { date: dayLabel(today, locale, "short") }) : t("proposals.remind")}
                </Button>
                <Button icon={CalendarPlus} onClick={() => openSheet({ kind: "extend", proposalId: p.id })}>
                  {t("proposals.extend")}
                </Button>
              </>
            )}
            {state.outOfDate && (
              <Button kind="primary" icon={CalendarPlus} onClick={() => openSheet({ kind: "extend", proposalId: p.id })}>
                {t("proposals.extend")}
              </Button>
            )}
            {state.sent && (
              <Button icon={Undo2} onClick={() => openSheet({ kind: "withdraw", proposalId: p.id })}>
                {t("proposals.withdraw")}
              </Button>
            )}
            {state.needsProject && (
              <Button kind="primary" icon={FolderPlus} onClick={() => openSheet({ kind: "startProject", proposalId: p.id })}>
                {t("proposals.start")}
              </Button>
            )}
            {state.canRevise && (
              <Button icon={Copy} onClick={() => openSheet({ kind: "revision", proposalId: p.id })}>
                {t("proposals.revise")}
              </Button>
            )}
            {state.canPreview && (
              <>
                <Button icon={Printer} onClick={() => openPrint(p.id)}>
                  {t("proposals.print")}
                </Button>
                <Button icon={Eye} onClick={() => void previewClient(p.client_id, "proposal", "proposal")}>
                  {t("proposals.preview")}
                </Button>
              </>
            )}
            {project !== null && (
              <Button icon={FolderOpen} onClick={() => open("project", project.id)}>
                {t("proposals.openProject", { number: project.number ?? project.name })}
              </Button>
            )}
          </div>
        </div>
      </article>
    </section>
  );
}
