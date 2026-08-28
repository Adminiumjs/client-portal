/**
 * `surface.json` — the build-emitted nav contract (29-app-surfaces.md D7).
 *
 * ─── Why the build writes this and a human never does ───────────────────────
 *
 * Adminium's sidebar has to render an app's sections without knowing anything
 * about the app. Something has to tell it what those sections are. The obvious
 * answers are both wrong:
 *
 *   hand-authored JSON  drifts from the app's `SCREENS` split the moment either
 *                       is edited, and the drift is silent — a section that
 *                       navigates nowhere, or a screen with no way in.
 *   the app manifest    `frontends[].routes` is DESCRIPTIVE and predates the
 *                       split by two waves; 11 manifests had it rejected by a
 *                       `.strict()` schema and re-admitted later. It is a
 *                       cross-check, never the source.
 *
 * So it is emitted, from `src/surface-nav.ts` — the SAME module the runtime
 * routes with. The file on disk and the app's behaviour cannot disagree,
 * because there is one declaration and two readers.
 *
 * ─── One file per side, filtered by side ────────────────────────────────────
 *
 * `build:surface:staff` and `build:surface:customer` each write their own
 * `surface.json` beside their own `index.html`, holding only that side's
 * entries. A staff bundle's file naming customer screens would offer the
 * dashboard sections that render nothing.
 *
 * ─── Labels ship in ALL EIGHT locales ───────────────────────────────────────
 *
 * The file is written once at build time and read by a server that serves many
 * operators; resolving to one language here would pin every operator to the
 * builder's locale. The SERVER resolves to the session's locale when it puts
 * these into `/bootstrap` — see `surfaces-root.ts`. The 8-locale map stays on
 * disk.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { SurfaceNavEntry } from './src/surface-types.ts';

/** Bumped when the SHAPE changes. Adminium refuses a version it cannot read. */
export const SURFACE_JSON_VERSION = 1;

export interface SurfaceJsonNavItem {
  id: string;
  path: string;
  icon?: string;
  persona?: string;
  /** BCP-47 tag → label. Every locale the app ships. */
  labels: Record<string, string>;
}

export interface SurfaceJson {
  v: number;
  appKey: string;
  side: 'staff' | 'customer';
  /** The app's own name, per locale — the sidebar section heading. */
  appLabels: Record<string, string>;
  nav: SurfaceJsonNavItem[];
}

export interface SurfaceEmitOptions<View extends string> {
  /** The marketplace key — the `/apps/<key>/` segment, not the repo name. */
  appKey: string;
  nav: readonly (SurfaceNavEntry<View> & { labelKey: string })[];
  /** Message key whose value names the app in the sidebar. */
  appLabelKey: string;
  /** `{ 'en-US': { key: string, … }, … }` — the app's own flattened bundles. */
  messages: Record<string, Record<string, string>>;
}

/**
 * The document, as a pure function so a test can assert it without a build.
 *
 * A missing translation THROWS rather than falling back to English. The parity
 * guard in every app's `messages/index.ts` already makes a missing key a
 * compile error, so reaching this means something has gone wrong that a silent
 * fallback would hide — and a sidebar section labelled in the wrong language is
 * the kind of bug nobody reports.
 */
export function buildSurfaceJson<View extends string>(
  side: 'staff' | 'customer',
  opts: SurfaceEmitOptions<View>,
): SurfaceJson {
  const locales = Object.keys(opts.messages);
  const lookup = (key: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const locale of locales) {
      const value = opts.messages[locale]?.[key];
      if (value === undefined || value === '') {
        throw new Error(
          `surface.json: no ${locale} string for "${key}" — surface-nav.ts names a message key ` +
            'the bundles do not carry.',
        );
      }
      out[locale] = value;
    }
    return out;
  };

  const nav = opts.nav
    .filter((entry) => entry.side === side)
    .map((entry) => {
      if (entry.path.startsWith('/')) {
        // Relative, always — the base differs per placement (urlSync.ts).
        throw new Error(`surface.json: nav path "${entry.path}" must not start with "/"`);
      }
      return {
        id: entry.id,
        path: entry.path,
        ...(entry.icon === undefined ? {} : { icon: entry.icon }),
        ...(entry.persona === undefined ? {} : { persona: entry.persona }),
        labels: lookup(entry.labelKey),
      };
    });

  return {
    v: SURFACE_JSON_VERSION,
    appKey: opts.appKey,
    side,
    appLabels: lookup(opts.appLabelKey),
    nav,
  };
}

/**
 * Minimal structural Vite plugin shape.
 *
 * Typed here rather than imported so this module pulls no vite types into the
 * config's own typecheck — `tsconfig.node.json` compiles `vite.config.ts` with
 * `lib: ES2023` and nothing else, and a stray DOM-typed import breaks the
 * build with an error that names the wrong file.
 */
interface Resolvedish {
  root: string;
  build: { outDir: string };
}
interface EmitPlugin {
  name: string;
  apply: 'build';
  configResolved: (config: Resolvedish) => void;
  writeBundle: () => void;
}

/**
 * The plugin.
 *
 * `writeBundle`, not `generateBundle`: the file is a sibling of `index.html`
 * rather than a hashed asset, `outDir` is where it must land whatever `base`
 * says, and emitting it as a rollup asset would put it through the asset
 * pipeline for no reason.
 *
 * A build with no side is a demo or standalone build and writes NOTHING — those
 * artifacts must stay byte-identical (acceptance criterion 12).
 */
export function surfaceJsonPlugin<View extends string>(
  opts: SurfaceEmitOptions<View>,
): EmitPlugin {
  const raw = process.env['VITE_ADMINIUM_SURFACE_SIDE'];
  const side = raw === 'staff' || raw === 'customer' ? raw : null;
  // Resolved from vite's own config rather than a second env var: `--outDir`
  // is already on the build:surface:* command line, and a parallel variable
  // that had to agree with it would eventually not.
  let dir = '';

  return {
    name: 'adminium:surface-json',
    apply: 'build',
    configResolved: (config: Resolvedish) => {
      dir = resolve(config.root, config.build.outDir);
    },
    writeBundle: () => {
      if (side === null) return;
      const target = join(dir, 'surface.json');
      writeFileSync(target, `${JSON.stringify(buildSurfaceJson(side, opts), null, 2)}\n`, 'utf8');
      console.info(`[adminium] wrote ${target}`);
    },
  };
}
