/**
 * The website's check of a `demo.json`, and the protocol's message guard.
 */
import { describe, expect, it } from 'vitest';

import { DEMO_LOCALES, demoJsonIssues, isDemoMessage } from './demo-types.ts';

const all = (text: string) => Object.fromEntries(DEMO_LOCALES.map((l) => [l, text]));
const GOOD = {
  v: 1,
  appKey: 'pos',
  base: '/demo/point-of-sale/app/',
  frames: ['tablet', 'phone'],
  screens: [{ id: 'till', view: 'register', icon: 'receipt', labels: all('Till'), shortcuts: [{ id: 'pay', icon: 'credit-card', labels: all('Pay') }] }],
  addOns: [{ key: 'receipts', labels: all('Receipts') }],
};
const CTX = { appKey: 'pos', dir: 'point-of-sale', addOnKeys: new Set(['receipts']) };

describe('demoJsonIssues', () => {
  it('accepts a manifest the card can show', () => {
    expect(demoJsonIssues(GOOD, CTX)).toEqual([]);
  });

  it('names every problem the website fails its build on', () => {
    const bad = {
      ...GOOD,
      v: 2,
      appKey: 'point-of-sale',
      base: '/demo/point-of-sale/',
      frames: ['watch'],
      screens: [
        { id: 'till', view: 'register', icon: 'Receipt', labels: { 'en-US': 'Till' } },
        { id: 'till', view: 'floor', icon: 'layout-grid', labels: all('Floor'), persona: 'host' },
      ],
      addOns: [{ key: 'loyalty', labels: all('Loyalty') }],
    };
    expect(demoJsonIssues(bad, CTX)).toEqual([
      'v is 2, not 1',
      'appKey is "point-of-sale", but /demo/point-of-sale/ belongs to "pos"',
      'base is "/demo/point-of-sale/", not "/demo/point-of-sale/app/"',
      'frames: "watch" is not a frame',
      'screens: "till" is used twice',
      'screens.till: "Receipt" is not an icon name',
      'screens.till: no label in ar-EG, cs-CZ, da-DK, de-DE, fr-FR, zh-CN, zh-TW',
      'screens.till: persona "host" is not declared',
      'addOns: "loyalty" is not an add-on the marketplace knows',
    ]);
  });

  it('checks icons against the card’s set when it is given', () => {
    expect(demoJsonIssues(GOOD, { ...CTX, icons: new Set(['receipt']) })).toEqual(['screens.till.pay: no icon "credit-card"']);
  });

  // An app with two sides and its own clock: personas with icons, and a reset
  // named the app's way rather than the card's "Start over".
  const CLINIC = {
    v: 1,
    appKey: 'clinic',
    base: '/demo/clinic-desk/app/',
    frames: ['desktop', 'phone'],
    screens: [
      { id: 'find', view: 'find', icon: 'calendar-search', persona: 'patient', labels: all('Find a time') },
      { id: 'day', view: 'day', icon: 'calendar-days', persona: 'clinic', labels: all('Day sheet') },
      { id: 'notfound', view: 'notfound', icon: 'file-x', labels: all('404') },
    ],
    personas: [
      { id: 'patient', icon: 'user-round', labels: all('Patient') },
      { id: 'clinic', icon: 'clipboard-list', labels: all('Clinic') },
    ],
    clock: { advance: [{ id: '15m', labels: all('+15 min') }], reset: { labels: all('Back to Tuesday morning') } },
  };
  const CLINIC_CTX = { appKey: 'clinic', dir: 'clinic-desk' };

  it('accepts personas with icons and a labelled reset', () => {
    expect(demoJsonIssues(CLINIC, CLINIC_CTX)).toEqual([]);
    expect(demoJsonIssues({ ...CLINIC, clock: { ...CLINIC.clock, reset: true } }, CLINIC_CTX)).toEqual([]);
    expect(demoJsonIssues({ ...CLINIC, clock: { ...CLINIC.clock, reset: false } }, CLINIC_CTX)).toEqual([]);
  });

  it('checks a labelled reset like every other label', () => {
    const sevenOnly = Object.fromEntries(Object.entries(all('Back to Tuesday morning')).filter(([l]) => l !== 'ar-EG'));
    expect(demoJsonIssues({ ...CLINIC, clock: { ...CLINIC.clock, reset: { labels: sevenOnly } } }, CLINIC_CTX)).toEqual([
      'clock.reset: no label in ar-EG',
    ]);
    expect(demoJsonIssues({ ...CLINIC, clock: { ...CLINIC.clock, reset: {} } }, CLINIC_CTX)).toEqual(['clock.reset: no labels']);
    expect(demoJsonIssues({ ...CLINIC, clock: { ...CLINIC.clock, reset: 'Back to Tuesday' } }, CLINIC_CTX)).toEqual([
      'clock.reset: "Back to Tuesday" is neither true, false nor {labels}',
    ]);
  });

  it('checks a persona’s icon when it has one', () => {
    const personas = [{ id: 'patient', icon: 'UserRound', labels: all('Patient') }, CLINIC.personas[1]];
    expect(demoJsonIssues({ ...CLINIC, personas }, CLINIC_CTX)).toEqual(['personas.patient: "UserRound" is not an icon name']);
    expect(demoJsonIssues(CLINIC, { ...CLINIC_CTX, icons: new Set(['calendar-search', 'calendar-days', 'file-x', 'user-round']) })).toEqual([
      'personas.clinic: no icon "clipboard-list"',
    ]);
  });
});

describe('isDemoMessage', () => {
  it('takes only this protocol’s messages, at this version', () => {
    expect(isDemoMessage({ type: 'adminium:demo:hello', dv: 1, appKey: 'pos' })).toBe(true);
    expect(isDemoMessage({ type: 'adminium:demo:hello', dv: 2, appKey: 'pos' })).toBe(false);
    expect(isDemoMessage({ type: 'adminium:embed:hello', dv: 1 })).toBe(false);
    expect(isDemoMessage('adminium:demo:reset')).toBe(false);
  });

  it('takes a state with or without the clock label and the overlay flag, at the same version', () => {
    const state = { type: 'adminium:demo:state', dv: 1, screen: 'day', persona: 'clinic', mode: null, online: true, toggles: {}, locale: 'en-US', theme: 'light' };
    expect(isDemoMessage(state)).toBe(true);
    expect(isDemoMessage({ ...state, clockLabel: 'Tue 28 Jul · 09:20', overlay: true })).toBe(true);
    expect(isDemoMessage({ ...state, clockLabel: 'Tue 28 Jul · 09:20', dv: 2 })).toBe(false);
  });
});
