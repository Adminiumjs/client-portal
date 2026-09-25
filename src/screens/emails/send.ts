/**
 * "Send a test to ourselves": the email on screen, sent once through
 * Adminium's Email Templates test send — to the studio's OWN address and
 * nowhere else.
 *
 * The address is never one the page holds or a person types: it is the
 * studio's reply-to, read again from Adminium the moment the test goes. The
 * document is the filled email with every link into the clients' side
 * pointed at the portal's front page; it is checked for anything left to
 * fill, for a token riding a link and for every share code the desk holds,
 * and not sent if one is there. Adminium then renders and sends it.
 */
import type { LocaleTag } from "../../i18n/locales.ts";
import { asSinkError } from "../../data/sink.ts";
import { deskWrites, refreshRows, useDesk } from "../../state/desk.ts";
import { adminiumLocale, templateKey, testDocument, testProblem, type EmailDoc, type EmailKind, type TestGuard } from "./model.ts";

export type TestProblem =
  /** Nothing here can send email (no Adminium behind the page). */
  | "no-sender"
  /** The studio has no reply-to address to send the test to. */
  | "no-reply-to"
  /** The email still carries a place to fill or a live link: not sent. */
  | "live-link"
  /** Adminium has no template for this email. */
  | "no-template"
  /** Only a person who manages Adminium's settings sends tests. */
  | "not-allowed"
  /** Adminium has no email set up to send with. */
  | "no-email"
  /** The session ended. */
  | "signed-out"
  /** No answer: try again. */
  | "offline"
  /** Adminium refused it for another reason. */
  | "refused";

export type TestOutcome = { ok: true; to: string } | { ok: false; problem: TestProblem };

/** A plausible address: something, an @, a domain with a dot. */
const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** The studio's own address, read again from Adminium now. */
async function studioAddress(): Promise<string | null> {
  const held = Object.values(useDesk.getState().rows.settings)[0];
  if (held === undefined) return null;
  const [fresh] = await refreshRows("settings", [held.id]);
  const to = (fresh ?? held).reply_to?.trim() ?? "";
  return ADDRESS.test(to) ? to : null;
}

export async function sendTest(input: { kind: EmailKind; tag: LocaleTag; doc: EmailDoc; studio: boolean; guard: TestGuard }): Promise<TestOutcome> {
  const writes = deskWrites();
  if (writes.testEmail === undefined || writes.emailTemplate === undefined) return { ok: false, problem: "no-sender" };
  const document = testDocument(input.doc, input.studio, input.guard);
  if (testProblem(document, input.guard) !== null) return { ok: false, problem: "live-link" };
  try {
    const to = await studioAddress();
    if (to === null) return { ok: false, problem: "no-reply-to" };
    const key = templateKey(input.kind);
    const template = (await writes.emailTemplate(key, adminiumLocale(input.tag))) ?? (await writes.emailTemplate(key, "en_US"));
    if (template === null) return { ok: false, problem: "no-template" };
    await writes.testEmail(template.id, [to], document);
    return { ok: true, to };
  } catch (error) {
    const e = asSinkError(error);
    if (e.kind === "signed-out") return { ok: false, problem: "signed-out" };
    if (e.kind === "offline") return { ok: false, problem: "offline" };
    if (e.status === 403) return { ok: false, problem: "not-allowed" };
    if (e.status === 409 && (e.details["setting"] === "email.smtp" || e.code === "CONFLICT")) return { ok: false, problem: "no-email" };
    return { ok: false, problem: "refused" };
  }
}
