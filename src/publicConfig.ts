/**
 * Served-not-baked customer configuration (29-app-surfaces.md D10, 29-T16).
 *
 * A HOSTED customer surface no longer needs its publishable key baked at build
 * time: Adminium serves `surface-config.json` beside the bundle — the newest
 * live key BOUND to this app in Studio — so rotating a key is Studio + reload,
 * zero rebuilds. The document is exactly as public as the bundle that fetches
 * it; a publishable key in a public JS file was always the design (28 §3.3).
 *
 * ─── Resolution order, and why ───────────────────────────────────────────────
 *
 *   1. Baked `VITE_ADMINIUM_API_BASE_URL` + `VITE_ADMINIUM_PUBLISHABLE_KEY`.
 *      Standalone (connected) builds bake; hosted builds stop needing to.
 *      Baked wins so an operator who deliberately pinned a key keeps exactly
 *      the behaviour they pinned.
 *   2. Hosted customer: fetch the config document. The URL is built from
 *      `import.meta.env.BASE_URL` (`/apps/<key>/customer/`), NOT a relative
 *      `./surface-config.json` — a relative fetch resolves against the
 *      DOCUMENT URL, so any deep screen (`…/customer/track/42`, or `/track`
 *      on a mapped domain) would ask for the wrong path. The base-derived
 *      absolute path is correct under BOTH placements: path-hosted directly,
 *      and domain-hosted through the host-agnostic `/apps/*` pass-through.
 *   3. Neither → null, and the app's existing hard-stop renders the legible
 *      not-connected screen (28 D24's failure surface). Never a silent demo.
 *
 * `baseUrl: ""` in the served document means "this same origin"; it is
 * normalized here, in the one synced place, so no splice re-derives it.
 */

import { HOSTED, SURFACE_SIDE } from "./surface.ts";
// The mount-path math lives with the staff resolver because that is the one
// module every app in the fleet has; it is not staff-specific (29 D9).
import { configBase } from "./staffConnection.ts";

export interface SurfaceConfig {
  /** Absolute origin to call, never empty once resolved. */
  baseUrl: string;
  publishableKey: string;
}

/** Test seams only — production call sites pass nothing. */
export interface ResolveSurfaceConfigOptions {
  baked?: { baseUrl?: string | undefined; publishableKey?: string | undefined };
  /** Defaults to `HOSTED && SURFACE_SIDE === "customer"` (build-time facts). */
  hostedCustomer?: boolean;
  /** Defaults to `import.meta.env.BASE_URL`, instance-adjusted. */
  base?: string;
  /** Defaults to `window.location.pathname`; only used to detect an instance. */
  pathname?: string;
  /** Defaults to `window.location.origin`. */
  origin?: string;
  fetchImpl?: typeof fetch;
}

export async function resolveSurfaceConfig(
  opts: ResolveSurfaceConfigOptions = {},
): Promise<SurfaceConfig | null> {
  const baked = opts.baked ?? {
    baseUrl: import.meta.env.VITE_ADMINIUM_API_BASE_URL,
    publishableKey: import.meta.env.VITE_ADMINIUM_PUBLISHABLE_KEY,
  };
  if (
    typeof baked.baseUrl === "string" &&
    baked.baseUrl !== "" &&
    typeof baked.publishableKey === "string" &&
    baked.publishableKey !== ""
  ) {
    return { baseUrl: baked.baseUrl, publishableKey: baked.publishableKey };
  }

  const hostedCustomer = opts.hostedCustomer ?? (HOSTED && SURFACE_SIDE === "customer");
  if (!hostedCustomer) return null;

  /*
   * Instance-aware (29 D9): the same customer bundle is served at
   * `/apps/<key>/customer/` and at `/apps/<key>/<slug>/customer/`, and those
   * two answer with DIFFERENT keys — one per database. Reading the baked base
   * here would make every instance fetch the root's key and quietly serve the
   * wrong business's data, which is the exact failure instances exist to avoid.
   */
  const base =
    opts.base ??
    configBase(import.meta.env.BASE_URL, opts.pathname ?? window.location.pathname);
  const doFetch = opts.fetchImpl ?? fetch;
  try {
    // `no-store` end to end: the server marks the reply uncacheable and the
    // request must not resurrect one — a rotated key must land on reload.
    const res = await doFetch(`${base}surface-config.json`, { cache: "no-store" });
    if (!res.ok) return null;
    const doc: unknown = await res.json();
    if (doc === null || typeof doc !== "object") return null;
    const key = (doc as { publishableKey?: unknown }).publishableKey;
    if (typeof key !== "string" || key === "") return null;
    const served = (doc as { baseUrl?: unknown }).baseUrl;
    const baseUrl =
      typeof served === "string" && served !== ""
        ? served
        : (opts.origin ?? window.location.origin);
    return { baseUrl, publishableKey: key };
  } catch {
    // Network failure, or the SPA fallback answered with HTML (an instance
    // whose server predates the config route): both are "not configured".
    return null;
  }
}
