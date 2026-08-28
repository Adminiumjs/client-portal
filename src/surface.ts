/**
 * Which product this bundle IS — decided at build time, in one place.
 *
 * ─── Why these are consts and not functions ──────────────────────────────────
 *
 * Every value here folds to a literal at build time, so a branch guarded by one
 * is eliminated from the bundle rather than merely skipped at runtime. That is
 * the difference between "the demo dock does not render" and "the demo dock is
 * not in the file", and only the second is true of a build a customer loads.
 *
 * The rule that makes it work is narrow and easy to break: do NOT wrap these in
 * `Boolean(...)`. Vite substitutes `import.meta.env.X` with a literal, but
 * Rollup will not fold a CALL, so `Boolean(a && b)` leaves the branch live and
 * the dock ships. `!!(a && b)` folds; `Boolean(a && b)` does not. Measured, not
 * assumed.
 *
 * ─── The four modes ──────────────────────────────────────────────────────────
 *
 *   demo             no side, no API vars   seeded fiction + the demo dock.
 *                                           Built by `build:demo`, served only
 *                                           by the adminium.dev marketplace.
 *   connected        no side, API vars set  standalone SPA against the public
 *                                           API with a publishable key.
 *   hosted-staff     side=staff             served BY Adminium at
 *                                           /apps/<key>/staff/; same origin, so
 *                                           it rides the operator's session and
 *                                           needs no key at all.
 *   hosted-customer  side=customer          served by Adminium at
 *                                           /apps/<key>/customer/; public, so
 *                                           it still uses the public API.
 */

/**
 * Set by `build:surface:*`. Absent in every other build, which is what makes
 * `HOSTED` false — and therefore what makes the hosted-only code disappear from
 * the demo and standalone bundles.
 */
const SIDE_RAW = import.meta.env.VITE_ADMINIUM_SURFACE_SIDE;

export type SurfaceSide = "staff" | "customer";

export const SURFACE_SIDE: SurfaceSide | null =
  SIDE_RAW === "staff" ? "staff" : SIDE_RAW === "customer" ? "customer" : null;

/** Served by Adminium itself, at the same origin as the dashboard. */
export const HOSTED = SURFACE_SIDE !== null;

/** A standalone build pointed at a public API with a publishable key. */
export const CONNECTED = !!(
  import.meta.env.VITE_ADMINIUM_API_BASE_URL && import.meta.env.VITE_ADMINIUM_PUBLISHABLE_KEY
);

/**
 * The seeded fiction and the demo dock ship in exactly one build.
 *
 * Note this is the INVERTED default the fleet is moving to: demo is what a
 * deliberate `build:demo` produces, not what you get by forgetting to configure
 * something.
 */
export const DEMO = !HOSTED && !CONNECTED;
