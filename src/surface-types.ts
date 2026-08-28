/**
 * The nav contract's TYPES, and nothing else (29-app-surfaces.md D7/D8).
 *
 * Split out of `urlSync.ts` for one concrete reason: `vite.config.ts` imports
 * the emitter, the emitter needs this shape, and the config is typechecked by
 * `tsconfig.node.json` with `lib: ES2023` and NO DOM. Importing the runtime
 * module from there put `window` into a program that has never heard of it, and
 * the errors named `urlSync.ts` rather than the config that caused them.
 *
 * So: types here (DOM-free, safe from either side), behaviour in `urlSync.ts`.
 * Synced byte-identically by `surface-build.sh`.
 */

/** One navigable screen, as both the emitter and the runtime see it. */
export interface SurfaceNavEntry<View extends string = string> {
  /** Stable id. Also the sidebar item's key — never renamed casually. */
  id: string;
  /**
   * Path under the surface's base, WITHOUT a leading slash: `invoices`,
   * `orders/open`. Relative because the base differs per placement —
   * `/apps/clients/staff/` path-hosted, `/` on a mapped domain, and
   * `/a/clients/` as seen by the dashboard — and only a relative path is the
   * same string in all three.
   */
  path: string;
  /** The app's own view id this path selects. */
  view: View;
  /** lucide icon NAME, kebab-case — never an imported component. The emitter
   *  runs in the Vite config, which must not pull the icon package. */
  icon?: string;
  /**
   * Which side this screen belongs to. The emitter writes one file per side
   * and filters on this, so the two `surface.json`s cannot disagree with the
   * `SCREENS` split they were built from.
   */
  side: 'staff' | 'customer';
  /**
   * A lens within the side, not a permission (28-T44's ruling). Renders as a
   * separate sidebar item; the app decides what it means.
   */
  persona?: string;
}
