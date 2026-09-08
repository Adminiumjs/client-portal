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
 * two bought since and named at the end of the list, in the order they were
 * bought).
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
 *
 * A SECOND SLOT DID, AND IT IS MEASURED AGAINST THIS PARAGRAPH IN ITS OWN
 * ENTRY. `shell.overlay` (2026-09-01) carries FOUR exhibits, not seven, and one
 * of the four is an absence. It is therefore the weaker dossier and its entry
 * says so in those words rather than dressing four up as enough. What it has
 * that `record.actions` did not is the thing the paragraph above the last one
 * asks for: it ships WITH its fill, in the same wave, so the registry's founding
 * rule — a slot nobody fills is a guess — is satisfied on the day it lands
 * instead of being owed to a later wave. The two entries are the two ways a
 * purchase can be honest, and neither is the template for a third: a third that
 * has neither seven exhibits nor a fill in the same wave is the guess this
 * registry is closed against.
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
  {
    /*
     * THE THIRTEENTH, BOUGHT ON 2026-09-01 (33-live-chat-add-on.md O1 → D17).
     *
     * The first slot on a CUSTOMER SHELL. Every other customer id in this list
     * is a place inside a flow — a product being configured, a basket line, a
     * checkout's delivery step, a dispatch being read. This one is the layer
     * ABOVE the page: a floating affordance a visitor can reach from any screen
     * in the app, and the panel it opens.
     *
     * ── ITS DOSSIER IS WEAKER THAN `record.actions`', AND SAYS SO ────────────
     *
     * Four exhibits, not seven, written down in 33 Appendix A (deposited into
     * 31 Appendix A as A.4):
     *
     *   1. one shipped implementation — the help desk's chat panel, a
     *      store-connected overlay mounted once at the shell and therefore
     *      present on all 54 of its views, with SIX host entry points and a
     *      hand-off into the host's own ticket model
     *      (`support-desk/src/components/ChatWidget.tsx`, `app/App.tsx:320`)
     *   2. the gap the previous purchase's own review recorded — 31 A.3,
     *      "neither the 11 nor A.1 covers a customer surface"
     *   3. a dead affordance in the flagship — the storefront footer's
     *      "Contact", wired to a demo toast (`Footer.tsx:107-110`)
     *   4. ABSENCE, MEASURED: ten customer-side repos grepped for any way to
     *      reach the operator from the shell; zero hits outside the help desk
     *
     * Exhibit 4 is an absence, and an absence is the weakest kind of evidence
     * there is — it says nobody built this, which is equally consistent with
     * nobody wanting it. It is in the list because it is the honest state of
     * the fleet and not because it carries the purchase. What carries the
     * purchase is exhibit 1 plus the condition below.
     *
     * ── WHAT IT HAS THAT THE TWELFTH DID NOT: IT SHIPS WITH ITS FILL ────────
     *
     * `record.actions` arrives unfilled and its entry spends four paragraphs
     * on why that is not a guess. This id needs none of them: `live-chat` fills
     * it in the same wave, from the same plan, and the help desk's own widget
     * is what becomes the fill. The registry's founding rule is therefore met
     * on the day the id lands rather than owed to a later one — which is the
     * whole of the difference, and the reason a four-exhibit dossier was
     * accepted here and would not have been for the twelfth.
     *
     * ── `customer`, AND WHY NOT `both` ──────────────────────────────────────
     *
     * The temptation is `both`: a staff app could hang a floating panel in its
     * corner too. Nothing in the fleet does, and ruling it `both` on that
     * reasoning would be buying a second surface on no exhibits at all — the
     * mistake this entry has just spent forty lines refusing. A staff overlay
     * can be bought the day a staff screen wants one, on its own evidence.
     * `record.actions` went the other way on exhibits, not on symmetry: two of
     * its seven were a reader's own record, so `staff` would have excluded
     * them.
     *
     * ── THE ALTERNATIVE THAT WAS REJECTED, AND IS STILL ON FILE ─────────────
     *
     * Adminium injecting a script into every hosted customer surface, with no
     * slot at all. Rejected for v1 (D3): demo mode needs the seam regardless —
     * an example app running on fixtures has no Adminium to inject anything —
     * and a second mount mechanism is the duplication this layer exists to
     * prevent. It stays on file as the way to reach OPERATOR-BUILT customer
     * pages, which have no seam to mount into (33 D22).
     *
     * ── THE ONE THING A READER SHOULD HOLD AGAINST IT ───────────────────────
     *
     * `fill: 'multi'` promises stacked overlays and there has never been more
     * than one. A second overlay add-on would want to open A PARTICULAR fill
     * from a host entry point, and the payload's `openRequest` is a bare
     * counter that opens every one of them. That is recorded as un-purchased
     * standing evidence (33 D16) rather than pre-solved with a `target` field
     * nothing would pass: `multi` is right because two overlays must coexist
     * without one of them winning, and the day a second one exists the request
     * widens. Until then a host with one fill gets the behaviour it wants.
     */
    id: 'shell.overlay',
    surface: 'customer',
    fill: 'multi',
    payload:
      'the host shell: brand, screen, locale, clock, what it knows of the visitor, an open request, and the environment handles (token, storage, public client, suggest, handoff)',
    renders: 'a floating affordance and its panel, stacked at the inline-end corner',
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
