/**
 * Which sheet is open over the desk (or the clients' page), and its draft.
 *
 * One sheet at a time. A sheet keeps what the person has typed in `draft`
 * (so the demo card, a live update or a re-render never loses it), and an
 * action that stopped half-way in `unfinished` — the sheet then shows "A step
 * didn't save — Finish it", and finishing runs the same action key from the
 * first step not done (`data/sink.ts` `runSteps`).
 *
 * The sheets themselves are `src/sheets/*` (the desk's) and
 * `src/sheets/client/*` (the clients'); `SheetHost` draws the open one.
 */
import { create } from "zustand";

import type { Day, Id } from "../data/types.ts";
import type { Unfinished } from "./outcome.ts";

/** What the generic "add" sheet adds. */
export type AddKind = "enquiry" | "project" | "client" | "clientEdit" | "invoice" | "milestone" | "person" | "rate";

/** Every sheet the desk opens, with what it is about. */
export type DeskSheet =
  | { kind: "add"; what: AddKind; about?: { clientId?: Id; projectId?: Id; milestoneId?: Id; personId?: Id; rateId?: Id } }
  | { kind: "send"; table: "proposals" | "invoices"; id: Id }
  | { kind: "startProject"; proposalId: Id }
  | { kind: "nextStage"; projectId: Id }
  | { kind: "milestones"; projectId: Id }
  | { kind: "deliverable"; projectId: Id }
  | { kind: "version"; deliverableId: Id }
  | { kind: "markApproved"; deliverableId: Id }
  | { kind: "recordPayment"; invoiceId: Id; prefill?: { amount?: string; on?: Day } }
  | { kind: "voidPayment"; paymentId: Id }
  | { kind: "voidInvoice"; invoiceId: Id }
  | { kind: "extend"; proposalId: Id }
  | { kind: "withdraw"; proposalId: Id }
  | { kind: "revision"; proposalId: Id }
  | { kind: "stopShare"; projectId: Id };

/** The sheets the clients' side opens. */
export type ClientSheet = { kind: "terms"; versionId: Id } | { kind: "receipt"; paymentId: Id };

export type Sheet = DeskSheet | ClientSheet;
export type SheetKind = Sheet["kind"];

export interface SheetsState {
  open: Sheet | null;
  /** What has been typed, by field. */
  draft: Record<string, unknown>;
  /** An action that stopped half-way, to finish. */
  unfinished: Unfinished<unknown> | null;
  /** A save is on its way (the sheet's button shows it and does not take a second press). */
  busy: boolean;
}

export const useSheets = create<SheetsState>(() => ({ open: null, draft: {}, unfinished: null, busy: false }));

export function openSheet(sheet: Sheet, draft: Record<string, unknown> = {}): void {
  useSheets.setState({ open: sheet, draft, unfinished: null, busy: false });
}

export function closeSheet(): void {
  useSheets.setState({ open: null, draft: {}, unfinished: null, busy: false });
}

/** Merge typed values into the open sheet's draft. */
export function setDraft(patch: Record<string, unknown>): void {
  useSheets.setState((s) => ({ draft: { ...s.draft, ...patch } }));
}

/** The open sheet, when it is of `kind` (for a sheet component reading its own payload). */
export function sheetOf<K extends SheetKind>(kind: K): Extract<Sheet, { kind: K }> | null {
  const open = useSheets.getState().open;
  return open !== null && open.kind === kind ? (open as Extract<Sheet, { kind: K }>) : null;
}

/**
 * Run a save from a sheet: busy while it runs; on success the sheet closes,
 * on a half-done action it keeps what to finish. Answers the outcome for the
 * sheet to word.
 */
export async function saveFromSheet<T>(run: () => Promise<import("./outcome.ts").Outcome<T>>, opts: { close?: boolean } = {}): Promise<import("./outcome.ts").Outcome<T>> {
  if (useSheets.getState().busy) return { ok: false, reason: "busy", code: "BUSY", field: null, details: {}, unfinished: null };
  useSheets.setState({ busy: true });
  const outcome = await run();
  if (outcome.ok) {
    if (opts.close !== false) closeSheet();
    else useSheets.setState({ busy: false, unfinished: null });
  } else {
    useSheets.setState({ busy: false, unfinished: (outcome.unfinished as Unfinished<unknown> | null) ?? null });
  }
  return outcome;
}
