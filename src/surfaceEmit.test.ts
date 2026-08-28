/**
 * `surface.json`, the document (29-app-surfaces.md D7, 29-T11).
 *
 * `buildSurfaceJson` is a pure function precisely so this can assert the
 * contract without running a build — the build is asserted separately, by
 * `surfaceBuild.test.ts`, which greps the real output.
 */
import { describe, expect, it } from 'vitest';

import { buildSurfaceJson, SURFACE_JSON_VERSION } from '../surface-emit.ts';
import type { SurfaceNavEntry } from './surface-types.ts';

type V = 'home' | 'orders' | 'entry';

const NAV: (SurfaceNavEntry<V> & { labelKey: string })[] = [
  { id: 'home', path: 'home', view: 'home', side: 'staff', icon: 'house', labelKey: 'nav.home' },
  {
    id: 'orders',
    path: 'orders',
    view: 'orders',
    side: 'staff',
    persona: 'floor',
    labelKey: 'nav.orders',
  },
  { id: 'entry', path: '', view: 'entry', side: 'customer', labelKey: 'nav.entry' },
];

const MESSAGES = {
  'en-US': { 'nav.home': 'Home', 'nav.orders': 'Orders', 'nav.entry': 'Portal', app: 'Demo' },
  'de-DE': { 'nav.home': 'Start', 'nav.orders': 'Aufträge', 'nav.entry': 'Portal', app: 'Demo' },
};

const OPTS = { appKey: 'clients', nav: NAV, appLabelKey: 'app', messages: MESSAGES };

describe('buildSurfaceJson', () => {
  it('writes only the side being built', () => {
    // A staff bundle naming customer screens would offer Adminium's sidebar
    // sections that render nothing.
    expect(buildSurfaceJson('staff', OPTS).nav.map((n) => n.id)).toEqual(['home', 'orders']);
    expect(buildSurfaceJson('customer', OPTS).nav.map((n) => n.id)).toEqual(['entry']);
  });

  it('carries every locale, not the builder\'s', () => {
    /*
     * The file is written once and read by a server serving many operators.
     * Resolving to one language here would pin every operator to whatever
     * locale the CI runner had. The SERVER picks, per session.
     */
    const doc = buildSurfaceJson('staff', OPTS);
    expect(doc.nav[0]?.labels).toEqual({ 'en-US': 'Home', 'de-DE': 'Start' });
    expect(doc.appLabels).toEqual({ 'en-US': 'Demo', 'de-DE': 'Demo' });
  });

  it('stamps the version and the app key', () => {
    const doc = buildSurfaceJson('staff', OPTS);
    expect(doc.v).toBe(SURFACE_JSON_VERSION);
    expect(doc.appKey).toBe('clients');
    expect(doc.side).toBe('staff');
  });

  it('keeps icon and persona optional rather than emitting nulls', () => {
    const [home, orders] = buildSurfaceJson('staff', OPTS).nav;
    expect(home).not.toHaveProperty('persona');
    expect(orders).not.toHaveProperty('icon');
    expect(orders?.persona).toBe('floor');
  });

  it('THROWS on a missing translation instead of falling back to English', () => {
    /*
     * A silent English fallback would put one wrong-language row in an
     * otherwise translated sidebar — the kind of bug nobody reports and nobody
     * finds. Every app's `messages/index.ts` already makes a missing key a
     * compile error, so reaching this means something upstream broke.
     */
    const holes = { ...MESSAGES, 'de-DE': { ...MESSAGES['de-DE'], 'nav.home': '' } };
    expect(() => buildSurfaceJson('staff', { ...OPTS, messages: holes })).toThrow(/de-DE.*nav\.home/);
  });

  it('refuses an absolute nav path', () => {
    // Relative, always: the base differs per placement (path-hosted, mapped
    // domain, embedded) and only a relative path is the same in all three.
    const bad = [{ ...NAV[0], path: '/home' } as (typeof NAV)[number]];
    expect(() => buildSurfaceJson('staff', { ...OPTS, nav: bad })).toThrow(/must not start with/);
  });
});
