/**
 * The enquiry form on the studio's own site: anyone may send one, no sign-in.
 *
 * It goes through the portal's browser key to its own narrow door: the
 * human check first (the public client solves it and asks again), then
 * a create Adminium makes a NEW enquiry from the WEB whatever was sent,
 * numbered and stamped with when it came, and limited — so many a day from
 * one address, so many an hour on the key (`PUBLIC_LIMIT_REACHED`). The
 * studio hears about it by email when its "Tell us about new enquiries"
 * switch is on. Nothing comes back but when it arrived.
 *
 * Kept apart from the desk's actions: the clients' bundle carries nothing of
 * the desk.
 */
import { PortError, type EnquiryForm, type EnquiryReceipt } from "../data/ports.ts";
import { SinkError } from "../data/sink.ts";
import { attempt, refusalOf, type Outcome } from "./outcome.ts";
import { portalPort } from "./portal.ts";
import { useUi } from "./ui.ts";

export type { Outcome } from "./outcome.ts";

/** An address shape good enough to answer (Adminium checks it again). */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const refused = <T>(code: string, field: string): Outcome<T> => refusalOf<T>(new SinkError(code, "refused", 422, code, field));

/** What the form must say before it is sent. */
export function enquiryProblem(form: EnquiryForm): { code: string; field: string } | null {
  if (form.name.trim() === "") return { code: "NAME_REQUIRED", field: "name" };
  if (!EMAIL.test(form.email.trim())) return { code: "EMAIL_REQUIRED", field: "email" };
  if (form.body.trim() === "") return { code: "BODY_REQUIRED", field: "body" };
  return null;
}

/** Send an enquiry: one create, behind the human check. Refused in the studio's preview before anything is sent. */
export function sendEnquiry(form: EnquiryForm): Promise<Outcome<EnquiryReceipt>> {
  if (useUi.getState().preview !== null) return Promise.resolve(refusalOf<EnquiryReceipt>(new PortError("PREVIEW", "a preview cannot act for a visitor")));
  const problem = enquiryProblem(form);
  if (problem !== null) return Promise.resolve(refused(problem.code, problem.field));
  return attempt(() => portalPort().sendEnquiry(form));
}
