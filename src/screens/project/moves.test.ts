/**
 * The project's writes the screens make through the desk's actions, against
 * the sample studio: "Mark done" closes the open milestones first and moves
 * the project LAST; pressing it again after a failure closes only what is
 * still open. "Edit milestones" removes, patches and adds only what changed.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { fakeStudio, tableOf, type FakeStudio } from "../../testing/fakeStudio.ts";
import { rowsOf, useDesk } from "../../state/desk.ts";
import { milestonesOf } from "./model.ts";
import { badRow, milestoneChanges, removable, saveMilestones } from "./milestones.ts";
import { markProjectDone, reopenedState } from "./moves.ts";

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

const trail = () => studio.writes.map((w) => `${w.op} ${w.table}${w.id === undefined ? "" : ` ${String(w.id)}`}`);
const held = (projectId: number) => milestonesOf(rowsOf(useDesk.getState(), "milestones"), projectId);

describe("Mark done", () => {
  it("closes every open milestone, then moves the project to done — last", async () => {
    const out = await markProjectDone(1, held(1));
    expect(out.ok).toBe(true);
    expect(trail()).toEqual(["update milestones 2", "update milestones 3", "update projects 1"]);
    expect(studio.writes.map((w) => w.values)).toEqual([{ state: "done" }, { state: "done" }, { status: "done" }]);
    expect(tableOf(studio, "projects").find((p) => p["id"] === 1)).toMatchObject({ status: "done", done_on: "2026-07-28" });
  });

  it("after a lost answer, pressing again closes only what is still open — nothing twice", async () => {
    studio.failWrite(2, "before");
    const first = await markProjectDone(1, held(1));
    expect(first.ok).toBe(false);
    expect(trail()).toEqual(["update milestones 2", "update milestones 3"]);
    expect(tableOf(studio, "projects").find((p) => p["id"] === 1)?.["status"]).toBe("active");
    studio.writes.length = 0;
    const again = await markProjectDone(1, held(1));
    expect(again.ok).toBe(true);
    expect(trail()).toEqual(["update milestones 3", "update projects 1"]);
  });

  it("un-ticking puts a milestone back in progress, or next when another one is", () => {
    const list = held(1);
    expect(reopenedState(list[0]!, list)).toBe("next");
    expect(reopenedState(list[0]!, list.map((m) => ({ ...m, state: m.state === "now" ? ("next" as const) : m.state })))).toBe("now");
  });
});

describe("Edit milestones", () => {
  it("works out what changed: gone rows removed, changed ones patched (with their new place), new ones added", () => {
    const before = held(1);
    const rows = [
      { id: 3, title: "Print and hand over", due_on: "2026-08-21" },
      { id: 2, title: "Artwork, final", due_on: "2026-07-31" },
      { title: "  Press check ", due_on: "2026-08-25" },
    ];
    expect(milestoneChanges(before, rows)).toEqual({
      remove: [1],
      edit: [
        { id: 3, title: "Print and hand over", due_on: "2026-08-21", position: 0 },
        { id: 2, title: "Artwork, final", due_on: "2026-07-31", position: 1 },
      ],
      add: [{ title: "Press check", due_on: "2026-08-25", position: 2 }],
    });
    expect(milestoneChanges(before, before.map((m) => ({ id: m.id, title: m.title, due_on: m.due_on ?? "" })))).toEqual({ remove: [], edit: [], add: [] });
  });

  it("saves removals first, then patches, then additions — each as the desk's own write", async () => {
    await saveMilestones(2, held(2), [{ id: 4, title: "Window sketches, round two", due_on: "2026-07-30" }, { title: "Photos", due_on: "2026-08-10" }]);
    expect(trail()).toEqual(["remove milestones 5", "update milestones 4", "insert milestones"]);
    expect(studio.writes[1]!.values).toEqual({ title: "Window sketches, round two", due_on: "2026-07-30", position: 0 });
    expect(studio.writes[2]!.values).toMatchObject({ project_id: 2, title: "Photos", due_on: "2026-08-10", position: 1 });
  });

  it("won't save a row without a title or a day; a milestone with work hung on it stays", () => {
    expect(badRow([{ title: "A", due_on: "2026-08-01" }, { title: " ", due_on: "2026-08-02" }])).toBe(1);
    expect(badRow([{ title: "A", due_on: "" }])).toBe(0);
    expect(badRow([{ title: "A", due_on: "2026-08-01" }])).toBe(-1);
    const deliverables = rowsOf(useDesk.getState(), "deliverables");
    expect(removable(4, deliverables)).toBe(false);
    expect(removable(5, deliverables)).toBe(true);
  });
});
