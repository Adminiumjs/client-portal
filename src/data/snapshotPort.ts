/**
 * What `loadSnapshot` actually needs from a backend — three methods, no more.
 *
 * Extracted so the SAME mapping below can be driven by two transports:
 *   - `@adminiumjs/public-client` against the public API with a publishable
 *     key (a standalone build), which satisfies this structurally; and
 *   - `sessionPort()` against `/api/v1/*` with the operator's session cookie
 *     (a build hosted by Adminium at its own origin), where there is no key at
 *     all.
 *
 * The mapping is ~260 lines of domain knowledge and forking it per transport
 * would be the single most expensive mistake available here.
 */
export interface SnapshotPort {
  config(): Promise<{
    side: string;
    timezone: string;
    /**
     * Who chose `timezone`: `operator`, `host` (the zone of the server running
     * Adminium, seeded and unconfirmed), or `fallback` (no zone configured, so
     * the transport substituted UTC). `null` or absent is NO CLAIM.
     *
     * Optional so `PublicClient` still satisfies this port structurally — the
     * public API always carries a real zone on its scope, so only the session
     * transport ever sets this.
     *
     * Exists so a UI can SAY which zone it is rendering in and on whose
     * authority, instead of the two failure modes this area keeps oscillating
     * between: a silent wrong zone, or refusing to render at all.
     */
    timezoneSource?: 'operator' | 'host' | 'fallback' | null;
    /**
     * Nullable on the wire (a scope exposing no money needs no currency), so
     * `null` and not `undefined` — matching `PublicConfig` exactly is what lets
     * `PublicClient` satisfy this port structurally, with no adapter.
     */
    currency: string | null;
    refs: Record<string, { limit?: number } | undefined>;
  }>;
  assertRefs(required: Record<string, readonly string[]>): Promise<void>;
  /**
   * `where` and `order` are the data API's own grammar, which the public client
   * accepts too: a read of only what the till needs (open tickets, today's
   * payments) rather than the whole history.
   */
  list<T>(ref: string, opts: ListOptions): Promise<{ data: T[]; total?: number | null }>;
}

export type ListCondition =
  | { column: string; op: 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'ilike' | 'is_null' | 'not_null'; value?: unknown }
  | { and: ListCondition[] }
  | { or: ListCondition[] };

export interface ListOptions {
  limit: number;
  offset: number;
  where?: ListCondition;
  /** `column.desc,column2.asc`, at most three keys. */
  order?: string;
  /**
   * Also count every row the `where` matches, not only the page — "31 on the
   * list" over a page of twenty. A count is a second query on the server, so it
   * is asked for, never sent by default. `total` is null when the server gave
   * none.
   */
  count?: boolean;
}
