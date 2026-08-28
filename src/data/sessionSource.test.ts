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

import { createSessionTransport, SessionPortError, sessionPort } from "./sessionSource.ts";

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  credentials: string | undefined;
}

function harness(routes: Record<string, unknown>, opts: { conns?: unknown[] } = {}) {
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
    if (path === "/api/v1/bootstrap") payload = { data: { csrfToken: "csrf-abc" } };
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

  it("falls back to UTC and FLAGS it when the connection has no timezone", async () => {
    /*
     * This asserted a `NO_TIMEZONE` refusal until a real operator hit it: an
     * unset zone made the whole surface unreachable. Rendering an hour off is
     * recoverable; rendering nothing is not.
     *
     * The two things that must both hold are asserted together, because either
     * alone is a bug: the app RENDERS, and it does not pretend the zone is real.
     */
    const { fetchImpl } = harness({}, { conns: [{ id: "conn-1" }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const config = await port.config();
    expect(config.timezone).toBe("UTC");
    expect(config.timezoneSource).toBe("fallback");
  });

  it("never falls back to the READER's zone", async () => {
    // The original concern, kept: a browser zone is the viewer's, not the
    // business's, and is indistinguishable from real data when wrong.
    const { fetchImpl } = harness({}, { conns: [{ id: "conn-1" }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const reader = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const config = await port.config();
    if (reader !== "UTC") expect(config.timezone).not.toBe(reader);
  });

  it("does not flag a zone the operator actually set", async () => {
    const { fetchImpl } = harness({}, { conns: [{ id: "conn-1", timezone: "Europe/Lisbon", timezoneSource: "operator" }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    expect((await port.config()).timezoneSource).toBe("operator");
  });

  it("reports a zone Adminium seeded from its own server as unconfirmed", async () => {
    /*
     * The more dangerous of the two unconfirmed states, and the reason this
     * exists at all: UTC announces itself, while a plausible wrong city does
     * not. Adminium labels its own seed (meta wave 0018) and this is where that
     * label becomes something a person can see.
     */
    const { fetchImpl } = harness(
      {},
      { conns: [{ id: "conn-1", timezone: "Europe/Berlin", timezoneSource: "host" }] },
    );
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const config = await port.config();
    // The zone is USED — this is a notice, not a refusal or a substitution.
    expect(config.timezone).toBe("Europe/Berlin");
    expect(config.timezoneSource).toBe("host");
  });

  it("claims nothing when Adminium sends no provenance", async () => {
    /*
     * An older Adminium, or a row written before the provenance column. Absent
     * must read as "no claim": reporting it as a guess would tell an operator
     * their own confirmed zone was invented.
     */
    const { fetchImpl } = harness({}, { conns: [{ id: "conn-1", timezone: "Europe/Lisbon" }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const config = await port.config();
    expect(config.timezone).toBe("Europe/Lisbon");
    expect(config.timezoneSource).toBeNull();
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

  it("pausing the spare connection resolves the ambiguity", async () => {
    /*
     * The operator-facing point of the whole filter. Pausing a connection is
     * the obvious way to say "not that one", and it used to do nothing at all:
     * the count included paused rows, so the refusal fired anyway and the app
     * stayed unreachable no matter what was clicked in Studio.
     */
    const { fetchImpl } = harness(
      {},
      {
        conns: [
          { id: "a", timezone: "Europe/Lisbon", timezoneSource: "operator" },
          { id: "b", disabled: true },
        ],
      },
    );
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const config = await port.config();
    // Not merely "no error" — it must read the SERVING one.
    expect(config.timezone).toBe("Europe/Lisbon");
  });

  it("still refuses when two connections are actually serving", async () => {
    const { fetchImpl } = harness({}, { conns: [{ id: "a" }, { id: "b", disabled: false }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.config()).rejects.toMatchObject({ code: "AMBIGUOUS_CONNECTION" });
  });

  it("treats a connection with no `disabled` field as serving", async () => {
    // An older Adminium sends no such field. Absent must not read as paused,
    // or every app would refuse against a server that predates the column.
    const { fetchImpl } = harness({}, { conns: [{ id: "a" }, { id: "b" }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.config()).rejects.toMatchObject({ code: "AMBIGUOUS_CONNECTION" });
  });

  it("says the connection is PAUSED rather than missing when it is", async () => {
    /*
     * These two are one click apart and their fixes are opposite. "No
     * connection is configured" sends an operator to the connect wizard while
     * a paused one sits right there, which is how an instance ends up with two
     * connections to the same database.
     */
    const { fetchImpl } = harness({}, { conns: [{ id: "a", name: "Studio DB", disabled: true }] });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    await expect(port.config()).rejects.toMatchObject({ code: "CONNECTION_PAUSED" });
    await expect(port.config()).rejects.toThrow(/Studio DB/);
  });

  it("refuses early when the PINNED connection is paused", async () => {
    // The server would refuse the data reads anyway, but only after this app
    // had reported a working connection — the failure would arrive as a broken
    // screen rather than as the one sentence that explains it.
    const { fetchImpl } = harness({}, { conns: [{ id: "conn-9", disabled: true }] });
    const port = sessionPort({ tableOfRef: MAP, connectionId: "conn-9", fetchImpl });
    await expect(port.config()).rejects.toMatchObject({ code: "CONNECTION_PAUSED" });
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

  it("points at a PAUSED connection when the schema does not match", async () => {
    /*
     * The live case this exists for: an operator with two connections pauses
     * one to disambiguate, picks the app's OWN database by mistake, and gets a
     * wall of missing-table names describing the other one. The tables really
     * are absent — the report is true and useless. The cause is one click away
     * in Studio and only this app knows enough to point at it.
     */
    const { fetchImpl } = harness(SCHEMA_OK, {
      conns: [
        { id: "conn-1", timezone: "Europe/Lisbon", timezoneSource: "operator" },
        { id: "conn-2", name: "c_client_portal", disabled: true },
      ],
    });
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const err = await port
      .assertRefs({ invoices: ["id"] })
      .catch((e: unknown) => e as SessionPortError);

    const message = (err as SessionPortError).message;
    // The symptom is still reported in full — the hint is added, not swapped in.
    expect(message).toContain('table "invoices" is absent');
    expect(message).toContain("c_client_portal is paused in Adminium");
    expect(message).toContain("resume it in Connections");
  });

  it("adds no paused hint when nothing is paused", async () => {
    // The hint must earn its place: on a one-connection instance it would be
    // noise appended to every schema error an operator ever sees.
    const { fetchImpl } = harness(SCHEMA_OK);
    const port = sessionPort({ tableOfRef: MAP, fetchImpl });
    const err = await port
      .assertRefs({ invoices: ["id"] })
      .catch((e: unknown) => e as SessionPortError);

    expect((err as SessionPortError).message).not.toContain("paused in Adminium");
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
});
