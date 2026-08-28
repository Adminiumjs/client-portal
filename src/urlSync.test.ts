/**
 * Screen ⇄ URL (29-app-surfaces.md D8, 29-T13).
 *
 * The pure functions are tested directly because they are where the decisions
 * live; `attachUrlSync` is tested against a hand-built `window` because the
 * fleet's suites run in node with no DOM, and adding jsdom to fifteen repos to
 * test forty lines is a worse trade than a twenty-line fake.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  attachUrlSync,
  entryForPath,
  instanceBase,
  pathForView,
  pathUnderBase,
  surfaceBase,
  type SurfaceNavEntry,
} from './urlSync.ts';

type V = 'home' | 'orders' | 'open' | 'detail';

const NAV: SurfaceNavEntry<V>[] = [
  { id: 'home', path: 'home', view: 'home', side: 'staff' },
  { id: 'orders', path: 'orders', view: 'orders', side: 'staff' },
  { id: 'open', path: 'orders/open', view: 'open', side: 'staff' },
  { id: 'track', path: '', view: 'detail', side: 'customer' },
];

describe('surfaceBase — where this bundle actually is', () => {
  it('uses the baked base when the page is served under it', () => {
    // Path-hosted: `/apps/clients/staff/…`, which is what `--base` baked in.
    expect(surfaceBase('/apps/clients/staff/invoices', '/apps/clients/staff/')).toBe(
      '/apps/clients/staff/',
    );
    // The base itself, with no trailing slash on the URL.
    expect(surfaceBase('/apps/clients/staff', '/apps/clients/staff/')).toBe('/apps/clients/staff/');
  });

  it('falls back to / when the SAME bundle is served from a mapped domain', () => {
    /*
     * THE CASE THIS FUNCTION EXISTS FOR. Vite bakes an ABSOLUTE base into the
     * bundle, and `import.meta.env.BASE_URL` is that string in every build —
     * including the one Adminium serves at `/` on `shop.example.com` (D3, no
     * rebuild, no second dist). Trusting the baked value there would make every
     * path unreachable and every reflected URL wrong.
     */
    expect(surfaceBase('/track', '/apps/clients/customer/')).toBe('/');
    expect(surfaceBase('/', '/apps/clients/customer/')).toBe('/');
  });

  it('normalises a base with no trailing slash', () => {
    expect(surfaceBase('/apps/x/staff/a', '/apps/x/staff')).toBe('/apps/x/staff/');
  });
});

describe('pathUnderBase', () => {
  it('strips the base and both edges of slashes', () => {
    expect(pathUnderBase('/apps/x/staff/orders/', '/apps/x/staff/')).toBe('orders');
    expect(pathUnderBase('/apps/x/staff/', '/apps/x/staff/')).toBe('');
    expect(pathUnderBase('/orders/open', '/')).toBe('orders/open');
  });

  it('is empty when the path is not under the base at all', () => {
    expect(pathUnderBase('/elsewhere', '/apps/x/staff/')).toBe('');
  });
});

describe('entryForPath — longest match wins', () => {
  it('prefers the deeper route', () => {
    // `orders/open` must not be shadowed by `orders`, which is a prefix of it.
    expect(entryForPath(NAV, 'orders/open')?.id).toBe('open');
    expect(entryForPath(NAV, 'orders')?.id).toBe('orders');
  });

  it('matches a deeper unknown path onto its nearest section', () => {
    expect(entryForPath(NAV, 'orders/open/42')?.id).toBe('open');
  });

  it('returns null for an unknown path rather than guessing', () => {
    // The app then keeps the screen it booted with, which beats a blank route.
    expect(entryForPath(NAV, 'nope')).toBeNull();
  });

  it('the empty path matches only the empty entry', () => {
    expect(entryForPath(NAV, '')?.id).toBe('track');
    // …and the empty entry is not a prefix of everything, which a naive
    // `startsWith` would make it.
    expect(entryForPath([NAV[3] as SurfaceNavEntry<V>], 'orders')).toBeNull();
  });
});

describe('pathForView', () => {
  it('maps back, and is null for a view with no nav entry', () => {
    expect(pathForView(NAV, 'orders')).toBe('orders');
    expect(pathForView(NAV, 'nothing' as V)).toBeNull();
  });
});

/**
 * The smallest `window` `attachUrlSync` will accept.
 *
 * `replaceState` UPDATES `location.pathname`, as a real browser does. Without
 * that the fake diverges on exactly the property under test — the sync skips a
 * write that would not change the URL, and a fake whose location never moves
 * makes every write after the first look like a no-op.
 */
function fakeWindow(pathname: string): { replaced: string[] } {
  const replaced: string[] = [];
  const location = { pathname, search: '' };
  vi.stubGlobal('window', {
    location,
    history: {
      state: null,
      replaceState: (_s: unknown, _t: string, url: string) => {
        replaced.push(url);
        location.pathname = url.split('?')[0] ?? url;
      },
    },
  });
  return { replaced };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('attachUrlSync', () => {
  it('applies the boot path before anything renders', () => {
    fakeWindow('/orders/open');
    const seen: V[] = [];
    attachUrlSync<V>({
      nav: NAV,
      side: 'staff',
      go: (v) => seen.push(v),
      current: () => 'home',
    });
    // Not `home`: a reload of a deep link must land where the link pointed.
    expect(seen).toEqual(['open']);
  });

  it('writes the URL when the HOST moves the app, without echoing back', () => {
    /*
     * FOUND LIVE, in the dashboard. `applyPath` used to change the screen and
     * mark the path as current WITHOUT writing it, so an embedded surface
     * navigated by the host kept the frame's previous URL — and the frame's URL
     * is what a reload restores. Everything visible agreed; only the thing you
     * could not see was wrong, until someone reloaded.
     *
     * And it must NOT call `onPath`: the host is the one that asked, so
     * reporting the move back to it is a wasted round trip through the bridge.
     */
    const { replaced } = fakeWindow('/home');
    const reported: string[] = [];
    let view: V = 'home';
    const sync = attachUrlSync<V>({
      nav: NAV,
      side: 'staff',
      go: (v) => {
        view = v;
      },
      current: () => view,
      onPath: (p) => reported.push(p),
    });

    sync.applyPath('orders');
    expect(replaced).toEqual(['/orders']);
    expect(reported).toEqual([]);
    expect(sync.path()).toBe('orders');

    // …and the store subscription that follows must not write it a second time.
    sync.reflect();
    expect(replaced).toEqual(['/orders']);
  });

  it('reflects a screen change with replaceState, once', () => {
    const { replaced } = fakeWindow('/home');
    let view: V = 'home';
    const sync = attachUrlSync<V>({
      nav: NAV,
      side: 'staff',
      go: (v) => {
        view = v;
      },
      current: () => view,
    });

    view = 'orders';
    sync.reflect();
    sync.reflect(); // idempotent — a store subscription fires on every change
    expect(replaced).toEqual(['/orders']);
  });

  it('never pushes history — one Back press must leave the app, not walk it', () => {
    const { replaced } = fakeWindow('/home');
    let view: V = 'home';
    const sync = attachUrlSync<V>({ nav: NAV, side: 'staff', go: () => {}, current: () => view });
    for (const next of ['orders', 'open', 'home'] as V[]) {
      view = next;
      sync.reflect();
    }
    // Three navigations, three REPLACEMENTS, zero history entries.
    expect(replaced).toEqual(['/orders', '/orders/open', '/home']);
  });

  it('keeps the section path when the app moves to a screen with no entry', () => {
    // A detail view is not linkable, so the URL stays on the list it came from
    // — which is what a reload should restore.
    const { replaced } = fakeWindow('/orders');
    let view: V = 'orders';
    const sync = attachUrlSync<V>({ nav: NAV, side: 'staff', go: () => {}, current: () => view });
    view = 'detail';
    sync.reflect();
    expect(replaced).toEqual([]);
  });

  it('filters the nav to the build\'s own side', () => {
    // A staff bundle must not route to a customer screen it does not contain.
    fakeWindow('/');
    const seen: V[] = [];
    attachUrlSync<V>({ nav: NAV, side: 'staff', go: (v) => seen.push(v), current: () => 'home' });
    expect(seen).toEqual([]);
  });

  it('reports the boot path even when it matched nothing', () => {
    // Base is `/` here: vitest's `import.meta.env.BASE_URL` is `/`, which is
    // also the mapped-domain case, so this doubles as that placement's check.
    fakeWindow('/unknown-thing');
    const sync = attachUrlSync<V>({
      nav: NAV,
      side: 'staff',
      go: () => {},
      current: () => 'home',
    });
    // Reported as it ARRIVED, not silently rewritten — the host shows the user
    // the URL they actually typed.
    expect(sync.path()).toBe('unknown-thing');
  });
});

describe("instance mounts", () => {
  const BAKED = "/apps/clients/staff/";

  it("navigates INSIDE the instance rather than off its mount", () => {
    /*
     * Before this, an instance path matched neither the baked base nor a mapped
     * domain, so the base fell back to `/` — and the app read
     * `apps/clients/berlin/staff/invoices` as its own screen path, then wrote
     * URLs that left the mount entirely.
     */
    expect(surfaceBase("/apps/clients/berlin/staff/invoices", BAKED)).toBe(
      "/apps/clients/berlin/staff/",
    );
    expect(pathUnderBase("/apps/clients/berlin/staff/invoices", "/apps/clients/berlin/staff/")).toBe(
      "invoices",
    );
  });

  it("leaves the unslugged mount and mapped domains exactly as they were", () => {
    expect(surfaceBase("/apps/clients/staff/invoices", BAKED)).toBe(BAKED);
    expect(surfaceBase("/invoices", BAKED)).toBe("/");
  });

  it("refuses a side name in the slug position", () => {
    expect(instanceBase(BAKED, "/apps/clients/staff/staff")).toBeNull();
  });
});
