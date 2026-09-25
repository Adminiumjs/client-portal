/**
 * The studio's emails, one template per outbox kind, in the eight languages
 * the app ships.
 *
 * Each email's words are a small record of sentences (`Words`), and the
 * layout that holds them is written once below, so a translation is only the
 * words — nobody re-builds a block list per language, and no language can
 * lose a block the others have.
 *
 * `{{…}}` are the outbox's variables, filled by Adminium when it sends:
 * `proposal.*`, `invoice.*`, `payment.*`, `project.*`, `deliverable.*`,
 * `client.*`, `enquiry.*` through the message's links; `practice.*` the
 * studio's settings row; `recipient.first_name` the client; `signInLink` a
 * one-use sign-in link to what the email is about (minted when the email is
 * sent, and only for the client's current address); `staff_url` the desk;
 * `manage_url` the clients' side's handover page; `addOn.invoices.*` the
 * Invoices & Receipts add-on's public settings. A date reads in the client's
 * language (`.date`), `.days_since` counts the days since it; money reads in
 * the document's own currency.
 *
 * Emails to clients are signed with the studio's sign-off and end with how to
 * reach the studio; the studio's own notices are plain, to its reply-to
 * address. A block that holds only an optional value (a note, the payment
 * instructions) is left out when the value is empty.
 */
import type { Tag } from "./labels.ts";
import { EMAIL_TRANSLATIONS } from "./email-words.ts";
import type { Kind } from "./outbox.ts";

/** One email's sentences. */
export interface Words {
  name: string;
  subject: string;
  preheader?: string;
  /** The studio notices' first line: what it is about. */
  lead?: string;
  paras: string[];
  list?: string[];
  box?: { label: string; value: string };
  /** A line of the payment instructions' box. */
  reference?: string;
  button?: string;
}

export type EmailWords = Record<Kind, Words> & { clientFoot: string; studioFoot: string; greeting: string };

export const EMAIL_EN: EmailWords = {
  greeting: "Hello {{recipient.first_name}},",
  clientFoot: "{{practice.name}} · {{practice.reply_to}} · {{practice.phone}}. Reply to this email and one of us reads it.",
  studioFoot: "Sent by {{practice.name}} to {{practice.reply_to}}. Change what we tell you in Settings.",
  "proposal-sent": {
    name: "Proposal sent",
    subject: "Proposal for {{client.company}} — {{proposal.number}}",
    preheader: "{{proposal.title}} · {{proposal.total}}",
    paras: [
      "Here is our proposal for {{proposal.title}}: what it covers, what it costs, and how it is paid.",
      "If you are happy with it, accept and sign it in the portal by typing your name. Declining is a normal answer, and you can tell us why in the same place.",
    ],
    button: "Read {{proposal.number}}",
  },
  "proposal-reminder": {
    name: "Proposal reminder",
    subject: "{{proposal.number}} holds until {{proposal.valid_until.date}}",
    paras: [
      "A short note in case our proposal for {{proposal.title}} got buried. It holds until {{proposal.valid_until.date}}.",
      "Accept and sign it in the portal, or tell us what would make it work.",
    ],
    button: "Read {{proposal.number}}",
  },
  "new-work": {
    name: "New work to review",
    subject: "New work to look at — {{project.name}}",
    paras: ["New work is ready for you to look at in {{project.name}}.", "Approve it, or tell us what should change — either is useful."],
    button: "Review now",
  },
  handover: {
    name: "Handover",
    subject: "Everything from {{project.name}}",
    paras: [
      "{{project.number}} is closed. Everything sits on one page — the artwork, the source files, the fonts and a note on what to do when you print again.",
      "You can forward the link to your printer. It opens without signing in.",
    ],
    button: "Open the handover",
  },
  "enquiry-reply": {
    name: "Reply to an enquiry",
    subject: "Re: your note to {{practice.name}}",
    paras: [
      "Thank you for getting in touch.",
      "Could we talk for half an hour next week? We will come back to you with a short proposal after that, usually within a few days.",
    ],
  },
  "ask-to-sign": {
    name: "Ask to sign",
    subject: "One thing to sign for {{proposal.number}}",
    paras: [
      "You accepted {{proposal.title}} before we used the portal. Could you sign it there? It takes a minute — you read the terms and type your name.",
    ],
    button: "Read and sign",
  },
  "invoice-sent": {
    name: "Invoice sent",
    subject: "{{invoice.number}} from {{practice.name}} — {{invoice.total}}",
    preheader: "Due {{invoice.due_on.date}} · {{invoice.total}}",
    paras: ["Here is {{invoice.number}} — {{invoice.title}}."],
    list: ["{{invoice.number}} · due {{invoice.due_on.date}} · {{invoice.total}}"],
    box: { label: "How to pay", value: "{{addOn.invoices.payment_instructions}}" },
    reference: "Reference: {{invoice.number}}",
    button: "View {{invoice.number}}",
  },
  "invoice-rung-1": {
    name: "First reminder",
    subject: "{{invoice.number}} — in case it slipped",
    paras: [
      "No alarm at all — {{invoice.number}} came due on {{invoice.due_on.date}} and I do not think it has landed yet. If it is already in your payment run, ignore me entirely.",
      "{{invoice.balance}} on {{invoice.title}}.",
    ],
    button: "View {{invoice.number}}",
  },
  "invoice-rung-2": {
    name: "Second reminder",
    subject: "{{invoice.number}} is now {{invoice.due_on.days_since}} days past due",
    paras: [
      "{{invoice.number}} is {{invoice.due_on.days_since}} days past due — {{invoice.balance}} outstanding. Can you tell me when it will be paid, or whether it needs splitting in two?",
      "Part payments are fine and easy to set up. Silence is the only thing that makes this awkward.",
    ],
    button: "View {{invoice.number}}",
  },
  "invoice-rung-3": {
    name: "Third reminder",
    subject: "{{invoice.number}} is {{invoice.due_on.days_since}} days past due — our work pauses until it clears",
    paras: [
      "{{invoice.number}} is {{invoice.due_on.days_since}} days past due — {{invoice.balance}} outstanding. Under clause 6 of the terms you agreed, any work we have under way for you pauses from today rather than running up against an unpaid invoice. It is not personal.",
      "Nothing is lost. The day it clears we pick up where we stopped.",
    ],
    button: "View {{invoice.number}}",
  },
  "payment-receipt": {
    name: "Receipt",
    subject: "Thank you — we received {{payment.amount}}",
    paras: ["Thank you — we received {{payment.amount}} against {{invoice.number}} on {{payment.paid_on.date}}."],
    list: ["{{payment.number}} · for {{invoice.number}} · {{payment.amount}}", "Balance left · due {{invoice.due_on.date}} · {{invoice.balance}}"],
    button: "View the receipt",
  },
  "accepted-and-signed": {
    name: "Accepted and signed",
    subject: "{{client.contact_name}} accepted and signed {{proposal.number}}",
    lead: "{{proposal.number}} — {{proposal.title}}",
    paras: ["{{client.contact_name}} at {{client.company}} typed their name and accepted it in the portal. The terms they agreed to are pinned to the record."],
    button: "Start the project",
  },
  declined: {
    name: "Declined",
    subject: "{{client.contact_name}} declined {{proposal.number}}",
    lead: "{{proposal.number}} — {{proposal.title}}",
    paras: ["{{client.contact_name}} at {{client.company}} declined it. Their note:", "{{proposal.decline_note}}"],
    button: "Open {{proposal.number}}",
  },
  "asked-for-a-new-price": {
    name: "Asked for a new price",
    subject: "{{client.contact_name}} asked for a new price on {{proposal.number}}",
    lead: "{{proposal.number}} — {{proposal.title}}",
    paras: ["It held until {{proposal.valid_until.date}}. {{client.contact_name}} at {{client.company}} would like a new price for it."],
    button: "Open {{proposal.number}}",
  },
  "changes-requested": {
    name: "Changes asked",
    subject: "{{client.contact_name}} asked for changes on {{deliverable.title}}",
    lead: "{{project.number}} — {{project.name}}",
    paras: ["{{client.contact_name}} sent {{deliverable.title}} back. Their note:", "{{deliverable.review_note}}"],
    button: "Open the review",
  },
  approved: {
    name: "Approved",
    subject: "{{client.contact_name}} approved {{deliverable.title}}",
    lead: "{{project.number}} — {{project.name}}",
    paras: ["{{client.contact_name}} approved {{deliverable.title}} in the portal on {{deliverable.approved_on.date}}."],
    button: "Open the project",
  },
  "new-note": {
    name: "New note from a client",
    subject: "A note from {{client.contact_name}} on {{deliverable.title}}",
    lead: "{{project.number}} — {{project.name}}",
    paras: ["{{client.contact_name}} wrote a note on {{deliverable.title}}. It is in the review, beside the version they looked at."],
    button: "Open the review",
  },
  "client-says-paid": {
    name: "Client says paid",
    subject: "{{client.contact_name}} says they paid {{invoice.number}}",
    lead: "{{invoice.number}} — {{invoice.title}}",
    paras: [
      "{{client.contact_name}} says they sent {{invoice.client_paid_amount}} on {{invoice.client_paid_on.date}}. Nothing is recorded until one of us checks the bank and records it.",
      "{{invoice.client_paid_note}}",
    ],
    button: "Record the payment",
  },
  "brief-sent": {
    name: "Brief sent",
    subject: "{{client.company}} sent their brief",
    lead: "{{project.number}} — {{project.name}}",
    paras: ["{{client.contact_name}} answered the kickoff questions. The answers are on the project page, under Their brief."],
    button: "Open the project",
  },
};

type Block = { block: string; id: string; data: Record<string, unknown> };
const para = (id: string, ...paras: string[]): Block => ({ block: "email.text", id, data: { paras } });

/** Where each email's button leads: the client's side through a sign-in link, or the desk. */
const BUTTON: Record<Kind, string | null> = {
  "proposal-sent": "{{signInLink}}",
  "proposal-reminder": "{{signInLink}}",
  "new-work": "{{signInLink}}",
  handover: "{{manage_url}}#{{project.share_token}}",
  "enquiry-reply": null,
  "ask-to-sign": "{{signInLink}}",
  "invoice-sent": "{{signInLink}}",
  "invoice-rung-1": "{{signInLink}}",
  "invoice-rung-2": "{{signInLink}}",
  "invoice-rung-3": "{{signInLink}}",
  "payment-receipt": "{{signInLink}}",
  "accepted-and-signed": "{{staff_url}}proposals/{{proposal.id}}",
  declined: "{{staff_url}}proposals/{{proposal.id}}",
  "asked-for-a-new-price": "{{staff_url}}proposals/{{proposal.id}}",
  "changes-requested": "{{staff_url}}projects/{{project.id}}",
  approved: "{{staff_url}}projects/{{project.id}}",
  "new-note": "{{staff_url}}projects/{{project.id}}",
  "client-says-paid": "{{staff_url}}invoices/{{invoice.id}}",
  "brief-sent": "{{staff_url}}projects/{{project.id}}",
};

/** The notices to the studio: plain, no greeting and no sign-off. */
const STUDIO: ReadonlySet<Kind> = new Set([
  "accepted-and-signed",
  "declined",
  "asked-for-a-new-price",
  "changes-requested",
  "approved",
  "new-note",
  "client-says-paid",
  "brief-sent",
]);

/** A notice's second sentence is the client's own words, quoted. */
const QUOTED: ReadonlySet<Kind> = new Set(["declined", "changes-requested", "client-says-paid"]);

function layout(kind: Kind, all: EmailWords) {
  const w = all[kind];
  const blocks: Block[] = [];
  const studio = STUDIO.has(kind);
  if (studio) {
    if (w.lead !== undefined) blocks.push({ block: "email.heading", id: "lead", data: { text: w.lead } });
    blocks.push(para("body", w.paras[0]!));
    if (QUOTED.has(kind) && w.paras[1] !== undefined) blocks.push({ block: "email.quote", id: "their-note", data: { text: w.paras[1] } });
  } else {
    blocks.push(para("greeting", all.greeting));
    blocks.push(para("body", ...w.paras));
    if (w.list !== undefined) blocks.push({ block: "email.list", id: "details", data: { items: w.list } });
    if (w.box !== undefined) {
      blocks.push({ block: "email.box", id: "how-to-pay", data: { label: w.box.label, value: w.box.value } });
      if (w.reference !== undefined) blocks.push(para("reference", w.reference));
    }
  }
  const url = BUTTON[kind];
  if (url !== null && w.button !== undefined) blocks.push({ block: "email.button", id: "open", data: { label: w.button, url } });
  // The studio's own sign-off, in its words.
  if (!studio) blocks.push(para("sign-off", "{{practice.sign_off}}"));
  return {
    subject: w.subject,
    ...(w.preheader === undefined ? {} : { preheader: w.preheader }),
    blocks,
    footer: studio ? all.studioFoot : all.clientFoot,
  };
}

/** Every language's words: English here, the other seven in `email-words.ts`. */
export function emailWords(): Record<Tag, EmailWords> {
  return { "en-US": EMAIL_EN, ...EMAIL_TRANSLATIONS };
}

/** The variables each template reads, for the template editor's list. */
function varsOf(words: Words): string[] {
  const text = JSON.stringify(words);
  const found = new Set<string>(["practice.name", "practice.reply_to", "practice.phone"]);
  for (const [, name] of text.matchAll(/\{\{([A-Za-z_.]+)\}\}/g)) found.add(name!);
  // The editor lists what reads a row; `signInLink` and the add-on's settings are filled, not listed.
  return [...found].filter((name) => /^[a-z_]+(\.[a-z_]+)*$/.test(name)).sort();
}

/** The manifest's `emailTemplates`: one per kind, each in all eight languages. */
export function emailTemplates(kinds: readonly Kind[]): unknown[] {
  const words = emailWords();
  return kinds.map((kind) => ({
    key: `clients-${kind}`,
    name: Object.fromEntries(Object.entries(words).map(([tag, w]) => [tag, w[kind].name])),
    vars: varsOf(EMAIL_EN[kind]),
    locales: Object.fromEntries(Object.entries(words).map(([tag, w]) => [tag, layout(kind, w)])),
  }));
}
