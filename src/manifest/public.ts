/**
 * What the clients' side may do, entry by entry. Adminium serves each entry
 * through a browser key the install creates and refuses anything else.
 *
 * A CLIENT SIGNS IN BY AN EMAILED LINK. They type their address; whatever
 * they typed, the answer is the same, and only the link (or the six-digit code
 * in the same email, on another device) opens a session — at the verified
 * level every entry below asks for. Typing a client's address opens nothing.
 *
 * Everything a client reads is their own: a proposal, project or invoice
 * whose `client_id` is the signed-in client; a line, a milestone, a version
 * or a payment only where its parent row is readable (`visibleWith`), never
 * by the `client_id` a child row carries for the desk's lists. Drafts, void
 * reasons, voided payments, private notes, the emails, the rate card and the
 * time kept never leave the desk. Another client's id and an unknown id answer
 * the same "not found".
 *
 * A HANDOVER is shared by link: an unguessable code opens one finished
 * project's handover — its notes, fonts, files and approved work — on a key of
 * its own that reads and changes nothing else, until the studio stops the link
 * or it expires.
 *
 * Every value a client triggers but must not choose is the server's: the time
 * they signed and with which address, how a proposal was accepted, the
 * fingerprint of what they agreed to, when they said they had paid.
 */

const verified = { level: "verified" } as const;
const mine = { claimedBy: { table: "clients", column: "client_id" }, ...verified } as const;
const under = (table: string, via: string) => ({ visibleWith: { table, via }, ...verified });

/** What a client sees of a proposal and its lines. */
const PROPOSAL_COLUMNS = [
  "id",
  "number",
  "status",
  "title",
  "scope",
  "split",
  "valid_until",
  "currency",
  "tax_name",
  "tax_rate",
  "subtotal",
  "tax",
  "total",
  "terms_version_id",
  "revision_of",
  "sent_at",
  "decided_at",
  "signed_name",
  "signed_email",
  "signed_at",
  "fingerprint",
  "accepted_how",
  "decline_note",
  "new_price_asked_at",
];
const LINE_COLUMNS = ["id", "document_id", "position", "description", "qty", "rate", "discount_kind", "discount", "currency", "amount"];
const INVOICE_COLUMNS = [
  "id",
  "number",
  "status",
  "title",
  "stage",
  "project_id",
  "proposal_id",
  "issued_on",
  "terms",
  "due_on",
  "currency",
  "tax_name",
  "tax_rate",
  "subtotal",
  "tax",
  "total",
  "paid",
  "balance",
  "voided_at",
  "client_paid_note",
  "client_paid_amount",
  "client_paid_on",
  "client_paid",
  "client_paid_at",
];

export const PUBLIC_KEYS = {
  // One project's handover, opened by the code in its link: no staff sign-in behind it, and it only reads.
  handover: {},
};

export const PUBLIC_ACCESS = [
  // ── the studio, to anyone ─────────────────────────────────────────────────
  { table: "settings", methods: ["GET"], select: ["name", "mark", "reply_to", "phone", "website"] },
  {
    table: "people",
    methods: ["GET"],
    select: ["name", "role_label", "initials", "position"],
    filters: [{ column: "shown_to_clients", op: "eq", value: true }],
  },
  {
    table: "brief_questions",
    methods: ["GET"],
    select: ["key", "question", "hint", "kind", "position"],
    filters: [{ column: "active", op: "eq", value: true }],
  },

  // ── the client, signed in by an emailed link ─────────────────────────────
  {
    table: "clients",
    methods: ["GET"],
    // Their own id too: a statement is drawn over the client's own row.
    select: ["id", "company", "contact_name"],
    claim: { verify: "email-link", email: "email" },
    documents: ["statement"],
    humanCheck: true,
  },

  // Proposals they were sent, and what they may do with one while it holds.
  {
    table: "proposals",
    methods: ["GET"],
    select: PROPOSAL_COLUMNS,
    filters: [{ column: "status", op: "in", value: ["sent", "accepted", "declined", "withdrawn"] }],
    documents: ["quote"],
    ...mine,
  },
  {
    // Accept and sign in one step: the typed name is the signature.
    table: "proposals",
    methods: ["PATCH"],
    select: ["id", "status", "signed_name", "signed_at", "fingerprint"],
    writable: ["status", "signed_name"],
    writableValues: { status: ["accepted"] },
    writableWhen: { status: ["sent"], valid_until: "from-today" },
    requires: ["signed_name"],
    ...mine,
  },
  {
    // Sign a proposal the studio marked accepted on the client's word.
    table: "proposals",
    methods: ["PATCH"],
    select: ["id", "signed_name", "signed_at", "fingerprint"],
    writable: ["signed_name"],
    writableWhen: { status: ["accepted"], signed_name: [null], accepted_how: ["email", "call", "meeting"] },
    requires: ["signed_name"],
    ...mine,
  },
  {
    table: "proposals",
    methods: ["PATCH"],
    select: ["id", "status", "decline_note"],
    writable: ["status", "decline_note"],
    writableValues: { status: ["declined"] },
    writableWhen: { status: ["sent"], valid_until: "from-today" },
    ...mine,
  },
  {
    // Past its date, a proposal can no longer be accepted; the client may ask for a new price, once.
    table: "proposals",
    methods: ["PATCH"],
    select: ["id", "new_price_asked_at"],
    writable: ["new_price_asked"],
    writableValues: { new_price_asked: [true] },
    writableWhen: { status: ["sent"], valid_until: "before-today", new_price_asked_at: [null] },
    ...mine,
  },
  { table: "proposal_lines", methods: ["GET"], select: LINE_COLUMNS, ...under("proposals", "document_id") },
  // The terms a proposal names, and their clauses — the proposal points at its version.
  { table: "terms_versions", methods: ["GET"], select: ["id", "version", "in_force_from"], ...under("proposals", "terms_version_id") },
  { table: "terms_clauses", methods: ["GET"], select: ["id", "version_id", "position", "title", "body", "change", "change_note"], ...under("terms_versions", "version_id") },

  // Projects, their milestones and the work shared for review.
  {
    table: "projects",
    methods: ["GET"],
    select: ["id", "number", "name", "status", "pause_note", "started_on", "done_on", "proposal_id"],
    ...mine,
  },
  { table: "milestones", methods: ["GET"], select: ["id", "project_id", "title", "due_on", "state", "done_at", "position"], ...under("projects", "project_id") },
  {
    table: "deliverables",
    methods: ["GET"],
    select: ["id", "project_id", "milestone_id", "title", "icon", "status", "shared_at", "reviewed_at", "review_note", "approved_how", "approved_on", "position"],
    filters: [{ column: "status", op: "neq", value: "unshared" }],
    ...mine,
  },
  {
    // Approve a version, or ask for changes, while it waits for review.
    table: "deliverables",
    methods: ["PATCH"],
    select: ["id", "status", "review_note", "reviewed_at", "approved_on"],
    writable: ["status", "review_note"],
    writableValues: { status: ["approved", "changes"] },
    writableWhen: { status: ["pending"] },
    ...mine,
  },
  {
    table: "deliverable_versions",
    methods: ["GET"],
    select: ["id", "deliverable_id", "v", "file", "link", "note", "posted_at"],
    files: ["file"],
    ...under("deliverables", "deliverable_id"),
  },
  {
    table: "deliverable_notes",
    methods: ["GET", "POST"],
    select: ["id", "deliverable_id", "version_id", "side", "author", "body", "pin_x", "pin_y", "at"],
    writable: ["deliverable_id", "version_id", "body", "pin_x", "pin_y", "client_key"],
    ...under("deliverables", "deliverable_id"),
  },

  // The brief: answered, then sent.
  {
    table: "briefs",
    methods: ["GET", "PATCH"],
    select: ["id", "project_id", "status", "sent_at"],
    writable: ["status"],
    writableValues: { status: ["sent"] },
    writableWhen: { status: ["open"] },
    ...mine,
  },
  {
    table: "brief_answers",
    methods: ["GET", "POST", "PATCH"],
    select: ["id", "brief_id", "question_key", "answer"],
    writable: ["brief_id", "question_key", "answer", "client_key"],
    ...under("briefs", "brief_id"),
  },

  // Invoices they were sent (a draft discarded before it was ever sent is not theirs to see).
  {
    table: "invoices",
    methods: ["GET"],
    select: INVOICE_COLUMNS,
    filters: [
      { column: "status", op: "in", value: ["sent", "void"] },
      { column: "issued_on", op: "gte", value: "1970-01-01" },
    ],
    documents: ["invoice"],
    ...mine,
  },
  {
    // "I've sent a payment": once, until the studio records a payment, which clears it.
    table: "invoices",
    methods: ["PATCH"],
    select: ["id", "client_paid_note", "client_paid_amount", "client_paid_on", "client_paid", "client_paid_at"],
    writable: ["client_paid", "client_paid_note", "client_paid_amount", "client_paid_on"],
    writableValues: { client_paid: [true] },
    writableWhen: { status: ["sent"], client_paid_at: [null] },
    requires: ["client_paid", "client_paid_on"],
    ...mine,
  },
  { table: "invoice_lines", methods: ["GET"], select: LINE_COLUMNS, ...under("invoices", "document_id") },
  {
    table: "payments",
    methods: ["GET"],
    select: ["id", "document_id", "number", "amount", "currency", "method", "paid_on"],
    // A voided payment, and why, never reach the client.
    filters: [{ column: "voided", op: "eq", value: false }],
    documents: ["receipt"],
    ...under("invoices", "document_id"),
  },

  // ── a handover, shared by link ─────────────────────────────────────────────
  { table: "settings", methods: ["GET"], select: ["name", "mark", "website"], key: "handover" },
  {
    table: "projects",
    methods: ["GET"],
    select: ["id", "number", "name", "done_on", "handover_notes", "share_expires_on"],
    claim: { by: "token", column: "share_token", expires: "share_expires_on", stopped: "share_stopped" },
    key: "handover",
  },
  { table: "project_fonts", methods: ["GET"], select: ["id", "project_id", "name", "licence", "position"], visibleWith: { table: "projects", via: "project_id" }, key: "handover" },
  {
    table: "handover_files",
    methods: ["GET"],
    select: ["id", "project_id", "file", "link", "note", "position"],
    files: ["file"],
    visibleWith: { table: "projects", via: "project_id" },
    key: "handover",
  },
  {
    table: "deliverables",
    methods: ["GET"],
    select: ["id", "project_id", "title", "icon", "approved_on", "position"],
    filters: [{ column: "status", op: "eq", value: "approved" }],
    visibleWith: { table: "projects", via: "project_id" },
    key: "handover",
  },
  {
    table: "deliverable_versions",
    methods: ["GET"],
    select: ["id", "deliverable_id", "v", "file", "link", "posted_at"],
    files: ["file"],
    visibleWith: { table: "deliverables", via: "deliverable_id" },
    key: "handover",
  },
];
