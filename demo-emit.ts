/**
 * `demo.json` — what the website's demo card offers for this app, written by
 * the demo build and read by nothing else.
 *
 * The sibling of `surface-emit.ts`, and built on the same rule: the file is
 * EMITTED from the app's own declaration (its screens, shortcuts, personas and
 * modes, with their message keys), never written by hand, so the card and the
 * app cannot drift. Labels go out in all eight languages the card speaks, and a
 * missing one THROWS — a card button labelled in the wrong language is the
 * kind of bug nobody reports.
 *
 * ─── Only in the demo build ─────────────────────────────────────────────────
 *
 * The demo build is the one whose base is `/demo/<dir>/app/` (`build:demo`).
 * Every other build — a hosted surface, a standalone one, a plain `vite build`
 * — writes nothing, so their artifacts stay byte-identical. A base under
 * `/demo/` that is not exactly this app's is a misconfigured `build:demo`, and
 * fails the build rather than emitting a manifest the website would refuse.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  DEMO_JSON_VERSION,
  DEMO_LOCALES,
  type DemoFrame,
  type DemoJson,
  type DemoLabels,
} from './src/demo-types.ts';

interface Labelled {
  id: string;
  labelKey: string;
}

export interface DemoEmitOptions {
  /** The marketplace key (`pos`). */
  appKey: string;
  /** The folder under `/demo/` (`point-of-sale`). */
  dir: string;
  frames: DemoFrame[];
  screens: (Labelled & {
    view: string;
    icon: string;
    side?: 'staff' | 'customer';
    persona?: string;
    shortcuts?: (Labelled & { icon: string })[];
  })[];
  personas?: (Labelled & { icon?: string })[];
  modes?: { id: string; options: Labelled[] }[];
  toggles?: 'online'[];
  /** `reset: { labelKey }` names the reset the app's way; `true` leaves it to the card. */
  clock?: { advance: Labelled[]; reset: boolean | { labelKey: string } };
  addOns?: { key: string; labelKey: string }[];
  /** `{ 'en-US': { key: string, … }, … }` — the app's flattened bundles, all eight. */
  messages: Record<string, Record<string, string>>;
}

/** The document, as a pure function so a test can assert it without a build. */
export function buildDemoJson(opts: DemoEmitOptions): DemoJson {
  for (const locale of DEMO_LOCALES) {
    if (opts.messages[locale] === undefined) {
      throw new Error(`demo.json: the app ships no ${locale} messages, and the card speaks all eight languages.`);
    }
  }
  const labels = (key: string): DemoLabels => {
    const out: DemoLabels = {};
    for (const locale of DEMO_LOCALES) {
      const value = opts.messages[locale]?.[key];
      if (value === undefined || value === '') {
        throw new Error(`demo.json: no ${locale} string for "${key}" — the demo declaration names a key the bundles do not carry.`);
      }
      out[locale] = value;
    }
    return out;
  };
  const choice = (item: Labelled) => ({ id: item.id, labels: labels(item.labelKey) });

  return {
    v: DEMO_JSON_VERSION,
    appKey: opts.appKey,
    base: `/demo/${opts.dir}/app/`,
    frames: [...opts.frames],
    screens: opts.screens.map((screen) => ({
      id: screen.id,
      view: screen.view,
      icon: screen.icon,
      ...(screen.side === undefined ? {} : { side: screen.side }),
      ...(screen.persona === undefined ? {} : { persona: screen.persona }),
      labels: labels(screen.labelKey),
      ...(screen.shortcuts === undefined
        ? {}
        : { shortcuts: screen.shortcuts.map((s) => ({ id: s.id, icon: s.icon, labels: labels(s.labelKey) })) }),
    })),
    ...(opts.personas === undefined
      ? {}
      : { personas: opts.personas.map((p) => ({ id: p.id, ...(p.icon === undefined ? {} : { icon: p.icon }), labels: labels(p.labelKey) })) }),
    ...(opts.modes === undefined ? {} : { modes: opts.modes.map((m) => ({ id: m.id, options: m.options.map(choice) })) }),
    ...(opts.toggles === undefined ? {} : { toggles: [...opts.toggles] }),
    ...(opts.clock === undefined
      ? {}
      : {
          clock: {
            advance: opts.clock.advance.map(choice),
            reset: typeof opts.clock.reset === 'boolean' ? opts.clock.reset : { labels: labels(opts.clock.reset.labelKey) },
          },
        }),
    ...(opts.addOns === undefined ? {} : { addOns: opts.addOns.map((a) => ({ key: a.key, labels: labels(a.labelKey) })) }),
  };
}

/** Minimal structural Vite plugin shape (see `surface-emit.ts` for why). */
interface Resolvedish {
  root: string;
  base: string;
  build: { outDir: string };
}
interface EmitPlugin {
  name: string;
  apply: 'build';
  configResolved: (config: Resolvedish) => void;
  writeBundle: () => void;
}

export function demoJsonPlugin(opts: DemoEmitOptions): EmitPlugin {
  const expected = `/demo/${opts.dir}/app/`;
  let dir = '';
  let base = '';
  return {
    name: 'adminium:demo-json',
    apply: 'build',
    configResolved: (config: Resolvedish) => {
      dir = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    writeBundle: () => {
      const side = process.env['VITE_ADMINIUM_SURFACE_SIDE'] ?? '';
      if (side !== '' || !base.startsWith('/demo/')) return;
      if (base !== expected) {
        throw new Error(`demo.json: the demo build's base is "${base}", but this app's demo lives at "${expected}".`);
      }
      const target = join(dir, 'demo.json');
      writeFileSync(target, `${JSON.stringify(buildDemoJson(opts), null, 2)}\n`, 'utf8');
      console.info(`[adminium] wrote ${target}`);
    },
  };
}
