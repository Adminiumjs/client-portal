/**
 * Signing in, as the page works it out: the typed address checked for shape
 * (and only for shape — whether it is a client's is never said), the address
 * shown back masked, the six code boxes filled by typing or pasting, the
 * server's answer to a code put into words, and where the client lands after.
 */
import { detailFromPath } from "../../../app/deepLink.ts";
import type { ClientView } from "../../../app/routes.ts";
import type { MessageKey } from "../../../i18n/index.tsx";
import type { Outcome } from "../../../state/outcome.ts";
import { SURFACE_NAV } from "../../../surface-nav.ts";
import type { CodeResult } from "../../../data/ports.ts";

export const CODE_LENGTH = 6;
/** Seconds before "Send it again" can be pressed again. */
export const RESEND_AFTER = 30;

/** "amara@hearth.example" → "a•••@hearth.example": what was typed, shown back without most of it. */
export function maskEmail(email: string): string {
  const text = email.trim();
  const at = text.lastIndexOf("@");
  if (at < 1) return text;
  return `${text.charAt(0)}•••${text.slice(at)}`;
}

/** What is wrong with a typed address, if anything: nothing typed, or not the shape of an address. */
export function emailProblem(email: string): "empty" | "shape" | null {
  const text = email.trim();
  if (text === "") return "empty";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? null : "shape";
}

export const emptyCode = (): string[] => Array.from({ length: CODE_LENGTH }, () => "");

/**
 * Put what was typed or pasted into box `at`: digits only, one per box from
 * there on. Answers the boxes and the box to move to.
 */
export function placeDigits(code: readonly string[], at: number, typed: string): { code: string[]; focus: number } {
  const digits = typed.replace(/\D/g, "");
  const next = [...code];
  if (digits === "") {
    next[at] = "";
    return { code: next, focus: at };
  }
  const room = digits.slice(0, CODE_LENGTH - at);
  room.split("").forEach((d, i) => {
    next[at + i] = d;
  });
  return { code: next, focus: Math.min(CODE_LENGTH - 1, at + room.length) };
}

/** What the page says of a code the server did not take. */
export type CodeProblem = { key: MessageKey; count?: number; locked?: boolean };

/**
 * The server's answer to a code, in words:
 *   a wrong code with tries left → how many; none left → locked for now;
 *   a code whose twenty minutes are up (or already used) → send a new one;
 *   asked too often → locked for now.
 */
export function codeProblem(outcome: Outcome<CodeResult>): CodeProblem | null {
  if (outcome.ok) {
    const result = outcome.value;
    if (result.ok) return null;
    if (result.triesLeft === null) return { key: "client.find.codeExpired" };
    if (result.triesLeft <= 0) return { key: "client.find.codeLocked", locked: true };
    return { key: "client.find.codeWrong", count: result.triesLeft };
  }
  if (outcome.reason === "link-expired") return { key: "client.find.codeExpired" };
  if (outcome.reason === "busy") return { key: "client.find.codeLocked", locked: true };
  if (outcome.reason === "offline") return { key: "save.offline" };
  if (outcome.reason === "preview") return { key: "portal.previewBlocked" };
  return { key: "client.find.failed" };
}

/** What the page says when a link could not be asked for (the same for any address). */
export function sendProblem(outcome: Outcome<void>): MessageKey | null {
  if (outcome.ok) return null;
  if (outcome.reason === "busy") return "client.find.tooMany";
  if (outcome.reason === "offline") return "save.offline";
  if (outcome.reason === "preview") return "portal.previewBlocked";
  return "client.find.failed";
}

/**
 * Where a client lands once signed in: the page a document email's link asked
 * for (`invoices/12`, `statement` — only ever one of the app's own paths),
 * else Home.
 */
export function landingOf(to: string | null | undefined): { view: ClientView; id: number | null } {
  if (to === null || to === undefined || to === "") return { view: "home", id: null };
  const detail = detailFromPath("customer", to);
  if (detail !== null) return { view: detail.view as ClientView, id: detail.id };
  // A section on its own: a page that is whole without a document (a document's page needs its number).
  const whole: readonly string[] = ["home", "statement", "brief"];
  const entry = SURFACE_NAV.find((e) => e.side === "customer" && e.path === to && whole.includes(e.view));
  return entry === undefined ? { view: "home", id: null } : { view: entry.view as ClientView, id: null };
}
