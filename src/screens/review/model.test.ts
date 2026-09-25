/**
 * The review's own reckoning: versions in posting order and named by their
 * number or — while unnumbered — by their place; pins kept per version as
 * percentages of the drawn file (a new version starts clean); where a click
 * lands; which pin a note takes; the approval line; what the studio may do
 * by the deliverable's state; the approval day's limits.
 */
import { describe, expect, it } from "vitest";

import type { Deliverable, DeliverableNote, DeliverableVersion } from "../../data/types.ts";
import { approvedLine, dayProblem, nextVersionNumber, notesOf, pinForNote, pinHint, pinsOf, pinValue, pointOf, reviewMoves, versionNumber, versionsOf } from "./model.ts";

const version = (id: number, v: number | null, posted_at: string | null, deliverable_id = 1): DeliverableVersion => ({
  id,
  deliverable_id,
  client_id: 1,
  v,
  file: null,
  link: null,
  note: null,
  posted_by: "Nadia Cole",
  posted_at,
  client_key: null,
});

const note = (id: number, version_id: number | null, pin: [string, string] | null, at = `2026-07-2${String(id)}T10:00:00.000Z`): DeliverableNote => ({
  id,
  deliverable_id: 1,
  client_id: 1,
  version_id,
  side: "client",
  author: "Amara Osei",
  body: `note ${String(id)}`,
  pin_x: pin?.[0] ?? null,
  pin_y: pin?.[1] ?? null,
  at,
  client_key: null,
});

describe("versions", () => {
  it("run oldest first; an unnumbered version is named by its place", () => {
    const all = [version(12, null, "2026-07-26T10:00:00Z"), version(10, null, "2026-07-20T10:00:00Z"), version(11, null, "2026-07-22T10:00:00Z"), version(99, 1, "2026-01-01T00:00:00Z", 2)];
    const mine = versionsOf(all, 1);
    expect(mine.map((v) => v.id)).toEqual([10, 11, 12]);
    expect(mine.map((v) => versionNumber(v, mine))).toEqual([1, 2, 3]);
    expect(nextVersionNumber(mine)).toBe(4);
  });

  it("keep Adminium's number when it has given one", () => {
    const mine = versionsOf([version(1, 3, "2026-07-26T10:00:00Z"), version(2, 2, "2026-07-20T10:00:00Z")], 1);
    expect(mine.map((v) => versionNumber(v, mine))).toEqual([2, 3]);
    expect(nextVersionNumber(mine)).toBe(4);
    expect(nextVersionNumber([])).toBe(1);
  });
});

describe("pins", () => {
  const notes = notesOf([note(3, 10, ["80", "20"]), note(1, 10, ["42.5", "58"]), note(2, 10, null), note(4, 11, ["10", "10"])], 1);

  it("belong to one version: v2's pins are not v3's", () => {
    expect(pinsOf(notes, 10).map((p) => [p.n, p.x, p.y, p.noteId])).toEqual([
      [1, 42.5, 58, 1],
      [2, 80, 20, 3],
    ]);
    expect(pinsOf(notes, 11).map((p) => p.noteId)).toEqual([4]);
    expect(pinsOf(notes, 12)).toEqual([]);
  });

  it("number the pins still without words after the ones said", () => {
    const pins = pinsOf(notes, 10, [{ x: 5, y: 6 }]);
    expect(pins.at(-1)).toEqual({ n: 3, x: 5, y: 6, noteId: null, body: null });
  });

  it("store a click as percentages of the drawing, two decimals, kept inside its edges", () => {
    const box = { left: 100, top: 50, width: 400, height: 200 };
    expect(pointOf({ x: 300, y: 150 }, box)).toEqual({ x: 50, y: 50 });
    expect(pointOf({ x: 101.234, y: 51 }, box)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointOf({ x: 900, y: 999 }, box)).toEqual({ x: 99.5, y: 99.5 });
    expect(pointOf({ x: 1, y: 1 }, { ...box, width: 0 })).toBeNull();
    expect(pinValue(42.123)).toBe("42.12");
  });

  it("give a note the newest pin without words, and word the hint by how many wait", () => {
    expect(pinForNote([])).toBeNull();
    expect(pinForNote([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toEqual({ x: 2, y: 2 });
    expect([pinHint(0), pinHint(1), pinHint(4)]).toEqual(["none", "one", "many"]);
  });

  it("read a stored value that is out of range back inside it", () => {
    expect(pinsOf([note(9, 10, ["140", "-3"])], 10)[0]).toMatchObject({ x: 100, y: 0 });
  });
});

describe("the client's side", () => {
  const d = (patch: Partial<Deliverable>): Deliverable => ({ id: 1, status: "approved", approved_how: "email", approved_on: "2026-07-28", approved_by: "Nadia Cole", reviewed_at: null, ...patch }) as Deliverable;

  it("says who approved, how and when — in the portal, or marked by the studio", () => {
    expect(approvedLine(d({}))).toEqual({ kind: "studio", how: "email", who: "Nadia", day: "2026-07-28" });
    expect(approvedLine(d({ approved_how: "portal", approved_by: "Cleo Marchetti" }))).toEqual({ kind: "portal", who: "Cleo", day: "2026-07-28" });
    expect(approvedLine(d({ status: "pending" }))).toBeNull();
  });

  it("offers Share on an unshared one, Mark approved while pending or with changes asked (confirming then), nothing once approved", () => {
    expect(reviewMoves({ status: "unshared" })).toEqual({ share: true, markApproved: false, confirmOverChanges: false });
    expect(reviewMoves({ status: "pending" })).toEqual({ share: false, markApproved: true, confirmOverChanges: false });
    expect(reviewMoves({ status: "changes" })).toEqual({ share: false, markApproved: true, confirmOverChanges: true });
    expect(reviewMoves({ status: "approved" })).toEqual({ share: false, markApproved: false, confirmOverChanges: false });
  });

  it("takes an approval day no earlier than the version was shared and no later than today", () => {
    expect(dayProblem("", "2026-07-20", "2026-07-28")).toBe("none");
    expect(dayProblem("2026-07-29", "2026-07-20", "2026-07-28")).toBe("future");
    expect(dayProblem("2026-07-19", "2026-07-20", "2026-07-28")).toBe("early");
    expect(dayProblem("2026-07-20", "2026-07-20", "2026-07-28")).toBeNull();
    expect(dayProblem("2026-01-01", null, "2026-07-28")).toBeNull();
  });
});
