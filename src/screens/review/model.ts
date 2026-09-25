/**
 * What the deliverable review works out from the rows it holds:
 *
 *   versions   oldest first as posted; each named by its stored number, or —
 *              while Adminium has not numbered it (a sample row) — by its
 *              place in that order
 *   pins       the notes of ONE version that carry a point, numbered in the
 *              order they were said; a pin is stored as percentages (0–100)
 *              of the drawn file, so a new version starts with none
 *   a pin      a click on the drawing is kept here until "Send note" stores
 *              it with its words (the newest pin still without words takes them)
 *   the line   who approved, how and when — in the portal, or marked by the studio
 */
import type { Day, Deliverable, DeliverableNote, DeliverableVersion, Id } from "../../data/types.ts";

/** A deliverable's versions, oldest first (the order they were posted). */
export function versionsOf(all: readonly DeliverableVersion[], deliverableId: Id): DeliverableVersion[] {
  return all
    .filter((v) => v.deliverable_id === deliverableId)
    .sort((a, b) => (a.v !== null && b.v !== null ? a.v - b.v : 0) || (a.posted_at ?? "").localeCompare(b.posted_at ?? "") || a.id - b.id);
}

/** A version's number: the stored one, or its place among its deliverable's versions. */
export function versionNumber(version: DeliverableVersion, ordered: readonly DeliverableVersion[]): number {
  if (version.v !== null) return version.v;
  const at = ordered.findIndex((v) => v.id === version.id);
  return at === -1 ? ordered.length + 1 : at + 1;
}

/** The number the next version will likely take (Adminium decides it on save). */
export const nextVersionNumber = (ordered: readonly DeliverableVersion[]): number => ordered.reduce((max, v) => Math.max(max, versionNumber(v, ordered)), 0) + 1;

/** A deliverable's notes, in the order they were said. */
export function notesOf(all: readonly DeliverableNote[], deliverableId: Id): DeliverableNote[] {
  return all.filter((n) => n.deliverable_id === deliverableId).sort((a, b) => (a.at ?? "").localeCompare(b.at ?? "") || a.id - b.id);
}

/** A point on the drawn file, in percent of its width and height. */
export interface Point {
  x: number;
  y: number;
}

export interface Pin extends Point {
  n: number;
  /** The note it carries; null while it has no words yet (not stored). */
  noteId: Id | null;
  body: string | null;
}

const percent = (value: string | null): number | null => {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};

/** The pins on one version: its stored pinned notes, then this page's pins without words. */
export function pinsOf(notes: readonly DeliverableNote[], versionId: Id, unworded: readonly Point[] = []): Pin[] {
  const stored = notes.flatMap((note): Pin[] => {
    const x = percent(note.pin_x);
    const y = percent(note.pin_y);
    return note.version_id === versionId && x !== null && y !== null ? [{ n: 0, x, y, noteId: note.id, body: note.body }] : [];
  });
  return [...stored, ...unworded.map((p): Pin => ({ n: 0, x: p.x, y: p.y, noteId: null, body: null }))].map((pin, i) => ({ ...pin, n: i + 1 }));
}

/** Where a click fell on the drawing, as a stored pin: percentages with two decimals, kept inside the edges. */
export function pointOf(click: { x: number; y: number }, box: { left: number; top: number; width: number; height: number }): Point | null {
  if (box.width <= 0 || box.height <= 0) return null;
  const clamp = (v: number) => Math.round(Math.max(0.5, Math.min(99.5, v)) * 100) / 100;
  return { x: clamp(((click.x - box.left) / box.width) * 100), y: clamp(((click.y - box.top) / box.height) * 100) };
}

/** A pin's value as the column stores it ("42.5"). */
export const pinValue = (n: number): string => String(Math.round(n * 100) / 100);

/** The pin a note being sent takes: the newest one still without words. */
export function pinForNote(unworded: readonly Point[]): Point | null {
  return unworded.length === 0 ? null : unworded[unworded.length - 1]!;
}

/** Which words the pin hint uses. */
export const pinHint = (pins: number): "none" | "one" | "many" => (pins === 0 ? "none" : pins === 1 ? "one" : "many");

/** Who approved, how and when — or null when the deliverable isn't approved. */
export type ApprovedLine = { kind: "portal"; who: string; day: string } | { kind: "studio"; how: "email" | "call" | "meeting"; who: string; day: string } | null;

export function approvedLine(d: Deliverable): ApprovedLine {
  if (d.status !== "approved") return null;
  const day = d.approved_on ?? d.reviewed_at?.slice(0, 10) ?? "";
  const who = (d.approved_by ?? "").trim().split(/\s+/)[0] ?? "";
  if (d.approved_how === "portal" || d.approved_how === null) return { kind: "portal", who, day };
  return { kind: "studio", how: d.approved_how, who, day };
}

/** What the studio may do from the review, by the deliverable's state. */
export function reviewMoves(d: Pick<Deliverable, "status">): { share: boolean; markApproved: boolean; confirmOverChanges: boolean } {
  return { share: d.status === "unshared", markApproved: d.status === "pending" || d.status === "changes", confirmOverChanges: d.status === "changes" };
}

/** What is wrong with the day an approval is marked on: none typed, a day to come, or before the version was shared. */
export function dayProblem(day: string, earliest: Day | null, latest: Day): "none" | "future" | "early" | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "none";
  if (day > latest) return "future";
  if (earliest !== null && day < earliest) return "early";
  return null;
}
