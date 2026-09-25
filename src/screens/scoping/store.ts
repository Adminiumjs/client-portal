/**
 * The worksheet being worked, held in this tab's memory only: it survives a
 * trip to Settings and back, and nothing of it is written anywhere — not to
 * Adminium, not to the browser's storage — until "Turn this into a proposal".
 * A reload starts a blank sheet.
 */
import { create } from "zustand";

import type { Worksheet } from "../../state/scoping.ts";
import { EMPTY_SHEET } from "./model.ts";

// Marked pure: a build that never draws the worksheet (the clients' side) leaves the store out.
export const useWorksheet = /* @__PURE__ */ create<{ sheet: Worksheet }>(() => ({ sheet: EMPTY_SHEET }));

/** Change the sheet. */
export function editSheet(change: (sheet: Worksheet) => Worksheet): void {
  useWorksheet.setState((s) => ({ sheet: change(s.sheet) }));
}

/** A blank sheet (tests, and the demo's reset). */
export function resetWorksheet(): void {
  useWorksheet.setState({ sheet: EMPTY_SHEET });
}
