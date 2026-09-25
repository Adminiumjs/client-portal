/**
 * What the desk holds after boot, and the sidebar's counts worked out from it:
 * new enquiries, proposals a client can still accept, overdue invoices, and
 * invoices with a chase rung ready — each following the rows as they change.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { fakeStudio, type FakeStudio } from "../testing/fakeStudio.ts";
import { DEMO_START } from "../lib/clock.ts";
import { loadClient, loadInvoice, loadProposal, meOf, navCounts, rowsOf, upsert, useDesk } from "./desk.ts";

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

describe("the desk's boot read set", () => {
  it("holds the set-up and the open work — not the history", () => {
    const s = useDesk.getState();
    expect(s.load).toBe("ready");
    expect(s.today).toBe("2026-07-28");
    expect(rowsOf(s, "settings")).toHaveLength(1);
    expect(rowsOf(s, "invoices").map((i) => i.number).sort()).toEqual(["INV-2037", "INV-2038", "INV-2039", "INV-2040", "INV-2041"]);
    expect(rowsOf(s, "proposals").map((p) => p.number ?? "draft").sort()).toEqual(["PRO-1140", "PRO-1141", "PRO-1142", "draft"]);
    expect(rowsOf(s, "enquiries").map((e) => e.status).sort()).toEqual(["new", "new", "new", "parked"]);
    expect(rowsOf(s, "messages").every((m) => m.status === "held")).toBe(true);
    expect(rowsOf(s, "projects").map((p) => p.status).sort()).toEqual(["active", "active", "paused"]);
    expect(rowsOf(s, "payments")).toEqual([]);
  });

  it("reads a document's own rows when its page opens", async () => {
    await loadProposal(3);
    expect(rowsOf(useDesk.getState(), "proposal_lines").filter((l) => l.document_id === 3)).toHaveLength(3);
    expect(rowsOf(useDesk.getState(), "terms_clauses").filter((c) => c.version_id === 3)).toHaveLength(4);
    await loadInvoice(2);
    expect(useDesk.getState().rows.invoices[2]).toMatchObject({ number: "INV-2036", balance: "0.00" });
    expect(rowsOf(useDesk.getState(), "payments").map((p) => p.number)).toEqual(["REC-0017"]);
    await loadClient(3);
    expect(rowsOf(useDesk.getState(), "client_notes")).toEqual([]);
    expect(rowsOf(useDesk.getState(), "invoices").filter((i) => i.client_id === 3).map((i) => i.number).sort()).toEqual(["INV-2035", "INV-2039"]);
  });
});

describe("the sidebar's counts", () => {
  it("count what the studio can act on", () => {
    expect(navCounts(useDesk.getState(), "2026-07-28", DEMO_START)).toEqual({
      enquiries: 3,
      // PRO-1142 only: sent and still in date.
      proposals: 1,
      // INV-2038 (due 16 Jul) and INV-2039 (due 11 Jun).
      invoices: 2,
      // INV-2038's second rung and INV-2039's third; INV-2038's third is not due yet.
      chasing: 2,
    });
  });

  it("follow the rows: a proposal past its date, a paid invoice, a rung sent", () => {
    const s = useDesk.getState();
    expect(navCounts(s, "2026-08-13", DEMO_START).proposals).toBe(0);
    upsert("invoices", { ...s.rows.invoices[4]!, balance: "0.00" });
    upsert("messages", { ...s.rows.messages[2]!, status: "queued" });
    expect(navCounts(useDesk.getState(), "2026-07-28", DEMO_START)).toMatchObject({ invoices: 1, chasing: 1 });
    void studio;
  });
});

describe("who is signed in", () => {
  it("reads the role's name and whether they manage the studio", () => {
    expect(meOf({ name: "Tomas Reyes", email: "t@x.example" }, { tables: {}, roles: [{ slug: "studio", name: "Studio" }] })).toMatchObject({ roleName: "Studio", manager: false });
    expect(meOf({ name: "Nadia Cole", email: "n@x.example" }, { tables: {}, roles: [{ slug: "studio", name: "Studio" }, { slug: "studio-manager", name: "Studio manager" }] })).toMatchObject({ roleName: "Studio manager", manager: true });
    // A server that says nothing hides nothing: Adminium refuses what it refuses.
    expect(meOf(null, null)).toMatchObject({ manager: true, roleName: null });
  });
});
