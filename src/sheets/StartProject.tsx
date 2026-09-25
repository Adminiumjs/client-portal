/**
 * Start the project from an accepted proposal: its name (the proposal's
 * title to begin with), the milestones — a kickoff, then one per stage of
 * the agreed split, each with a day — and the first invoice, a draft for the
 * first stage's share. The split is the one the client accepted and is not
 * changed here. One project per proposal.
 */
import { useEffect } from "react";
import { FolderPlus, Plus, X } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, UnfinishedLine } from "../components/ui.tsx";
import { addDays } from "../data/venueTime.ts";
import { useI18n } from "../i18n/index.tsx";
import { nextStage } from "../screens/proposals/model.ts";
import { newMilestoneRow, startInput, startingMilestones, startProblem, type MilestoneRow } from "../screens/proposals/sheetModel.ts";
import { startProject, type Outcome } from "../state/actions.ts";
import type { Invoice, Project } from "../data/types.ts";
import { loadProposal, useDesk, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { open, toast } from "../state/ui.ts";
import { StagePlan } from "./NextStage.tsx";

export default function StartProject({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "startProject" }>; onClose: () => void }) {
  const { t } = useI18n();
  const p = useRow("proposals", sheet.proposalId);
  const client = useRow("clients", p?.client_id);
  const invoices = useRows("invoices");
  const today = useDesk((s) => s.today);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);

  useEffect(() => {
    void loadProposal(sheet.proposalId).catch(() => undefined);
  }, [sheet.proposalId]);

  // The milestones start from the agreed split, once; after that they are what the studio typed.
  const ready = p !== undefined;
  useEffect(() => {
    const held = useSheets.getState().draft;
    const proposal = useDesk.getState().rows.proposals[sheet.proposalId];
    if (proposal !== undefined && !Array.isArray(held["milestones"])) setDraft({ milestones: startingMilestones(proposal, useDesk.getState().today, t) });
  }, [ready, sheet.proposalId, t]);

  if (p === undefined) return null;
  const name = typeof draft["name"] === "string" ? (draft["name"] as string) : p.title;
  const rows = Array.isArray(draft["milestones"]) ? (draft["milestones"] as MilestoneRow[]) : startingMilestones(p, today, t);
  const problem = draft["checked"] === true ? startProblem(name, rows) : null;
  const refused = typeof draft["refused"] === "string" ? (draft["refused"] as string) : null;
  const stage = nextStage(p, invoices);
  const setRows = (next: MilestoneRow[]) => setDraft({ milestones: next, refused: null });

  function landed(out: Outcome<{ project: Project; invoice: Invoice }>): void {
    if (!out.ok) {
      setDraft({ refused: t(refusalKey(out.reason), { id: p?.number ?? "" }) });
      return;
    }
    toast(t("proposals.sheet.started", { number: out.value.project.number ?? out.value.project.name }), { icon: "folder-plus" });
    open("project", out.value.project.id);
  }

  async function submit(): Promise<void> {
    if (p === undefined || stage === null) return;
    if (startProblem(name, rows) !== null) {
      setDraft({ name, milestones: rows, checked: true });
      return;
    }
    landed(await saveFromSheet(() => startProject(p.id, startInput(p, name, rows, stage, t))));
  }

  return (
    <Sheet title={t("sheetName.startProject")} sub={[p.number, client?.company].filter(Boolean).join(" · ")} icon={FolderPlus} onClose={onClose}>
      <div className="field">
        <label className="kicker" htmlFor="start-name">
          {t("proposals.sheet.projectName")}
        </label>
        <input
          id="start-name"
          className="input ol-fld"
          value={name}
          aria-invalid={problem === "name" || undefined}
          aria-describedby={problem === "name" ? "start-name-err" : undefined}
          onChange={(e) => setDraft({ name: e.target.value, milestones: rows, refused: null })}
        />
        {problem === "name" && (
          <span className="field-error" id="start-name-err" role="alert">
            {t("proposals.sheet.nameMissing")}
          </span>
        )}
      </div>
      <div className="field">
        <span className="kicker" id="start-ms">
          {t("proposals.sheet.milestones")}
        </span>
        <ul role="list" className="prop-ms" aria-labelledby="start-ms">
          {rows.map((m, i) => (
            <li key={m.key} className="prop-ms-row">
              <input
                className="input ol-fld ol-fld prop-ms-title"
                value={m.title}
                placeholder={t("proposals.sheet.msPh")}
                aria-label={t("proposals.sheet.msTitle", { n: i + 1 })}
                aria-invalid={(problem === "milestones" && m.title.trim() === "") || undefined}
                aria-describedby={problem === "milestones" ? "start-ms-err" : undefined}
                onChange={(e) => setRows(rows.map((r) => (r.key === m.key ? { ...r, title: e.target.value } : r)))}
              />
              <input
                className="input ol-fld ol-fld prop-ms-date"
                type="date"
                min={today}
                value={m.due}
                aria-label={t("proposals.sheet.msDate", { n: i + 1 })}
                aria-invalid={(problem === "milestones" && m.due === "") || undefined}
                aria-describedby={problem === "milestones" ? "start-ms-err" : undefined}
                onChange={(e) => setRows(rows.map((r) => (r.key === m.key ? { ...r, due: e.target.value } : r)))}
              />
              <button type="button" className="icon-btn ol-gi prop-ms-remove" aria-label={t("proposals.sheet.msRemove", { n: i + 1 })} title={t("proposals.sheet.msRemove", { n: i + 1 })} onClick={() => setRows(rows.filter((r) => r.key !== m.key))}>
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
        <Button size="small" className="prop-ms-add" icon={Plus} onClick={() => setRows([...rows, newMilestoneRow("", addDays(today, 28))])}>
          {t("proposals.sheet.addMilestone")}
        </Button>
      </div>
      {stage === null ? <p className="prop-sheet-lead">{t("proposals.sheet.allInvoiced")}</p> : <StagePlan proposal={p} stage={stage} />}
      {problem === "milestones" && (
        <div className="alert" id="start-ms-err" role="alert">
          {t("proposals.sheet.msMissing")}
        </div>
      )}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void saveFromSheet(() => unfinished.resume() as Promise<Outcome<{ project: Project; invoice: Invoice }>>).then(landed)} />}
      {refused !== null && unfinished === null && <Alert>{refused}</Alert>}
      <Button kind="primary" size="wide" icon={FolderPlus} busy={busy} disabled={stage === null || unfinished !== null} onClick={() => void submit()}>
        {t("sheetName.startProject")}
      </Button>
    </Sheet>
  );
}
