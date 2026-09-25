/**
 * The clients' pages, drawn from what the portal holds for the sample
 * studio's clients: each shows only that client's own things, in the state
 * the stored rows say — and the studio's preview draws the same pages from
 * the desk's rows and refuses every action.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { loadClientDeliverable, loadClientInvoice, loadClientProject, loadClientProposal, loadPortal, loadStudio, previewFromDesk, setPortalPort, upsertPortal, usePortal } from "../../state/portal.ts";
import { useDesk } from "../../state/desk.ts";
import { useSheets } from "../../state/sheets.ts";
import { useUi } from "../../state/ui.ts";
import { acceptAndSign } from "../../state/clientActions.ts";
import type { Tables } from "../../data/types.ts";
import Home from "./Home.tsx";
import Proposal from "./Proposal.tsx";
import Project from "./Project.tsx";
import Review from "./Review.tsx";
import Invoice from "./Invoice.tsx";
import Statement from "./Statement.tsx";
import Brief from "./Brief.tsx";
import Find from "./Find.tsx";
import Expired from "./Expired.tsx";
import { handoverFiles } from "./Handover.tsx";
import Terms from "../../sheets/client/Terms.tsx";
import Receipt from "../../sheets/client/Receipt.tsx";
import { sayRefusal } from "./shared/page.ts";

let studio: FakeStudio;

/*
 * Drawn to a string on the server side of React, a store hook reads the
 * store's INITIAL state; these tests draw what the stores hold now.
 */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode): string => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const select = (key: "proposal" | "invoice" | "project" | "deliverable", id: number) => useUi.setState((s) => ({ selected: { ...s.selected, [key]: id } }));
/** What a person reads: the markup without its tags, spaces joined. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

async function signIn(clientId: number): Promise<void> {
  setPortalPort(studio.world.portal(clientId));
  useUi.setState({ persona: "client", view: "home", preview: null, toasts: [] });
  await Promise.all([loadStudio(true), loadPortal()]);
}

beforeEach(async () => {
  studio = await fakeStudio();
  await signIn(1);
});

describe("Home", () => {
  it("leads with what waits on the client, then the work, the documents and who they talk to", () => {
    const page = text(draw(<Home />));
    expect(page).toContain("Hearth & Co Bakery");
    expect(page).toContain("Amara Osei · everything you have with Outline, on one page");
    expect(page).toContain("Waiting on you");
    expect(page).toContain("INV-2038 is 12 days past due");
    expect(page).toContain("Say yes or no to PRO-1142");
    expect(page).toContain("Answer 6 questions about the work");
    expect(page).toContain("Open balance");
    expect(page).toContain("$2,007.25");
    expect(page).toContain("Nadia Cole");
    expect(page).toContain("Tomas Reyes");
    expect(page).toContain("We send you the link.");
    // Never another client's things, an unshared deliverable or a draft.
    expect(page).not.toContain("Window sketch B");
    expect(page).not.toContain("Packaging system");
    expect(page).not.toContain("Studio sale poster");
  });

  it("says nothing needs them when nothing does", async () => {
    usePortal.setState((s) => ({
      rows: {
        ...s.rows,
        invoices: Object.fromEntries(Object.values(s.rows.invoices).map((i) => [i.id, { ...i, balance: "0.00" }])),
        proposals: Object.fromEntries(Object.values(s.rows.proposals).map((p) => [p.id, { ...p, status: "accepted" as const, accepted_how: "portal" as const, signed_name: "Amara Osei" }])),
        briefs: Object.fromEntries(Object.values(s.rows.briefs).map((b) => [b.id, { ...b, status: "sent" as const }])),
      },
    }));
    const page = text(draw(<Home />));
    expect(page).toContain("Nothing needs you. We will email when something does.");
    expect(page).toContain("Paid to date");
  });
});

describe("a proposal", () => {
  it("offers Accept and Decline while it holds its price, with the terms it names", async () => {
    select("proposal", 3);
    await loadClientProposal(3);
    const page = text(draw(<Proposal />));
    expect(page).toContain("PRO-1142");
    expect(page).toContain("Prepared for Amara Osei at Hearth & Co Bakery, by Outline.");
    expect(page).toContain("This proposal holds until August 12, 2026. Tax 8.5% is shown separately");
    expect(page).toContain("Accept proposal");
    expect(page).toContain("Decline…");
    expect(page).toContain("$4,231.50");
  });

  it("past its date, offers only a new price — and says so once asked", async () => {
    select("proposal", 3);
    upsertPortal("proposals", [{ ...usePortal.getState().rows.proposals[3]!, valid_until: "2026-07-20" }]);
    let page = text(draw(<Proposal />));
    expect(page).toContain("Proposal out of date");
    expect(page).toContain("PRO-1142 stopped holding its price on Jul 20.");
    expect(page).toContain("Ask for a new price");
    expect(page).not.toContain("Accept proposal");
    upsertPortal("proposals", [{ ...usePortal.getState().rows.proposals[3]!, new_price_asked_at: "2026-07-28T09:00:00.000Z" }]);
    page = text(draw(<Proposal />));
    expect(page).toContain("Asked — we’ll be in touch");
  });

  it("accepted on the client's word, asks only for their signature", () => {
    select("proposal", 3);
    upsertPortal("proposals", [{ ...usePortal.getState().rows.proposals[3]!, status: "accepted", accepted_how: "email", decided_at: "2026-07-27T15:00:00.000Z" }]);
    const page = text(draw(<Proposal />));
    expect(page).toContain("Accepted on July 27, 2026. Nothing above changes — sign to put your name to it.");
    expect(page).toContain("Type your full name");
    expect(page).not.toContain("Accept proposal");
    expect(page).not.toMatch(/\(v3\)/);
  });

  it("once signed, says who signed and when", async () => {
    select("proposal", 3);
    await loadClientProposal(3);
    await acceptAndSign(3, "Amara Osei");
    const page = text(draw(<Proposal />));
    expect(page).toContain("Accepted and signed on Jul 28 by Amara Osei.");
    expect(page).toContain("The studio is starting the project.");
  });

  it("answers another client's proposal exactly like one that does not exist", async () => {
    select("proposal", 2);
    await loadClientProposal(2).catch(() => undefined);
    const other = text(draw(<Proposal />));
    select("proposal", 404);
    await loadClientProposal(404).catch(() => undefined);
    const missing = text(draw(<Proposal />));
    // The read answered with nothing for either: the page lands on the same not-found for both.
    expect(usePortal.getState().rows.proposals[2]).toBeUndefined();
    expect(usePortal.getState().rows.proposals[404]).toBeUndefined();
    expect(other).toBe(missing);
    expect(other).not.toContain("Packaging system");
  });
});

describe("a project and its review", () => {
  it("shows the milestones and only the work shared with the client", async () => {
    select("project", 2);
    await loadClientProject(2);
    const page = text(draw(<Project />));
    expect(page).toContain("Seasonal window");
    expect(page).toContain("Window sketches");
    expect(page).toContain("In progress · due in 2 days");
    expect(page).toContain("Window sketch A");
    expect(page).toContain("Changes asked Jul 23");
    expect(page).toContain("Waiting for the next version");
    expect(page).not.toContain("Window sketch B");
  });

  it("says when the work is paused, with the studio's note", async () => {
    select("project", 2);
    upsertPortal("projects", [{ ...usePortal.getState().rows.projects[2]!, status: "paused", pause_note: "Back after the install date is fixed." }]);
    const page = text(draw(<Project />));
    expect(page).toContain("Work is paused. Back after the install date is fixed.");
  });

  it("offers Approve and Request changes on work waiting for the client", async () => {
    await signIn(2);
    select("project", 1);
    await loadClientProject(1);
    const page = text(draw(<Project />));
    expect(page).toContain("Notebook box, large");
    expect(page).toContain("box-large-v1.pdf");
    expect(page).toContain("Approve");
    expect(page).toContain("Request changes");
  });

  it("draws the studio's pins where they sit on the drawing, as a share of it", async () => {
    select("deliverable", 3);
    await loadClientDeliverable(3);
    upsertPortal("deliverable_notes", [{ id: 40, deliverable_id: 3, version_id: 3, side: "studio", author: "Nadia Cole", body: "Bigger loaf here.", pin_x: "30", pin_y: "40", at: "2026-07-24T10:00:00.000Z" } as Tables["deliverable_notes"]]);
    const html = draw(<Review />);
    const page = text(html);
    expect(page).toContain("Pins from the studio");
    expect(page).toContain("Bigger loaf here.");
    expect(html).toContain("inset-block-start:40%;inset-inline-start:30%");
    expect(page).toContain("What was said");
    expect(page).toContain("Could the loaf be bigger?");
    expect(page).toContain("v1 · shared Jul 20");
  });
});

describe("an invoice", () => {
  it("open and late: the balance, how to pay with its reference, and I've sent a payment", async () => {
    select("invoice", 4);
    await loadClientInvoice(4);
    const page = text(draw(<Invoice />));
    expect(page).toContain("INV-2038");
    expect(page).toContain("12 days past due");
    expect(page).toContain("Balance due");
    expect(page).toContain("How to pay");
    expect(page).toContain("Reference: INV-2038");
    expect(page).toContain("I’ve sent a payment");
    expect(page).toContain("Print or save as PDF");
  });

  it("says when the client told the studio, and does not ask twice", async () => {
    await signIn(2);
    select("invoice", 3);
    await loadClientInvoice(3);
    const page = text(draw(<Invoice />));
    expect(page).toContain("You told the studio on Jul 27. It shows here once they record it.");
    expect(page).not.toContain("I’ve sent a payment");
  });

  it("void: nothing to pay, and never the studio's reason", () => {
    select("invoice", 4);
    upsertPortal("invoices", [{ ...usePortal.getState().rows.invoices[4]!, status: "void", balance: "0.00", voided_at: "2026-07-27T10:00:00.000Z", void_reason: "Raised in error" }]);
    const page = text(draw(<Invoice />));
    expect(page).toContain("Voided on Jul 27. There is nothing to pay.");
    expect(page).not.toContain("Raised in error");
    expect(page).not.toContain("How to pay");
  });

  it("paid: settled on the day of its last payment, with its receipt", async () => {
    await signIn(3);
    select("invoice", 5);
    upsertPortal("invoices", [{ ...usePortal.getState().rows.invoices[5]!, balance: "0.00" }]);
    const page = text(draw(<Invoice />));
    expect(page).toContain("INV-2039 was settled on June 20, 2026. There is nothing to pay.");
    expect(page).toContain("See the receipt");
  });
});

describe("the statement, the brief and signing in", () => {
  it("the statement sums what was invoiced, paid and open", async () => {
    await signIn(2);
    const page = text(draw(<Statement />));
    expect(page).toContain("Statement");
    expect(page).toContain("Fold & Rule Stationers · every invoice and payment since June 10, 2026.");
    expect(page).toContain("Everything");
    expect(page).toContain("Last 12 months");
    expect(page).toContain("What you have paid");
    expect(page).toContain("$2,656.08 to date");
  });

  it("the brief asks the studio's questions with the answers saved so far", () => {
    const page = text(draw(<Brief />));
    expect(page).toContain("Seasonal window · Hearth & Co Bakery");
    expect(page).toContain("6 questions before we start");
    expect(page).toContain("1 of 6 answered");
    expect(page).toContain("Send it to Outline");
  });

  it("finding your documents asks only for an address", () => {
    const page = text(draw(<Find />));
    expect(page).toContain("Find your documents");
    expect(page).toContain("Send me a link");
    expect(page).not.toContain("Document number");
  });

  it("a used or expired link offers a new one, to its own address", () => {
    useUi.setState({ token: "usedlink-0001" });
    const page = text(draw(<Expired />));
    expect(page).toContain("This link has been used, or its twenty minutes are up.");
    expect(page).toContain("Send me a new link");
    expect(page).toContain("Use my email instead");
  });
});

describe("the sheets", () => {
  it("the terms are the version the proposal names, with its clauses", async () => {
    await loadClientProposal(3);
    const html = draw(<Terms sheet={{ kind: "terms", versionId: 3 }} onClose={() => {}} />);
    const page = text(html);
    expect(page).toContain("Outline’s terms");
    expect(page).toContain("v3 · in force since March 1, 2026");
    expect(page).toContain("When payment is late");
  });

  it("a receipt names the payment, the invoice and what is still open", async () => {
    await signIn(2);
    const page = text(draw(<Receipt sheet={{ kind: "receipt", paymentId: 1 }} onClose={() => {}} />));
    expect(page).toContain("REC-0017");
    expect(page).toContain("Received with thanks");
    expect(page).toContain("$2,656.08");
    expect(page).toContain("from Fold & Rule Stationers, Cleo Marchetti");
    expect(page).toContain("INV-2036");
    expect(page).toContain("Bank transfer");
  });
});

describe("the shared handover", () => {
  it("offers each approved deliverable's latest file, then the studio's own files", () => {
    const files = handoverFiles(
      {
        studio: null,
        project: { id: 4, number: "PRJ-04", name: "Studio identity", done_on: null, handover_notes: null, share_expires_on: null },
        fonts: [],
        files: [{ id: 1, project_id: 4, client_id: null, file: "store:files/print-notes.pdf", link: null, note: "For the printer", position: 0, client_key: null }],
        deliverables: [{ id: 5, title: "Final mark files", position: 0 } as Tables["deliverables"]],
        versions: [{ id: 4, deliverable_id: 5, v: 1, file: null, link: "https://files.example/kiln-mark.zip", posted_at: "2026-02-25T13:00:00.000Z" } as Tables["deliverable_versions"]],
      },
      (ref, id) => `signed:${ref}/${id}`,
    );
    expect(files).toEqual([
      { key: "v4", name: "kiln-mark.zip", what: "Final mark files", href: "https://files.example/kiln-mark.zip" },
      { key: "f1", name: "print-notes.pdf", what: "For the printer", href: "signed:handover_files/1" },
    ]);
  });
});

describe("the studio's preview", () => {
  it("draws the client's pages from the desk's rows, and refuses every action", async () => {
    const studioSide = usePortal.getState().studio!;
    previewFromDesk(useDesk.getState().rows, 1, studioSide);
    useUi.setState({ preview: { clientId: 1, back: "client" }, toasts: [] });
    select("proposal", 3);
    const page = text(draw(<Proposal />));
    expect(page).toContain("Accept proposal");
    const out = await acceptAndSign(3, "Amara Osei");
    expect(out).toMatchObject({ ok: false, reason: "preview" });
    // The page says it in the preview's own words, as a toast, and shows no error line.
    expect(sayRefusal((k) => k, out)).toBeNull();
    expect(useUi.getState().toasts.map((t) => t.text)).toEqual(["portal.previewBlocked"]);
    expect(studio.world.rows.proposals.find((p) => p["id"] === 3)).toMatchObject({ status: "sent" });
  });
});
