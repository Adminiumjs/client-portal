/**
 * Void a payment (a studio manager): the amount, the day and how it came, a
 * reason, then "Void payment". The row stays on the ledger, struck through,
 * and the invoice's balance goes back up — Adminium's rollup leaves a voided
 * payment out, and the invoice is read back.
 */
import { Ban } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { voidPayment } from "../state/actions.ts";
import { useRow } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";

export default function VoidPayment({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "voidPayment" }>; onClose: () => void }) {
  const { t, money, locale } = useI18n();
  const payment = useRow("payments", sheet.paymentId);
  const inv = useRow("invoices", payment?.document_id);
  const draft = useSheets((s) => s.draft) as { reason?: string; error?: string | null; problem?: string | null };
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  const reason = draft.reason ?? "";

  const run = async (action: () => ReturnType<typeof voidPayment>) => {
    const out = await saveFromSheet(action);
    if (out.ok) toast(t("invoices.sheet.voidPay.toast", { id: inv?.number ?? "" }), { icon: "ban" });
    else if (out.code !== "BUSY") setDraft({ problem: t(refusalKey(out.reason), { id: inv?.number ?? "" }) });
  };

  const save = () => {
    if (payment === undefined) return;
    if (reason.trim() === "") {
      setDraft({ error: t("invoices.sheet.voidPay.errReason") });
      return;
    }
    void run(() => voidPayment(payment.id, reason));
  };

  const amount = payment === undefined ? "" : money(payment.amount, inv?.currency ?? payment.currency);
  return (
    <Sheet title={t("invoices.sheet.voidPay.title")} sub={[payment?.number, inv?.number].filter((x) => x != null && x !== "").join(" · ")} icon={Ban} onClose={onClose}>
      <form
        className="inv-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="inv-sheet-lead">
          {payment === undefined ? "" : t("invoices.sheet.voidPay.body", { amount, day: dayLabel(payment.paid_on, locale), method: t(`invoices.method.${payment.method}`) })}
        </p>
        <Field label={t("invoices.sheet.voidPay.reason")} error={draft.error ?? undefined}>
          {({ id, describedBy, invalid }) => (
            <textarea id={id} className="input ol-fld" rows={3} value={reason} placeholder={t("invoices.sheet.voidPay.placeholder")} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setDraft({ reason: e.target.value, error: null, problem: null })} />
          )}
        </Field>
        {draft.problem != null && <Alert>{draft.problem}</Alert>}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void run(() => unfinished.resume() as ReturnType<typeof voidPayment>)} />}
        <div className="inv-sheet-buttons">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" kind="danger" icon={Ban} busy={busy} disabled={payment === undefined || payment.voided}>
            {t("invoices.sheet.voidPay.button")}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
