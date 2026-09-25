/**
 * The sink and the step lists: what each answer from Adminium means for the
 * desk, and how an action that writes several rows finishes after a failure
 * at ANY of its steps without writing a row twice.
 */
import { describe, expect, it, vi } from "vitest";

import type { SessionTransport } from "./sessionSource.ts";
import { actionKey, newRun, runSteps, sessionSink, SinkError, StepFailure, stepKey, type Step } from "./sink.ts";
import { TABLE_OF_REF } from "./tableOfRef.ts";

function transport(mutate: SessionTransport["mutate"], found: Record<string, unknown>[] = []): SessionTransport {
  return {
    port: {
      config: async () => ({ side: "staff", timezone: "America/New_York", currency: "USD", refs: {} }),
      assertRefs: async () => undefined,
      list: vi.fn(async () => ({ data: found })) as never,
    },
    mutate,
    get: async () => ({}) as never,
    connection: async () => "conn-1",
    tableId: async (name) => name,
    relation: async () => "rel",
    refresh: vi.fn(async () => undefined),
  };
}
const fail = (status: number, code: string, details?: unknown) => Object.assign(new Error(code), { status, code, details });
const opts = { csrfToken: () => "tok" };

describe("the session sink", () => {
  it("writes to the real table, and answers with the row as the server decided it", async () => {
    const mutate = vi.fn(async () => ({ data: { id: 7, amount: "450.0000", voided: 0, number: "REC-0019" } }));
    const sink = sessionSink(transport(mutate as never), TABLE_OF_REF, opts);
    expect(await sink.insert("payments", { amount: "450.00", client_key: "k" })).toMatchObject({ id: 7, amount: "450.0000", voided: false, number: "REC-0019" });
    expect(mutate).toHaveBeenCalledWith("/api/v1/data/conn-1/clients_payments", "POST", { values: { amount: "450.00", client_key: "k" } });
  });

  it("reads a unique hit on the row's own action key as already saved, and answers with that row", async () => {
    const mutate = vi.fn(async () => {
      throw fail(409, "UNIQUE_VIOLATION", { column: "client_key" });
    });
    const t = transport(mutate as never, [{ id: 3, client_key: "k", amount: "10.00" }]);
    const sink = sessionSink(t, TABLE_OF_REF, opts);
    expect(await sink.insert("payments", { amount: "10.00", client_key: "k" })).toMatchObject({ id: 3, amount: "10.00" });
    expect(t.port.list).toHaveBeenCalledWith("payments", { limit: 1, offset: 0, where: { column: "client_key", op: "eq", value: "k" } });
  });

  it("refuses a unique clash that is not its own key (an address another client has)", async () => {
    const mutate = vi.fn(async () => {
      throw fail(409, "UNIQUE_VIOLATION", { column: "email" });
    });
    const sink = sessionSink(transport(mutate as never, [{ id: 3 }]), TABLE_OF_REF, opts);
    await expect(sink.insert("clients", { email: "a@b.example", client_key: "k" })).rejects.toMatchObject({ kind: "refused", code: "UNIQUE_VIOLATION", field: "email" });
    const noKey = sessionSink(transport(mutate as never, [{ id: 3 }]), TABLE_OF_REF, opts);
    await expect(noKey.insert("clients", { email: "a@b.example" })).rejects.toMatchObject({ kind: "refused" });
  });

  it("reads the server's refusals as refusals, with what they named", async () => {
    for (const [status, code, details] of [
      [409, "BALANCE_EXCEEDED", { column: "balance", balance: "15.00" }],
      [409, "RECORD_LOCKED", undefined],
      [409, "STATE_MOVE_REFUSED", { column: "status" }],
      [422, "DOCUMENT_EMPTY", undefined],
      [403, "COLUMN_FORBIDDEN", { column: "status" }],
    ] as const) {
      const sink = sessionSink(transport(vi.fn(async () => { throw fail(status, code, details); }) as never), TABLE_OF_REF, opts);
      const error = await sink.update("invoices", 1, { status: "sent" }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SinkError);
      expect(error).toMatchObject({ kind: "refused", code, status });
    }
  });

  it("stops for a sign-in on 401, and keeps trying on no answer, a 5xx, a rate limit or a lost lock race", async () => {
    for (const [status, code, kind] of [
      [401, "UNAUTHENTICATED", "signed-out"],
      [0, "NETWORK", "offline"],
      [503, "UNAVAILABLE", "offline"],
      [429, "RATE_LIMITED", "offline"],
      [409, "NUMBER_BUSY", "offline"],
    ] as const) {
      const sink = sessionSink(transport(vi.fn(async () => { throw fail(status, code); }) as never), TABLE_OF_REF, opts);
      await expect(sink.update("projects", 1, { status: "paused" })).rejects.toMatchObject({ kind });
    }
  });

  it("tries once more with a fresh token when the session's has rotated", async () => {
    let calls = 0;
    const mutate = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw fail(403, "CSRF_FAILED");
      return { data: { id: 1, status: "paused" } };
    });
    const t = transport(mutate as never);
    expect(await sessionSink(t, TABLE_OF_REF, opts).update("projects", 1, { status: "paused" })).toMatchObject({ status: "paused" });
    expect(t.refresh).toHaveBeenCalledTimes(1);
  });

  it("uploads a file for a row's column with the session's token, and answers the value to store", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: { id: "f1" }, ref: "file:f1" }), { status: 201 }));
    const sink = sessionSink(transport(vi.fn() as never), TABLE_OF_REF, { csrfToken: () => "tok", fetchImpl: fetchImpl as never });
    expect(await sink.upload("deliverable_versions", "file", new Blob(["x"], { type: "application/pdf" }), "logo v2.pdf")).toBe("file:f1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/files?filename=logo+v2.pdf&connectionId=conn-1&table=clients_deliverable_versions&column=file");
    expect(init).toMatchObject({ method: "POST", credentials: "same-origin", headers: { "x-adminium-csrf": "tok", "content-type": "application/pdf" } });
  });

  it("asks the server for a new share code, and saves the add-on's settings through its own route", async () => {
    const mutate = vi.fn(async () => ({ data: { id: 4, share_token: "SERVERMADECODE16" } }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ key: "invoices", values: { tax_name: "VAT" }, updatedAt: 1 }), { status: 200 }));
    const sink = sessionSink(transport(mutate as never), TABLE_OF_REF, { csrfToken: () => "tok", fetchImpl: fetchImpl as never });
    expect(await sink.regenerateCode("projects", 4, "share_token")).toMatchObject({ share_token: "SERVERMADECODE16" });
    expect(mutate).toHaveBeenCalledWith("/api/v1/data/conn-1/clients_projects/4/regenerate-code", "POST", { column: "share_token" });
    expect(await sink.saveAddOnSettings("invoices", { tax_name: "VAT" })).toEqual({ tax_name: "VAT" });
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/add-ons/invoices/settings", expect.objectContaining({ method: "PUT", body: JSON.stringify({ values: { tax_name: "VAT" } }) }));
  });
});

describe("the add-on's settings", () => {
  it("reads an add-on's stored values and declared keys from the add-ons' list, with no write token", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ addOns: [{ key: "other" }, { key: "invoices", settings: [{ key: "tax_name" }, { key: "default_terms" }], settingValues: { tax_name: "VAT", default_terms: "net14" } }] }), { status: 200 }),
    );
    const sink = sessionSink(transport(vi.fn() as never), TABLE_OF_REF, { csrfToken: () => "tok", fetchImpl: fetchImpl as never });
    expect(await sink.addOnSettings?.("invoices")).toEqual({ values: { tax_name: "VAT", default_terms: "net14" }, declared: ["tax_name", "default_terms"] });
    expect(await sink.addOnSettings?.("absent")).toBeNull();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/add-ons");
    expect(init).toMatchObject({ method: "GET", credentials: "same-origin" });
    expect(init.headers).not.toHaveProperty("x-adminium-csrf");
    expect(init).not.toHaveProperty("body");
  });
});

describe("action keys", () => {
  it("give every step its own 36-character key, the same on every retry", () => {
    const key = actionKey();
    expect(key).toHaveLength(36);
    expect(stepKey(key, "project")).toHaveLength(36);
    expect(stepKey(key, "project")).toBe(stepKey(key, "project"));
    expect(stepKey(key, "project")).not.toBe(stepKey(key, "milestone:0"));
    expect(stepKey(key, "project").slice(8)).toBe(key.slice(8));
  });
});

describe("a step list", () => {
  /** A fake table that refuses a second row with the same client_key, the way the unique index does. */
  function world() {
    const rows: { ref: string; values: Record<string, unknown>; id: number }[] = [];
    const writes: string[] = [];
    let failAt: string | null = null;
    const create = async (ref: string, values: Record<string, unknown>) => {
      writes.push(`${ref}:${String(values["name"] ?? values["title"] ?? "")}`);
      if (failAt === `${ref}:${String(values["name"] ?? values["title"] ?? "")}`) {
        failAt = null;
        throw new SinkError("no answer", "offline", 0, "NETWORK");
      }
      const clash = rows.find((r) => r.ref === ref && r.values["client_key"] === values["client_key"]);
      if (clash !== undefined) return { id: clash.id, ...clash.values, earlier: true };
      const row = { ref, values, id: rows.length + 1 };
      rows.push(row);
      return { id: row.id, ...values };
    };
    return { rows, writes, create, failOn: (at: string) => (failAt = at) };
  }
  const stepsFor = (w: ReturnType<typeof world>): Step[] => [
    { name: "project", run: (ctx) => w.create("projects", { name: "Rebrand", client_key: ctx.key }) },
    { name: "milestone:0", run: (ctx) => w.create("milestones", { title: "Discovery", project_id: ctx.result<{ id: number }>("project").id, client_key: ctx.key }) },
    { name: "milestone:1", run: (ctx) => w.create("milestones", { title: "Design", project_id: ctx.result<{ id: number }>("project").id, client_key: ctx.key }) },
    { name: "invoice", run: (ctx) => w.create("invoices", { title: "Deposit", client_key: ctx.key }) },
  ];

  it("runs every step in order, each row with its own key", async () => {
    const w = world();
    await runSteps(newRun("11111111-2222-4333-8444-555555555555"), stepsFor(w));
    expect(w.writes).toEqual(["projects:Rebrand", "milestones:Discovery", "milestones:Design", "invoices:Deposit"]);
    expect(new Set(w.rows.map((r) => r.values["client_key"])).size).toBe(4);
  });

  const ORDER = ["projects:Rebrand", "milestones:Discovery", "milestones:Design", "invoices:Deposit"];
  for (const at of ORDER) {
    it(`finishes after a failure at ${at}, writing nothing twice`, async () => {
      const w = world();
      const run = newRun();
      w.failOn(at);
      const first = await runSteps(run, stepsFor(w)).catch((e: unknown) => e);
      expect(first).toBeInstanceOf(StepFailure);
      expect((first as StepFailure).cause.kind).toBe("offline");
      expect((first as StepFailure).finished).toBe(ORDER.indexOf(at));
      await runSteps(run, stepsFor(w));
      expect(w.rows.map((r) => `${r.ref}:${String(r.values["name"] ?? r.values["title"])}`)).toEqual(["projects:Rebrand", "milestones:Discovery", "milestones:Design", "invoices:Deposit"]);
      // The retry started at the failed step: the ones before it were not sent again.
      expect(w.writes.filter((x) => x === "projects:Rebrand")).toHaveLength(at === "projects:Rebrand" ? 2 : 1);
    });
  }

  it("after a reload (nothing remembered), a unique hit on each step's own key reads as already saved", async () => {
    const w = world();
    const key = actionKey();
    w.failOn("invoices:Deposit");
    await runSteps(newRun(key), stepsFor(w)).catch(() => undefined);
    const again = await runSteps(newRun(key), stepsFor(w));
    expect(w.rows).toHaveLength(4);
    expect(again["project"]).toMatchObject({ id: 1, earlier: true });
    expect(again["invoice"]).toMatchObject({ id: 4 });
  });

  it("refuses two steps with one name, and a step that reads a result that is not there", async () => {
    await expect(runSteps(newRun(), [{ name: "a", run: async () => 1 }, { name: "a", run: async () => 2 }])).rejects.toThrow(/two steps/);
    await expect(runSteps(newRun(), [{ name: "b", run: async (ctx) => ctx.result("a") }])).rejects.toBeInstanceOf(StepFailure);
  });
});
