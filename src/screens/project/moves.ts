/**
 * "Mark done…": every open milestone closes, then the project moves to done.
 *
 * Each write is one of the desk's own actions (`state/actions.ts`); nothing
 * here writes a row. The milestones go first and the project's move LAST, so
 * the project never shows as done with work still open; pressing the button
 * again after a failure closes only what is still open, so nothing is written
 * twice.
 */
import type { Id, Milestone, Project } from "../../data/types.ts";
import { moveProject, setMilestoneState, type Outcome } from "../../state/actions.ts";

export async function markProjectDone(projectId: Id, milestones: readonly Milestone[]): Promise<Outcome<Project>> {
  for (const m of milestones) {
    if (m.project_id !== projectId || m.state === "done") continue;
    const closed = await setMilestoneState(m.id, "done");
    if (!closed.ok) return { ...closed, unfinished: null };
  }
  return moveProject(projectId, "done");
}

/**
 * The state a milestone goes back to when it is un-ticked: in progress when no
 * other milestone of the project is, else next.
 */
export function reopenedState(milestone: Milestone, milestones: readonly Milestone[]): "now" | "next" {
  return milestones.some((m) => m.id !== milestone.id && m.project_id === milestone.project_id && m.state === "now") ? "next" : "now";
}
