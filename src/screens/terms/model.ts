/**
 * What the Terms & signature screen works out from stored rows: where each
 * agreement stands, how each terms version is labelled, what a version
 * changed against the one before, the trail of an agreement (every row from
 * a stamp — nothing is tracked that is not stored), whether the client has
 * already been asked to sign, and what a new version copies.
 *
 * A version is locked by Adminium once a proposal naming it has been sent;
 * the screen only follows that (a version with agreements on it offers no
 * edit), it never decides it.
 */
import type { Day, Id, Instant, Message, Project, Proposal, TermsClause, TermsClauseChange, TermsVersion } from "../../data/types.ts";
import { instant, venueDay } from "../../data/venueTime.ts";
import type { ClauseInput } from "../../state/actions.ts";

// ── agreements ──────────────────────────────────────────────────────────────

/** The proposal statuses the agreements list shows. */
export const AGREEMENT_STATUSES = ["sent", "accepted"] as const;

export type AgreementState = "out" | "signed" | "unsigned";

/** Out for decision, signed (a name typed), or accepted with no signature. */
export function agreementState(p: Pick<Proposal, "status" | "signed_name">): AgreementState {
  if (p.status === "sent") return "out";
  return p.signed_name !== null && p.signed_name.trim() !== "" ? "signed" : "unsigned";
}

/** The agreement the screen opens on: the first accepted without a signature, else the first accepted, else the first. */
export function defaultAgreement(list: readonly Proposal[]): Proposal | null {
  return list.find((p) => agreementState(p) === "unsigned") ?? list.find((p) => p.status === "accepted") ?? list[0] ?? null;
}

// ── versions ────────────────────────────────────────────────────────────────

/**
 * Oldest first: by the stored version number, then by key (a sample row may
 * carry no number). A row read back without its state reads as the table's
 * first state, a draft.
 */
export function versionsInOrder(versions: readonly TermsVersion[]): TermsVersion[] {
  return versions.map((v) => (v.status === null || v.status === undefined ? { ...v, status: "draft" as const } : v)).sort((a, b) => (a.version ?? Number.MAX_SAFE_INTEGER) - (b.version ?? Number.MAX_SAFE_INTEGER) || a.id - b.id);
}

/** A version's number as the screen says it: the stored one, else its place in order. */
export function versionNumber(v: TermsVersion, versions: readonly TermsVersion[]): number {
  if (v.version !== null) return v.version;
  return versionsInOrder(versions).findIndex((x) => x.id === v.id) + 1;
}

/** The version that came before (null for the first). */
export function previousVersion(v: TermsVersion, versions: readonly TermsVersion[]): TermsVersion | null {
  const ordered = versionsInOrder(versions);
  const at = ordered.findIndex((x) => x.id === v.id);
  return at > 0 ? (ordered[at - 1] ?? null) : null;
}

/** A retired version's end: the day the next version came into force. */
export function retiredOn(v: TermsVersion, versions: readonly TermsVersion[]): Day | null {
  if (v.status !== "retired") return null;
  const ordered = versionsInOrder(versions);
  const at = ordered.findIndex((x) => x.id === v.id);
  for (const later of ordered.slice(at + 1)) if (later.in_force_from !== null && later.status !== "draft") return later.in_force_from;
  return null;
}

/** The version new proposals use now. */
export function inForce(versions: readonly TermsVersion[]): TermsVersion | null {
  return versions.find((v) => v.status === "in_force") ?? null;
}

/** What a new version starts from: the one in force, else the newest. */
export function copySource(versions: readonly TermsVersion[]): TermsVersion | null {
  return inForce(versions) ?? versionsInOrder(versions).filter((v) => v.status !== "draft").at(-1) ?? versionsInOrder(versions).at(-1) ?? null;
}

/**
 * Whether a version's wording may still change on the desk: never once it
 * has retired, never once a sent proposal names it (`agreements` > 0), and
 * not before that count is known (null).
 */
export function editable(v: TermsVersion, agreements: number | null): boolean {
  return v.status !== "retired" && agreements === 0;
}

/** A version's clauses, in order. */
export function clausesOf(clauses: readonly TermsClause[], versionId: Id): TermsClause[] {
  return clauses.filter((c) => c.version_id === versionId).sort((a, b) => a.position - b.position || a.id - b.id);
}

/** A new version's clauses: the source's full list, each marked as the same. */
export function copyClauses(source: readonly TermsClause[]): ClauseInput[] {
  return [...source].sort((a, b) => a.position - b.position || a.id - b.id).map((c) => ({ title: c.title, body: c.body, change: "same", change_note: null }));
}

/** A clause's mark after an edit: an added clause stays added; any other edit is a change. */
export function changeAfterEdit(c: Pick<TermsClause, "change" | "title" | "body">, next: { title: string; body: string | null }): TermsClauseChange {
  if (c.change === "added") return "added";
  if (c.title === next.title.trim() && (c.body ?? "") === (next.body ?? "").trim()) return c.change;
  return "changed";
}

export interface DiffRow {
  key: string;
  mark: "+" | "~" | "·";
  title: string;
  body: string;
}

/**
 * "What changed in vN, against vN−1": each clause added or changed, with its
 * note (else its wording). The first version has no earlier one: it lists
 * what it covered, from its own note.
 */
export function diffRows(v: TermsVersion, clauses: readonly TermsClause[], versions: readonly TermsVersion[]): DiffRow[] {
  if (previousVersion(v, versions) === null) {
    return v.note === null || v.note.trim() === "" ? [] : [{ key: "first", mark: "·", title: "", body: v.note }];
  }
  return clausesOf(clauses, v.id)
    .filter((c) => c.change !== "same")
    .map((c) => ({ key: String(c.id), mark: c.change === "added" ? "+" : "~", title: c.title, body: c.change_note ?? c.body ?? "" }));
}

// ── the trail ───────────────────────────────────────────────────────────────

export type TrailKind = "sent" | "acceptedSigned" | "acceptedBy" | "signed" | "asked" | "started" | "closed";

export interface TrailRow {
  key: string;
  kind: TrailKind;
  /** The studio's day it happened, when stored. */
  on: Day | null;
  /** The stamp, for a time of day. */
  at: Instant | null;
  tone: "neutral" | "good" | "bad";
}

const dayOf = (at: Instant | null, zone: string): Day | null => (at === null ? null : venueDay(instant(at), zone));

/**
 * An agreement's trail, oldest first — every row a stamp or a stored row:
 * sent, accepted (and signed in the portal, or by another way with no
 * signature), signed later, each signature request, the project started and
 * closed.
 */
export function trailOf(p: Proposal, ctx: { messages: readonly Message[]; project: Project | null; zone: string }): TrailRow[] {
  const rows: TrailRow[] = [];
  if (p.sent_at !== null) rows.push({ key: "sent", kind: "sent", on: dayOf(p.sent_at, ctx.zone), at: p.sent_at, tone: "neutral" });
  if (p.status === "accepted") {
    const signed = p.signed_name !== null && p.signed_name.trim() !== "";
    if (p.accepted_how === "portal" && signed) {
      const at = p.signed_at ?? p.decided_at;
      rows.push({ key: "accepted", kind: "acceptedSigned", on: dayOf(at, ctx.zone), at, tone: "good" });
    } else {
      rows.push({ key: "accepted", kind: "acceptedBy", on: dayOf(p.decided_at, ctx.zone), at: p.decided_at, tone: "bad" });
      if (signed) rows.push({ key: "signed", kind: "signed", on: dayOf(p.signed_at, ctx.zone), at: p.signed_at, tone: "good" });
    }
  }
  for (const m of asks(ctx.messages, p.id)) rows.push({ key: `ask-${String(m.id)}`, kind: "asked", on: dayOf(m.sent_at, ctx.zone), at: m.sent_at, tone: "neutral" });
  if (ctx.project !== null && ctx.project.started_on !== null) rows.push({ key: "started", kind: "started", on: ctx.project.started_on, at: null, tone: "neutral" });
  if (ctx.project !== null && ctx.project.status === "done" && ctx.project.done_on !== null) rows.push({ key: "closed", kind: "closed", on: ctx.project.done_on, at: null, tone: "neutral" });
  // Oldest first; a request still on its way (no day yet) goes last.
  return rows.map((r, i) => ({ r, i })).sort((a, b) => (a.r.on ?? "9999").localeCompare(b.r.on ?? "9999") || a.i - b.i).map((x) => x.r);
}

/** The message that sent the proposal (its stored recipient is who it went to). */
export function sentMessage(messages: readonly Message[], proposalId: Id): Message | null {
  return messages.filter((m) => m.proposal_id === proposalId && m.kind === "proposal-sent" && m.status === "sent").sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""))[0] ?? null;
}

/** Every "ask them to sign" for a proposal that went, or is going, out. */
function asks(messages: readonly Message[], proposalId: Id): Message[] {
  return messages.filter((m) => m.proposal_id === proposalId && m.kind === "ask-to-sign" && m.status !== "skipped" && m.status !== "failed").sort((a, b) => (a.sent_at ?? "~").localeCompare(b.sent_at ?? "~") || a.id - b.id);
}

/**
 * Whether the client has been asked to sign today already — one ask a day;
 * the next day the button asks again. A request not sent yet counts as today's.
 */
export function askedState(messages: readonly Message[], proposalId: Id, today: Day, zone: string): "never" | "today" | "before" {
  const all = asks(messages, proposalId);
  if (all.length === 0) return "never";
  return all.some((m) => m.sent_at === null || dayOf(m.sent_at, zone) === today) ? "today" : "before";
}

// ── the fingerprint ─────────────────────────────────────────────────────────

/** The stored fingerprint, shown short: first four … last four. */
export function shortFingerprint(fp: string | null): string | null {
  if (fp === null || fp.trim() === "") return null;
  const f = fp.trim();
  return f.length <= 10 ? f : `${f.slice(0, 4)}…${f.slice(-4)}`;
}
