/**
 * The same-origin session transport, against canned wire responses.
 *
 * THE FIXTURES BELOW ARE COPIED FROM A LIVE SERVER, not written from the route
 * handlers. An earlier version inferred them and got three of four envelopes
 * wrong — `connections` is not under `data`, the schema is under `model`, and
 * `csrfToken` is under `data` — and every test still passed, because the port
 * and the fixture shared one wrong assumption. Change a fixture only against a
 * real response.
 *
 * These assert the CONTRACT with `apps/server`, so every URL, header and
 * envelope shape below is copied from the server rather than invented:
 * `/api/v1/bootstrap` (csrfToken), `/api/v1/connections`,
 * `/api/v1/connections/:id/schema`, `/api/v1/data/:conn/:table`, and
 * `x-adminium-csrf` from `apps/server/src/security/csrf.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import { createSessionTransport, rateLimitWait, SessionPortError, sessionPort } from "./sessionSource.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  credentials: string | undefined;
}

function harness(routes: Record<string, unknown>, opts: { conns?: unknown[]; bootstrap?: () => unknown } = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: (init?.method ?? "GET").toUpperCase(),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body as string | undefined,
      credentials: init?.credentials,
    });

    const path = url.split("?")[0] ?? url;
    let payload: unknown;
    if (path === "/api/v1/bootstrap") payload = opts.bootstrap?.() ?? { data: { csrfToken: "csrf-abc" } };
    else if (path === "/api/v1/connections")
      payload = { connections: opts.conns ?? [{ id: "conn-1", name: "Studio DB", timezone: "Europe/Lisbon", currency: "EUR" }] };
    else if (path in routes) payload = routes[path];
    else return new Response(JSON.stringify({ error: { code: "NOT_FOUND" } }), { status: 404 });

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  return { calls, fetchImpl: fetchImpl as unknown as typeof fetch };
}

/* `invoices` is mapped but ABSENT from SCHEMA_OK on purpose: the two failures
   assertRefs must distinguish are "this ref has no table mapping" and "the
   mapped table is not in the database", and only a mapped-but-missing table
   exercises the second. */
const MAP = {
  clients: "clients",
  proposalItems: "proposal_items",
  payments: "payments",
  invoices: "invoices",
} as const;

const SCHEMA_OK = {
  "/api/v1/connections/conn-1/schema": {
    model: {
      tables: [
        { name: "clients", columns: [{ name: "id" }, { name: "company" }] },
        { name: "proposal_items", columns: [{ name: "id" }, { name: "proposal_id" }] },
      ],
    },
  },
};

describe("discovery", () => {
  it("reads bootstrap then connections, and reports itself as staff", async () => {
    const { calls, fetchImpl } = harness({});
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const config = await port.config();

    expect(config).toMatchObject({ side: "staff", timezone: "Europe/Lisbon", currency: "EUR" });
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/bootstrap", "/api/v1/connections"]);
    // Cookies are the whole point — a request without them is anonymous.
    expect(calls.every((c) => c.credentials === "same-origin")).toBe(true);
  });

  it("takes the tenant timezone from the CONNECTION, never the reader's clock", async () => {
    const { fetchImpl } = harness({});
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    expect((await port.config()).timezone).toBe("Europe/Lisbon");
  });

  it("falls back to UTC, and says so, when the connection has no timezone", async () => {
    // Refusing turned out worse than a default the app can SEE: the fleet now
    // renders in the server's zone (or UTC from an older server) and flags it,
    // never in the reader's.
    const { fetchImpl } = harness({}, { conns: [{ id: "conn-1" }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.config()).resolves.toMatchObject({ timezone: "UTC", timezoneSource: "fallback" });
  });

  it("an explicit option overrides the connection", async () => {
    const { fetchImpl } = harness({});
    const port = sessionPort({ tableOfRef: MAP, timezone: "Asia/Tokyo", fetchImpl });
    expect((await port.config()).timezone).toBe("Asia/Tokyo");
  });

  it("refuses rather than guesses when several connections exist", async () => {
    const { fetchImpl } = harness({}, { conns: [{ id: "a" }, { id: "b" }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.config()).rejects.toMatchObject({ code: "AMBIGUOUS_CONNECTION" });
  });

  it("names the fix when no connection is configured", async () => {
    const { fetchImpl } = harness({}, { conns: [] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.config()).rejects.toMatchObject({ code: "NO_CONNECTION" });
  });

  it("honours an explicit connectionId but still reads its tenant config", async () => {
    // It used to skip the connection lookup entirely on a pinned id, which
    // also skipped the timezone — a port that worked until it had to render a
    // date. The list is cheap and carries both facts.
    const { calls, fetchImpl } = harness(
      {},
      { conns: [{ id: "conn-9", timezone: "Asia/Tokyo" }] },
    );
    const port = sessionPort({ tableOfRef: MAP, connectionId: "conn-9", fetchImpl });
    expect((await port.config()).timezone).toBe("Asia/Tokyo");
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/bootstrap", "/api/v1/connections"]);
  });
});

describe("reads", () => {
  it("maps a camelCase ref to its real table and caps limit at the route's 200", async () => {
    const { calls, fetchImpl } = harness({
      "/api/v1/data/conn-1/proposal_items": { data: [{ id: 1 }] },
    });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const res = await port.list("proposalItems", { limit: 500, offset: 40 });

    expect(res.data).toEqual([{ id: 1 }]);
    const read = calls.at(-1)!;
    expect(read.url).toBe("/api/v1/data/conn-1/proposal_items?limit=200&offset=40");
    // A read must never carry the CSRF token; the server does not check GET.
    expect(read.headers["x-adminium-csrf"]).toBeUndefined();
  });

  it("refuses an unknown ref instead of building a nonsense URL", async () => {
    const { fetchImpl } = harness({});
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.list("nope", { limit: 10, offset: 0 })).rejects.toMatchObject({
      code: "UNKNOWN_REF",
    });
  });

  it("surfaces the server's own error code, not a generic failure", async () => {
    const { fetchImpl } = harness({});
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    // `clients` is not in `routes`, so the harness 404s it.
    await expect(port.list("clients", { limit: 10, offset: 0 })).rejects.toBeInstanceOf(
      SessionPortError,
    );
  });
});

describe("assertRefs", () => {
  it("passes when the schema carries every column", async () => {
    const { fetchImpl } = harness(SCHEMA_OK);
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.assertRefs({ clients: ["id", "company"] })).resolves.toBeUndefined();
  });

  it("reports EVERY problem at once, not the first", async () => {
    const { fetchImpl } = harness(SCHEMA_OK);
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const err = await port
      .assertRefs({ clients: ["id", "vat_number"], invoices: ["id"] })
      .catch((e: unknown) => e as SessionPortError);

    expect(err).toBeInstanceOf(SessionPortError);
    expect((err as SessionPortError).code).toBe("SCHEMA_MISMATCH");
    expect((err as SessionPortError).message).toContain("vat_number");
    expect((err as SessionPortError).message).toContain('table "invoices" is absent');
  });
});

describe("writes", () => {
  it("carries the session-bound CSRF token captured during config()", async () => {
    const { calls, fetchImpl } = harness({ "/api/v1/data/conn-1/payments": { data: { id: 7 } } });
    const t = createSessionTransport({ tableOfRef: MAP, fetchImpl });
    await t.port.config();
    await t.mutate("/api/v1/data/conn-1/payments", "POST", { values: { amount: 100 } });

    const write = calls.at(-1)!;
    expect(write.method).toBe("POST");
    expect(write.headers["x-adminium-csrf"]).toBe("csrf-abc");
    expect(write.credentials).toBe("same-origin");
    expect(write.body).toBe(JSON.stringify({ values: { amount: 100 } }));
  });

  it("refuses a write before config(), rather than sending a tokenless one", async () => {
    const { fetchImpl } = harness({});
    const t = createSessionTransport({ tableOfRef: MAP, fetchImpl });
    await expect(t.mutate("/api/v1/data/conn-1/payments", "POST", {})).rejects.toMatchObject({
      code: "CSRF_TOKEN_MISSING",
    });
  });

  it("names the connection a write goes to", async () => {
    const { fetchImpl } = harness({});
    const t = createSessionTransport({ tableOfRef: MAP, fetchImpl });
    await expect(t.connection()).resolves.toBe("conn-1");
  });

  it("finds the link a child row is written through, by its table and column", async () => {
    const { calls, fetchImpl } = harness({
      "/api/v1/connections/conn-1/schema": {
        model: {
          tables: [
            { id: "public.invoices", name: "invoices" },
            { id: "public.payments", name: "payments" },
          ],
          relations: [
            { id: "rel-pay", through: null, from: { tableId: "public.payments", columns: ["invoice_id"] }, to: { tableId: "public.invoices" } },
          ],
        },
      },
    });
    const t = createSessionTransport({ tableOfRef: MAP, fetchImpl });
    await expect(t.relation("payments", "invoice_id")).resolves.toBe("rel-pay");
    // The schema is read once, however many links are asked about.
    await expect(t.relation("payments", "note_id")).rejects.toMatchObject({ code: "SCHEMA_MISMATCH" });
    await expect(t.tableId("payments")).resolves.toBe("public.payments");
    expect(calls.filter((c) => c.url.endsWith("/schema"))).toHaveLength(1);
  });

  it("boots from the staff config, reading neither the bootstrap nor the connections list", async () => {
    const { calls, fetchImpl } = harness({ "/api/v1/data/conn-1/payments": { data: [] } });
    const t = createSessionTransport({
      tableOfRef: MAP,
      connectionId: "conn-1",
      staff: { csrfToken: "staff-token", timezone: "Europe/Lisbon", timezoneSource: "operator", currency: "EUR" },
      refreshToken: async () => "staff-token-2",
      fetchImpl,
    });
    await expect(t.port.config()).resolves.toMatchObject({ timezone: "Europe/Lisbon", timezoneSource: "operator", currency: "EUR" });
    await t.mutate("/api/v1/data/conn-1/payments", "POST", { values: {} });
    expect(calls.at(-1)!.headers["x-adminium-csrf"]).toBe("staff-token");
    await t.refresh();
    await t.mutate("/api/v1/data/conn-1/payments", "POST", { values: {} });
    expect(calls.at(-1)!.headers["x-adminium-csrf"]).toBe("staff-token-2");
    expect(calls.some((c) => c.url.startsWith("/api/v1/bootstrap") || c.url.startsWith("/api/v1/connections"))).toBe(false);
  });

  it("reads only the rows asked for, in the order asked", async () => {
    const { calls, fetchImpl } = harness({ "/api/v1/data/conn-1/payments": { data: [] } });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await port.list("payments", {
      limit: 50,
      offset: 0,
      where: { and: [{ column: "status", op: "in", value: ["open", "sent"] }, { column: "ended_at", op: "is_null" }] },
      order: "opened_at.desc",
    });
    const url = new URL(calls.at(-1)!.url, "http://x");
    expect(JSON.parse(url.searchParams.get("where")!)).toEqual({
      and: [{ column: "status", op: "in", value: ["open", "sent"] }, { column: "ended_at", op: "is_null" }],
    });
    expect(url.searchParams.get("order")).toBe("opened_at.desc");
  });

  it("counts every matching row only when asked, and reports an absent count as null", async () => {
    const { calls, fetchImpl } = harness({
      "/api/v1/data/conn-1/payments": { data: [{ id: 1 }], page: { limit: 20, offset: 0, total: 31 } },
    });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const counted = await port.list("payments", {
      limit: 20,
      offset: 0,
      where: { column: "name", op: "ilike", value: "%ann%" },
      count: true,
    });
    expect(counted).toEqual({ data: [{ id: 1 }], total: 31 });
    expect(new URL(calls.at(-1)!.url, "http://x").searchParams.get("count")).toBe("exact");

    const plain = await port.list("payments", { limit: 20, offset: 0 });
    // Not asked: no count on the wire and none in the answer (never a guessed 0).
    expect(plain).toEqual({ data: [{ id: 1 }] });
    expect(new URL(calls.at(-1)!.url, "http://x").searchParams.has("count")).toBe(false);
  });

  it("reads a route the port has no method for through the same session, without the write token", async () => {
    const { calls, fetchImpl } = harness({
      "/api/v1/data/conn-1/payments/booking-slots": { data: [{ time: "09:00", state: "free" }] },
    });
    const t = createSessionTransport({ tableOfRef: MAP, fetchImpl });
    const reply = await t.get<{ data: unknown[] }>("/api/v1/data/conn-1/payments/booking-slots?date=2026-07-28");
    expect(reply.data).toEqual([{ time: "09:00", state: "free" }]);
    const read = calls.at(-1)!;
    expect(read.method).toBe("GET");
    expect(read.headers["x-adminium-csrf"]).toBeUndefined();
    await expect(t.get("/api/v1/nowhere")).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("takes a fresh token after a write was refused for an old one", async () => {
    let token = "csrf-abc";
    const { calls, fetchImpl } = harness({ "/api/v1/data/conn-1/payments": { data: { id: 7 } } }, {
      bootstrap: () => ({ data: { csrfToken: token } }),
    });
    const t = createSessionTransport({ tableOfRef: MAP, fetchImpl });
    await t.port.config();
    token = "csrf-new";
    await t.refresh();
    await t.mutate("/api/v1/data/conn-1/payments", "POST", { values: {} });
    expect(calls.at(-1)!.headers["x-adminium-csrf"]).toBe("csrf-new");
  });
});

describe("a request refused for rate (429)", () => {
  /** The harness, with the first `times` requests to `path` refused for rate. */
  function limited(path: string, times: number, retryAfter: string | null = "3") {
    const inner = harness({ "/api/v1/data/conn-1/payments": { data: { id: 7 } } });
    let refused = 0;
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input).split("?")[0];
      if (url === path && refused < times) {
        refused += 1;
        inner.calls.push({ url, method: (init?.method ?? "GET").toUpperCase(), headers: {}, body: undefined, credentials: undefined });
        return new Response(JSON.stringify({ error: { code: "RATE_LIMITED", message: "Too many requests. Try again in 3 seconds." } }), {
          status: 429,
          headers: retryAfter === null ? {} : { "retry-after": retryAfter },
        });
      }
      return inner.fetchImpl(input as RequestInfo, init);
    }) as typeof fetch;
    const waits: number[] = [];
    const sleep = async (ms: number) => {
      waits.push(ms);
    };
    return { calls: inner.calls, fetchImpl, sleep, waits };
  }

  it("reads again after what Retry-After asks, and the desk opens", async () => {
    const { fetchImpl, sleep, waits, calls } = limited("/api/v1/connections", 1);
    const port = sessionPort({ tableOfRef: MAP, fetchImpl, sleep });
    await expect(port.config()).resolves.toMatchObject({ timezone: "Europe/Lisbon" });
    expect(waits).toEqual([3000]);
    expect(calls.filter((c) => c.url === "/api/v1/connections")).toHaveLength(2);
  });

  it("gives up after two more tries, with the server's own refusal", async () => {
    const { fetchImpl, sleep, waits } = limited("/api/v1/connections", 5, null);
    const port = sessionPort({ tableOfRef: MAP, fetchImpl, sleep });
    await expect(port.config()).rejects.toMatchObject({ status: 429, code: "RATE_LIMITED" });
    // No usable Retry-After: the default wait, twice.
    expect(waits).toEqual([5000, 5000]);
  });

  it("never repeats a write: the person sees it refused and decides", async () => {
    const { fetchImpl, sleep, waits, calls } = limited("/api/v1/data/conn-1/payments", 1);
    const t = createSessionTransport({ tableOfRef: MAP, fetchImpl, sleep });
    await t.port.config();
    await expect(t.mutate("/api/v1/data/conn-1/payments", "POST", { values: {} })).rejects.toMatchObject({ status: 429 });
    expect(waits).toEqual([]);
    expect(calls.filter((c) => c.url === "/api/v1/data/conn-1/payments")).toHaveLength(1);
  });

  it("caps a long Retry-After, and reads a bad one as the default", () => {
    expect(rateLimitWait("15")).toBe(15_000);
    expect(rateLimitWait("3600")).toBe(30_000);
    expect(rateLimitWait("soon")).toBe(5_000);
    expect(rateLimitWait(null)).toBe(5_000);
  });
});
