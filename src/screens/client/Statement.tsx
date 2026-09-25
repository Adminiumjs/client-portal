/**
 * Statement & receipts: everything the studio has invoiced the client and
 * everything they have paid, over a period (everything, this year, the last
 * twelve months), with what is still open — and a receipt for each payment.
 * "Print for your books" opens the add-on's own statement.
 */
import { useMemo, useState } from "react";
import { Banknote, FileText, Printer, ReceiptText } from "lucide-react";

import { Button, Filters, StatusPill } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { today } from "../../lib/clock.ts";
import { usePortal, usePortalRows } from "../../state/portal.ts";
import { openSheet } from "../../state/sheets.ts";
import { open, toast, useUi } from "../../state/ui.ts";
import { PERIODS, statement, type Period } from "./statement/model.ts";
import { Section, useDay } from "./shared/bits.tsx";
import { invoiceState, isOpen } from "./shared/model.ts";
import { openInNewTab, portOrNull, useSignedIn } from "./shared/page.ts";

const PERIOD_KEYS = { all: "client.statement.all", year: "client.statement.year", "12m": "client.statement.twelve" } as const;
const METHOD_KEYS = { "bank-transfer": "client.method.bank", card: "client.method.card", cheque: "client.method.cheque", cash: "client.method.cash", other: "client.method.other" } as const;

export default function Statement() {
  const { t, money, locale, number } = useI18n();
  const date = useDay();
  const signedIn = useSignedIn();
  const me = usePortal((s) => s.me);
  const invoices = usePortalRows("invoices");
  const payments = usePortalRows("payments");
  const [period, setPeriod] = useState<Period>("all");
  const day = today();
  const st = useMemo(() => statement(invoices, payments, period, day), [invoices, payments, period, day]);

  if (!signedIn || me === null) return null;

  const print = () => {
    const port = portOrNull();
    const first = st.invoices[0] ?? invoices[0];
    if (port === null || useUi.getState().preview !== null || first === undefined) {
      toast(t("portal.previewBlocked"), { icon: "info" });
      return;
    }
    void openInNewTab(() => port.documentUrl("statement", "invoices", first.id, locale), t("client.blocked"));
  };

  const sums = [
    { key: "invoiced", label: t("client.statement.invoiced"), value: st.invoiced, tone: "" },
    { key: "paid", label: t("client.statement.paid"), value: st.paid, tone: " cl-tone-pos" },
    { key: "open", label: t("client.statement.open"), value: st.open, tone: st.overdueOpen ? " cl-tone-danger" : "" },
  ];

  return (
    <section className="screen ol-screen cl-page" data-screen="client-statement" aria-labelledby="cl-statement-title">
      <div className="cl-head-row">
        <div className="cl-head-text">
          <h1 className="cl-h1" id="cl-statement-title">
            {t("nav.statement")}
          </h1>
          <p className="cl-muted cl-lead">{st.since === null ? t("client.statement.leadNone", { company: me.company }) : t("client.statement.lead", { company: me.company, date: date(st.since, "long") })}</p>
        </div>
        <Button icon={Printer} className="ol-noprint" onClick={print}>
          {t("client.statement.print")}
        </Button>
      </div>

      <Filters label={t("client.statement.periods")} value={period} onChange={setPeriod} items={PERIODS.map((p) => ({ id: p, label: t(PERIOD_KEYS[p]), count: st.counts[p] }))} />

      <div className="cl-sums">
        {sums.map((s) => (
          <div key={s.key} className="cl-card cl-sum">
            <span className="cl-label">{s.label}</span>
            <span className={`cl-sum-value money${s.tone}`}>{money(s.value, st.currency)}</span>
          </div>
        ))}
      </div>

      <Section icon={ReceiptText} title={t("client.statement.every")} id="cl-statement-invoices">
        {st.invoices.length === 0 ? (
          <div className="cl-pad cl-subtle">{t("client.statement.noInvoices")}</div>
        ) : (
          <div role="list">
            {st.invoices.map((inv) => {
              const state = invoiceState(inv, day);
              return (
                <div role="listitem" key={inv.id}>
                  <button type="button" className="cl-doc cl-doc--numbered ol-row" onClick={() => open("invoice", inv.id)}>
                    <span className="cl-doc-id">{inv.number}</span>
                    <span className="cl-doc-title">{inv.title ?? inv.number}</span>
                    <span className="cl-doc-amount money">{money(inv.total, inv.currency)}</span>
                    <span className="cl-doc-meta">
                      {t("client.statement.issued", { date: date(inv.issued_on) })}
                      {" · "}
                      {state === "void" ? t("client.home.metaVoid") : isOpen(inv) ? t("client.home.metaDue", { date: date(inv.due_on) }) : t("client.statement.settled")}
                    </span>
                    <span className="cl-doc-pill">
                      <StatusPill status={state} />
                    </span>
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </Section>

      <Section icon={Banknote} title={t("client.statement.youPaid")} end={<span className="cl-mono-count">{t("client.statement.payCount", { count: number(st.payments.length) }, st.payments.length)}</span>} id="cl-statement-paid">
        {st.payments.length === 0 ? (
          <div className="cl-pad cl-subtle">{t(period === "all" ? "client.statement.nonePaid" : "client.statement.nonePaidHere")}</div>
        ) : (
          <ul className="cl-pays">
            {st.payments.map(({ payment, invoice, toDate }) => (
              <li key={payment.id} className="cl-pay">
                <span className="cl-pay-main">
                  <span className="cl-pay-when">{date(payment.paid_on, "long")}</span>
                  <span className="cl-mono-small">{[invoice.number, t(METHOD_KEYS[payment.method])].filter((x) => x !== null && x !== "").join(" · ")}</span>
                </span>
                <span className="cl-pay-figures">
                  <span className="cl-pay-amount money">{money(payment.amount, payment.currency ?? invoice.currency)}</span>
                  <span className="cl-mono-small">{t("client.statement.toDate", { amount: money(toDate, st.currency) })}</span>
                </span>
                <Button size="small" icon={FileText} aria-label={t("client.statement.receiptFor", { date: date(payment.paid_on, "long") })} onClick={() => openSheet({ kind: "receipt", paymentId: payment.id })}>
                  {t("client.statement.receipt")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </section>
  );
}
