/**
 * Home's aging chips open the Invoices list on one bucket of the open
 * invoices: 31–60 days shows INV-2039 (47 days past due) and not INV-2038
 * (12 days), with the bucket as a chip that takes the filter off.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../i18n/index.tsx";
import { fakeStudio } from "../testing/fakeStudio.ts";
import { useDesk } from "../state/desk.ts";
import { usePortal } from "../state/portal.ts";
import { useSheets } from "../state/sheets.ts";
import { openInvoices, useUi } from "../state/ui.ts";
import Invoices from "./Invoices.tsx";

/* Drawn on the server side of React, a store hook reads its INITIAL state: point it at the current one (test-only). */
function draw(): string {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) Object.assign(store.getInitialState(), store.getState());
  return renderToStaticMarkup(
    <I18nProvider>
      <Invoices />
    </I18nProvider>,
  ).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

beforeEach(async () => {
  await fakeStudio();
  useUi.setState({ invoiceFilter: null });
});

describe("the Invoices list on an aging bucket", () => {
  it("shows only that bucket's open invoices, with a chip to take it off", () => {
    openInvoices("d60");
    const page = draw();
    expect(page).toContain("INV-2039");
    expect(page).not.toContain("INV-2038");
    expect(page).toContain("31–60 days");
  });

  it("shows every invoice held when no bucket is asked for", () => {
    openInvoices(null);
    const page = draw();
    expect(page).toContain("INV-2039");
    expect(page).toContain("INV-2038");
  });
});
