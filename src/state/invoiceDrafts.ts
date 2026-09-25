/**
 * Putting the studio's hours and purchases onto a client's DRAFT invoice.
 *
 * Time ("Move onto an invoice") and purchases passed on at cost ("Pass on")
 * reach an invoice the same way: one line per entry or purchase, on the
 * client's newest draft — the one for the same project first — or on a new
 * draft when the client has none. A stage invoice (drawn from a proposal) is
 * never used: its one line is a share of what the client agreed to.
 *
 * THE LINE IS THE RECORD. A line names the entry or the purchase it carries
 * (`time_entry_id`, `expense_id`), and Adminium keeps each of those unique
 * across every line: the same hours can be on one line only, whichever
 * computer moves them and however often. An entry is invoiced while a line
 * points at it; removing the line from a draft frees it again; once the
 * invoice is sent, its lines are locked and so is what they carry.
 *
 * The action runs under a key made from WHAT it moves (`keyFor`), not a random
 * one: pressing twice, or in two tabs, finds the draft and the lines the
 * first press saved, by their keys, and writes nothing twice. A line another
 * action got to first is skipped, not refused: that entry is invoiced, which
 * is what was asked.
 */
import type { RowValues } from "../data/ports.ts";
import { asSinkError, keyFor, newRun, type Step, type StepContext } from "../data/sink.ts";
import type { Id, Invoice, InvoiceLine } from "../data/types.ts";
import { deskWrites, drop, loadWhere, refreshRows, rowsOf, upsert, useDesk } from "./desk.ts";
import { attempt, attemptSteps, refusalOf, type Outcome } from "./outcome.ts";

/** Which column of a line names what it carries. */
export type Carried = "time_entry_id" | "expense_id";

/** One line to put on a client's draft: what it carries, and its words and figures. */
export interface DraftLine {
  /** The entry or purchase the line carries. */
  id: Id;
  clientId: Id;
  projectId: Id | null;
  description: string;
  /** Decimal text: hours for time, 1 for a purchase. */
  qty: string;
  /** Decimal text: the hourly rate, or the purchase's cost. */
  rate: string;
}

/** What an action put on invoices: the drafts, read back with their totals, and what was already elsewhere. */
export interface OntoDrafts {
  invoices: Invoice[];
  /** The lines this action saved. */
  lines: InvoiceLine[];
  /** Entries or purchases another line already carried: left as they were. */
  skipped: Id[];
}

const drafts = (clientId: Id): Invoice[] =>
  rowsOf(useDesk.getState(), "invoices")
    .filter((i) => i.client_id === clientId && i.status === "draft" && i.from_quote_id === null)
    .sort((a, b) => b.id - a.id);

/** The draft a client's lines go on: the newest for this project, else their newest, else none. */
export function draftFor(clientId: Id, projectId: Id | null): Invoice | null {
  const all = drafts(clientId);
  return all.find((i) => projectId !== null && i.project_id === projectId) ?? all[0] ?? null;
}

/** The lines the desk holds that carry one of these entries or purchases. */
export function linesCarrying(column: Carried, ids: readonly Id[]): InvoiceLine[] {
  const wanted = new Set(ids);
  return rowsOf(useDesk.getState(), "invoice_lines").filter((l) => {
    const carried = l[column];
    return carried !== null && wanted.has(carried);
  });
}

/** Read what the action decides on: the lines already carrying these, and the clients' drafts and their lines. */
export async function readForDrafts(column: Carried, ids: readonly Id[], clientIds: readonly Id[]): Promise<void> {
  if (ids.length > 0) await loadWhere("invoice_lines", { column, op: "in", value: [...ids] }, undefined, ids.length + 10);
  if (clientIds.length === 0) return;
  const open = await loadWhere(
    "invoices",
    { and: [{ column: "client_id", op: "in", value: [...clientIds] }, { column: "status", op: "eq", value: "draft" }] },
    "id.desc",
    200,
  );
  const draftIds = open.map((i) => i.id);
  if (draftIds.length > 0) await loadWhere("invoice_lines", { column: "document_id", op: "in", value: draftIds }, "position.asc", 2000);
}

/** The next free position on a draft the desk holds. */
const nextPosition = (invoiceId: Id): number =>
  rowsOf(useDesk.getState(), "invoice_lines")
    .filter((l) => l.document_id === invoiceId)
    .reduce((max, l) => Math.max(max, l.position + 1), 0);

async function insertLine(values: RowValues): Promise<InvoiceLine> {
  const row = await deskWrites().insert("invoice_lines", values);
  upsert("invoice_lines", row);
  return row;
}

/**
 * Put these lines on their clients' drafts, under a key made from `kind` and
 * the ids. `newTitle` names a draft this has to make for a client.
 */
export async function ontoDrafts(kind: string, column: Carried, lines: readonly DraftLine[], newTitle: (clientId: Id, projectId: Id | null) => string | null): Promise<Outcome<OntoDrafts>> {
  const ids = [...new Set(lines.map((l) => l.id))].sort((a, b) => a - b);
  const clientIds = [...new Set(lines.map((l) => l.clientId))];
  try {
    await readForDrafts(column, ids, clientIds);
  } catch (error) {
    return refusalOf(error);
  }
  // Already on a line (this desk's own earlier press included): nothing to do for those.
  const carried = new Set(linesCarrying(column, ids).map((l) => l[column] as Id));
  const todo = lines.filter((l) => !carried.has(l.id));
  const skipped = lines.filter((l) => carried.has(l.id)).map((l) => l.id);
  if (todo.length === 0) return { ok: true, value: { invoices: [], lines: [], skipped } };

  const run = newRun(keyFor(kind, ...ids.map(String)));
  const byClient = new Map<Id, DraftLine[]>();
  for (const line of todo) byClient.set(line.clientId, [...(byClient.get(line.clientId) ?? []), line]);

  const steps = (): Step[] => {
    const out: Step[] = [];
    for (const [clientId, group] of byClient) {
      const projects = [...new Set(group.map((l) => l.projectId))];
      const projectId = projects.length === 1 ? (projects[0] ?? null) : null;
      const existing = draftFor(clientId, projectId);
      const draftStep = `draft:${String(clientId)}`;
      out.push(
        existing !== null
          ? { name: draftStep, run: async () => existing }
          : {
              name: draftStep,
              run: async (ctx: StepContext) => {
                const row = await deskWrites().insert("invoices", { client_id: clientId, project_id: projectId, title: newTitle(clientId, projectId), client_key: ctx.key });
                upsert("invoices", row);
                return row;
              },
            },
      );
      group.forEach((line) => {
        out.push({
          name: `line:${String(line.id)}`,
          run: async (ctx: StepContext) => {
            const invoice = ctx.result<Invoice>(draftStep);
            const values: RowValues = {
              document_id: invoice.id,
              position: nextPosition(invoice.id),
              description: line.description,
              qty: line.qty,
              rate: line.rate,
              discount_kind: "amount",
              [column]: line.id,
              client_key: ctx.key,
            };
            try {
              return await insertLine(values);
            } catch (error) {
              // Another action put this one on a line first: it is invoiced, which is what was asked.
              const refused = asSinkError(error);
              if (refused.code !== "UNIQUE_VIOLATION") throw refused;
              const elsewhere = await loadWhere("invoice_lines", { column, op: "eq", value: line.id }, undefined, 1).catch(() => []);
              if (elsewhere.length === 0) throw refused;
              return { skipped: line.id };
            }
          },
        });
      });
    }
    return out;
  };

  return attemptSteps(run, steps, async (done) => {
    const saved: InvoiceLine[] = [];
    const also: Id[] = [...skipped];
    for (const [name, value] of Object.entries(done)) {
      if (!name.startsWith("line:")) continue;
      if (typeof value === "object" && value !== null && "skipped" in value) also.push((value as { skipped: Id }).skipped);
      else saved.push(value as InvoiceLine);
    }
    const invoiceIds = [...new Set(Object.entries(done).filter(([name]) => name.startsWith("draft:")).map(([, v]) => (v as Invoice).id))];
    // The drafts' totals are Adminium's: read them back.
    const invoices = await refreshRows("invoices", invoiceIds);
    return { invoices, lines: saved, skipped: also.sort((a, b) => a - b) };
  });
}

/**
 * Take a line off a draft: what it carried is free again. A sent invoice's
 * lines are locked, and Adminium refuses (`RECORD_LOCKED`).
 */
export function takeOffDraft(lineId: Id): Promise<Outcome<void>> {
  return attempt(async () => {
    const line = useDesk.getState().rows.invoice_lines[lineId];
    await deskWrites().remove("invoice_lines", lineId);
    drop("invoice_lines", lineId);
    if (line !== undefined) await refreshRows("invoices", [line.document_id]);
  });
}
