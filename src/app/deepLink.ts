/**
 * The addresses that reach one document, and the tokens links carry.
 *
 * `urlSync.ts` (shared by every app) maps a path to a screen; a document's own
 * page has no path of its own, so a link to one (`invoices/12`, the clients'
 * `proposals/7`) lands on its section, and this reads the number after it to
 * open the document itself. A sign-in link (`/c#<token>`) and a share link
 * (`/h#<token>`) carry their token in the fragment, which no server or proxy
 * ever sees; it is read once and taken out of the address.
 */
import type { ClientView, DeskView } from "./routes.ts";
import { SURFACE_NAV } from "../surface-nav.ts";
import { entryForPath } from "../urlSync.ts";

const DESK_DETAIL: Record<string, DeskView> = { proposals: "proposal", invoices: "invoice", projects: "project", clients: "client" };
const CLIENT_DETAIL: Record<string, ClientView> = { proposals: "proposal", invoices: "invoice", projects: "project" };

/** The document a path under the surface's base names, if it names one. */
export function detailFromPath(side: "staff" | "customer", path: string): { view: DeskView | ClientView; id: number } | null {
  const [section, raw] = path.replace(/^\/+|\/+$/g, "").split("/");
  if (section === undefined || raw === undefined || !/^\d+$/.test(raw)) return null;
  const view = side === "staff" ? DESK_DETAIL[section] : CLIENT_DETAIL[section];
  return view === undefined ? null : { view, id: Number(raw) };
}

/** A link's token, from the address's fragment (`#<token>`, or `#<token>&to=…`). */
export function tokenFromHash(hash: string): string | null {
  const body = hash.replace(/^#/, "").split("&")[0] ?? "";
  return /^[A-Za-z0-9_-]{8,}$/.test(body) ? body : null;
}

/** Where a sign-in link asks to land (`&to=invoices/12`), only when it is one of the app's own paths. */
export function landingFromHash(hash: string): string | null {
  const to = new URLSearchParams(hash.replace(/^#[^&]*&?/, "")).get("to");
  return to !== null && /^[a-z]+(\/\d+)?$/.test(to) ? to : null;
}

/**
 * Everything a link's fragment carries, read at once — the token AND where it
 * lands — so the fragment can be taken out of the address straight after
 * without losing where the link was for.
 */
export function linkFragment(hash: string): { token: string | null; landing: string | null } {
  return { token: tokenFromHash(hash), landing: landingFromHash(hash) };
}

/**
 * True when an address under the surface names none of its screens — the
 * page to show is that side's 404. The shared address reader keeps whatever
 * screen the app booted with for a path it does not know (the desk's Home,
 * the clients' Find), which would pass a mistyped or stale link off as the
 * right page; the base itself (`""`) is the side's first screen, not a miss.
 */
export function unknownPath(side: "staff" | "customer", path: string): boolean {
  const trimmed = path.replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return false;
  return entryForPath(SURFACE_NAV.filter((entry) => entry.side === side), trimmed) === null;
}
