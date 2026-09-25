/**
 * What every action answers: done (with what the server saved), or refused
 * with the server's own code and a reason a screen turns into words.
 *
 * Nothing is shown as saved before the server says so. A refusal keeps the
 * server's code (`RECORD_LOCKED`, `BALANCE_EXCEEDED`, `PUBLIC_WRITE_REFUSED`
 * …) so a screen can say exactly what happened; `reason` groups the codes a
 * screen words the same way, and `refusalKey` gives the shared wording.
 *
 * An action that writes several rows and stopped half-way also answers
 * `unfinished`: the sheet shows "A step didn't save — Finish it", and
 * `unfinished.resume()` runs the same action from the first step not done.
 */
import type { MessageKey } from "../i18n/messages/index.ts";
import { PortError } from "../data/ports.ts";
import { asSinkError, runSteps, SinkError, StepFailure, type Step, type StepRun } from "../data/sink.ts";

export type Refusal =
  /** No answer from Adminium: try again. */
  | "offline"
  /** Adminium is busy or asked to wait (a rate limit, a lock race). */
  | "busy"
  /** The session ended: sign in again. */
  | "signed-out"
  /** The signed-in person's role may not do this. */
  | "not-allowed"
  /** The row has gone. */
  | "gone"
  /** A sent document is locked (`RECORD_LOCKED`). */
  | "locked"
  /** A payment would be more than the balance (`BALANCE_EXCEEDED`). */
  | "balance"
  /** The row moved on since it was drawn (`STATE_MOVE_REFUSED`, a precondition). */
  | "moved"
  /** A document sent with no line or no total (`DOCUMENT_EMPTY`). */
  | "empty"
  /** A value that must be unique already is. */
  | "duplicate"
  /** Stage shares would pass the whole proposal (checked before any write). */
  | "over-share"
  /** A staff preview of the clients' side: only the client can act. */
  | "preview"
  /** A sign-in link used or expired (`LINK_EXPIRED`). */
  | "link-expired"
  /** The server refused a value; `field` names it. */
  | "invalid";

/** An action that stopped half-way. */
export interface Unfinished<T> {
  /** The action key every retry uses. */
  key: string;
  /** The step that did not save. */
  step: string;
  /** How many steps had saved before it. */
  finished: number;
  /** Run the action again from the first step not done. */
  resume(): Promise<Outcome<T>>;
}

export type Outcome<T = void> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason: Refusal;
      /** The server's own code (or the port's). */
      code: string;
      field: string | null;
      details: Record<string, unknown>;
      unfinished: Unfinished<T> | null;
    };

const BY_CODE: Record<string, Refusal> = {
  RECORD_LOCKED: "locked",
  BALANCE_EXCEEDED: "balance",
  STATE_MOVE_REFUSED: "moved",
  PRECONDITION_FAILED: "moved",
  DOCUMENT_EMPTY: "empty",
  UNIQUE_VIOLATION: "duplicate",
  OVER_SHARE: "over-share",
  COLUMN_FORBIDDEN: "not-allowed",
  FORBIDDEN: "not-allowed",
  PUBLIC_ACTION_NOT_ALLOWED: "not-allowed",
  PUBLIC_WRITE_REFUSED: "moved",
  PUBLIC_RATE_LIMITED: "busy",
  PUBLIC_CLAIM_LEVEL: "signed-out",
  LINK_EXPIRED: "link-expired",
  PREVIEW: "preview",
  NOT_FOUND: "gone",
  PUBLIC_REF_NOT_FOUND: "gone",
};

/** A move's requirement that means "the document is empty": its lines, or a total above zero. */
const isEmptyDocument = (requires: unknown): boolean => requires === "total" || requires === "proposal_lines" || requires === "invoice_lines";

/** What a refused write means for the person on the page. */
export function refusalOf<T = never>(error: unknown, unfinished: Unfinished<T> | null = null): Outcome<T> {
  if (error instanceof PortError) {
    const reason = BY_CODE[error.code] ?? (error.status === 401 ? "signed-out" : error.status === 404 ? "gone" : error.status === 0 ? "offline" : "invalid");
    return { ok: false, reason, code: error.code, field: typeof error.params["column"] === "string" ? error.params["column"] : null, details: error.params, unfinished };
  }
  const e: SinkError = asSinkError(error);
  const base = { ok: false as const, code: e.code, field: e.field, details: e.details, unfinished };
  if (e.kind === "signed-out") return { ...base, reason: "signed-out" };
  if (e.kind === "offline") return { ...base, reason: e.status === 429 || e.code === "NUMBER_BUSY" || e.code === "WRITE_CONFLICT" ? "busy" : "offline" };
  // A document sent with no line, or no total: Adminium refuses the move and names what it requires.
  if (e.code === "STATE_MOVE_REFUSED" && isEmptyDocument(e.details["requires"])) return { ...base, reason: "empty" };
  const byCode = BY_CODE[e.code] ?? BY_CODE[String(e.details["reason"] ?? "")];
  if (byCode !== undefined) return { ...base, reason: byCode };
  if (e.status === 403) return { ...base, reason: "not-allowed" };
  if (e.status === 404) return { ...base, reason: "gone" };
  return { ...base, reason: "invalid" };
}

/** The shared words for a refusal (a screen may say more, from its own area). */
export function refusalKey(reason: Refusal): MessageKey {
  switch (reason) {
    case "offline":
      return "save.offline";
    case "busy":
      return "save.busy";
    case "signed-out":
      return "save.signedOut";
    case "not-allowed":
      return "save.notAllowed";
    case "gone":
      return "save.gone";
    case "locked":
      return "save.locked";
    case "balance":
      return "save.balance";
    case "moved":
      return "save.moved";
    case "empty":
      return "save.empty";
    case "duplicate":
      return "save.duplicate";
    case "over-share":
      return "save.overShare";
    case "preview":
      return "portal.previewBlocked";
    case "link-expired":
      return "screen.expired";
    case "invalid":
      return "save.invalid";
  }
}

const signedOutListeners = new Set<() => void>();
/** Told when a save found the session ended (the frame shows "Sign in again"). */
export function onSignedOut(listener: () => void): () => void {
  signedOutListeners.add(listener);
  return () => signedOutListeners.delete(listener);
}

function noteSignedOut<T>(outcome: Outcome<T>): Outcome<T> {
  if (!outcome.ok && outcome.reason === "signed-out") signedOutListeners.forEach((l) => l());
  return outcome;
}

/** Run a one-write action; any refusal says why. */
export async function attempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return noteSignedOut(refusalOf<T>(error));
  }
}

/**
 * Run an action's step list under one action key. When a step does not save
 * after an earlier one did, the outcome carries `unfinished`, whose `resume`
 * runs the same list from the first step not done.
 */
export async function attemptSteps<T>(run: StepRun, steps: () => readonly Step[], finish: (done: Record<string, unknown>) => Promise<T> | T): Promise<Outcome<T>> {
  try {
    const done = await runSteps(run, steps());
    return { ok: true, value: await finish(done) };
  } catch (error) {
    if (error instanceof StepFailure) {
      // Something saved, or the answer was lost (it may have saved): finish with
      // the same key. A plain refusal of the first step saved nothing.
      const maybeSaved = error.finished > 0 || error.cause.kind === "offline";
      const unfinished: Unfinished<T> | null = maybeSaved ? { key: run.key, step: error.step, finished: error.finished, resume: () => attemptSteps(run, steps, finish) } : null;
      return noteSignedOut(refusalOf<T>(error.cause, unfinished));
    }
    return noteSignedOut(refusalOf<T>(error));
  }
}
