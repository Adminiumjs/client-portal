/**
 * Void an invoice, or discard a draft (a studio manager).
 *
 * A sent invoice with nothing paid is voided with a reason: it keeps its
 * number and stays on every list, marked Void, and nothing is owed on it. The
 * reason is the studio's own — the client's copy says only that it is void.
 * Adminium refuses the void once a payment is on it.
 *
 * A draft is discarded: numbered at create, it is voided rather than deleted
 * (so the numbers have no gaps), with the reason "Discarded draft" — and the
 * client never sees it, having never been sent it.
 */
import { Ban, Trash2 } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { discardDraft, voidInvoice } from "../state/actions.ts";
import { useRow } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";

export default function VoidInvoice({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "voidInvoice" }>; onClose: () => void }) {
  const { t } = useI18n();
  const inv = useRow("invoices", sheet.invoiceId);
  const client = useRow("clients", inv?.client_id);
  const draft = useSheets((s) => s.draft) as { reason?: string; error?: string | null; problem?: string | null };
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  const reason = draft.reason ?? "";
  const id = inv?.number ?? "";
  const discard = inv?.status === "draft";

  const run = async (action: () => ReturnType<typeof voidInvoice>) => {
    const out = await saveFromSheet(action);
    if (out.ok) toast(discard ? t("invoices.sheet.discard.toast", { id }) : t("invoices.sheet.void.toast", { id }), { icon: "ban" });
    else if (out.code !== "BUSY") setDraft({ problem: out.reason === "moved" ? t("invoices.sheet.void.moved", { id }) : t(refusalKey(out.reason), { id }) });
  };

  const save = () => {
    if (inv === undefined) return;
    if (discard) {
      void run(() => discardDraft(inv.id));
      return;
    }
    if (reason.trim() === "") {
      setDraft({ error: t("invoices.sheet.void.errReason") });
      return;
    }
    void run(() => voidInvoice(inv.id, reason));
  };

  return (
    <Sheet title={discard ? t("invoices.sheet.discard.title", { id }) : t("invoices.sheet.void.title", { id })} sub={client?.company} icon={discard ? Trash2 : Ban} onClose={onClose}>
      <form
        className="inv-sheet"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <p className="inv-sheet-lead">{discard ? t("invoices.sheet.discard.body") : t("invoices.sheet.void.body")}</p>
        {!discard && (
          <Field label={t("invoices.sheet.void.reason")} hint={t("invoices.sheet.void.hint")} error={draft.error ?? undefined}>
            {({ id: fieldId, describedBy, invalid }) => (
              <textarea id={fieldId} className="input ol-fld" rows={3} value={reason} placeholder={t("invoices.sheet.void.placeholder")} aria-describedby={describedBy} aria-invalid={invalid} onChange={(e) => setDraft({ reason: e.target.value, error: null, problem: null })} />
            )}
          </Field>
        )}
        {draft.problem != null && <Alert>{draft.problem}</Alert>}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void run(() => unfinished.resume() as ReturnType<typeof voidInvoice>)} />}
        <div className="inv-sheet-buttons">
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" kind="danger" icon={discard ? Trash2 : Ban} busy={busy} disabled={inv === undefined || inv.status === "void"}>
            {discard ? t("invoices.sheet.discard.button") : t("invoices.sheet.void.button", { id })}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
