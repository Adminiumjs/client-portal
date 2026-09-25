/**
 * What the Projects board and one project work out from the rows the desk
 * holds — nothing here is saved, and nothing here is money the browser makes:
 *
 *   progress        the ring's percentage: a done milestone counts whole, the
 *                   one in progress counts half, over the project's milestones
 *   next            the first milestone not done, in the studio's order
 *   board groups    active / paused / done, newest first inside each
 *   card date       "Shared 25 Jul" / "Approved 2 Jul" / "Changes asked 24 Jul"
 *   stages left     whether the proposal behind a project still has a share
 *                   of the whole to invoice (read from the stage invoices'
 *                   stored shares, never from amounts)
 *   invoice chips   "{number} · {balance} open" / "paid" / "void"
 *   the brief       each answered question under its question, in order
 */
import type { Brief, BriefAnswer, BriefQuestion, Day, Deliverable, Id, Instant, Invoice, Milestone, Project, Proposal } from "../../data/types.ts";
import { daysBetween } from "../../data/venueTime.ts";
import { isPositive } from "../../lib/money.ts";

/** A project's milestones, in the studio's order. */
export function milestonesOf(all: readonly Milestone[], projectId: Id): Milestone[] {
  return all.filter((m) => m.project_id === projectId).sort((a, b) => a.position - b.position || a.id - b.id);
}

/** A project's deliverables, in the studio's order. */
export function deliverablesOf(all: readonly Deliverable[], projectId: Id): Deliverable[] {
  return all.filter((d) => d.project_id === projectId).sort((a, b) => a.position - b.position || a.id - b.id);
}

/** How far along a project is, 0–100: a done milestone counts whole, one in progress half. */
export function progress(milestones: readonly Milestone[]): number {
  if (milestones.length === 0) return 0;
  const worth = milestones.reduce((sum, m) => sum + (m.state === "done" ? 1 : m.state === "now" ? 0.5 : 0), 0);
  return Math.round((worth / milestones.length) * 100);
}

export const doneCount = (milestones: readonly Milestone[]): number => milestones.filter((m) => m.state === "done").length;

/** The first milestone not done yet. */
export const nextMilestone = (milestones: readonly Milestone[]): Milestone | undefined => milestones.find((m) => m.state !== "done");

/** The ring's colour: paused waits, finished is good, the rest is the studio's accent. */
export function ringTone(project: Pick<Project, "status">, pct: number): "warn" | "pos" | "accent" {
  if (project.status === "paused") return "warn";
  return pct === 100 || project.status === "done" ? "pos" : "accent";
}

/** The ring's stroke: `dash gap` over the circle's length (the design's r = 15.5). */
export const RING = 97.39;
export const ringDash = (pct: number): string => `${((RING * Math.max(0, Math.min(100, pct))) / 100).toFixed(2)} ${RING.toFixed(2)}`;

/** Whole days from today to a due day: 0 today, 2 in two days, −3 three days ago. */
export const daysUntil = (due: Day, today: Day): number => daysBetween(today, due);

/** The last milestone's due day (what "Delivered {day}" names when nothing is left). */
export const lastDue = (milestones: readonly Milestone[]): Day | null => milestones.reduce<Day | null>((last, m) => (m.due_on !== null && (last === null || m.due_on > last) ? m.due_on : last), null);

// ── the board ───────────────────────────────────────────────────────────────

export type BoardGroup = "active" | "paused" | "done";
export const BOARD_GROUPS: readonly BoardGroup[] = ["active", "paused", "done"];

/** Projects by status: running and paused ones by when they started, done ones by when they finished — newest first. */
export function boardGroups(projects: readonly Project[]): Record<BoardGroup, Project[]> {
  const by = (status: BoardGroup) => projects.filter((p) => p.status === status);
  const newest = (key: (p: Project) => string | null) => (a: Project, b: Project) => (key(b) ?? "").localeCompare(key(a) ?? "") || b.id - a.id;
  return {
    active: by("active").sort(newest((p) => p.started_on)),
    paused: by("paused").sort(newest((p) => p.started_on)),
    done: by("done").sort(newest((p) => p.done_on)),
  };
}

// ── deliverables ────────────────────────────────────────────────────────────

/** What a deliverable's card says under its title, and the day or moment it names. */
export type CardDate = { kind: "notShared" } | { kind: "approved"; day: Day } | { kind: "changes"; at: Instant } | { kind: "shared"; at: Instant } | { kind: "none" };

export function cardDate(d: Deliverable): CardDate {
  if (d.status === "unshared") return { kind: "notShared" };
  if (d.status === "approved") {
    if (d.approved_on !== null) return { kind: "approved", day: d.approved_on };
    if (d.reviewed_at !== null) return { kind: "approved", day: d.reviewed_at.slice(0, 10) };
  }
  if (d.status === "changes" && d.reviewed_at !== null) return { kind: "changes", at: d.reviewed_at };
  return d.shared_at === null ? { kind: "none" } : { kind: "shared", at: d.shared_at };
}

/** The pill a deliverable wears: an unshared one says so (the client can't see it). */
export const deliverablePill = (d: Pick<Deliverable, "status">): "notShared" | "pending" | "approved" | "changes" => (d.status === "unshared" ? "notShared" : d.status);

// ── invoicing the stages ────────────────────────────────────────────────────

/**
 * Whether the proposal behind a project still has a stage to invoice: its
 * stage invoices (not void) hold less than the whole between them. A project
 * with no proposal has no stages; a done project invoices nothing more here.
 */
export function stageLeft(project: Project, proposal: Proposal | undefined, invoices: readonly Invoice[]): boolean {
  if (project.status === "done" || project.proposal_id === null || proposal === undefined || proposal.status !== "accepted") return false;
  const taken = invoices.filter((i) => i.from_quote_id === proposal.id && i.status !== "void").reduce((sum, i) => sum + Number(i.share_pct ?? 0), 0);
  return taken < 100 - 1e-9;
}

/** One chip per invoice of the project: its balance while one is open, else paid, or void. */
export type InvoiceChip = { id: Id; number: string | null; kind: "open"; balance: string; currency: string | null } | { id: Id; number: string | null; kind: "paid" | "void" | "draft" };

export function invoiceChips(invoices: readonly Invoice[], projectId: Id): InvoiceChip[] {
  return invoices
    .filter((i) => i.project_id === projectId)
    .sort((a, b) => a.id - b.id)
    .map((i): InvoiceChip => {
      if (i.status === "void") return { id: i.id, number: i.number, kind: "void" };
      if (i.status === "draft") return { id: i.id, number: i.number, kind: "draft" };
      return isPositive(i.balance) ? { id: i.id, number: i.number, kind: "open", balance: i.balance ?? "0", currency: i.currency } : { id: i.id, number: i.number, kind: "paid" };
    });
}

// ── the brief ───────────────────────────────────────────────────────────────

export interface BriefRow {
  key: string;
  question: string;
  answer: string;
}

/** The answered questions of a sent brief, in the questions' order (an answer to a retired question still shows). */
export function briefRows(brief: Brief | undefined, answers: readonly BriefAnswer[], questions: readonly BriefQuestion[]): BriefRow[] {
  if (brief === undefined) return [];
  const mine = answers.filter((a) => a.brief_id === brief.id && (a.answer ?? "").trim() !== "");
  const order = [...questions].sort((a, b) => a.position - b.position);
  const rows: BriefRow[] = [];
  for (const q of order) {
    const a = mine.find((x) => x.question_key === q.key);
    if (a !== undefined) rows.push({ key: q.key, question: q.question, answer: (a.answer ?? "").trim() });
  }
  for (const a of mine) if (!order.some((q) => q.key === a.question_key)) rows.push({ key: a.question_key, question: a.question_key, answer: (a.answer ?? "").trim() });
  return rows;
}

/** The first word of a name ("Amara Osei" → "Amara"): how the desk speaks of a contact. */
export const firstName = (name: string | null | undefined): string => (name ?? "").trim().split(/\s+/)[0] ?? "";
