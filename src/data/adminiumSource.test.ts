// SPDX-License-Identifier: AGPL-3.0-only
/**
 * Connected mode (28-public-surface.md §5.2, 28-T28 wave 3).
 *
 * ── WHY THIS DRIVES A REAL CLIENT ──────────────────────────────────────────
 * `createPublicClient` takes an injectable `fetch`, so these run the SHIPPED
 * client against canned wire responses rather than a hand-written stub of it.
 * `assertRefs`, the config fetch, the paging and the URL building are therefore
 * under test too.
 *
 * ── THE FIRST TEST IS THE IMPORTANT ONE ────────────────────────────────────
 * This app's rows are every client's invoices, payments and decline notes, and
 * the snapshot lands in a browser. A customer-side key is one an operator hands
 * out. The guard that refuses one is asserted before anything else here.
 */

import { describe, expect, it } from "vitest";

import { createPublicClient } from "@adminiumjs/public-client";

import { loadSnapshot, snapshotSource } from "./adminiumSource.ts";
import { demoSource, isConnected, setDataSource, source } from "./source.ts";

const REFS = [
  "clients", "proposals", "proposalItems", "projects", "milestones",
  "deliverables", "invoices", "invoiceItems", "payments",
];

/** 28 July 2026, as the app counts days. */
const JUL28 = Math.round(Date.UTC(2026, 6, 28) / 86_400_000);

const ROWS: Record<string, unknown[]> = {
  clients: [
    {
      id: 1, company: "Drift & Fern", contact_name: "Amara Osei", email: "amara@drift.example",
      kind: "Bakery", tint: "#b25e09", icon: "croissant", created_at: "2026-01-04T09:00:00Z",
    },
  ],
  proposals: [
    {
      id: 11, number: "PRO-1142", client_id: 1, title: "Brand refresh", status: "accepted",
      valid_until: "2026-08-01", tax_rate: "8.00",
      scope: "Wordmark and palette.\n\nThree rounds of revision.",
      decline_note: "", created_at: "2026-06-01T09:00:00Z",
      sent_at: "2026-06-02T09:00:00Z", decided_at: "2026-06-12T09:00:00Z",
    },
  ],
  proposalItems: [
    { id: 21, proposal_id: 11, position: 1, description: "Revisions", qty: "3.00", rate: "150.00", discount_pct: "0.00" },
    { id: 20, proposal_id: 11, position: 0, description: "Wordmark", qty: "1.00", rate: "2400.00", discount_pct: "10.00" },
  ],
  projects: [
    { id: 31, client_id: 1, proposal_id: 11, name: "Drift rebrand", status: "active", due_on: "2026-09-15" },
    { id: 32, client_id: 1, proposal_id: null, name: "Undated retainer", status: "paused", due_on: null },
  ],
  milestones: [
    { id: 41, project_id: 31, title: "Discovery", due_on: "2026-07-10", done: true, position: 0 },
    { id: 42, project_id: 31, title: "Concepts", due_on: "2026-08-10", done: false, position: 1 },
  ],
  deliverables: [
    { id: 51, milestone_id: 42, title: "Wordmark", file: "wordmark_dark.svg", icon: "file", status: "changes_requested", note: "Lighter, please." },
    { id: 52, milestone_id: 41, title: "Moodboard", file: "moodboard_a.pdf", icon: "file", status: "approved", note: "" },
  ],
  invoices: [
    { id: 61, number: "INV-2039", client_id: 1, project_id: 31, title: "Phase one", status: "paid", issued_on: "2026-07-01", due_on: "2026-07-15", tax_rate: "8.00" },
    { id: 62, number: "INV-2040", client_id: 1, project_id: 31, title: "Phase two", status: "overdue", issued_on: "2026-07-10", due_on: "2026-07-24", tax_rate: "8.00" },
    { id: 63, number: "INV-2041", client_id: 1, project_id: null, title: "Draft", status: "draft", issued_on: "2026-07-28", due_on: "2026-08-28", tax_rate: "8.00" },
  ],
  invoiceItems: [
    { id: 71, invoice_id: 61, position: 0, description: "Deposit", qty: "1.00", rate: "1200.00", discount_pct: "0.00" },
  ],
  payments: [
    { id: 81, invoice_id: 61, amount: "1200.00", method: "transfer", paid_at: "2026-07-24T14:00:00Z" },
  ],
};

interface FakeOptions {
  rows?: Record<string, unknown[]>;
  expose?: (ref: string) => string[];
  limit?: number;
  /** The scope's declared side. Anything but `staff` must be refused. */
  side?: string;
}

/** A server that answers exactly what the scope would, paging included. */
function fakeFetch(overrides: FakeOptions = {}) {
  const rows = overrides.rows ?? ROWS;
  const limit = overrides.limit ?? 500;
  return async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    const json = (body: unknown) =>
      new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    if (url.pathname.endsWith("/public/config")) {
      const refs: Record<string, unknown> = {};
      for (const ref of REFS) {
        refs[ref] = {
          actions: ["list"],
          expose: overrides.expose?.(ref) ?? Object.keys((rows[ref]?.[0] ?? {}) as object),
          filterable: [], searchable: [], orderable: [], writable: [], limit,
        };
      }
      // `/public/config` is the one route the client unwraps: it reads
      // `body.data`, while `list` reads the body itself.
      return json({
        data: {
          version: 1, side: overrides.side ?? "staff", timezone: "Europe/London",
          currency: "GBP", claim: null, refs,
        },
      });
    }

    const ref = url.pathname.split("/").pop() ?? "";
    const all = rows[ref] ?? [];
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const size = Number(url.searchParams.get("limit") ?? String(all.length));
    return json({ data: all.slice(offset, offset + size) });
  };
}

const clientWith = (fetch: ReturnType<typeof fakeFetch>) =>
  createPublicClient({ baseUrl: "https://api.example.test", publishableKey: "adm_pub_test", fetch });

const snapshot = async (overrides: FakeOptions = {}) =>
  loadSnapshot(clientWith(fakeFetch(overrides))!);

describe("a customer-side key may not open this app", () => {
  it("refuses a scope that is not staff-side, and falls back to demo data", async () => {
    // THE FAILURE THIS PINS. The snapshot lands in a browser and it is every
    // client's invoices, payments and decline notes. A customer-side key is one
    // an operator hands out; a staff-side key is one they keep. This guard is a
    // tripwire, not an access-control system — see the source file's header.
    expect(await snapshot({ side: "customer" })).toBeNull();
    expect(await snapshot({ side: "staff" })).not.toBeNull();
  });
});

describe("demo mode is the structural default", () => {
  it("builds no client when either variable is absent", () => {
    expect(createPublicClient({ baseUrl: "https://x.test", publishableKey: "" })).toBeNull();
    expect(createPublicClient({ baseUrl: "", publishableKey: "adm_pub_x" })).toBeNull();
    expect(createPublicClient(undefined)).toBeNull();
  });

  it("falls back rather than throwing when the server is unreachable", async () => {
    const client = clientWith(async () => {
      throw new Error("ECONNREFUSED");
    });
    expect(await loadSnapshot(client!)).toBeNull();
  });

  it("falls back when the scope does not expose a column the app reads", async () => {
    expect(await snapshot({ expose: () => ["id"] })).toBeNull();
  });
});

describe("documents", () => {
  it("keys proposals and invoices by the number a client reads aloud", async () => {
    const snap = await snapshot();
    expect(snap!.proposals[0]!.num).toBe("PRO-1142");
    expect(snap!.invoices.map((i) => i.num)).toEqual(["INV-2039", "INV-2040", "INV-2041"]);
    // The proposal knows the project it spawned, through `projects.proposal_id`
    // — which is UNIQUE, so the link is unambiguous in both directions.
    expect(snap!.proposals[0]!.project).toBe("31");
    expect(snap!.projects[0]!.proposal).toBe("PRO-1142");
  });

  it("splits the scope column into paragraphs and orders lines by position", async () => {
    const snap = await snapshot();
    expect(snap!.proposals[0]!.scope).toEqual(["Wordmark and palette.", "Three rounds of revision."]);
    // Seeded out of order: `position` is the document's order.
    expect(snap!.proposals[0]!.items.map((i) => i.desc)).toEqual(["Wordmark", "Revisions"]);
    // Money is integer cents in the app and a decimal string on the wire.
    expect(snap!.proposals[0]!.items[0]!.rate).toBe(240_000);
    expect(snap!.proposals[0]!.items[0]!.disc).toBe(10);
  });

  it("reads an overdue row as sent, because overdue is derived", async () => {
    const snap = await snapshot();
    // WS-I G-2. A stored "overdue" is wrong the moment the clock moves past
    // it; the app re-derives it from the due date every render.
    expect(snap!.invoices.map((i) => i.status)).toEqual(["paid", "sent", "draft"]);
    expect(snap!.invoices[1]!.due).toBe(Math.round(Date.UTC(2026, 6, 24) / 86_400_000));
    expect(snap!.invoices[0]!.payments).toEqual([
      { amt: 120_000, method: "transfer", at: Math.round(Date.UTC(2026, 6, 24) / 86_400_000) },
    ]);
  });

  it("indexes a deliverable by its milestone's position, not its row id", async () => {
    const snap = await snapshot();
    const project = snap!.projects[0]!;
    expect(project.milestones.map((m) => m.title)).toEqual(["Discovery", "Concepts"]);
    // The app addresses a milestone by its INDEX in that array.
    const byFile = Object.fromEntries(project.deliverables.map((d) => [d.file, d.ms]));
    expect(byFile["moodboard_a.pdf"]).toBe(0);
    expect(byFile["wordmark_dark.svg"]).toBe(1);
    // WS-I G-3: the schema says `changes_requested`; the app says `changes`.
    const wordmark = project.deliverables.find((d) => d.file === "wordmark_dark.svg")!;
    expect(wordmark.status).toBe("changes");
    expect(wordmark.note).toBe("Lighter, please.");
  });

  it("dates an undated project as today rather than as 1970", async () => {
    const snap = await snapshot();
    // WS-I G-5: `due_on` is nullable and the app's dates are not. Today is
    // visibly wrong on a timeline; the epoch is a rendering accident.
    expect(snap!.projects[1]!.due).toBe(snap!.today);
  });
});

describe("the activity feed is derived, because there is no table for it", () => {
  it("builds entries from payments, proposals, invoices and deliverables", async () => {
    const snap = await snapshot();
    const kinds = snap!.activity.map((a) => a.text);
    // WS-I G-1. Truer than a stored log, and also less: an event with no column
    // — a message, a phone call — never appears at all.
    expect(kinds).toContain("data.act.payment");
    expect(kinds).toContain("data.act.proposalSent");
    expect(kinds).toContain("data.act.accepted");
    expect(kinds).toContain("data.act.invoiceSent");
    expect(kinds).toContain("data.act.approved");
    expect(kinds).toContain("data.act.changes");
    // A draft invoice has not been sent to anybody.
    expect(snap!.activity.filter((a) => a.params?.["doc"] === "INV-2041")).toHaveLength(0);
    // Newest first.
    const days = snap!.activity.map((a) => a.at);
    expect([...days].sort((a, b) => b - a)).toEqual(days);
  });

  it("formats a payment in the scope's own currency", async () => {
    const snap = await snapshot();
    const payment = snap!.activity.find((a) => a.text === "data.act.payment")!;
    // The wire carries a bare decimal with no currency attached; the scope is
    // the only thing that knows it is sterling.
    expect(payment.params?.["amount"]).toContain("1,200");
    expect(payment.params?.["doc"]).toBe("INV-2039");
  });

  it("resolves every day in the studio's zone, not the reader's", async () => {
    const snap = await snapshot();
    // 09:00Z on 2 June is still 2 June in London — the assertion that matters
    // is that a `date` column and an instant land on the same scale at all.
    expect(snap!.proposals[0]!.sentAt).toBe(Math.round(Date.UTC(2026, 5, 2) / 86_400_000));
    expect(snap!.proposals[0]!.validUntil).toBe(Math.round(Date.UTC(2026, 7, 1) / 86_400_000));
    expect(snap!.clients[0]!.since).toBe(Math.round(Date.UTC(2026, 0, 4) / 86_400_000));
    expect(JUL28).toBeGreaterThan(0);
  });

  it("reads every page, not just the first the scope allows", async () => {
    const snap = await snapshot({ limit: 1 });
    expect(snap!.invoices).toHaveLength(3);
    expect(snap!.projects[0]!.milestones).toHaveLength(2);
  });
});

describe("what a connected build refuses to carry over", () => {
  it("offers no portal credentials and no standing tax rate", async () => {
    const connected = snapshotSource((await snapshot())!);
    // These are a real client's e-mail address and a real document number.
    // Pre-filling them on the public entry screen would hand one client's
    // invoices to whoever loaded the page.
    expect(connected.portalHints()).toEqual([]);
    // WS-I G-4: no studio-wide rate column. Each stored document carries its
    // own, which is the number that actually matters.
    expect(connected.taxRate()).toBe(0);
    expect(connected.proposals()[0]!.taxRate).toBe(8);
  });

  it("hands back the same shapes demoSource does", async () => {
    const connected = snapshotSource((await snapshot())!);
    for (const key of Object.keys(demoSource) as (keyof typeof demoSource)[]) {
      expect(typeof connected[key]).toBe("function");
    }
    connected.proposals()[0]!.scope.push("mutated");
    expect(connected.proposals()[0]!.scope).toHaveLength(2);
  });
});

describe("the seam", () => {
  it("reports demo mode until a real source is installed", () => {
    expect(isConnected()).toBe(false);
  });

  it("refuses a swap that arrives after the app has read", () => {
    // THE SILENT FAILURE THIS PINS, and the one this repo actually had: §5.3
    // recorded the seam as orphaned, so a swap changed nothing at all.
    source.clients();
    expect(() => setDataSource(demoSource)).toThrow(/after the app already read/);
  });
});
