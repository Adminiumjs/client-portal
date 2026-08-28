/**
 * Screen ⇄ URL, for every hosted surface (29-app-surfaces.md D8).
 *
 * ─── The hole this closes ────────────────────────────────────────────────────
 *
 * All fifteen apps route by STATE: a `View` union and a `SCREENS` record
 * switched on `store.view`. Adminium serves `index.html` for any deep path
 * under a surface, so `/apps/clients/staff/invoices` renders — and then the app
 * ignores the path entirely and shows its home screen. Reload lands you
 * somewhere else than where you were, and no link to a screen can be shared.
 * 28-T40 recorded that as unsolved.
 *
 * ─── Why this is not "just for the embedded placement" ───────────────────────
 *
 * It would have been smaller to teach only the iframe bridge about paths. But
 * the same mechanism makes `/apps/clients/customer/track` and a mapped
 * `shop.example.com/track` land on the right screen, and those have nothing to
 * do with embedding. One mechanism, three placements.
 *
 * ─── `replaceState`, never `pushState` ──────────────────────────────────────
 *
 * The app's own screen changes REPLACE. Two reasons, both learned from getting
 * it wrong elsewhere: pushing would give the surface its own history stack
 * inside the parent's, so one Back press in the dashboard would walk the
 * iframe's history rather than leaving the app — the classic framed-app trap.
 * And un-embedded, a state-routed app has no notion of "back" to honour, so a
 * history entry per screen produces a Back button that appears to do nothing.
 *
 * The parent's URL is the one that gets a real history entry, and the parent
 * owns that (`AppFrame`, D6).
 */

import type { SurfaceNavEntry } from './surface-types.ts';

export type { SurfaceNavEntry };

/** Everything the runtime needs to place itself. Filled by `attachUrlSync`. */
export interface UrlSyncOptions<View extends string> {
  nav: readonly SurfaceNavEntry<View>[];
  /** The build's side — only entries on this side are reachable. */
  side: 'staff' | 'customer' | null;
  /** Apply a view to the app's store. Returns nothing; failure is impossible. */
  go: (view: View) => void;
  /** Read the app's current view. */
  current: () => View;
  /** Notified after every reflected change — the bridge's `navigate` hook. */
  onPath?: (path: string) => void;
}

/**
 * The surface's base path, derived from the document rather than configured.
 *
 * Vite bakes an ABSOLUTE base into the bundle (`--base=/apps/clients/staff/`),
 * and `import.meta.env.BASE_URL` is that string in every build — including one
 * served from a mapped domain at `/`, where it is WRONG. So the base is read
 * from where the page actually is, by finding the baked base as a prefix of the
 * live pathname and falling back to `/` when it is absent (the mapped-domain
 * case, where Adminium serves the same `index.html` at the root).
 */
export function surfaceBase(pathname: string, bakedBase: string): string {
  const baked = bakedBase.endsWith('/') ? bakedBase : `${bakedBase}/`;
  if (baked !== '/' && (pathname === baked.slice(0, -1) || pathname.startsWith(baked))) {
    return baked;
  }
  const instance = instanceBase(baked, pathname);
  if (instance !== null) return instance;
  return '/';
}

/**
 * The base of an INSTANCE mount — the same app served over a second database at
 * `/apps/<appKey>/<slug>/<side>/` (29 D9) — or null when this is not one.
 *
 * The baked base names the app and the side; the live pathname supplies the
 * slug between them. Without this the app would treat `apps/clients/berlin/…`
 * as a path under `/` and navigate itself straight off its own mount.
 *
 * `staff`/`customer` are refused in the slug position because that is exactly
 * how the unslugged mount is spelled, and reading it as an instance named
 * "staff" would break every surface that has no instances at all.
 */
export function instanceBase(bakedBase: string, pathname: string): string | null {
  const baked = bakedBase.split('/').filter((p) => p !== '');
  if (baked.length !== 3 || baked[0] !== 'apps') return null;
  const [, appKey, side] = baked;
  const parts = pathname.split('/').filter((p) => p !== '');
  if (parts.length < 4) return null;
  const [root, app, slug, foundSide] = parts;
  if (root !== 'apps' || app !== appKey || foundSide !== side) return null;
  if (slug === undefined || slug === 'staff' || slug === 'customer') return null;
  return `/apps/${appKey}/${slug}/${side}/`;
}

/** The path under the base, no leading slash. `""` at the base itself. */
export function pathUnderBase(pathname: string, base: string): string {
  if (!pathname.startsWith(base)) return '';
  return pathname.slice(base.length).replace(/^\/+|\/+$/g, '');
}

/**
 * The entry a path selects, or null.
 *
 * Longest match wins, so `orders/open` beats `orders` when both exist. An
 * unknown path is null rather than a guess: the app then keeps whatever screen
 * it booted with, which for a customer surface is the entry screen and for a
 * staff surface is home — both better than a 404 the app has no route for.
 */
export function entryForPath<V extends string>(
  nav: readonly SurfaceNavEntry<V>[],
  path: string,
): SurfaceNavEntry<V> | null {
  let best: SurfaceNavEntry<V> | null = null;
  for (const entry of nav) {
    if (entry.path !== path && !path.startsWith(`${entry.path}/`)) continue;
    if (best === null || entry.path.length > best.path.length) best = entry;
  }
  return best;
}

/** The path a view reflects to, or null when the view is not navigable. */
export function pathForView<V extends string>(
  nav: readonly SurfaceNavEntry<V>[],
  view: V,
): string | null {
  return nav.find((entry) => entry.view === view)?.path ?? null;
}

export interface UrlSync {
  /** Apply a path (from the URL on boot, or from the host over the bridge). */
  applyPath: (path: string) => void;
  /** Reflect the app's current view into the URL. Idempotent. */
  reflect: () => void;
  /** The base this surface is being served under. */
  base: string;
  /**
   * Where the app is NOW, as a path under the base — what the host is told in
   * the `hello`, so a deep-loaded frame can hand the dashboard its own URL
   * rather than being reset to the app's home screen.
   */
  path: () => string;
  /** Stop reflecting. */
  detach: () => void;
}

/**
 * Wire the two directions up and take the first reading.
 *
 * The subscription is the app's own store, passed in as `current` plus a caller
 * that invokes `reflect` — deliberately NOT a store import, because the fifteen
 * apps' stores are fifteen different modules and this file is byte-identical in
 * all of them.
 */
export function attachUrlSync<V extends string>(opts: UrlSyncOptions<V>): UrlSync {
  const nav = opts.nav.filter((entry) => opts.side === null || entry.side === opts.side);
  const base = surfaceBase(window.location.pathname, import.meta.env.BASE_URL);
  let last: string | null = null;
  let live = true;

  /**
   * The one place the address bar is written. `replaceState` only — see above.
   *
   * A write that would produce the URL already showing is skipped. That is what
   * keeps the boot call free: `applyPath` runs with the path taken FROM the
   * URL, so on every un-embedded load the first write is a no-op rather than a
   * history entry for the page you are already on.
   */
  const write = (path: string): void => {
    last = path;
    const next = `${base}${path}${window.location.search}`;
    if (next === `${window.location.pathname}${window.location.search}`) return;
    window.history.replaceState(window.history.state, '', next);
  };

  /**
   * Apply a path that came from OUTSIDE — the URL on boot, or the host over the
   * bridge.
   *
   * It writes the URL as well as changing the screen, and that is not
   * redundant. On boot the URL already says this, so the write is a no-op that
   * only normalises a trailing slash. Embedded, the host's `host:set` moves the
   * app while the FRAME's own URL still points at the previous screen — and the
   * frame's URL is what a reload restores. Leaving it stale meant the sidebar,
   * the address bar and the screen agreed while the frame quietly did not,
   * which surfaced the first time anyone reloaded a page they had navigated to.
   *
   * It deliberately does NOT call `onPath`: the host is the one that asked for
   * this move and telling it what it just said is a wasted round trip.
   */
  const applyPath = (path: string): void => {
    const entry = entryForPath(nav, path);
    // An unknown path leaves the app where it is — see `entryForPath`.
    if (entry === null) return;
    write(entry.path);
    opts.go(entry.view);
  };

  /** Reflect a screen change the APP made, and tell the host about it. */
  const reflect = (): void => {
    if (!live) return;
    const path = pathForView(nav, opts.current());
    // A view with no nav entry (a detail screen, an overlay) does not clear the
    // URL — it keeps the section's path, which is what a reload should restore.
    if (path === null || path === last) return;
    write(path);
    opts.onPath?.(path);
  };

  const booted = pathUnderBase(window.location.pathname, base);
  applyPath(booted);

  return {
    applyPath,
    reflect,
    base,
    // `last` once a known path has been applied or reflected; the raw boot path
    // otherwise, so an unrecognised deep link is reported as it arrived rather
    // than silently rewritten.
    path: () => last ?? booted,
    detach: () => {
      live = false;
    },
  };
}
