/**
 * A review's notes, as the page draws them: the conversation in order, and
 * the pins the studio placed on the version on show. A pin's place is stored
 * as a share of the drawing (0–100 across, 0–100 down), so it lands on the
 * same spot whatever size the drawing is shown at; a new version starts with
 * no pins, because pins belong to the version they were put on.
 */
import type { Id, Tables } from "../../../data/types.ts";

type Note = Tables["deliverable_notes"];

export interface Pin {
  id: Id;
  n: number;
  x: number;
  y: number;
  body: string;
}

const clamp = (v: number): number => Math.min(100, Math.max(0, v));

/** The studio's pins on one version, numbered in the order they were made. */
export function pinsOn(notes: readonly Note[], versionId: Id): Pin[] {
  return notes
    .filter((n) => n.version_id === versionId && n.side === "studio" && n.pin_x !== null && n.pin_y !== null && Number.isFinite(Number(n.pin_x)) && Number.isFinite(Number(n.pin_y)))
    .sort(byTime)
    .map((n, i) => ({ id: n.id, n: i + 1, x: clamp(Number(n.pin_x)), y: clamp(Number(n.pin_y)), body: n.body }));
}

/** Everything said on a deliverable, both sides, oldest first. */
export function thread(notes: readonly Note[], deliverableId: Id): Note[] {
  return notes.filter((n) => n.deliverable_id === deliverableId).sort(byTime);
}

function byTime(a: Note, b: Note): number {
  const at = (a.at ?? "").localeCompare(b.at ?? "");
  return at !== 0 ? at : a.id - b.id;
}
