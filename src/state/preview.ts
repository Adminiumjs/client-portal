/**
 * "Preview as the client" (the desk only): the client's own rows, as the desk
 * read them, drawn through the client screens — no customer session, and every
 * client action refused with "This is a preview".
 *
 * Everything the client's pages show is read up front here (their documents'
 * lines, payments, milestones, deliverables and versions, their brief, the
 * terms their proposals name), so the client pages read nothing themselves
 * while previewing.
 */
import type { Id } from "../data/types.ts";
import type { ClientView, DeskView } from "../app/routes.ts";
import { loadClient, loadWhere, rowsOf, useDesk } from "./desk.ts";
import { previewFromDesk } from "./portal.ts";
import { startPreview } from "./ui.ts";

const idsIn = (ids: Id[]) => ({ op: "in" as const, value: ids });

export async function previewClient(clientId: Id, back: DeskView, view: ClientView = "home"): Promise<void> {
  await loadClient(clientId);
  const state = useDesk.getState();
  const proposals = rowsOf(state, "proposals").filter((p) => p.client_id === clientId && p.status !== "draft").map((p) => p.id);
  const invoices = rowsOf(state, "invoices").filter((i) => i.client_id === clientId).map((i) => i.id);
  const projects = rowsOf(state, "projects").filter((p) => p.client_id === clientId).map((p) => p.id);
  const versions = [...new Set(rowsOf(state, "proposals").filter((p) => proposals.includes(p.id) && p.terms_version_id !== null).map((p) => p.terms_version_id as Id))];
  const [, , , deliverables, briefs] = await Promise.all([
    proposals.length === 0 ? [] : loadWhere("proposal_lines", { column: "document_id", ...idsIn(proposals) }, "position.asc"),
    invoices.length === 0 ? [] : loadWhere("invoice_lines", { column: "document_id", ...idsIn(invoices) }, "position.asc"),
    projects.length === 0 ? [] : loadWhere("milestones", { column: "project_id", ...idsIn(projects) }, "position.asc"),
    projects.length === 0 ? [] : loadWhere("deliverables", { column: "project_id", ...idsIn(projects) }, "position.asc"),
    projects.length === 0 ? [] : loadWhere("briefs", { column: "project_id", ...idsIn(projects) }),
    versions.length === 0 ? [] : loadWhere("terms_clauses", { column: "version_id", ...idsIn(versions) }, "position.asc"),
  ]);
  const deliverableIds = deliverables.map((d) => d.id);
  await Promise.all([
    deliverableIds.length === 0 ? [] : loadWhere("deliverable_versions", { column: "deliverable_id", ...idsIn(deliverableIds) }, "v.asc"),
    deliverableIds.length === 0 ? [] : loadWhere("deliverable_notes", { column: "deliverable_id", ...idsIn(deliverableIds) }, "at.asc"),
    briefs.length === 0 ? [] : loadWhere("brief_answers", { column: "brief_id", ...idsIn(briefs.map((b) => b.id)) }),
  ]);
  const rows = useDesk.getState().rows;
  const settings = Object.values(rows.settings)[0] ?? null;
  const people = Object.values(rows.people).filter((p) => p.shown_to_clients);
  const questions = Object.values(rows.brief_questions).filter((q) => q.active);
  previewFromDesk(rows, clientId, { settings, people, briefQuestions: questions });
  startPreview(clientId, back, view);
}
