/**
 * WHICH CONNECTION a hosted STAFF surface reads (29-app-surfaces.md D9).
 *
 * ─── Why this has to be asked at all ─────────────────────────────────────────
 *
 * A CUSTOMER surface never had to: its publishable key names a scope, and a
 * scope names a connection (`NOT NULL` since meta wave 0014). The STAFF side has
 * no key BY DESIGN — it reads through the operator's own session — and that key
 * was also the thing carrying the identity. Nothing replaced it, so the app
 * inferred its database from "the only connection serving". Correct on the
 * single-connection instance nearly every install is; silently wrong on any
 * other, where the app reads somebody else's database and reports it as a pile
 * of absent tables.
 *
 * Adminium now serves the answer beside the bundle, and this reads it.
 *
 * ─── Why its own module, and not `publicConfig.ts` ───────────────────────────
 *
 * It shares a URL with the customer-side config and nothing else: no key, no
 * base URL, no resolution order. Keeping it there would also have dragged that
 * synced file — and the whole served-KEY mechanism it carries — into repos that
 * have not adopted it, which is a different task wearing this one's clothes.
 *
 * ─── `null` is a complete answer ─────────────────────────────────────────────
 *
 * An unbound surface returns it, and so does every Adminium older than the
 * binding. It means "keep inferring", never "something failed", so this never
 * blocks boot.
 */

import { setAppName } from "./i18n/ambient.ts";
import { HOSTED, SURFACE_SIDE } from "./surface.ts";

/**
 * Where to ask for the config document: the app's own mount, instance included.
 *
 * The baked base names the app and side (`/apps/clients/staff/`); an instance
 * inserts a slug before the side. Anything else — a mapped domain serving the
 * app at `/` — keeps the baked form, because `/apps/…` is served regardless of
 * host and `/surface-config.json` is not.
 */
export function configBase(bakedBase: string, pathname: string): string {
  const baked = bakedBase.endsWith("/") ? bakedBase : `${bakedBase}/`;
  const b = baked.split("/").filter((p) => p !== "");
  if (b.length !== 3 || b[0] !== "apps") return baked;
  const [, appKey, side] = b;
  const parts = pathname.split("/").filter((p) => p !== "");
  const [root, app, slug, foundSide] = parts;

  // The app's own mount, or a deep link under it.
  if (root === "apps" && app === appKey && slug === side) return baked;

  // An instance mount: the slug sits before the side.
  if (
    parts.length >= 4 &&
    root === "apps" &&
    app === appKey &&
    foundSide === side &&
    slug !== undefined &&
    slug !== "staff" &&
    slug !== "customer"
  ) {
    return `/apps/${appKey}/${slug}/${side}/`;
  }

  /*
   * A MAPPED DOMAIN, which serves the app at `/`. Its config lives at `/` too,
   * and it is the only thing that can say which instance the host is for — the
   * bundle never sees the domain map. This used to return the baked `/apps/…`
   * form because nothing answered at the root; now something does, and asking
   * the baked form here would pin every mapped host to the app's own database.
   */
  if (root !== "apps") return "/";

  return baked;
}

/**
 * Everything the staff config says, for a till that boots from it alone.
 *
 * Adminium serves it to the signed-in person: which database the app is in,
 * its real table names (short → real, for an app whose tables carry a
 * prefix), the venue's zone and currency, the app's settings values, who is
 * signed in, and the token their writes carry. With it the screens need
 * neither the dashboard's bootstrap nor its connections list — which a
 * screens-only cashier may not read.
 */
export interface StaffConfig {
  connectionId: string | null;
  appName: string | null;
  tables: Record<string, string>;
  settings: Record<string, unknown>;
  timezone: string | null;
  timezoneSource: string | null;
  serverTimezone: string | null;
  currency: string | null;
  user: { id: string; name: string; email: string } | null;
  csrfToken: string | null;
  /**
   * The app's staff-bound browser keys this person may use, by purpose (a
   * kiosk's). Empty for everyone else. A key opens nothing without this same
   * person's sign-in beside it, so it is a handle, not a credential.
   */
  publicKeys: Record<string, string>;
  /**
   * What this person may do with the app's own tables (by short name) and the
   * app's roles they hold — so a screen can leave out a button whose write
   * would be refused. Null from a server that does not say: then every button
   * shows, and the server refuses what it refuses.
   */
  access: StaffAccess | null;
  /**
   * The add-ons attached to this app and switched on, by key: the version, and
   * the settings the add-on marks for a browser (never a secret). Empty when
   * none is attached, or from a server that does not say — then a feature that
   * needs one stays off.
   */
  addOns: Record<string, StaffAddOn>;
}

export interface StaffAddOn {
  version: string | null;
  settings: Record<string, unknown>;
}

export type TableAction = "read" | "create" | "update" | "delete";
export interface StaffAccess {
  tables: Record<string, TableAction[]>;
  roles: { slug: string; name: string }[];
}

const ACTIONS: readonly TableAction[] = ["read", "create", "update", "delete"];

/** `access` as the server sent it, keeping only what it means; null when it sent none. */
function accessOf(value: unknown): StaffAccess | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  const tables: Record<string, TableAction[]> = {};
  for (const [ref, actions] of Object.entries(record(doc.tables))) {
    if (!Array.isArray(actions)) continue;
    tables[ref] = ACTIONS.filter((action) => actions.includes(action));
  }
  const roles = (Array.isArray(doc.roles) ? doc.roles : []).flatMap((role) => {
    const r = record(role);
    const slug = text(r.slug);
    return slug === null ? [] : [{ slug, name: text(r.name) ?? slug }];
  });
  return { tables, roles };
}

type StaffConfigOptions = {
  hostedStaff?: boolean;
  base?: string;
  pathname?: string;
  fetchImpl?: typeof fetch;
};

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** The attached add-ons as the server lists them; anything else is dropped rather than guessed at. */
function addOnsOf(value: unknown): Record<string, StaffAddOn> {
  const out: Record<string, StaffAddOn> = {};
  for (const [key, entry] of Object.entries(record(value))) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    out[key] = { version: text(e.version), settings: record(e.settings) };
  }
  return out;
}

/** The whole staff config, or null outside a hosted staff build or when none answers. */
export async function loadStaffConfig(opts: StaffConfigOptions = {}): Promise<StaffConfig | null> {
  const hostedStaff = opts.hostedStaff ?? (HOSTED && SURFACE_SIDE === "staff");
  if (!hostedStaff) return null;
  const base =
    opts.base ??
    configBase(import.meta.env.BASE_URL, opts.pathname ?? window.location.pathname);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${base}surface-config.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const doc: unknown = await res.json();
    if (doc === null || typeof doc !== "object") return null;
    const d = doc as Record<string, unknown>;
    setAppName(d.appName as string | null | undefined);
    const user = record(d.user);
    return {
      connectionId: text(d.connectionId),
      appName: text(d.appName),
      tables: Object.fromEntries(
        Object.entries(record(d.tables)).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
      ),
      settings: record(d.settings),
      timezone: text(d.timezone),
      timezoneSource: text(d.timezoneSource),
      serverTimezone: text(d.serverTimezone),
      currency: text(d.currency),
      user:
        text(user.id) === null
          ? null
          : { id: String(user.id), name: text(user.name) ?? "", email: text(user.email) ?? "" },
      csrfToken: text(d.csrfToken),
      publicKeys: Object.fromEntries(
        Object.entries(record(d.publicKeys)).filter((entry): entry is [string, string] => typeof entry[1] === "string" && entry[1] !== ""),
      ),
      access: accessOf(d.access),
      addOns: addOnsOf(d.addOns),
    };
  } catch {
    // An older server answers this path with the SPA index (HTML).
    return null;
  }
}

export async function resolveStaffConnectionId(
  opts: StaffConfigOptions = {},
): Promise<string | null> {
  const hostedStaff = opts.hostedStaff ?? (HOSTED && SURFACE_SIDE === "staff");
  if (!hostedStaff) return null;

  /*
   * Built from `BASE_URL`, never a relative `./surface-config.json`: a relative
   * fetch resolves against the DOCUMENT url, so any deep screen would ask for
   * the wrong path.
   *
   * NOT `surfaceBase()`, which answers a different question. That one gives the
   * base for NAVIGATION, and on a mapped domain it is `/` — where no config
   * document is served. This asks the `/apps/…` form, which every instance
   * answers and which is host-agnostic, so a mapped domain keeps working.
   */
  const base =
    opts.base ??
    configBase(import.meta.env.BASE_URL, opts.pathname ?? window.location.pathname);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${base}surface-config.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const doc: unknown = await res.json();
    if (doc === null || typeof doc !== "object") return null;
    // The same document carries what the operator called this app. Set here
    // rather than returned, because it has nothing to do with this function's
    // question and every caller would otherwise have to thread it through.
    setAppName((doc as { appName?: unknown }).appName as string | null | undefined);
    const id = (doc as { connectionId?: unknown }).connectionId;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    // An older server answers this path with the SPA index (HTML), which throws
    // in `json()`. Indistinguishable from unbound, and treated as such.
    return null;
  }
}
