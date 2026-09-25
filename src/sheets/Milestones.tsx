/**
 * "Edit milestones": the project's milestones as rows — each one's title and
 * day, its place, and a remove button for one no deliverable hangs on — and
 * room to add more. Saving patches what changed, removes what went and adds
 * what is new; the client sees the milestones too.
 *
 * Opened from a milestone's title on the project page, with that row ready to
 * type in.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ListChecks, Plus, X } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button } from "../components/ui.tsx";
import type { Id } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { useCan, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";
import { milestonesOf } from "../screens/project/model.ts";
import { badRow, removable, saveMilestones, type MilestoneRow } from "../screens/project/milestones.ts";

export default function Milestones({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "milestones" }>; onClose: () => void }) {
  const { t } = useI18n();
  const project = useRow("projects", sheet.projectId);
  const all = useRows("milestones");
  const deliverables = useRows("deliverables");
  const held = useMemo(() => milestonesOf(all, sheet.projectId), [all, sheet.projectId]);
  const focus = useSheets((s) => (typeof s.draft["focus"] === "number" ? (s.draft["focus"] as Id) : null));
  const busy = useSheets((s) => s.busy);
  const canAdd = useCan("milestones", "create");
  const canRemove = useCan("milestones", "delete");
  const [rows, setRows] = useState<MilestoneRow[]>(() => held.map((m) => ({ id: m.id, title: m.title, due_on: m.due_on ?? "" })));
  const [error, setError] = useState<string | null>(null);
  const [bad, setBad] = useState<number>(-1);
  const list = useRef<HTMLOListElement>(null);
  const number = project?.number ?? t("projects.noNumber");

  useEffect(() => {
    if (focus === null) return;
    list.current?.querySelector<HTMLInputElement>(`[data-row="${String(focus)}"] input`)?.focus();
  }, [focus]);

  const set = (i: number, patch: Partial<MilestoneRow>) => {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)));
    setError(null);
    setBad(-1);
  };
  const move = (i: number, by: -1 | 1) =>
    setRows((r) => {
      const j = i + by;
      if (j < 0 || j >= r.length) return r;
      const next = [...r];
      [next[i], next[j]] = [next[j]!, next[i]!];
      return next;
    });

  const save = async () => {
    const wrong = badRow(rows);
    if (wrong !== -1) {
      setBad(wrong);
      setError(t("projects.sheet.milestones.needBoth"));
      return;
    }
    const out = await saveFromSheet(() => saveMilestones(sheet.projectId, held, rows));
    if (!out.ok) {
      if (out.reason !== "busy" || out.code !== "BUSY") setError(t(refusalKey(out.reason), { id: number }));
      return;
    }
    toast(t("projects.sheet.milestones.saved", { id: number }), { icon: "check" });
  };

  return (
    <Sheet title={t("sheetName.milestones")} sub={project === undefined ? undefined : `${number} · ${project.name}`} icon={ListChecks} onClose={onClose} wide>
      <p className="psh-lead">{t("projects.sheet.milestones.lead")}</p>
      {rows.length === 0 ? (
        <p className="psh-quiet">{t("projects.milestones.empty")}</p>
      ) : (
        <ol className="psh-ms-list" ref={list}>
          {rows.map((row, i) => {
            const n = i + 1;
            const mayRemove = row.id === undefined || (canRemove && removable(row.id, deliverables));
            return (
              <li key={row.id ?? `new-${String(i)}`} className="psh-ms-row" data-row={row.id ?? `new-${String(i)}`}>
                <input className="input" value={row.title} maxLength={200} placeholder={t("projects.sheet.milestones.titlePh")} aria-label={t("projects.sheet.milestones.titleLabel", { n })} aria-invalid={bad === i && row.title.trim() === ""} onChange={(e) => set(i, { title: e.target.value })} />
                <input className="input psh-date" type="date" value={row.due_on} aria-label={t("projects.sheet.milestones.dueLabel", { n })} aria-invalid={bad === i && row.due_on === ""} onChange={(e) => set(i, { due_on: e.target.value })} />
                <span className="psh-ms-tools">
                  <button type="button" className="psh-tool ol-gi" aria-label={t("projects.sheet.milestones.up", { n })} title={t("projects.sheet.milestones.up", { n })} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button type="button" className="psh-tool ol-gi" aria-label={t("projects.sheet.milestones.down", { n })} title={t("projects.sheet.milestones.down", { n })} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="psh-tool ol-gi"
                    aria-label={t("projects.sheet.milestones.remove", { n })}
                    title={mayRemove ? t("projects.sheet.milestones.remove", { n }) : t("projects.sheet.milestones.keep")}
                    disabled={!mayRemove}
                    onClick={() => setRows((r) => r.filter((_, j) => j !== i))}
                  >
                    <X size={14} aria-hidden="true" />
                  </button>
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {canAdd && (
        <Button size="small" icon={Plus} className="psh-add" onClick={() => setRows((r) => [...r, { title: "", due_on: "" }])}>
          {t("projects.sheet.milestones.add")}
        </Button>
      )}
      <p className="psh-quiet">{t("projects.sheet.milestones.seen")}</p>
      {error !== null && <Alert>{error}</Alert>}
      <Button kind="primary" size="wide" icon={ListChecks} busy={busy} onClick={() => void save()}>
        {t("projects.sheet.milestones.save")}
      </Button>
    </Sheet>
  );
}
