/**
 * The brief's answers, saved as typed: a moment after the typing stops, one
 * save per question at a time, the latest text winning — so the first save
 * creates the answer and the next ones change it, never a second answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Outcome } from "../../../state/outcome.ts";
import { createSaver, type SaverState } from "./saver.ts";

let calls: [string, string][];
let release: (() => void)[];
let states: SaverState[];

const ok: Outcome<void> = { ok: true, value: undefined };
const slowSave = (question: string, answer: string) => {
  calls.push([question, answer]);
  return new Promise<Outcome<void>>((resolve) => release.push(() => resolve(ok)));
};

beforeEach(() => {
  vi.useFakeTimers();
  calls = [];
  release = [];
  states = [];
});
afterEach(() => vi.useRealTimers());

describe("saving answers as they are typed", () => {
  it("waits for the typing to stop, then saves the latest text once", async () => {
    const saver = createSaver(slowSave, (s) => states.push(s), 700);
    saver.change("feel", "W");
    saver.change("feel", "Warm");
    saver.change("feel", "Warm, local");
    await vi.advanceTimersByTimeAsync(699);
    expect(calls).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(calls).toEqual([["feel", "Warm, local"]]);
    release.shift()!();
    await vi.runAllTimersAsync();
    expect(saver.state()).toMatchObject({ pending: 0, saved: true, error: null });
  });

  it("never sends a question's next save while its last is on its way", async () => {
    const saver = createSaver(slowSave, (s) => states.push(s), 100);
    saver.change("feel", "Warm");
    await vi.advanceTimersByTimeAsync(100);
    saver.change("feel", "Warm, local");
    await vi.advanceTimersByTimeAsync(100);
    saver.change("feel", "Warm, local, early");
    await vi.advanceTimersByTimeAsync(100);
    // The first is still on its way: nothing else has gone.
    expect(calls).toEqual([["feel", "Warm"]]);
    release.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    // Then only the latest text follows.
    expect(calls).toEqual([
      ["feel", "Warm"],
      ["feel", "Warm, local, early"],
    ]);
    release.shift()!();
    await vi.runAllTimersAsync();
    expect(saver.state().pending).toBe(0);
  });

  it("saves at once when the field is left, and keeps questions apart", async () => {
    const saver = createSaver(slowSave, (s) => states.push(s), 700);
    saver.change("feel", "Warm");
    saver.change("avoid", "Pastels");
    const flushed = saver.flush();
    expect(calls).toEqual([
      ["feel", "Warm"],
      ["avoid", "Pastels"],
    ]);
    release.splice(0).forEach((r) => r());
    await flushed;
    expect(saver.state()).toMatchObject({ pending: 0, saved: true });
  });

  it("holds on to a refusal until a later save goes through", async () => {
    let fail = true;
    const saver = createSaver(
      async () => (fail ? { ok: false, reason: "offline", code: "NETWORK", field: null, details: {}, unfinished: null } : ok),
      (s) => states.push(s),
      10,
    );
    saver.change("feel", "Warm");
    await vi.advanceTimersByTimeAsync(10);
    expect(saver.state().error).toMatchObject({ reason: "offline" });
    fail = false;
    saver.change("feel", "Warm!");
    await vi.advanceTimersByTimeAsync(10);
    expect(saver.state().error).toBeNull();
  });
});
