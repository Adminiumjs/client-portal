/**
 * This app's screens, as data — the ONE declaration two build outputs and one
 * runtime all read (29-app-surfaces.md D7/D8).
 *
 * ─── What was here before, and why it moved ─────────────────────────────────
 *
 * `App.tsx` held the side split as two literal `SCREENS` records. That was
 * fine while the split had exactly one reader. It now has three:
 *
 *   `App.tsx`         which components a build renders,
 *   `urlSync.ts`      which path selects which screen,
 *   `surface.json`    which sections Adminium's sidebar offers.
 *
 * Three copies of one fact drift, and D7 is explicit that the drift must be
 * impossible rather than merely tested for. So the split is declared once,
 * here, and the three readers derive from it. `App.tsx` still owns the
 * `View → Component` map — components belong with the app — and a `satisfies`
 * there makes a screen declared here with no component a COMPILE error.
 *
 * ─── App-specific, and it has to be ─────────────────────────────────────────
 *
 * `surface-build.sh` syncs `urlSync.ts`, `embed.ts` and `surface-emit.ts`
 * byte-identically across all fifteen apps. This file is the splice: paths,
 * views, icons and label keys are this app's own vocabulary, and a shared
 * module that knew them could not be shared.
 */

import type { SurfaceNavEntry } from "./surface-types.ts";
import type { View } from "./data/types.ts";
import type { MessageKey } from "./i18n/messages/index.ts";

/** The marketplace key — the `/apps/<key>/` segment, NOT the repo name. */
export const APP_KEY = "clients";

/** The sidebar section heading when this app is blended into Adminium. */
export const APP_LABEL_KEY: MessageKey = "chrome.brand";

type Entry = SurfaceNavEntry<View> & { labelKey: MessageKey };

/**
 * The NAVIGABLE screens — the ones that get a path, a sidebar row and a URL.
 *
 * Order is the sidebar order. Icons are lucide NAMES in kebab-case, never
 * imported components: this module is read by the Vite config to emit
 * `surface.json`, and pulling the icon package into a build script would be
 * both slow and pointless.
 */
export const SURFACE_NAV = [
  { id: "home", path: "home", view: "home", side: "staff", icon: "house", labelKey: "chrome.nav.home" },
  {
    id: "proposals",
    path: "proposals",
    view: "proposals",
    side: "staff",
    icon: "file-text",
    labelKey: "chrome.nav.proposals",
  },
  {
    id: "projects",
    path: "projects",
    view: "projects",
    side: "staff",
    icon: "folder-kanban",
    labelKey: "chrome.nav.projects",
  },
  {
    id: "invoices",
    path: "invoices",
    view: "invoices",
    side: "staff",
    icon: "receipt",
    labelKey: "chrome.nav.invoices",
  },
  /*
   * Archive is a deliberately CUT view: the row exists and the screen 404s
   * honestly rather than pretending. Kept in the nav because hiding it would
   * make the embedded sidebar disagree with the app's own, and the honest 404
   * is the product's own choice, not a placement artifact.
   */
  {
    id: "archive",
    path: "archive",
    view: "notfound",
    side: "staff",
    icon: "archive",
    labelKey: "chrome.nav.archive",
  },
  /*
   * The customer portal has ONE way in: a client types a document number. It
   * has no internal navigation at all — that is the product story (a client
   * sees the document they were sent and nothing about the studio's other
   * work), so it gets one entry at the surface root and no sections.
   */
  { id: "entry", path: "", view: "entry", side: "customer", labelKey: "chrome.brand.portal" },
] as const satisfies readonly Entry[];

/**
 * Screens that belong to a side but are NOT navigable: details reached from a
 * list, and the 404.
 *
 * They are declared because `App.tsx` derives its `SCREENS` record from
 * nav + extras, so leaving one out drops it from the bundle rather than
 * silently rendering the wrong thing. They get no path: a proposal detail
 * without a proposal number is not a page anyone can link to, and inventing
 * `proposals/:num` here would promise a deep link the store cannot honour.
 */
export const SURFACE_EXTRAS = {
  staff: ["proposal", "project", "invoice", "notfound"],
  customer: ["review", "progress", "clientinvoice", "notfound"],
} as const satisfies Record<"staff" | "customer", readonly View[]>;

/**
 * Every view a side renders, as a TYPE — nav entries plus extras.
 *
 * This is the drift guard, and it is worth being precise about why it is a type
 * and not a test. `App.tsx` must keep its two `SCREENS` records as separate
 * object LITERALS: `SURFACE_SIDE` folds to a literal at build time, and that is
 * what lets Rollup eliminate the branch not taken — and with it, every screen
 * component only that branch referenced. Building one record by filtering an
 * array at runtime would be tidier and would put the whole staff app inside the
 * PUBLIC customer bundle.
 *
 * So the two literals stay, and `satisfies Record<StaffView, ComponentType>`
 * over them makes a screen declared here with no component, or a component for
 * a screen not declared here, a compile error. Same guarantee as a drift test,
 * enforced earlier, at zero bundle cost.
 */
export type StaffView =
  | Extract<(typeof SURFACE_NAV)[number], { side: "staff" }>["view"]
  | (typeof SURFACE_EXTRAS)["staff"][number];

export type CustomerView =
  | Extract<(typeof SURFACE_NAV)[number], { side: "customer" }>["view"]
  | (typeof SURFACE_EXTRAS)["customer"][number];
