/**
 * The route table: every screen of both sides, the file that draws it, and
 * its name.
 *
 *   the desk          `src/screens/<File>.tsx` — one file per view
 *   the clients' side `src/screens/client/<File>.tsx`
 *
 * `App.tsx` maps each view to its component in two literal records (so a
 * build for one side carries none of the other side's screens), and
 * `routes.test.ts` holds those records, these files and `surface-nav.ts` to
 * one another. A screen lane replaces the file a view names — nothing else.
 */
import type { MessageKey } from "../i18n/messages/index.ts";

export const DESK_VIEWS = [
  "home",
  "enquiries",
  "proposals",
  "proposal",
  "composer",
  "projects",
  "project",
  "review",
  "handover",
  "clients",
  "client",
  "invoices",
  "invoice",
  "print",
  "chasing",
  "terms",
  "settings",
  "time",
  "expenses",
  "suppliers",
  "scoping",
  "schedule",
  "capacity",
  "money",
  "archive",
  "emails",
  "notfound",
] as const;

export const CLIENT_VIEWS = [
  "find",
  "link",
  "home",
  "proposal",
  "project",
  "review",
  "invoice",
  "statement",
  "brief",
  "handover",
  "expired",
  "notavailable",
  "enquire",
  "notfound",
] as const;

export type DeskView = (typeof DESK_VIEWS)[number];
export type ClientView = (typeof CLIENT_VIEWS)[number];
/** A view of either side; which side is showing decides which it means. */
export type View = DeskView | ClientView;

export type Persona = "studio" | "client";

export interface Route {
  /** The file that draws the view, from the repo's root. */
  file: string;
  /** The view's name: the placeholder's title, the page title, the demo card. */
  titleKey: MessageKey;
}

export const DESK_ROUTES: Readonly<Record<DeskView, Route>> = {
  home: { file: "src/screens/Home.tsx", titleKey: "nav.home" },
  enquiries: { file: "src/screens/Enquiries.tsx", titleKey: "nav.enquiries" },
  proposals: { file: "src/screens/Proposals.tsx", titleKey: "nav.proposals" },
  proposal: { file: "src/screens/Proposal.tsx", titleKey: "nav.proposal" },
  composer: { file: "src/screens/Composer.tsx", titleKey: "screen.composer" },
  projects: { file: "src/screens/Projects.tsx", titleKey: "nav.projects" },
  project: { file: "src/screens/Project.tsx", titleKey: "nav.project" },
  review: { file: "src/screens/Review.tsx", titleKey: "screen.review" },
  handover: { file: "src/screens/Handover.tsx", titleKey: "screen.handover" },
  clients: { file: "src/screens/Clients.tsx", titleKey: "nav.clients" },
  client: { file: "src/screens/Client.tsx", titleKey: "screen.client" },
  invoices: { file: "src/screens/Invoices.tsx", titleKey: "nav.invoices" },
  invoice: { file: "src/screens/Invoice.tsx", titleKey: "nav.invoice" },
  print: { file: "src/screens/Print.tsx", titleKey: "screen.print" },
  chasing: { file: "src/screens/Chasing.tsx", titleKey: "nav.chasing" },
  terms: { file: "src/screens/Terms.tsx", titleKey: "nav.terms" },
  settings: { file: "src/screens/Settings.tsx", titleKey: "nav.settings" },
  time: { file: "src/screens/Time.tsx", titleKey: "nav.time" },
  expenses: { file: "src/screens/Expenses.tsx", titleKey: "nav.expenses" },
  suppliers: { file: "src/screens/Suppliers.tsx", titleKey: "nav.suppliers" },
  scoping: { file: "src/screens/Scoping.tsx", titleKey: "screen.scoping" },
  schedule: { file: "src/screens/Schedule.tsx", titleKey: "nav.schedule" },
  capacity: { file: "src/screens/Capacity.tsx", titleKey: "nav.capacity" },
  money: { file: "src/screens/Money.tsx", titleKey: "nav.money" },
  archive: { file: "src/screens/Archive.tsx", titleKey: "nav.archive" },
  emails: { file: "src/screens/Emails.tsx", titleKey: "screen.emails" },
  notfound: { file: "src/screens/NotFound.tsx", titleKey: "notFound.title" },
};

export const CLIENT_ROUTES: Readonly<Record<ClientView, Route>> = {
  find: { file: "src/screens/client/Find.tsx", titleKey: "screen.find" },
  link: { file: "src/screens/client/Link.tsx", titleKey: "screen.link" },
  home: { file: "src/screens/client/Home.tsx", titleKey: "nav.home" },
  proposal: { file: "src/screens/client/Proposal.tsx", titleKey: "nav.proposal" },
  project: { file: "src/screens/client/Project.tsx", titleKey: "nav.project" },
  review: { file: "src/screens/client/Review.tsx", titleKey: "screen.clientReview" },
  invoice: { file: "src/screens/client/Invoice.tsx", titleKey: "nav.invoice" },
  statement: { file: "src/screens/client/Statement.tsx", titleKey: "nav.statement" },
  brief: { file: "src/screens/client/Brief.tsx", titleKey: "nav.brief" },
  handover: { file: "src/screens/client/Handover.tsx", titleKey: "nav.handover" },
  expired: { file: "src/screens/client/Expired.tsx", titleKey: "screen.expired" },
  notavailable: { file: "src/screens/client/NotAvailable.tsx", titleKey: "notAvailable.kicker" },
  enquire: { file: "src/screens/client/Enquire.tsx", titleKey: "screen.enquire" },
  notfound: { file: "src/screens/client/NotFound.tsx", titleKey: "notFound.title" },
};

export const isDeskView = (view: string): view is DeskView => (DESK_VIEWS as readonly string[]).includes(view);
export const isClientView = (view: string): view is ClientView => (CLIENT_VIEWS as readonly string[]).includes(view);

// ── the studio's sidebar ────────────────────────────────────────────────────

export interface SidebarItem {
  view: DeskView;
  labelKey: MessageKey;
  /** lucide icon name. */
  icon: string;
  /** Detail views that light this item too. */
  children: readonly DeskView[];
  /** Shown only to a studio manager. */
  managerOnly?: boolean;
  /** The count beside it, when the item has one (`state/desk.ts` `navCounts`). */
  badge?: "enquiries" | "proposals" | "invoices" | "chasing";
}

/**
 * The studio's sidebar: the screens this release builds, in the design's
 * order. Schedule, Capacity, Money, Expenses, Suppliers, Time and Archive
 * come later and are not shown; Settings is a studio manager's.
 */
export const SIDEBAR: readonly SidebarItem[] = [
  { view: "home", labelKey: "nav.home", icon: "house", children: [] },
  { view: "enquiries", labelKey: "nav.enquiries", icon: "inbox", children: [], badge: "enquiries" },
  { view: "proposals", labelKey: "nav.proposals", icon: "file-text", children: ["proposal", "composer", "scoping"], badge: "proposals" },
  { view: "projects", labelKey: "nav.projects", icon: "folder-kanban", children: ["project", "review", "handover"] },
  { view: "clients", labelKey: "nav.clients", icon: "users-round", children: ["client"] },
  { view: "invoices", labelKey: "nav.invoices", icon: "receipt-text", children: ["invoice", "print"], badge: "invoices" },
  { view: "chasing", labelKey: "nav.chasing", icon: "bell-ring", children: [], badge: "chasing" },
  { view: "settings", labelKey: "nav.settings", icon: "settings", children: ["terms"], managerOnly: true },
];

/** The sidebar item a view lights. */
export function sidebarItemFor(view: DeskView): DeskView | null {
  return SIDEBAR.find((item) => item.view === view || item.children.includes(view))?.view ?? null;
}
