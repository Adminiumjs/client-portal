/**
 * The receipt for one payment: the studio's name, the receipt's number, what
 * was received and from whom, when and how it was paid, which invoice it was
 * against and what is still open on it — and "Print this receipt", which
 * opens the add-on's own receipt document.
 */
import { Printer, Receipt as ReceiptIcon } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { Button } from "../../components/ui.tsx";
import { useI18n } from "../../i18n/index.tsx";
import { dayLabel } from "../../lib/dates.ts";
import { isPositive } from "../../lib/money.ts";
import { usePortal, usePortalRow } from "../../state/portal.ts";
import type { ClientSheet } from "../../state/sheets.ts";
import { toast, useUi } from "../../state/ui.ts";
import { openInNewTab, portOrNull } from "../../screens/client/shared/page.ts";

const METHOD_KEYS = { "bank-transfer": "client.method.bank", card: "client.method.card", cheque: "client.method.cheque", cash: "client.method.cash", other: "client.method.other" } as const;

export default function Receipt({ sheet, onClose }: { sheet: Extract<ClientSheet, { kind: "receipt" }>; onClose: () => void }) {
  const { t, money, locale } = useI18n();
  const studio = usePortal((s) => s.studio?.settings ?? null);
  const me = usePortal((s) => s.me);
  const payment = usePortalRow("payments", sheet.paymentId);
  const invoice = usePortalRow("invoices", payment?.document_id ?? null);
  if (payment === undefined || invoice === undefined) {
    return (
      <Sheet title={t("sheetName.receipt")} icon={ReceiptIcon} onClose={onClose}>
        <p className="cl-subtle">{t("save.gone")}</p>
      </Sheet>
    );
  }
  const currency = payment.currency ?? invoice.currency;
  const open = isPositive(invoice.balance);
  const print = () => {
    const port = portOrNull();
    if (port === null || useUi.getState().preview !== null) {
      toast(t("portal.previewBlocked"), { icon: "info" });
      return;
    }
    void openInNewTab(() => port.documentUrl("receipt", "payments", payment.id, locale), t("client.blocked"));
  };
  const rows: [string, string, boolean][] = [
    [t("client.sheet.paidOn"), dayLabel(payment.paid_on, locale, "long"), true],
    [t("client.sheet.method"), t(METHOD_KEYS[payment.method]), false],
    [t("client.sheet.against"), invoice.number ?? "", true],
    [t("client.sheet.for"), invoice.title ?? "", false],
    [t("client.sheet.invoiceTotal"), money(invoice.total, invoice.currency), true],
    [open ? t("client.sheet.stillOpen") : t("client.invoice.balance"), open ? money(invoice.balance, invoice.currency) : t("client.sheet.nil"), true],
  ];
  return (
    <Sheet title={t("sheetName.receipt")} sub={payment.number ?? undefined} icon={ReceiptIcon} onClose={onClose}>
      <div className="cl-receipt">
        <div className="cl-receipt-head">
          <span className="cl-receipt-studio">{studio?.name ?? ""}</span>
          {payment.number !== null && <span className="cl-mono-small">{payment.number}</span>}
        </div>
        <div className="cl-receipt-amount">
          <span className="cl-label">{t("client.sheet.thanks")}</span>
          <span className="cl-receipt-value money">{money(payment.amount, currency)}</span>
          {me !== null && <span className="cl-muted cl-small">{t("client.sheet.from", { company: me.company, contact: me.contact_name })}</span>}
        </div>
        <dl className="cl-receipt-rows">
          {rows.map(([k, v, mono]) => (
            <div key={k} className="cl-receipt-row">
              <dt>{k}</dt>
              <dd className={mono ? "cl-mono-fact" : undefined}>{v}</dd>
            </div>
          ))}
        </dl>
        <p className="cl-muted cl-small">{open ? t("client.sheet.noteOpen", { amount: money(invoice.balance, invoice.currency), id: invoice.number ?? "" }) : t("client.sheet.noteSettled", { id: invoice.number ?? "" })}</p>
        {studio?.reply_to !== null && studio?.reply_to !== undefined && <span className="cl-fine">{[studio.name, studio.reply_to].filter((x) => x !== null && x !== "").join(" · ")}</span>}
      </div>
      <Button icon={Printer} onClick={print}>
        {t("client.sheet.print")}
      </Button>
    </Sheet>
  );
}
