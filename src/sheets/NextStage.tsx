/**
 * Invoice the next stage of a project started from a proposal: the agreed
 * split (read-only — changing it means a revision), which stage comes next
 * and its share of the proposal before tax, and "Create the draft". Also
 * what "Draft it" opens when a project started without its first invoice.
 * The draft's line is Adminium's: the proposal's subtotal × the share.
 */
import { useEffect } from "react";
import { ReceiptText } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, UnfinishedLine } from "../components/ui.tsx";
import type { Invoice, Proposal } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { instantLabel } from "../lib/dates.ts";
import { studioZone } from "../lib/clock.ts";
import { shareOf } from "../screens/composer/figures.ts";
import { minorUnits } from "../lib/money.ts";
import { nextStage, type NextStage as Stage } from "../screens/proposals/model.ts";
import { stageInput } from "../screens/proposals/sheetModel.ts";
import { draftStageInvoice, type Outcome } from "../state/actions.ts";
import { ensureRows, loadProposal, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { open, toast } from "../state/ui.ts";

/** The stage block both sheets draw: the agreed split, when it was agreed, the stage's share before tax. */
export function StagePlan({ proposal, stage }: { proposal: Proposal; stage: Stage }) {
  const { t, locale, money, number } = useI18n();
  const agreedAt = proposal.signed_at ?? proposal.decided_at ?? proposal.sent_at;
  const amount = shareOf(proposal.subtotal, stage.share, minorUnits(proposal.currency ?? undefined));
  return (
    <div className="prop-stage">
      <span className="kicker" id="prop-stage">
        {t(stage.index === 0 ? "proposals.sheet.firstInvoice" : "proposals.sheet.nextInvoice")}
      </span>
      <div className="prop-stage-split" aria-labelledby="prop-stage">
        <span className="prop-stage-name">{t(`proposals.split.${proposal.split}` as MessageKey)}</span>
        {agreedAt !== null && <span className="prop-stage-agreed">{t("proposals.sheet.agreed", { date: instantLabel(agreedAt, studioZone(), locale, { day: "numeric", month: "short" }) })}</span>}
      </div>
      <span className="prop-stage-line">
        {t("proposals.sheet.stageLine", { pct: number(Number(stage.share), { maximumFractionDigits: 2 }), stage: t(`proposals.stage.${stage.name}` as MessageKey), amount: money(amount, proposal.currency) })}
      </span>
      <span className="prop-stage-note">{t("proposals.sheet.draftNote")}</span>
    </div>
  );
}

export default function NextStage({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "nextStage" }>; onClose: () => void }) {
  const { t } = useI18n();
  const project = useRow("projects", sheet.projectId);
  const p = useRow("proposals", project?.proposal_id);
  const invoices = useRows("invoices");
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  const proposalId = project?.proposal_id ?? null;

  useEffect(() => {
    void ensureRows("projects", [sheet.projectId]).catch(() => undefined);
  }, [sheet.projectId]);
  useEffect(() => {
    if (proposalId !== null) void loadProposal(proposalId).catch(() => undefined);
  }, [proposalId]);

  if (project === undefined) return null;
  const stage = p === undefined ? null : nextStage(p, invoices);
  const refused = typeof draft["refused"] === "string" ? (draft["refused"] as string) : null;

  function landed(out: Outcome<Invoice>): void {
    if (!out.ok) {
      setDraft({ refused: t(refusalKey(out.reason), { id: p?.number ?? "" }) });
      return;
    }
    toast(t("proposals.sheet.drafted", { number: out.value.number ?? "" }), { icon: "receipt-text" });
    open("invoice", out.value.id);
  }

  return (
    <Sheet title={t("sheetName.nextStage")} sub={[project.number, project.name].filter(Boolean).join(" · ")} icon={ReceiptText} onClose={onClose}>
      {proposalId === null ? (
        <p className="prop-sheet-lead">{t("proposals.sheet.noProposal")}</p>
      ) : p === undefined ? (
        <p className="prop-sheet-lead">{t("common.loading")}</p>
      ) : stage === null ? (
        <p className="prop-sheet-lead">{t("proposals.sheet.allInvoiced")}</p>
      ) : (
        <StagePlan proposal={p} stage={stage} />
      )}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void saveFromSheet(() => unfinished.resume() as Promise<Outcome<Invoice>>).then(landed)} />}
      {refused !== null && unfinished === null && <Alert>{refused}</Alert>}
      {p !== undefined && stage !== null && (
        <Button kind="primary" size="wide" icon={ReceiptText} busy={busy} disabled={unfinished !== null} onClick={() => void saveFromSheet(() => draftStageInvoice(project.id, stageInput(p, stage, t))).then(landed)}>
          {t("proposals.sheet.createDraft")}
        </Button>
      )}
    </Sheet>
  );
}
