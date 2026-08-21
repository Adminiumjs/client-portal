/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/slots.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry (24 D7) — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * Slot registry v1 — CLOSED (24-marketplace-wave-4.md §5.4, eleven slots).
 *
 * A slot is a named place in a host surface, its payload, and its fill rule.
 * The registry is closed for the same reason the widget-id vocabulary is: an
 * open-ended extension point cannot be reviewed, translated, or kept working
 * across host versions. Adding a slot is a spec change, never a pull request
 * against an app.
 *
 * There is NO compatibility signal for this vocabulary, so do not look for one.
 * A slot carries no `version` field, unlike ContractDefinition (`version: 1`,
 * checked by hasContractVersion), and this package cannot version on its own
 * cadence either: the repo's changeset config declares `fixed: [["@adminium/*"]]`,
 * so every workspace moves together and the package version says nothing about
 * which slots a release speaks. Evolving a slot after release therefore needs a
 * real `version` field on the contract pattern — an earlier revision of this
 * comment claimed a package bump was the mechanism, and it never was.
 *
 * Every slot here is filled by something built in wave 4. A slot nobody fills
 * is a guess about a future add-on, which is why an earlier draft's twelfth
 * (`job.timeline.entries`) is absent.
 */

import { z } from 'zod';

/** Which persona's surface the slot lives in. */
export const SLOT_SURFACES = ['customer', 'staff', 'admin', 'both'] as const;
export type SlotSurface = (typeof SLOT_SURFACES)[number];

/**
 * `multi` renders every enabled fill ordered by `order` then by add-on key, so
 * the order is stable and does not depend on install sequence. `single` takes
 * the lowest `order` and records a SLOT_CONFLICT warning naming the add-on that
 * lost — never a silent override.
 */
export const SLOT_FILLS = ['multi', 'single', 'per-add-on'] as const;
export type SlotFill = (typeof SLOT_FILLS)[number];

export interface SlotDefinition {
  readonly id: string;
  readonly surface: SlotSurface;
  readonly fill: SlotFill;
  /** What the host passes into the fill. */
  readonly payload: string;
  /** What the add-on renders or resolves to. */
  readonly renders: string;
}

export const SLOT_REGISTRY = [
  {
    id: 'artwork.sources',
    surface: 'customer',
    fill: 'multi',
    payload: 'the configured job: product, trim size mm, bleed mm, sides, quantity',
    renders: 'an action tile, and a flow resolving to an ArtworkRef',
  },
  {
    id: 'checkout.delivery.methods',
    surface: 'customer',
    fill: 'multi',
    payload: 'parcel estimate + destination',
    renders: 'selectable rate rows',
  },
  {
    id: 'order.dispatch.panel',
    surface: 'customer',
    fill: 'single',
    payload: 'the dispatch record',
    renders: 'a read-only tracking view',
  },
  {
    // Renamed from `job.dispatch.actions` on 2026-08-05 (D21): the id names a
    // surface, not the print shop's domain, so a second host can fill it.
    id: 'order.dispatch.actions',
    surface: 'staff',
    fill: 'multi',
    payload: 'the order + its parcel estimate',
    renders: 'an action and its result panel',
  },
  {
    id: 'settings.add-on.panel',
    surface: 'admin',
    fill: 'per-add-on',
    // The values, a way to save a change to them, and the host's own catalogue
    // as representative records. The last of those is what lets an add-on say
    // something about the host's data — default parcel weights, say — without
    // the host computing it, which is a thing only the add-on knows how to do.
    payload: "the add-on's settings values, a patch handle, and sample records",
    renders: 'a settings form, its controls and the sentence under each',
  },
  {
    id: 'nav.add-on.routes',
    surface: 'both',
    fill: 'multi',
    payload: '—',
    renders: 'full-screen routes under /add-ons/<key>/*',
  },
  {
    id: 'product.options.personalize',
    surface: 'customer',
    fill: 'single',
    payload: 'the product + its variant and quantity',
    renders: 'a personalization surface resolving to a Personalization',
  },
  {
    id: 'cart.line.preview',
    surface: 'customer',
    fill: 'multi',
    payload: 'one basket / order line',
    renders: 'a thumbnail and the values in words',
  },
  {
    id: 'product.admin.panel',
    surface: 'staff',
    fill: 'multi',
    payload: 'the product record',
    renders: 'a setup panel (zones, constraints, sample)',
  },
  {
    id: 'order.line.actions',
    surface: 'staff',
    fill: 'multi',
    payload: 'one order line',
    renders: 'per-line actions and their output',
  },
  {
    // The only slot whose host is Adminium itself rather than an example app,
    // which is why its payload carries a table name.
    id: 'record.editor.panel',
    surface: 'admin',
    fill: 'multi',
    payload: 'the table name, the record, and write handles',
    renders: "a panel inside the generated dashboard's record editor",
  },
] as const satisfies readonly SlotDefinition[];

export type SlotId = (typeof SLOT_REGISTRY)[number]['id'];

export const SLOT_IDS = SLOT_REGISTRY.map((s) => s.id) as readonly SlotId[];

export const slotIdSchema = z.enum(SLOT_IDS as unknown as [SlotId, ...SlotId[]]);

const BY_ID = new Map<string, SlotDefinition>(SLOT_REGISTRY.map((s) => [s.id, s]));

export function isSlotId(v: unknown): v is SlotId {
  return typeof v === 'string' && BY_ID.has(v);
}

export function slotDefinition(id: SlotId): SlotDefinition {
  const found = BY_ID.get(id);
  /* c8 ignore next */
  if (found === undefined) throw new Error(`unknown slot id: ${id}`);
  return found;
}
