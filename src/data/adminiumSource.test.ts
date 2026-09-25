/**
 * The desk's read set: what it asks Adminium for at boot, by the tables' real
 * names, and that every read is bounded — nothing reads a whole history.
 */
import { describe, expect, it } from "vitest";

import { DECIDED_DAYS, MOST, PAGE, sessionDeskReads } from "./adminiumSource.ts";
import { createSessionTransport } from "./sessionSource.ts";
import { realTables } from "./tableOfRef.ts";

interface Call {
  table: string;
  limit: number;
  offset: number;
  where: unknown;
  order: string | null;
  count: boolean;
}

/** A staff transport over a fake Adminium that answers each table with `rows[table]`. */
function fake(rows: Record<string, Record<string, unknown>[]> = {}, tables: Record<string, string> = {}) {
  const calls: Call[] = [];
  const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input), "http://x");
    const table = decodeURIComponent(url.pathname.split("/").pop()!);
    const where = url.searchParams.get("where");
    const call: Call = {
      table,
      limit: Number(url.searchParams.get("limit")),
      offset: Number(url.searchParams.get("offset")),
      where: where === null ? null : JSON.parse(where),
      order: url.searchParams.get("order"),
      count: url.searchParams.get("count") === "exact",
    };
    calls.push(call);
    const data = (rows[table] ?? []).slice(call.offset, call.offset + call.limit);
    return new Response(JSON.stringify({ data, page: { total: (rows[table] ?? []).length } }), { status: 200 });
  };
  const tableOf = realTables(tables);
  const transport = createSessionTransport({ tableOfRef: tableOf, connectionId: "conn-1", staff: { csrfToken: "tok", timezone: "America/New_York", currency: "USD" }, fetchImpl: fetchImpl as never });
  return { calls, reads: sessionDeskReads(transport) };
}

describe("the desk's boot read set", () => {
  it("reads the studio's set-up and the open work, by the tables' real names, every read bounded", async () => {
    const { calls, reads } = fake({}, { invoices: "studio7_invoices" });
    const snap = await reads.snapshot("2026-07-28", "America/New_York");
    expect(snap.today).toBe("2026-07-28");
    const tables = calls.map((c) => c.table);
    for (const t of ["clients_settings", "clients_people", "clients_rates", "clients_terms_versions", "clients_brief_questions", "clients_proposals", "studio7_invoices", "clients_projects", "clients_enquiries", "clients_messages"]) {
      expect(tables).toContain(t);
    }
    expect(tables).not.toContain("clients_invoices");
    for (const call of calls) expect(call.limit).toBeLessThanOrEqual(PAGE);
    // Nothing reads a history: every list of work is filtered.
    const whereOf = (t: string) => calls.find((c) => c.table === t)!.where;
    expect(whereOf("clients_proposals")).toEqual({
      or: [{ column: "status", op: "in", value: ["draft", "sent"] }, { column: "decided_at", op: "gte", value: expect.stringMatching(/^2026-04-29T0[45]:00:00.000Z$/) }],
    });
    expect(whereOf("studio7_invoices")).toEqual({ or: [{ column: "status", op: "eq", value: "draft" }, { and: [{ column: "status", op: "eq", value: "sent" }, { column: "balance", op: "gt", value: 0 }] }] });
    expect(whereOf("clients_projects")).toEqual({ column: "status", op: "in", value: ["active", "paused"] });
    expect(whereOf("clients_enquiries")).toEqual({ column: "status", op: "in", value: ["new", "parked"] });
    expect(whereOf("clients_messages")).toEqual({ column: "status", op: "eq", value: "held" });
    expect(DECIDED_DAYS).toBe(90);
  });

  it("reads the milestones, deliverables and clients the open work names — and only those", async () => {
    const { calls, reads } = fake({
      clients_projects: [{ id: 4, client_id: 2, status: "active", name: "Rebrand" }],
      clients_invoices: [{ id: 9, client_id: 3, status: "sent", balance: "100.00" }],
      clients_clients: [
        { id: 2, company: "Hearth & Co" },
        { id: 3, company: "Fold & Rule" },
      ],
    });
    const snap = await reads.snapshot("2026-07-28", "America/New_York");
    expect(calls.find((c) => c.table === "clients_milestones")!.where).toEqual({ column: "project_id", op: "in", value: [4] });
    expect(calls.find((c) => c.table === "clients_deliverables")!.where).toEqual({ column: "project_id", op: "in", value: [4] });
    expect(calls.find((c) => c.table === "clients_clients")!.where).toEqual({ column: "id", op: "in", value: [3, 2] });
    expect(snap.invoices[0]).toMatchObject({ id: 9, balance: "100.00" });
  });

  it("pages a long list of open work, and stops at the most it will ever read", async () => {
    const many = Array.from({ length: MOST + 50 }, (_, i) => ({ id: i + 1, status: "draft", client_id: null }));
    const { calls, reads } = fake({ clients_proposals: many });
    const snap = await reads.snapshot("2026-07-28", "UTC");
    expect(snap.proposals).toHaveLength(MOST);
    expect(calls.filter((c) => c.table === "clients_proposals")).toHaveLength(MOST / PAGE);
  });
});

describe("the desk's other reads", () => {
  it("reads one page of a list with a count, and rows by key in chunks", async () => {
    const { calls, reads } = fake({ clients_invoices: [{ id: 1, status: "sent" }] });
    const page = await reads.page("invoices", { where: { column: "status", op: "eq", value: "sent" }, order: "id.desc", limit: 500, offset: 20, count: true });
    expect(page.total).toBe(1);
    expect(calls[0]).toMatchObject({ table: "clients_invoices", limit: PAGE, offset: 20, order: "id.desc", count: true });
    await reads.rows("payments", Array.from({ length: 150 }, (_, i) => i + 1));
    expect(calls.filter((c) => c.table === "clients_payments")).toHaveLength(2);
  });

  it("searches documents by number or title and clients by name, naming each document's client", async () => {
    const { calls, reads } = fake({
      clients_invoices: [{ id: 5, number: "INV-2039", title: "Rebrand — deposit", client_id: 2 }],
      clients_clients: [{ id: 2, company: "Hearth & Co", contact_name: "Amara Osei" }],
    });
    const hits = await reads.search("2039", 7);
    expect(hits).toContainEqual({ table: "invoices", id: 5, label: "INV-2039", title: "Rebrand — deposit", client: "Hearth & Co" });
    expect(calls.find((c) => c.table === "clients_invoices")!.where).toEqual({ or: [{ column: "number", op: "ilike", value: "%2039%" }, { column: "title", op: "ilike", value: "%2039%" }] });
    expect(await reads.search("  ", 7)).toEqual([]);
  });
});
