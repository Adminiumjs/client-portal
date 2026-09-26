/**
 * The back office beside the time: purchases, the people the studio buys
 * from, what it costs to open the door each month, the studio's own dates,
 * and how long each milestone was expected to take. Every action is an
 * Adminium write; the screens draw and call.
 *
 *   purchases        `expenses`: its `EX-` number is Adminium's, without gaps;
 *                    its client is the project's whenever a project is named
 *                    (Adminium copies it). A receipt is a private file, sent
 *                    before the row that names it. "Pass on" puts one line per
 *                    purchase, at cost, on the client's draft
 *                    (`invoiceDrafts.ts`): the line is the record that it went
 *   suppliers        `suppliers`, numbered `SUP-` by Adminium
 *   running costs    `running_costs`, a studio manager's to change
 *   studio dates     `events`: a call, a press check, or one of us away — an
 *                    away day names who (the desk asks; Adminium cannot yet)
 *   estimated days   `milestones.estimated_days`, which Capacity spreads and
 *                    the scoping worksheet learns from
 */
import { newRun } from "../data/sink.ts";
import type { Day, Expense, Id, Milestone, RunningCost, StudioEvent, StudioEventKind, Supplier, SupplierKind } from "../data/types.ts";
import { today } from "../lib/clock.ts";
import { deskWrites, ensureRows, loadWhere, refreshRows, useDesk } from "./desk.ts";
import { asInvoiced, linesCarrying, ontoDrafts, onVoid, type OntoDrafts } from "./invoiceDrafts.ts";
import { attempt, attemptSteps, refusalOf, type Outcome } from "./outcome.ts";
import { change, createOne, decimalText, insertRow, invalid, removal, textOrNull, updateRow } from "./officeWrites.ts";

export type { Outcome } from "./outcome.ts";

// ── reading ─────────────────────────────────────────────────────────────────

/** Purchases from `since` on (all of them with `null`, a bounded read), the lines passing them on, and their suppliers. */
export async function loadPurchases(since: Day | null = null): Promise<Expense[]> {
  const rows = await loadWhere("expenses", since === null ? { column: "id", op: "not_null" } : { column: "date", op: "gte", value: since }, "date.desc", 2000);
  const ids = rows.map((r) => r.id);
  await Promise.all([
    ids.length === 0 ? Promise.resolve() : loadWhere("invoice_lines", { column: "expense_id", op: "in", value: ids }, undefined, ids.length + 10),
    ensureRows("suppliers", rows.map((r) => r.supplier_id)),
    ensureRows("projects", rows.map((r) => r.project_id)),
    ensureRows("clients", rows.map((r) => r.client_id)),
  ]);
  // The invoices the lines are on: one that was voided passed nothing on.
  await ensureRows("invoices", linesCarrying("expense_id", ids).map((l) => l.document_id));
  return rows;
}

/** The address book, whole (a studio has dozens, not thousands). */
export const loadSuppliers = (): Promise<Supplier[]> => loadWhere("suppliers", { column: "id", op: "not_null" }, "name.asc", 1000);

/** What it costs to open the door, in the studio's order. */
export const loadRunningCosts = (): Promise<RunningCost[]> => loadWhere("running_costs", { column: "id", op: "not_null" }, "position.asc", 200);

/** The studio's dates that touch `from`…`to` (an away stretch that started before `from` included). */
export function loadStudioDates(from: Day, to: Day): Promise<StudioEvent[]> {
  return loadWhere(
    "events",
    {
      and: [
        { column: "date", op: "lte", value: to },
        { or: [{ column: "date", op: "gte", value: from }, { column: "to_date", op: "gte", value: from }] },
      ],
    },
    "date.asc",
    1000,
  );
}

/**
 * How a purchase stands: passed on (a line carries it), on a voided invoice
 * (a line carries it, but that invoice was voided: nothing was charged), still
 * to pass on, or the studio's own to carry.
 */
export type PurchaseState = "passed-on" | "voided" | "to-pass-on" | "ours";

export function purchaseState(expense: Expense): PurchaseState {
  const line = linesCarrying("expense_id", [expense.id])[0];
  if (line !== undefined) return onVoid(line) ? "voided" : "passed-on";
  return expense.rebill ? "to-pass-on" : "ours";
}

// ── purchases ───────────────────────────────────────────────────────────────

export interface ReceiptFile {
  file: Blob;
  filename: string;
}

export interface PurchaseInput {
  what: string;
  /** Decimal text above zero, in the studio's currency. */
  amount: string;
  /** Today when left out; never a day still to come (Adminium refuses one). */
  date?: Day;
  /** The project it was bought for: its client comes with it. */
  project_id?: Id | null;
  /** A client with no project ("a type licence for Slow Signal"); ignored when a project is named. */
  client_id?: Id | null;
  supplier_id?: Id | null;
  /** Pass it on to the client at cost. Only with a client. */
  rebill: boolean;
  receipt?: ReceiptFile | null;
}

function purchaseProblem(input: { what?: string; amount?: string }): Outcome<never> | null {
  if (input.what !== undefined && input.what.trim() === "") return invalid("WHAT_REQUIRED", "what");
  if (input.amount !== undefined) {
    const amount = decimalText(input.amount);
    if (amount === null || !/^\d+(\.\d{1,4})?$/.test(amount) || Number(amount) <= 0) return invalid("AMOUNT_ABOVE_ZERO", "amount");
  }
  return null;
}

/**
 * Add a purchase: its receipt first (a private file), then the row that names
 * it — the row is what makes the purchase visible, so a receipt that did not
 * arrive leaves nothing half-shown. Its number is Adminium's.
 */
export function addPurchase(input: PurchaseInput): Promise<Outcome<Expense>> {
  const problem = purchaseProblem(input);
  if (problem !== null) return Promise.resolve(problem);
  const project = input.project_id ?? null;
  const client = project === null ? (input.client_id ?? null) : null;
  if (input.rebill && project === null && client === null) return Promise.resolve(invalid("CLIENT_REQUIRED", "client_id"));
  const receipt = input.receipt ?? null;
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      ...(receipt === null ? [] : [{ name: "receipt", run: () => deskWrites().upload("expenses", "receipt", receipt.file, receipt.filename) }]),
      {
        name: "expense",
        run: (ctx) =>
          insertRow("expenses", {
            date: input.date ?? today(),
            what: input.what.trim(),
            amount: decimalText(input.amount),
            project_id: project,
            ...(project === null ? { client_id: client } : {}),
            supplier_id: input.supplier_id ?? null,
            rebill: input.rebill,
            receipt: ctx.has("receipt") ? ctx.result<string>("receipt") : null,
            client_key: ctx.key,
          }),
      },
    ],
    (done) => done["expense"] as Expense,
  );
}

export interface PurchaseChange {
  what?: string;
  amount?: string;
  date?: Day;
  project_id?: Id | null;
  client_id?: Id | null;
  supplier_id?: Id | null;
  rebill?: boolean;
}

/**
 * Change a purchase. One passed on keeps its cost, project, client and "pass
 * on" while an invoice that is not void carries it (the line says what went):
 * Adminium refuses those, whichever door the change comes through. Take the
 * line off the draft first.
 */
export async function editPurchase(expenseId: Id, patch: PurchaseChange): Promise<Outcome<Expense>> {
  const problem = purchaseProblem(patch);
  if (problem !== null) return problem;
  const values = {
    ...(patch.what === undefined ? {} : { what: patch.what.trim() }),
    ...(patch.amount === undefined ? {} : { amount: decimalText(patch.amount) }),
    ...(patch.date === undefined ? {} : { date: patch.date }),
    ...(patch.project_id === undefined ? {} : { project_id: patch.project_id }),
    ...(patch.client_id === undefined ? {} : { client_id: patch.client_id }),
    ...(patch.supplier_id === undefined ? {} : { supplier_id: patch.supplier_id }),
    ...(patch.rebill === undefined ? {} : { rebill: patch.rebill }),
  };
  return asInvoiced(await change("expenses", expenseId, values));
}

/** Put a receipt on a purchase: the file, then the row names it. */
export function attachReceipt(expenseId: Id, receipt: ReceiptFile): Promise<Outcome<Expense>> {
  return attempt(async () => {
    const ref = await deskWrites().upload("expenses", "receipt", receipt.file, receipt.filename);
    return updateRow("expenses", expenseId, { receipt: ref });
  });
}

/** Remove a purchase (a studio manager's). One passed on is refused by Adminium: a line points at it. */
export const removePurchase = (expenseId: Id): Promise<Outcome<void>> => removal("expenses", expenseId);

/**
 * Pass on: one line per purchase — its words, quantity 1, its cost — on each
 * client's draft (made when they have none). Only purchases marked to pass on,
 * with a client, and not already on a line; pressing twice adds nothing.
 */
export async function passOn(expenseIds: readonly Id[], input: { newTitle: (clientId: Id, projectId: Id | null) => string | null }): Promise<Outcome<OntoDrafts>> {
  try {
    // Read afresh: a cost a voided invoice let go of may have changed since this page drew it, and the line bills what is stored.
    await refreshRows("expenses", expenseIds);
  } catch (error) {
    return refusalOf(error);
  }
  const held = useDesk.getState().rows.expenses;
  const expenses = expenseIds.map((id) => held[id]).filter((e): e is Expense => e !== undefined && e.rebill && e.client_id !== null);
  if (expenses.length === 0) return { ok: true, value: { invoices: [], lines: [], skipped: [] } };
  return ontoDrafts(
    "expense_id",
    expenses.map((e) => ({ id: e.id, clientId: e.client_id as Id, projectId: e.project_id, description: e.what, qty: "1", rate: e.amount })),
    input.newTitle,
  );
}

// ── suppliers ───────────────────────────────────────────────────────────────

export interface SupplierInput {
  name: string;
  kind?: SupplierKind;
  contact?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  lead_time?: string | null;
  typical_cost?: string | null;
  note?: string | null;
  would_use_again?: boolean;
}

const supplierValues = (input: Partial<SupplierInput>) => ({
  ...(input.name === undefined ? {} : { name: input.name.trim() }),
  ...(input.kind === undefined ? {} : { kind: input.kind }),
  ...(input.contact === undefined ? {} : { contact: textOrNull(input.contact) }),
  ...(input.email === undefined ? {} : { email: textOrNull(input.email) }),
  ...(input.phone === undefined ? {} : { phone: textOrNull(input.phone) }),
  ...(input.address === undefined ? {} : { address: textOrNull(input.address) }),
  ...(input.lead_time === undefined ? {} : { lead_time: textOrNull(input.lead_time) }),
  ...(input.typical_cost === undefined ? {} : { typical_cost: textOrNull(input.typical_cost) }),
  ...(input.note === undefined ? {} : { note: textOrNull(input.note) }),
  ...(input.would_use_again === undefined ? {} : { would_use_again: input.would_use_again }),
});

/** Add a supplier (its `SUP-` number is Adminium's). */
export function addSupplier(input: SupplierInput): Promise<Outcome<Supplier>> {
  if (input.name.trim() === "") return Promise.resolve(invalid("NAME_REQUIRED", "name"));
  return createOne("suppliers", supplierValues(input));
}

export function editSupplier(supplierId: Id, patch: Partial<SupplierInput>): Promise<Outcome<Supplier>> {
  if (patch.name !== undefined && patch.name.trim() === "") return Promise.resolve(invalid("NAME_REQUIRED", "name"));
  return change("suppliers", supplierId, supplierValues(patch));
}

/** Remove a supplier (a studio manager's). One a purchase names is refused by Adminium. */
export const removeSupplier = (supplierId: Id): Promise<Outcome<void>> => removal("suppliers", supplierId);

// ── running costs ───────────────────────────────────────────────────────────

export interface RunningCostInput {
  label: string;
  /** Decimal text, zero or more, each month. */
  monthly_amount: string;
  position?: number;
}

function costProblem(input: Partial<RunningCostInput>): Outcome<never> | null {
  if (input.label !== undefined && input.label.trim() === "") return invalid("LABEL_REQUIRED", "label");
  if (input.monthly_amount !== undefined) {
    const amount = decimalText(input.monthly_amount);
    if (amount === null || !/^\d+(\.\d{1,4})?$/.test(amount)) return invalid("AMOUNT_NOT_A_NUMBER", "monthly_amount");
  }
  return null;
}

/** Add a running cost (a studio manager's, like the rest of the studio's set-up). */
export function addRunningCost(input: RunningCostInput): Promise<Outcome<RunningCost>> {
  const problem = costProblem(input);
  if (problem !== null) return Promise.resolve(problem);
  return createOne("running_costs", { label: input.label.trim(), monthly_amount: decimalText(input.monthly_amount), position: input.position ?? 0 });
}

export function editRunningCost(costId: Id, patch: Partial<RunningCostInput>): Promise<Outcome<RunningCost>> {
  const problem = costProblem(patch);
  if (problem !== null) return Promise.resolve(problem);
  return change("running_costs", costId, {
    ...(patch.label === undefined ? {} : { label: patch.label.trim() }),
    ...(patch.monthly_amount === undefined ? {} : { monthly_amount: decimalText(patch.monthly_amount) }),
    ...(patch.position === undefined ? {} : { position: patch.position }),
  });
}

export const removeRunningCost = (costId: Id): Promise<Outcome<void>> => removal("running_costs", costId);

// ── the studio's dates ──────────────────────────────────────────────────────

export interface StudioDateInput {
  date: Day;
  /** The last day of a stretch (an away week); the same day when left out. */
  to_date?: Day | null;
  title: string;
  kind: StudioEventKind;
  /** Who is away: asked for an away day. */
  person_id?: Id | null;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function dateProblem(input: Partial<StudioDateInput>, kind: StudioEventKind | undefined, person: Id | null | undefined): Outcome<never> | null {
  if (input.title !== undefined && input.title.trim() === "") return invalid("TITLE_REQUIRED", "title");
  if (input.date !== undefined && !DAY.test(input.date)) return invalid("DATE_NOT_A_DAY", "date");
  if (input.to_date !== undefined && input.to_date !== null && !DAY.test(input.to_date)) return invalid("DATE_NOT_A_DAY", "to_date");
  if (input.date !== undefined && input.to_date !== undefined && input.to_date !== null && input.to_date < input.date) return invalid("UNTIL_BEFORE_DATE", "to_date");
  // Adminium cannot ask for `person_id` only when the date is an away day, so the desk does.
  if (kind === "away" && (person === null || person === undefined)) return invalid("PERSON_REQUIRED", "person_id");
  return null;
}

/** Add a studio date: a call, a press check, or one of us away (who, and until when). */
export function addStudioDate(input: StudioDateInput): Promise<Outcome<StudioEvent>> {
  const problem = dateProblem(input, input.kind, input.person_id);
  if (problem !== null) return Promise.resolve(problem);
  return createOne("events", {
    date: input.date,
    to_date: input.to_date ?? null,
    title: input.title.trim(),
    kind: input.kind,
    person_id: input.person_id ?? null,
  });
}

export function editStudioDate(eventId: Id, patch: Partial<StudioDateInput>): Promise<Outcome<StudioEvent>> {
  const held = useDesk.getState().rows.events[eventId];
  const kind = patch.kind ?? held?.kind;
  const person = patch.person_id !== undefined ? patch.person_id : held?.person_id;
  const merged = { date: patch.date ?? held?.date, to_date: patch.to_date !== undefined ? patch.to_date : held?.to_date, ...(patch.title === undefined ? {} : { title: patch.title }) };
  const problem = dateProblem(merged, kind, person);
  if (problem !== null) return Promise.resolve(problem);
  return change("events", eventId, {
    ...(patch.date === undefined ? {} : { date: patch.date }),
    ...(patch.to_date === undefined ? {} : { to_date: patch.to_date }),
    ...(patch.title === undefined ? {} : { title: patch.title.trim() }),
    ...(patch.kind === undefined ? {} : { kind: patch.kind }),
    ...(patch.person_id === undefined ? {} : { person_id: patch.person_id }),
  });
}

export const removeStudioDate = (eventId: Id): Promise<Outcome<void>> => removal("events", eventId);

// ── milestones' estimated days ──────────────────────────────────────────────

/** How many studio days a milestone should take (decimal text, one place; empty clears it). */
export function setEstimatedDays(milestoneId: Id, days: string | null): Promise<Outcome<Milestone>> {
  const text = decimalText(days);
  if (text !== null && (!/^\d+(\.\d)?$/.test(text) || Number(text) <= 0)) return Promise.resolve(invalid("DAYS_ABOVE_ZERO", "estimated_days"));
  return change("milestones", milestoneId, { estimated_days: text });
}
