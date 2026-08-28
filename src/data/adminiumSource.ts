// SPDX-License-Identifier: AGPL-3.0-only
/**
 * A `DataSource` backed by a real Adminium instance (28-public-surface.md §5.2,
 * 28-T28 wave 3).
 *
 * ── READ THIS BEFORE DEPLOYING A CONNECTED BUILD ───────────────────────────
 * §5.3 files this repo as SENSITIVE TIER, and the reason is structural rather
 * than squeamish: the snapshot below is fetched into the BROWSER, so whatever
 * the scope exposes is readable by whoever loads the page. This app's rows are
 * every client's invoices, payments and decline notes.
 *
 * So `loadSnapshot` REFUSES a scope that is not `side: "staff"`. A customer-side
 * publishable key is one an operator hands out; a staff-side key is one they
 * keep. That guard is real and it is checked, but it is a tripwire, NOT an
 * access-control system: a connected build of this app still belongs behind the
 * studio's own sign-in until the claim flow lands (§3.4, gated on O2/O3). The
 * client-facing half stays on demo data until a reader can prove who they are.
 * This is written here rather than in a plan because this is the file somebody
 * copies.
 *
 * ── READS DO NOT BECOME ASYNC ──────────────────────────────────────────────
 * `loadSnapshot` fetches the whole read-set once, before React mounts, and
 * hands back the same SYNCHRONOUS shapes `demoSource` returns.
 *
 * ── EVERY KEY IS A SERIAL EXCEPT THE TWO THAT MATTER ───────────────────────
 * `proposals.number` and `invoices.number` are TEXT and unique — they are what
 * a client reads back over the phone, and they are what the portal looks a
 * document up by — so documents pass straight through. Everything else is a
 * `serial` addressed by its row id stringified, which is internally consistent
 * because every reference between these tables is a foreign key.
 *
 * ── TIME IS A DAY SERIAL, IN THE STUDIO'S ZONE ─────────────────────────────
 * The app counts days since the epoch, so a `date` column is parsed directly
 * and a `timestamptz` is resolved through `toTenantDay` first. Reading an
 * instant in the browser's zone would move a payment across midnight for any
 * reader east or west of the studio, and nothing would report it.
 *
 * ── WHAT THE SCHEMA CANNOT SAY (WS-I gaps, marked not hidden) ──────────────
 * G-1 There is no activity table. The feed is DERIVED from the events that did
 *     leave a record — payments taken, proposals sent and decided, invoices
 *     issued, deliverables approved or sent back. That is truer than a stored
 *     log, and it is also less: an event with no column (a message, a call)
 *     never appears.
 * G-2 `invoices.status` has an `overdue` value the app deliberately does NOT
 *     store, because overdue is derived from the due date against the clock and
 *     a stored flag is wrong the moment the clock moves. A row saying `overdue`
 *     is read as `sent` and the app re-derives it.
 * G-3 `deliverables.status` says `changes_requested`; the app says `changes`.
 * G-4 There is no studio-wide tax rate. Each stored document carries its own
 *     `tax_rate`, which is what actually matters; the rate a NEW document
 *     starts at is zero rather than the demo's 8%.
 * G-5 `projects.due_on` and `milestones.due_on` are nullable and the app's
 *     dates are not. A missing due date reads as today rather than as 1970.
 */

import {
  createPublicClient,
  formatTenantMoney,
  toTenantDay,
  type PublicClient,
} from "@adminiumjs/public-client";

import { resolveSurfaceConfig } from "../publicConfig.ts";

import type {
  ActivityEntry,
  Client,
  Deliverable,
  DeliverableStatus,
  Invoice,
  InvoiceStatus,
  LineItem,
  Milestone,
  Payment,
  PaymentMethod,
  Project,
  ProjectStatus,
  Proposal,
  ProposalStatus,
} from "./types.ts";
import type { SnapshotPort } from "./snapshotPort.ts";
import type { DataSource, PortalHint } from "./source.ts";

/* --------------------------------------------------------------- the wire */

interface WireClient {
  id: number;
  company: string;
  contact_name: string;
  email: string;
  kind: string;
  tint: string;
  icon: string;
  created_at: string;
}

interface WireProposal {
  id: number;
  number: string;
  client_id: number;
  title: string;
  status: string;
  valid_until: string;
  /** `numeric` serializes as a STRING, not a number. */
  tax_rate: string;
  scope: string;
  decline_note: string;
  created_at: string;
  sent_at: string | null;
  decided_at: string | null;
}

interface WireDocItem {
  id: number;
  position: number;
  description: string;
  qty: string;
  rate: string;
  discount_pct: string;
  proposal_id?: number;
  invoice_id?: number;
}

interface WireProject {
  id: number;
  client_id: number;
  proposal_id: number | null;
  name: string;
  status: string;
  due_on: string | null;
}

interface WireMilestone {
  id: number;
  project_id: number;
  title: string;
  due_on: string | null;
  done: boolean;
  position: number;
}

interface WireDeliverable {
  id: number;
  milestone_id: number;
  title: string;
  file: string;
  icon: string;
  status: string;
  note: string;
}

interface WireInvoice {
  id: number;
  number: string;
  client_id: number;
  project_id: number | null;
  title: string;
  status: string;
  issued_on: string;
  due_on: string;
  tax_rate: string;
}

interface WirePayment {
  id: number;
  invoice_id: number;
  amount: string;
  method: string;
  paid_at: string;
}

/** WS-I G-3. */
const DELIVERABLE_STATUS: Record<string, DeliverableStatus> = {
  pending: "pending",
  approved: "approved",
  changes_requested: "changes",
};

/**
 * The columns the scope must expose, checked at boot.
 *
 * Fail with a legible message naming the missing column rather than at render
 * with a 403 on a screen nobody was looking at — an operator can narrow a scope
 * at any time, and this turns that into a startup error.
 */
export const REQUIRED = {
  clients: ["id", "company", "contact_name", "email", "kind", "tint", "icon", "created_at"],
  proposals: [
    "id", "number", "client_id", "title", "status", "valid_until", "tax_rate",
    "scope", "decline_note", "created_at", "sent_at", "decided_at",
  ],
  proposalItems: ["id", "proposal_id", "position", "description", "qty", "rate", "discount_pct"],
  projects: ["id", "client_id", "proposal_id", "name", "status", "due_on"],
  milestones: ["id", "project_id", "title", "due_on", "done", "position"],
  deliverables: ["id", "milestone_id", "title", "file", "icon", "status", "note"],
  invoices: ["id", "number", "client_id", "project_id", "title", "status", "issued_on", "due_on", "tax_rate"],
  invoiceItems: ["id", "invoice_id", "position", "description", "qty", "rate", "discount_pct"],
  payments: ["id", "invoice_id", "amount", "method", "paid_at"],
};

/** How many derived events the feed keeps. The studio screen shows a handful. */
const ACTIVITY_LIMIT = 40;

/**
 * Why the last {@link loadSnapshot} returned null, or null if it did not.
 *
 * Module-scope because the failure has to reach a caller that only sees a
 * `null` return, and adding a second return shape would touch every screen.
 */
let lastSnapshotError: Error | null = null;

/** The reason the last snapshot attempt failed. */
export function snapshotFailure(): Error | null {
  return lastSnapshotError;
}

export interface Snapshot {
  /** The tenant\'s ISO-4217 code, or null (28-T34). Drives every formatter. */
  currency: string | null;
  /** The zone the serials below were computed in. */
  timezone: string;
  /**
   * Who chose {@link timezone}. Carried so the UI can SAY which zone these
   * dates are in when nobody confirmed it — the field exists precisely because
   * both an unconfirmed zone and a UTC substitute are silent otherwise (a
   * console line is not an operator surface).
   */
  timezoneSource: 'operator' | 'host' | 'fallback' | null;
  today: number;
  clients: Client[];
  proposals: Proposal[];
  projects: Project[];
  invoices: Invoice[];
  activity: ActivityEntry[];
}

/**
 * The client, or null when either build-time variable is absent.
 *
 * The emptiness check is `createPublicClient`'s, not repeated here: it already
 * treats a missing or empty value as "this build has no server", and a second
 * copy of that rule is a second place for it to drift.
 */
export function clientFromEnv(): PublicClient | null {
  return createPublicClient({
    /* Dot access, matching `vite.config.ts`'s `define` — see src/vite-env.d.ts.
       An empty string is what `define` emits for an unset flag, and
       `createPublicClient` already treats empty as "no server". */
    baseUrl: import.meta.env.VITE_ADMINIUM_API_BASE_URL,
    publishableKey: import.meta.env.VITE_ADMINIUM_PUBLISHABLE_KEY,
  });
}

/**
 * The client, resolved the 29-T16 way: baked vars first (that is
 * `clientFromEnv`, kept as the priority so a pinned key stays pinned), then —
 * hosted customer only — the served `surface-config.json`, which is what makes
 * key rotation Studio + reload instead of a rebuild (29 D10).
 */
export async function clientFromConfig(): Promise<PublicClient | null> {
  const config = await resolveSurfaceConfig();
  if (config === null) return null;
  return createPublicClient({ baseUrl: config.baseUrl, publishableKey: config.publishableKey });
}

/** Read a whole ref, a page at a time, at whatever size the scope permits. */
async function listAll<T>(
  client: SnapshotPort,
  ref: string,
  size: number,
  max: number,
): Promise<T[]> {
  const out: T[] = [];
  const page = Math.max(1, Math.min(size, 500));
  for (let offset = 0; offset < max; offset += page) {
    const res = await client.list<T>(ref, { limit: page, offset });
    out.push(...res.data);
    if (res.data.length < page) return out;
  }
  console.warn(`[adminium] ${ref}: stopped at ${String(max)} rows — the rest were not read.`);
  return out;
}

/**
 * `"2026-07-28"` → days since the epoch. The app's whole clock.
 *
 * ─── Why this is stricter than it looks ──────────────────────────────────────
 *
 * It used to be `day.split("-")` and three `Number()` calls, which silently
 * produced `NaN` for anything that was not exactly `YYYY-MM-DD` — and `NaN`
 * travels: it becomes a `Date` of `Invalid Date`, which `Intl.DateTimeFormat`
 * throws `RangeError: Invalid time value` on, at RENDER time, on whichever
 * screen happens to show that row. The screen goes blank with a stack trace
 * naming a minified React frame, hundreds of lines from the mapping that
 * actually broke.
 *
 * FOUND LIVE: a Postgres source whose `invoices.due_on` is `timestamptz`, not
 * `date`. `"2026-06-29T22:00:00.000Z".split("-")[2]` is `"29T22:00:00.000Z"`,
 * `Number()` of that is `NaN`, and the Invoices screen rendered nothing at all.
 * Every other screen worked, because the home screen formats the CLOCK rather
 * than any row's date.
 *
 * So: both shapes are accepted, and anything else THROWS with the value in the
 * message. `loadSnapshot` already turns a throw into the app's legible
 * not-connected screen, which is a far better failure than a blank one.
 */
function serialOfDate(day: string, timezone?: string): number {
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (plain !== null) {
    return Math.round(
      Date.UTC(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) / 86_400_000,
    );
  }
  /*
   * A timestamp in a column the app treats as a DAY. Resolved in the tenant's
   * zone, not UTC: a source storing local midnight as `…T22:00:00Z` means the
   * NEXT day in Europe/Lisbon, and reading it as UTC would show every due date
   * one day early for half the year.
   */
  if (timezone !== undefined && !Number.isNaN(Date.parse(day))) {
    return serialOfDate(toTenantDay(day, timezone));
  }
  throw new Error(
    `expected a date like 2026-07-28 (or a timestamp with the tenant zone), got "${day}"`,
  );
}

/** An instant, resolved in the STUDIO's zone before it becomes a day. */
function serialOfInstant(iso: string, timezone: string): number {
  return serialOfDate(toTenantDay(iso, timezone));
}

function lineOf(row: WireDocItem): LineItem {
  return {
    // Operator text. `label()` resolves with `tOr(key, key)`, so a value that
    // is not a key renders literally — which is what the studio's own wording
    // on an invoice line should do.
    desc: row.description,
    qty: Number(row.qty),
    rate: Math.round(Number(row.rate) * 100),
    disc: Number(row.discount_pct),
  };
}

/**
 * Fetch the read-set and map it into the app's shapes.
 *
 * Returns `null` on ANY failure so the caller falls back to demo mode
 * structurally rather than in a catch — the marketplace demos are static clones
 * with no server and must keep working byte-identically.
 */
export async function loadSnapshot(client: SnapshotPort): Promise<Snapshot | null> {
  try {
    const config = await client.config();

    /* THE GUARD. See the file header: this snapshot lands in a browser, and it
     * is every client's invoices. A customer-side key is one an operator hands
     * out, so a customer-side scope may not open this door at all. */
    if (config.side !== "staff") {
      throw new Error(
        "this scope is customer-side; client-portal reads every client's invoices " +
          "and needs a staff-side key behind the studio's own sign-in",
      );
    }

    await client.assertRefs(REQUIRED);
    const tz = config.timezone;
    const cap = (ref: string): number => config.refs[ref]?.limit ?? 100;

    const [clients, proposals, proposalItems, projects, milestones, deliverables, invoices, invoiceItems, payments] =
      await Promise.all([
        listAll<WireClient>(client, "clients", cap("clients"), 10_000),
        listAll<WireProposal>(client, "proposals", cap("proposals"), 20_000),
        listAll<WireDocItem>(client, "proposalItems", cap("proposalItems"), 100_000),
        listAll<WireProject>(client, "projects", cap("projects"), 20_000),
        listAll<WireMilestone>(client, "milestones", cap("milestones"), 100_000),
        listAll<WireDeliverable>(client, "deliverables", cap("deliverables"), 100_000),
        listAll<WireInvoice>(client, "invoices", cap("invoices"), 50_000),
        listAll<WireDocItem>(client, "invoiceItems", cap("invoiceItems"), 200_000),
        listAll<WirePayment>(client, "payments", cap("payments"), 100_000),
      ]);

    const today = serialOfInstant(new Date().toISOString(), tz);

    const mappedClients: Client[] = clients.map((row) => ({
      id: String(row.id),
      company: row.company,
      kind: row.kind,
      contact: row.contact_name,
      email: row.email,
      tint: row.tint,
      icon: row.icon,
      since: serialOfInstant(row.created_at, tz),
    }));
    const companyOf = new Map(mappedClients.map((c) => [c.id, c.company]));

    /* --- proposals ---------------------------------------------------- */

    const itemsByProposal = new Map<number, WireDocItem[]>();
    for (const row of proposalItems) {
      if (row.proposal_id === undefined) continue;
      const list = itemsByProposal.get(row.proposal_id) ?? [];
      list.push(row);
      itemsByProposal.set(row.proposal_id, list);
    }

    /* A project's link back to its proposal is the proposal's link forward:
     * `projects.proposal_id` is UNIQUE, so at most one project per proposal. */
    const projectOfProposal = new Map<number, number>();
    for (const row of projects) {
      if (row.proposal_id !== null) projectOfProposal.set(row.proposal_id, row.id);
    }

    const numberOfProposal = new Map<number, string>(proposals.map((p) => [p.id, p.number]));
    const mappedProposals: Proposal[] = proposals.map((row) => ({
      num: row.number,
      client: String(row.client_id),
      title: row.title,
      status: row.status as ProposalStatus,
      validUntil: serialOfDate(row.valid_until, tz),
      taxRate: Number(row.tax_rate),
      createdAt: serialOfInstant(row.created_at, tz),
      sentAt: row.sent_at === null ? null : serialOfInstant(row.sent_at, tz),
      decidedAt: row.decided_at === null ? null : serialOfInstant(row.decided_at, tz),
      project: projectOfProposal.has(row.id) ? String(projectOfProposal.get(row.id)) : null,
      declineNote: row.decline_note,
      // One text column holding paragraphs separated by blank lines, which is
      // what the schema comment says it is.
      scope: row.scope.split(/\n\s*\n/).map((p) => p.trim()).filter((p) => p.length > 0),
      items: (itemsByProposal.get(row.id) ?? []).sort((a, b) => a.position - b.position).map(lineOf),
    }));

    /* --- projects, their milestones and deliverables ------------------- */

    const msByProject = new Map<number, WireMilestone[]>();
    for (const row of milestones) {
      const list = msByProject.get(row.project_id) ?? [];
      list.push(row);
      msByProject.set(row.project_id, list);
    }

    const delsByMilestone = new Map<number, WireDeliverable[]>();
    for (const row of deliverables) {
      const list = delsByMilestone.get(row.milestone_id) ?? [];
      list.push(row);
      delsByMilestone.set(row.milestone_id, list);
    }

    const mappedProjects: Project[] = projects.map((row) => {
      const own = (msByProject.get(row.id) ?? []).sort((a, b) => a.position - b.position);
      const ms: Milestone[] = [];
      const dels: Deliverable[] = [];
      own.forEach((milestone, index) => {
        ms.push({
          title: milestone.title,
          // WS-I G-5: a milestone with no date reads as due today, which is
          // visible on the timeline, rather than as 1 January 1970.
          due: milestone.due_on === null ? today : serialOfDate(milestone.due_on, tz),
          done: milestone.done,
        });
        for (const d of delsByMilestone.get(milestone.id) ?? []) {
          const status = DELIVERABLE_STATUS[d.status];
          if (status === undefined) continue;
          dels.push({
            id: String(d.id),
            file: d.file,
            title: d.title,
            // The app addresses a milestone by its INDEX in this array, which
            // is why the two loops are one loop.
            ms: index,
            icon: d.icon,
            status,
            note: d.note,
          });
        }
      });
      return {
        id: String(row.id),
        client: String(row.client_id),
        proposal: row.proposal_id === null ? null : numberOfProposal.get(row.proposal_id) ?? null,
        name: row.name,
        status: row.status as ProjectStatus,
        due: row.due_on === null ? today : serialOfDate(row.due_on, tz),
        milestones: ms,
        deliverables: dels,
      };
    });

    /* --- invoices and what has been paid against them ------------------ */

    const itemsByInvoice = new Map<number, WireDocItem[]>();
    for (const row of invoiceItems) {
      if (row.invoice_id === undefined) continue;
      const list = itemsByInvoice.get(row.invoice_id) ?? [];
      list.push(row);
      itemsByInvoice.set(row.invoice_id, list);
    }

    const paysByInvoice = new Map<number, Payment[]>();
    for (const row of payments) {
      const list = paysByInvoice.get(row.invoice_id) ?? [];
      list.push({
        amt: Math.round(Number(row.amount) * 100),
        method: row.method as PaymentMethod,
        at: serialOfInstant(row.paid_at, tz),
      });
      paysByInvoice.set(row.invoice_id, list);
    }

    const numberOfInvoice = new Map<number, string>(invoices.map((i) => [i.id, i.number]));
    const mappedInvoices: Invoice[] = invoices.map((row) => ({
      num: row.number,
      client: String(row.client_id),
      project: row.project_id === null ? null : String(row.project_id),
      title: row.title,
      // WS-I G-2: `overdue` is not a state this app stores. It is derived from
      // the due date against the clock, and a stored flag is wrong the moment
      // the clock moves past it.
      status: (row.status === "overdue" ? "sent" : row.status) as InvoiceStatus,
      issued: serialOfDate(row.issued_on, tz),
      due: serialOfDate(row.due_on, tz),
      taxRate: Number(row.tax_rate),
      items: (itemsByInvoice.get(row.id) ?? []).sort((a, b) => a.position - b.position).map(lineOf),
      payments: paysByInvoice.get(row.id) ?? [],
    }));

    /* --- the feed, derived (WS-I G-1) ---------------------------------- */

    const feed: ActivityEntry[] = [];
    for (const row of payments) {
      feed.push({
        id: `pay-${String(row.id)}`,
        icon: "banknote",
        tone: "pos",
        text: "data.act.payment",
        params: {
          amount: formatTenantMoney(row.amount, config.currency),
          doc: numberOfInvoice.get(row.invoice_id) ?? "",
        },
        at: serialOfInstant(row.paid_at, tz),
      });
    }
    for (const row of proposals) {
      const who = companyOf.get(String(row.client_id)) ?? "";
      if (row.sent_at !== null) {
        feed.push({
          id: `pro-sent-${String(row.id)}`,
          icon: "send",
          tone: "info",
          text: "data.act.proposalSent",
          params: { doc: row.number, who },
          at: serialOfInstant(row.sent_at, tz),
        });
      }
      if (row.decided_at !== null && row.status === "accepted") {
        feed.push({
          id: `pro-acc-${String(row.id)}`,
          icon: "sparkles",
          tone: "accent",
          text: "data.act.accepted",
          params: { doc: row.number },
          at: serialOfInstant(row.decided_at, tz),
        });
      }
    }
    for (const row of invoices) {
      if (row.status === "draft") continue;
      feed.push({
        id: `inv-${String(row.id)}`,
        icon: "send",
        tone: "info",
        text: "data.act.invoiceSent",
        params: { doc: row.number, who: companyOf.get(String(row.client_id)) ?? "" },
        at: serialOfDate(row.issued_on, tz),
      });
    }
    /* A deliverable records its CURRENT state and not when it reached it, so
     * these carry the project's client but the day they are filed under is the
     * one this snapshot was taken — the honest version of "recently". */
    for (const row of deliverables) {
      if (row.status === "approved") {
        feed.push({
          id: `del-ok-${String(row.id)}`,
          icon: "circle-check-big",
          tone: "pos",
          text: "data.act.approved",
          params: { doc: row.file },
          at: today,
        });
      } else if (row.status === "changes_requested") {
        feed.push({
          id: `del-ch-${String(row.id)}`,
          icon: "message-square",
          tone: "warn",
          text: "data.act.changes",
          params: { doc: row.file },
          at: today,
        });
      }
    }
    feed.sort((a, b) => b.at - a.at);

    return {
      currency: config.currency,
      timezone: tz,
      // Absent on the public path (the API always carries a real zone on its
      // scope), and absent means no claim — never a guess.
      timezoneSource: config.timezoneSource ?? null,
      today,
      clients: mappedClients,
      proposals: mappedProposals,
      projects: mappedProjects,
      invoices: mappedInvoices,
      activity: feed.slice(0, ACTIVITY_LIMIT),
    };
  } catch (error) {
    /*
     * The reason is REPORTED, not swallowed. It used to say "using demo data",
     * which stopped being true when a non-demo build started hard-stopping
     * instead — and the caller was left showing a generic failure while the
     * actual cause ("this connection has no timezone") sat in the console.
     *
     * `lastSnapshotError` is how the entry point recovers it. A thrown error
     * would be cleaner and is not available: this function returning `null` is
     * the contract every caller is written against.
     */
    lastSnapshotError = error instanceof Error ? error : new Error(String(error));
    console.warn("[adminium] could not load a snapshot:", error);
    return null;
  }
}

/** A synchronous `DataSource` over an already-fetched snapshot. */
export function snapshotSource(snap: Snapshot): DataSource {
  return {
    today: () => snap.today,
    // WS-I G-4: no studio-wide rate. Each stored document carries its own.
    taxRate: () => 0,
    // Never on a connected build — see the seam's own note.
    portalHints: (): PortalHint[] => [],
    clients: () => snap.clients.map((c) => ({ ...c })),
    proposals: () =>
      snap.proposals.map((p) => ({
        ...p,
        scope: [...p.scope],
        items: p.items.map((i) => ({ ...i })),
      })),
    projects: () =>
      snap.projects.map((p) => ({
        ...p,
        milestones: p.milestones.map((m) => ({ ...m })),
        deliverables: p.deliverables.map((d) => ({ ...d })),
      })),
    invoices: () =>
      snap.invoices.map((i) => ({
        ...i,
        items: i.items.map((x) => ({ ...x })),
        payments: i.payments.map((x) => ({ ...x })),
      })),
    activity: () => snap.activity.map((a) => ({ ...a })),
  };
}
