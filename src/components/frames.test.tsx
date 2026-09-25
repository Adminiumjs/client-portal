/**
 * The two frames and the finished dead ends, drawn from the stores: the
 * sidebar's items and their counts come from the rows the desk holds, the
 * studio's name and mark from its settings, the person from the session; the
 * clients' header names the signed-in client, and its footer how to reach the
 * studio.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.tsx";
import { fakeStudio } from "../testing/fakeStudio.ts";
import { loadPortal, loadStudio, usePortal } from "../state/portal.ts";
import { upsert, useDesk } from "../state/desk.ts";
import { useSheets } from "../state/sheets.ts";
import { useUi } from "../state/ui.ts";
import ClientFrame from "./ClientFrame.tsx";
import DeskFrame from "./DeskFrame.tsx";
import NotFound from "../screens/NotFound.tsx";
import ClientNotFound from "../screens/client/NotFound.tsx";
import NotAvailable from "../screens/client/NotAvailable.tsx";

const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
/** The sidebar's items, each with its count: "Enquiries 3". */
const items = (html: string) => [...html.matchAll(/data-nav="(\w+)"[^>]*>(?:<svg.*?<\/svg>)?([^<]+)(?:<span class="desk-nav-badge">(\d+)<\/span>)?/g)].map((m) => `${m[1]!}${m[3] === undefined ? "" : ` ${m[3]}`}`);

/*
 * Drawn to a string on the server side of React, a store hook reads the
 * store's INITIAL state (its server snapshot). These tests draw what the
 * stores hold now, so before each drawing the initial state is made to say
 * the same (test-only: nothing that ships draws on the server).
 */
function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}

beforeEach(async () => {
  await fakeStudio();
  useUi.setState({ view: "home", theme: "light" });
});

describe("the studio's frame", () => {
  it("draws the studio's name, the sidebar with its counts, the person and the footer", () => {
    const html = draw(
      <DeskFrame>
        <p>page</p>
      </DeskFrame>,
    );
    expect(html).toContain('class="brand-name">Outline<');
    expect(html).toContain(">Studio<");
    expect(items(html)).toEqual(["home", "schedule", "capacity", "enquiries 3", "proposals 1", "projects", "clients", "invoices 2", "chasing 2", "money", "expenses", "suppliers", "time", "settings", "archive"]);
    expect(html).toMatch(/data-nav="home" aria-current="page"|aria-current="page"[^>]*data-nav="home"/);
    expect(html).toContain("Nadia Cole");
    expect(html).toContain("Studio manager");
    expect(html).toContain("© 2026 Outline");
    expect(html).toContain('placeholder="Search documents, clients and projects"');
    expect(html).toContain("<p>page</p>");
  });

  it("follows the rows: a paid invoice leaves the count, and the section lights for a document", () => {
    const s = useDesk.getState();
    upsert("invoices", { ...s.rows.invoices[4]!, balance: "0.00" });
    useUi.setState({ view: "invoice" });
    const html = draw(
      <DeskFrame>
        <p />
      </DeskFrame>,
    );
    expect(items(html)).toContain("invoices 1");
    expect(html).toMatch(/aria-current="page"[^>]*data-nav="invoices"|data-nav="invoices"[^>]*aria-current="page"/);
  });

  it("leaves Settings out for someone who does not manage the studio", () => {
    useDesk.setState({ me: { ...useDesk.getState().me, manager: false, roleName: "Studio" } });
    const html = draw(
      <DeskFrame>
        <p />
      </DeskFrame>,
    );
    expect(items(html)).not.toContain("settings");
  });
});

describe("the clients' frame", () => {
  it("names the studio and the signed-in client, and how to reach the studio", async () => {
    useUi.setState({ persona: "client", view: "home" });
    await Promise.all([loadStudio(true), loadPortal()]);
    const html = draw(
      <ClientFrame>
        <p />
      </ClientFrame>,
    );
    expect(html).toContain(">Client portal<");
    expect(html).toContain("Hearth &amp; Co Bakery");
    expect(html).toContain('aria-label="Sign out of Hearth &amp; Co Bakery"');
    expect(html).toContain('href="mailto:hello@outline.example"');
    expect(html).toContain('href="tel:+15550142"');
    expect(html).toContain('aria-label="Language"');
  });

  it("says whose view the studio is previewing", async () => {
    await loadPortal();
    useUi.setState({ preview: { clientId: 1, back: "client" } });
    const html = draw(
      <ClientFrame>
        <p />
      </ClientFrame>,
    );
    expect(html).toContain("Preview — this is what Amara sees. You can’t act for them.");
    expect(html).toContain("Back to the studio");
    useUi.setState({ preview: null });
  });
});

describe("the finished dead ends", () => {
  it("the desk's 404: the code as decoration, the heading, the line and the two ways on", () => {
    const html = draw(<NotFound />);
    expect(html).toContain('data-code="404"');
    expect(html).toContain('<h1 class="dead-end-title" id="desk-404">This page doesn’t exist</h1>');
    expect(html).toContain("The link may be old, or the page was moved.");
    expect(html).toContain("Back to home");
    expect(html).toContain("Open invoices");
  });

  it("the clients' 404 and not-available, with the studio's address to ask", async () => {
    await loadStudio(true);
    const notFound = draw(<ClientNotFound />);
    expect(notFound).toContain("This page doesn’t exist");
    expect(notFound).toContain('href="mailto:hello@outline.example"');
    expect(notFound).not.toMatch(/belongs to someone else/);
    const off = draw(<NotAvailable />);
    expect(off).toContain("The client portal isn’t available right now.");
    expect(off).toContain("Ask the studio");
  });

  it("speak the page's language", () => {
    const html = renderToStaticMarkup(<I18nProvider>{<NotFound />}</I18nProvider>);
    expect(html).toContain("Back to home");
  });
});
