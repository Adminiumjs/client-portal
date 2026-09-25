/**
 * The Settings screen, drawn from the sample studio: the studio card from the
 * settings row, people from `people` with their "Shown to clients" switch,
 * the sign-off offered from people, the notices, the Invoices & Receipts card
 * for a studio manager only, the rate card with its internal hourly line —
 * and no door to a screen that does not ship yet.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.tsx";
import { upsert, useDesk } from "../state/desk.ts";
import { useSheets } from "../state/sheets.ts";
import { useUi } from "../state/ui.ts";
import { usePortal } from "../state/portal.ts";
import { fakeStudio } from "../testing/fakeStudio.ts";
import Settings from "./Settings.tsx";

/** Stores drawn on the server side of React read their initial state: make it the current one (test-only). */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = () => {
  current();
  return renderToStaticMarkup(
    <I18nProvider>
      <Settings />
    </I18nProvider>,
  );
};
const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeEach(async () => {
  await fakeStudio();
  useUi.setState({ view: "settings" });
});

describe("Settings, for a studio manager", () => {
  it("draws the heading, the way to the terms, and no door to a screen that does not ship", () => {
    const html = draw();
    expect(html).toContain('data-screen="settings"');
    expect(html).toContain(">Settings</h1>");
    expect(html).toContain("The handful of things that are true for every document we send.");
    expect(html).toContain("Terms &amp; signature");
    expect(html).not.toMatch(/Suppliers|worksheet|Year-end/);
  });

  it("fills the studio card from the settings row", () => {
    const html = draw();
    for (const value of ["Outline", "hello@outline.example", "+1 555 0142", "https://outline.example"]) expect(html).toContain(`value="${value}"`);
    expect(html).toContain("For the internal hourly rate.");
  });

  it("lists the people with the switch that decides whether clients see them", () => {
    const html = draw();
    expect(html).toContain("Nadia Cole");
    expect(html).toContain("Partner · packaging &amp; print");
    expect(count(html, "Shown to clients")).toBe(2);
    expect(html).toContain("Add a person");
    expect(html).not.toContain("Clients see no one");
  });

  it("warns when clients would see no one", () => {
    for (const p of Object.values(useDesk.getState().rows.people)) upsert("people", { ...p, shown_to_clients: false });
    expect(draw()).toContain("Clients see no one.");
  });

  it("offers the sign-off from the people, keeping what is stored, and the emails in Adminium", () => {
    const html = draw();
    expect(html).toMatch(/<option value="Nadia and Tomas" selected="">Nadia and Tomas<\/option>/);
    expect(html).toContain('<option value="Nadia">Nadia</option>');
    expect(html).toContain('href="/email-templates"');
  });

  it("switches the seven notices, and names where they go", () => {
    const html = draw();
    expect(count(html, 'role="switch"')).toBe(2 + 7);
    expect(html).toContain("A client asks for a new price");
    expect(html).not.toContain("A new enquiry lands");
    expect(html).toContain("Each one is an email to hello@outline.example.");
  });

  it("shows the Invoices & Receipts card, read from the add-on", () => {
    const html = draw();
    expect(html).toContain("Invoices &amp; receipts");
    expect(html).toContain("Shared by every app that issues your documents · Invoices &amp; Receipts");
  });

  it("draws the rate card with the internal hourly rate and each amount", () => {
    const html = draw();
    expect(html).toContain("$130.00 an hour, internally");
    for (const amount of ["780.00", "240.00", "90.00"]) expect(html).toContain(`value="${amount}"`);
    expect(html).toContain("Quoted per stage, never per hour.");
  });

  it("gives each card that saves its own Save", () => {
    expect(count(draw(), ">Save</button>")).toBe(3);
  });
});

describe("Settings, for the Studio role", () => {
  beforeEach(() => {
    useDesk.setState({ me: { ...useDesk.getState().me, manager: false, roleName: "Studio" } });
  });

  it("reads everything, changes nothing, and never shows the add-on's settings", () => {
    const html = draw();
    expect(html).toContain("Only a studio manager can change these.");
    expect(html).not.toContain("Invoices &amp; receipts");
    expect(html).not.toContain(">Save</button>");
    expect(html).not.toContain("Add a person");
    expect(html).toMatch(/value="Outline"[^>]*readOnly|readOnly[^>]*value="Outline"/i);
  });
});
