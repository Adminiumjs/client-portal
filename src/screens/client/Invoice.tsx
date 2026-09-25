/**
 * One of the client's invoices: who it is from, when it was issued and is
 * due, what it covers (the stored lines and totals), the payments so far, and
 * the balance — then what the client can do about it.
 *
 *   open     How to pay (the studio's payment instructions, when Adminium
 *            serves them to the signed-in client) with the invoice number to
 *            quote; "I've sent a payment" — once, until the studio records a
 *            payment — after which the page says when they told the studio
 *   paid     settled on the day of its last payment; see the receipt
 *   void     voided on its day; nothing to pay (the reason is the studio's own)
 *
 * "Print or save as PDF" opens the add-on's own copy of the invoice.
 */
import { useEffect, useState } from "react";
import { Ban, CheckCheck, CircleAlert, Download, FileText, Hash, House, Send, X } from "lucide-react";

import { Button, LinesTable, StatusPill } from "../../components/ui.tsx";
import type { Id } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { studioZone, today } from "../../lib/clock.ts";
import { sentAPayment } from "../../state/clientActions.ts";
import { loadClientInvoice, usePortal, usePortalRow, usePortalRows } from "../../state/portal.ts";
import { openSheet } from "../../state/sheets.ts";
import { go, toast, useUi } from "../../state/ui.ts";
import NotFound from "./NotFound.tsx";
import { checkClaim, ledger } from "./invoice/model.ts";
import { AlsoWith, useDay, useSelected } from "./shared/bits.tsx";
import { byPosition, dayOf, daysPastDue, hasClaimed, invoiceState, isOpen, paymentsOf, settledOn } from "./shared/model.ts";
import { openInNewTab, portOrNull, sayRefusal, useOpened, useSignedIn } from "./shared/page.ts";

/**
 * The studio's payment instructions, as Adminium serves them to the
 * signed-in client (never before sign-in, never in the studio's preview).
 * Null when there are none or this server cannot say — the page then says
 * where else the details are.
 */
export async function readPaymentInstructions(): Promise<string | null> {
  if (useUi.getState().preview !== null) return null;
  try {
    const value = (await portOrNull()?.paymentInstructions?.()) ?? null;
    return value !== null && value.trim() !== "" ? value : null;
  } catch {
    return null;
  }
}

/** The instructions for the invoice on show, read when it opens. */
export function usePaymentInstructions(invoiceId: Id | null): string | null {
  const preview = useUi((s) => s.preview !== null);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (invoiceId === null) return;
    let live = true;
    void readPaymentInstructions().then((value) => {
      if (live) setText(value);
    });
    return () => {
      live = false;
    };
  }, [invoiceId, preview]);
  return text;
}

const METHOD_KEYS = { "bank-transfer": "client.method.bank", card: "client.method.card", cheque: "client.method.cheque", cash: "client.method.cash", other: "client.method.other" } as const;

export default function Invoice() {
  const { t, money, locale, number } = useI18n();
  const date = useDay();
  const signedIn = useSignedIn();
  const id = useSelected("invoice");
  const inv = usePortalRow("invoices", id);
  const ready = useOpened(id, loadClientInvoice, inv !== undefined);
  const studio = usePortal((s) => s.studio?.settings?.name ?? "");
  const allLines = usePortalRows("invoice_lines");
  const allPayments = usePortalRows("payments");
  const instructions = usePaymentInstructions(id);
  const [claim, setClaim] = useState<{ amount: string; on: string } | null>(null);
  const [claimError, setClaimError] = useState<{ field: "amount" | "on" | null; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setClaim(null);
    setClaimError(null);
  }, [id]);

  if (!signedIn) return null;
  if (!ready) return <section className="screen ol-screen cl-page" data-screen="client-invoice" aria-busy="true" />;
  if (inv === undefined || !(inv.status === "sent" || (inv.status === "void" && inv.issued_on !== null))) return <NotFound />;

  const day = today();
  const zone = studioZone();
  const state = invoiceState(inv, day);
  const open = isOpen(inv);
  const late = daysPastDue(inv, day);
  const lines = allLines.filter((l) => l.document_id === inv.id).sort(byPosition);
  const payments = paymentsOf(allPayments, inv.id);
  const rows = ledger(inv, allPayments);
  const settled = settledOn(inv, allPayments);
  const claimed = hasClaimed(inv);
  const claimedOn = dayOf(inv.client_paid_at, zone) ?? inv.client_paid_on;
  const termsWord = inv.terms === null ? "" : t(`client.terms.${inv.terms}`);

  const printCopy = () => {
    const port = portOrNull();
    if (port === null || useUi.getState().preview !== null) {
      toast(t("portal.previewBlocked"), { icon: "info" });
      return;
    }
    void openInNewTab(() => port.documentUrl("invoice", "invoices", inv.id, locale), t("client.blocked"));
  };

  const sendClaim = async () => {
    if (claim === null || busy) return;
    const checked = checkClaim({ amount: claim.amount, on: claim.on }, inv.issued_on, day);
    if (!checked.ok) {
      setClaimError({ field: checked.field, text: t(checked.key) });
      return;
    }
    setBusy(true);
    const out = await sentAPayment(inv.id, { on: checked.on, amount: checked.amount });
    setBusy(false);
    if (out.ok) {
      setClaim(null);
      setClaimError(null);
      toast(t("client.invoice.claimToast", { studio }), { icon: "mail" });
      return;
    }
    const said = sayRefusal(t, out);
    setClaimError(said === null ? null : { field: null, text: said });
    await loadClientInvoice(inv.id).catch(() => undefined);
  };

  return (
    <section className="screen ol-screen cl-page" data-screen="client-invoice" aria-labelledby="cl-invoice-title">
      <article className="cl-card cl-doc-card">
        <div className="cl-doc-head">
          <div className="cl-doc-line">
            <span className="cl-doc-number">{inv.number}</span>
            <StatusPill status={state} />
            {late > 0 && <span className="pill pill--danger pill--mono cl-age">{t("client.invoice.daysLate", { count: number(late) }, late)}</span>}
          </div>
          <h1 className="cl-doc-title" id="cl-invoice-title">
            {inv.title ?? inv.number}
          </h1>
          <dl className="cl-facts">
            <div>
              <dt>{t("client.invoice.from")}</dt>
              <dd>{studio}</dd>
            </div>
            <div>
              <dt>{t("client.invoice.issued")}</dt>
              <dd className="cl-mono-fact">{date(inv.issued_on, "long")}</dd>
            </div>
            <div>
              <dt>{t("client.invoice.due")}</dt>
              <dd className="cl-mono-fact">{date(inv.due_on, "long")}</dd>
            </div>
            <div>
              <dt>{t("client.invoice.terms")}</dt>
              <dd>{termsWord}</dd>
            </div>
          </dl>
        </div>
        <div className="cl-doc-body">
          <section aria-labelledby="cl-invoice-covers">
            <h2 className="cl-kicker" id="cl-invoice-covers">
              {t("client.invoice.covers")}
            </h2>
            <div className="cl-lines">
              <LinesTable
                lines={lines.map((l) => ({ key: l.id, description: l.description ?? "", qty: l.qty, rate: l.rate, amount: l.amount, discount: l.discount_kind === "amount" ? l.discount : null }))}
                subtotal={inv.subtotal}
                tax={inv.tax}
                taxName={inv.tax_name}
                taxRate={inv.tax_rate}
                total={inv.total}
                currency={inv.currency}
              />
            </div>
          </section>
          {payments.length > 0 && (
            <section aria-labelledby="cl-invoice-paid">
              <h2 className="cl-kicker" id="cl-invoice-paid">
                {t("client.invoice.paymentsSoFar")}
              </h2>
              <div className="cl-ledger" role="table" aria-labelledby="cl-invoice-paid">
                <div className="cl-ledger-row cl-ledger-head" role="row">
                  <span role="columnheader">{t("client.invoice.date")}</span>
                  <span role="columnheader">{t("client.invoice.entry")}</span>
                  <span role="columnheader" className="cl-num">
                    {t("lines.amount")}
                  </span>
                  <span role="columnheader" className="cl-num">
                    {t("client.invoice.balance")}
                  </span>
                </div>
                {rows.map((row) => (
                  <div className="cl-ledger-row" role="row" key={row.key}>
                    <span role="cell" className="cl-mono-small">
                      {date(row.day)}
                    </span>
                    <span role="cell" className="cl-ledger-entry">
                      <span className="cl-ledger-label">{row.kind === "total" ? t("client.invoice.total") : t("client.invoice.received")}</span>
                      <span className="cl-mono-small">
                        {row.kind === "total" ? [inv.number, termsWord].filter((x) => x !== null && x !== "").join(" · ") : t(METHOD_KEYS[row.method ?? "other"])}
                        {/* On a phone the date and amount columns fold away: the entry says them. */}
                        {row.kind === "payment" && (
                          <span className="cl-ledger-narrow">
                            {` · ${date(row.day)} · `}
                            <span className="money">{`−${money(row.amount, inv.currency)}`}</span>
                          </span>
                        )}
                      </span>
                    </span>
                    <span role="cell" className={`cl-num money${row.kind === "payment" ? " cl-tone-pos" : " cl-tone-muted"}`}>
                      {row.kind === "payment" ? `−${money(row.amount, inv.currency)}` : money(row.amount, inv.currency)}
                    </span>
                    <span role="cell" className="cl-num money">
                      {money(row.after, inv.currency)}
                    </span>
                  </div>
                ))}
                <div className="cl-ledger-row cl-ledger-foot" role="row">
                  <span role="cell" />
                  <span role="cell" className="cl-ledger-label">
                    {open ? t("client.invoice.balanceDue") : t("client.invoice.settledInFull")}
                  </span>
                  <span role="cell" />
                  <span role="cell" className={`cl-num money cl-ledger-balance${open ? (state === "overdue" ? " cl-tone-danger" : "") : " cl-tone-pos"}`}>
                    {money(inv.balance, inv.currency)}
                  </span>
                </div>
              </div>
            </section>
          )}
        </div>
      </article>

      <div className="cl-card cl-pad cl-stack">
        <div className="cl-balance">
          <span className="cl-balance-main">
            <span className="cl-label">{state === "void" ? t("status.void") : open ? t("client.invoice.balanceDue") : t("client.invoice.paidInFull")}</span>
            <span className={`cl-balance-value money cl-balance--${state === "void" ? "void" : state === "overdue" ? "late" : open ? "open" : "paid"}`}>{money(state === "void" ? inv.total : inv.balance, inv.currency)}</span>
          </span>
          {state !== "void" && (
            <span className="cl-mono-small">
              {open ? (late > 0 ? t("client.invoice.dueLineLate", { date: date(inv.due_on, "long"), count: number(late) }, late) : t("client.invoice.dueLine", { date: date(inv.due_on, "long") })) : t("client.invoice.settledLine", { date: date(settled ?? inv.due_on, "long") })}
            </span>
          )}
          <Button icon={Download} className="ol-noprint" onClick={printCopy}>
            {t("client.invoice.print")}
          </Button>
        </div>

        {open && (
          <>
            <div className="cl-howto">
              <span className="cl-kicker">{t("client.invoice.howToPay")}</span>
              <span className="cl-howto-text">{instructions ?? t("client.invoice.howToPayEmail")}</span>
              <span className="cl-ref">
                <Hash size={14} aria-hidden="true" />
                {t("client.invoice.reference", { id: inv.number ?? "" })}
              </span>
            </div>
            <span className="cl-fine">{t("client.invoice.partFine")}</span>
            {claimed ? (
              <div className="cl-note cl-note--info" role="status">
                <Send size={16} aria-hidden="true" />
                <span>{t("client.invoice.claimed", { date: date(claimedOn) })}</span>
              </div>
            ) : (
              <div className="cl-claim">
                <div className="cl-row">
                  <Button icon={Send} aria-expanded={claim !== null} onClick={() => setClaim({ amount: inv.balance ?? "", on: day })}>
                    {t("client.invoice.sentPayment")}
                  </Button>
                </div>
                {claim !== null && (
                  <div
                    className="cl-pop"
                    role="group"
                    aria-labelledby="cl-claim-title"
                    onKeyDown={(e) => {
                      if (e.key === "Escape") setClaim(null);
                    }}
                  >
                    <div className="cl-pop-head">
                      <span className="cl-pop-title" id="cl-claim-title">
                        {t("client.invoice.letKnow", { studio })}
                      </span>
                      <button type="button" className="icon-btn cl-pop-close ol-gi" aria-label={t("common.close")} title={t("common.close")} onClick={() => setClaim(null)}>
                        <X size={14} aria-hidden="true" />
                      </button>
                    </div>
                    <div className="cl-claim-grid">
                      <label className="cl-field">
                        <span className="cl-label">{t("client.invoice.amountOptional")}</span>
                        <input
                          className="input ol-fld cl-mono-input"
                          inputMode="decimal"
                          value={claim.amount}
                          autoFocus
                          aria-invalid={claimError?.field === "amount"}
                          aria-describedby={claimError !== null ? "cl-claim-err" : undefined}
                          onChange={(e) => {
                            setClaim({ ...claim, amount: e.target.value });
                            setClaimError(null);
                          }}
                        />
                      </label>
                      <label className="cl-field">
                        <span className="cl-label">{t("client.invoice.dateSent")}</span>
                        <input
                          className="input ol-fld cl-mono-input"
                          type="date"
                          max={day}
                          value={claim.on}
                          aria-invalid={claimError?.field === "on"}
                          aria-describedby={claimError !== null ? "cl-claim-err" : undefined}
                          onChange={(e) => {
                            setClaim({ ...claim, on: e.target.value });
                            setClaimError(null);
                          }}
                        />
                      </label>
                    </div>
                    {claimError !== null && (
                      <span className="cl-error" id="cl-claim-err" role="alert">
                        <CircleAlert size={14} aria-hidden="true" />
                        {claimError.text}
                      </span>
                    )}
                    <Button kind="primary" icon={Send} busy={busy} onClick={() => void sendClaim()}>
                      {t("client.invoice.tellStudio")}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {state === "paid" && (
          <div className="cl-settled">
            <span className="cl-settled-title">
              <CheckCheck size={18} aria-hidden="true" />
              {t("client.invoice.settledTitle", { id: inv.number ?? "", date: date(settled ?? inv.due_on, "long") })}
            </span>
            <span className="cl-muted cl-small">{t("client.invoice.disagree")}</span>
            <div className="cl-row-wrap">
              {payments.length > 0 && (
                <Button icon={FileText} onClick={() => openSheet({ kind: "receipt", paymentId: payments[payments.length - 1]!.id })}>
                  {t("client.invoice.seeReceipt")}
                </Button>
              )}
              <Button icon={House} onClick={() => go("home")}>
                {t("client.invoice.backHome")}
              </Button>
            </div>
          </div>
        )}

        {state === "void" && (
          <div className="cl-note cl-note--void" role="status">
            <Ban size={17} aria-hidden="true" />
            <span>{t("client.invoice.voided", { date: date(dayOf(inv.voided_at, zone) ?? inv.issued_on) })}</span>
          </div>
        )}
      </div>

      <AlsoWith current={{ kind: "invoice", id: inv.id }} />
    </section>
  );
}
