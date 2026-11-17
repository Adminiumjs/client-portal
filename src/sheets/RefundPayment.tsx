/**
 * Give back a payment a client made online (someone who may refund). The
 * sheet names the payment; the two steps inside it — how much and why, then
 * the one sentence that says what will happen — are Adminium's own, drawn by
 * its kit over this person's session, with its words and its "Refund of …
 * requested." The server asks the refund right again. Once Adminium takes the
 * refund the invoice is read back: its `paid` sums what is left of each
 * payment, so the balance opens again by what was refunded.
 */
import { useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert } from "../components/ui.tsx";
import { staffToken } from "../data/staffSession.ts";
import { useI18n } from "../i18n/index.tsx";
import { loadInvoice, useRow } from "../state/desk.ts";
import { KIT_CONTRACT, useDeskPayments } from "../state/deskPayments.ts";
import type { DeskSheet } from "../state/sheets.ts";
import { useUi } from "../state/ui.ts";

interface KitModule {
  mount(part: "refund", element: Element, props: Record<string, unknown>): Promise<{ unmount(): void }>;
}

export default function RefundPayment({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "refundPayment" }>; onClose: () => void }) {
  const { t, money, locale, dir } = useI18n();
  const payment = useRow("payments", sheet.paymentId);
  const inv = useRow("invoices", payment?.document_id);
  const kit = useDeskPayments((s) => s.kit);
  const theme = useUi((s) => s.theme);
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const attemptId = payment?.payment_ref ?? null;
  const invoiceId = inv?.id ?? null;

  useEffect(() => {
    const element = host.current;
    if (kit === null || kit.contract !== KIT_CONTRACT || attemptId === null || element === null) return;
    let live = true;
    let mounted: { unmount(): void } | null = null;
    setFailed(false);
    void (async () => {
      try {
        const part = (await import(/* @vite-ignore */ kit.entry)) as KitModule;
        if (!live) return;
        mounted = await part.mount("refund", element, {
          locale,
          dir,
          theme,
          attemptId,
          csrfToken: staffToken() ?? "",
          // Taken: the invoice and its payments are read again, so the ledger shows what was given back.
          onRefunded: () => {
            if (invoiceId !== null) void loadInvoice(invoiceId).catch(() => undefined);
          },
        });
        if (!live) mounted.unmount();
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
      mounted?.unmount();
    };
  }, [kit, attemptId, invoiceId, locale, dir, theme]);

  const which =
    payment === undefined
      ? undefined
      : t("invoices.refund.which", { number: payment.number ?? "", provider: payment.provider ?? "", amount: money(payment.amount, inv?.currency ?? payment.currency) });
  return (
    <Sheet title={t("invoices.refund.title")} sub={which} icon={Undo2} onClose={onClose}>
      <div className="inv-sheet inv-kit" ref={host} data-part="refund" />
      {(failed || kit === null) && <Alert>{t("invoices.refund.unavailable")}</Alert>}
    </Sheet>
  );
}
