/**
 * What the clients' side holds: ONE client — the signed-in one — and their own
 * proposals, projects, invoices, payments and brief. Never a list of clients.
 *
 * Before sign-in it holds only what anyone may read about the studio (its
 * name, mark, how to reach it, who works there). After sign-in `loadPortal`
 * reads the client's own rows (the server scopes every read to the claim);
 * a document's page reads the rest of that document when it opens
 * (`loadProposal`, `loadInvoice` …).
 *
 * The clients' side has NO live channel: realtime is the studio's, and
 * polling would spend the key's shared read allowance. So the pages read
 * again when the window regains focus and when the client moves between
 * pages (`attachPortalRefresh`).
 *
 * In the studio's "preview as the client", the same screens draw rows the
 * desk read (`previewFromDesk`), with no customer session and every action
 * refused.
 */
import { create } from "zustand";

import type { ListCondition } from "../data/snapshotPort.ts";
import type { Me, PortalPort, PublicStudio } from "../data/ports.ts";
import { TABLE_REFS, type Id, type TableRef, type Tables } from "../data/types.ts";
import type { ById, Held } from "./desk.ts";
import { useUi } from "./ui.ts";

export type PortalLoad = "idle" | "loading" | "ready" | "failed";

export interface PortalState {
  load: PortalLoad;
  /** The server's code when the last read failed (`PUBLIC_SWITCHED_OFF` → the not-available page). */
  loadError: string | null;
  studio: PublicStudio | null;
  /** The signed-in client; null before sign-in. */
  me: Me | null;
  /** The client's own rows, by table and key. */
  rows: Held;
}

const emptyHeld = (): Held => Object.fromEntries(TABLE_REFS.map((ref) => [ref, {}])) as Held;

export const usePortal = create<PortalState>(() => ({ load: "idle", loadError: null, studio: null, me: null, rows: emptyHeld() }));

let port: PortalPort | null = null;
export function setPortalPort(next: PortalPort): void {
  port = next;
}
export function portalPort(): PortalPort {
  if (port === null) throw new Error("the clients' port is not set: boot sets it before any page mounts");
  return port;
}

export function upsertPortal<R extends TableRef>(ref: R, rows: readonly Tables[R][]): void {
  if (rows.length === 0) return;
  usePortal.setState((s) => ({ rows: { ...s.rows, [ref]: { ...s.rows[ref], ...Object.fromEntries(rows.map((row) => [row.id, row])) } } }));
}

/** Replace a table's rows with a fresh read (a row no longer returned is gone, or no longer the client's). */
function replace<R extends TableRef>(ref: R, rows: readonly Tables[R][]): void {
  usePortal.setState((s) => ({ rows: { ...s.rows, [ref]: Object.fromEntries(rows.map((row) => [row.id, row])) as ById<Tables[R]> } }));
}

const codeOf = (error: unknown): string => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "PUBLIC_NETWORK_UNAVAILABLE";
};

/** What anyone may read: the studio. Read once a visit (again when `force`d). */
export async function loadStudio(force = false): Promise<void> {
  if (!force && usePortal.getState().studio !== null) return;
  try {
    usePortal.setState({ studio: await portalPort().studio(), loadError: null });
  } catch (error) {
    usePortal.setState({ loadError: codeOf(error) });
  }
}

/**
 * The signed-in client's own rows: who they are, their proposals, projects
 * (with milestones and the deliverables shared with them), invoices and
 * payments, and their brief. A dozen bounded reads, all scoped by the server.
 */
export async function loadPortal(): Promise<void> {
  const p = portalPort();
  usePortal.setState({ load: "loading", loadError: null });
  try {
    const [me, proposals, projects, invoices, briefs] = await Promise.all([
      p.me(),
      p.list("proposals", undefined, "id.desc"),
      p.list("projects", undefined, "id.desc"),
      p.list("invoices", undefined, "id.desc"),
      p.list("briefs"),
    ]);
    const projectIds = projects.map((r) => r.id);
    const invoiceIds = invoices.map((r) => r.id);
    const inIds = (column: string, ids: Id[]): ListCondition => ({ column, op: "in", value: ids });
    const [milestones, deliverables, payments, answers] = await Promise.all([
      projectIds.length === 0 ? [] : p.list("milestones", inIds("project_id", projectIds), "position.asc"),
      projectIds.length === 0 ? [] : p.list("deliverables", inIds("project_id", projectIds), "position.asc"),
      invoiceIds.length === 0 ? [] : p.list("payments", inIds("document_id", invoiceIds), "paid_on.asc"),
      briefs.length === 0 ? [] : p.list("brief_answers", inIds("brief_id", briefs.map((b) => b.id))),
    ]);
    replace("proposals", proposals);
    replace("projects", projects);
    replace("invoices", invoices);
    replace("briefs", briefs);
    replace("milestones", milestones);
    replace("deliverables", deliverables);
    replace("payments", payments);
    replace("brief_answers", answers);
    usePortal.setState({ me, load: "ready" });
  } catch (error) {
    usePortal.setState({ load: "failed", loadError: codeOf(error) });
  }
}

/** One proposal's lines, and the terms it names with their clauses. */
export async function loadClientProposal(id: Id): Promise<void> {
  // The studio's preview read everything up front, from the desk.
  if (useUi.getState().preview !== null) return;
  const p = portalPort();
  const [proposals, lines] = await Promise.all([
    p.list("proposals", { column: "id", op: "eq", value: id }, undefined, 1),
    p.list("proposal_lines", { column: "document_id", op: "eq", value: id }, "position.asc"),
  ]);
  upsertPortal("proposals", proposals);
  upsertPortal("proposal_lines", lines);
  const version = proposals[0]?.terms_version_id ?? null;
  if (version !== null) {
    const [versions, clauses] = await Promise.all([
      p.list("terms_versions", { column: "id", op: "eq", value: version }, undefined, 1),
      p.list("terms_clauses", { column: "version_id", op: "eq", value: version }, "position.asc"),
    ]);
    upsertPortal("terms_versions", versions);
    upsertPortal("terms_clauses", clauses);
  }
}

/** One invoice's lines and payments. */
export async function loadClientInvoice(id: Id): Promise<void> {
  // The studio's preview read everything up front, from the desk.
  if (useUi.getState().preview !== null) return;
  const p = portalPort();
  const [invoices, lines, payments] = await Promise.all([
    p.list("invoices", { column: "id", op: "eq", value: id }, undefined, 1),
    p.list("invoice_lines", { column: "document_id", op: "eq", value: id }, "position.asc"),
    p.list("payments", { column: "document_id", op: "eq", value: id }, "paid_on.asc"),
  ]);
  upsertPortal("invoices", invoices);
  upsertPortal("invoice_lines", lines);
  upsertPortal("payments", payments);
}

/** One project's milestones, its shared deliverables and their versions. */
export async function loadClientProject(id: Id): Promise<void> {
  // The studio's preview read everything up front, from the desk.
  if (useUi.getState().preview !== null) return;
  const p = portalPort();
  const [projects, milestones, deliverables] = await Promise.all([
    p.list("projects", { column: "id", op: "eq", value: id }, undefined, 1),
    p.list("milestones", { column: "project_id", op: "eq", value: id }, "position.asc"),
    p.list("deliverables", { column: "project_id", op: "eq", value: id }, "position.asc"),
  ]);
  upsertPortal("projects", projects);
  upsertPortal("milestones", milestones);
  upsertPortal("deliverables", deliverables);
  const ids = deliverables.map((d) => d.id);
  if (ids.length > 0) upsertPortal("deliverable_versions", await p.list("deliverable_versions", { column: "deliverable_id", op: "in", value: ids }, "v.asc"));
}

/** One deliverable's review: its versions and the notes on it. */
export async function loadClientDeliverable(id: Id): Promise<void> {
  // The studio's preview read everything up front, from the desk.
  if (useUi.getState().preview !== null) return;
  const p = portalPort();
  const [versions, notes] = await Promise.all([
    p.list("deliverable_versions", { column: "deliverable_id", op: "eq", value: id }, "v.asc"),
    p.list("deliverable_notes", { column: "deliverable_id", op: "eq", value: id }, "at.asc"),
  ]);
  upsertPortal("deliverable_versions", versions);
  upsertPortal("deliverable_notes", notes);
}

/** Read again what the page on show is about (the client's rows, and the open document). */
export async function refreshOpen(): Promise<void> {
  if (port === null || usePortal.getState().me === null || useUi.getState().preview !== null) return;
  const { view, selected } = useUi.getState();
  await loadPortal();
  if (view === "proposal" && selected.proposal !== null) await loadClientProposal(selected.proposal).catch(() => undefined);
  if (view === "invoice" && selected.invoice !== null) await loadClientInvoice(selected.invoice).catch(() => undefined);
  if (view === "project" && selected.project !== null) await loadClientProject(selected.project).catch(() => undefined);
  if (view === "review" && selected.deliverable !== null) await loadClientDeliverable(selected.deliverable).catch(() => undefined);
}

/**
 * Re-read on focus and on navigation — the clients' side's only way of
 * following the studio. Returns the function that stops.
 */
export function attachPortalRefresh(target: Pick<Window, "addEventListener" | "removeEventListener"> = window): () => void {
  const onFocus = () => void refreshOpen();
  target.addEventListener("focus", onFocus);
  const stop = useUi.subscribe((s, before) => {
    if (s.view !== before.view || s.selected !== before.selected) void refreshOpen();
  });
  return () => {
    target.removeEventListener("focus", onFocus);
    stop();
  };
}

/** The studio's preview: the desk's rows for one client, drawn through the client screens. */
export function previewFromDesk(desk: Held, clientId: Id, studio: PublicStudio): void {
  const own = <R extends TableRef>(ref: R, keep: (row: Tables[R]) => boolean): ById<Tables[R]> =>
    Object.fromEntries((Object.values(desk[ref]) as Tables[R][]).filter(keep).map((row) => [row.id, row])) as ById<Tables[R]>;
  const mine = (row: { client_id?: Id | null }) => row.client_id === clientId;
  const client = desk.clients[clientId];
  const rows = emptyHeld();
  rows.proposals = own("proposals", (r) => mine(r) && r.status !== "draft");
  rows.proposal_lines = own("proposal_lines", (r) => rows.proposals[r.document_id] !== undefined);
  rows.projects = own("projects", mine);
  rows.milestones = own("milestones", (r) => rows.projects[r.project_id] !== undefined);
  rows.deliverables = own("deliverables", (r) => rows.projects[r.project_id] !== undefined && r.status !== "unshared");
  rows.deliverable_versions = own("deliverable_versions", (r) => rows.deliverables[r.deliverable_id] !== undefined);
  rows.deliverable_notes = own("deliverable_notes", (r) => rows.deliverables[r.deliverable_id] !== undefined);
  rows.invoices = own("invoices", (r) => mine(r) && (r.status === "sent" || (r.status === "void" && r.issued_on !== null)));
  rows.invoice_lines = own("invoice_lines", (r) => rows.invoices[r.document_id] !== undefined);
  rows.payments = own("payments", (r) => rows.invoices[r.document_id] !== undefined && !r.voided);
  rows.briefs = own("briefs", (r) => rows.projects[r.project_id] !== undefined);
  rows.brief_answers = own("brief_answers", (r) => rows.briefs[r.brief_id] !== undefined);
  rows.terms_versions = desk.terms_versions;
  rows.terms_clauses = desk.terms_clauses;
  usePortal.setState({
    load: "ready",
    loadError: null,
    studio,
    me: client === undefined ? null : { company: client.company, contact_name: client.contact_name },
    rows,
  });
}

/** Every held row of a table, as a hook. */
export function usePortalRows<R extends TableRef>(ref: R): Tables[R][] {
  const table = usePortal((s) => s.rows[ref]);
  return Object.values(table) as Tables[R][];
}

/** One held row, as a hook. */
export function usePortalRow<R extends TableRef>(ref: R, id: Id | null | undefined): Tables[R] | undefined {
  return usePortal((s) => (id === null || id === undefined ? undefined : (s.rows[ref][id] as Tables[R] | undefined)));
}

/** Forget the client (sign-out, a test). */
export function resetPortal(): void {
  usePortal.setState({ load: "idle", loadError: null, me: null, rows: emptyHeld() });
}
