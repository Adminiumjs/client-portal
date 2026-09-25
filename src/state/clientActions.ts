/**
 * Everything a client DOES on their side, each one Adminium write through its
 * own narrow door (`data/publicSource.ts`). The client's pages draw and call;
 * they never write a row themselves.
 *
 * Adminium decides what the client does not type: who signed and when, the
 * fingerprint, how a deliverable was approved, a note's author and time,
 * when a brief was sent, when a payment was said to be sent. The row that
 * comes back is folded into the page (`portal.ts`).
 *
 * In the studio's preview every action is refused ("This is a preview. Only
 * the client can do this.") before anything is sent.
 *
 * Kept apart from the desk's `actions.ts` on purpose: the clients' bundle
 * carries nothing of the desk.
 */
import { PortError, type SentPayment } from "../data/ports.ts";
import type { Day, Id } from "../data/types.ts";
import { newRun } from "../data/sink.ts";
import { loadPortal, portalPort, resetPortal, upsertPortal, usePortal } from "./portal.ts";
import { attempt, attemptSteps, refusalOf, type Outcome } from "./outcome.ts";
import { useUi } from "./ui.ts";

export type { Outcome } from "./outcome.ts";

/** A client action, refused in the studio's preview before anything is sent. */
function clientAttempt<T>(run: () => Promise<T>): Promise<Outcome<T>> {
  if (useUi.getState().preview !== null) return Promise.resolve(refusalOf<T>(new PortError("PREVIEW", "a preview cannot act for the client")));
  return attempt(run);
}

// ── signing in ──────────────────────────────────────────────────────────────

/** "Send me a link": the same answer for any address. */
export function requestSignInLink(email: string, language: string): Promise<Outcome<void>> {
  return clientAttempt(() => portalPort().requestLink(email, language));
}

/** The first name on a link's own page (nothing for a used or expired link). */
export function peekSignInLink(token: string): Promise<Outcome<{ firstName: string } | null>> {
  return clientAttempt(() => portalPort().peekLink(token));
}

/** "Continue": spend the link, then read the client's own rows. A used or expired link answers `link-expired`. */
export function continueWithLink(token: string): Promise<Outcome<void>> {
  return clientAttempt(async () => {
    await portalPort().verifyLink(token);
    await loadPortal();
  });
}

/** The six-digit code from the same email, on another device. */
export function signInWithCode(email: string, code: string): Promise<Outcome<{ ok: true } | { ok: false; triesLeft: number | null }>> {
  return clientAttempt(async () => {
    const result = await portalPort().verifyCode(email, code);
    if (result.ok) await loadPortal();
    return result;
  });
}

/** "Email me a new link" from a used or expired link: to that link's own address. */
export function resendSignInLink(token: string, language: string): Promise<Outcome<void>> {
  return clientAttempt(() => portalPort().resendFromLink(token, language));
}

/** Sign out: the session ends and nothing of the client stays on the page. */
export function signOut(): Promise<Outcome<void>> {
  if (useUi.getState().preview !== null) {
    return Promise.resolve({ ok: true, value: undefined });
  }
  return attempt(async () => {
    await portalPort().signOut();
    resetPortal();
    useUi.setState({ view: "find" });
  });
}

// ── proposals ───────────────────────────────────────────────────────────────

/** Accept and sign: the typed name; Adminium stamps the rest (while sent and in date). */
export function acceptAndSign(proposalId: Id, signedName: string): Promise<Outcome<void>> {
  return clientAttempt(async () => upsertPortal("proposals", [await portalPort().accept(proposalId, signedName)]));
}

/** Sign a proposal already accepted by email, a call or in a meeting. */
export function signAccepted(proposalId: Id, signedName: string): Promise<Outcome<void>> {
  return clientAttempt(async () => upsertPortal("proposals", [await portalPort().sign(proposalId, signedName)]));
}

/** Decline, with an optional note. */
export function declineProposal(proposalId: Id, note: string | null): Promise<Outcome<void>> {
  return clientAttempt(async () => upsertPortal("proposals", [await portalPort().decline(proposalId, note)]));
}

/** Ask for a new price on a proposal past its date (once). */
export function askForNewPrice(proposalId: Id): Promise<Outcome<void>> {
  return clientAttempt(async () => upsertPortal("proposals", [await portalPort().askNewPrice(proposalId)]));
}

// ── the work ────────────────────────────────────────────────────────────────

/** Approve a shared deliverable. */
export function approveDeliverable(deliverableId: Id): Promise<Outcome<void>> {
  return clientAttempt(async () => upsertPortal("deliverables", [await portalPort().review(deliverableId, "approved", null)]));
}

/**
 * Request changes: the deliverable moves to "changes" with the note, then the
 * note is written into the conversation — two writes, one step list, so a
 * failure between them finishes rather than repeats.
 */
export function requestChanges(deliverableId: Id, versionId: Id | null, note: string): Promise<Outcome<void>> {
  if (useUi.getState().preview !== null) return clientAttempt(async () => undefined);
  const run = newRun();
  return attemptSteps(
    run,
    () => [
      { name: "review", run: async () => upsertPortal("deliverables", [await portalPort().review(deliverableId, "changes", note.trim())]) },
      {
        name: "note",
        run: async () =>
          upsertPortal("deliverable_notes", [await portalPort().addNote({ deliverable_id: deliverableId, version_id: versionId, body: note.trim(), pin_x: null, pin_y: null })]),
      },
    ],
    () => undefined,
  );
}

/** Write back on a deliverable (with a pin on the artwork when there is one). */
export function writeBack(deliverableId: Id, versionId: Id | null, body: string, pin: { x: string; y: string } | null = null): Promise<Outcome<void>> {
  return clientAttempt(async () =>
    upsertPortal("deliverable_notes", [await portalPort().addNote({ deliverable_id: deliverableId, version_id: versionId, body: body.trim(), pin_x: pin?.x ?? null, pin_y: pin?.y ?? null })]),
  );
}

// ── the brief ───────────────────────────────────────────────────────────────

/** Save one answer (the first one is kept by Adminium as it was). */
export function saveBriefAnswer(briefId: Id, questionKey: string, answer: string): Promise<Outcome<void>> {
  return clientAttempt(async () => {
    const existing = Object.values(usePortal.getState().rows.brief_answers).find((a) => a.brief_id === briefId && a.question_key === questionKey)?.id ?? null;
    upsertPortal("brief_answers", [await portalPort().saveAnswer(briefId, questionKey, answer, existing)]);
  });
}

/** Send the brief to the studio (when it was sent is Adminium's stamp). */
export function sendBrief(briefId: Id): Promise<Outcome<void>> {
  return clientAttempt(async () => upsertPortal("briefs", [await portalPort().sendBrief(briefId)]));
}

// ── invoices ────────────────────────────────────────────────────────────────

/** "I've sent a payment": once, until the studio records one. No money moves. */
export function sentAPayment(invoiceId: Id, payment: { on: Day; amount?: string | null; note?: string | null }): Promise<Outcome<void>> {
  const body: SentPayment = { on: payment.on, amount: payment.amount ?? null, note: payment.note ?? null };
  return clientAttempt(async () => upsertPortal("invoices", [await portalPort().sentPayment(invoiceId, body)]));
}
