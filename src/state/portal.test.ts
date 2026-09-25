/**
 * The clients' side holds one client: their own rows only, read once at
 * sign-in and again on focus and on navigation — it has no live channel.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PortalPort } from "../data/ports.ts";
import { fakeStudio, type FakeStudio } from "../testing/fakeStudio.ts";
import { attachPortalRefresh, loadClientProposal, loadPortal, previewFromDesk, setPortalPort, usePortal } from "./portal.ts";
import { useDesk } from "./desk.ts";
import { open, useUi } from "./ui.ts";

let studio: FakeStudio;
let lists: string[];
beforeEach(async () => {
  studio = await fakeStudio();
  lists = [];
  const port = studio.world.portal(1);
  setPortalPort({ ...port, list: ((ref: string, ...rest: unknown[]) => (lists.push(ref), (port.list as (...a: unknown[]) => unknown)(ref, ...rest))) as PortalPort["list"] });
  useUi.setState({ persona: "client", view: "home", preview: null });
});

describe("the signed-in client's rows", () => {
  it("are theirs alone: no draft, no other client's document, no voided payment", async () => {
    await loadPortal();
    const s = usePortal.getState();
    expect(s.me).toEqual({ company: "Hearth & Co Bakery", contact_name: "Amara Osei" });
    expect(Object.values(s.rows.proposals).map((p) => p.number)).toEqual(["PRO-1142"]);
    expect(Object.values(s.rows.invoices).map((i) => i.number).sort()).toEqual(["INV-2038", "INV-2040"]);
    expect(Object.values(s.rows.deliverables).every((d) => d.status !== "unshared")).toBe(true);
    expect(lists.sort()).toEqual(["briefs", "brief_answers", "deliverables", "invoices", "milestones", "payments", "projects", "proposals"].sort());
  });

  it("reads a proposal's lines and the terms it names when its page opens", async () => {
    await loadClientProposal(3);
    expect(Object.values(usePortal.getState().rows.proposal_lines)).toHaveLength(3);
    expect(Object.values(usePortal.getState().rows.terms_clauses)).toHaveLength(4);
  });
});

describe("following the studio without a live channel", () => {
  it("reads again when the window regains focus and when the client moves", async () => {
    await loadPortal();
    const target = new EventTarget() as unknown as Window;
    const stop = attachPortalRefresh(target);
    lists = [];
    // A sent invoice is locked but for a few columns: the studio moves its due day.
    await studio.world.writes.update("invoices", 6, { due_on: "2026-08-10" });
    target.dispatchEvent(new Event("focus"));
    await vi.waitFor(() => expect(usePortal.getState().rows.invoices[6]?.due_on).toBe("2026-08-10"));
    lists = [];
    open("invoice", 6);
    await vi.waitFor(() => expect(lists).toContain("invoice_lines"));
    stop();
    lists = [];
    target.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 10));
    expect(lists).toEqual([]);
  });
});

describe("the studio's preview", () => {
  it("draws the desk's rows for one client, with what the client may see only", () => {
    const rows = useDesk.getState().rows;
    previewFromDesk(rows, 4, { settings: null, people: [], briefQuestions: [] });
    const s = usePortal.getState();
    expect(s.me?.company).toBe("Kiln Street Ceramics");
    // Kiln's draft invoice and draft proposal never reach their side.
    expect(Object.values(s.rows.invoices)).toEqual([]);
    expect(Object.values(s.rows.proposals)).toEqual([]);
  });
});
