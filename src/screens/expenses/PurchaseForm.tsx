/**
 * "Add a purchase", in place above the list: what it was, what it cost, on
 * whose behalf (a project that is still running, or nobody — the studio's own
 * to carry), the day it was bought, who it was bought from, and a receipt.
 *
 * The receipt goes first (a private file), then the purchase that names it;
 * its number, and the project's client, are Adminium's. A purchase for a
 * project is marked to pass on at cost; one for nobody is ours.
 */
import { useId, useMemo, useState } from "react";
import { Check, Paperclip } from "lucide-react";

import { Button, UnfinishedLine } from "../../components/ui.tsx";
import type { Expense, Id } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { today } from "../../lib/clock.ts";
import { useDesk, useRows } from "../../state/desk.ts";
import { addPurchase } from "../../state/officeActions.ts";
import type { Outcome, Unfinished } from "../../state/outcome.ts";
import { toast } from "../../state/ui.ts";
import { MAX_BYTES } from "../review/DropZone.tsx";
import { rememberUpload } from "../review/files.ts";
import { openProjects } from "./model.ts";
import { refusalWords } from "./words.ts";

/** What the form holds while it is typed: text as typed, the project picked, the file chosen. */
export interface PurchaseDraft {
  what: string;
  amount: string;
  /** A project's id, or "ours". */
  forWhom: string;
  date: string;
  supplier: string;
  receipt: File | null;
}

type Problem = { field: "what" | "amount" | "date" | "receipt" | null; text: string };

/**
 * The day, checked before anything is sent: one must be given, and never a
 * day still to come (Adminium refuses one too; the browser's picker only
 * suggests the limit).
 */
export function dayProblem(date: string, today: string): "expenses.form.needDate" | "expenses.form.futureDate" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return "expenses.form.needDate";
  return date > today ? "expenses.form.futureDate" : null;
}

/** The form's fields as `addPurchase` takes them. */
export function purchaseInput(draft: PurchaseDraft) {
  const ours = draft.forWhom === "ours" || draft.forWhom === "";
  return {
    what: draft.what,
    amount: draft.amount,
    date: draft.date,
    project_id: ours ? null : Number(draft.forWhom),
    supplier_id: draft.supplier === "" ? null : Number(draft.supplier),
    rebill: !ours,
    receipt: draft.receipt === null ? null : { file: draft.receipt, filename: draft.receipt.name },
  };
}

export function PurchaseForm({ onClose }: { onClose: () => void }) {
  const { t, money } = useI18n();
  const id = useId();
  const day = useDesk((s) => s.today) || today();
  const projects = useRows("projects");
  const clients = useDesk((s) => s.rows.clients);
  const suppliers = useRows("suppliers");
  const running = useMemo(() => openProjects(projects), [projects]);
  const book = useMemo(() => [...suppliers].sort((a, b) => a.name.localeCompare(b.name)), [suppliers]);
  const [draft, setDraft] = useState<PurchaseDraft>(() => ({ what: "", amount: "", forWhom: running[0] === undefined ? "ours" : String(running[0].id), date: day, supplier: "", receipt: null }));
  const [problem, setProblem] = useState<Problem | null>(null);
  const [busy, setBusy] = useState(false);
  const [unfinished, setUnfinished] = useState<Unfinished<Expense> | null>(null);

  const set = (patch: Partial<PurchaseDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setProblem(null);
  };

  const finish = (out: Outcome<Expense>) => {
    if (!out.ok) {
      setUnfinished(out.unfinished);
      const field = out.code === "WHAT_REQUIRED" ? "what" : out.code === "AMOUNT_ABOVE_ZERO" || out.field === "amount" ? "amount" : out.field === "date" ? "date" : null;
      setProblem({ field, text: refusalWords(out, t) });
      return;
    }
    const saved = out.value;
    if (saved.receipt !== null && draft.receipt !== null) rememberUpload(saved.receipt, draft.receipt, draft.receipt.name);
    const company = saved.client_id === null ? null : (clients[saved.client_id]?.company ?? null);
    toast(saved.rebill && company !== null ? t("expenses.saved.client", { amount: money(saved.amount), company }) : t("expenses.saved.ours", { amount: money(saved.amount) }), { icon: "wallet" });
    onClose();
  };

  const save = async () => {
    const wrongDay = dayProblem(draft.date, day);
    if (wrongDay !== null) {
      setProblem({ field: "date", text: t(wrongDay) });
      return;
    }
    setBusy(true);
    const out = await addPurchase(purchaseInput(draft));
    setBusy(false);
    finish(out);
  };

  const resume = async () => {
    if (unfinished === null) return;
    setBusy(true);
    const out = await unfinished.resume();
    setBusy(false);
    finish(out);
  };

  const errorId = `${id}-error`;
  const bad = (field: Problem["field"]) => (problem !== null && problem.field === field ? { "aria-invalid": true, "aria-describedby": errorId } : {});

  return (
    <form
      className="ex-form"
      aria-label={t("expenses.add")}
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="ex-form-grid">
        <label className="ex-fld ex-fld--what">
          <span className="ex-fld-k">{t("expenses.form.what")}</span>
          <input className="ex-input" value={draft.what} maxLength={300} placeholder={t("expenses.form.whatPh")} onChange={(e) => set({ what: e.target.value })} {...bad("what")} />
        </label>
        <label className="ex-fld ex-fld--cost">
          <span className="ex-fld-k">{t("expenses.form.cost")}</span>
          <input className="ex-input ex-input--mono" value={draft.amount} inputMode="decimal" placeholder={t("expenses.form.costPh")} onChange={(e) => set({ amount: e.target.value })} {...bad("amount")} />
        </label>
        <label className="ex-fld ex-fld--for">
          <span className="ex-fld-k">{t("expenses.form.for")}</span>
          <select className="ex-input" value={draft.forWhom} onChange={(e) => set({ forWhom: e.target.value })}>
            <option value="ours">{t("expenses.form.ours")}</option>
            {running.map((p) => (
              <option key={p.id} value={String(p.id)}>
                {`${clients[p.client_id]?.company ?? ""} · ${p.name}`}
              </option>
            ))}
          </select>
        </label>
        <label className="ex-fld ex-fld--supplier">
          <span className="ex-fld-k">{t("expenses.form.supplier")}</span>
          <select className="ex-input" value={draft.supplier} onChange={(e) => set({ supplier: e.target.value })}>
            <option value="">{t("expenses.form.noSupplier")}</option>
            {book.map((s) => (
              <option key={s.id} value={String(s.id as Id)}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ex-fld ex-fld--date">
          <span className="ex-fld-k">{t("expenses.form.date")}</span>
          <input className="ex-input ex-input--mono" type="date" value={draft.date} max={day} onChange={(e) => set({ date: e.target.value })} {...bad("date")} />
        </label>
        <div className="ex-fld ex-fld--receipt">
          <span className="ex-fld-k" id={`${id}-receipt`}>
            {t("expenses.form.receipt")}
          </span>
          <label className={`ex-file ol-gi${draft.receipt !== null ? " ex-file--chosen" : ""}`}>
            <input
              type="file"
              className="ex-file-input"
              accept="image/*,application/pdf"
              aria-labelledby={`${id}-receipt ${id}-receipt-state`}
              {...bad("receipt")}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                if (file !== null && file.size > MAX_BYTES) {
                  set({ receipt: null });
                  setProblem({ field: "receipt", text: t("expenses.form.tooBig") });
                  return;
                }
                set({ receipt: file });
              }}
            />
            <Paperclip size={14} aria-hidden="true" />
            <span className="ex-file-name" id={`${id}-receipt-state`}>
              {draft.receipt === null ? t("expenses.form.receiptChoose") : draft.receipt.name}
            </span>
          </label>
        </div>
      </div>
      {problem !== null && (
        <span className="ex-form-err" id={errorId} role="alert">
          {problem.text}
        </span>
      )}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void resume()} />}
      <div className="ex-form-actions">
        <Button kind="primary" type="submit" icon={Check} busy={busy}>
          {t("expenses.form.save")}
        </Button>
        <Button type="button" onClick={onClose}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}
