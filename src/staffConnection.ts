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

export async function resolveStaffConnectionId(
  opts: {
    hostedStaff?: boolean;
    base?: string;
    pathname?: string;
    fetchImpl?: typeof fetch;
  } = {},
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
    const id = (doc as { connectionId?: unknown }).connectionId;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    // An older server answers this path with the SPA index (HTML), which throws
    // in `json()`. Indistinguishable from unbound, and treated as such.
    return null;
  }
}
