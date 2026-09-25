/**
 * Where the desk's writes go, and how an action that writes several rows
 * survives a failure half-way.
 *
 * ── The sink ────────────────────────────────────────────────────────────────
 *
 *   sessionSink   Adminium's data API, as the signed-in staff member: every
 *                 row lands in the real table (the name the install gave it),
 *                 under the person's grants and the audit trail, with every
 *                 rule Adminium keeps applied on the way in — numbers, totals,
 *                 balances, stamps, states and locks. The answer is the saved
 *                 row, as the server decided it.
 *   the demo      the same calls against the in-memory studio (`demo/world.ts`).
 *
 * A write that fails throws a `SinkError` whose `kind` says what to DO:
 *
 *   signed-out   401 — sign in again; nothing more is saved until then
 *   refused      a 4xx the server means — a locked document (`RECORD_LOCKED`),
 *                a payment over the balance (`BALANCE_EXCEEDED`), a move the
 *                states don't allow (`STATE_MOVE_REFUSED`), an empty document
 *                sent (`DOCUMENT_EMPTY`), a value refused: never accepted as it is
 *   offline      no answer, a 5xx, or a lock the server asks to retry — try again
 *
 * ── Actions that write several rows (`runSteps`) ────────────────────────────
 *
 * Starting a project writes the project, its milestones, the first stage's
 * invoice draft and its line. A failure half-way must not leave the studio to
 * clean up, and a retry must not write anything twice. So such an action is a
 * STEP LIST, run with one ACTION KEY made when the action starts and kept until
 * it succeeds:
 *
 *   - every row a step creates carries `client_key` = the step's own key (the
 *     action key with its first group replaced by the step name's hash —
 *     36 characters, the same on every retry, different for every step);
 *   - a retry skips the steps this browser saw finish, and runs the rest from
 *     the first step not done;
 *   - if this browser lost track (a reload), a create whose `client_key` is
 *     already taken — "a unique hit on the step's own client_key" — reads as
 *     ALREADY SAVED: the sink finds that row and answers with it, and the
 *     action carries on;
 *   - the row that makes the action VISIBLE is the last step, so a half-done
 *     action never shows as done;
 *   - nothing is ever undone by a compensating delete.
 *
 * Only a found action key counts as saved: every other unique clash (an email
 * another client has) is a refusal the screen must show.
 */
import type { SessionTransport } from "./sessionSource.ts";
import type { DeskWrites, RowValues } from "./ports.ts";
import { normalise } from "./rows.ts";
import type { Id, TableRef, Tables } from "./types.ts";

// ── refusals ────────────────────────────────────────────────────────────────

export type SinkErrorKind = "signed-out" | "refused" | "offline";

export class SinkError extends Error {
  readonly kind: SinkErrorKind;
  readonly status: number;
  readonly code: string;
  /** The column the server refused, when it named one. */
  readonly field: string | null;
  /** The refusal's own details (`balance`, `reason` …), when it gave any. */
  readonly details: Record<string, unknown>;

  constructor(message: string, kind: SinkErrorKind, status: number, code: string, field: string | null = null, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "SinkError";
    this.kind = kind;
    this.status = status;
    this.code = code;
    this.field = field;
    this.details = details;
  }
}

/** What an answer means, before any action key is looked up. */
export function kindOfStatus(status: number, code = ""): SinkErrorKind {
  if (status === 401) return "signed-out";
  // A lost lock race or a busy database: the server says try again.
  if (status === 0 || status === 429 || status >= 500 || code === "WRITE_CONFLICT" || code === "NUMBER_BUSY") return "offline";
  return "refused";
}

interface ErrorLike {
  status?: number;
  code?: string;
  message?: string;
  details?: unknown;
}

function detailsOf(error: ErrorLike): Record<string, unknown> {
  return typeof error.details === "object" && error.details !== null ? (error.details as Record<string, unknown>) : {};
}

/** The first column a refused write names (`details.fields` on a 422, `details.column` on a 409). */
function fieldOf(error: ErrorLike): string | null {
  const details = detailsOf(error);
  const fields = details["fields"];
  if (typeof fields === "object" && fields !== null) return Object.keys(fields)[0] ?? null;
  return typeof details["column"] === "string" ? details["column"] : null;
}

export function asSinkError(error: unknown): SinkError {
  if (error instanceof SinkError) return error;
  const e = (error ?? {}) as ErrorLike;
  const status = typeof e.status === "number" ? e.status : 0;
  const code = e.code ?? (status === 0 ? "NETWORK" : "INTERNAL");
  return new SinkError(e.message ?? "The change could not be saved.", kindOfStatus(status, code), status, code, fieldOf(e), detailsOf(e));
}

/** A unique clash on the row's own action key: the row an earlier try saved. */
export const isOwnKeyClash = (error: SinkError, values: RowValues): boolean =>
  error.status === 409 && error.code === "UNIQUE_VIOLATION" && typeof values["client_key"] === "string" && (error.field === null || error.field === "client_key");

// ── the session sink ────────────────────────────────────────────────────────

export interface SessionSinkOptions {
  /** The signed-in person's CSRF token, for the two writes that are not JSON through the transport. */
  csrfToken: () => string | null;
  /** Test seam. */
  fetchImpl?: typeof fetch;
}

const keyOf = (id: Id): string => encodeURIComponent(String(id));

export function sessionSink(transport: SessionTransport, tableOf: Readonly<Record<TableRef, string>>, opts: SessionSinkOptions): DeskWrites {
  const doFetch = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const path = async (ref: TableRef, id?: Id): Promise<string> => {
    const conn = await transport.connection();
    const base = `/api/v1/data/${encodeURIComponent(conn)}/${encodeURIComponent(tableOf[ref])}`;
    return id === undefined ? base : `${base}/${keyOf(id)}`;
  };
  /** One retry with a fresh token when the session's has rotated. */
  const send = async <T>(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> => {
    try {
      return await transport.mutate<T>(url, method, body);
    } catch (error) {
      if ((error as ErrorLike).code !== "CSRF_FAILED") throw asSinkError(error);
      await transport.refresh().catch(() => undefined);
      try {
        return await transport.mutate<T>(url, method, body);
      } catch (again) {
        throw asSinkError(again);
      }
    }
  };
  /** A call the transport cannot carry: a file's bytes, a PUT, or the add-ons' list. */
  const raw = async <T>(url: string, method: "GET" | "POST" | "PUT", body?: BodyInit, contentType = "application/json"): Promise<T> => {
    let response: Response;
    try {
      const token = opts.csrfToken();
      response = await doFetch(url, {
        method,
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": contentType }),
          ...(token === null || method === "GET" ? {} : { "x-adminium-csrf": token }),
        },
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      throw asSinkError({ status: 0, code: "NETWORK", message: error instanceof Error ? error.message : String(error) });
    }
    let reply: unknown = null;
    try {
      reply = await response.json();
    } catch {
      // 204, or a proxy's page.
    }
    if (!response.ok) {
      const envelope = reply as { error?: { code?: string; message?: string; details?: unknown } } | null;
      throw asSinkError({ status: response.status, code: envelope?.error?.code ?? "INTERNAL", message: envelope?.error?.message ?? `status ${String(response.status)}`, details: envelope?.error?.details });
    }
    return reply as T;
  };
  /** The row an earlier try of this action saved, found by its key. */
  const byClientKey = async (ref: TableRef, key: string): Promise<Record<string, unknown> | null> => {
    const found = await transport.port.list<Record<string, unknown>>(ref, { limit: 1, offset: 0, where: { column: "client_key", op: "eq", value: key } });
    return found.data[0] ?? null;
  };

  return {
    async insert(ref, values) {
      try {
        const reply = await send<{ data?: Record<string, unknown> }>(await path(ref), "POST", { values });
        return normalise(ref, reply.data ?? {});
      } catch (error) {
        const refused = asSinkError(error);
        if (isOwnKeyClash(refused, values)) {
          const earlier = await byClientKey(ref, values["client_key"] as string).catch(() => null);
          if (earlier !== null) return normalise(ref, earlier);
        }
        throw refused;
      }
    },
    async update(ref, id, patch) {
      const reply = await send<{ data?: Record<string, unknown> }>(await path(ref, id), "PATCH", { values: patch });
      return normalise(ref, reply.data ?? {});
    },
    async remove(ref, id) {
      await send<unknown>(`${await path(ref, id)}?confirm=true`, "DELETE");
    },
    async upload(ref, column, file, filename) {
      const params = new URLSearchParams({ filename, connectionId: await transport.connection(), table: tableOf[ref], column });
      const reply = await raw<{ data?: { id?: string }; ref?: string }>(`/api/v1/files?${params.toString()}`, "POST", file, file.type || "application/octet-stream");
      const value = reply.ref ?? reply.data?.id;
      if (value === undefined) throw new SinkError("the upload answered with no file", "refused", 500, "UPLOAD_NO_REF");
      return value;
    },
    async regenerateCode<R extends TableRef>(ref: R, id: Id, column: string): Promise<Tables[R]> {
      const reply = await send<{ data?: Record<string, unknown> }>(`${await path(ref, id)}/regenerate-code`, "POST", { column });
      return normalise(ref, reply.data ?? {});
    },
    /*
     * An add-on's stored settings and declared keys, from its entry in
     * `GET /api/v1/add-ons` (any signed-in person; no secret is in it).
     */
    async addOnSettings(addOnKey) {
      const reply = await raw<{ addOns?: { key: string; settings?: { key: string }[]; settingValues?: Record<string, unknown> }[] }>("/api/v1/add-ons", "GET");
      const addOn = (reply.addOns ?? []).find((a) => a.key === addOnKey);
      return addOn === undefined ? null : { values: addOn.settingValues ?? {}, declared: (addOn.settings ?? []).map((s) => s.key) };
    },
    async saveAddOnSettings(addOnKey, values) {
      const reply = await raw<{ values?: Record<string, unknown> }>(`/api/v1/add-ons/${encodeURIComponent(addOnKey)}/settings`, "PUT", JSON.stringify({ values }), "application/json");
      return reply.values ?? {};
    },
  };
}

// ── action keys and step lists ──────────────────────────────────────────────

/** A fresh action key (36 characters, as `client_key` holds). */
export function actionKey(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

/** FNV-1a, 32 bits, as 8 hex characters. */
function hash8(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The key one step of an action writes with: the action key with its first
 * group (8 characters) replaced by the step name's hash. Still 36 characters,
 * the same on every retry, and different for every step of one action.
 */
export function stepKey(action: string, step: string): string {
  return `${hash8(step)}${action.slice(8)}`;
}

/** What a step can see: its own key, and what the steps before it answered. */
export interface StepContext {
  /** This step's `client_key`. */
  key: string;
  /** The answer of an earlier step, by name. */
  result<T>(name: string): T;
  /** Whether an earlier step ran (a conditional step may be absent). */
  has(name: string): boolean;
}

export interface Step {
  /** Unique within the action; also what its key is made from. */
  name: string;
  run: (ctx: StepContext) => Promise<unknown>;
}

/** One run of an action: its key, and the steps this browser saw finish. */
export interface StepRun {
  key: string;
  done: Record<string, unknown>;
}

export function newRun(key: string = actionKey()): StepRun {
  return { key, done: {} };
}

/** A step list that stopped: which step, and why. */
export class StepFailure extends Error {
  readonly step: string;
  readonly cause: SinkError;
  /** How many steps had finished before it (0 = nothing was saved). */
  readonly finished: number;
  constructor(step: string, cause: SinkError, finished: number) {
    super(`step "${step}" did not save: ${cause.message}`);
    this.name = "StepFailure";
    this.step = step;
    this.cause = cause;
    this.finished = finished;
  }
}

/**
 * Run a step list, resuming `run`: a step it already finished is skipped (its
 * answer reused), and the first one not done runs next. Throws a
 * `StepFailure` at the first step that does not save; `run.done` then holds
 * everything that did, so calling again with the same `run` finishes it.
 */
export async function runSteps(run: StepRun, steps: readonly Step[]): Promise<Record<string, unknown>> {
  const names = new Set<string>();
  const hashes = new Set<string>();
  for (const step of steps) {
    if (names.has(step.name)) throw new Error(`two steps are called "${step.name}"`);
    names.add(step.name);
    hashes.add(hash8(step.name));
  }
  if (hashes.size !== names.size) throw new Error("two step names make the same key; rename one");

  let finished = Object.keys(run.done).filter((name) => names.has(name)).length;
  for (const step of steps) {
    if (step.name in run.done) continue;
    const ctx: StepContext = {
      key: stepKey(run.key, step.name),
      result<T>(name: string): T {
        if (!(name in run.done)) throw new Error(`step "${step.name}" needs "${name}", which has not run`);
        return run.done[name] as T;
      },
      has: (name) => name in run.done,
    };
    try {
      run.done[step.name] = await step.run(ctx);
    } catch (error) {
      throw new StepFailure(step.name, asSinkError(error), finished);
    }
    finished += 1;
  }
  return run.done;
}
