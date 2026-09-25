/**
 * The studio's working loop, drawn from the stores: Home's sentence and
 * figures, the enquiries inbox, the proposals list, one proposal in each of
 * its states (the buttons it offers, the note, the signature with the
 * proposal's own terms version, the out-of-date line, "Draft it" when a
 * project started with no invoice), and the proposal's sheets (Extend,
 * Withdraw, Make a revision, Start the project, Invoice the next stage,
 * Send) with the words and figures each shows.
 */
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.tsx";
import { loadInvoice, loadProposal, upsert, useDesk } from "../state/desk.ts";
import { usePortal } from "../state/portal.ts";
import { useSheets } from "../state/sheets.ts";
import { openEnquiry, useUi } from "../state/ui.ts";
import { fakeStudio } from "../testing/fakeStudio.ts";
import Home from "./Home.tsx";
import Enquiries from "./Enquiries.tsx";
import Proposals from "./Proposals.tsx";
import Proposal from "./Proposal.tsx";
import Extend from "../sheets/Extend.tsx";
import Withdraw from "../sheets/Withdraw.tsx";
import Revision from "../sheets/Revision.tsx";
import StartProject from "../sheets/StartProject.tsx";
import NextStage from "../sheets/NextStage.tsx";
import Send from "../sheets/Send.tsx";

/* Drawn on the server side of React a store hook reads its initial state: make it say what the store holds now. */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>)
    .replace(/<!-- -->/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => text(m[1]!).trim()).filter((b) => b !== "");
const showProposal = (id: number) => {
  useUi.setState({ view: "proposal", selected: { ...useUi.getState().selected, proposal: id } });
  return draw(<Proposal />);
};
const proposal = (id: number) => useDesk.getState().rows.proposals[id]!;

beforeEach(async () => {
  await fakeStudio();
  useUi.setState({ theme: "light" });
});

describe("Home", () => {
  it("says what the day needs, with the three figures, aging and the lists", () => {
    const html = text(draw(<Home />));
    expect(html).toContain("Tue, Jul 28, 2026");
    expect(html).toContain("2 invoices need chasing, 1 proposal waiting on a client.");
    expect(html).toContain("Across 4 open invoices");
    expect(html).toContain("Oldest is 47 days past due");
    expect(html).toContain("1 paused");
    expect(html).toContain("Measured against today, never stored on the invoice.");
    expect(html).toContain("INV-2039 · unpaid, $741.60");
    expect(html).toContain("PRO-1142 · awaiting a decision");
    expect(html).toContain("Notebook box, large · pending approval");
    expect(html).toContain("Waiting 47 days");
    expect(html).toContain("Hearth & Co Bakery · Seasonal window");
    expect(html).toContain("INV-2040 due · $488.25");
  });

  it("says so when nothing is overdue and nothing is out", () => {
    for (const i of Object.values(useDesk.getState().rows.invoices)) upsert("invoices", { ...i, balance: "0.00" });
    upsert("proposals", { ...proposal(3), status: "accepted" });
    const html = text(draw(<Home />));
    expect(html).toContain("Nothing overdue, no proposals out.");
    expect(html).toContain("Everything is inside terms");
  });
});

describe("Enquiries", () => {
  it("draws the lead, the filters with their counts, the list and the open enquiry with its drafted reply", () => {
    const html = draw(<Enquiries />);
    const words = text(html);
    expect(words).toContain("3 unanswered · 4 this month");
    expect(buttons(html)).toEqual(expect.arrayContaining(["Log a call", "Everything 4", "Unanswered 3", "Replied 0", "Became work 0", "Parked 1", "Not for us 0", "Next unanswered (3)"]));
    expect(words).toContain("ENQ-004");
    expect(words).toContain("Not for us");
    expect(words).toContain("Hello Promo, thank you for writing. This isn't work we take on");
    expect(buttons(html)).toEqual(expect.arrayContaining(["Start a proposal", "Send reply", "Park it"]));
    expect(words).toContain("A polite no is a real answer and costs nothing.");
  });

  it("opens on the enquiry another screen asked for (Capacity's \"Open the enquiry\")", () => {
    openEnquiry(2);
    expect(useUi.getState()).toMatchObject({ view: "enquiries", selected: { enquiry: 2 } });
    const words = text(draw(<Enquiries />));
    // Lantern Books' reply is drafted, not the newest (Bright Offers).
    expect(words).toContain("Hello Ines");
    expect(words).not.toContain("Hello Promo");
  });
});

describe("Proposals", () => {
  it("lists every proposal newest first with its client, valid-until, total and state", () => {
    const html = draw(<Proposals />);
    const words = text(html);
    expect(words).toContain("4 proposals · 1 out with a client · $4,231.50 awaiting a decision");
    expect(buttons(html)).toEqual(expect.arrayContaining(["All 4", "Draft 1", "Sent 1", "Out of date 0", "Accepted 1", "Declined 1", "Withdrawn 0", "New proposal"]));
    const rows = buttons(html).filter((b) => /^(—|PRO-)/.test(b));
    expect(rows).toEqual([
      "— Studio sale poster Kiln Street Ceramics Aug 18, 2026 $705.25 Draft",
      "PRO-1142 Shopfront identity Hearth & Co Bakery Aug 12, 2026 $4,231.50 Sent",
      "PRO-1141 Packaging system Fold & Rule Stationers Jun 30, 2026 $6,640.20 Accepted",
      "PRO-1140 Menu and window lettering Marigold Tea Rooms Jun 20, 2026 $2,387.00 Declined",
    ]);
  });
});

describe("one proposal", () => {
  it("sent and in date: the document, its stored figures, and a reminder, Extend, Withdraw, the printed copy and the client's view", async () => {
    await loadProposal(3);
    const html = showProposal(3);
    const words = text(html);
    expect(words).toContain("PRO-1142");
    expect(words).toContain("Sent Jul 22, 2026");
    expect(words).toContain("Amara Osei · amara@hearth.example");
    expect(words).toContain("less $100.00 discount");
    expect(words).toContain("Tax 8.5%");
    expect(words).toContain("$4,231.50");
    expect(buttons(html)).toEqual(["All proposals", "Send a reminder", "Extend…", "Withdraw…", "Printed copy", "Preview as the client"]);
  });

  it("out of date: the warning, Extend first, and a revision", async () => {
    await loadProposal(3);
    upsert("proposals", { ...proposal(3), valid_until: "2026-07-20" });
    const html = showProposal(3);
    expect(text(html)).toContain("Out of date since Jul 20 — Amara can’t accept it now.");
    expect(buttons(html)).toEqual(["All proposals", "Extend…", "Withdraw…", "Make a revision", "Printed copy", "Preview as the client"]);
  });

  it("accepted and signed: the signature with the proposal's own terms version, its fingerprint, and its project", async () => {
    await loadProposal(2);
    upsert("proposals", { ...proposal(2), fingerprint: "3f9a0c77d2e1b4aa9c21e" });
    const html = showProposal(2);
    expect(text(html)).toContain("Accepted and signed on Jun 9, 2026 by Cleo Marchetti · terms v3 · fingerprint 3f9a…c21e");
    expect(buttons(html)).toEqual(["All proposals", "Printed copy", "Preview as the client", "Open project PRJ-01"]);
  });

  it("a sample signature carries no fingerprint line", async () => {
    await loadProposal(2);
    expect(text(showProposal(2))).not.toContain("fingerprint");
  });

  it("accepted with no project: Start the project; a project with no stage invoice: Draft it", async () => {
    await loadProposal(2);
    const project = useDesk.getState().rows.projects[1]!;
    upsert("projects", { ...project, proposal_id: null });
    expect(buttons(showProposal(2))).toEqual(["All proposals", "Start the project", "Printed copy", "Preview as the client"]);
    upsert("projects", project);
    for (const i of Object.values(useDesk.getState().rows.invoices)) if (i.from_quote_id === 2) upsert("invoices", { ...i, status: "void" });
    const html = showProposal(2);
    expect(text(html)).toContain("PRJ-01 started — first invoice not drafted yet.");
    expect(buttons(html)).toContain("Draft it");
  });

  it("declined: their note, and a revision; a draft: the composer, or send it", async () => {
    await loadProposal(1);
    const declined = showProposal(1);
    expect(text(declined)).toContain("Declined Jun 12, 2026 — their note");
    expect(text(declined)).toContain("We're holding off until spring.");
    expect(buttons(declined)).toEqual(["All proposals", "Make a revision"]);
    await loadProposal(4);
    expect(buttons(showProposal(4))).toEqual(["All proposals", "Open in composer", "Send to Jonas…"]);
  });
});

describe("the proposal's sheets", () => {
  it("Extend says how long it holds and offers two weeks on", async () => {
    await loadProposal(3);
    const html = draw(<Extend sheet={{ kind: "extend", proposalId: 3 }} onClose={() => undefined} />);
    expect(text(html)).toContain("Extend PRO-1142");
    expect(text(html)).toContain("It holds until August 12, 2026 now. Only a later date works.");
    expect(html).toContain('value="2026-08-26"');
    expect(html).toContain('min="2026-08-13"');
  });

  it("Withdraw names who can no longer accept it; a revision says it gets its own number", async () => {
    await loadProposal(3);
    expect(text(draw(<Withdraw sheet={{ kind: "withdraw", proposalId: 3 }} onClose={() => undefined} />))).toContain("Amara won’t be able to accept it. The reason stays with the proposal.");
    expect(text(draw(<Revision sheet={{ kind: "revision", proposalId: 3 }} onClose={() => undefined} />))).toContain("A new draft copied from PRO-1142. It gets its own number.");
  });

  it("Start the project names the project, the milestones of the agreed split and the first share before tax", async () => {
    await loadProposal(3);
    upsert("proposals", { ...proposal(3), status: "accepted", signed_at: "2026-07-27T15:00:00.000Z" });
    const html = draw(<StartProject sheet={{ kind: "startProject", proposalId: 3 }} onClose={() => undefined} />);
    const words = text(html);
    expect(html).toContain('value="Shopfront identity"');
    expect(html).toContain('value="Kickoff & schedule"');
    expect(html).toContain('value="Halfway review"');
    expect(html).toContain('value="2026-08-04"');
    expect(words).toContain("First invoice");
    expect(words).toContain("50 / 50");
    expect(words).toContain("As agreed on Jul 27");
    expect(words).toContain("50 % to start — $1,950.00 before tax");
    expect(words).toContain("A draft you can check before sending.");
  });

  it("Invoice the next stage shows the next share of the agreed split, or that every stage is invoiced", async () => {
    await loadProposal(2);
    const html = text(draw(<NextStage sheet={{ kind: "nextStage", projectId: 1 }} onClose={() => undefined} />));
    expect(html).toContain("Next invoice");
    expect(html).toContain("40 / 30 / 30");
    expect(html).toContain("30 % on delivery — $1,836.00 before tax");
    upsert("invoices", { ...useDesk.getState().rows.invoices[3]!, id: 99, share_pct: "30" });
    expect(text(draw(<NextStage sheet={{ kind: "nextStage", projectId: 1 }} onClose={() => undefined} />))).toContain("Every stage is invoiced.");
    expect(text(draw(<NextStage sheet={{ kind: "nextStage", projectId: 2 }} onClose={() => undefined} />))).toContain("didn’t start from a proposal");
  });

  it("Send shows who it goes to and the stored total, and is off for a draft with nothing to send", async () => {
    await Promise.all([loadProposal(4), loadInvoice(7)]);
    const proposalSheet = draw(<Send sheet={{ kind: "send", table: "proposals", id: 4 }} onClose={() => undefined} />);
    expect(text(proposalSheet)).toContain("Jonas Berg at Kiln Street Ceramics · jonas@kilnstreet.example");
    expect(text(proposalSheet)).toContain("$705.25");
    expect(buttons(proposalSheet)).toContain("Send to Jonas");
    expect(proposalSheet).not.toContain('disabled=""');
    const invoiceSheet = draw(<Send sheet={{ kind: "send", table: "invoices", id: 7 }} onClose={() => undefined} />);
    expect(text(invoiceSheet)).toContain("Send INV-2041");
    expect(text(invoiceSheet)).toContain("Due Aug 11 if sent today");
    expect(invoiceSheet).not.toContain('disabled=""');
    upsert("invoices", { ...useDesk.getState().rows.invoices[7]!, total: "0.00" });
    const empty = text(draw(<Send sheet={{ kind: "send", table: "invoices", id: 7 }} onClose={() => undefined} />));
    expect(empty).toContain("Add at least one line with a rate before sending.");
    expect(draw(<Send sheet={{ kind: "send", table: "invoices", id: 7 }} onClose={() => undefined} />)).toContain('disabled=""');
    expect(empty).toContain("Open in composer");
  });
});
