/**
 * `demo.json`, the document — emitted from the app's own declaration, in all
 * eight languages, and only by the demo build.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildDemoJson, demoJsonPlugin, type DemoEmitOptions } from '../demo-emit.ts';
import { DEMO_LOCALES, demoJsonIssues } from './demo-types.ts';

const words: Record<string, string> = {
  'nav.till': 'Till',
  'nav.floor': 'Floor',
  'do.pay': 'Take a payment',
  'mode.cafe': 'Café',
  'mode.shop': 'Shop',
  'who.guest': 'Guest',
  'who.staff': 'Staff',
  'clock.15m': '+15 min',
  'clock.reset': 'Back to this morning',
};
const MESSAGES = Object.fromEntries(DEMO_LOCALES.map((l) => [l, Object.fromEntries(Object.entries(words).map(([k, v]) => [k, `${v} (${l})`]))]));

const OPTS: DemoEmitOptions = {
  appKey: 'pos',
  dir: 'point-of-sale',
  frames: ['tablet', 'phone'],
  screens: [
    { id: 'till', view: 'register', icon: 'receipt', labelKey: 'nav.till', shortcuts: [{ id: 'pay', icon: 'credit-card', labelKey: 'do.pay' }] },
    { id: 'floor', view: 'floor', icon: 'layout-grid', labelKey: 'nav.floor' },
  ],
  modes: [{ id: 'service', options: [{ id: 'restaurant', labelKey: 'mode.cafe' }, { id: 'retail', labelKey: 'mode.shop' }] }],
  toggles: ['online'],
  messages: MESSAGES,
};

let out: string | null = null;
afterEach(() => {
  if (out !== null) rmSync(out, { recursive: true, force: true });
  out = null;
  delete process.env['VITE_ADMINIUM_SURFACE_SIDE'];
});

describe('buildDemoJson', () => {
  it('writes the app’s screens, shortcuts and modes with labels in all eight languages', () => {
    const doc = buildDemoJson(OPTS);
    expect(doc.base).toBe('/demo/point-of-sale/app/');
    expect(doc.screens[0]?.shortcuts?.[0]?.labels['ar-EG']).toBe('Take a payment (ar-EG)');
    expect(Object.keys(doc.screens[1]!.labels).sort()).toEqual([...DEMO_LOCALES].sort());
    // What the website would refuse, it never emits.
    expect(demoJsonIssues(doc, { appKey: 'pos', dir: 'point-of-sale' })).toEqual([]);
  });

  it('throws on a missing translation rather than falling back to English', () => {
    const messages = { ...MESSAGES, 'cs-CZ': { ...MESSAGES['cs-CZ'], 'do.pay': '' } };
    expect(() => buildDemoJson({ ...OPTS, messages })).toThrow('no cs-CZ string for "do.pay"');
    const { ['zh-TW']: _gone, ...seven } = MESSAGES;
    expect(() => buildDemoJson({ ...OPTS, messages: seven })).toThrow('no zh-TW messages');
  });

  it('writes persona icons and a reset named in all eight languages', () => {
    const doc = buildDemoJson({
      ...OPTS,
      screens: [{ ...OPTS.screens[0]!, persona: 'staff' }],
      personas: [{ id: 'guest', icon: 'user-round', labelKey: 'who.guest' }, { id: 'staff', labelKey: 'who.staff' }],
      clock: { advance: [{ id: '15m', labelKey: 'clock.15m' }], reset: { labelKey: 'clock.reset' } },
    });
    expect(doc.personas).toEqual([
      { id: 'guest', icon: 'user-round', labels: expect.objectContaining({ 'en-US': 'Guest (en-US)' }) },
      { id: 'staff', labels: expect.objectContaining({ 'zh-TW': 'Staff (zh-TW)' }) },
    ]);
    expect(doc.clock?.reset).toEqual({ labels: expect.objectContaining({ 'ar-EG': 'Back to this morning (ar-EG)' }) });
    expect(demoJsonIssues(doc, { appKey: 'pos', dir: 'point-of-sale' })).toEqual([]);
    expect(buildDemoJson({ ...OPTS, clock: { advance: [], reset: true } }).clock?.reset).toBe(true);
  });
});

describe('demoJsonPlugin', () => {
  const run = (base: string) => {
    out = mkdtempSync(join(tmpdir(), 'demo-emit-'));
    mkdirSync(join(out, 'dist'));
    const plugin = demoJsonPlugin(OPTS);
    plugin.configResolved({ root: out, base, build: { outDir: 'dist' } });
    plugin.writeBundle();
    return join(out, 'dist', 'demo.json');
  };

  it('writes demo.json in the demo build, and nothing in any other', () => {
    const written = run('/demo/point-of-sale/app/');
    expect(JSON.parse(readFileSync(written, 'utf8')).appKey).toBe('pos');
    rmSync(out!, { recursive: true, force: true });
    expect(existsSync(run('/'))).toBe(false);
    rmSync(out!, { recursive: true, force: true });
    process.env['VITE_ADMINIUM_SURFACE_SIDE'] = 'staff';
    expect(existsSync(run('/demo/point-of-sale/app/'))).toBe(false);
  });

  it('fails a demo build whose base is not this app’s', () => {
    expect(() => run('/demo/point-of-sale/')).toThrow('demo lives at "/demo/point-of-sale/app/"');
  });
});
