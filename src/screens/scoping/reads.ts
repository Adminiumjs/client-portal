/**
 * What the worksheet reads when it opens, beyond the desk's boot set (which
 * already holds the settings, the people, the rate card and the terms): every
 * client, to choose who the stage is for; the running costs; and the history —
 * the last finished milestones that carried an estimate, the hours logged on
 * them, and the projects and clients they belong to. All bounded reads.
 */
import type { Id } from "../../data/types.ts";
import { ensureRows, loadPage, loadWhere, useDesk } from "../../state/desk.ts";
import { loadRunningCosts } from "../../state/officeActions.ts";

/** How many finished stages the history looks back over. */
export const HISTORY_SIZE = 12;

/** Read what the worksheet shows; answers the finished milestones of the history, newest first. */
export async function loadWorksheet(): Promise<Id[]> {
  const [, , done] = await Promise.all([
    loadPage("clients", { order: "company.asc", limit: 200, offset: 0 }),
    loadRunningCosts(),
    loadWhere("milestones", { and: [{ column: "state", op: "eq", value: "done" }, { column: "estimated_days", op: "not_null" }] }, "done_at.desc", HISTORY_SIZE),
  ]);
  const ids = done.map((m) => m.id);
  if (ids.length > 0) {
    await Promise.all([loadWhere("time_entries", { column: "milestone_id", op: "in", value: ids }, undefined, 2000), ensureRows("projects", done.map((m) => m.project_id))]);
    const projects = useDesk.getState().rows.projects;
    await ensureRows("clients", done.map((m) => projects[m.project_id]?.client_id ?? null));
  }
  return ids;
}
