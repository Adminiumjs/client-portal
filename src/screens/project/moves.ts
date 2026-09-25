/**
 * "Mark done…": every open milestone closes, then the project moves to done.
 *
 * The desk's own action does it (`state/actions.ts` `markProjectDone`, a step
 * list: the milestones first and the project's move LAST, so the project never
 * shows as done with work still open; finishing after a failure closes only
 * what is still open). The milestones on screen are no longer needed: the
 * action reads the project's milestones itself.
 */
import type { Id, Milestone, Project } from "../../data/types.ts";
import { markProjectDone as markDone, type Outcome } from "../../state/actions.ts";

export function markProjectDone(projectId: Id, _milestones?: readonly Milestone[]): Promise<Outcome<Project>> {
  return markDone(projectId);
}

/**
 * The state a milestone goes back to when it is un-ticked: in progress when no
 * other milestone of the project is, else next.
 */
export function reopenedState(milestone: Milestone, milestones: readonly Milestone[]): "now" | "next" {
  return milestones.some((m) => m.id !== milestone.id && m.project_id === milestone.project_id && m.state === "now") ? "next" : "now";
}
