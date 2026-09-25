/**
 * One of what it costs to open the door: what it is and what it costs each
 * month — added, changed or taken off by a studio manager (Adminium refuses
 * anyone else). The amount is what the manager types, stored as Adminium
 * stores money; the Money screen only adds the costs up for display.
 */
import { useState } from "react";
import { Receipt, Trash2 } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../../components/ui.tsx";
import { useI18n, type MessageKey } from "../../i18n/index.tsx";
import type { RunningCost } from "../../data/types.ts";
import { addRunningCost, editRunningCost, removeRunningCost, type Outcome } from "../../state/officeActions.ts";
import { refusalKey, type Unfinished } from "../../state/outcome.ts";
import { toast } from "../../state/ui.ts";

/** A refused cost's words: the field's own, else the shared ones. */
export function costRefusal(out: Extract<Outcome<unknown>, { ok: false }>): { field: "label" | "monthly_amount" | null; key: MessageKey } {
  if (out.code === "LABEL_REQUIRED") return { field: "label", key: "money.sheet.labelRequired" };
  if (out.code === "AMOUNT_NOT_A_NUMBER" || (out.reason === "invalid" && out.field === "monthly_amount")) return { field: "monthly_amount", key: "money.sheet.amountNotANumber" };
  return { field: null, key: refusalKey(out.reason) };
}

export default function RunningCostSheet({ cost, nextPosition, currency, onClose }: { cost: RunningCost | null; nextPosition: number; currency: string | null; onClose: () => void }) {
  const { t } = useI18n();
  const [label, setLabel] = useState(cost?.label ?? "");
  const [amount, setAmount] = useState(cost?.monthly_amount ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ field: "label" | "monthly_amount" | null; key: MessageKey } | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished<unknown> | null>(null);

  async function finish(out: Outcome<unknown>, done: string): Promise<void> {
    if (out.ok) {
      toast(done, { icon: "receipt" });
      onClose();
      return;
    }
    setUnfinished(out.unfinished);
    setProblem(costRefusal(out));
  }

  async function save(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const input = { label, monthly_amount: amount };
      const out = cost === null ? await addRunningCost({ ...input, position: nextPosition }) : await editRunningCost(cost.id, input);
      await finish(out, t("money.sheet.saved", { label: label.trim() }));
    } finally {
      setBusy(false);
    }
  }

  async function resume(): Promise<void> {
    if (unfinished === null || busy) return;
    setBusy(true);
    try {
      await finish(await unfinished.resume(), t("money.sheet.saved", { label: label.trim() }));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    if (cost === null || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await finish(await removeRunningCost(cost.id), t("money.sheet.removed", { label: cost.label }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={cost === null ? t("money.sheet.addTitle") : t("money.sheet.editTitle")} sub={currency ?? undefined} icon={Receipt} onClose={onClose}>
      <form
        className="money-sheet"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Field label={t("money.sheet.label")} error={problem?.field === "label" ? t(problem.key) : undefined}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input ol-fld" value={label} maxLength={160} aria-describedby={describedBy} aria-invalid={invalid || undefined} onChange={(e) => setLabel(e.target.value)} />
          )}
        </Field>
        <Field label={t("money.sheet.amount")} hint={t("money.sheet.amountHint")} error={problem?.field === "monthly_amount" ? t(problem.key) : undefined}>
          {({ id, describedBy, invalid }) => (
            <input
              id={id}
              className="input ol-fld money-sheet-amount"
              inputMode="decimal"
              value={amount}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(e) => setAmount(e.target.value)}
            />
          )}
        </Field>
        {problem !== null && problem.field === null && <Alert>{t(problem.key)}</Alert>}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void resume()} />}
        <Button kind="primary" size="wide" type="submit" icon={Receipt} busy={busy}>
          {cost === null ? t("money.sheet.add") : t("money.sheet.save")}
        </Button>
        {cost !== null && (
          <Button kind="danger" icon={Trash2} disabled={busy} onClick={() => void remove()}>
            {t("money.sheet.remove")}
          </Button>
        )}
      </form>
    </Sheet>
  );
}
