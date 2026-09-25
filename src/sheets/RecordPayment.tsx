/**
 * Record a payment against a sent invoice: the open balance (stored), Full or
 * Half, the amount, how it came (bank transfer, card, cheque, cash) and the
 * day it arrived — not before the invoice was issued, not after today.
 *
 * The sheet checks what it can before it asks; Adminium checks it all again
 * and its answer is what counts. More than the balance (another desk may have
 * recorded one a moment ago) is refused, and the sheet then says the most
 * that can be recorded now, from the balance read again. The payment's receipt
 * number is Adminium's; the invoice is read back for its paid and balance,
 * which also clears what the client said they sent.
 */
import { Banknote } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../components/ui.tsx";
import type { Day, PaymentMethod } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { recordPayment } from "../state/actions.ts";
import { useDesk, useRow } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";
import { asTyped, compare, half, paymentProblem, paymentRefusal, readAmount } from "../screens/invoices/amount.ts";
import { METHODS } from "../screens/invoices/words.ts";

interface Draft {
  amount?: string;
  method?: PaymentMethod;
  on?: Day;
  error?: { field: "amount" | "on" | null; text: string } | null;
}

export default function RecordPayment({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "recordPayment" }>; onClose: () => void }) {
  const { t, money, locale } = useI18n();
  const inv = useRow("invoices", sheet.invoiceId);
  const client = useRow("clients", inv?.client_id);
  const draft = useSheets((s) => s.draft) as Draft;
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  const day = today();

  const balance = inv?.balance ?? null;
  const currency = inv?.currency ?? null;
  const amount = draft.amount ?? sheet.prefill?.amount ?? asTyped(balance, currency);
  const method = draft.method ?? "bank-transfer";
  const on = draft.on ?? sheet.prefill?.on ?? day;
  const read = readAmount(amount, locale);
  const halfOf = balance === null ? null : half(balance, currency);
  const error = draft.error ?? null;

  const set = (patch: Draft) => setDraft({ ...patch, error: null });

  const PROBLEM_WORDS = {
    zero: () => t("invoices.sheet.pay.errZero"),
    over: () => t("invoices.sheet.pay.errOver", { balance: money(balance, currency) }),
    day: () => t("invoices.sheet.pay.errDay"),
    future: () => t("invoices.sheet.pay.errFuture"),
    before: () => t("invoices.sheet.pay.errBefore"),
  } as const;

  const check = (): Draft["error"] => {
    const problem = paymentProblem({ amount: read, balance, on, today: day, issued: inv?.issued_on ?? null });
    return problem === null ? null : { field: problem.field, text: PROBLEM_WORDS[problem.kind]() };
  };

  const save = () => {
    if (inv === undefined) return;
    const problem = check();
    if (problem !== null) {
      setDraft({ error: problem });
      return;
    }
    void run(() => recordPayment(inv.id, { amount: read!, method, paid_on: on }));
  };

  const run = async (action: () => ReturnType<typeof recordPayment>) => {
    if (inv === undefined) return;
    const out = await saveFromSheet(action);
    if (out.ok) {
      const after = out.value.invoice;
      const settled = after.balance !== null && compare(after.balance, "0") <= 0;
      toast(settled ? t("invoices.sheet.pay.settledToast", { id: after.number ?? "" }) : t("invoices.sheet.pay.recordedToast", { amount: money(read, currency), left: money(after.balance, currency) }), { icon: "banknote", tone: "pos" });
      return;
    }
    if (out.reason === "busy" && out.code === "BUSY") return;
    const fresh = typeof out.details["balance"] === "string" || typeof out.details["balance"] === "number" ? String(out.details["balance"]) : (useDesk.getState().rows.invoices[inv.id]?.balance ?? balance);
    const refusal = paymentRefusal(out.reason, out.field);
    const text =
      refusal.words === "balance"
        ? t("save.balance", { balance: money(fresh, currency) })
        : refusal.words === "moved"
          ? t("invoices.sheet.pay.moved")
          : refusal.words === "range"
            ? t("invoices.sheet.pay.errRange")
            : refusal.words === "zero"
              ? t("invoices.sheet.pay.errZero")
              : t(refusalKey(out.reason), { id: inv.number ?? "", balance: money(fresh, currency) });
    setDraft({ error: { field: refusal.field, text } });
  };

  const sub = [inv?.number, client?.company].filter((x) => x !== null && x !== undefined && x !== "").join(" · ");
  const isFull = read !== null && balance !== null && compare(read, balance) === 0;
  const isHalf = read !== null && halfOf !== null && compare(read, halfOf) === 0;

  return (
    <Sheet title={t("invoices.sheet.pay.title")} sub={sub} icon={Banknote} onClose={onClose}>
      <form
        className="inv-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <div className="inv-sheet-balance">
          <span>{t("invoices.sheet.pay.balance")}</span>
          <span className="money">{money(balance, currency)}</span>
        </div>
        <div className="inv-seg inv-seg--wide" role="group" aria-label={t("invoices.sheet.pay.quick")}>
          <button type="button" className="inv-seg-chip ol-chip" aria-pressed={isFull} onClick={() => set({ amount: asTyped(balance, currency) })}>
            {t("invoices.sheet.pay.full")}
          </button>
          <button type="button" className="inv-seg-chip ol-chip" aria-pressed={isHalf} disabled={halfOf === null} onClick={() => halfOf !== null && set({ amount: halfOf })}>
            {t("invoices.sheet.pay.half")}
          </button>
        </div>
        <Field label={t("invoices.sheet.pay.amount")} error={error?.field === "amount" ? error.text : undefined}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input ol-fld money" inputMode="decimal" autoComplete="off" value={amount} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set({ amount: e.target.value })} />
          )}
        </Field>
        <div className="inv-sheet-pair">
          <Field label={t("invoices.sheet.pay.method")}>
            {({ id, describedBy }) => (
              <select id={id} className="input ol-fld" value={method} aria-describedby={describedBy} onChange={(e) => set({ method: e.target.value as PaymentMethod })}>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {t(`invoices.method.${m}`)}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label={t("invoices.sheet.pay.day")} error={error?.field === "on" ? error.text : undefined}>
            {({ id, describedBy, invalid }) => (
              <input id={id} type="date" className="input ol-fld" value={on} min={inv?.issued_on ?? undefined} max={day} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => set({ on: e.target.value })} />
            )}
          </Field>
        </div>
        {error !== null && error.field === null && <Alert>{error.text}</Alert>}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void run(() => unfinished.resume() as ReturnType<typeof recordPayment>)} />}
        <Button type="submit" kind="primary" size="wide" busy={busy} disabled={inv === undefined}>
          {read !== null && compare(read, "0") > 0 ? t("invoices.sheet.pay.recordAmount", { amount: money(read, currency) }) : t("invoices.sheet.pay.record")}
        </Button>
      </form>
    </Sheet>
  );
}
