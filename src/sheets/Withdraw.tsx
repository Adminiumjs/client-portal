/**
 * Withdraw a sent proposal: the client can no longer accept it, and the
 * studio's reason stays with it (the client is not shown the reason).
 */
import { Undo2 } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { reasonMissing } from "../screens/proposals/sheetModel.ts";
import { withdrawProposal } from "../state/actions.ts";
import { useRow } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";

export default function Withdraw({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "withdraw" }>; onClose: () => void }) {
  const { t } = useI18n();
  const p = useRow("proposals", sheet.proposalId);
  const client = useRow("clients", p?.client_id);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  if (p === undefined) return null;
  const id = p.number ?? "";
  const reason = typeof draft["reason"] === "string" ? (draft["reason"] as string) : "";
  const refused = typeof draft["refused"] === "string" ? (draft["refused"] as string) : null;
  const first = (client?.contact_name ?? "").trim().split(/\s+/)[0] ?? "";

  async function submit(): Promise<void> {
    if (p === undefined) return;
    if (reasonMissing(reason)) {
      setDraft({ error: true });
      return;
    }
    const out = await saveFromSheet(() => withdrawProposal(p.id, reason));
    if (out.ok) toast(t("proposals.sheet.withdrawn", { id }), { icon: "undo-2" });
    else setDraft({ refused: t(refusalKey(out.reason), { id }) });
  }

  return (
    <Sheet title={t("proposals.sheet.withdrawTitle", { id })} sub={client?.company} icon={Undo2} onClose={onClose}>
      <p className="prop-sheet-lead">{t("proposals.sheet.withdrawBody", { first })}</p>
      <Field label={t("proposals.sheet.reason")} error={draft["error"] === true && reasonMissing(reason) ? t("proposals.sheet.reasonMissing") : undefined}>
        {({ id: fieldId, describedBy, invalid }) => (
          <textarea
            id={fieldId}
            className="input ol-fld"
            rows={3}
            value={reason}
            placeholder={t("proposals.sheet.reasonPh")}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(e) => setDraft({ reason: e.target.value, refused: null })}
          />
        )}
      </Field>
      {refused !== null && <Alert>{refused}</Alert>}
      <Button kind="primary" size="wide" className="prop-danger-btn" icon={Undo2} busy={busy} onClick={() => void submit()}>
        {t("proposals.sheet.withdrawButton", { id })}
      </Button>
    </Sheet>
  );
}
