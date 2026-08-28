/**
 * The DataSource seam.
 *
 * This app ships in demo mode: every read returns the seeded fiction in
 * `demo.ts`, synchronously, with no network involved. The seam exists so that
 * pointing the app at a real Adminium deployment is a change to ONE file.
 *
 * That second implementation now exists: `adminiumSource.ts` reads a real
 * Adminium instance through `@adminiumjs/public-client` and is swapped in by
 * `main.tsx` before React mounts. `demoSource` remains the fallback whenever
 * either build-time env var is absent — which is the case for every
 * marketplace demo, and is why that fallback is structural rather than a catch.
 *
 * §5.3 recorded this seam as ORPHANED, and it was: the store, two screens and
 * `lib/format.ts` reached past it into `data/demo.ts` for the clock, the tax
 * rate and the portal's demo credentials. There is now one reader,
 * `data/live.ts`, and everything else reads that.
 */

import {
  CLIENTS,
  PORTAL_HINTS,
  SEED_ACTIVITY,
  SEED_INVOICES,
  SEED_PROJECTS,
  SEED_PROPOSALS,
  TAX_RATE,
  TODAY,
} from "./demo.ts";
import type {
  ActivityEntry,
  Client,
  Invoice,
  Project,
  Proposal,
} from "./types.ts";

/** One tap-to-fill credential on the portal's entry screen. */
export interface PortalHint {
  email: string;
  num: string;
}

export interface DataSource {
  /** Today, as a day serial, in the STUDIO's timezone. */
  today(): number;
  /** The studio's standing tax rate for new documents, as a whole percentage. */
  taxRate(): number;
  /**
   * The credentials the portal entry screen offers as a one-tap example.
   *
   * EMPTY on a connected build, by construction. These are a real client's
   * e-mail address and a real document number; pre-filling them on the public
   * entry screen would hand one client's invoices to whoever loaded the page.
   */
  portalHints(): PortalHint[];
  clients(): Client[];
  proposals(): Proposal[];
  projects(): Project[];
  invoices(): Invoice[];
  activity(): ActivityEntry[];
}

/**
 * Deep-copied on the way out, nested arrays included. A caller that mutates
 * what it is given cannot reach back into the seed, which is what lets the
 * demo reset cleanly.
 */
export const demoSource: DataSource = {
  today: () => TODAY,
  taxRate: () => TAX_RATE,
  portalHints: () => PORTAL_HINTS.map((h) => ({ ...h })),
  clients: () => CLIENTS.map((c) => ({ ...c })),
  proposals: () =>
    SEED_PROPOSALS.map((p) => ({
      ...p,
      scope: [...p.scope],
      items: p.items.map((i) => ({ ...i })),
    })),
  projects: () =>
    SEED_PROJECTS.map((p) => ({
      ...p,
      milestones: p.milestones.map((m) => ({ ...m })),
      deliverables: p.deliverables.map((d) => ({ ...d })),
    })),
  invoices: () =>
    SEED_INVOICES.map((i) => ({
      ...i,
      items: i.items.map((x) => ({ ...x })),
      payments: i.payments.map((x) => ({ ...x })),
    })),
  activity: () => SEED_ACTIVITY.map((a) => ({ ...a })),
};

let current: DataSource = demoSource;
let read = false;

/**
 * The source the app is currently wired to.
 *
 * An indirection rather than a re-export, because `data/live.ts` reads it at
 * MODULE SCOPE — a re-exported binding would be captured at import time and a
 * later swap would change nothing.
 */
export const source: DataSource = {
  today: () => ((read = true), current.today()),
  taxRate: () => ((read = true), current.taxRate()),
  portalHints: () => ((read = true), current.portalHints()),
  clients: () => ((read = true), current.clients()),
  proposals: () => ((read = true), current.proposals()),
  projects: () => ((read = true), current.projects()),
  invoices: () => ((read = true), current.invoices()),
  activity: () => ((read = true), current.activity()),
};

/**
 * Swap the backing source. Must happen before any module-scope read.
 *
 * The tripwire is the whole reason this is a function and not an assignment:
 * the ordering it depends on is invisible, and getting it wrong fails SILENTLY
 * — the app renders demo data against a configured backend and looks fine. A
 * thrown error at boot is the only way that mistake announces itself.
 */
export function setDataSource(next: DataSource): void {
  if (read) {
    throw new Error(
      "setDataSource() called after the app already read — import App dynamically, after the snapshot resolves.",
    );
  }
  current = next;
}

/**
 * True once a real backend is behind the seam.
 *
 * Read by the demo dock, which resets the studio and rewrites documents:
 * against a real client's invoices those controls do damage, so it does not
 * render.
 */
export function isConnected(): boolean {
  return current !== demoSource;
}
