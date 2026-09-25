/**
 * "Edit milestones": what saving the edited rows changes, and saving it.
 *
 * A row keeps its milestone's id; a row without one is new. Rows gone from
 * the list are removed (only a milestone no deliverable hangs on may go);
 * rows whose title, day or place changed are patched; new rows are added.
 * Each is one of the desk's actions, removals first and additions last;
 * pressing Save again after a failure works the difference out again from
 * what saved, so nothing is written twice.
 */
import type { Day, Deliverable, Id, Milestone } from "../../data/types.ts";
import { addMilestone, editMilestone, removeMilestone, type Outcome } from "../../state/actions.ts";

export interface MilestoneRow {
  id?: Id;
  title: string;
  due_on: Day | "";
}

export interface MilestoneChanges {
  remove: Id[];
  edit: { id: Id; title: string; due_on: Day; position: number }[];
  add: { title: string; due_on: Day; position: number }[];
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The first row that can't be saved: a title without a day, or a day without a title. */
export function badRow(rows: readonly MilestoneRow[]): number {
  return rows.findIndex((r) => r.title.trim() === "" || !DAY.test(r.due_on));
}

/** Whether a milestone may be removed: nothing delivered hangs on it. */
export const removable = (milestoneId: Id, deliverables: readonly Deliverable[]): boolean => !deliverables.some((d) => d.milestone_id === milestoneId);

export function milestoneChanges(held: readonly Milestone[], rows: readonly MilestoneRow[]): MilestoneChanges {
  const keptIds = new Set(rows.flatMap((r) => (r.id === undefined ? [] : [r.id])));
  const changes: MilestoneChanges = { remove: held.filter((m) => !keptIds.has(m.id)).map((m) => m.id), edit: [], add: [] };
  rows.forEach((row, position) => {
    const title = row.title.trim();
    const due = row.due_on as Day;
    if (row.id === undefined) {
      changes.add.push({ title, due_on: due, position });
      return;
    }
    const before = held.find((m) => m.id === row.id);
    if (before === undefined) return;
    if (before.title !== title || before.due_on !== due || before.position !== position) changes.edit.push({ id: row.id, title, due_on: due, position });
  });
  return changes;
}

export async function saveMilestones(projectId: Id, held: readonly Milestone[], rows: readonly MilestoneRow[]): Promise<Outcome<void>> {
  const changes = milestoneChanges(held, rows);
  for (const id of changes.remove) {
    const out = await removeMilestone(id);
    if (!out.ok) return { ...out, unfinished: null };
  }
  for (const e of changes.edit) {
    const out = await editMilestone(e.id, { title: e.title, due_on: e.due_on, position: e.position });
    if (!out.ok) return { ...out, unfinished: null };
  }
  for (const a of changes.add) {
    const out = await addMilestone(projectId, a);
    if (!out.ok) return { ...out, unfinished: null };
  }
  return { ok: true, value: undefined };
}
