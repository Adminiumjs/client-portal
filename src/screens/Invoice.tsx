/**
 * One invoice: its number, pill and how late it is; what the client says they
 * paid; its title; the void line; who it is for, when it was issued and is
 * due, its terms and the stage of a proposal it bills; its lines and stored
 * totals; its payments; and the reminders ladder it is chased on.
 *
 * What may be done follows its state, and who is signed in:
 *   a draft        Send invoice, Edit (the composer); a studio manager may
 *                  discard it — it keeps its number, and the client never sees
 *                  it
 *   sent, open     Record payment; Printed copy; Preview as the client; a
 *                  studio manager may void it while nothing is paid
 *   paid           Printed copy; Preview as the client
 *   void           the void line, and its printed copy (marked void)
 * A studio manager may void a recorded payment (the row stays, struck through,
 * and the balance goes back up).
 *
 * Every figure is Adminium's: totals, paid and balance are read back after
 * each payment or void. The running balance down the ledger is the stored
 * total less each unvoided payment; the last line is the stored balance.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUpRight, Ban, Banknote, Eye, HandCoins, Printer, Send, SquarePen, Trash2 } from "lucide-react";

import { Alert, Button, DayText, LinesTable, Money, Pill, StatusPill, When } from "../components/ui.tsx";
import type { Invoice as InvoiceRow, InvoiceLadder, Payment } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { dayLabel } from "../lib/dates.ts";
import { isPositive } from "../lib/money.ts";
import { sendSavedInvoice, setLadder } from "../state/actions.ts";
import { loadInvoice, useDesk, useManager, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { previewClient } from "../state/preview.ts";
import { openSheet } from "../state/sheets.ts";
import { go, open, openComposer, toast, useUi } from "../state/ui.ts";
import { daysOverdue, invoiceWord, isDiscarded, isOpen, ledger, type LedgerRow } from "./invoices/figures.ts";
import { openPrint } from "./print/target.ts";
import { firstName, LADDERS } from "./invoices/words.ts";

export default function Invoice() {
  const { t, number, money, locale } = useI18n();
  const id = useUi((s) => s.selected.invoice);
  const inv = useRow("invoices", id);
  const day = useDesk((s) => s.today) || today();
  const manager = useManager();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    setLoading(true);
    setError(null);
    void loadInvoice(id)
      .catch(() => undefined)
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [id]);

  const client = useRow("clients", inv?.client_id);
  const project = useRow("projects", inv?.project_id);
  const quote = useRow("proposals", inv?.from_quote_id ?? inv?.proposal_id);
  const allLines = useRows("invoice_lines");
  const allPayments = useRows("payments");

  if (inv === undefined) {
    return (
      <section className="screen ol-screen inv-page" data-screen="invoice" aria-labelledby="invoice-title">
        <BackToInvoices />
        <h1 className="screen-title" id="invoice-title">
          {loading && id !== null ? t("common.loading") : t("invoices.page.missing")}
        </h1>
      </section>
    );
  }

  const word = invoiceWord(inv, day);
  const late = daysOverdue(inv, day);
  const lines = allLines.filter((l) => l.document_id === inv.id).sort((a, b) => a.position - b.position || a.id - b.id);
  const rows = ledger(inv, allPayments);
  const first = firstName(client?.contact_name);
  const draft = inv.status === "draft";
  const sent = inv.status === "sent";
  const discarded = isDiscarded(inv);
  const claimShown = sent && inv.client_paid_at !== null && isOpen(inv);

  const send = async () => {
    setSending(true);
    setError(null);
    const out = await sendSavedInvoice(inv.id);
    setSending(false);
    if (out.ok) toast(t("invoices.page.sentToast", { first }), { icon: "send" });
    else setError(t(refusalKey(out.reason), { id: inv.number ?? "" }));
  };

  const ladder = async (next: InvoiceLadder) => {
    if (next === inv.ladder) return;
    const out = await setLadder(inv.id, next);
    if (out.ok) toast(t("invoices.page.ladderToast", { ladder: t(`invoices.ladder.${next}`), id: inv.number ?? "" }), { icon: "bell-ring" });
    else setError(t(refusalKey(out.reason), { id: inv.number ?? "" }));
  };

  return (
    <section className="screen ol-screen inv-page" data-screen="invoice" aria-labelledby="invoice-title">
      <div className="inv-bar">
        <BackToInvoices />
        <div className="inv-actions">
          {sent && isOpen(inv) && (
            <Button kind="primary" icon={Banknote} onClick={() => openSheet({ kind: "recordPayment", invoiceId: inv.id })}>
              {t("invoices.page.record")}
            </Button>
          )}
          {draft && (
            <>
              <Button kind="primary" icon={Send} busy={sending} onClick={() => void send()}>
                {t("invoices.page.send")}
              </Button>
              <Button icon={SquarePen} onClick={() => openComposer({ kind: "invoice", id: inv.id })}>
                {t("invoices.page.edit")}
              </Button>
            </>
          )}
          {(sent || (inv.status === "void" && !discarded)) && (
            <Button icon={Printer} onClick={() => openPrint({ kind: "invoice", id: inv.id })}>
              {t("invoices.page.print")}
            </Button>
          )}
          {sent && (
            <Button icon={Eye} onClick={() => void previewClient(inv.client_id, "invoice", "invoice")}>
              {t("invoices.page.preview")}
            </Button>
          )}
          {manager && sent && !isPositive(inv.paid) && (
            <Button kind="danger" icon={Ban} onClick={() => openSheet({ kind: "voidInvoice", invoiceId: inv.id })}>
              {t("invoices.page.void")}
            </Button>
          )}
          {manager && draft && (
            <Button kind="danger" icon={Trash2} onClick={() => openSheet({ kind: "voidInvoice", invoiceId: inv.id })}>
              {t("invoices.page.discard")}
            </Button>
          )}
        </div>
      </div>
      {error !== null && <Alert>{error}</Alert>}

      <article className="card inv-doc">
        <header className="inv-head">
          <div className="inv-head-row">
            <span className="inv-number">{inv.number ?? t("invoices.unnumbered")}</span>
            <StatusPill status={word} />
            {late > 0 && (
              <Pill tone={late > 30 ? "danger" : "warn"} mono>
                {t("invoices.age.pastDue", { count: number(late) }, late)}
              </Pill>
            )}
            {claimShown && (
              <>
                <span className="inv-claim">
                  <HandCoins size={13} aria-hidden="true" />
                  {inv.client_paid_amount !== null && isPositive(inv.client_paid_amount)
                    ? t("invoices.page.claimAmount", { first, amount: money(inv.client_paid_amount, inv.currency), day: dayLabel(inv.client_paid_on, locale) })
                    : t("invoices.page.claim", { first, day: dayLabel(inv.client_paid_on, locale) })}
                </span>
                <Button size="small" className="inv-claim-record" onClick={() => openSheet({ kind: "recordPayment", invoiceId: inv.id, prefill: { ...(inv.client_paid_amount === null ? {} : { amount: inv.client_paid_amount }), ...(inv.client_paid_on === null ? {} : { on: inv.client_paid_on }) } })}>
                  {t("invoices.page.recordIt")}
                </Button>
              </>
            )}
          </div>
          {claimShown && inv.client_paid_note !== null && inv.client_paid_note.trim() !== "" && <p className="inv-claim-note">“{inv.client_paid_note}”</p>}
          <h1 className="inv-title" id="invoice-title">
            {inv.title ?? t("invoices.untitled")}
          </h1>
          {inv.status === "void" && (
            <div className="inv-void" role="note">
              <Ban size={15} aria-hidden="true" />
              {discarded ? (
                <span>{t("invoices.page.discardedLine")}</span>
              ) : (
                <span>
                  {t("invoices.page.voidedOn")} <When at={inv.voided_at} opts={{ day: "numeric", month: "short", year: "numeric" }} />
                  {inv.void_reason !== null && inv.void_reason.trim() !== "" && <> — {inv.void_reason}</>}
                </span>
              )}
            </div>
          )}
          <dl className="inv-facts">
            <Fact label={t("invoices.page.client")}>
              <button type="button" className="inv-link" onClick={() => open("client", inv.client_id)}>
                {client?.company ?? ""}
              </button>
            </Fact>
            <Fact label={t("invoices.page.issued")} mono>
              {inv.issued_on === null ? t("invoices.due.notSent") : <DayText day={inv.issued_on} style="long" />}
            </Fact>
            <Fact label={t("invoices.page.due")} mono>
              {draft || inv.due_on === null ? t("invoices.due.notSent") : <DayText day={inv.due_on} style="long" />}
            </Fact>
            <Fact label={t("invoices.page.terms")}>{inv.terms === null ? "—" : t(`invoices.terms.${inv.terms}`)}</Fact>
            {project !== undefined && (
              <Fact label={t("invoices.page.project")}>
                <button type="button" className="inv-link" onClick={() => open("project", project.id)}>
                  {project.number ?? ""} {project.name}
                </button>
              </Fact>
            )}
            {inv.from_quote_id !== null && quote !== undefined && (
              <Fact label={t("invoices.page.stage")}>
                <button type="button" className="inv-link" onClick={() => open("proposal", quote.id)}>
                  {t("invoices.page.stageLine", { stage: inv.stage ?? "", share: inv.share_pct === null ? "" : number(Number(inv.share_pct), { maximumFractionDigits: 2 }), quote: quote.number ?? quote.title })}
                </button>
              </Fact>
            )}
          </dl>
        </header>

        <div className="inv-body">
          <section aria-labelledby="inv-lines-h">
            <h2 className="inv-section-h" id="inv-lines-h">
              {t("invoices.page.lines")}
            </h2>
            <LinesTable
              lines={lines.map((l) => ({ key: l.id, description: l.description ?? "", qty: l.qty, rate: l.rate, amount: l.amount, discount: l.discount_kind === "amount" ? l.discount : null }))}
              subtotal={inv.subtotal}
              tax={inv.tax}
              taxName={inv.tax_name}
              taxRate={inv.tax_rate}
              total={inv.total}
              currency={inv.currency}
            />
          </section>

          <section aria-labelledby="inv-pay-h">
            <h2 className="inv-section-h" id="inv-pay-h">
              {t("invoices.page.payments")}
            </h2>
            <Ledger invoice={inv} rows={rows} manager={manager} overdue={late > 0} />
          </section>

          {sent && isOpen(inv) && (
            <section aria-labelledby="inv-ladder-h" className="inv-ladder">
              <h2 className="inv-section-h" id="inv-ladder-h">
                {t("invoices.page.reminders")}
              </h2>
              <div className="inv-ladder-row">
                <div className="inv-seg" role="group" aria-labelledby="inv-ladder-h">
                  {LADDERS.map((l) => (
                    <button key={l} type="button" className="inv-seg-chip ol-chip" aria-pressed={(inv.ladder ?? "standard") === l} onClick={() => void ladder(l)}>
                      {t(`invoices.ladder.${l}`)}
                    </button>
                  ))}
                </div>
                <button type="button" className="inv-link inv-ladder-go" onClick={() => go("chasing")}>
                  {t("invoices.page.openChasing")}
                  <ArrowUpRight size={13} aria-hidden="true" />
                </button>
              </div>
            </section>
          )}
        </div>
      </article>
    </section>
  );
}

function BackToInvoices() {
  const { t } = useI18n();
  return (
    <Button size="small" icon={ArrowLeft} className="inv-back" onClick={() => go("invoices")}>
      {t("invoices.page.back")}
    </Button>
  );
}

function Fact({ label, mono = false, children }: { label: string; mono?: boolean; children: React.ReactNode }) {
  return (
    <div className="inv-fact">
      <dt>{label}</dt>
      <dd className={mono ? "inv-fact-mono" : undefined}>{children}</dd>
    </div>
  );
}

/** The ledger: the invoice total, each payment (a voided one struck through), then the stored balance. */
function Ledger({ invoice, rows, manager, overdue }: { invoice: InvoiceRow; rows: LedgerRow[]; manager: boolean; overdue: boolean }) {
  const { t, money, locale } = useI18n();
  const cur = invoice.currency;
  return (
    <div className="inv-ledger" role="table" aria-label={t("invoices.page.payments")}>
      <div className="inv-ledger-head" role="row">
        <span role="columnheader" className="inv-ledger-date">
          {t("invoices.ledger.date")}
        </span>
        <span role="columnheader">{t("invoices.ledger.entry")}</span>
        <span role="columnheader" className="inv-ledger-num inv-ledger-amount">
          {t("invoices.ledger.amount")}
        </span>
        <span role="columnheader" className="inv-ledger-num">
          {t("invoices.ledger.balance")}
        </span>
      </div>
      {rows.map((row) => {
        if (row.kind === "total") {
          return (
            <div className="inv-ledger-row" role="row" key="total">
              <span role="cell" className="inv-ledger-date">
                <DayText day={row.day} />
              </span>
              <span role="cell" className="inv-ledger-entry">
                <span className="inv-ledger-label">{t("invoices.ledger.total")}</span>
                <span className="inv-ledger-sub">
                  {invoice.number ?? ""}
                  {invoice.terms === null ? "" : ` · ${t(`invoices.terms.${invoice.terms}`)}`}
                  <span className="inv-ledger-narrow">
                    {row.day === null ? "" : ` · ${dayLabel(row.day, locale)}`} · {money(row.amount, cur)}
                  </span>
                </span>
              </span>
              <span role="cell" className="inv-ledger-num inv-ledger-amount inv-ledger-muted">
                <Money value={row.amount} currency={cur} />
              </span>
              <span role="cell" className="inv-ledger-num inv-ledger-strong">
                <Money value={row.balance} currency={cur} />
              </span>
            </div>
          );
        }
        if (row.kind === "payment") return <PaymentRow key={`p${String(row.payment.id)}`} payment={row.payment} balance={row.balance} currency={cur} manager={manager} />;
        const settled = row.settled;
        return (
          <div className="inv-ledger-row inv-ledger-close" role="row" key="closing">
            <span role="cell" className="inv-ledger-date" />
            <span role="cell" className="inv-ledger-entry">
              <span className="inv-ledger-label inv-ledger-label--big">{settled ? t("invoices.ledger.settled") : t("invoices.ledger.due")}</span>
              <span className="inv-ledger-sub">
                {settled ? (
                  <>
                    {t("invoices.ledger.paidOn")} <DayText day={row.lastPaid} style="long" />
                  </>
                ) : invoice.status !== "sent" ? (
                  t("invoices.ledger.notSentYet")
                ) : (
                  <>
                    {t("invoices.ledger.dueOn")} <DayText day={invoice.due_on} style="long" />
                  </>
                )}
              </span>
            </span>
            <span role="cell" className="inv-ledger-num inv-ledger-amount" />
            <span role="cell" className={`inv-ledger-num inv-ledger-balance${settled ? " inv-ledger-balance--pos" : overdue ? " inv-ledger-balance--danger" : ""}`}>
              {invoice.status === "void" ? t("status.void") : money(row.balance, cur)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function PaymentRow({ payment, balance, currency, manager }: { payment: Payment; balance: string | null; currency: string | null; manager: boolean }) {
  const { t, money, locale } = useI18n();
  const voided = payment.voided;
  const amount = money(payment.amount, currency);
  const on = dayLabel(payment.paid_on, locale);
  return (
    <div className={`inv-ledger-row${voided ? " inv-ledger-row--voided" : ""}`} role="row">
      <span role="cell" className="inv-ledger-date">
        <DayText day={payment.paid_on} />
      </span>
      <span role="cell" className="inv-ledger-entry">
        <span className="inv-ledger-entry-text">
          <span className="inv-ledger-label">{voided ? t("invoices.ledger.voided") : t("invoices.ledger.received")}</span>
          <span className="inv-ledger-sub">
            {t(`invoices.method.${payment.method}`)}
            {payment.method_note !== null && payment.method_note !== "" ? ` (${payment.method_note})` : ""}
            {payment.number !== null && (
              <>
                {" · "}
                <button type="button" className="inv-link inv-receipt" onClick={() => openPrint({ kind: "receipt", id: payment.id })} aria-label={t("invoices.ledger.receiptLabel", { number: payment.number })}>
                  {payment.number}
                </button>
              </>
            )}
            <span className="inv-ledger-narrow">
              {" · "}
              {on} · −{amount}
            </span>
            {voided && payment.void_reason !== null && payment.void_reason !== "" ? ` · ${payment.void_reason}` : ""}
          </span>
        </span>
        {!voided && manager && (
          <Button size="small" className="inv-ledger-void" onClick={() => openSheet({ kind: "voidPayment", paymentId: payment.id })} aria-label={t("invoices.ledger.voidLabel", { amount, day: on })}>
            {t("invoices.ledger.void")}
          </Button>
        )}
      </span>
      <span role="cell" className={`inv-ledger-num inv-ledger-amount ${voided ? "inv-ledger-struck" : "inv-ledger-pos"}`}>
        −{amount}
      </span>
      <span role="cell" className="inv-ledger-num inv-ledger-strong">
        {balance === null ? "" : money(balance, currency)}
      </span>
    </div>
  );
}

