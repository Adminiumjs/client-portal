/**
 * The studio's emails: the `messages` table is the outbox, and every email is
 * a row in it that the desk can read, approve, edit, send early or skip.
 *
 * To clients:
 *   proposal-sent, invoice-sent   when a proposal or an invoice is sent;
 *   payment-receipt               when a payment is recorded;
 *   invoice-rung-1/2/3            the reminders about an unpaid invoice. They
 *                                 are made when the invoice is sent, each due
 *                                 on its day of the invoice's ladder, and HELD:
 *                                 none goes out until someone approves it.
 *                                 A later one coming due overtakes the earlier
 *                                 ones, and paying or voiding the invoice
 *                                 drops them. Sending the third pauses the
 *                                 project, as the terms the client agreed say;
 *   new-work                      when work is shared for review (one email
 *                                 per project in ten minutes, however many
 *                                 files);
 *   proposal-reminder, handover,  written by the desk.
 *   enquiry-reply, ask-to-sign
 *
 * To the studio (its reply-to address, each behind its own switch in
 * Settings): a proposal accepted and signed, declined, or a new price asked
 * for; work approved or sent back; a note from a client; a client saying they
 * paid; a brief sent.
 *
 * The log is the dedupe: a kind already queued or sent for the same row is not
 * queued again.
 */

/** A studio notice: to the settings' reply-to address, behind its own switch. */
const notice = (kind: string, link: string, source: Record<string, unknown>, notify: string) => ({
  kind,
  link,
  recipient: { setting: { table: "settings", column: "reply_to" } },
  gate: { setting: { table: "settings", column: notify } },
  ...source,
});

/** An invoice's three reminders: each its day of the ladder after the due date, held for approval. */
const rung = (n: number) => ({
  kind: `invoice-rung-${String(n + 1)}`,
  link: "invoice_id",
  onChange: { table: "invoices", column: "status", to: "sent" },
  hold: true,
  due: { date: "due_on", days: { setting: { addOn: "invoices", setting: "ladders" }, byColumn: "ladder", index: n }, at: "09:00" },
  supersede: "rungs",
  dropWhen: [
    { column: "balance", lte: 0, reason: "paid" },
    { column: "status", eq: "void", reason: "void" },
  ],
  // The third reminder pauses the project, as clause 6 of the terms says.
  ...(n === 2 ? { onSent: { table: "projects", via: "project_id", set: { status: "paused" } } } : {}),
});

export const KINDS = [
  "proposal-sent",
  "proposal-reminder",
  "new-work",
  "handover",
  "enquiry-reply",
  "ask-to-sign",
  "accepted-and-signed",
  "declined",
  "changes-requested",
  "approved",
  "client-says-paid",
  "brief-sent",
  "asked-for-a-new-price",
  "new-note",
  "invoice-sent",
  "invoice-rung-1",
  "invoice-rung-2",
  "invoice-rung-3",
  "payment-receipt",
] as const;
export type Kind = (typeof KINDS)[number];

export const OUTBOX = {
  table: "messages",
  columns: {
    kind: "kind",
    status: "status",
    to: "to",
    language: "language",
    due: "due",
    sentAt: "sent_at",
    error: "error",
    skipReason: "skip_reason",
    subjectOverride: "subject_override",
    bodyOverride: "body_override",
    approvedBy: "approved_by",
    effectAt: "effect_at",
    effectError: "effect_error",
  },
  links: {
    client: "client_id",
    proposal: "proposal_id",
    invoice: "invoice_id",
    payment: "payment_id",
    project: "project_id",
    deliverable: "deliverable_id",
    enquiry: "enquiry_id",
  },
  recipient: {
    via: "client_id",
    table: "clients",
    email: "email",
    name: "contact_name",
    language: "language",
    // An enquiry is answered before its sender is a client.
    fallback: { via: "enquiry_id", email: "email", name: "name" },
  },
  settings: { table: "settings", name: "name", phone: "phone" },
  // A handover's link opens its page on the clients' side; its code rides the fragment.
  pages: { manage: "/h", booking: "/" },
  kinds: Object.fromEntries(KINDS.map((kind) => [kind, `clients-${kind}`])),
  producers: [
    // ── to clients ──────────────────────────────────────────────────────────
    { kind: "proposal-sent", link: "proposal_id", onChange: { table: "proposals", column: "status", to: "sent" } },
    { kind: "invoice-sent", link: "invoice_id", onChange: { table: "invoices", column: "status", to: "sent" } },
    rung(0),
    rung(1),
    rung(2),
    { kind: "payment-receipt", link: "payment_id", onCreate: { table: "payments" } },
    // Work shared for review, or a new version of it: one email per project in ten minutes.
    { kind: "new-work", link: "project_id", onChange: { table: "deliverables", via: "project_id", column: "status", to: "pending" }, batchMinutes: 10 },

    // ── to the studio ───────────────────────────────────────────────────────
    notice("accepted-and-signed", "proposal_id", { onChange: { table: "proposals", column: "status", to: "accepted" } }, "notify_accepted"),
    notice("declined", "proposal_id", { onChange: { table: "proposals", column: "status", to: "declined" } }, "notify_declined"),
    notice("asked-for-a-new-price", "proposal_id", { onChange: { table: "proposals", column: "new_price_asked", to: true } }, "notify_new_price"),
    notice("changes-requested", "deliverable_id", { onChange: { table: "deliverables", column: "status", to: "changes" } }, "notify_files"),
    // The desk marking work approved is not news to the desk: only the portal's approvals.
    notice("approved", "deliverable_id", { onChange: { table: "deliverables", column: "status", to: "approved", where: { column: "approved_how", eq: "portal" } } }, "notify_files"),
    notice("new-note", "deliverable_id", { onCreate: { table: "deliverable_notes", via: "deliverable_id", where: { column: "side", eq: "client" } } }, "notify_notes"),
    notice("client-says-paid", "invoice_id", { onChange: { table: "invoices", column: "client_paid", to: true } }, "notify_paid"),
    notice("brief-sent", "project_id", { onChange: { table: "briefs", via: "project_id", column: "status", to: "sent" } }, "notify_brief"),
  ],
};
