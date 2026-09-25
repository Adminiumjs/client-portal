/**
 * What a proposal's page and the proposals list work out from stored rows:
 * the word its pill says, which buttons its state offers, the stages its
 * payment split invoices, and the milestones a new project starts with.
 *
 * Every amount here is Adminium's (a proposal's subtotal, a stage invoice's
 * share); a stage's figure before its draft exists is the stored subtotal ×
 * the share, shown only — Adminium works the draft's line out itself.
 */
import type { StatusWord } from "../../components/ui.tsx";
import type { Day, Decimal, Id, Invoice, Project, Proposal, ProposalSplit, TermsVersion } from "../../data/types.ts";
import { addDays, daysBetween } from "../../data/venueTime.ts";

/** A sent proposal the client can no longer accept: its valid-until day has passed. */
export const isOutOfDate = (p: Proposal, today: Day): boolean => p.status === "sent" && p.valid_until !== null && daysBetween(today, p.valid_until) < 0;

/** The word a proposal's pill says. */
export function proposalWord(p: Proposal, today: Day): StatusWord {
  if (isOutOfDate(p, today)) return "outOfDate";
  return p.status;
}

/** The proposals list's filters, in the design's order (with "Out of date" beside "Sent"). */
export const PROPOSAL_FILTERS = ["all", "draft", "sent", "outOfDate", "accepted", "declined", "withdrawn"] as const;
export type ProposalFilter = (typeof PROPOSAL_FILTERS)[number];

/** Whether a proposal belongs under a filter: "Sent" counts the ones still in date. */
export function inFilter(p: Proposal, filter: ProposalFilter, today: Day): boolean {
  if (filter === "all") return true;
  if (filter === "outOfDate") return isOutOfDate(p, today);
  if (filter === "sent") return p.status === "sent" && !isOutOfDate(p, today);
  return p.status === filter;
}

// ── how it gets paid ────────────────────────────────────────────────────────

export type StageName = "toStart" | "midway" | "onDelivery";
export type MilestoneName = "halfway" | "delivery" | "firstStage" | "midwayReview";

export interface SplitPlan {
  /** Each stage's share of the proposal, as decimal text. */
  shares: readonly Decimal[];
  names: readonly StageName[];
  /** The milestones a project on this split starts with, after the kickoff. */
  milestones: readonly MilestoneName[];
}

export const SPLIT_PLANS: Readonly<Record<ProposalSplit, SplitPlan>> = {
  "5050": { shares: ["50", "50"], names: ["toStart", "onDelivery"], milestones: ["halfway", "delivery"] },
  "403030": { shares: ["40", "30", "30"], names: ["toStart", "midway", "onDelivery"], milestones: ["firstStage", "midwayReview", "delivery"] },
  end: { shares: ["100"], names: ["onDelivery"], milestones: ["delivery"] },
};

/** A proposal's stage invoices (drafted or sent; void ones left out), oldest first. */
export function stageInvoices(proposalId: Id, invoices: readonly Invoice[]): Invoice[] {
  return invoices.filter((i) => i.from_quote_id === proposalId && i.status !== "void").sort((a, b) => a.id - b.id);
}

export interface NextStage {
  /** Which stage (0 = the first). */
  index: number;
  share: Decimal;
  name: StageName;
}

/** The stage to invoice next, from the stage invoices that exist; null when every stage is invoiced. */
export function nextStage(proposal: Proposal, invoices: readonly Invoice[]): NextStage | null {
  const plan = SPLIT_PLANS[proposal.split];
  const index = stageInvoices(proposal.id, invoices).length;
  if (index >= plan.shares.length) return null;
  return { index, share: plan.shares[index]!, name: plan.names[index]! };
}

/** The milestones a new project starts with: the kickoff in a week, then one per stage three weeks apart. */
export function defaultMilestones(split: ProposalSplit, today: Day): { name: "kickoff" | MilestoneName; due: Day }[] {
  return [{ name: "kickoff" as const, due: addDays(today, 7) }, ...SPLIT_PLANS[split].milestones.map((name, i) => ({ name, due: addDays(today, 21 * (i + 1) + 7) }))];
}

// ── the page's state ────────────────────────────────────────────────────────

export interface ProposalState {
  draft: boolean;
  /** Sent and still in date: a reminder, Extend. */
  live: boolean;
  outOfDate: boolean;
  /** Sent (in date or not): Withdraw. */
  sent: boolean;
  /** Accepted with no project yet: Start the project. */
  needsProject: boolean;
  /** Declined, withdrawn or out of date: Make a revision. */
  canRevise: boolean;
  /** Sent or accepted: the printed copy and the client's view. */
  canPreview: boolean;
  /** Accepted and signed by name. */
  signed: boolean;
  /** Accepted outside the portal and not signed yet. */
  unsigned: boolean;
  /** Declined or withdrawn with words to show. */
  note: "declined" | "withdrawn" | null;
  /** A project started from it and no stage invoice drafted yet. */
  firstInvoiceMissing: boolean;
}

export function proposalState(p: Proposal, today: Day, project: Project | null, invoices: readonly Invoice[]): ProposalState {
  const outOfDate = isOutOfDate(p, today);
  return {
    draft: p.status === "draft",
    live: p.status === "sent" && !outOfDate,
    outOfDate,
    sent: p.status === "sent",
    needsProject: p.status === "accepted" && project === null,
    canRevise: p.status === "declined" || p.status === "withdrawn" || outOfDate,
    canPreview: p.status === "sent" || p.status === "accepted",
    signed: p.status === "accepted" && p.signed_name !== null && p.signed_name.trim() !== "",
    unsigned: p.status === "accepted" && (p.signed_name === null || p.signed_name.trim() === ""),
    note: p.status === "declined" ? "declined" : p.status === "withdrawn" ? "withdrawn" : null,
    firstInvoiceMissing: project !== null && stageInvoices(p.id, invoices).length === 0,
  };
}

/**
 * The name a terms version goes by: its number, or — when Adminium has not
 * numbered it (a sample row) — its place among the versions, oldest first.
 */
export function termsVersionLabel(version: TermsVersion | undefined, all: readonly TermsVersion[]): number | null {
  if (version === undefined) return null;
  if (version.version !== null) return version.version;
  const ordered = [...all].sort((a, b) => (a.in_force_from ?? "9999").localeCompare(b.in_force_from ?? "9999") || a.id - b.id);
  const at = ordered.findIndex((v) => v.id === version.id);
  return at === -1 ? null : at + 1;
}

/** A fingerprint, short enough to read aloud: the first and last four characters. */
export function shortFingerprint(fingerprint: string | null): string | null {
  if (fingerprint === null || fingerprint.trim() === "") return null;
  const f = fingerprint.trim();
  return f.length <= 10 ? f : `${f.slice(0, 4)}…${f.slice(-4)}`;
}

/** The terms version in force, for a new proposal. */
export const inForce = (versions: readonly TermsVersion[]): TermsVersion | null => versions.find((v) => v.status === "in_force") ?? null;
