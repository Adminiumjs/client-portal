/**
 * The card's shortcuts and clock row, run against the demo's world: each does
 * what the studio or a client would, and the world decides what follows.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Id } from "./data/types.ts";
import { DEMO_START, DEMO_ZONE, setClockSource, setZone } from "./lib/clock.ts";
import { demoSample } from "./demo/sample.ts";
import { createWorld, type DemoWorld } from "./demo/world.ts";
import { loadDesk, resetDesk, setDeskReads, setDeskWrites } from "./state/desk.ts";
import { resetPortal, setPortalPort, usePortal } from "./state/portal.ts";
import { useUi } from "./state/ui.ts";

const signals: [string, Record<string, string>][] = [];
vi.mock("./state/demoSignal.ts", () => ({
  sendDemoSignal: (name: string, payload: Record<string, string> = {}) => signals.push([name, payload]),
}));

const { advanceClock, clockLabel, currentScreen, goToScreen, resetDemo, runShortcut } = await import("./demoBridge.ts");

let world: DemoWorld;
const byNumber = (ref: "invoices" | "proposals" | "projects", number: string) => world.rows[ref].find((r) => r["number"] === number)!;
const toasts = () => useUi.getState().toasts.map((t) => t.text);

beforeEach(async () => {
  world = createWorld(demoSample("en-US"), () => DEMO_START, DEMO_ZONE, { name: "Nadia Cole" });
  setZone(DEMO_ZONE);
  setClockSource(world.now);
  resetDesk();
  resetPortal();
  setDeskReads(world.reads);
  setDeskWrites(world.writes);
  setPortalPort(world.portal(1));
  useUi.setState({ persona: "studio", view: "home", toasts: [], token: null, selected: { proposal: null, invoice: null, project: null, client: null, deliverable: null, payment: null } });
  signals.length = 0;
  await loadDesk();
});

describe("the clock row", () => {
  it("prints the day as the card shows it, in the page's language", () => {
    expect(clockLabel(DEMO_START, "en-US")).toBe("Tue 28 Jul");
    expect(clockLabel(DEMO_START, "en-US", DEMO_ZONE, true)).toBe("Tue 28 Jul 2026");
    expect(clockLabel(DEMO_START, "de-DE")).toBe(new Intl.DateTimeFormat("de-DE", { timeZone: DEMO_ZONE, weekday: "short", day: "numeric", month: "short" }).format(DEMO_START));
  });

  it("moves a week on (the reminders woken, a toast) and back to 28 July with the sample as it was", async () => {
    await runShortcut("part-payment");
    advanceClock("1w");
    expect(clockLabel(world.now(), "en-US")).toBe("Tue 4 Aug");
    expect(toasts()).toContain("It is now Tue 4 Aug 2026.");
    expect(world.rows.messages.filter((m) => m["skip_reason"] === "overtaken").length).toBeGreaterThan(0);
    resetDemo();
    expect(world.now()).toBe(DEMO_START);
    expect(toasts()).toContain("Back to Tue 28 Jul, with the sample data as it was.");
    expect(byNumber("invoices", "INV-S2039")["balance"]).toBe("1621.00");
  });
});

describe("the shortcuts", () => {
  it("records half the open invoice's balance by bank transfer", async () => {
    useUi.setState((s) => ({ selected: { ...s.selected, invoice: byNumber("invoices", "INV-S2039").id } }));
    await runShortcut("part-payment");
    expect(world.rows.payments.at(-1)).toMatchObject({ number: "REC-0019", amount: "810.50", method: "bank-transfer", paid_on: "2026-07-28" });
    expect(byNumber("invoices", "INV-S2039")["balance"]).toBe("810.50");
    expect(toasts()).toContain("Recorded $810.50 against INV-S2039.");
  });

  it("has the client say they paid, from their own side", async () => {
    useUi.setState((s) => ({ selected: { ...s.selected, invoice: byNumber("invoices", "INV-S2038").id } }));
    await runShortcut("says-paid");
    expect(byNumber("invoices", "INV-S2038")).toMatchObject({ client_paid: true, client_paid_amount: "2170.00", client_paid_at: new Date(DEMO_START).toISOString() });
    expect(world.rows.messages.at(-1)).toMatchObject({ kind: "client-says-paid", to: "hello@outline.example" });
  });

  it("has the client accept and sign the proposal still out, sealed; a second time there is nothing waiting", async () => {
    await runShortcut("accepts-and-signs");
    expect(byNumber("proposals", "QUO-S1142")).toMatchObject({ status: "accepted", signed_name: "Cleo Nkemdi", accepted_how: "portal", fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(toasts()).toContain("Cleo Nkemdi accepted and signed QUO-S1142 in the portal.");
    await runShortcut("accepts-and-signs");
    expect(toasts()).toContain("QUO-S1142 isn’t waiting on a decision.");
  });

  it("has the client ask for changes on the project's waiting file, then another approve", async () => {
    useUi.setState((s) => ({ selected: { ...s.selected, project: byNumber("projects", "PRJ-S02").id } }));
    await runShortcut("asks-for-changes");
    expect(world.rows.deliverables.find((d) => d["title"] === "Sleeve dieline")).toMatchObject({ status: "changes", review_note: "Could the wordmark sit a little heavier on the bag?" });
    useUi.setState((s) => ({ selected: { ...s.selected, project: byNumber("projects", "PRJ-S01").id } }));
    await runShortcut("approves");
    expect(world.rows.deliverables.find((d) => d["title"] === "Wordmark for dark surfaces" && d["project_id"] === byNumber("projects", "PRJ-S01").id)).toMatchObject({ status: "approved", approved_how: "portal", approved_by: "Amara Okafor" });
    expect(toasts()).toContain("Hearth & Loaf approved “Wordmark for dark surfaces”.");
  });

  it("shows the client an out-of-date proposal: a week at a time until it is", async () => {
    await runShortcut("out-of-date");
    expect(clockLabel(world.now(), "en-US")).toBe("Tue 18 Aug");
    expect(useUi.getState()).toMatchObject({ persona: "client", view: "proposal", selected: expect.objectContaining({ proposal: byNumber("proposals", "QUO-S1142").id }) });
    expect(usePortal.getState().me).toEqual({ company: "Marigold Lane", contact_name: "Cleo Nkemdi" });
  });

  it("opens the emailed link on its invoice, and lets it expire", async () => {
    await runShortcut("open-link");
    expect(useUi.getState()).toMatchObject({ view: "link", token: "demo", selected: expect.objectContaining({ invoice: byNumber("invoices", "INV-S2039").id }) });
    expect(currentScreen()).toBe("entry");
    await runShortcut("expire-link");
    expect(await world.portal(1).peekLink("demo")).toBeNull();
  });

  it("opens the client's paused work, and an invoice already paid", async () => {
    await runShortcut("paused-work");
    expect(useUi.getState()).toMatchObject({ persona: "client", view: "project", selected: expect.objectContaining({ project: byNumber("projects", "PRJ-S03").id }) });
    expect(usePortal.getState().me?.company).toBe("Northlight Records");
    await runShortcut("already-paid");
    expect(useUi.getState().selected.invoice).toBe(byNumber("invoices", "INV-S2036").id);
    expect(usePortal.getState().me?.company).toBe("Hearth & Loaf");
  });

  it("fills the forms a screen keeps, with every word it fills", async () => {
    await runShortcut("amara");
    await runShortcut("unknown-address");
    await runShortcut("call-comes-in");
    await runShortcut("sample-proposal");
    expect(signals.map(([name]) => name)).toEqual(["signin.fill", "signin.fill", "enquiries.call", "composer.fill"]);
    expect(signals[0]![1]).toEqual({ email: "amara@hearthandloaf.example" });
    expect(signals[1]![1]).toEqual({ email: "someone@elsewhere.example", send: "yes" });
    expect(JSON.parse(signals[3]![1]["lines"]!)).toHaveLength(2);
  });
});

describe("the chips", () => {
  it("open a detail screen on a row worth seeing, and light the chip a view stands for", () => {
    goToScreen("invoice");
    expect(useUi.getState()).toMatchObject({ view: "invoice", selected: expect.objectContaining({ invoice: byNumber("invoices", "INV-S2039").id as Id }) });
    goToScreen("proposals");
    useUi.setState({ view: "proposal" });
    expect(currentScreen()).toBe("proposals");
    goToScreen("archive");
    expect(useUi.getState().view).toBe("notfound");
    expect(currentScreen()).toBe("archive");
    goToScreen("c404");
    expect(useUi.getState()).toMatchObject({ persona: "client", view: "notfound" });
    expect(currentScreen()).toBe("c404");
  });
});
