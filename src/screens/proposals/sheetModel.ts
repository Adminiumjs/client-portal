/**
 * What the proposal's sheets check before they save, and the inputs they
 * hand to `actions.ts`: a later valid-until day (Extend), a reason
 * (Withdraw), a project name and dated milestones (Start the project), and a
 * stage invoice's share, name and title (Start the project, Invoice the next
 * stage). The words go in through `t`, so what is stored reads in the
 * studio's language.
 */
import type { Day, Proposal } from "../../data/types.ts";
import { addDays } from "../../data/venueTime.ts";
import type { MilestoneInput, StageInput, StartProjectInput } from "../../state/actions.ts";
import type { MessageKey } from "../../i18n/index.tsx";
import type { TFunction } from "../../i18n/index.tsx";
import { defaultMilestones, type NextStage } from "./model.ts";

// ── Extend ──────────────────────────────────────────────────────────────────

/** The earliest day a proposal can be extended to: the day after the later of its valid-until and today. */
export function extendMin(proposal: Proposal, today: Day): Day {
  const from = proposal.valid_until !== null && proposal.valid_until > today ? proposal.valid_until : today;
  return addDays(from, 1);
}

/** The day Extend offers first: two weeks on from the later of its valid-until and today. */
export function extendDefault(proposal: Proposal, today: Day): Day {
  const from = proposal.valid_until !== null && proposal.valid_until > today ? proposal.valid_until : today;
  return addDays(from, 14);
}

export type ExtendProblem = { key: "pickDate" } | { key: "pickAfter"; after: Day };

export function extendProblem(day: string, proposal: Proposal, today: Day): ExtendProblem | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { key: "pickDate" };
  const min = extendMin(proposal, today);
  return day < min ? { key: "pickAfter", after: addDays(min, -1) } : null;
}

// ── Withdraw ────────────────────────────────────────────────────────────────

export const reasonMissing = (reason: string): boolean => reason.trim() === "";

// ── Start the project ───────────────────────────────────────────────────────

export interface MilestoneRow {
  key: string;
  title: string;
  due: Day | "";
}

let rowNo = 0;
export const newMilestoneRow = (title = "", due: Day | "" = ""): MilestoneRow => ({ key: `ms-${String(++rowNo)}`, title, due });

/** The milestones a new project starts with, in the page's language. */
export function startingMilestones(proposal: Proposal, today: Day, t: TFunction): MilestoneRow[] {
  return defaultMilestones(proposal.split, today).map((m) => newMilestoneRow(t(`proposals.milestone.${m.name}` as MessageKey), m.due));
}

export type StartProblem = "name" | "milestones";

export function startProblem(name: string, milestones: readonly MilestoneRow[]): StartProblem | null {
  if (name.trim() === "") return "name";
  if (milestones.some((m) => m.title.trim() === "" || m.due === "")) return "milestones";
  return null;
}

/** The stage invoice's share, name and title, in the studio's words. */
export function stageInput(proposal: Proposal, stage: NextStage, t: TFunction): StageInput {
  const words = { title: proposal.title.trim(), pct: stage.share, stage: t(`proposals.stage.${stage.name}` as MessageKey) };
  const title = words.title === "" ? t("proposals.stageTitleNoName", words) : t("proposals.stageTitle", words);
  return { share_pct: stage.share, stage: t(`proposals.stageName.${stage.name}` as MessageKey), title, description: title };
}

/** What Start the project saves: the name, the milestones soonest first, the first stage. */
export function startInput(proposal: Proposal, name: string, milestones: readonly MilestoneRow[], first: NextStage, t: TFunction): StartProjectInput {
  const dated: MilestoneInput[] = [...milestones].sort((a, b) => (a.due as string).localeCompare(b.due as string)).map((m) => ({ title: m.title.trim(), due_on: m.due === "" ? null : m.due }));
  return { name: name.trim(), milestones: dated, firstStage: stageInput(proposal, first, t) };
}
