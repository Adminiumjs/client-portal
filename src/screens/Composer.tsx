/**
 * The composer: a proposal or an invoice, new or a draft, written in one
 * place — who it is for and what it is (a proposal's valid-until day and how
 * it gets paid; an invoice's project and terms), a proposal's scope, the lines
 * (description, quantity, rate, a discount amount), and the rail with the
 * figures, who it goes to, Send and Save as draft.
 *
 * While the studio types, the rail shows what Adminium will work out, the
 * same way; saving writes the document and its lines and the page it lands
 * on shows Adminium's stored figures. Send saves, then moves the document to
 * sent (a new one: create → lines → sent). A line marked in red keeps Send
 * off; a draft keeps its lines as typed. A proposal started from an enquiry
 * makes its client, and moves the enquiry on, only when it is first saved.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, CircleAlert, Plus, Save, Send, Trash2 } from "lucide-react";

import { Alert, Button, Empty, Money, StatusPill, UnfinishedLine } from "../components/ui.tsx";
import type { Client, ClientTerms, Invoice, Proposal } from "../data/types.ts";
import { addDays } from "../data/venueTime.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { minorUnits } from "../lib/money.ts";
import { saveInvoice, saveProposal, sendInvoice, sendProposal, type Outcome } from "../state/actions.ts";
import { ensureRows, loadInvoice, loadPage, loadProposal, loadWhere, useDesk, useRows } from "../state/desk.ts";
import { refusalKey, type Unfinished } from "../state/outcome.ts";
import { go, open, openComposer, toast, useUi, type ComposerTarget } from "../state/ui.ts";
import {
  blankLine,
  enquiryProposalForm,
  invoiceForm,
  lineProblem,
  newInvoiceForm,
  newProposalForm,
  proposalForm,
  sendBlock,
  SPLITS,
  TERM_DAYS,
  TERMS,
  toInvoiceDraft,
  toProposalDraft,
  VALID_DAYS,
  type ComposerForm,
  type LineForm,
  filledProposal,
} from "./composer/draft.ts";
import { useDemoSignal } from "../state/demoSignal.ts";
import { documentFigures, readAmount } from "./composer/figures.ts";
import { inForce } from "./proposals/model.ts";

const first = (name: string | undefined) => (name ?? "").trim().split(/\s+/)[0] ?? "";
const sameTarget = (a: ComposerTarget | null, b: ComposerTarget | null) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The tax rate the rail previews with: the document's own (a saved draft),
 * else the client's, else the rate on the studio's latest document for a
 * client with no rate of their own (the studio's default, as Adminium copied
 * it). Null when none is known: the rail says it is worked out on saving.
 */
function previewTax(doc: Proposal | Invoice | undefined, client: Client | undefined, rows: ReturnType<typeof useDesk.getState>["rows"]): { rate: string | null; name: string | null } {
  if (doc !== undefined && doc.tax_rate !== null) return { rate: doc.tax_rate, name: doc.tax_name };
  const docs = [...Object.values(rows.proposals), ...Object.values(rows.invoices)].filter((d) => d.tax_rate !== null).sort((a, b) => b.id - a.id);
  const name = docs[0]?.tax_name ?? null;
  if (client !== undefined && client.tax_rate !== null) return { rate: client.tax_rate, name };
  const studio = docs.find((d) => rows.clients[d.client_id]?.tax_rate === null);
  return { rate: studio?.tax_rate ?? null, name };
}

export default function Composer() {
  const { t, locale, number } = useI18n();
  const target = useUi((s) => s.composer);
  const today = useDesk((s) => s.today);
  const rows = useDesk((s) => s.rows);
  const clients = useRows("clients");
  const [form, setForm] = useState<ComposerForm | null>(null);
  const [formFor, setFormFor] = useState<ComposerTarget | null>(null);
  const [busy, setBusy] = useState<"send" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState<{ send: boolean; job: Unfinished<unknown> } | null>(null);
  const [missing, setMissing] = useState(false);
  /** A fill that arrived before its proposal was open: laid over the form once it starts. */
  const pendingFill = useRef<Record<string, string> | null>(null);

  // Read what the composer needs, then start the form from it (once per target).
  useEffect(() => {
    if (target === null) return;
    let live = true;
    setError(null);
    setUnfinished(null);
    setMissing(false);
    const start = async () => {
      await loadPage("clients", { order: "company.asc", limit: 200, offset: 0 }).catch(() => undefined);
      const state = useDesk.getState();
      const termsVersionId = inForce(Object.values(state.rows.terms_versions))?.id ?? null;
      let next: ComposerForm | null = null;
      if (target.kind === "proposal") {
        if (target.id !== null) {
          await loadProposal(target.id).catch(() => undefined);
          const rows = useDesk.getState().rows;
          const p = rows.proposals[target.id];
          if (p !== undefined) next = proposalForm(p, Object.values(rows.proposal_lines).filter((l) => l.document_id === p.id), state.today);
        } else if (target.enquiryId !== undefined && target.enquiryId !== null) {
          await ensureRows("enquiries", [target.enquiryId]).catch(() => undefined);
          const enquiry = useDesk.getState().rows.enquiries[target.enquiryId];
          if (enquiry !== undefined) {
            // The client already on file with this address, if there is one.
            const email = (enquiry.email ?? "").trim();
            const found = email === "" ? [] : await loadWhere("clients", { column: "email", op: "ilike", value: email }, undefined, 1).catch(() => []);
            next = enquiryProposalForm(enquiry, state.today, {
              existing: found[0] ?? null,
              termsVersionId,
              title: enquiry.trade === null || enquiry.trade.trim() === "" ? "" : t("composer.enquiryTitle", { trade: enquiry.trade.trim() }),
            });
          }
        } else {
          next = newProposalForm(state.today, { clientId: target.clientId ?? null, termsVersionId });
        }
      } else if (target.id !== null) {
        await loadInvoice(target.id).catch(() => undefined);
        const rows = useDesk.getState().rows;
        const inv = rows.invoices[target.id];
        if (inv !== undefined) next = invoiceForm(inv, Object.values(rows.invoice_lines).filter((l) => l.document_id === inv.id));
      } else {
        next = newInvoiceForm({ clientId: target.clientId ?? null, projectId: target.projectId ?? null });
      }
      if (!live) return;
      const fill = pendingFill.current;
      pendingFill.current = null;
      setForm(next !== null && fill !== null && next.kind === "proposal" ? filledProposal(next, fill) : next);
      setFormFor(target);
      setMissing(next === null);
    };
    if (!sameTarget(target, formFor)) void start();
    return () => {
      live = false;
    };
  }, [target]);

  // The client's projects, for an invoice's "Against a project".
  const clientId = form?.clientId ?? null;
  useEffect(() => {
    if (form?.kind !== "invoice" || clientId === null) return;
    void loadWhere("projects", { column: "client_id", op: "eq", value: clientId }, "id.desc", 50).catch(() => undefined);
  }, [form?.kind, clientId]);

  const isInvoice = form?.kind === "invoice";
  const doc = form === null || form.id === null ? undefined : isInvoice ? rows.invoices[form.id] : rows.proposals[form.id];
  const client = form?.clientId === null || form?.clientId === undefined ? undefined : rows.clients[form.clientId];
  const who = client ?? (form?.newClient === null || form?.newClient === undefined ? undefined : { company: form.newClient.company, contact_name: form.newClient.contact_name, trade: form.newClient.trade ?? null });
  const currency = doc?.currency ?? null;
  const scale = minorUnits(currency ?? undefined);
  const tax = useMemo(() => previewTax(doc, client, rows), [doc, client, rows]);
  const figures = useMemo(
    () => documentFigures((form?.lines ?? []).map((l) => ({ qty: readAmount(l.qty), rate: readAmount(l.rate), discount: readAmount(l.discount) })), tax.rate, scale),
    [form?.lines, tax.rate, scale],
  );

  /*
   * The website demo's "Fill a sample proposal": a proposal being written
   * takes the fill; anything else (nothing open, an invoice, a sent document)
   * starts a new proposal for the client and fills it once it opens.
   */
  useDemoSignal("composer.fill", (fill) => {
    const writing = form !== null && form.kind === "proposal" && sameTarget(target, formFor) && (doc === undefined || doc.status === "draft");
    if (writing) {
      setForm(filledProposal(form, fill));
      return;
    }
    const client = Number(fill["client_id"] ?? "");
    pendingFill.current = fill;
    openComposer({ kind: "proposal", id: null, ...(Number.isInteger(client) && client > 0 ? { clientId: client } : {}) });
  });

  if (target === null || missing) {
    return (
      <section className="screen ol-screen cmp" data-screen="composer" aria-labelledby="cmp-missing">
        <div className="card">
          <Empty title={<span id="cmp-missing">{t("composer.missing")}</span>} body={t("composer.missingBody")} />
        </div>
      </section>
    );
  }
  if (form === null || !sameTarget(target, formFor)) {
    return (
      <section className="screen ol-screen cmp" data-screen="composer" aria-labelledby="cmp-loading" aria-busy="true">
        <div className="card">
          <Empty title={<span id="cmp-loading">{t("common.loading")}</span>} />
        </div>
      </section>
    );
  }

  // A document already sent can't be written in any more.
  if (doc !== undefined && doc.status !== "draft") {
    return (
      <section className="screen ol-screen cmp" data-screen="composer" aria-labelledby="cmp-sent">
        <div className="card">
          <Empty
            title={<span id="cmp-sent">{t("composer.notDraft", { number: doc.number ?? "" })}</span>}
            body={
              <Button size="small" onClick={() => open(isInvoice ? "invoice" : "proposal", doc.id)}>
                {t("composer.openIt")}
              </Button>
            }
          />
        </div>
      </section>
    );
  }

  const set = (patch: Partial<ComposerForm>) => setForm((f) => (f === null ? f : { ...f, ...patch }));
  const setLine = (key: string, patch: Partial<LineForm>) => setForm((f) => (f === null ? f : { ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const problems = form.lines.map(lineProblem);
  const block = sendBlock(form);
  const noClient = form.clientId === null && form.newClient === null;
  const sendOff = block !== null || noClient || busy !== null;
  const firstName = first(who?.contact_name);
  const foot = noClient ? t("composer.footNoClient") : block === "noGoodLine" ? t("composer.footNoLine") : block === "problems" ? t("composer.footProblems") : t("composer.footSend", { first: firstName });
  const terms: ClientTerms | null = form.terms ?? (doc as Invoice | undefined)?.terms ?? client?.terms ?? null;
  const projectsOfClient = Object.values(rows.projects).filter((p) => p.client_id === form.clientId).sort((a, b) => b.id - a.id);
  const newClientFromEnquiry = form.newClient !== null && form.clientId === null;

  /** After a save: say so, and show the document with Adminium's figures. */
  function landed(out: Outcome<Proposal> | Outcome<Invoice>, sent: boolean): void {
    if (form === null) return;
    if (!out.ok) {
      setUnfinished(out.unfinished === null ? null : { send: sent, job: out.unfinished as Unfinished<unknown> });
      setError(t(refusalKey(out.reason), { id: form.number ?? "" }));
      return;
    }
    setUnfinished(null);
    const saved = out.value;
    if (sent) toast(t("composer.toast.sent", { first: firstName }), { icon: "send" });
    else if (newClientFromEnquiry) toast(t("composer.toast.enquiryClient", { company: form.newClient?.company ?? "" }), { icon: "user-round-plus" });
    else toast(t("composer.toast.saved"), { icon: "save" });
    useUi.setState({ composer: null });
    open(isInvoice ? "invoice" : "proposal", saved.id);
  }

  async function save(send: boolean): Promise<void> {
    if (form === null || busy !== null) return;
    if (send && sendOff) return;
    setError(null);
    if (isInvoice) {
      const draft = toInvoiceDraft(form);
      if (draft === null) return setError(t("composer.footNoClient"));
      setBusy(send ? "send" : "save");
      const out = await (send ? sendInvoice(draft) : saveInvoice(draft));
      setBusy(null);
      landed(out, send);
    } else {
      const draft = toProposalDraft(form);
      if (draft === null) return setError(t("composer.footNoClient"));
      setBusy(send ? "send" : "save");
      const replacedReason = form.number === null ? t("composer.replacedByRevision") : t("composer.replacedBy", { number: form.number });
      const out = await (send ? sendProposal(draft, { replacedReason }) : saveProposal(draft));
      setBusy(null);
      landed(out, send);
    }
  }

  async function finish(): Promise<void> {
    if (unfinished === null || busy !== null) return;
    setBusy(unfinished.send ? "send" : "save");
    setError(null);
    const out = (await unfinished.job.resume()) as Outcome<Proposal> | Outcome<Invoice>;
    setBusy(null);
    landed(out, unfinished.send);
  }

  const lineLabel = (n: number) => t("composer.lineDescription", { n });

  return (
    <section className="screen ol-screen cmp" data-screen="composer" aria-labelledby="cmp-title">
      <div className="cmp-top">
        <button type="button" className="btn btn--small ol-gi" onClick={() => go(isInvoice ? "invoices" : "proposals")}>
          <ArrowLeft size={14} aria-hidden="true" />
          {t(isInvoice ? "composer.backInvoices" : "composer.backProposals")}
        </button>
        <h1 className="cmp-id" id="cmp-title">
          {form.number ?? t(form.id === null ? (isInvoice ? "composer.newInvoice" : "composer.newProposal") : isInvoice ? "composer.draftInvoice" : "composer.draftProposal")}
        </h1>
        <StatusPill status={form.id === null && !isInvoice ? "new" : "draft"} />
      </div>

      <div className="cmp-cols">
        <div className="cmp-main">
          <section className="card cmp-card" aria-labelledby="cmp-who">
            <h2 className="kicker cmp-h2" id="cmp-who">
              {t("composer.whoWhat")}
            </h2>
            <div className="cmp-grid">
              <label className="cmp-field">
                <span className="cmp-label">{t("composer.client")}</span>
                <select
                  className="input ol-fld cmp-input"
                  value={form.clientId === null ? (form.newClient === null ? "" : "new") : String(form.clientId)}
                  onChange={(e) => {
                    const v = e.target.value;
                    set(v === "new" || v === "" ? { clientId: null } : { clientId: Number(v), projectId: null });
                  }}
                >
                  {form.clientId === null && form.newClient === null && <option value="">{t("composer.chooseClient")}</option>}
                  {form.newClient !== null && <option value="new">{t("composer.newClient", { company: form.newClient.company })}</option>}
                  {[...clients]
                    .sort((a, b) => a.company.localeCompare(b.company, locale))
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.trade === null || c.trade.trim() === "" ? c.company : t("composer.clientOption", { company: c.company, trade: c.trade })}
                      </option>
                    ))}
                </select>
              </label>
              {isInvoice ? (
                <label className="cmp-field">
                  <span className="cmp-label">{t("composer.project")}</span>
                  <select className="input ol-fld cmp-input" value={form.projectId === null ? "" : String(form.projectId)} onChange={(e) => set({ projectId: e.target.value === "" ? null : Number(e.target.value) })}>
                    <option value="">{t("composer.noProject")}</option>
                    {projectsOfClient.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.number === null ? p.name : `${p.number} · ${p.name}`}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="cmp-field">
                  <span className="cmp-label">
                    {t("composer.validUntil")}
                    {form.validUntil === addDays(today, VALID_DAYS) && <span className="cmp-label-sub">{t("composer.threeWeeks")}</span>}
                  </span>
                  <input className="input ol-fld cmp-input cmp-mono" type="date" min={today} value={form.validUntil ?? ""} onChange={(e) => set({ validUntil: e.target.value === "" ? null : e.target.value })} />
                </label>
              )}
            </div>
            {isInvoice && (
              <div className="cmp-chips-row">
                <span className="cmp-label" id="cmp-terms">
                  {t("composer.terms")}
                </span>
                <div className="cmp-chips-line">
                  <div className="cmp-chips" role="group" aria-labelledby="cmp-terms">
                    {TERMS.map((k) => (
                      <button key={k} type="button" className="cmp-chip ol-chip" aria-pressed={terms === k} onClick={() => set({ terms: k })}>
                        {t(`composer.terms.${k}` as MessageKey)}
                      </button>
                    ))}
                  </div>
                  {terms !== null && <span className="cmp-due">{t("composer.dueIfSent", { date: dayLabel(addDays(today, TERM_DAYS[terms]), locale, "short") })}</span>}
                </div>
              </div>
            )}
            <label className="cmp-field cmp-title-field">
              <span className="cmp-label">{t("composer.title")}</span>
              <input className="input ol-fld cmp-input cmp-title" value={form.title} placeholder={t(isInvoice ? "composer.titlePhInvoice" : "composer.titlePhProposal")} onChange={(e) => set({ title: e.target.value })} />
            </label>
            {!isInvoice && (
              <div className="cmp-chips-row">
                <span className="cmp-label" id="cmp-split">
                  {t("composer.split")}
                </span>
                <div className="cmp-chips" role="group" aria-labelledby="cmp-split">
                  {SPLITS.map((k) => (
                    <button key={k} type="button" className="cmp-chip ol-chip" aria-pressed={form.split === k} onClick={() => set({ split: k })}>
                      {t(`proposals.split.${k}` as MessageKey)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>

          {!isInvoice && (
            <section className="card cmp-card" aria-labelledby="cmp-scope">
              <div className="cmp-card-head">
                <h2 className="kicker cmp-h2" id="cmp-scope">
                  {t("composer.scope")}
                </h2>
                <Button size="small" icon={Plus} onClick={() => set({ scope: [...form.scope, ""] })}>
                  {t("composer.addParagraph")}
                </Button>
              </div>
              <div className="cmp-scope">
                {form.scope.map((para, i) => (
                  <div key={i} className="cmp-para">
                    <textarea
                      className="input ol-fld cmp-para-text"
                      rows={3}
                      value={para}
                      aria-label={t("composer.paragraph", { n: i + 1 })}
                      placeholder={t("composer.scopePh")}
                      onChange={(e) => set({ scope: form.scope.map((s, j) => (j === i ? e.target.value : s)) })}
                    />
                    <button
                      type="button"
                      className="icon-btn ol-gi cmp-del"
                      aria-label={t("composer.removeParagraph", { n: i + 1 })}
                      title={t("composer.removeParagraph", { n: i + 1 })}
                      onClick={() => {
                        const rest = form.scope.filter((_, j) => j !== i);
                        set({ scope: rest.length === 0 ? [""] : rest });
                      }}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card cmp-card" aria-labelledby="cmp-lines">
            <div className="cmp-card-head">
              <h2 className="kicker cmp-h2" id="cmp-lines">
                {t("composer.lines")}
              </h2>
              <Button size="small" icon={Plus} onClick={() => set({ lines: [...form.lines, blankLine()] })}>
                {t("composer.addLine")}
              </Button>
            </div>
            <div className="cmp-lines-head" aria-hidden="true">
              <span>{t("lines.description")}</span>
              <span>{t("lines.qty")}</span>
              <span>{t("lines.rate")}</span>
              <span>{t("composer.discount")}</span>
              <span>{t("lines.amount")}</span>
              <span />
            </div>
            <div className="cmp-lines">
              {form.lines.map((line, i) => {
                const problem = problems[i] ?? null;
                const errId = `cmp-line-${line.key}-err`;
                const bad = (k: "description" | "qty" | "rate" | "discount") =>
                  problem !== null && (problem === k || (k === "discount" && (problem === "discountNegative" || problem === "discountOver"))) ? true : undefined;
                return (
                  <div key={line.key} className="cmp-line-wrap">
                    <div className="cmp-line">
                      <input
                        className="input ol-fld cmp-input cmp-desc"
                        value={line.description}
                        placeholder={t("composer.descPh")}
                        aria-label={lineLabel(i + 1)}
                        aria-invalid={bad("description")}
                        aria-describedby={problem === null ? undefined : errId}
                        onChange={(e) => setLine(line.key, { description: e.target.value })}
                      />
                      <input
                        className="input ol-fld cmp-input cmp-num"
                        value={line.qty}
                        inputMode="decimal"
                        placeholder={t("composer.qtyPh")}
                        aria-label={t("composer.qtyLabel", { n: i + 1 })}
                        aria-invalid={bad("qty")}
                        aria-describedby={problem === null ? undefined : errId}
                        onChange={(e) => setLine(line.key, { qty: e.target.value })}
                      />
                      <input
                        className="input ol-fld cmp-input cmp-num"
                        value={line.rate}
                        inputMode="decimal"
                        placeholder={t("composer.ratePh")}
                        aria-label={t("composer.rateLabel", { n: i + 1 })}
                        aria-invalid={bad("rate")}
                        aria-describedby={problem === null ? undefined : errId}
                        onChange={(e) => setLine(line.key, { rate: e.target.value })}
                      />
                      <input
                        className="input ol-fld cmp-input cmp-num"
                        value={line.discount}
                        inputMode="decimal"
                        placeholder={t("composer.discPh")}
                        aria-label={t("composer.discLabel", { n: i + 1 })}
                        aria-invalid={bad("discount")}
                        aria-describedby={problem === null ? undefined : errId}
                        onChange={(e) => setLine(line.key, { discount: e.target.value })}
                      />
                      <span className="cmp-amount">
                        <Money value={figures.amounts[i] ?? null} currency={currency} />
                      </span>
                      <button
                        type="button"
                        className="icon-btn ol-gi cmp-del"
                        aria-label={t("composer.removeLine", { n: i + 1 })}
                        title={t("composer.removeLine", { n: i + 1 })}
                        onClick={() => {
                          const rest = form.lines.filter((l) => l.key !== line.key);
                          set({ lines: rest.length === 0 ? [blankLine()] : rest });
                        }}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                    {problem !== null && (
                      <span className="cmp-problem" id={errId}>
                        <CircleAlert size={13} aria-hidden="true" />
                        {t(`composer.problem.${problem}` as MessageKey)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <aside className="cmp-rail" aria-labelledby="cmp-totals">
          <div className="card cmp-rail-card">
            <div className="cmp-rail-head">
              <span className="kicker" id="cmp-totals">
                {t("composer.totals")}
              </span>
              {form.number !== null && <span className="cmp-rail-id">{form.number}</span>}
            </div>
            <dl className="cmp-sums">
              <div className="cmp-sum">
                <dt>{t("lines.subtotal")}</dt>
                <dd>
                  <Money value={figures.subtotal} currency={currency} />
                </dd>
              </div>
              <div className="cmp-sum">
                <dt>{tax.rate === null ? (tax.name ?? t("composer.tax")) : t("lines.tax", { name: tax.name ?? t("composer.tax"), rate: number(Number(tax.rate), { maximumFractionDigits: 3 }) })}</dt>
                <dd>{figures.tax === null ? <span className="cmp-later">{t("composer.taxLater")}</span> : <Money value={figures.tax} currency={currency} />}</dd>
              </div>
              <div className="cmp-sum cmp-sum--total">
                <dt>{t("lines.total")}</dt>
                <dd>
                  <Money value={figures.total} currency={currency} />
                </dd>
              </div>
            </dl>
            <div className="cmp-to">
              <span className="cmp-to-name">{who === undefined ? t("composer.footNoClient") : t("composer.toLine", { contact: who.contact_name, company: who.company })}</span>
              <span className="cmp-to-sub">
                {isInvoice
                  ? terms === null
                    ? (form.number ?? "")
                    : form.number === null
                      ? t(`composer.terms.${terms}` as MessageKey)
                      : t("composer.invoiceLine", { number: form.number, terms: t(`composer.terms.${terms}` as MessageKey) })
                  : form.validUntil === null
                    ? ""
                    : t("composer.validLine", { date: dayLabel(form.validUntil, locale, "long") })}
              </span>
            </div>
            {unfinished !== null && <UnfinishedLine unfinished={unfinished.job} busy={busy !== null} onFinish={() => void finish()} />}
            {error !== null && unfinished === null && <Alert>{error}</Alert>}
            <Button kind="primary" size="wide" icon={Send} busy={busy === "send"} disabled={sendOff} aria-describedby="cmp-foot" onClick={() => void save(true)}>
              {firstName === "" ? t("composer.sendPlain") : t("composer.send", { first: firstName })}
            </Button>
            <Button className="cmp-save" icon={Save} busy={busy === "save"} disabled={busy !== null || noClient} onClick={() => void save(false)}>
              {t("composer.saveDraft")}
            </Button>
            <span className="cmp-foot" id="cmp-foot">
              {foot}
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}
