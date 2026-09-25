/**
 * What a live update changes in the desk.
 *
 * Every change arrives here — including this desk's OWN saves, echoed back by
 * the stream — so each is applied by key and is harmless twice.
 *
 * A frame names a row; it does not carry a usable copy of it, so the row is
 * read again by its key. Frames that arrive together are read together. What
 * moved with a row on the server, with no frame of its own, is read with it:
 *
 *   payments, invoice_lines    their invoice (paid, balance, totals)
 *   proposal_lines             their proposal (totals)
 *   deliverable_versions/notes their deliverable (its status moved back to pending)
 *
 * A row the desk does not hold is read only when it is open work the desk
 * would have read at boot (a new enquiry, a held message, a new proposal or
 * invoice or project) — never a stranger's history. A key the read does not
 * return is a row that is gone, or no longer readable by this person.
 *
 * After a reconnect the whole desk is read again (`resync`), with the document
 * that was open, because whatever was announced while the connection was down
 * is gone.
 */
import type { LiveFrame } from "../data/live.ts";
import type { Id, TableRef } from "../data/types.ts";
import { applySnapshot, deskReads, drop, loadClient, loadDeliverable, loadInvoice, loadProject, loadProposal, upsertAll, useDesk } from "./desk.ts";
import { useUi } from "./ui.ts";
import { studioZone, today } from "../lib/clock.ts";

/** How long frames gather before one read answers them all. */
const GATHER_MS = 120;

/** Tables whose new rows are open work: read even when the desk held none of them. */
const OPEN_WORK: readonly TableRef[] = ["enquiries", "messages", "proposals", "invoices", "projects", "milestones", "deliverables", "clients", "time_entries", "events", "expenses", "suppliers", "running_costs"];

/** What else a row's change moves, with no frame of its own. */
const PARENT: Partial<Record<TableRef, { ref: TableRef; column: string }>> = {
  payments: { ref: "invoices", column: "document_id" },
  invoice_lines: { ref: "invoices", column: "document_id" },
  proposal_lines: { ref: "proposals", column: "document_id" },
  deliverable_versions: { ref: "deliverables", column: "deliverable_id" },
  deliverable_notes: { ref: "deliverables", column: "deliverable_id" },
};

const pending = new Map<TableRef, Set<Id>>();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> = Promise.resolve();

function queue(ref: TableRef, id: Id): void {
  const ids = pending.get(ref) ?? new Set<Id>();
  ids.add(id);
  pending.set(ref, ids);
  if (timer === null) timer = setTimeout(() => void flush(), GATHER_MS);
}

/** Read every queued row again and fold it in. */
export function flush(): Promise<void> {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  const batch = [...pending.entries()];
  pending.clear();
  // One flush at a time, so an older answer never lands over a newer one.
  flushing = flushing.then(() => readAgain(batch));
  return flushing;
}

async function readAgain(batch: [TableRef, Set<Id>][]): Promise<void> {
  const parents = new Map<TableRef, Set<Id>>();
  for (const [ref, ids] of batch) {
    const rows = await readRows(ref, ids);
    const parent = PARENT[ref];
    if (rows === null || parent === undefined) continue;
    for (const row of rows as unknown as Record<string, unknown>[]) {
      const id = row[parent.column];
      if (typeof id !== "number") continue;
      const set = parents.get(parent.ref) ?? new Set<Id>();
      set.add(id);
      parents.set(parent.ref, set);
    }
  }
  for (const [ref, ids] of parents) await readRows(ref, ids);
}

/** One table's rows by key, folded in; null when the read failed (the next reconnect catches up). */
async function readRows(ref: TableRef, ids: Set<Id>): Promise<{ id: Id }[] | null> {
  let rows: { id: Id }[];
  try {
    rows = (await deskReads().rows(ref, [...ids])) as { id: Id }[];
  } catch (error) {
    console.warn(`[clients] a live update of ${ref} could not be read:`, error);
    return null;
  }
  const found = new Set(rows.map((row) => row.id));
  upsertAll(ref, rows as never);
  for (const id of ids) if (!found.has(id)) drop(ref, id);
  return rows;
}

/** One frame from the stream (or the demo's world). */
export function applyFrame(frame: LiveFrame): void {
  if (frame.id === null) return;
  const held = useDesk.getState().rows[frame.table][frame.id];
  if (frame.kind === "record.delete") {
    const parent = PARENT[frame.table];
    const parentId = parent === undefined || held === undefined ? undefined : (held as unknown as Record<string, unknown>)[parent.column];
    drop(frame.table, frame.id);
    if (parent !== undefined && typeof parentId === "number") queue(parent.ref, parentId);
    return;
  }
  // A row this desk never read is only worth reading when it is open work.
  if (held === undefined && !OPEN_WORK.includes(frame.table) && PARENT[frame.table] === undefined) return;
  queue(frame.table, frame.id);
}

/** Read the whole desk again, and the document that was open. */
export async function resync(): Promise<void> {
  try {
    applySnapshot(await deskReads().snapshot(today(), studioZone()));
    await reloadOpen();
  } catch (error) {
    console.warn("[clients] the desk could not be read again after reconnecting:", error);
  }
}

/** Read again whatever document the screen on show is about. */
export async function reloadOpen(): Promise<void> {
  const { view, selected } = useUi.getState();
  if ((view === "proposal" || view === "composer") && selected.proposal !== null) await loadProposal(selected.proposal);
  if ((view === "invoice" || view === "print") && selected.invoice !== null) await loadInvoice(selected.invoice);
  if ((view === "project" || view === "handover") && selected.project !== null) await loadProject(selected.project);
  if (view === "review" && selected.deliverable !== null) await loadDeliverable(selected.deliverable);
  if (view === "client" && selected.client !== null) await loadClient(selected.client);
}
