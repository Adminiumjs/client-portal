/**
 * This app's screens, as data — the one list the builds and the runtime all
 * read:
 *
 *   `App.tsx`        which components a build renders (through `app/routes.ts`),
 *   `urlSync.ts`     which path selects which screen,
 *   `surface.json`   which rows Adminium's sidebar offers for the desk.
 *
 * Order is Adminium's sidebar order. Icons are lucide NAMES, never
 * components: this module is read by the Vite config to write `surface.json`.
 * The paths are the manifest's `frontends[].routes` (`manifest/build.ts`).
 *
 * Each desk screen lives in `src/screens/<View>.tsx` (the build gate maps a
 * staff view to exactly that file, to prove no desk screen reaches the
 * clients' bundle); the clients' pages live in `src/screens/client/`.
 */
import type { View } from "./app/routes.ts";
import type { MessageKey } from "./i18n/messages/index.ts";
import type { SurfaceNavEntry } from "./surface-types.ts";

/** The marketplace key — the `/apps/<key>/` segment, NOT the repo name. */
export const APP_KEY = "clients";

/** The sidebar section's heading when the desk sits inside Adminium. */
export const APP_LABEL_KEY: MessageKey = "nav.app";

type Entry = SurfaceNavEntry<View> & { labelKey: MessageKey };

export const SURFACE_NAV = [
  { id: "home", path: "", view: "home", side: "staff", icon: "house", labelKey: "nav.home" },
  { id: "enquiries", path: "enquiries", view: "enquiries", side: "staff", icon: "inbox", labelKey: "nav.enquiries" },
  { id: "proposals", path: "proposals", view: "proposals", side: "staff", icon: "file-text", labelKey: "nav.proposals" },
  { id: "projects", path: "projects", view: "projects", side: "staff", icon: "folder-kanban", labelKey: "nav.projects" },
  { id: "clients", path: "clients", view: "clients", side: "staff", icon: "users-round", labelKey: "nav.clients" },
  { id: "invoices", path: "invoices", view: "invoices", side: "staff", icon: "receipt-text", labelKey: "nav.invoices" },
  { id: "chasing", path: "chasing", view: "chasing", side: "staff", icon: "bell-ring", labelKey: "nav.chasing" },
  { id: "terms", path: "terms", view: "terms", side: "staff", icon: "signature", labelKey: "nav.terms" },
  { id: "settings", path: "settings", view: "settings", side: "staff", icon: "settings", labelKey: "nav.settings" },
  /*
   * The clients' first page takes the EMPTY path: a studio's own domain
   * serves this side at `/`, and finding their documents is what someone
   * arriving there came to do. A sign-in link lands on `c`, a shared handover
   * on `h`; their tokens ride the fragment, never the path.
   */
  { id: "find", path: "", view: "find", side: "customer", labelKey: "nav.signIn" },
  { id: "link", path: "c", view: "link", side: "customer", labelKey: "screen.link" },
  { id: "chome", path: "home", view: "home", side: "customer", labelKey: "nav.home" },
  { id: "cproposals", path: "proposals", view: "proposal", side: "customer", labelKey: "nav.proposal" },
  { id: "cprojects", path: "projects", view: "project", side: "customer", labelKey: "nav.project" },
  { id: "cinvoices", path: "invoices", view: "invoice", side: "customer", labelKey: "nav.invoice" },
  { id: "statement", path: "statement", view: "statement", side: "customer", labelKey: "nav.statement" },
  { id: "brief", path: "brief", view: "brief", side: "customer", labelKey: "nav.brief" },
  { id: "handover", path: "h", view: "handover", side: "customer", labelKey: "nav.handover" },
] as const satisfies readonly Entry[];

/**
 * Screens a side RENDERS but does not navigate to by a path of their own: a
 * document's page is reached from a list (its address keeps the list's path),
 * and the dead ends are where a failure lands.
 */
export const SURFACE_EXTRAS = {
  staff: ["proposal", "composer", "project", "review", "handover", "client", "invoice", "print", "notfound", "time", "expenses", "suppliers", "scoping", "schedule", "capacity", "money", "archive", "emails"],
  customer: ["review", "expired", "notavailable", "notfound", "enquire"],
} as const satisfies Record<"staff" | "customer", readonly View[]>;

export type StaffView =
  | Extract<(typeof SURFACE_NAV)[number], { side: "staff" }>["view"]
  | (typeof SURFACE_EXTRAS)["staff"][number];

export type CustomerView =
  | Extract<(typeof SURFACE_NAV)[number], { side: "customer" }>["view"]
  | (typeof SURFACE_EXTRAS)["customer"][number];
