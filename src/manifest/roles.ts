/**
 * Who may do what, enforced by Adminium on every read and write.
 *
 *   studio          runs the desk: enquiries, proposals, projects, reviews,
 *                   handovers, invoices, payments and the chase reminders,
 *                   and the back office — time, purchases, suppliers and the
 *                   studio's dates. It reads the studio's set-up and never
 *                   changes it (settings, people, the rate card, the terms,
 *                   the brief questions, the running costs), voids nothing
 *                   and deletes nothing;
 *   studio-manager  everything, the set-up and the Invoices & Receipts
 *                   add-on's own settings included; voids an invoice or a
 *                   payment, discards a draft, and reopens a finished project.
 *
 * A freelancer working alone is simply the workspace's admin.
 *
 * The desk shows or hides a button by the role, but the grant below is what
 * refuses the write — a hidden button is not a lock.
 */
import { PAGE_REFS } from "./pages.ts";
import { TABLES } from "./tables.ts";

const grant = (table: string, ...actions: string[]) => actions.map((action) => `table:@${table}:${action}`);
const view = (page: string) => `page:@${page}:view`;
/** Seeing a table's personal columns (a client's email and phone, who signed). */
const pii = (table: string) => `table:@${table}:read_pii`;

const EVERY_TABLE = TABLES.map((t) => t.ref);

/** The studio's set-up: read by the desk, changed by a manager (what it costs to open the door among it). */
const SET_UP = ["settings", "people", "rates", "terms_versions", "terms_clauses", "brief_questions", "running_costs"];
const DESK_WRITES = EVERY_TABLE.filter((table) => !SET_UP.includes(table));
const DESK_PAGES = PAGE_REFS.filter((page) => !["clients-settings", "clients-terms"].includes(page));

/** A column list of a table, but some. */
const columnsBut = (table: string, ...except: string[]) =>
  TABLES.find((t) => t.ref === table)!
    .columns.filter((c) => c.role !== "pk" && !except.includes(c.ref))
    .map((c) => c.ref);

export const ROLES = [
  {
    key: "studio",
    name: "Studio",
    permissions: [
      "app:@:staff",
      ...EVERY_TABLE.flatMap((table) => grant(table, "read")),
      ...DESK_WRITES.flatMap((table) => grant(table, "create", "update")),
      ...DESK_PAGES.map(view),
      ...EVERY_TABLE.map(pii),
    ],
    limits: {
      // Sends an invoice, never voids one: a void is a manager's.
      invoices: {
        writable: columnsBut("invoices", "number_seq", "number", "issued_on", "sent_at", "subtotal", "tax", "total", "paid", "balance", "void_reason", "voided_at", "voided_by"),
        writableValues: { status: ["sent"] },
      },
      // Records a payment, never voids one.
      payments: {
        writable: columnsBut("payments", "number_seq", "number", "recorded_by", "recorded_at", "voided", "void_reason", "voided_by", "voided_at"),
      },
    },
  },
  {
    key: "studio-manager",
    name: "Studio manager",
    permissions: [
      "app:@:staff",
      ...EVERY_TABLE.flatMap((table) =>
        // The outbox is the studio's record of what was sent: nobody deletes from it.
        table === "messages" ? grant(table, "read", "create", "update") : grant(table, "read", "create", "update", "delete"),
      ),
      ...PAGE_REFS.flatMap((page) => [view(page), `page:@${page}:edit`]),
      ...EVERY_TABLE.map(pii),
      // The add-on's letterhead, tax, payment instructions and reminder ladders.
      "addOn:invoices:settings",
    ],
  },
];
