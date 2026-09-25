/**
 * The Overview page's layout: the studio at a glance, drawn by Adminium's own
 * widgets from the app's tables. Nothing on it is typed in — every figure is
 * a stored row, counted or summed where Adminium runs the query, on the
 * studio's clock.
 *
 * Twenty-three cards on the dashboard's twelve-column grid (heights in 40 px
 * steps), read top to bottom:
 *
 *   - the money and the work: outstanding, overdue, collected this month,
 *     proposals still waiting, active projects — and, beside them, how many
 *     are paused and how many were done this month;
 *   - how old the money owed is, in four bands, beside what needs a partner:
 *     chase reminders to approve, clients who say they have paid, changes
 *     asked for, new enquiries;
 *   - six months invoiced, and six months collected;
 *   - what is waiting on a client: proposals out, files to review, invoices
 *     past their due date;
 *   - this week's milestones, the invoices falling due next, and the work in
 *     progress.
 *
 * On a phone the cards stack in the order they are listed here.
 *
 * What the words mean, once:
 *   - "owing" is a sent invoice that still has a balance; a draft or a void
 *     never counts;
 *   - "overdue" is owing and due before the studio's today; a day is the
 *     studio's day, a month its calendar month, a week Monday to Sunday;
 *   - "waiting" proposals are sent and still in date (valid today or later);
 *   - "collected" counts payments by the day they arrived, a voided one never.
 *
 * A card that leads somewhere opens its list already narrowed to what the
 * card counts (`?f.<column>=<op>:<value>`); the list says so above its rows,
 * and each narrowing can be taken off. A card whose count cannot be said as
 * such a narrowing opens nothing rather than a list that looks like it.
 *
 * A card's title is written in every language the app speaks (`words.ts`);
 * the page shows the reader's. A card has no subtitle: a subtitle is one
 * string, and an English line under a German title would be the only English
 * on the page. Status names come from the tables' own labels, in the reader's
 * language, and money is shown in the connection's currency.
 */
import { l, type Labels } from "./labels.ts";
import { TABLES } from "./tables.ts";

type Json = Record<string, unknown>;

// ── where a card leads ───────────────────────────────────────────────────────

/** The app's own pages a card can open (their address is their ref). */
export type OverviewPage =
  | "clients-invoices"
  | "clients-payments"
  | "clients-proposals"
  | "clients-projects"
  | "clients-deliverables"
  | "clients-messages"
  | "clients-enquiries";

/**
 * One of the app's pages, narrowed by `[column, "<op>:<value>"]` pieces —
 * the same words a person reads on the list's chips ("Status is Sent",
 * "Due before today").
 */
export function page(ref: OverviewPage, ...pieces: [column: string, piece: string][]): string {
  const query = pieces.map(([column, piece]) => `f.${column}=${encodeURIComponent(piece).replace(/%3A/g, ":").replace(/%2C/g, ",")}`).join("&");
  return query === "" ? `/p/${ref}` : `/p/${ref}?${query}`;
}

// ── what a card reads ────────────────────────────────────────────────────────

/** A query over one of the app's tables, by the name the manifest gives it. */
const query = (table: string, rest: Json): Json => ({ kind: "table-query", source: { name: table, type: "table" }, ...rest });

/** One number, with no comparison beside it. */
const metric = (table: string, aggregation: Json, rest: Json = {}): Json =>
  query(table, { shape: "metric+delta", aggregations: [aggregation], ...rest });

const count = (alias: string): Json => ({ fn: "count", alias });
const sum = (column: string, alias: string): Json => ({ fn: "sum", column, alias });

const eq = (column: string, value: unknown): Json => ({ column, op: "eq", value });
const oneOf = (column: string, value: string[]): Json => ({ column, op: "in", value });

/** A sent invoice that still has a balance: what clients owe the studio. */
const OWING: Json[] = [eq("status", "sent"), { column: "balance", op: "gt", value: 0 }];
/** The same, as a list's narrowing. */
const OWING_LINK: [string, string][] = [["status", "eq:sent"], ["balance", "gt:0"]];

/** The three rungs of the chase for an unpaid invoice. */
const RUNGS = ["invoice-rung-1", "invoice-rung-2", "invoice-rung-3"];

/** The studio's calendar month so far (the 1st to today). */
const thisMonth = (column: string): Json => ({ column, last: 1, unit: "month", calendar: true });
/** This week, Monday to Sunday on the studio's calendar. */
const thisWeek = (column: string): Json => ({ column, last: 1, unit: "week", calendar: true });
/** From the studio's today on, with no end: due today or later, still in date. */
const fromToday = (column: string): Json => ({ column, ahead: true, last: 1, unit: "day" });
/**
 * Whole days on the studio's calendar, `span` days long, ending `back` days
 * before today: `days(col, 30, 1)` is the thirty days before today.
 */
const days = (column: string, span: number, back: number): Json => ({ column, last: span, unit: "day", calendar: true, offset: back });
/** Before the studio's today, as far back as any invoice goes (ten years). */
const beforeToday = (column: string): Json => days(column, 3650, 1);
/** Up to this moment (a rolling window that ends now), as far back as any row goes. */
const untilNow = (column: string): Json => ({ column, last: 3650, unit: "day" });
/** The last six calendar months, this one included. */
const sixMonths = (column: string): Json => ({ column, last: 6, unit: "month", calendar: true });

// ── how a card looks ─────────────────────────────────────────────────────────

const COUNT = { metricFormat: "plain", deltaMode: "none", showSparkline: false };
const MONEY = { metricFormat: "currency", deltaMode: "none", showSparkline: false };

type Place = [x: number, y: number, w: number, h: number];

function card(i: string, widget: string, [x, y, w, h]: Place, en: string, config: Json): Json {
  const titles: Labels = l(en);
  return { i, widget, x, y, w, h, config: { title: titles["en-US"], titles, ...config } };
}

/**
 * A list card's columns. A mini-table draws up to three visible columns and
 * no header row; the key column stays hidden and opens the row's record.
 * A column's `label` is not drawn — it names the column for the page editor.
 */
const key = { name: "id", label: "Id", logicalType: "integer", primaryKey: true, hidden: true };
const text = (name: string, label: string): Json => ({ name, label, logicalType: "text" });
const date = (name: string, label: string): Json => ({ name, label, logicalType: "date" });

/** A choice column's pill: which values the card shows, and their tones from the table. */
function statusPill(table: string, column: string, label: string, values: string[]): Json {
  const found = TABLES.find((t) => t.ref === table)?.columns.find((c) => c.ref === column);
  const rules = found?.rules?.["enumLabels"] as { tones?: Record<string, string> } | undefined;
  if (rules?.tones === undefined) throw new Error(`${table}.${column} has no tones for the Overview's pill`);
  return {
    name: column,
    label,
    logicalType: "enum",
    semantic: "status-workflow",
    enumValues: values,
    enumTones: Object.fromEntries(values.flatMap((v) => (rules.tones?.[v] === undefined ? [] : [[v, rules.tones[v]]]))),
  };
}

// ── the cards ────────────────────────────────────────────────────────────────

const ITEMS: Json[] = [
  // The money and the work.
  card("kpi-outstanding", "kpi-stat-card", [0, 0, 4, 3], "Outstanding", {
    iconName: "receipt", ...MONEY,
    href: page("clients-invoices", ...OWING_LINK),
    binding: metric("invoices", sum("balance", "owed"), { filters: OWING }),
  }),
  card("kpi-overdue", "kpi-stat-card", [4, 0, 4, 3], "Overdue", {
    iconName: "clock-alert", iconTone: "warn", ...MONEY,
    href: page("clients-invoices", ...OWING_LINK, ["due_on", "before:today"]),
    binding: metric("invoices", sum("balance", "overdue"), { filters: OWING, window: beforeToday("due_on") }),
  }),
  card("kpi-collected", "kpi-stat-card", [8, 0, 4, 3], "Collected this month", {
    iconName: "banknote", ...MONEY,
    href: page("clients-payments", ["voided", "eq:false"], ["paid_on", "month:this"]),
    binding: metric("payments", sum("amount", "collected"), { filters: [eq("voided", false)], window: thisMonth("paid_on") }),
  }),
  card("kpi-proposals", "kpi-stat-card", [0, 3, 4, 3], "Proposals waiting", {
    iconName: "file-pen-line", ...MONEY,
    href: page("clients-proposals", ["status", "eq:sent"], ["valid_until", "gte:today"]),
    // A sent proposal past its date is no longer waiting: it has lapsed.
    binding: metric("proposals", sum("total", "waiting"), { filters: [eq("status", "sent")], window: fromToday("valid_until") }),
  }),
  card("kpi-active", "kpi-stat-card", [4, 3, 4, 3], "Active projects", {
    iconName: "folder-kanban", ...COUNT,
    href: page("clients-projects", ["status", "eq:active"]),
    binding: metric("projects", count("active"), { filters: [eq("status", "active")] }),
  }),
  card("kpi-paused", "kpi-stat-tile-compact", [8, 3, 2, 3], "Paused", {
    ...COUNT,
    href: page("clients-projects", ["status", "eq:paused"]),
    binding: metric("projects", count("paused"), { filters: [eq("status", "paused")] }),
  }),
  card("kpi-done", "kpi-stat-tile-compact", [10, 3, 2, 3], "Done this month", {
    ...COUNT,
    href: page("clients-projects", ["status", "eq:done"], ["done_on", "month:this"]),
    binding: metric("projects", count("done"), { filters: [eq("status", "done")], window: thisMonth("done_on") }),
  }),

  // How old the money owed is: four bands by whole days past the due date.
  card("owed-current", "kpi-stat-tile-compact", [0, 6, 3, 3], "Owed · not yet due", {
    ...MONEY,
    href: page("clients-invoices", ...OWING_LINK, ["due_on", "gte:today"]),
    // Due today is not yet late.
    binding: metric("invoices", sum("balance", "owed"), { filters: OWING, window: fromToday("due_on") }),
  }),
  // The three late bands open nothing: a list can be narrowed to "before
  // today", not to "between 31 and 60 days ago", and a wider list under a
  // band's figure would not be the list the figure counts.
  card("owed-30", "kpi-stat-tile-compact", [3, 6, 3, 3], "Owed · 1–30 days late", {
    ...MONEY,
    binding: metric("invoices", sum("balance", "owed"), { filters: OWING, window: days("due_on", 30, 1) }),
  }),
  card("owed-60", "kpi-stat-tile-compact", [0, 9, 3, 3], "Owed · 31–60 days late", {
    ...MONEY,
    binding: metric("invoices", sum("balance", "owed"), { filters: OWING, window: days("due_on", 30, 31) }),
  }),
  card("owed-older", "kpi-stat-tile-compact", [3, 9, 3, 3], "Owed · over 60 days late", {
    ...MONEY,
    binding: metric("invoices", sum("balance", "owed"), { filters: OWING, window: days("due_on", 3589, 61) }),
  }),

  // What needs a partner.
  card("needs-chase", "kpi-stat-card", [6, 6, 3, 3], "Chase reminders to approve", {
    iconName: "bell-ring", iconTone: "warn", ...COUNT,
    // A list narrows by day, so it shows the rungs due by the end of today.
    href: page("clients-messages", ["status", "eq:held"], ["kind", `in:${RUNGS.join(",")}`], ["due", "lte:today"]),
    // Held for a partner, and its day has come; a rung still to wake waits.
    binding: metric("messages", count("chase"), { filters: [eq("status", "held"), oneOf("kind", RUNGS)], window: untilNow("due") }),
  }),
  card("needs-paid", "kpi-stat-card", [9, 6, 3, 3], "Clients say they’ve paid", {
    iconName: "hand-coins", iconTone: "info", ...COUNT,
    href: page("clients-invoices", ...OWING_LINK, ["client_paid_at", "set"]),
    binding: metric("invoices", count("claimed"), { filters: [...OWING, { column: "client_paid_at", op: "not_null" }] }),
  }),
  card("needs-changes", "kpi-stat-card", [6, 9, 3, 3], "Changes asked", {
    iconName: "message-square-diff", iconTone: "warn", ...COUNT,
    href: page("clients-deliverables", ["status", "eq:changes"]),
    binding: metric("deliverables", count("changes"), { filters: [eq("status", "changes")] }),
  }),
  card("needs-enquiries", "kpi-stat-card", [9, 9, 3, 3], "New enquiries", {
    iconName: "inbox", ...COUNT,
    // The enquiries inbox reads no narrowing from its address: it opens as
    // it is, the new ones first.
    href: page("clients-enquiries"),
    binding: metric("enquiries", count("new"), { filters: [eq("status", "new")] }),
  }),

  // Six months invoiced, six months collected.
  card("invoiced", "chart-bar", [0, 12, 6, 7], "Invoiced by month", {
    ...MONEY, highlight: "current",
    binding: query("invoices", {
      shape: "timeseries",
      aggregations: [sum("total", "invoiced")],
      filters: [eq("status", "sent")],
      bucket: { column: "issued_on", unit: "month" },
      window: sixMonths("issued_on"),
    }),
  }),
  card("collected", "chart-bar", [6, 12, 6, 7], "Collected by month", {
    ...MONEY, highlight: "current",
    binding: query("payments", {
      shape: "timeseries",
      aggregations: [sum("amount", "collected")],
      filters: [eq("voided", false)],
      bucket: { column: "paid_on", unit: "month" },
      window: sixMonths("paid_on"),
    }),
  }),

  // What is waiting on a client: the oldest first.
  card("wait-proposals", "mini-table", [0, 19, 4, 5], "Proposals sent", {
    limit: 4,
    viewAllHref: page("clients-proposals", ["status", "eq:sent"], ["valid_until", "gte:today"]),
    columns: [key, text("number", "Proposal"), text("client", "Client"), date("valid_until", "Holds until")],
    binding: query("proposals", {
      shape: "record-list",
      select: ["id", "number", "valid_until"],
      lookups: ["client:client_id.company"],
      filters: [eq("status", "sent")],
      window: fromToday("valid_until"),
      orderBy: [{ column: "valid_until", dir: "asc" }],
      limit: 4,
    }),
  }),
  card("wait-files", "mini-table", [4, 19, 4, 5], "Files to review", {
    limit: 4,
    viewAllHref: page("clients-deliverables", ["status", "eq:pending"]),
    columns: [key, text("title", "File"), text("client", "Client"), { name: "shared_at", label: "Shared", logicalType: "timestamptz" }],
    binding: query("deliverables", {
      shape: "record-list",
      select: ["id", "title", "shared_at"],
      lookups: ["client:client_id.company"],
      filters: [eq("status", "pending")],
      orderBy: [{ column: "shared_at", dir: "asc" }],
      limit: 4,
    }),
  }),
  card("wait-overdue", "mini-table", [8, 19, 4, 5], "Overdue invoices", {
    limit: 4,
    viewAllHref: page("clients-invoices", ...OWING_LINK, ["due_on", "before:today"]),
    columns: [key, text("number", "Invoice"), text("client", "Client"), date("due_on", "Due")],
    binding: query("invoices", {
      shape: "record-list",
      select: ["id", "number", "due_on", "balance"],
      lookups: ["client:client_id.company"],
      filters: OWING,
      window: beforeToday("due_on"),
      orderBy: [{ column: "due_on", dir: "asc" }],
      limit: 4,
    }),
  }),

  // This week, what falls due next, and the work in progress.
  card("week-milestones", "mini-table", [0, 24, 4, 6], "Milestones this week", {
    limit: 6,
    viewAllHref: page("clients-projects"),
    columns: [key, text("title", "Milestone"), text("client", "Client"), date("due_on", "Due")],
    binding: query("milestones", {
      shape: "record-list",
      select: ["id", "title", "due_on"],
      lookups: ["client:client_id.company"],
      filters: [{ column: "state", op: "neq", value: "done" }],
      window: thisWeek("due_on"),
      orderBy: [{ column: "due_on", dir: "asc" }],
      limit: 6,
    }),
  }),
  card("due-next", "mini-table", [4, 24, 4, 6], "Invoices falling due next", {
    limit: 4,
    viewAllHref: page("clients-invoices", ...OWING_LINK, ["due_on", "gte:today"]),
    columns: [key, text("number", "Invoice"), text("client", "Client"), date("due_on", "Due")],
    binding: query("invoices", {
      shape: "record-list",
      select: ["id", "number", "due_on", "balance"],
      lookups: ["client:client_id.company"],
      filters: OWING,
      window: fromToday("due_on"),
      orderBy: [{ column: "due_on", dir: "asc" }],
      limit: 4,
    }),
  }),
  card("wip-projects", "mini-table", [8, 24, 4, 6], "Work in progress", {
    limit: 6,
    viewAllHref: page("clients-projects", ["status", "in:active,paused"]),
    columns: [key, text("name", "Project"), statusPill("projects", "status", "Status", ["active", "paused"]), text("pause_note", "Note")],
    binding: query("projects", {
      shape: "record-list",
      select: ["id", "name", "status", "pause_note"],
      filters: [oneOf("status", ["active", "paused"])],
      orderBy: [{ column: "status", dir: "asc" }, { column: "name", dir: "asc" }],
      limit: 6,
    }),
  }),
];

const DESK = l("Open the desk");

export const OVERVIEW_LAYOUT: Json = {
  version: 1,
  toolbar: {
    // The desk runs on its own address; Adminium resolves `@staff` to it,
    // and draws no link at all where the desk is not there.
    link: { label: DESK["en-US"], labels: DESK, href: "@staff", icon: "external-link" },
  },
  items: ITEMS,
};
