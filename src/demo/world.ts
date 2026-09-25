/**
 * The demo's stand-in world — DEMO BUILD ONLY.
 *
 * The website's demo has no server, so this plays Adminium's part in memory:
 * the same doors the real desk and clients' side use (`DeskReads`,
 * `DeskWrites`, `PortalPort`), over the sample studio, deciding what Adminium
 * decides — numbers, line amounts, totals, tax, paid and balance, the stamps,
 * the moves a state allows, a sent document's lock, the balance cap, the
 * unique action keys — with the server's refusal codes. Every write
 * announces itself as the live stream would, so the desk follows the clients'
 * side and back.
 *
 * It is the seed of the full stand-in world (the three-engine figures, the
 * held chase rungs, the fingerprint); what it decides here is enough for every
 * screen and every action to run in the demo exactly as against Adminium.
 */
import type { LiveFrame } from "../data/live.ts";
import { PortError, type DeskReads, type DeskWrites, type HandoverView, type Page, type PortalPort, type SearchHit } from "../data/ports.ts";
import { SinkError } from "../data/sink.ts";
import type { ListCondition } from "../data/snapshotPort.ts";
import { COLUMN_KINDS, NULLABLE, TABLE_REFS, type Id, type TableRef, type Tables } from "../data/types.ts";
import { addDays, venueDay } from "../data/venueTime.ts";
import { openWork } from "../data/adminiumSource.ts";

type Row = Record<string, unknown> & { id: Id };
type Seed = { [R in TableRef]?: Partial<Tables[R]>[] };
export type Rows = { [R in TableRef]: Row[] };

export interface Actor {
  /** The desk's signed-in person (stamps "by", "posted by", "recorded by"). */
  name: string;
}

export interface DemoWorld {
  rows: Rows;
  reads: DeskReads;
  writes: DeskWrites;
  /** The clients' side, signed in (or not) as one client. */
  portal(clientId: Id): PortalPort;
  subscribe(listener: (frame: LiveFrame) => void): () => void;
}

const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);
const num = (v: unknown): number => (v === null || v === undefined || v === "" ? 0 : Number(v));
const refuse = (status: number, code: string, details: Record<string, unknown> = {}): never => {
  throw new SinkError(code, "refused", status, code, typeof details["column"] === "string" ? (details["column"] as string) : null, details);
};

// ── the filter grammar, as the data API reads it ────────────────────────────

export function matches(row: Record<string, unknown>, where: ListCondition | undefined): boolean {
  if (where === undefined) return true;
  if ("and" in where) return where.and.every((c) => matches(row, c));
  if ("or" in where) return where.or.some((c) => matches(row, c));
  const value = row[where.column];
  const cmp = (a: unknown, b: unknown): number => {
    const na = Number(a);
    const nb = Number(b);
    if (typeof a !== "boolean" && a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  };
  switch (where.op) {
    case "eq":
      return value === where.value || (value !== null && value !== undefined && String(value) === String(where.value));
    case "neq":
      return !(value === where.value || String(value) === String(where.value));
    case "gt":
      return value !== null && value !== undefined && cmp(value, where.value) > 0;
    case "gte":
      return value !== null && value !== undefined && cmp(value, where.value) >= 0;
    case "lt":
      return value !== null && value !== undefined && cmp(value, where.value) < 0;
    case "lte":
      return value !== null && value !== undefined && cmp(value, where.value) <= 0;
    case "in":
      return Array.isArray(where.value) && where.value.some((v) => v === value || String(v) === String(value));
    case "ilike": {
      const pattern = String(where.value).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`).test(String(value ?? "").toLowerCase());
    }
    case "is_null":
      return value === null || value === undefined;
    case "not_null":
      return value !== null && value !== undefined;
  }
}

export function sortRows(rows: Row[], order: string | undefined): Row[] {
  if (order === undefined) return [...rows].sort((a, b) => a.id - b.id);
  const keys = order.split(",").map((k) => {
    const [column, dir] = k.split(".");
    return { column: column ?? "id", desc: dir === "desc" };
  });
  return [...rows].sort((a, b) => {
    for (const { column, desc } of keys) {
      const x = a[column];
      const y = b[column];
      if (x === y) continue;
      if (x === null || x === undefined) return 1;
      if (y === null || y === undefined) return -1;
      const d = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      if (d !== 0) return desc ? -d : d;
    }
    return a.id - b.id;
  });
}

// ── the world ───────────────────────────────────────────────────────────────

const NUMBERED: Partial<Record<TableRef, { prefix: string; pad: number }>> = {
  enquiries: { prefix: "ENQ-", pad: 3 },
  proposals: { prefix: "PRO-", pad: 4 },
  projects: { prefix: "PRJ-", pad: 2 },
  invoices: { prefix: "INV-", pad: 4 },
  payments: { prefix: "REC-", pad: 4 },
};

/** Tables whose rows carry their document's client (copied, as Adminium's rule does). */
const CLIENT_VIA: Partial<Record<TableRef, { parent: TableRef; column: string }>> = {
  proposal_lines: { parent: "proposals", column: "document_id" },
  invoice_lines: { parent: "invoices", column: "document_id" },
  payments: { parent: "invoices", column: "document_id" },
  milestones: { parent: "projects", column: "project_id" },
  deliverables: { parent: "projects", column: "project_id" },
  project_fonts: { parent: "projects", column: "project_id" },
  handover_files: { parent: "projects", column: "project_id" },
  briefs: { parent: "projects", column: "project_id" },
  deliverable_versions: { parent: "deliverables", column: "deliverable_id" },
  deliverable_notes: { parent: "deliverables", column: "deliverable_id" },
  brief_answers: { parent: "briefs", column: "brief_id" },
};

export function createWorld(seed: Seed, now: () => number, zone: string, actor: Actor): DemoWorld {
  const rows = Object.fromEntries(TABLE_REFS.map((ref) => [ref, []])) as unknown as Rows;
  const listeners = new Set<(frame: LiveFrame) => void>();
  const emit = (table: TableRef, kind: LiveFrame["kind"], id: Id) => listeners.forEach((l) => l({ table, kind, id }));
  const iso = () => new Date(now()).toISOString();
  const today = () => venueDay(now(), zone);

  const find = (ref: TableRef, id: unknown): Row | undefined => rows[ref].find((r) => r.id === id);
  const complete = (ref: TableRef, row: Record<string, unknown>): Row => {
    const out: Record<string, unknown> = { ...row };
    for (const column of NULLABLE[ref]) if (!(column in out)) out[column] = null;
    for (const [column, kind] of Object.entries(COLUMN_KINDS[ref] as Record<string, string>)) if (!(column in out) && kind === "bool") out[column] = false;
    return out as Row;
  };

  /** Adminium's settle: line amounts, then document totals, then paid and balance. */
  function settle(): void {
    // Proposals first: a stage invoice's line reads its proposal's total.
    for (const [doc, table] of [
      ["proposals", "proposal_lines"],
      ["invoices", "invoice_lines"],
    ] as const) {
      for (const line of rows[table]) {
        const quote = line["quote_id"] === null || line["quote_id"] === undefined ? undefined : find("proposals", line["quote_id"]);
        if (quote !== undefined) {
          const parent = find("invoices", line["document_id"]);
          line["rate"] = quote["total"];
          line["share_pct"] = parent?.["share_pct"] ?? line["share_pct"] ?? null;
          line["amount"] = money((num(quote["total"]) * num(line["share_pct"])) / 100);
        } else {
          const gross = num(line["qty"]) * num(line["rate"]);
          const off = line["discount_kind"] === "percent" ? gross * (num(line["discount"]) / 100) : num(line["discount"]);
          line["amount"] = money(Math.max(0, gross - off));
        }
      }
      for (const row of rows[doc]) {
        const subtotal = rows[table].filter((l) => l["document_id"] === row.id).reduce((s, l) => s + num(l["amount"]), 0);
        const tax = Math.round(subtotal * num(row["tax_rate"])) / 100;
        row["subtotal"] = money(subtotal);
        row["tax"] = money(tax);
        row["total"] = money(subtotal + tax);
      }
    }
    for (const invoice of rows.invoices) {
      const paid = rows.payments.filter((p) => p["document_id"] === invoice.id && p["voided"] !== true).reduce((s, p) => s + num(p["amount"]), 0);
      invoice["paid"] = money(paid);
      invoice["balance"] = money(num(invoice["total"]) - paid);
    }
  }

  function nextNumber(ref: TableRef): { seq: number; text: string } | null {
    const spec = NUMBERED[ref];
    if (spec === undefined) return null;
    const seqs = rows[ref].map((r) => Number(String(r["number"] ?? "").replace(/\D/g, "")) || num(r["number_seq"]));
    const seq = Math.max(0, ...seqs) + 1;
    return { seq, text: `${spec.prefix}${String(seq).padStart(spec.pad, "0")}` };
  }

  /** The stamps Adminium writes on a create or a change. */
  function stamp(ref: TableRef, row: Row, before: Row | null): void {
    const changed = (column: string, values: unknown[]) => values.includes(row[column]) && (before === null || before[column] !== row[column]);
    const set = (column: string, value: unknown) => {
      row[column] = value;
    };
    if (before === null) {
      if (ref === "enquiries") set("received_at", iso());
      if (ref === "clients") set("created_at", iso());
      if (ref === "client_notes") {
        set("by", actor.name);
        set("at", iso());
      }
      if (ref === "projects") set("started_on", today());
      if (ref === "payments") {
        set("recorded_by", actor.name);
        set("recorded_at", iso());
      }
      if (ref === "deliverable_versions") {
        set("posted_by", actor.name);
        set("posted_at", iso());
        set("v", Math.max(0, ...rows.deliverable_versions.filter((v) => v["deliverable_id"] === row["deliverable_id"]).map((v) => num(v["v"]))) + 1);
      }
      if (ref === "terms_versions") set("version", Math.max(0, ...rows.terms_versions.map((v) => num(v["version"]))) + 1);
    }
    if (ref === "proposals" || ref === "invoices") {
      if (changed("status", ["sent"])) set("sent_at", iso());
      if (ref === "proposals" && changed("status", ["accepted", "declined", "withdrawn"])) set("decided_at", iso());
      if (ref === "proposals" && changed("new_price_asked", [true])) set("new_price_asked_at", iso());
      if (ref === "invoices" && changed("status", ["sent"])) {
        set("issued_on", today());
        const days = { net7: 7, net14: 14, net30: 30, "on-receipt": 0 }[String(row["terms"] ?? "net14")] ?? 14;
        set("due_on", addDays(today(), days));
      }
      if (ref === "invoices" && changed("status", ["void"])) {
        set("voided_at", iso());
        set("voided_by", actor.name);
      }
      if (ref === "invoices" && changed("client_paid", [true])) set("client_paid_at", iso());
    }
    if (ref === "projects") {
      if (changed("status", ["done"])) set("done_on", today());
      if (before !== null && before["status"] === "done" && row["status"] === "active") set("done_on", null);
      if (changed("share_stopped", [true])) set("share_stopped_at", iso());
      if (changed("handover_sent", [true])) set("handover_sent_at", iso());
    }
    if (ref === "deliverables") {
      if (changed("status", ["pending"])) set("shared_at", iso());
      if (changed("status", ["approved", "changes"])) set("reviewed_at", iso());
    }
    if (ref === "milestones" && changed("state", ["done"])) set("done_at", iso());
    if (ref === "briefs" && changed("status", ["sent"])) set("sent_at", iso());
    if (ref === "payments" && changed("voided", [true])) {
      set("voided_by", actor.name);
      set("voided_at", iso());
    }
    if (ref === "messages" && changed("status", ["queued"])) set("approved_by", actor.name);
    const via = CLIENT_VIA[ref];
    if (via !== undefined) row["client_id"] = find(via.parent, row[via.column])?.["client_id"] ?? row["client_id"] ?? null;
  }

  /** The moves and locks Adminium keeps, as refusals. */
  function check(ref: TableRef, row: Row, before: Row | null): void {
    const lockedParent = (table: "proposals" | "invoices", id: unknown) => {
      const doc = find(table, id);
      if (doc !== undefined && doc["status"] !== "draft") refuse(409, "RECORD_LOCKED", { column: "document_id" });
    };
    if (ref === "proposal_lines") lockedParent("proposals", row["document_id"]);
    if (ref === "invoice_lines") lockedParent("invoices", row["document_id"]);
    if ((ref === "proposals" || ref === "invoices") && before !== null && before["status"] !== row["status"]) {
      if (row["status"] === "sent") {
        const lines = rows[ref === "proposals" ? "proposal_lines" : "invoice_lines"].filter((l) => l["document_id"] === row.id);
        if (lines.length === 0 || num(before["total"]) <= 0) refuse(422, "DOCUMENT_EMPTY");
      }
      if (ref === "invoices" && row["status"] === "void" && num(before["paid"]) > 0) refuse(409, "STATE_MOVE_REFUSED", { column: "status" });
    }
    if (ref === "payments" && before === null) {
      const invoice = find("invoices", row["document_id"]);
      if (invoice === undefined || invoice["status"] !== "sent") refuse(409, "STATE_MOVE_REFUSED", { column: "document_id" });
      if (num(row["amount"]) > num(invoice?.["balance"]) + 1e-9) refuse(409, "BALANCE_EXCEEDED", { column: "balance", balance: invoice?.["balance"] });
    }
    if (typeof row["client_key"] === "string" && rows[ref].some((r) => r.id !== row.id && r["client_key"] === row["client_key"])) refuse(409, "UNIQUE_VIOLATION", { column: "client_key" });
    if (ref === "clients" && rows.clients.some((r) => r.id !== row.id && String(r["email"]).toLowerCase() === String(row["email"]).toLowerCase())) refuse(409, "UNIQUE_VIOLATION", { column: "email" });
  }

  function insertRow(ref: TableRef, values: Record<string, unknown>): Row {
    const id = Math.max(0, ...rows[ref].map((r) => r.id)) + 1;
    const row = complete(ref, { ...values, id });
    if (ref === "proposals" || ref === "invoices") row["status"] = row["status"] ?? "draft";
    if (ref === "enquiries") row["status"] = row["status"] ?? "new";
    if (ref === "projects") row["status"] = row["status"] ?? "active";
    if (ref === "deliverables") row["status"] = row["status"] ?? "unshared";
    if (ref === "milestones") row["state"] = row["state"] ?? "next";
    if (ref === "messages") row["status"] = row["status"] ?? "queued";
    if (ref === "projects") row["share_token"] = Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(16, "X");
    // The defaults Adminium fills from the connection, the add-on's settings and the client.
    if (ref === "proposals" || ref === "invoices") {
      const client = find("clients", row["client_id"]);
      row["currency"] = row["currency"] ?? "USD";
      row["tax_name"] = row["tax_name"] ?? "Tax";
      row["tax_rate"] = row["tax_rate"] ?? client?.["tax_rate"] ?? "8.5";
      if (ref === "invoices") {
        row["terms"] = row["terms"] ?? client?.["terms"] ?? "net14";
        row["ladder"] = row["ladder"] ?? "standard";
      }
    }
    const number = nextNumber(ref);
    if (number !== null && (row["number"] === null || row["number"] === undefined)) {
      row["number"] = number.text;
      row["number_seq"] = number.seq;
    }
    check(ref, row, null);
    stamp(ref, row, null);
    rows[ref].push(row);
    // A payment clears what the client said they sent (they said, the studio recorded).
    if (ref === "payments") {
      const invoice = find("invoices", row["document_id"]);
      if (invoice !== undefined) for (const column of ["client_paid_note", "client_paid_amount", "client_paid_on", "client_paid_at"]) invoice[column] = null;
      if (invoice !== undefined) invoice["client_paid"] = false;
    }
    settle();
    return row;
  }

  function updateRow(ref: TableRef, id: Id, patch: Record<string, unknown>): Row {
    const row = find(ref, id) ?? refuse(404, "NOT_FOUND");
    const before = { ...row };
    const next = { ...row, ...patch, id } as Row;
    check(ref, next, before);
    stamp(ref, next, before);
    Object.assign(row, next);
    settle();
    return row;
  }

  // Load the sample: every row completed, then settled, as a sample load is.
  for (const ref of TABLE_REFS) for (const row of (seed[ref] ?? []) as Record<string, unknown>[]) rows[ref].push(complete(ref, row as Row));
  // Each child carries its document's or project's client, as Adminium's copy rule fills it.
  for (const [ref, via] of Object.entries(CLIENT_VIA) as [TableRef, { parent: TableRef; column: string }][]) {
    for (const row of rows[ref]) row["client_id"] = find(via.parent, row[via.column])?.["client_id"] ?? row["client_id"] ?? null;
  }
  settle();

  const copy = <R extends TableRef>(row: Row): Tables[R] => ({ ...row }) as unknown as Tables[R];
  const select = <R extends TableRef>(ref: R, where?: ListCondition, order?: string): Tables[R][] => sortRows(rows[ref].filter((r) => matches(r, where)), order).map((r) => copy<R>(r));

  const reads: DeskReads = {
    async snapshot(day, z) {
      const open = openWork(day, z);
      const projects = select("projects", open.projects, "id.desc");
      const ids = projects.map((p) => p.id);
      const snap = {
        today: day,
        settings: select("settings")[0] ?? null,
        people: select("people", undefined, "position.asc"),
        rates: select("rates", undefined, "position.asc"),
        termsVersions: select("terms_versions", undefined, "version.desc"),
        briefQuestions: select("brief_questions", undefined, "position.asc"),
        proposals: select("proposals", open.proposals, "id.desc"),
        invoices: select("invoices", open.invoices, "id.desc"),
        projects,
        milestones: select("milestones", { column: "project_id", op: "in", value: ids }, "position.asc"),
        deliverables: select("deliverables", { column: "project_id", op: "in", value: ids }, "position.asc"),
        enquiries: select("enquiries", open.enquiries, "received_at.desc"),
        messages: select("messages", open.messages, "due.asc"),
        clients: [] as Tables["clients"][],
      };
      const named = new Set([...snap.proposals, ...snap.invoices, ...snap.projects, ...snap.enquiries, ...snap.messages].map((r) => r.client_id));
      snap.clients = select("clients").filter((c) => named.has(c.id));
      return snap;
    },
    rows: async (ref, ids) => select(ref, { column: "id", op: "in", value: [...ids] }),
    where: async (ref, where, order, limit = 2000) => select(ref, where, order).slice(0, limit),
    async page<R extends TableRef>(ref: R, query: { where?: ListCondition; order?: string; limit: number; offset: number; count?: boolean }): Promise<Page<Tables[R]>> {
      const all = select(ref, query.where, query.order);
      return { rows: all.slice(query.offset, query.offset + query.limit), total: query.count === true ? all.length : null };
    },
    async search(text, limit) {
      const q = text.trim().toLowerCase();
      if (q === "") return [];
      const company = (id: unknown) => String(find("clients", id)?.["company"] ?? "") || null;
      const has = (...values: unknown[]) => values.some((v) => String(v ?? "").toLowerCase().includes(q));
      const hits: SearchHit[] = [
        ...rows.proposals.filter((r) => has(r["number"], r["title"])).map((r) => ({ table: "proposals" as const, id: r.id, label: String(r["number"] ?? ""), title: String(r["title"]), client: company(r["client_id"]) })),
        ...rows.invoices.filter((r) => has(r["number"], r["title"])).map((r) => ({ table: "invoices" as const, id: r.id, label: String(r["number"] ?? ""), title: String(r["title"] ?? ""), client: company(r["client_id"]) })),
        ...rows.projects.filter((r) => has(r["number"], r["name"])).map((r) => ({ table: "projects" as const, id: r.id, label: String(r["number"] ?? ""), title: String(r["name"]), client: company(r["client_id"]) })),
        ...rows.clients.filter((r) => has(r["company"], r["contact_name"])).map((r) => ({ table: "clients" as const, id: r.id, label: String(r["company"]), title: String(r["contact_name"]), client: null })),
      ];
      return hits.slice(0, limit);
    },
  };

  const writes: DeskWrites = {
    async insert(ref, values) {
      const key = values["client_key"];
      const earlier = typeof key === "string" ? rows[ref].find((r) => r["client_key"] === key) : undefined;
      // The step's own key already there: the row an earlier try saved.
      if (earlier !== undefined) return copy(earlier);
      const row = insertRow(ref, values);
      emit(ref, "record.create", row.id);
      return copy(row);
    },
    async update(ref, id, patch) {
      const row = updateRow(ref, id, patch);
      emit(ref, "record.update", id);
      return copy(row);
    },
    async remove(ref, id) {
      const at = rows[ref].findIndex((r) => r.id === id);
      if (at === -1) refuse(404, "NOT_FOUND");
      const row = rows[ref][at]!;
      if (ref === "proposal_lines") {
        const doc = find("proposals", row["document_id"]);
        if (doc !== undefined && doc["status"] !== "draft") refuse(409, "RECORD_LOCKED");
      }
      if (ref === "invoice_lines") {
        const doc = find("invoices", row["document_id"]);
        if (doc !== undefined && doc["status"] !== "draft") refuse(409, "RECORD_LOCKED");
      }
      rows[ref].splice(at, 1);
      settle();
      emit(ref, "record.delete", id);
    },
    async upload(_ref, _column, _file, filename) {
      return `demo-file:${filename}`;
    },
    async regenerateCode(ref, id, column) {
      const row = updateRow(ref, id, { [column]: Math.random().toString(36).slice(2, 10).toUpperCase().padEnd(16, "Z") });
      emit(ref, "record.update", id);
      return copy(row);
    },
    async saveAddOnSettings(_key, values) {
      return values;
    },
  };

  function portal(clientId: Id): PortalPort {
    let signedIn = true;
    const guard = () => {
      if (!signedIn) throw new PortError("PUBLIC_CLAIM_LEVEL", "signed out", 401);
    };
    const mine = (row: Row) => row["client_id"] === clientId;
    const visible: Partial<Record<TableRef, (row: Row) => boolean>> = {
      proposals: (r) => mine(r) && r["status"] !== "draft",
      invoices: (r) => mine(r) && (r["status"] === "sent" || (r["status"] === "void" && r["issued_on"] !== null)),
      payments: (r) => mine(r) && r["voided"] !== true,
      deliverables: (r) => mine(r) && r["status"] !== "unshared",
    };
    const own = (ref: TableRef) => (row: Row) => (visible[ref] ?? mine)(row);
    const write = <R extends TableRef>(ref: R, id: Id, patch: Record<string, unknown>, allowed: (row: Row) => boolean): Tables[R] => {
      guard();
      const row = find(ref, id);
      if (row === undefined || !own(ref)(row)) throw new PortError("PUBLIC_REF_NOT_FOUND", "not found", 404);
      if (!allowed(row)) throw new PortError("PUBLIC_WRITE_REFUSED", "refused", 403);
      const saved = updateRow(ref, id, patch);
      emit(ref, "record.update", id);
      return copy<R>(saved);
    };
    const inDate = (r: Row) => r["valid_until"] === null || String(r["valid_until"]) >= today();
    return {
      timeZone: () => zone,
      currency: () => "USD",
      signedIn: () => signedIn,
      requestLink: async () => undefined,
      peekLink: async (token) => (token === "demo" ? { firstName: String(find("clients", clientId)?.["contact_name"] ?? "").split(" ")[0] ?? "" } : null),
      verifyLink: async (token) => {
        if (token !== "demo") throw new PortError("LINK_EXPIRED", "expired", 410);
        signedIn = true;
      },
      verifyCode: async (_email, code) => {
        if (code === "000000") {
          signedIn = true;
          return { ok: true };
        }
        return { ok: false, triesLeft: 4 };
      },
      resendFromLink: async () => undefined,
      signOut: async () => {
        signedIn = false;
      },
      studio: async () => ({ settings: select("settings")[0] ?? null, people: select("people", { column: "shown_to_clients", op: "eq", value: true }, "position.asc"), briefQuestions: select("brief_questions", { column: "active", op: "eq", value: true }, "position.asc") }),
      me: async () => {
        guard();
        const c = find("clients", clientId);
        return { company: String(c?.["company"] ?? ""), contact_name: String(c?.["contact_name"] ?? "") };
      },
      list: async (ref, where, order, limit = 200) => {
        guard();
        const open = ref === "settings" || ref === "people" || ref === "brief_questions" || ref === "terms_versions" || ref === "terms_clauses";
        return sortRows(rows[ref].filter((r) => (open || own(ref)(r)) && matches(r, where)), order)
          .slice(0, limit)
          .map((r) => copy(r)) as never;
      },
      documentUrl: async () => "about:blank",
      fileUrl: (ref, id) => String(find(ref, id)?.["link"] ?? "about:blank"),
      accept: async (id, name) => write("proposals", id, { status: "accepted", signed_name: name, accepted_how: "portal", signed_email: find("clients", clientId)?.["email"] ?? null, signed_at: new Date(now()).toISOString() }, (r) => r["status"] === "sent" && inDate(r)),
      sign: async (id, name) => write("proposals", id, { signed_name: name, signed_at: new Date(now()).toISOString() }, (r) => r["status"] === "accepted" && r["signed_name"] === null && r["accepted_how"] !== "portal"),
      decline: async (id, note) => write("proposals", id, { status: "declined", decline_note: note }, (r) => r["status"] === "sent" && inDate(r)),
      askNewPrice: async (id) => write("proposals", id, { new_price_asked: true }, (r) => r["status"] === "sent" && !inDate(r) && r["new_price_asked_at"] === null),
      review: async (id, status, note) =>
        write("deliverables", id, status === "changes" ? { status, review_note: note } : { status, approved_how: "portal", approved_on: today(), approved_by: find("clients", clientId)?.["contact_name"] ?? null }, (r) => r["status"] === "pending"),
      addNote: async (note) => {
        guard();
        const row = insertRow("deliverable_notes", { ...note, side: "client", author: find("clients", clientId)?.["contact_name"] ?? null, at: new Date(now()).toISOString() });
        emit("deliverable_notes", "record.create", row.id);
        return copy<"deliverable_notes">(row);
      },
      saveAnswer: async (briefId, key, answer, existing) => {
        guard();
        if (existing !== null) return write("brief_answers", existing, { answer }, () => find("briefs", briefId)?.["status"] === "open");
        const row = insertRow("brief_answers", { brief_id: briefId, question_key: key, answer, first_answer: answer });
        emit("brief_answers", "record.create", row.id);
        return copy<"brief_answers">(row);
      },
      sendBrief: async (briefId) => write("briefs", briefId, { status: "sent" }, (r) => r["status"] === "open"),
      sentPayment: async (id, p) => write("invoices", id, { client_paid: true, client_paid_on: p.on, client_paid_amount: p.amount, client_paid_note: p.note }, (r) => r["status"] === "sent" && r["client_paid_at"] === null),
      openHandover: async (token): Promise<HandoverView> => {
        const project = rows.projects.find((p) => p["share_token"] === token && p["share_stopped"] !== true);
        if (project === undefined) throw new PortError("LINK_STOPPED", "stopped", 410);
        const deliverables = rows.deliverables.filter((d) => d["project_id"] === project.id && d["status"] === "approved");
        return {
          studio: select("settings")[0] ?? null,
          project: copy<"projects">(project),
          fonts: select("project_fonts", { column: "project_id", op: "eq", value: project.id }),
          files: select("handover_files", { column: "project_id", op: "eq", value: project.id }),
          deliverables: deliverables.map((d) => copy<"deliverables">(d)),
          versions: select("deliverable_versions", { column: "deliverable_id", op: "in", value: deliverables.map((d) => d.id) }),
        };
      },
    };
  }

  return {
    rows,
    reads,
    writes,
    portal,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
