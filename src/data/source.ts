/**
 * The DataSource seam.
 *
 * This app ships in demo mode: every read returns the seeded fiction in
 * `demo.ts`, synchronously, with no network involved. The seam exists so that
 * pointing the app at a real Adminium deployment is a change to ONE file.
 *
 * When `@adminium/manifest` lands (Phase B), a second implementation backed by
 * `AdminiumDataSource` slots in here and `demoSource` becomes the fallback
 * used when no `adm_pub_` key is configured.
 */

import {
  CLIENTS,
  SEED_ACTIVITY,
  SEED_INVOICES,
  SEED_PROJECTS,
  SEED_PROPOSALS,
} from "./demo.ts";
import type {
  ActivityEntry,
  Client,
  Invoice,
  Project,
  Proposal,
} from "./types.ts";

export interface DataSource {
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

/** The source the app is currently wired to. */
export const source: DataSource = demoSource;
