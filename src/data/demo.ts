/**
 * The demo's sample studio — DEMO BUILD ONLY (`main.tsx` imports it behind
 * `DEMO`, so no other build carries a byte of it).
 *
 * A small studio in the tables' own shapes, on the demo's pinned day (Tuesday
 * 28 July 2026): enough rows for every screen to draw something real. The
 * figures a server decides — numbers, line amounts, totals, paid, balance —
 * are left for the demo's stand-in world to settle when it loads
 * (`demo/world.ts`), exactly as Adminium settles a sample bundle.
 *
 * Addresses are on reserved `.example` domains so nothing here can be mailed.
 */
import type { TableRef, Tables } from "./types.ts";

type Seed = { [R in TableRef]?: Partial<Tables[R]>[] };

/** The person signed in to the demo's desk. */
export const DEMO_STAFF = { name: "Nadia Cole", email: "nadia@outline.example", roleName: "Studio manager" };

/** The client the demo's clients' side is signed in as. */
export const DEMO_CLIENT_ID = 1;

export const DEMO_ROWS: Seed = {
  settings: [
    {
      id: 1,
      singleton: "studio",
      name: "Outline",
      mark: null,
      reply_to: "hello@outline.example",
      phone: "+1 555 0142",
      website: "https://outline.example",
      sign_off: "Nadia and Tomas",
      hours_per_day: 6,
      days_per_week: 4,
    },
  ],
  people: [
    { id: 1, name: "Nadia Cole", role_label: "Partner · type & identity", initials: "NC", email: "nadia@outline.example", shown_to_clients: true, position: 0 },
    { id: 2, name: "Tomas Reyes", role_label: "Partner · packaging & print", initials: "TR", email: "tomas@outline.example", shown_to_clients: true, position: 1 },
  ],
  rates: [
    { id: 1, label: "Design day", amount: "780.00", hours_per_unit: "6", position: 0, active: true },
    { id: 2, label: "Print check", amount: "240.00", hours_per_unit: "2", position: 1, active: true },
    { id: 3, label: "Type licence handling", amount: "90.00", hours_per_unit: null, position: 2, active: true },
  ],
  terms_versions: [
    { id: 1, version: 1, status: "retired", in_force_from: "2025-02-01", note: "First written terms" },
    { id: 2, version: 2, status: "retired", in_force_from: "2025-09-01", note: "Kill fee made clearer" },
    { id: 3, version: 3, status: "in_force", in_force_from: "2026-03-01", note: "Pause after 45 days unpaid" },
  ],
  terms_clauses: [
    { id: 1, version_id: 3, position: 0, title: "What we make", body: "The work in the proposal, in the rounds it names.", change: "same" },
    { id: 2, version_id: 3, position: 1, title: "Paying in stages", body: "Each stage is invoiced when it starts; invoices are due in fourteen days.", change: "same" },
    { id: 3, version_id: 3, position: 2, title: "Your files", body: "Final files are yours once the last invoice is paid.", change: "same" },
    { id: 4, version_id: 3, position: 3, title: "When payment is late", body: "After 45 days unpaid, work pauses until the balance is settled.", change: "changed", change_note: "Pause after 45 days, not 60" },
  ],
  brief_questions: [
    { id: 1, key: "audience", question: "Who is this for?", hint: "The people you most want to reach.", kind: "area", position: 0, active: true },
    { id: 2, key: "feel", question: "How should it feel?", hint: "Three words is plenty.", kind: "text", position: 1, active: true },
    { id: 3, key: "avoid", question: "Anything to avoid?", hint: null, kind: "area", position: 2, active: true },
    { id: 4, key: "admire", question: "Work you admire", hint: "Links are fine.", kind: "area", position: 3, active: true },
    { id: 5, key: "deadline", question: "Any fixed dates?", hint: "Launches, print runs, openings.", kind: "text", position: 4, active: true },
    { id: 6, key: "decide", question: "Who signs things off?", hint: null, kind: "text", position: 5, active: true },
  ],
  clients: [
    { id: 1, company: "Hearth & Co Bakery", trade: "Bakery", contact_name: "Amara Osei", email: "amara@hearth.example", phone: "+1 555 0181", address: "14 Mill Lane", terms: "net14", tax_rate: null, language: "en-US", tint: "#b25e09", created_at: "2026-02-03T15:00:00.000Z" },
    { id: 2, company: "Fold & Rule Stationers", trade: "Stationery", contact_name: "Cleo Marchetti", email: "cleo@foldandrule.example", phone: null, address: null, terms: "net30", tax_rate: null, language: "en-US", tint: "#4f46e5", created_at: "2026-01-12T15:00:00.000Z" },
    { id: 3, company: "Marigold Tea Rooms", trade: "Tea room", contact_name: "Priya Nair", email: "priya@marigold.example", phone: "+1 555 0107", address: null, terms: null, tax_rate: null, language: "en-US", tint: "#0d9488", created_at: "2025-11-20T15:00:00.000Z" },
    { id: 4, company: "Kiln Street Ceramics", trade: "Ceramics", contact_name: "Jonas Berg", email: "jonas@kilnstreet.example", phone: null, address: null, terms: "net14", tax_rate: null, language: "en-US", tint: "#7c3aed", created_at: "2025-09-08T15:00:00.000Z" },
  ],
  client_notes: [{ id: 1, client_id: 1, body: "Prefers a call before anything big is sent.", by: "Nadia Cole", at: "2026-06-30T14:00:00.000Z" }],
  enquiries: [
    { id: 1, number: "ENQ-001", business: "Northwind Cycles", name: "Sam Hale", email: "sam@northwind.example", trade: "Bike shop", budget: "5–8k", start_when: "September", source: "Website", fit: "good", body: "A new mark and shop signage before the autumn season.", status: "new", received_at: "2026-07-27T13:10:00.000Z" },
    { id: 2, number: "ENQ-002", business: "Lantern Books", name: "Ines Duarte", email: "ines@lantern.example", trade: "Bookshop", budget: "3k", start_when: "Soon", source: "Referral", fit: "maybe", body: "Shelf talkers and a tote bag for the anniversary.", status: "new", received_at: "2026-07-26T09:40:00.000Z" },
    { id: 3, number: "ENQ-003", business: null, name: "Ray Moss", email: "ray@mosspress.example", trade: null, budget: null, start_when: null, source: "Call", fit: null, body: "Rang about a wine label; call back after the harvest.", status: "parked", parked_until: "2026-08-20", received_at: "2026-07-21T16:00:00.000Z" },
    { id: 4, number: "ENQ-004", business: "Bright Offers Ltd", name: "Promo Team", email: "team@brightoffers.example", trade: null, budget: null, start_when: null, source: "Website", fit: "no", body: "We can get your site to the top of every search.", status: "new", received_at: "2026-07-28T07:00:00.000Z" },
  ],
  proposals: [
    { id: 1, number: "PRO-1140", status: "declined", client_id: 3, title: "Menu and window lettering", scope: "A new menu system and window lettering.", split: "5050", valid_until: "2026-06-20", terms_version_id: 3, currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-06-01T14:00:00.000Z", decided_at: "2026-06-12T10:00:00.000Z", decline_note: "We're holding off until spring." },
    { id: 2, number: "PRO-1141", status: "accepted", client_id: 2, title: "Packaging system", scope: "A packaging system for the notebook range: three sizes, one family.", split: "403030", valid_until: "2026-06-30", terms_version_id: 3, currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-06-02T14:00:00.000Z", decided_at: "2026-06-09T16:00:00.000Z", signed_name: "Cleo Marchetti", signed_email: "cleo@foldandrule.example", signed_at: "2026-06-09T16:00:00.000Z", accepted_how: "portal" },
    { id: 3, number: "PRO-1142", status: "sent", client_id: 1, title: "Shopfront identity", scope: "A mark, a shopfront sign and the first run of bags and boxes.", split: "5050", valid_until: "2026-08-12", terms_version_id: 3, currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-07-22T14:00:00.000Z" },
    { id: 4, number: null, status: "draft", client_id: 4, title: "Studio sale poster", scope: null, split: "end", valid_until: "2026-08-18", terms_version_id: 3, currency: "USD", tax_name: "Tax", tax_rate: "8.5" },
  ],
  proposal_lines: [
    { id: 1, document_id: 1, position: 0, description: "Menu system", qty: "1", rate: "2200.00", discount_kind: "amount", discount: null },
    { id: 2, document_id: 2, position: 0, description: "Packaging family, three sizes", qty: "1", rate: "5400.00", discount_kind: "amount", discount: null },
    { id: 3, document_id: 2, position: 1, description: "Print checks", qty: "3", rate: "240.00", discount_kind: "amount", discount: null },
    { id: 4, document_id: 3, position: 0, description: "Mark and wordmark", qty: "1", rate: "2600.00", discount_kind: "amount", discount: null },
    { id: 5, document_id: 3, position: 1, description: "Shopfront sign artwork", qty: "1", rate: "900.00", discount_kind: "amount", discount: "100.00" },
    { id: 6, document_id: 3, position: 2, description: "Bags and boxes, first run", qty: "2", rate: "250.00", discount_kind: "amount", discount: null },
    { id: 7, document_id: 4, position: 0, description: "Poster design", qty: "1", rate: "650.00", discount_kind: "amount", discount: null },
  ],
  projects: [
    { id: 1, number: "PRJ-01", client_id: 2, proposal_id: 2, name: "Packaging system", status: "active", started_on: "2026-06-10", share_token: "FOLDRULE2026ABCD", share_stopped: false, handover_sent: false },
    { id: 2, number: "PRJ-02", client_id: 1, proposal_id: null, name: "Seasonal window", status: "active", started_on: "2026-07-01", share_token: "HEARTHWINDOW2026", share_stopped: false, handover_sent: false },
    { id: 3, number: "PRJ-03", client_id: 3, proposal_id: null, name: "Loyalty cards", status: "paused", pause_note: "Paused under clause 4 — INV-2039 is 47 days unpaid.", started_on: "2026-04-14", share_token: "MARIGOLDCARDS26X", share_stopped: false, handover_sent: false },
    { id: 4, number: "PRJ-04", client_id: 4, proposal_id: null, name: "Studio identity", status: "done", started_on: "2026-01-05", done_on: "2026-05-29", share_token: "KILNSTREETDONE26", share_expires_on: null, share_stopped: false, handover_notes: "Print the mark at 20 mm or larger.", handover_sent: true, handover_sent_at: "2026-05-29T15:00:00.000Z" },
  ],
  milestones: [
    { id: 1, project_id: 1, title: "Structure and dielines", due_on: "2026-06-26", state: "done", done_at: "2026-06-25T15:00:00.000Z", position: 0 },
    { id: 2, project_id: 1, title: "Artwork", due_on: "2026-07-31", state: "now", position: 1 },
    { id: 3, project_id: 1, title: "Print and hand over", due_on: "2026-08-21", state: "next", position: 2 },
    { id: 4, project_id: 2, title: "Window sketches", due_on: "2026-07-30", state: "now", position: 0 },
    { id: 5, project_id: 2, title: "Install", due_on: "2026-08-07", state: "next", position: 1 },
    { id: 6, project_id: 3, title: "Card design", due_on: "2026-06-10", state: "done", done_at: "2026-06-09T12:00:00.000Z", position: 0 },
    { id: 7, project_id: 4, title: "Mark", due_on: "2026-03-01", state: "done", done_at: "2026-02-27T12:00:00.000Z", position: 0 },
  ],
  deliverables: [
    { id: 1, project_id: 1, milestone_id: 2, title: "Notebook box, large", icon: "package", status: "pending", shared_at: "2026-07-24T13:00:00.000Z", position: 0 },
    { id: 2, project_id: 1, milestone_id: 1, title: "Dielines", icon: "ruler", status: "approved", shared_at: "2026-06-22T13:00:00.000Z", reviewed_at: "2026-06-24T09:00:00.000Z", approved_how: "portal", approved_on: "2026-06-24", approved_by: "Cleo Marchetti", position: 1 },
    { id: 3, project_id: 2, milestone_id: 4, title: "Window sketch A", icon: "pen-tool", status: "changes", shared_at: "2026-07-20T13:00:00.000Z", reviewed_at: "2026-07-23T11:00:00.000Z", review_note: "Could the loaf be bigger?", position: 0 },
    { id: 4, project_id: 2, milestone_id: 4, title: "Window sketch B", icon: "pen-tool", status: "unshared", position: 1 },
    { id: 5, project_id: 4, milestone_id: 7, title: "Final mark files", icon: "shapes", status: "approved", shared_at: "2026-02-25T13:00:00.000Z", reviewed_at: "2026-02-27T09:00:00.000Z", approved_how: "email", approved_on: "2026-02-27", approved_by: "Nadia Cole", position: 0 },
  ],
  deliverable_versions: [
    { id: 1, deliverable_id: 1, v: 1, file: null, link: "https://files.outline.example/box-large-v1.pdf", note: "First pass on the large box.", posted_by: "Tomas Reyes", posted_at: "2026-07-24T13:00:00.000Z" },
    { id: 2, deliverable_id: 2, v: 1, file: null, link: "https://files.outline.example/dielines-v1.pdf", note: null, posted_by: "Tomas Reyes", posted_at: "2026-06-22T13:00:00.000Z" },
    { id: 3, deliverable_id: 3, v: 1, file: null, link: "https://files.outline.example/window-a-v1.pdf", note: "Autumn palette.", posted_by: "Nadia Cole", posted_at: "2026-07-20T13:00:00.000Z" },
    { id: 4, deliverable_id: 5, v: 1, file: null, link: "https://files.outline.example/kiln-mark.zip", note: null, posted_by: "Nadia Cole", posted_at: "2026-02-25T13:00:00.000Z" },
  ],
  deliverable_notes: [
    { id: 1, deliverable_id: 3, version_id: 3, side: "client", author: "Amara Osei", body: "Could the loaf be bigger?", pin_x: "0.42", pin_y: "0.58", at: "2026-07-23T11:00:00.000Z" },
    { id: 2, deliverable_id: 3, version_id: 3, side: "studio", author: "Nadia Cole", body: "Yes — new version by Thursday.", pin_x: null, pin_y: null, at: "2026-07-23T15:30:00.000Z" },
  ],
  briefs: [
    { id: 1, project_id: 1, status: "sent", sent_at: "2026-06-12T10:00:00.000Z" },
    { id: 2, project_id: 2, status: "open" },
  ],
  brief_answers: [
    { id: 1, brief_id: 1, question_key: "audience", answer: "People who still write by hand.", first_answer: "People who still write by hand." },
    { id: 2, brief_id: 1, question_key: "feel", answer: "Quiet, precise, warm.", first_answer: "Quiet, precise, warm." },
    { id: 3, brief_id: 2, question_key: "audience", answer: "Neighbours on their way to work.", first_answer: "Neighbours on their way to work." },
  ],
  invoices: [
    { id: 1, number: "INV-2035", status: "void", client_id: 3, title: "Menu deposit", issued_on: "2026-05-02", due_on: "2026-05-16", terms: "net14", currency: "USD", tax_name: "Tax", tax_rate: "8.5", void_reason: "Raised in error", voided_at: "2026-05-03T10:00:00.000Z", sent_at: "2026-05-02T10:00:00.000Z" },
    { id: 2, number: "INV-2036", status: "sent", client_id: 2, project_id: 1, proposal_id: 2, from_quote_id: 2, share_pct: "40", stage: "Deposit", title: "Packaging system — deposit", issued_on: "2026-06-10", due_on: "2026-07-10", terms: "net30", currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-06-10T10:00:00.000Z" },
    { id: 3, number: "INV-2037", status: "sent", client_id: 2, project_id: 1, proposal_id: 2, from_quote_id: 2, share_pct: "30", stage: "Artwork", title: "Packaging system — artwork", issued_on: "2026-07-14", due_on: "2026-08-13", terms: "net30", currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-07-14T10:00:00.000Z", client_paid: true, client_paid_on: "2026-07-27", client_paid_amount: "500.00", client_paid_note: "Sent half by bank transfer.", client_paid_at: "2026-07-27T18:00:00.000Z" },
    { id: 4, number: "INV-2038", status: "sent", client_id: 1, project_id: 2, title: "Seasonal window", issued_on: "2026-07-02", due_on: "2026-07-16", terms: "net14", currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-07-02T10:00:00.000Z" },
    { id: 5, number: "INV-2039", status: "sent", client_id: 3, project_id: 3, title: "Loyalty cards", issued_on: "2026-05-28", due_on: "2026-06-11", terms: "net14", currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-05-28T10:00:00.000Z" },
    { id: 6, number: "INV-2040", status: "sent", client_id: 1, title: "Shopfront survey & measure-up", issued_on: "2026-07-20", due_on: "2026-08-03", terms: "net14", currency: "USD", tax_name: "Tax", tax_rate: "8.5", sent_at: "2026-07-20T10:00:00.000Z" },
    { id: 7, number: "INV-2041", status: "draft", client_id: 4, title: "Mark files, extra formats", terms: "net14", currency: "USD", tax_name: "Tax", tax_rate: "8.5" },
  ],
  invoice_lines: [
    { id: 1, document_id: 1, position: 0, description: "Menu deposit", qty: "1", rate: "1100.00", discount_kind: "amount" },
    { id: 2, document_id: 2, position: 0, description: "Deposit, 40 %", quote_id: 2, share_pct: "40", discount_kind: "amount" },
    { id: 3, document_id: 3, position: 0, description: "Artwork stage, 30 %", quote_id: 2, share_pct: "30", discount_kind: "amount" },
    { id: 4, document_id: 4, position: 0, description: "Window design and install", qty: "1", rate: "1400.00", discount_kind: "amount" },
    { id: 5, document_id: 5, position: 0, description: "Loyalty card design", qty: "1", rate: "960.00", discount_kind: "amount" },
    { id: 6, document_id: 6, position: 0, description: "Survey and measure-up", qty: "1", rate: "450.00", discount_kind: "amount" },
    { id: 7, document_id: 7, position: 0, description: "Extra file formats", qty: "2", rate: "90.00", discount_kind: "amount" },
  ],
  payments: [
    { id: 1, document_id: 2, number: "REC-0017", amount: "2881.85", method: "bank-transfer", paid_on: "2026-06-24", recorded_by: "Nadia Cole", recorded_at: "2026-06-24T10:00:00.000Z", voided: false },
    { id: 2, document_id: 5, number: "REC-0016", amount: "300.00", method: "card", paid_on: "2026-06-20", recorded_by: "Tomas Reyes", recorded_at: "2026-06-20T10:00:00.000Z", voided: false },
  ],
  messages: [
    { id: 1, kind: "invoice-rung-1", status: "sent", to: "amara@hearth.example", client_id: 1, invoice_id: 4, due: "2026-07-17T13:00:00.000Z", sent_at: "2026-07-17T13:00:00.000Z" },
    { id: 2, kind: "invoice-rung-2", status: "held", to: "amara@hearth.example", client_id: 1, invoice_id: 4, due: "2026-07-27T13:00:00.000Z" },
    { id: 3, kind: "invoice-rung-3", status: "held", to: "amara@hearth.example", client_id: 1, invoice_id: 4, due: "2026-08-10T13:00:00.000Z" },
    { id: 4, kind: "invoice-rung-3", status: "held", to: "priya@marigold.example", client_id: 3, invoice_id: 5, due: "2026-07-26T13:00:00.000Z" },
  ],
};
