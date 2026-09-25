/**
 * The "add" sheet, drawn for each kind: its title, sub-line and button, the
 * fields the design gives it, a dialog named by its title — and the edits
 * that start from the stored row.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.tsx";
import { useDesk } from "../state/desk.ts";
import { usePortal } from "../state/portal.ts";
import { useSheets, type DeskSheet } from "../state/sheets.ts";
import { useUi } from "../state/ui.ts";
import { fakeStudio } from "../testing/fakeStudio.ts";
import Add from "./Add.tsx";

function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (sheet: Extract<DeskSheet, { kind: "add" }>, draft: Record<string, unknown> = {}) => {
  useSheets.setState({ open: sheet, draft, unfinished: null, busy: false });
  current();
  return renderToStaticMarkup(
    <I18nProvider>
      <Add sheet={sheet} onClose={() => undefined} />
    </I18nProvider>,
  );
};
const labels = (html: string) => [...html.matchAll(/<label class="field-label"[^>]*>([^<]+)<\/label>/g)].map((m) => m[1]);

beforeEach(async () => {
  await fakeStudio();
});

describe("the add sheet", () => {
  it("is a dialog named by its title", () => {
    const html = draw({ kind: "add", what: "invoice" });
    expect(html).toMatch(/role="dialog" aria-modal="true" aria-labelledby="([^"]+)"/);
    const id = /aria-labelledby="([^"]+)"/.exec(html)![1]!;
    expect(html).toContain(`id="${id}">New invoice</h2>`);
    expect(html).toContain('aria-label="Close"');
  });

  it("new invoice: client, project, what it is for, terms, first line, qty and rate — the client's own terms chosen", () => {
    const html = draw({ kind: "add", what: "invoice", about: { clientId: 2 } });
    expect(html).toContain("Saved as a draft — nothing is sent yet");
    expect(labels(html)).toEqual(["Client", "Against a project", "What it is for", "Terms", "First line", "Qty", "Rate"]);
    expect(html).toMatch(/<option value="net30" selected="">Net 30<\/option>/);
    expect(html).toContain("No project — one-off");
    expect(html).toContain("PRJ-01 · Packaging system");
    expect(html).not.toContain("Seasonal window");
    expect(html).toContain("Create the draft");
    expect(html).toContain("It is numbered now and opens in the composer. Terms set the due date.");
  });

  it("new project: its first milestone a week out, named for the studio", () => {
    const html = draw({ kind: "add", what: "project" });
    expect(labels(html)).toEqual(["Client", "What are we making", "First milestone", "Due"]);
    expect(html).toContain('value="Kickoff &amp; schedule"');
    expect(html).toContain('value="2026-08-04"');
    expect(html).toContain("Start the project");
  });

  it("add a client: no sub-line, one contact, the address as it prints", () => {
    const html = draw({ kind: "add", what: "client" });
    expect(html).not.toContain('class="sheet-sub"');
    expect(labels(html)).toEqual(["Business", "Trade", "Who we talk to", "Email", "Address", "Tax number"]);
    expect(html).toContain("One contact each.");
  });

  it("edit a client: starts from what is stored, the studio's terms offered", () => {
    const html = draw({ kind: "add", what: "clientEdit", about: { clientId: 1 } });
    expect(html).toContain("Edit Hearth &amp; Co Bakery");
    expect(html).toContain("14 Mill Lane");
    expect(html).toMatch(/<option value="net14" selected="">Net 14<\/option>/);
    expect(html).toContain("The studio’s default");
    expect(html).toContain(">Save</button>");
  });

  it("log a call: the budget said, and the words they used", () => {
    const html = draw({ kind: "add", what: "enquiry" });
    expect(labels(html)).toEqual(["Business", "Who called", "Email", "Budget they said", "What they said"]);
    expect(html).toContain("Add to the inbox");
  });

  it("a milestone: added to an open project; edited with a remove when no deliverable hangs on it", () => {
    let html = draw({ kind: "add", what: "milestone", about: { projectId: 2 } });
    expect(labels(html)).toEqual(["Project", "Milestone", "Due"]);
    expect(html).not.toContain("Studio identity");
    html = draw({ kind: "add", what: "milestone", about: { milestoneId: 5 } });
    expect(html).toContain("Edit the milestone");
    expect(html).toContain('value="Install"');
    expect(html).toContain("Remove the milestone");
    html = draw({ kind: "add", what: "milestone", about: { milestoneId: 4 } });
    expect(html).not.toContain("Remove the milestone");
  });

  it("a person: shown to clients is a switch, and who signs in is Adminium's", () => {
    const html = draw({ kind: "add", what: "person" });
    expect(labels(html)).toEqual(["Name", "Role label", "Initials"]);
    expect(html).toMatch(/role="switch" class="set-switch" aria-checked="false"/);
    expect(html).toContain('href="/settings/team"');
    expect(html).not.toMatch(/Access|Manager — can void/);
  });

  it("a rate: what it is, the amount, the hours it stands for; edited with a remove", () => {
    let html = draw({ kind: "add", what: "rate" });
    expect(labels(html)).toEqual(["What it is", "Amount", "Hours it stands for"]);
    expect(html).toContain("Add the rate");
    html = draw({ kind: "add", what: "rate", about: { rateId: 1 } });
    expect(html).toContain("Edit the rate");
    expect(html).toContain('value="780.00"');
    expect(html).toContain("Remove the rate");
  });

  it("keeps what was typed", () => {
    const html = draw({ kind: "add", what: "client" }, { company: "Vento & Sons" });
    expect(html).toContain('value="Vento &amp; Sons"');
  });
});
