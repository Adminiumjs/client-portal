/**
 * What the Archive reads when it opens: every finished project, the sent
 * invoices of those projects and their clients. Reads only.
 */
import type { Id } from "../../data/types.ts";
import { ensureRows, loadWhere } from "../../state/desk.ts";

export async function loadArchive(): Promise<void> {
  const projects = await loadWhere("projects", { column: "status", op: "eq", value: "done" }, "done_on.desc", 1000);
  const ids: Id[] = projects.map((p) => p.id);
  await Promise.all([
    ensureRows("clients", projects.map((p) => p.client_id)),
    ids.length === 0 ? [] : loadWhere("invoices", { and: [{ column: "project_id", op: "in", value: ids }, { column: "status", op: "eq", value: "sent" }] }, "id.asc", 2000),
  ]);
}
