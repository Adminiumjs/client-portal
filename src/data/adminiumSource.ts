/**
 * The desk's reads, from Adminium, as the signed-in staff member.
 *
 * Every read is BOUNDED. The desk opens with the studio's set-up (small
 * tables, read whole) and the open work — proposals not yet decided or decided
 * in the last 90 days, draft and unpaid invoices, active and paused projects
 * with their milestones and deliverables, new and parked enquiries, the
 * messages held for approval — and the clients those name. Everything else
 * (a paid invoice from last year, a client's history, a deliverable's notes)
 * is read when a screen opens it, a page at a time.
 *
 * Tables are read by their REAL names (`tableOf`, from the staff config), and
 * rows come back in the app's spelling (`rows.ts`).
 */
import type { SessionTransport } from "./sessionSource.ts";
import { APP_KEY } from "../surface-nav.ts";
import type { ListCondition } from "./snapshotPort.ts";
import { normaliseAll } from "./rows.ts";
import type { DeskReads, DeskSnapshot, DocumentLink, Page, PageQuery, SearchHit } from "./ports.ts";
import type { Id, TableRef, Tables } from "./types.ts";
import { addDays, venueMidnight } from "./venueTime.ts";

/**
 * The columns the desk cannot work without, per table. Checked at boot, so a
 * database that does not match says which column is missing instead of a
 * screen failing later.
 */
export const REQUIRED: Record<TableRef, string[]> = {
  settings: ["id", "name", "mark", "reply_to"],
  people: ["id", "name", "role_label", "initials", "position"],
  rates: ["id", "label", "amount", "position", "active"],
  terms_versions: ["id", "version", "status", "in_force_from", "client_key"],
  terms_clauses: ["id", "version_id", "position", "title", "body", "change", "client_key"],
  brief_questions: ["id", "key", "question", "kind", "position", "active"],
  clients: ["id", "company", "contact_name", "email", "client_key"],
  client_notes: ["id", "client_id", "body", "by", "at"],
  enquiries: ["id", "number", "name", "status", "parked_until", "client_id", "received_at", "client_key"],
  proposals: ["id", "number", "status", "client_id", "title", "valid_until", "total", "split", "decided_at", "revision_of", "client_key"],
  proposal_lines: ["id", "document_id", "position", "description", "qty", "rate", "amount", "client_key"],
  projects: ["id", "number", "client_id", "proposal_id", "name", "status", "share_token", "client_key"],
  project_fonts: ["id", "project_id", "name", "position", "client_key"],
  handover_files: ["id", "project_id", "file", "position", "client_key"],
  milestones: ["id", "project_id", "title", "due_on", "state", "position", "client_key"],
  deliverables: ["id", "project_id", "milestone_id", "title", "status", "shared_at", "position", "client_key"],
  deliverable_versions: ["id", "deliverable_id", "v", "file", "link", "posted_at", "client_key"],
  deliverable_notes: ["id", "deliverable_id", "version_id", "side", "author", "body", "at", "client_key"],
  briefs: ["id", "project_id", "status", "sent_at"],
  brief_answers: ["id", "brief_id", "question_key", "answer"],
  invoices: ["id", "number", "status", "client_id", "project_id", "proposal_id", "total", "paid", "balance", "due_on", "from_quote_id", "share_pct", "client_key"],
  invoice_lines: ["id", "document_id", "position", "description", "qty", "rate", "amount", "quote_id", "time_entry_id", "expense_id", "client_key"],
  payments: ["id", "document_id", "number", "amount", "method", "paid_on", "voided", "client_key"],
  messages: ["id", "kind", "status", "to", "invoice_id", "due", "client_key"],
  time_entries: ["id", "project_id", "client_id", "milestone_id", "person_id", "date", "hours", "logged_hours", "note", "running_for", "started_at", "clock_stopped", "stopped_at", "client_key"],
  suppliers: ["id", "number", "name", "kind", "client_key"],
  expenses: ["id", "number", "date", "what", "amount", "client_id", "project_id", "supplier_id", "rebill", "receipt", "client_key"],
  running_costs: ["id", "label", "monthly_amount", "position"],
  events: ["id", "date", "to_date", "title", "kind", "person_id", "client_key"],
};

/** The route's largest page. */
export const PAGE = 200;
/** How many keys one `in` filter carries. */
const CHUNK = 100;
/** The most rows any one open-work read takes. */
export const MOST = 2000;
/** How far back a decided proposal still counts as open work. */
export const DECIDED_DAYS = 90;

export const and = (...conditions: (ListCondition | null | undefined)[]): ListCondition | undefined => {
  const kept = conditions.filter((c): c is ListCondition => c !== null && c !== undefined);
  return kept.length === 0 ? undefined : kept.length === 1 ? kept[0] : { and: kept };
};

/** The open-work conditions, one per table — the desk's read set, spelled once. */
export function openWork(today: string, zone: string): {
  proposals: ListCondition;
  invoices: ListCondition;
  projects: ListCondition;
  enquiries: ListCondition;
  messages: ListCondition;
} {
  const since = venueMidnight(addDays(today, -DECIDED_DAYS), zone);
  return {
    proposals: { or: [{ column: "status", op: "in", value: ["draft", "sent"] }, { column: "decided_at", op: "gte", value: since }] },
    invoices: { or: [{ column: "status", op: "eq", value: "draft" }, and({ column: "status", op: "eq", value: "sent" }, { column: "balance", op: "gt", value: 0 })!] },
    projects: { column: "status", op: "in", value: ["active", "paused"] },
    enquiries: { column: "status", op: "in", value: ["new", "parked"] },
    messages: { column: "status", op: "eq", value: "held" },
  };
}

export function sessionDeskReads(
  transport: SessionTransport,
  /**
   * Whether the signed-in person may read a table. A table they may not read
   * is simply empty on their desk, rather than a refused read failing it all.
   */
  readable: (ref: TableRef) => boolean = () => true,
): DeskReads {
  const port = transport.port;

  /** Every row a condition matches, page by page, up to `limit`. */
  async function all<R extends TableRef>(ref: R, where?: ListCondition, order?: string, limit = MOST): Promise<Tables[R][]> {
    if (!readable(ref)) return [];
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; offset < limit; offset += PAGE) {
      const page = await port.list<Record<string, unknown>>(ref, {
        limit: Math.min(PAGE, limit - offset),
        offset,
        ...(where === undefined ? {} : { where }),
        ...(order === undefined ? {} : { order }),
      });
      out.push(...page.data);
      if (page.data.length < Math.min(PAGE, limit - offset)) break;
    }
    return normaliseAll(ref, out);
  }

  /** Every row whose `column` is one of `ids`, in chunks. */
  async function byIds<R extends TableRef>(ref: R, column: string, ids: readonly Id[], order?: string): Promise<Tables[R][]> {
    const unique = [...new Set(ids)];
    const out: Tables[R][] = [];
    for (let i = 0; i < unique.length; i += CHUNK) {
      out.push(...(await all(ref, { column, op: "in", value: unique.slice(i, i + CHUNK) }, order)));
    }
    return out;
  }

  return {
    async snapshot(today, zone): Promise<DeskSnapshot> {
      const open = openWork(today, zone);
      const [settings, people, rates, termsVersions, briefQuestions, proposals, invoices, projects, enquiries, messages] = await Promise.all([
        all("settings", undefined, "id.asc", 1),
        all("people", undefined, "position.asc"),
        all("rates", undefined, "position.asc"),
        all("terms_versions", undefined, "version.desc", PAGE),
        all("brief_questions", undefined, "position.asc"),
        all("proposals", open.proposals, "id.desc"),
        all("invoices", open.invoices, "id.desc"),
        all("projects", open.projects, "id.desc"),
        all("enquiries", open.enquiries, "received_at.desc"),
        all("messages", open.messages, "due.asc"),
      ]);
      const projectIds = projects.map((p) => p.id);
      const [milestones, deliverables] = await Promise.all([
        byIds("milestones", "project_id", projectIds, "position.asc"),
        byIds("deliverables", "project_id", projectIds, "position.asc"),
      ]);
      const named = [
        ...proposals.map((p) => p.client_id),
        ...invoices.map((i) => i.client_id),
        ...projects.map((p) => p.client_id),
        ...enquiries.map((e) => e.client_id),
        ...messages.map((m) => m.client_id),
      ].filter((id): id is Id => id !== null);
      const clients = await byIds("clients", "id", named);
      return { today, settings: settings[0] ?? null, people, rates, termsVersions, briefQuestions, proposals, invoices, projects, milestones, deliverables, enquiries, messages, clients };
    },

    rows: (ref, ids) => byIds(ref, "id", ids),

    where: (ref, where, order, limit = MOST) => all(ref, where, order, limit),

    async page<R extends TableRef>(ref: R, query: PageQuery): Promise<Page<Tables[R]>> {
      if (!readable(ref)) return { rows: [], total: 0 };
      const reply = await port.list<Record<string, unknown>>(ref, {
        limit: Math.min(query.limit, PAGE),
        offset: query.offset,
        ...(query.where === undefined ? {} : { where: query.where }),
        ...(query.order === undefined ? {} : { order: query.order }),
        ...(query.count === true ? { count: true } : {}),
      });
      return { rows: normaliseAll(ref, reply.data), total: reply.total ?? null };
    },

    async search(text, limit) {
      const q = text.trim();
      if (q === "") return [];
      const like = `%${q}%`;
      const each = Math.max(1, limit);
      const [proposals, invoices, projects, clients] = await Promise.all([
        all("proposals", { or: [{ column: "number", op: "ilike", value: like }, { column: "title", op: "ilike", value: like }] }, "id.desc", each),
        all("invoices", { or: [{ column: "number", op: "ilike", value: like }, { column: "title", op: "ilike", value: like }] }, "id.desc", each),
        all("projects", { or: [{ column: "number", op: "ilike", value: like }, { column: "name", op: "ilike", value: like }] }, "id.desc", each),
        all("clients", { or: [{ column: "company", op: "ilike", value: like }, { column: "contact_name", op: "ilike", value: like }] }, "company.asc", each),
      ]);
      const named = await byIds("clients", "id", [...proposals, ...invoices, ...projects].map((row) => row.client_id));
      const company = new Map(named.map((c) => [c.id, c.company]));
      const hits: SearchHit[] = [
        ...proposals.map((p) => ({ table: "proposals" as const, id: p.id, label: p.number ?? "", title: p.title, client: company.get(p.client_id) ?? null })),
        ...invoices.map((i) => ({ table: "invoices" as const, id: i.id, label: i.number ?? "", title: i.title ?? "", client: company.get(i.client_id) ?? null })),
        ...projects.map((p) => ({ table: "projects" as const, id: p.id, label: p.number ?? "", title: p.name, client: company.get(p.client_id) ?? null })),
        ...clients.map((c) => ({ table: "clients" as const, id: c.id, label: c.company, title: c.contact_name, client: null })),
      ];
      return hits.slice(0, limit);
    },

    /*
     * The add-on's document for one row, drawn by Adminium: the app names the
     * table by its own short name and the row by its key; Adminium finds the
     * real table, checks this person may read everything the document shows,
     * and answers where the PDF and the printable HTML are (reusing a copy
     * already drawn while the row is unchanged).
     */
    async documentUrl(kind, ref, id, locale, period): Promise<DocumentLink> {
      const reply = await transport.mutate<{ contentUrl?: string; printUrl?: string }>(`/api/v1/apps/${APP_KEY}/documents/render`, "POST", {
        kind,
        ref,
        pk: { id },
        locale,
        ...(period === undefined ? {} : { period }),
      });
      if (typeof reply.contentUrl !== "string" || typeof reply.printUrl !== "string") throw Object.assign(new Error("the document route answered no address"), { status: 502, code: "DOCUMENTS_UNAVAILABLE" });
      return { printUrl: reply.printUrl, contentUrl: reply.contentUrl };
    },
  };
}
