/**
 * A review's pins and conversation: the studio's pins on the version on show
 * only, placed as a share of the drawing (0–100), numbered in order; a new
 * version starts clean; the conversation reads oldest first, both sides.
 */
import { describe, expect, it } from "vitest";

import type { Tables } from "../../../data/types.ts";
import { pinsOn, thread } from "./model.ts";

const note = (id: number, over: Partial<Tables["deliverable_notes"]>) =>
  ({ id, deliverable_id: 3, version_id: 7, side: "studio", author: "Nadia Cole", body: `note ${id}`, pin_x: null, pin_y: null, at: `2026-07-2${id}T10:00:00.000Z`, ...over }) as Tables["deliverable_notes"];

describe("pins", () => {
  const notes = [
    note(3, { pin_x: "62.5", pin_y: "30" }),
    note(1, { pin_x: "12", pin_y: "140" }),
    note(2, { side: "client", pin_x: "50", pin_y: "50" }),
    note(4, { version_id: 6, pin_x: "40", pin_y: "40" }),
    note(5, {}),
  ];

  it("are the studio's, on this version, numbered in order, kept on the drawing", () => {
    expect(pinsOn(notes, 7)).toEqual([
      { id: 1, n: 1, x: 12, y: 100, body: "note 1" },
      { id: 3, n: 2, x: 62.5, y: 30, body: "note 3" },
    ]);
  });

  it("start clean on a new version", () => {
    expect(pinsOn(notes, 8)).toEqual([]);
  });
});

describe("what was said", () => {
  it("is every note on the deliverable, oldest first", () => {
    expect(thread([note(3, {}), note(1, { side: "client" }), note(2, { deliverable_id: 9 })], 3).map((n) => n.id)).toEqual([1, 3]);
  });
});
