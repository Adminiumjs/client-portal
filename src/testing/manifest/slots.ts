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
 * Slot registry v1 — CLOSED (24-marketplace-wave-4.md §5.4; eleven slots, plus
 * one bought on 2026-08-28 and named at the end of the list).
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
 * Every slot in the original eleven is filled by something built in wave 4. A
 * slot nobody fills is a guess about a future add-on, which is why an earlier
 * draft's twelfth (`job.timeline.entries`) is absent.
 *
 * THAT RULE SURVIVED A PURCHASE RATHER THAN BEING WAIVED BY ONE. `record.actions`
 * arrives unfilled and is not a guess: it carries seven exhibits with a file and
 * a line each, and the entry itself sets out the difference at length so a
 * reader does not have to take the distinction on trust. If a second slot ever
 * lands here on weaker evidence than that, this paragraph is the thing it
 * should be measured against.
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
  {
    /*
     * THE TWELFTH, BOUGHT ON 2026-08-28 (31-add-on-candidates.md O1).
     *
     * ── IT IS NOT THE TWELFTH THIS FILE'S HEADER REFUSES ────────────────────
     *
     * The header says a slot nobody fills is a guess about a future add-on, and
     * names `job.timeline.entries` as the guess that was cut. A reader arriving
     * here and finding a slot with no fill in this release is owed the
     * difference, because on the face of it this is the same thing.
     *
     * A GUESS HAS NO EXHIBITS. `job.timeline.entries` was somebody's idea of
     * what an add-on might one day want; nothing in any repo asked for it. This
     * id arrives carrying seven, each a real screen in a shipped app with a
     * file and a line against it, gathered by five independent surveys that
     * were not looking for a slot — they were looking for what the apps lie
     * about — and then held to an adversarial pass. They are written down in
     * 31 Appendix A.1, which is the artifact this entry cites and which exists
     * so the purchase can be audited rather than taken on trust:
     *
     *   1. the per-record document renders (invoice, folio, receipt, recall
     *      letter, .ics) across five apps
     *   2. the certificate render moment
     *   3. every transactional send-this-record moment — twelve hosts
     *   4. the wallet-pass render moment
     *   5. click-to-call / log-a-call on a deal
     *   6. the post-resolution satisfaction action
     *   7. attach-a-room to a session record
     *
     * 25 §8.2 declined this same shape and said what would change its mind:
     * two independent implementations' worth of evidence. That is the bar this
     * cleared, and the ruling is recorded rather than inferred.
     *
     * ── WHAT IT IS FOR ──────────────────────────────────────────────────────
     *
     * One opening, on the screen where somebody is already looking at ONE
     * record, to do a thing to it. Every exhibit above is that sentence. The
     * eleven ids before it could not carry any of them: `order.line.actions`
     * is a line inside an order rather than a record, `order.dispatch.actions`
     * is the dispatch end of an outbound order specifically, and
     * `record.editor.panel` is a PANEL inside the generated dashboard's editor
     * — a different host, a different verb, and no example app has one.
     *
     * ── `both`, AND WHY NOT `staff` ─────────────────────────────────────────
     *
     * The dossier's own title says "staff/admin", and five of its seven
     * exhibits are staff screens. Two are not: the certificate sheet is the
     * STUDENT's own page (`learning-platform/src/screens/Certificate.tsx`
     * opens "the student's completion sheet") and the wallet pass is the
     * ticket-holder's. Ruling the id `staff` would have put the two exhibits
     * everyone actually wants to demo outside the thing bought to carry them,
     * and 31 §A.3 already records "neither the 11 nor A.1 covers a customer
     * surface" as an open gap — which is the same observation from the other
     * end.
     *
     * There is nothing in the payload that a customer looking at their own
     * record makes dishonest: it is a record and a way to write back to it,
     * and who is reading changes what the HOST mounts, not what the slot is.
     * `nav.add-on.routes` is `both` for the same reason.
     *
     * ── THE ONE THING A READER SHOULD HOLD AGAINST IT ───────────────────────
     *
     * It ships in wave 6 with NO FILL. Its first consumer is `docs-paperwork`,
     * which is wave 5 and unbuilt, and the wave-6 add-on that could have
     * filled it honestly turned out not to need it: `holiday-calendars`'
     * working-day counts are derived live from the merged calendar, so a
     * "recompute this request" action would have been an invented reason to
     * touch the slot rather than a thing an operator wants. Inventing one to
     * make this entry look filled is precisely the dishonesty the registry is
     * closed to prevent, so it is not filled, and this comment says so.
     */
    id: 'record.actions',
    surface: 'both',
    fill: 'multi',
    payload: 'what kind of record it is, the record, and a way to write back',
    renders: 'an action and the panel its result lands in',
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
