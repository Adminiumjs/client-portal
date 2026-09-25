/**
 * What the studio's desk holds: who is signed in and what they may do, and
 * every row the desk has read, by table and key.
 *
 * It is filled from one bounded read at boot (`DeskReads.snapshot`: the
 * studio's set-up and the open work), then grows as screens open documents
 * (`loadProposal`, `loadInvoice` …, each a handful of bounded reads) and
 * lists (`loadPage`). Every save the desk makes answers with the saved row,
 * folded in here; live updates from other computers and from clients read
 * rows again by key (`live.ts`); a reconnect reads the desk again.
 *
 * Rows are kept by key, so a row that arrives twice — this desk's own save,
 * then the live stream's echo — is one row. Screens read through the hooks
 * (`useRows`, `useRow`, `useSettings` …) and change nothing directly: every
 * change is an action (`actions.ts`).
 */
import { create } from "zustand";

import type { AddOnSettings, DeskReads, DeskSnapshot, DeskWrites, PageQuery } from "../data/ports.ts";
import type { ListCondition } from "../data/snapshotPort.ts";
import { TABLE_REFS, type Day, type Id, type TableRef, type Tables } from "../data/types.ts";
import type { StaffAccess, TableAction } from "../staffConnection.ts";
import { daysBetween } from "../data/venueTime.ts";
import { now, studioZone, today } from "../lib/clock.ts";

export type ById<T> = Record<Id, T>;
export type Held = { [R in TableRef]: ById<Tables[R]> };

/** The signed-in person, as the desk shows and obeys them. */
export interface Me {
  name: string;
  email: string | null;
  /** The role's own name ("Studio manager"), for the person card. */
  roleName: string | null;
  /** A studio manager: settings, terms, voids, discarding a draft, reopening a project. */
  manager: boolean;
  /** What they may do with each table; null when the server did not say (then every button shows). */
  access: StaffAccess | null;
}

export type LoadState = "loading" | "ready" | "failed";

export interface DeskState {
  load: LoadState;
  /** Why the last load failed, in the server's words. */
  loadError: string | null;
  me: Me;
  /** The studio's day the boot read set is of. */
  today: Day;
  /** Every row the desk has read, by table and key. */
  rows: Held;
  /** The add-ons' settings the desk has read (the invoices add-on's defaults, letterhead, instructions …). */
  addOns: Record<string, AddOnSettings>;
}

const emptyHeld = (): Held => Object.fromEntries(TABLE_REFS.map((ref) => [ref, {}])) as Held;
const EMPTY_ME: Me = { name: "", email: null, roleName: null, manager: false, access: null };

export const useDesk = create<DeskState>(() => ({ load: "loading", loadError: null, me: EMPTY_ME, today: "", rows: emptyHeld(), addOns: {} }));

// ── the doors, set once at boot ─────────────────────────────────────────────

let reads: DeskReads | null = null;
let writes: DeskWrites | null = null;

export function setDeskReads(next: DeskReads): void {
  reads = next;
}
export function deskReads(): DeskReads {
  if (reads === null) throw new Error("the desk's reads are not set: boot sets them before any screen mounts");
  return reads;
}
export function setDeskWrites(next: DeskWrites): void {
  writes = next;
}
export function deskWrites(): DeskWrites {
  if (writes === null) throw new Error("no sink: boot sets one before the desk can save");
  return writes;
}

/** Forget everything (a test, the demo's reset). */
export function resetDesk(): void {
  useDesk.setState({ load: "loading", loadError: null, today: "", rows: emptyHeld(), addOns: {} });
}

// ── folding rows in ─────────────────────────────────────────────────────────

/** Rows of one table folded in, newest wins. */
export function upsertAll<R extends TableRef>(ref: R, rows: readonly Tables[R][]): void {
  if (rows.length === 0) return;
  useDesk.setState((s) => ({ rows: { ...s.rows, [ref]: { ...s.rows[ref], ...Object.fromEntries(rows.map((row) => [row.id, row])) } } }));
}

/** One saved row folded in, over what the desk held of it (a patch answers the whole row). */
export function upsert<R extends TableRef>(ref: R, row: Tables[R]): void {
  const held = useDesk.getState().rows[ref][row.id];
  upsertAll(ref, [held === undefined ? row : { ...held, ...row }]);
}

/** A row gone. */
export function drop(ref: TableRef, id: Id): void {
  useDesk.setState((s) => {
    if (s.rows[ref][id] === undefined) return {};
    const next = { ...s.rows[ref] };
    delete next[id];
    return { rows: { ...s.rows, [ref]: next } };
  });
}

/** Replace everything the desk holds with a fresh boot read set (boot, and after a reconnect). */
export function applySnapshot(snap: DeskSnapshot): void {
  const rows = emptyHeld();
  const put = <R extends TableRef>(ref: R, list: readonly Tables[R][]) => {
    rows[ref] = Object.fromEntries(list.map((row) => [row.id, row])) as Held[R];
  };
  if (snap.settings !== null) put("settings", [snap.settings]);
  put("people", snap.people);
  put("rates", snap.rates);
  put("terms_versions", snap.termsVersions);
  put("brief_questions", snap.briefQuestions);
  put("proposals", snap.proposals);
  put("invoices", snap.invoices);
  put("projects", snap.projects);
  put("milestones", snap.milestones);
  put("deliverables", snap.deliverables);
  put("enquiries", snap.enquiries);
  put("messages", snap.messages);
  put("clients", snap.clients);
  useDesk.setState({ load: "ready", loadError: null, today: snap.today, rows });
}

/** Read the desk's boot read set for today. */
export async function loadDesk(): Promise<void> {
  useDesk.setState({ load: "loading" });
  try {
    applySnapshot(await deskReads().snapshot(today(), studioZone()));
  } catch (error) {
    useDesk.setState({ load: "failed", loadError: error instanceof Error ? error.message : String(error) });
  }
}

// ── reading more, when a screen opens it ────────────────────────────────────

/** Rows by key the desk does not hold yet. */
export async function ensureRows<R extends TableRef>(ref: R, ids: readonly (Id | null | undefined)[]): Promise<void> {
  const held = useDesk.getState().rows[ref];
  const missing = [...new Set(ids.filter((id): id is Id => typeof id === "number" && held[id] === undefined))];
  if (missing.length === 0) return;
  upsertAll(ref, await deskReads().rows(ref, missing));
}

/** Rows by key read again (they moved on the server: a total, a balance). */
export async function refreshRows<R extends TableRef>(ref: R, ids: readonly Id[]): Promise<Tables[R][]> {
  if (ids.length === 0) return [];
  const rows = await deskReads().rows(ref, ids);
  const found = new Set(rows.map((r) => r.id));
  upsertAll(ref, rows);
  for (const id of ids) if (!found.has(id)) drop(ref, id);
  return rows;
}

/** Every row of `ref` a condition matches (bounded), folded in. */
export async function loadWhere<R extends TableRef>(ref: R, where: ListCondition, order?: string, limit?: number): Promise<Tables[R][]> {
  const rows = await deskReads().where(ref, where, order, limit);
  upsertAll(ref, rows);
  return rows;
}

/**
 * One page of a list (a filter the open work does not cover: paid invoices,
 * last year's proposals). The rows are folded in; the page's keys, in the
 * server's order, and the count come back for the screen to keep.
 */
export async function loadPage<R extends TableRef>(ref: R, query: PageQuery): Promise<{ ids: Id[]; total: number | null }> {
  const page = await deskReads().page(ref, query);
  upsertAll(ref, page.rows);
  await ensureNamedClients(page.rows as readonly { client_id?: Id | null }[]);
  return { ids: page.rows.map((r) => r.id), total: page.total };
}

async function ensureNamedClients(rows: readonly { client_id?: Id | null }[]): Promise<void> {
  await ensureRows("clients", rows.map((r) => r.client_id ?? null));
}

/** One proposal and all it shows: its lines, client, terms, revisions, project and stage invoices. */
export async function loadProposal(id: Id): Promise<void> {
  await refreshRows("proposals", [id]);
  const proposal = useDesk.getState().rows.proposals[id];
  if (proposal === undefined) return;
  await Promise.all([
    loadWhere("proposal_lines", { column: "document_id", op: "eq", value: id }, "position.asc"),
    loadWhere("proposals", { column: "revision_of", op: "eq", value: id }, "id.desc", 20),
    loadWhere("projects", { column: "proposal_id", op: "eq", value: id }, undefined, 1),
    loadWhere("invoices", { column: "from_quote_id", op: "eq", value: id }, "id.asc", 20),
    ensureRows("clients", [proposal.client_id]),
    ensureRows("proposals", [proposal.revision_of]),
  ]);
  if (proposal.terms_version_id !== null) await loadTermsVersion(proposal.terms_version_id);
}

/** One terms version and its clauses. */
export async function loadTermsVersion(id: Id): Promise<void> {
  await Promise.all([ensureRows("terms_versions", [id]), loadWhere("terms_clauses", { column: "version_id", op: "eq", value: id }, "position.asc")]);
}

/** One invoice and all it shows: its lines, payments, client, project and held chase rungs. */
export async function loadInvoice(id: Id): Promise<void> {
  await refreshRows("invoices", [id]);
  const invoice = useDesk.getState().rows.invoices[id];
  if (invoice === undefined) return;
  await Promise.all([
    loadWhere("invoice_lines", { column: "document_id", op: "eq", value: id }, "position.asc"),
    loadWhere("payments", { column: "document_id", op: "eq", value: id }, "paid_on.asc"),
    loadWhere("messages", { column: "invoice_id", op: "eq", value: id }, "due.asc", 50),
    ensureRows("clients", [invoice.client_id]),
    ensureRows("projects", [invoice.project_id]),
    ensureRows("proposals", [invoice.proposal_id, invoice.from_quote_id]),
  ]);
}

/** One project and all it shows: milestones, deliverables and their versions, brief, handover, invoices. */
export async function loadProject(id: Id): Promise<void> {
  await refreshRows("projects", [id]);
  const project = useDesk.getState().rows.projects[id];
  if (project === undefined) return;
  const [, deliverables, briefs] = await Promise.all([
    loadWhere("milestones", { column: "project_id", op: "eq", value: id }, "position.asc"),
    loadWhere("deliverables", { column: "project_id", op: "eq", value: id }, "position.asc"),
    loadWhere("briefs", { column: "project_id", op: "eq", value: id }, undefined, 1),
    loadWhere("project_fonts", { column: "project_id", op: "eq", value: id }, "position.asc"),
    loadWhere("handover_files", { column: "project_id", op: "eq", value: id }, "position.asc"),
    loadWhere("invoices", { column: "project_id", op: "eq", value: id }, "id.asc", 50),
    ensureRows("clients", [project.client_id]),
    ensureRows("proposals", [project.proposal_id]),
  ]);
  const ids = deliverables.map((d) => d.id);
  await Promise.all([
    ids.length === 0 ? Promise.resolve([]) : loadWhere("deliverable_versions", { column: "deliverable_id", op: "in", value: ids }, "v.asc"),
    briefs[0] === undefined ? Promise.resolve([]) : loadWhere("brief_answers", { column: "brief_id", op: "eq", value: briefs[0].id }),
  ]);
}

/** One deliverable's review: its versions and every note on it. */
export async function loadDeliverable(id: Id): Promise<void> {
  await refreshRows("deliverables", [id]);
  const deliverable = useDesk.getState().rows.deliverables[id];
  if (deliverable === undefined) return;
  await Promise.all([
    loadWhere("deliverable_versions", { column: "deliverable_id", op: "eq", value: id }, "v.asc"),
    loadWhere("deliverable_notes", { column: "deliverable_id", op: "eq", value: id }, "at.asc"),
    ensureRows("projects", [deliverable.project_id]),
  ]);
}

/** One client's record: their notes and their documents (the newest 50 of each). */
export async function loadClient(id: Id): Promise<void> {
  await refreshRows("clients", [id]);
  const byClient: ListCondition = { column: "client_id", op: "eq", value: id };
  const [, , invoices] = await Promise.all([
    loadWhere("client_notes", byClient, "at.desc", 100),
    loadWhere("proposals", byClient, "id.desc", 50),
    loadWhere("invoices", byClient, "id.desc", 50),
    loadWhere("projects", byClient, "id.desc", 50),
    loadWhere("enquiries", byClient, "id.desc", 20),
  ]);
  const invoiceIds = invoices.map((i) => i.id);
  if (invoiceIds.length > 0) await loadWhere("payments", { column: "document_id", op: "in", value: invoiceIds }, "paid_on.asc");
}

// ── reading what the desk holds ─────────────────────────────────────────────

/** Every held row of a table, in key order. */
export function rowsOf<R extends TableRef>(state: DeskState, ref: R): Tables[R][] {
  return Object.values(state.rows[ref]) as Tables[R][];
}

/** Every held row of a table, as a hook. */
export function useRows<R extends TableRef>(ref: R): Tables[R][] {
  const table = useDesk((s) => s.rows[ref]);
  return Object.values(table) as Tables[R][];
}

/** One held row, as a hook; undefined until it is read. */
export function useRow<R extends TableRef>(ref: R, id: Id | null | undefined): Tables[R] | undefined {
  return useDesk((s) => (id === null || id === undefined ? undefined : (s.rows[ref][id] as Tables[R] | undefined)));
}

/** The studio's settings row. */
export function useSettings(): Tables["settings"] | null {
  return useDesk((s) => (Object.values(s.rows.settings)[0] as Tables["settings"] | undefined) ?? null);
}

// ── the add-ons' settings ───────────────────────────────────────────────────

/**
 * Read an add-on's settings once (boot), through the sink's `addOnSettings`;
 * nothing is held when the door has no such read or the add-on is not there.
 */
export async function loadAddOnSettings(key: string): Promise<void> {
  const read = writes?.addOnSettings;
  if (typeof read !== "function") return;
  try {
    const settings = await read.call(writes, key);
    if (settings !== null) useDesk.setState((s) => ({ addOns: { ...s.addOns, [key]: settings } }));
  } catch (error) {
    console.warn(`[clients] the ${key} add-on's settings could not be read:`, error);
  }
}

/** An add-on's settings the desk holds (the invoices add-on's letterhead, tax name, terms, ladder …); null when not read. */
export function addOnSettings(key: string, state: DeskState = useDesk.getState()): Record<string, unknown> | null {
  return state.addOns[key]?.values ?? null;
}

/** `addOnSettings`, as a hook. */
export function useAddOnSettings(key: string): Record<string, unknown> | null {
  return useDesk((s) => s.addOns[key]?.values ?? null);
}

/** One text setting of an add-on, or null when unset or empty. */
export function addOnText(settings: Record<string, unknown> | null, name: string): string | null {
  const value = settings?.[name];
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

// ── who may do what ─────────────────────────────────────────────────────────

/**
 * Whether the signed-in person may do this to a table, as the server would
 * judge it. When the server did not say, every button shows and the server
 * refuses what it refuses.
 */
export function can(table: TableRef, action: TableAction): boolean {
  const access = useDesk.getState().me.access;
  if (access === null) return true;
  return (access.tables[table] ?? []).includes(action);
}

/** `can`, as a hook. */
export function useCan(table: TableRef, action: TableAction): boolean {
  return useDesk((s) => (s.me.access === null ? true : (s.me.access.tables[table] ?? []).includes(action)));
}

/** A studio manager (voids, discarding a draft, reopening, settings, terms). */
export const useManager = (): boolean => useDesk((s) => s.me.manager);

/** The person from the staff config: their name, their role's name, whether they manage the studio. */
export function meOf(user: { name: string; email: string } | null, access: StaffAccess | null): Me {
  const roles = access?.roles ?? [];
  const manager = roles.some((r) => r.slug === "studio-manager");
  const studio = roles.find((r) => r.slug === "studio-manager") ?? roles.find((r) => r.slug === "studio") ?? roles[0];
  // No roles said (an administrator, or a server that does not tell): nothing is hidden.
  return { name: user?.name ?? "", email: user?.email ?? null, roleName: studio?.name ?? null, manager: access === null || roles.length === 0 ? true : manager, access };
}

// ── the sidebar's counts ────────────────────────────────────────────────────

export interface NavCounts {
  /** New enquiries. */
  enquiries: number;
  /** Sent proposals the client can still accept (in date). */
  proposals: number;
  /** Sent invoices with a balance, due before today. */
  invoices: number;
  /** Invoices with a chase rung ready to approve (one per invoice). */
  chasing: number;
}

const RUNG = /^invoice-rung-\d$/;

/** Whether a sent invoice is overdue on `day`: a balance left, due before it. */
export function isOverdue(invoice: Tables["invoices"], day: Day): boolean {
  return invoice.status === "sent" && Number(invoice.balance ?? 0) > 0 && invoice.due_on !== null && daysBetween(invoice.due_on, day) > 0;
}

/** Whether a sent proposal can still be accepted on `day`. */
export function isInDate(proposal: Tables["proposals"], day: Day): boolean {
  return proposal.status === "sent" && (proposal.valid_until === null || daysBetween(day, proposal.valid_until) >= 0);
}

/** The counts beside the sidebar's items, from the rows the desk holds. */
export function navCounts(state: DeskState, day: Day = today(), at: number = now()): NavCounts {
  const ready = new Set<Id>();
  for (const message of rowsOf(state, "messages")) {
    if (message.status !== "held" || !RUNG.test(message.kind) || message.invoice_id === null) continue;
    if (message.due !== null && Date.parse(message.due) > at) continue;
    ready.add(message.invoice_id);
  }
  return {
    enquiries: rowsOf(state, "enquiries").filter((e) => e.status === "new").length,
    proposals: rowsOf(state, "proposals").filter((p) => isInDate(p, day)).length,
    invoices: rowsOf(state, "invoices").filter((i) => isOverdue(i, day)).length,
    chasing: ready.size,
  };
}

/** `navCounts`, as a hook. */
export function useNavCounts(): NavCounts {
  const state = useDesk();
  return navCounts(state);
}
