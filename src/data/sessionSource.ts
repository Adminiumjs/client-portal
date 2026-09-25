/**
 * The SAME-ORIGIN transport: this app served BY Adminium, reading through the
 * operator's own session instead of a publishable key.
 *
 * ─── What this is for ────────────────────────────────────────────────────────
 *
 * A standalone build talks to `/api/v1/public/*` with an `adm_pub_` key. That
 * key is a NON-PRINCIPAL: it consults no roles, and what it may reach is fixed
 * by a scope an operator wrote. Correct for a customer storefront, wrong for a
 * staff console: these apps read every customer's records, and the guard in
 * `adminiumSource.ts` says so out loud by refusing a customer-side scope.
 *
 * Hosted at Adminium's own origin under `/apps/<key>/staff/`, none of that is
 * needed. The browser already holds the operator's session cookie, so this
 * transport reads `/api/v1/data/:connectionId/:table` exactly as the dashboard
 * does — same session, same RBAC, no key to mint, no scope to keep in sync, no
 * CORS allowance. That is the whole argument for hosting, reduced to a file.
 *
 * ─── Three facts about the wire, all verified against the server ─────────────
 *
 * 1. CSRF has two legs. Leg A (Origin / `Sec-Fetch-Site`) passes for free here
 *    — same origin is the point. Leg B is a session-bound token handed out by
 *    `GET /api/v1/bootstrap` and echoed in `x-adminium-csrf` on every mutation.
 *    Reads never carry it; `mutate()` below always does.
 * 2. `limit` caps at 200 on this route, not the public API's 500.
 *    `apps/server/src/routes/data/schema.ts` — paging is not optional.
 * 3. `credentials: 'same-origin'` is required. `fetch` omits cookies from
 *    cross-origin requests by default and this file must never be used
 *    cross-origin anyway; stating it makes the same-origin assumption explicit
 *    rather than accidental.
 *
 * ─── Where the tenant's timezone comes from ─────────────────────────────────
 *
 * The CONNECTION carries it (28-T34). This transport already fetches
 * `/api/v1/connections` to discover which database the app reads, so the zone
 * arrives on the same response with no extra request and nothing to configure
 * in the build.
 *
 * It was a build argument until 28-T34, which made a property of the BUSINESS a
 * property of the artifact: changing your timezone meant rebuilding the front
 * end. The one answer that is always wrong is
 * `Intl.DateTimeFormat().resolvedOptions().timeZone` — that is the READER's
 * zone, not the business's, and it fails silently by an hour. This module never
 * guesses the reader's zone: no zone on the connection means UTC, flagged, so
 * the app can say so on screen (see the fallback in `config()`).
 */

import type { ListOptions, SnapshotPort } from "./snapshotPort.ts";

/**
 * Ref name → table name.
 *
 * Supplied by the caller rather than hardcoded here, because it is the ONLY
 * part of this transport that differs between apps: every other line — the CSRF
 * dance, the connection discovery, the schema assertion, the paging cap — is
 * the same wire in all fifteen. Passing it in is what lets this file be synced
 * byte-identically instead of hand-copied fifteen times and drifting.
 */
export type TableOfRef = Readonly<Record<string, string>>;

/** `apps/server/src/security/csrf.ts` — leg B's header. */
const CSRF_HEADER = "x-adminium-csrf";

/** `apps/server/src/routes/data/schema.ts` — `limit` is `.max(200)`. */
const PAGE_MAX = 200;

export interface SessionPortOptions {
  /** Ref → table. See {@link TableOfRef}. */
  tableOfRef: TableOfRef;
  /**
   * Overrides the connection's timezone. Present only for a deployment that
   * genuinely knows better than the connection does; leave it out and the
   * connection decides.
   */
  timezone?: string;
  /** Overrides the connection's currency. */
  currency?: string | null;
  /**
   * Which connection holds the app's tables. Discovered from
   * `GET /api/v1/connections` when omitted, which is right for the single-source
   * deployment this app ships as and ambiguous the moment there are two.
   */
  connectionId?: string | undefined;
  /**
   * The staff config's own facts (`surface-config.json`), when the till was
   * served one: the signed-in person's token and the venue's zone and money.
   * With a token and a `connectionId` the transport reads neither the
   * dashboard's bootstrap nor its connections list — a screens-only cashier
   * may read neither.
   */
  staff?: {
    csrfToken: string | null;
    timezone?: string | null;
    timezoneSource?: string | null;
    serverTimezone?: string | null;
    currency?: string | null;
  };
  /** A fresh token after `CSRF_FAILED` — the staff config again, for a till booted from it. */
  refreshToken?: () => Promise<string | null>;
  /** Test seam. */
  fetchImpl?: typeof fetch;
  /** Test seam: how a read waits out a rate limit. */
  sleep?: (ms: number) => Promise<void>;
}

/*
 * A READ REFUSED FOR RATE is read again. Adminium answers 429 before it runs
 * anything, so repeating a GET is safe, and the desk opening needs a burst of
 * them: a desk that meets the limit while it starts must wait and go on, not
 * stop on a screen that says "try again in 15 seconds" and never does. Twice,
 * after what `Retry-After` asks (capped), then the refusal stands. A write is
 * never repeated here: the person sees it refused and decides.
 */
const RATE_RETRIES = 2;
const RATE_WAIT_CAP_MS = 30_000;
const RATE_WAIT_DEFAULT_MS = 5_000;

/** How long a 429 asks to wait, from `Retry-After` in seconds; a default when it says nothing usable. */
export function rateLimitWait(retryAfter: string | null): number {
  const seconds = retryAfter === null ? Number.NaN : Number(retryAfter);
  if (!Number.isFinite(seconds) || seconds < 0) return RATE_WAIT_DEFAULT_MS;
  return Math.min(Math.ceil(seconds * 1000), RATE_WAIT_CAP_MS);
}

/*
 * THE WIRE SHAPES, COPIED FROM A LIVE SERVER — NOT INFERRED.
 *
 * Three of these four were wrong when written from the route handlers alone,
 * and the canned tests could not catch it because the fixtures encoded the same
 * guess. Each envelope differs from the others on purpose-built grounds, so
 * there is no rule to apply, only observation:
 *
 *   GET /api/v1/bootstrap                → { data: { csrfToken, … } }
 *   GET /api/v1/connections              → { connections: [ … ] }      not `data`
 *   GET /api/v1/connections/:id/schema   → { model: { tables: [ … ] } } not `tables`
 *   GET /api/v1/data/:conn/:table        → { data: [ … ], page: { … } }
 */
interface BootstrapReply {
  data?: { csrfToken?: string };
}

interface ConnectionRow {
  id: string;
  name?: string;
  /** 28-T34. Null when the operator has not configured one. */
  timezone?: string | null;
  /**
   * Who chose `timezone` (Adminium meta wave 0018): `operator`, or `host` when
   * Adminium seeded the zone of the machine IT runs on and nobody has
   * confirmed it. Optional because an older Adminium does not send it, and
   * absent must mean "no claim" rather than "guessed".
   */
  timezoneSource?: string | null;
  /**
   * ADMINIUM's OWN zone, reported on every connection and stored on none.
   *
   * The fallback when `timezone` is null. This app used to substitute `"UTC"`
   * here, which was a guess made in the browser: on a server that is not in
   * UTC it rendered the business's own day in the wrong hours and captioned it
   * "UTC" on a badge. The server knows its zone, so it says it.
   *
   * Optional because an Adminium older than this field does not send one, and
   * UTC remains the last resort when it is absent.
   */
  serverTimezone?: string | null;
  currency?: string | null;
  /**
   * Paused by an operator (Adminium meta wave 0019). Adminium opens no
   * connection to a paused source, so this app must not treat one as a
   * candidate. Optional: an older Adminium omits it, and absent means serving.
   */
  disabled?: boolean;
}

interface ConnectionsReply {
  connections?: ConnectionRow[];
}

/**
 * Where the zone this app renders dates in came from.
 *
 * `operator` and `host` mirror Adminium's own column (meta wave 0018);
 * `fallback` is this transport's own UTC substitute, which exists nowhere but
 * here because Adminium never invents a zone. `null` — a source this build does
 * not recognise, or an Adminium too old to send one — means NO CLAIM, and must
 * render as silence rather than as a guess.
 */
export type TimezoneSource = 'operator' | 'host' | 'fallback';

/**
 * The stored provenance for a row, with an explicit override winning.
 *
 * Anything unrecognised degrades to `null`. Reporting an unknown source as
 * `host` would tell an operator their own confirmed zone was guessed, which is
 * the one direction of error that teaches people to ignore the notice.
 */
function sourceOf(override: string | undefined, row: ConnectionRow): TimezoneSource | null {
  if (override !== undefined) return 'operator';
  if (row.timezone === null || row.timezone === undefined) return null;
  return row.timezoneSource === 'operator' || row.timezoneSource === 'host'
    ? row.timezoneSource
    : null;
}

interface SchemaReply {
  model?: {
    tables?: { id?: string; name: string; columns?: { name: string }[] }[];
    /** A foreign key, by the id the data API names it with in `children`. */
    relations?: {
      id: string;
      through?: unknown;
      from?: { tableId?: string; columns?: string[] };
      to?: { tableId?: string };
    }[];
  };
}

export class SessionPortError extends Error {
  /* Explicit fields, not constructor parameter properties: this repo compiles
     with `erasableSyntaxOnly`, which rejects the shorthand. */
  readonly status: number;
  readonly code: string;
  /** What the server said beyond the message — a refused write's column issues. */
  readonly details: unknown;

  constructor(message: string, status: number, code: string, details?: unknown) {
    super(message);
    this.name = "SessionPortError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/**
 * A `SnapshotPort` backed by the dashboard's own API and the operator's
 * session. Discovery (`bootstrap`, then `connections`) happens once, inside the
 * first `config()` call, because that is the first thing `loadSnapshot` does.
 */
export function sessionPort(opts: SessionPortOptions): SnapshotPort {
  return createSessionTransport(opts).port;
}

function buildTransport(opts: SessionPortOptions): SessionTransport {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let csrfToken: string | null = null;
  let connectionId: string | null = opts.connectionId ?? null;
  /** Adminium's own zone, for the fallback below. Null on an older Adminium. */
  let serverTimezone: string | null = null;
  let tenantTimezone: string | null = opts.timezone ?? null;
  /**
   * Where the zone above came from — see {@link TimezoneSource}. A build that
   * pins one has decided it, so an `opts.timezone` counts as `operator`.
   */
  let tenantTimezoneSource: TimezoneSource | null =
    opts.timezone === undefined ? null : 'operator';
  let tenantCurrency: string | null = opts.currency ?? null;
  /**
   * Names of the connections Adminium is NOT serving, captured during
   * discovery. Kept for one message only — see `pausedHint`.
   */
  let pausedNames: string[] = [];

  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const mutating = (init?.method ?? "GET").toUpperCase() !== "GET";
    const send = () =>
      doFetch(path, {
        credentials: "same-origin",
        ...init,
        headers: {
          accept: "application/json",
          ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
          ...(mutating && csrfToken !== null ? { [CSRF_HEADER]: csrfToken } : {}),
          ...init?.headers,
        },
      });
    let response = await send();
    for (let retry = 0; !mutating && response.status === 429 && retry < RATE_RETRIES; retry += 1) {
      await sleep(rateLimitWait(response.headers.get("retry-after")));
      response = await send();
    }

    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      // 204, or a proxy's non-JSON error page.
    }

    if (!response.ok) {
      const envelope = body as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw new SessionPortError(
        envelope?.error?.message ?? `Request failed with status ${String(response.status)}.`,
        response.status,
        envelope?.error?.code ?? "INTERNAL",
        envelope?.error?.details,
      );
    }
    return body as T;
  }

  /** The connection's schema, read once: the till asks it about tables and links. */
  let schemaRead: Promise<SchemaReply> | null = null;
  async function schemaOf(): Promise<SchemaReply> {
    schemaRead ??= discover().then((conn) =>
      call<SchemaReply>(`/api/v1/connections/${encodeURIComponent(conn)}/schema`),
    );
    try {
      return await schemaRead;
    } catch (error) {
      schemaRead = null;
      throw error;
    }
  }

  let discovered = false;
  async function discover(): Promise<string> {
    /*
     * BOOTED FROM THE STAFF CONFIG: the person, the token and the venue are
     * already known, and asking the dashboard for them would be refused for a
     * screens-only cashier.
     */
    const staff = opts.staff;
    if (staff?.csrfToken && connectionId !== null) {
      if (!discovered) {
        discovered = true;
        csrfToken = staff.csrfToken;
        serverTimezone = staff.serverTimezone ?? null;
        tenantTimezone = opts.timezone ?? staff.timezone ?? null;
        tenantTimezoneSource = sourceOf(opts.timezone, {
          id: connectionId,
          timezone: staff.timezone ?? null,
          timezoneSource: staff.timezoneSource ?? null,
        });
        tenantCurrency = opts.currency ?? staff.currency ?? null;
      }
      return connectionId;
    }
    const boot = await call<BootstrapReply>("/api/v1/bootstrap");
    // Absent only if the server is unauthenticated, which `call` already threw
    // on — so this is a contract check, not a fallback.
    csrfToken = boot.data?.csrfToken ?? null;

    /*
     * The connection list is fetched even when the id was supplied, because it
     * carries the tenant config as well as the identity. Returning early on a
     * pinned id skipped that and produced a port with no timezone — caught by
     * the test that pins one, which is the only path that reached it.
     */
    const conns = await call<ConnectionsReply>("/api/v1/connections");
    const all = conns.connections ?? [];

    /*
     * A PAUSED CONNECTION IS NOT A CANDIDATE (Adminium meta wave 0019).
     *
     * The list endpoint returns paused rows on purpose — Studio has to show one
     * to offer Resume — but the server refuses to open them, so counting them
     * here can only produce refusals an operator already answered. Pausing the
     * spare connection is the obvious way to tell a two-database instance which
     * one this app reads, and before this filter it did nothing at all: the
     * ambiguity refusal counted the paused row and fired anyway.
     *
     * `!== true`, not `=== false`: an older Adminium sends no such field, and
     * absent must mean "serving" rather than "paused".
     */
    const rows = all.filter((r) => r.disabled !== true);
    pausedNames = all.filter((r) => r.disabled === true).map((r) => r.name ?? r.id);

    if (connectionId !== null) {
      // Searched in `all`, not `rows` — a pinned id that resolves to a paused
      // connection is a state worth NAMING here, rather than one the server
      // rejects later with a message about a request nobody made.
      const pinned = all.find((r) => r.id === connectionId);
      if (pinned !== undefined) {
        if (pinned.disabled === true) {
          throw new SessionPortError(
            `the connection this app is pinned to (${pinned.name ?? pinned.id}) is paused in ` +
              "Adminium — resume it in Connections, or point this app at another one",
            412,
            "CONNECTION_PAUSED",
          );
        }
        tenantTimezone = opts.timezone ?? pinned.timezone ?? null;
        tenantTimezoneSource = sourceOf(opts.timezone, pinned);
        serverTimezone = pinned.serverTimezone ?? null;
        tenantCurrency = opts.currency ?? pinned.currency ?? null;
      }
      return connectionId;
    }

    if (rows.length === 0) {
      /*
       * Distinguish "none exists" from "every one is paused". They are one
       * click apart and their fixes are opposite: the first sends an operator
       * to the connect wizard, and telling them that when a paused connection
       * is sitting right there is how someone ends up with a duplicate.
       */
      if (all.length > 0) {
        throw new SessionPortError(
          all.length === 1
            ? `the connection this app reads (${all[0]?.name ?? all[0]?.id ?? "unnamed"}) is ` +
              "paused in Adminium — resume it in Connections"
            : `all ${String(all.length)} connections are paused in Adminium — resume the one ` +
              "that holds this app's data",
          412,
          "CONNECTION_PAUSED",
        );
      }
      throw new SessionPortError(
        "no source connection is configured — connect this app's database in Adminium first",
        412,
        "NO_CONNECTION",
      );
    }
    if (rows.length > 1 && opts.connectionId === undefined) {
      // Refuse rather than pick: reading the wrong database renders a plausible
      // console full of somebody else's records.
      // The count is of SERVING connections: pausing the spare is a legitimate
      // way to answer this, and the message must not quote a number that
      // includes rows the operator already took out of service.
      throw new SessionPortError(
        `${String(rows.length)} connections are serving in Adminium — pause the ones this app ` +
          "does not read, or pass connectionId to say which one holds it",
        409,
        "AMBIGUOUS_CONNECTION",
      );
    }
    const row = rows[0]!;
    // Options override; the connection supplies. Same precedence the public
    // API gives a scope over its connection, for the same reason.
    tenantTimezone = opts.timezone ?? row.timezone ?? null;
    tenantTimezoneSource = sourceOf(opts.timezone, row);
    serverTimezone = row.serverTimezone ?? null;
    tenantCurrency = opts.currency ?? row.currency ?? null;
    connectionId = row.id;
    return connectionId;
  }

  /**
   * The sentence that turns a schema mismatch into something an operator can act on.
   *
   * A paused connection is INVISIBLE to this app: it filtered the row out and
   * read whatever was still serving. So a list of absent tables is a true
   * report of the symptom and says nothing about the cause, which is one click
   * away in Studio — the database this app reads is the one they paused.
   *
   * Named, not counted: with two connections the name IS the answer.
   */
  function pausedHint(): string {
    if (pausedNames.length === 0) return "";
    const names = pausedNames.join(", ");
    return pausedNames.length === 1
      ? `\n\n${names} is paused in Adminium. If that is this app's database, resume it in ` +
          "Connections — this app read a different one."
      : `\n\n${String(pausedNames.length)} connections are paused in Adminium (${names}). If ` +
          "this app's database is one of them, resume it in Connections — this app read a " +
          "different one.";
  }

  const port: SnapshotPort = {
    async config() {
      await discover();
      if (tenantTimezone === null) {
        /*
         * FALL BACK, LOUDLY — do not refuse.
         *
         * This threw `NO_TIMEZONE` until it met a real operator: a connection
         * with no zone made the ENTIRE surface unreachable, showing a config
         * error instead of a working app. That traded a silent one-hour offset
         * for total unavailability, which is the worse of the two by a distance.
         * Almost every screen here needs no zone at all, and the ones that do
         * are off by an hour at worst.
         *
         * WHAT WE FALL BACK TO IS THE SERVER'S ZONE, not UTC and never the
         * READER's. `Intl…resolvedOptions()` in the browser would render a
         * Lisbon studio in a Berlin viewer's hours and look like data, and two
         * people would see different times for one appointment. Adminium's own
         * zone is a single value for the tenant, it is the machine the operator
         * deliberately deployed on, and it is what Adminium already seeds a new
         * connection with — so this agrees with what a configured connection
         * would have said instead of contradicting it.
         *
         * Reported as `host`: a real zone that nobody confirmed. UTC survives
         * only as the last resort for an Adminium too old to send its own.
         */
        tenantTimezone = serverTimezone ?? "UTC";
        tenantTimezoneSource = serverTimezone === null ? "fallback" : "host";
        console.warn(
          `[adminium] this connection has no timezone; dates render in ${tenantTimezone}` +
            // Only true when the server actually told us — otherwise UTC is
            // this app's last resort and must not be attributed to anyone.
            (serverTimezone === null ? "" : ", the zone of the server running Adminium") +
            ". Set one on the connection in Adminium so they render in the business's zone.",
        );
      } else if (tenantTimezoneSource === "host") {
        /*
         * A REAL zone that nobody chose. Adminium seeds a new connection with
         * the zone of the machine it runs on (meta wave 0018) — one value for
         * the tenant rather than one per reader, and a plausible one, which is
         * exactly why it is worth saying out loud. In a container that is
         * usually UTC; on somebody's laptop it is their own city.
         *
         * Quieter than the fallback warning by design: these dates are probably
         * right, and the app renders them either way.
         */
        console.info(
          `[adminium] dates render in ${tenantTimezone}, the zone of the server running ` +
            "Adminium. Confirm it on the connection (Connections → this database) if it is " +
            "this business's zone.",
        );
      }
      return {
        // A session IS the staff side. There is no customer-side session.
        side: "staff",
        timezone: tenantTimezone,
        /* Lets the UI say which zone these dates are in and who chose it. A
           default the reader cannot see is the failure mode this whole area
           keeps producing; a visible one is not. */
        timezoneSource: tenantTimezoneSource,
        currency: tenantCurrency,
        // No per-ref limits: this transport's cap is the route's, not a scope's.
        refs: {},
      };
    },

    async assertRefs(required) {
      const schema = await schemaOf();
      const byTable = new Map(
        (schema.model?.tables ?? []).map((t) => [
          t.name,
          new Set((t.columns ?? []).map((c) => c.name)),
        ]),
      );

      const problems: string[] = [];
      for (const [ref, columns] of Object.entries(required)) {
        const table = opts.tableOfRef[ref];
        if (table === undefined) {
          problems.push(`${ref}: no table mapping`);
          continue;
        }
        const present = byTable.get(table);
        if (present === undefined) {
          problems.push(`${ref}: table "${table}" is absent`);
          continue;
        }
        const missing = columns.filter((c) => !present.has(c));
        if (missing.length > 0) problems.push(`${table}: missing ${missing.join(", ")}`);
      }
      if (problems.length > 0) {
        // One error naming everything, not the first failure: an operator
        // fixing a schema wants the whole list, not nine round trips.
        throw new SessionPortError(
          `this database does not match what this app reads —\n  ${problems.join("\n  ")}${pausedHint()}`,
          412,
          "SCHEMA_MISMATCH",
        );
      }
    },

    async list<T>(ref: string, { limit, offset, where, order, count }: ListOptions) {
      const conn = await discover();
      const table = opts.tableOfRef[ref];
      if (table === undefined) {
        throw new SessionPortError(`unknown ref "${ref}"`, 400, "UNKNOWN_REF");
      }
      const size = Math.min(limit, PAGE_MAX);
      let query = `limit=${String(size)}&offset=${String(offset)}`;
      if (where !== undefined) query += `&where=${encodeURIComponent(JSON.stringify(where))}`;
      if (order !== undefined) query += `&order=${encodeURIComponent(order)}`;
      if (count === true) query += "&count=exact";
      const res = await call<{ data?: T[]; page?: { total?: number | null } }>(
        `/api/v1/data/${encodeURIComponent(conn)}/${encodeURIComponent(table)}?${query}`,
      );
      // Only a count that was asked for is reported: an absent one is not zero.
      return count === true ? { data: res.data ?? [], total: res.page?.total ?? null } : { data: res.data ?? [] };
    },
  };

  return {
    port,
    connection: discover,
    async tableId(name: string): Promise<string> {
      const table = ((await schemaOf()).model?.tables ?? []).find((t) => t.name === name);
      if (table === undefined) throw new SessionPortError(`table "${name}" is absent`, 412, "SCHEMA_MISMATCH");
      return table.id ?? name;
    },
    async relation(child: string, column: string): Promise<string> {
      const model = (await schemaOf()).model;
      const table = (model?.tables ?? []).find((t) => t.name === child);
      const found = (model?.relations ?? []).find(
        (r) =>
          (r.through === null || r.through === undefined) &&
          r.from?.tableId === (table?.id ?? child) &&
          r.from?.columns?.length === 1 &&
          r.from.columns[0] === column,
      );
      if (found === undefined) {
        throw new SessionPortError(`nothing links "${child}.${column}" to its parent`, 412, "SCHEMA_MISMATCH");
      }
      return found.id;
    },
    async refresh(): Promise<void> {
      if (opts.refreshToken !== undefined) {
        csrfToken = (await opts.refreshToken()) ?? csrfToken;
        return;
      }
      const boot = await call<BootstrapReply>("/api/v1/bootstrap");
      csrfToken = boot.data?.csrfToken ?? null;
    },
    async get<T>(path: string): Promise<T> {
      // The connection is discovered first so a booted-from-config transport
      // has its session, exactly as a list would.
      await discover();
      return call<T>(path);
    },
    async mutate<T>(
      path: string,
      method: "POST" | "PUT" | "PATCH" | "DELETE",
      body?: unknown,
    ): Promise<T> {
      if (csrfToken === null) {
        // Not a fallback: a tokenless write answers CSRF_FAILED, which reads
        // like a permissions problem and sends people to the roles page.
        throw new SessionPortError(
          "call config() before mutate() — the CSRF token is captured there",
          500,
          "CSRF_TOKEN_MISSING",
        );
      }
      return call<T>(path, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    },
  };
}

/**
 * A write through the same session — the other half of the hosting claim.
 *
 * Reads alone would not settle it: the reason a staff surface belongs inside
 * Adminium is that it needs to WRITE as a principal, with RBAC and an audit
 * row, which a publishable key cannot do by construction.
 *
 * Returned alongside the port rather than exported separately, because the
 * CSRF token is captured during `config()` and a caller holding only a
 * `SnapshotPort` has no legitimate way to reach it.
 */
export interface SessionTransport {
  port: SnapshotPort;
  /**
   * `POST`/`PUT`/`PATCH`/`DELETE` against a dashboard route, carrying the session and
   * the CSRF token. Throws `SessionPortError` unless `config()` has run — the
   * token does not exist before then, and a tokenless write fails with a
   * `CSRF_FAILED` that looks like a permissions problem.
   */
  mutate: <T>(path: string, method: "POST" | "PUT" | "PATCH" | "DELETE", body?: unknown) => Promise<T>;
  /**
   * A `GET` of a dashboard route through the same session, for the reads a
   * `SnapshotPort` has no method for — a booking table's free times, one
   * record by its key. The path is the caller's, whole; the answer is the
   * route's own envelope. Never carries the CSRF token (the server checks
   * none on a read).
   */
  get: <T>(path: string) => Promise<T>;
  /** The connection the app's tables are in (discovered on first use). */
  connection: () => Promise<string>;
  /**
   * A table's id in the connection's schema (`public.pos_tickets`) — what a
   * live-updates channel names it by.
   */
  tableId: (name: string) => Promise<string>;
  /**
   * The id the data API names a child link by, in a write's `children`: the
   * foreign key `child.column` pointing at the parent being written.
   */
  relation: (child: string, column: string) => Promise<string>;
  /**
   * A fresh CSRF token, after a write came back `CSRF_FAILED` — the token
   * rotates with the session, and one retry with the new one is the answer.
   */
  refresh: () => Promise<void>;
}

export function createSessionTransport(opts: SessionPortOptions): SessionTransport {
  return buildTransport(opts);
}
