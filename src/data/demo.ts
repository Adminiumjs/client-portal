/**
 * Seeded demo data — Outline, a fictional two-person brand-design studio.
 *
 * Six clients, three proposals, four projects, seven invoices. The invoices
 * are arranged so the aging strip has real shape on load: two overdue at
 * clearly different ages (about 12 days and about 47 days, which lands them in
 * two different buckets), one partially paid, one still a draft.
 *
 * Money is INTEGER CENTS. Dates are DAY SERIALS (whole days since the epoch,
 * UTC). Translatable prose is stored as an i18n KEY; brand names, contact
 * names, e-mail addresses and fictional filenames stay literal.
 *
 * No property, real-estate or lettings businesses appear here — that is a
 * standing constraint on this fiction, not an accident of the client list.
 */

import type {
  ActivityEntry,
  Client,
  Invoice,
  Project,
  Proposal,
} from "./types.ts";

export function ser(y: number, m: number, d: number): number {
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function fromSer(s: number): { y: number; m: number; d: number; dow: number } {
  const dt = new Date(s * 86_400_000);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
    dow: dt.getUTCDay(),
  };
}

export function serDate(s: number): Date {
  return new Date(s * 86_400_000);
}

/** The pinned clock: Tuesday, 28 July 2026. Nothing reads `Date.now()`. */
export const TODAY = ser(2026, 7, 28);

/** The studio's standing tax rate, as a whole percentage. */
export const TAX_RATE = 8;

export const CLIENTS: Client[] = [
  { id: "driftfern", company: "Drift & Fern", kind: "data.kind.florist", contact: "Amara Osei", email: "amara@driftandfern.example", tint: "#4e8a5f", icon: "flower-2", since: ser(2024, 3, 12) },
  { id: "cindersage", company: "Cinder & Sage", kind: "data.kind.cafe", contact: "Jonah Marsh", email: "jonah@cinderandsage.example", tint: "#a3583a", icon: "coffee", since: ser(2024, 11, 2) },
  { id: "loworbit", company: "Low Orbit", kind: "data.kind.podcast", contact: "Tessa Nakamura", email: "tessa@loworbit.example", tint: "#6d5fc4", icon: "mic", since: ser(2025, 2, 18) },
  { id: "ovenbird", company: "Ovenbird Bakehouse", kind: "data.kind.bakery", contact: "Elio Ferrante", email: "elio@ovenbird.example", tint: "#b0813f", icon: "croissant", since: ser(2025, 9, 29) },
  { id: "paperlantern", company: "Paper Lantern", kind: "data.kind.stationery", contact: "Mei Tan", email: "mei@paperlantern.example", tint: "#4a7ab5", icon: "notebook-pen", since: ser(2026, 1, 8) },
  { id: "nightshift", company: "Night Shift Records", kind: "data.kind.label", contact: "Rowan Petit", email: "rowan@nightshiftrecords.example", tint: "#7d7f9c", icon: "disc-3", since: ser(2026, 4, 21) },
];

/** Proposal numbers run PRO-114x; seeds end at PRO-1146, so the next is PRO-1147. */
export const SEED_PROPOSALS: Proposal[] = [
  {
    num: "PRO-1142", client: "driftfern", title: "data.doc.pro1142", status: "accepted",
    validUntil: ser(2026, 6, 26), taxRate: TAX_RATE, createdAt: ser(2026, 5, 28),
    sentAt: ser(2026, 5, 29), decidedAt: ser(2026, 6, 12), project: "pj-drift", declineNote: "",
    scope: ["data.scope.pro1142a", "data.scope.pro1142b"],
    items: [
      { desc: "data.item.research", qty: 1, rate: 180_000, disc: 0 },
      { desc: "data.item.guidelines", qty: 1, rate: 96_000, disc: 0 },
      { desc: "data.item.stationery", qty: 1, rate: 34_000, disc: 10 },
    ],
  },
  {
    num: "PRO-1145", client: "ovenbird", title: "data.doc.pro1145", status: "sent",
    validUntil: ser(2026, 8, 15), taxRate: TAX_RATE, createdAt: ser(2026, 7, 16),
    sentAt: ser(2026, 7, 18), decidedAt: null, project: null, declineNote: "",
    scope: ["data.scope.pro1145a", "data.scope.pro1145b", "data.scope.pro1145c"],
    items: [
      { desc: "data.item.packConcepts", qty: 1, rate: 220_000, disc: 0 },
      { desc: "data.item.labels", qty: 1, rate: 130_000, disc: 0 },
      { desc: "data.item.pressCheck", qty: 1, rate: 45_000, disc: 0 },
    ],
  },
  {
    num: "PRO-1146", client: "nightshift", title: "data.doc.pro1146", status: "draft",
    validUntil: ser(2026, 9, 4), taxRate: TAX_RATE, createdAt: ser(2026, 7, 24),
    sentAt: null, decidedAt: null, project: null, declineNote: "",
    scope: ["data.scope.pro1146a"],
    items: [
      { desc: "data.item.sleeves", qty: 3, rate: 52_000, disc: 0 },
      { desc: "data.item.loops", qty: 3, rate: 18_000, disc: 0 },
    ],
  },
];

export const SEED_PROJECTS: Project[] = [
  {
    id: "pj-drift", client: "driftfern", proposal: "PRO-1142",
    name: "data.doc.pro1142", status: "active", due: ser(2026, 8, 21),
    milestones: [
      { title: "data.ms.kickoffResearch", due: ser(2026, 6, 18), done: true },
      { title: "data.ms.moodboards", due: ser(2026, 6, 26), done: true },
      { title: "data.ms.logoConcepts", due: ser(2026, 7, 10), done: true },
      { title: "data.ms.guidelines", due: ser(2026, 8, 7), done: false },
      { title: "data.ms.launchKit", due: ser(2026, 8, 21), done: false },
    ],
    deliverables: [
      { id: "d-logo3", file: "logo_v3.pdf", title: "data.del.logo3", ms: 2, icon: "pen-tool", status: "pending", note: "" },
      { id: "d-mood", file: "moodboard_a.pdf", title: "data.del.moodA", ms: 1, icon: "images", status: "approved", note: "" },
      { id: "d-word", file: "wordmark_dark.svg", title: "data.del.wordmark", ms: 2, icon: "type", status: "changes", note: "data.note.wordmark" },
    ],
  },
  {
    id: "pj-cinder", client: "cindersage", proposal: null,
    name: "data.doc.cinder", status: "active", due: ser(2026, 8, 12),
    milestones: [
      { title: "data.ms.kickoff", due: ser(2026, 7, 2), done: true },
      { title: "data.ms.menuSystem", due: ser(2026, 7, 22), done: true },
      { title: "data.ms.signage", due: ser(2026, 8, 5), done: false },
      { title: "data.ms.printHandoff", due: ser(2026, 8, 12), done: false },
    ],
    deliverables: [
      { id: "d-menu2", file: "menu_draft2.pdf", title: "data.del.menu2", ms: 1, icon: "book-open", status: "pending", note: "" },
      { id: "d-sign", file: "window_sign.pdf", title: "data.del.windowSign", ms: 2, icon: "store", status: "approved", note: "" },
    ],
  },
  {
    id: "pj-lantern", client: "paperlantern", proposal: null,
    name: "data.doc.lantern", status: "paused", due: ser(2026, 9, 18),
    milestones: [
      { title: "data.ms.kickoff", due: ser(2026, 6, 30), done: true },
      { title: "data.ms.shopArt", due: ser(2026, 8, 28), done: false },
      { title: "data.ms.rollout", due: ser(2026, 9, 18), done: false },
    ],
    deliverables: [
      { id: "d-shelf", file: "shelf_story.pdf", title: "data.del.shelf", ms: 0, icon: "layout-grid", status: "approved", note: "" },
    ],
  },
  {
    id: "pj-orbit", client: "loworbit", proposal: null,
    name: "data.doc.orbit", status: "done", due: ser(2026, 7, 10),
    milestones: [
      { title: "data.ms.kickoff", due: ser(2026, 5, 22), done: true },
      { title: "data.ms.coverConcepts", due: ser(2026, 6, 12), done: true },
      { title: "data.ms.episodeTemplates", due: ser(2026, 7, 3), done: true },
      { title: "data.ms.finalHandoff", due: ser(2026, 7, 10), done: true },
    ],
    deliverables: [
      { id: "d-cover4", file: "cover_s4.png", title: "data.del.cover4", ms: 1, icon: "disc-3", status: "approved", note: "" },
      { id: "d-tmpl", file: "episode_templates.pdf", title: "data.del.templates", ms: 2, icon: "layout-template", status: "approved", note: "" },
    ],
  },
];

/**
 * Invoice numbers run INV-20xx; seeds end at INV-2041, so the next is INV-2042.
 *
 * Stored status is only draft|sent|paid — overdue is DERIVED. Against the
 * pinned 28 July: INV-2038 is 12 days late (bucket 1–30) and INV-2037 is 47
 * days late (bucket 31–60), so two aging buckets are populated on load.
 * INV-2039 is partially paid.
 */
export const SEED_INVOICES: Invoice[] = [
  {
    num: "INV-2035", client: "driftfern", project: "pj-drift",
    title: "data.doc.inv2035", status: "paid",
    issued: ser(2026, 6, 16), due: ser(2026, 6, 30), taxRate: TAX_RATE,
    items: [{ desc: "data.item.deposit50", qty: 1, rate: 153_300, disc: 0 }],
    payments: [{ amt: 165_564, method: "card", at: ser(2026, 6, 24) }],
  },
  {
    num: "INV-2036", client: "cindersage", project: "pj-cinder",
    title: "data.doc.inv2036", status: "paid",
    issued: ser(2026, 6, 20), due: ser(2026, 7, 4), taxRate: TAX_RATE,
    items: [{ desc: "data.item.depositMenu", qty: 1, rate: 90_750, disc: 0 }],
    payments: [{ amt: 98_010, method: "transfer", at: ser(2026, 7, 2) }],
  },
  {
    num: "INV-2037", client: "nightshift", project: null,
    title: "data.doc.inv2037", status: "sent",
    issued: ser(2026, 5, 29), due: ser(2026, 6, 11), taxRate: TAX_RATE,
    items: [
      { desc: "data.item.sleeveRush", qty: 1, rate: 68_000, disc: 0 },
      { desc: "data.item.printFiles", qty: 1, rate: 22_000, disc: 0 },
    ],
    payments: [],
  },
  {
    num: "INV-2038", client: "paperlantern", project: "pj-lantern",
    title: "data.doc.inv2038", status: "sent",
    issued: ser(2026, 7, 1), due: ser(2026, 7, 16), taxRate: TAX_RATE,
    items: [
      { desc: "data.item.artDirectionHours", qty: 18, rate: 9_500, disc: 0 },
      { desc: "data.item.referenceBoards", qty: 1, rate: 24_000, disc: 0 },
    ],
    payments: [],
  },
  {
    num: "INV-2039", client: "loworbit", project: "pj-orbit",
    title: "data.doc.inv2039", status: "sent",
    issued: ser(2026, 7, 20), due: ser(2026, 8, 3), taxRate: TAX_RATE,
    items: [
      { desc: "data.item.coverSystem", qty: 1, rate: 210_000, disc: 0 },
      { desc: "data.item.templatePack", qty: 1, rate: 80_000, disc: 0 },
    ],
    payments: [{ amt: 120_000, method: "transfer", at: ser(2026, 7, 24) }],
  },
  {
    num: "INV-2040", client: "cindersage", project: "pj-cinder",
    title: "data.doc.inv2040", status: "sent",
    issued: ser(2026, 7, 24), due: ser(2026, 8, 7), taxRate: TAX_RATE,
    items: [
      { desc: "data.item.menuMilestone", qty: 1, rate: 84_000, disc: 0 },
      { desc: "data.item.windowArtwork", qty: 2, rate: 19_500, disc: 0 },
    ],
    payments: [],
  },
  {
    num: "INV-2041", client: "driftfern", project: "pj-drift",
    title: "data.doc.inv2041", status: "draft",
    issued: ser(2026, 7, 27), due: ser(2026, 8, 10), taxRate: TAX_RATE,
    items: [
      { desc: "data.item.guidelinesMilestone", qty: 1, rate: 96_000, disc: 0 },
      { desc: "data.item.stationery", qty: 1, rate: 34_000, disc: 10 },
    ],
    payments: [],
  },
];

export const SEED_ACTIVITY: ActivityEntry[] = [
  { id: "ac1", icon: "banknote", tone: "pos", text: "data.act.payment", params: { amount: "$1,200.00", doc: "INV-2039" }, at: ser(2026, 7, 24) },
  { id: "ac2", icon: "send", tone: "info", text: "data.act.invoiceSent", params: { doc: "INV-2040", who: "Cinder & Sage" }, at: ser(2026, 7, 24) },
  { id: "ac3", icon: "circle-check-big", tone: "pos", text: "data.act.approved", params: { doc: "moodboard_a.pdf", who: "Drift & Fern" }, at: ser(2026, 7, 22) },
  { id: "ac4", icon: "message-square", tone: "warn", text: "data.act.changes", params: { doc: "wordmark_dark.svg" }, at: ser(2026, 7, 21) },
  { id: "ac5", icon: "send", tone: "info", text: "data.act.proposalSent", params: { doc: "PRO-1145", who: "Ovenbird Bakehouse" }, at: ser(2026, 7, 18) },
  { id: "ac6", icon: "sparkles", tone: "accent", text: "data.act.accepted", params: { doc: "PRO-1142" }, at: ser(2026, 6, 12) },
];

/** Demo hint chips on the portal entry screen — real credentials for the demo. */
export const PORTAL_HINTS = [
  { email: "amara@driftandfern.example", num: "PRO-1142" },
  { email: "tessa@loworbit.example", num: "INV-2039" },
  { email: "elio@ovenbird.example", num: "PRO-1145" },
] as const;
