/**
 * Make a revision: a new draft copied from a declined, withdrawn or
 * out-of-date proposal — its title, scope, split and lines — with a number
 * of its own (Adminium's). It opens in the composer; sending it withdraws
 * the proposal it revises.
 */
import { Copy } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, UnfinishedLine } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { makeRevision, type Outcome } from "../state/actions.ts";
import type { Proposal } from "../data/types.ts";
import { useRow } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { openComposer, toast } from "../state/ui.ts";

export default function Revision({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "revision" }>; onClose: () => void }) {
  const { t } = useI18n();
  const p = useRow("proposals", sheet.proposalId);
  const client = useRow("clients", p?.client_id);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  if (p === undefined) return null;
  const id = p.number ?? "";
  const refused = typeof draft["refused"] === "string" ? (draft["refused"] as string) : null;

  function landed(out: Outcome<Proposal>): void {
    if (!out.ok) {
      setDraft({ refused: t(refusalKey(out.reason), { id }) });
      return;
    }
    toast(out.value.number === null ? t("proposals.sheet.revisedNoNumber", { id }) : t("proposals.sheet.revised", { nid: out.value.number, id }), { icon: "copy" });
    openComposer({ kind: "proposal", id: out.value.id });
  }

  return (
    <Sheet title={t("proposals.sheet.revisionTitle")} sub={[id, client?.company].filter(Boolean).join(" · ")} icon={Copy} onClose={onClose}>
      <p className="prop-sheet-lead">{t("proposals.sheet.revisionBody", { id })}</p>
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void saveFromSheet(() => unfinished.resume() as Promise<Outcome<Proposal>>).then(landed)} />}
      {refused !== null && unfinished === null && <Alert>{refused}</Alert>}
      <Button kind="primary" size="wide" icon={Copy} busy={busy} disabled={unfinished !== null} onClick={() => void saveFromSheet(() => makeRevision(p.id)).then(landed)}>
        {t("proposals.sheet.revisionButton")}
      </Button>
    </Sheet>
  );
}
