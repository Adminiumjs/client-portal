/**
 * The values an email preview is filled with: the studio's own rows, as the
 * outbox would read them for a real email of that kind — the newest sent
 * invoice for "Invoice sent", the latest payment for the receipt, the most
 * overdue invoice for the reminders — in the email's language.
 *
 * Links are never the real ones. A sign-in link and a share link open the
 * client's documents to whoever holds them, so the preview writes the
 * address with its token left out, and a test send points the button at the
 * portal's front page (`model.ts` `testDocument`). A share code the desk
 * holds never enters a value.
 */
import type { Held } from "../../state/desk.ts";
import { ensureRows, isInDate, isOverdue, loadWhere, useDesk } from "../../state/desk.ts";
import type { Client, Day, Deliverable, Enquiry, Invoice, Payment, Project, Proposal, Settings } from "../../data/types.ts";
import type { LocaleTag } from "../../i18n/locales.ts";
import { dirFor } from "../../i18n/locales.ts";
import { paramFormatter } from "../../i18n/numbers.ts";
import { dayLabel, daysLate } from "../../lib/dates.ts";
import { formatMoney, isolateMoney } from "../../lib/money.ts";
import type { EmailKind } from "./model.ts";

/** The rows one email is about. */
export interface Picked {
  client?: Client;
  proposal?: Proposal;
  invoice?: Invoice;
  payment?: Payment;
  project?: Project;
  deliverable?: Deliverable;
  enquiry?: Enquiry;
}

/**
 * The rows the samples read beyond the open work the desk holds: the latest
 * payment (and its invoice), the latest finished project and the latest
 * declined proposal, with their clients. One row each.
 */
export async function loadSampleRows(): Promise<void> {
  await Promise.all([
    loadWhere("payments", { column: "voided", op: "eq", value: false }, "recorded_at.desc", 1).then(async (payments) => {
      await ensureRows("invoices", payments.map((p) => p.document_id));
      const held = useDesk.getState().rows.invoices;
      await ensureRows("clients", payments.map((p) => p.client_id ?? held[p.document_id]?.client_id ?? null));
    }),
    loadWhere("projects", { column: "status", op: "eq", value: "done" }, "done_on.desc", 1).then((projects) => ensureRows("clients", projects.map((p) => p.client_id))),
    loadWhere("proposals", { column: "status", op: "eq", value: "declined" }, "decided_at.desc", 1).then((proposals) => ensureRows("clients", proposals.map((p) => p.client_id))),
  ]);
}

const newest = <T>(rows: T[], key: (row: T) => string | null): T | undefined => [...rows].sort((a, b) => (key(b) ?? "").localeCompare(key(a) ?? ""))[0];

/** The rows an email of this kind would be about, from what the desk holds. */
export function pick(kind: EmailKind, held: Held, today: Day): Picked {
  const proposals = Object.values(held.proposals);
  const invoices = Object.values(held.invoices);
  const projects = Object.values(held.projects);
  const deliverables = Object.values(held.deliverables);
  const sent = proposals.filter((p) => p.status === "sent");
  const inDate = sent.filter((p) => isInDate(p, today));
  const openSent = invoices.filter((i) => i.status === "sent");
  const withClient = (picked: Picked): Picked => {
    const clientId = picked.proposal?.client_id ?? picked.invoice?.client_id ?? picked.project?.client_id ?? picked.enquiry?.client_id ?? null;
    return clientId === null ? picked : { ...picked, client: held.clients[clientId] };
  };
  const ofProject = (project: Project | undefined, deliverable?: Deliverable): Picked => withClient({ ...(project === undefined ? {} : { project }), ...(deliverable === undefined ? {} : { deliverable }) });
  const byStatus = (status: Deliverable["status"]) => newest(deliverables.filter((d) => d.status === status), (d) => d.reviewed_at ?? d.shared_at);
  const deliverableCase = (d: Deliverable | undefined): Picked => (d === undefined ? ofProject(projects.find((p) => p.status === "active")) : ofProject(held.projects[d.project_id], d));
  const proposalCase = (p: Proposal | undefined): Picked => withClient(p === undefined ? {} : { proposal: p });

  switch (kind) {
    case "sign-in-link":
    case "proposal-sent":
    case "proposal-reminder":
      return proposalCase(newest(inDate, (p) => p.sent_at) ?? newest(sent, (p) => p.sent_at) ?? newest(proposals, (p) => p.sent_at));
    case "ask-to-sign":
      return proposalCase(proposals.find((p) => p.status === "accepted" && (p.signed_name ?? "").trim() === "" && p.accepted_how !== "portal") ?? proposals.find((p) => p.status === "accepted") ?? newest(sent, (p) => p.sent_at));
    case "accepted-and-signed":
      return proposalCase(newest(proposals.filter((p) => p.status === "accepted" && (p.signed_name ?? "") !== ""), (p) => p.decided_at) ?? proposals.find((p) => p.status === "accepted"));
    case "declined":
      return proposalCase(newest(proposals.filter((p) => p.status === "declined"), (p) => p.decided_at) ?? newest(sent, (p) => p.sent_at));
    case "asked-for-a-new-price":
      return proposalCase(proposals.find((p) => p.new_price_asked) ?? newest(sent, (p) => p.sent_at));
    case "invoice-sent":
      return withClient({ invoice: newest(openSent, (i) => i.sent_at) ?? newest(invoices, (i) => i.issued_on) });
    case "invoice-rung-1":
    case "invoice-rung-2":
    case "invoice-rung-3": {
      const late = openSent.filter((i) => isOverdue(i, today)).sort((a, b) => (a.due_on ?? "").localeCompare(b.due_on ?? ""))[0];
      return withClient({ invoice: late ?? newest(openSent, (i) => i.due_on) });
    }
    case "client-says-paid":
      return withClient({ invoice: newest(openSent.filter((i) => i.client_paid === true), (i) => i.client_paid_at) ?? newest(openSent, (i) => i.sent_at) });
    case "payment-receipt": {
      const payment = newest(Object.values(held.payments).filter((p) => !p.voided), (p) => p.recorded_at ?? p.paid_on);
      const invoice = payment === undefined ? undefined : held.invoices[payment.document_id];
      return withClient({ ...(payment === undefined ? {} : { payment }), ...(invoice === undefined ? {} : { invoice }) });
    }
    case "new-work":
      return deliverableCase(byStatus("pending"));
    case "changes-requested":
      return deliverableCase(byStatus("changes"));
    case "approved":
      return deliverableCase(byStatus("approved") ?? byStatus("pending"));
    case "new-note":
      return deliverableCase(byStatus("changes") ?? byStatus("pending"));
    case "brief-sent":
      return ofProject(projects.find((p) => p.status === "active") ?? projects[0]);
    case "handover":
      return ofProject(newest(projects.filter((p) => p.status === "done"), (p) => p.done_on));
    case "enquiry-reply":
    case "new-enquiry": {
      const enquiry = newest(Object.values(held.enquiries), (e) => e.received_at);
      return withClient(enquiry === undefined ? {} : { enquiry });
    }
  }
}

/** Where links point in a preview: the clients' side and the desk, as this page reaches them. */
export interface Places {
  /** The clients' side's address, ending in `/`. */
  portal: string;
  /** The desk's address, ending in `/`. */
  staff: string;
}

/** The two sides' addresses from where this page is served (`…/apps/<app>/staff/…`). */
export function placesFrom(origin: string, pathname: string): Places {
  const at = pathname.indexOf("/staff/");
  if (at >= 0) {
    const base = pathname.slice(0, at);
    return { portal: `${origin}${base}/customer/`, staff: `${origin}${base}/staff/` };
  }
  const here = pathname.endsWith("/") ? pathname : pathname.slice(0, pathname.lastIndexOf("/") + 1);
  return { portal: `${origin}${here}`, staff: `${origin}${here}` };
}

/** What a sign-in link or a share link shows in a preview: the address, its token left out. */
export const HIDDEN_TOKEN = "••••••";

export interface SampleContext {
  tag: LocaleTag;
  today: Day;
  settings: Settings | null;
  /** The add-on's payment instructions (its public setting). */
  payHow: string | null;
  places: Places;
  /** A sample six-digit code for the sign-in link. */
  code: string;
}

const first = (name: string | null | undefined): string => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** The values a template's places are filled with, for the rows picked. */
export function valuesFor(picked: Picked, ctx: SampleContext): Record<string, string> {
  const { tag, settings } = ctx;
  const dir = dirFor(tag);
  const money = (value: string | null | undefined, currency: string | null | undefined) => (value === null || value === undefined ? "" : isolateMoney(formatMoney(value, currency ?? "USD", tag), dir));
  const day = (d: Day | null | undefined) => (d === null || d === undefined ? "" : dayLabel(d, tag, "long"));
  // A count in the email's own digits, as its amounts and dates are.
  const said = paramFormatter(tag);
  const v: Record<string, string> = {
    "practice.name": settings?.name ?? "",
    "practice.reply_to": settings?.reply_to ?? "",
    "practice.phone": settings?.phone ?? "",
    "practice.sign_off": settings?.sign_off ?? settings?.name ?? "",
    "addOn.invoices.payment_instructions": ctx.payHow ?? "",
    signInLink: `${ctx.places.portal}c#${HIDDEN_TOKEN}`,
    manage_url: `${ctx.places.portal}h`,
    staff_url: ctx.places.staff,
    appName: settings?.name ?? "",
    minutes: said(20),
    link: `${ctx.places.portal}c#${HIDDEN_TOKEN}`,
    code: ctx.code,
  };
  const { client, proposal, invoice, payment, project, deliverable, enquiry } = picked;
  if (client !== undefined) {
    v["client.company"] = client.company;
    v["client.contact_name"] = client.contact_name;
    v["recipient.first_name"] = first(client.contact_name);
  }
  if (proposal !== undefined) {
    v["proposal.id"] = String(proposal.id);
    v["proposal.number"] = proposal.number ?? "";
    v["proposal.title"] = proposal.title;
    v["proposal.total"] = money(proposal.total, proposal.currency);
    v["proposal.valid_until.date"] = day(proposal.valid_until);
    v["proposal.decline_note"] = proposal.decline_note ?? "";
  }
  if (invoice !== undefined) {
    v["invoice.id"] = String(invoice.id);
    v["invoice.number"] = invoice.number ?? "";
    v["invoice.title"] = invoice.title ?? "";
    v["invoice.total"] = money(invoice.total, invoice.currency);
    v["invoice.balance"] = money(invoice.balance, invoice.currency);
    v["invoice.due_on.date"] = day(invoice.due_on);
    v["invoice.due_on.days_since"] = said(Math.max(0, invoice.due_on === null ? 0 : daysLate(invoice.due_on, ctx.today)));
    v["invoice.client_paid_amount"] = money(invoice.client_paid_amount ?? invoice.balance, invoice.currency);
    v["invoice.client_paid_on.date"] = day(invoice.client_paid_on ?? ctx.today);
    v["invoice.client_paid_note"] = invoice.client_paid_note ?? "";
  }
  if (payment !== undefined) {
    v["payment.number"] = payment.number ?? "";
    v["payment.amount"] = money(payment.amount, payment.currency ?? invoice?.currency);
    v["payment.paid_on.date"] = day(payment.paid_on);
  }
  if (project !== undefined) {
    v["project.id"] = String(project.id);
    v["project.number"] = project.number ?? "";
    v["project.name"] = project.name;
    // The share code opens the handover to anyone who has it: a preview never shows it.
    v["project.share_token"] = HIDDEN_TOKEN;
  }
  if (deliverable !== undefined) {
    v["deliverable.title"] = deliverable.title;
    v["deliverable.review_note"] = deliverable.review_note ?? "";
    v["deliverable.approved_on.date"] = day(deliverable.approved_on ?? ctx.today);
  }
  if (enquiry !== undefined) {
    v["enquiry.name"] = enquiry.name;
    v["enquiry.number"] = enquiry.number ?? "";
    v["enquiry.business"] = enquiry.business ?? enquiry.name;
    v["enquiry.body"] = enquiry.body ?? "";
    if (client === undefined) v["recipient.first_name"] = first(enquiry.name);
  }
  return v;
}

/** Who the email goes to: the client (or the one who enquired), else the studio's own address. */
export function recipientOf(kind: EmailKind, picked: Picked, settings: Settings | null, studio: boolean): string {
  if (studio) return settings?.reply_to ?? "";
  if (kind === "enquiry-reply") return picked.enquiry?.email ?? "";
  return picked.client?.email ?? "";
}

/** Where "Follow the link" goes: the client's page (seen as the studio's preview), the desk's page, or nowhere. */
export type Follow =
  | { to: "client"; clientId: number; view: "home" | "proposal" | "invoice" | "project"; id: number | null }
  | { to: "desk"; view: "proposal" | "invoice" | "project" | "handover" | "enquiries"; id: number | null }
  | { to: "none" };

export function followOf(kind: EmailKind, picked: Picked): Follow {
  const clientId = picked.client?.id;
  switch (kind) {
    case "enquiry-reply":
      return { to: "none" };
    case "new-enquiry":
      return { to: "desk", view: "enquiries", id: null };
    case "handover":
      return picked.project === undefined ? { to: "none" } : { to: "desk", view: "handover", id: picked.project.id };
    case "accepted-and-signed":
    case "declined":
    case "asked-for-a-new-price":
      return picked.proposal === undefined ? { to: "none" } : { to: "desk", view: "proposal", id: picked.proposal.id };
    case "changes-requested":
    case "approved":
    case "new-note":
    case "brief-sent":
      return picked.project === undefined ? { to: "none" } : { to: "desk", view: "project", id: picked.project.id };
    case "client-says-paid":
      return picked.invoice === undefined ? { to: "none" } : { to: "desk", view: "invoice", id: picked.invoice.id };
    default:
      break;
  }
  if (clientId === undefined) return { to: "none" };
  if (kind === "sign-in-link") return { to: "client", clientId, view: "home", id: null };
  if (picked.proposal !== undefined) return { to: "client", clientId, view: "proposal", id: picked.proposal.id };
  if (picked.invoice !== undefined) return { to: "client", clientId, view: "invoice", id: picked.invoice.id };
  if (picked.project !== undefined) return { to: "client", clientId, view: "project", id: picked.project.id };
  return { to: "client", clientId, view: "home", id: null };
}
