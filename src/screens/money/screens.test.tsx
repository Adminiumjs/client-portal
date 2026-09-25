/**
 * Money, Archive and Every email we send, drawn from the test studio after
 * the reads each page makes when it opens — and what they write: nothing,
 * but for a running cost a manager adds, changes or takes off.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import { setTenantCurrency } from "../../i18n/ambient.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import { useDesk } from "../../state/desk.ts";
import { addRunningCost, editRunningCost, removeRunningCost } from "../../state/officeActions.ts";
import { usePortal } from "../../state/portal.ts";
import { useSheets } from "../../state/sheets.ts";
import { useUi } from "../../state/ui.ts";
import { formatMoney } from "../../lib/money.ts";
import Money from "../Money.tsx";
import Archive from "../Archive.tsx";
import Emails from "../Emails.tsx";
import RunningCostSheet, { costRefusal } from "../../sheets/money/RunningCost.tsx";
import { loadMoney } from "./load.ts";
import { aging, figures } from "./model.ts";
import { loadArchive } from "../archive/load.ts";
import { loadSampleRows } from "../emails/samples.ts";

function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;|&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, " ");
const usd = (v: string) => formatMoney(v, "USD", "en-US");
const access = (manager: boolean) =>
  useDesk.setState((s) => ({ me: { ...s.me, manager, access: manager ? null : { tables: { running_costs: ["read"] } } } as typeof s.me }));

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
  setTenantCurrency("USD");
});

describe("Money", () => {
  it("shows the stored figures the page adds up: collected, open, out for signature, the months of costs, the aging", async () => {
    await loadMoney("2026-07-28");
    const s = useDesk.getState();
    const input = { today: "2026-07-28", currency: "USD", invoices: s.rows.invoices, payments: Object.values(s.rows.payments), proposals: Object.values(s.rows.proposals), costs: Object.values(s.rows.running_costs) };
    const f = figures(input);
    const page = text(draw(<Money />));
    expect(page).toContain(`Collected ${usd(f.sixMonths)} in six months, an average of ${usd(f.average)} a month against ${usd(f.costs)} of costs.`);
    for (const figure of [f.collectedThisMonth, f.open, f.outForSignature]) expect(page).toContain(usd(figure));
    expect(page).toContain(`${usd(f.overdue)} of it overdue`);
    expect(page).toContain(`${String(f.monthsCovered)} months`);
    for (const b of aging(input)) expect(page).toContain(usd(b.amount));
    for (const label of ["Collected in July", "Open", "Out for signature", "Costs covered", "Invoiced against collected", "Still owed", "What it costs to open the door", "Every month", "The chase ladder"]) expect(page).toContain(label);
    expect(page).toContain("Studio rent");
    expect(page).toContain(usd("2060.00"));
    // No way to a pack this release does not build.
    expect(page).not.toMatch(/Year-end/i);
    expect(studio.writes).toEqual([]);
  });

  it("lets a manager change the running costs, and nobody else", async () => {
    await loadMoney("2026-07-28");
    access(true);
    expect(draw(<Money />)).toContain("Change Studio rent");
    access(false);
    const page = draw(<Money />);
    expect(page).not.toContain("Change Studio rent");
    expect(text(page)).not.toContain(" Add ");
  });

  it("adds, changes and takes off a running cost as one write each, the amount as typed", async () => {
    const made = await addRunningCost({ label: "Accountant", monthly_amount: "340", position: 2 });
    expect(made.ok).toBe(true);
    const id = made.ok ? made.value.id : 0;
    expect((await editRunningCost(id, { monthly_amount: "360,50" })).ok).toBe(true);
    expect((await removeRunningCost(id)).ok).toBe(true);
    // The add carries its action key (a second press finds the row it made), and nothing the table lacks.
    expect(Object.keys(studio.writes[0]!.values ?? {}).sort()).toEqual(["client_key", "label", "monthly_amount", "position"]);
    expect(studio.writes.map((w) => [w.op, w.table, w.values?.["monthly_amount"]])).toEqual([
      ["insert", "running_costs", "340"],
      ["update", "running_costs", "360.50"],
      ["remove", "running_costs", undefined],
    ]);
  });

  it("words a refused cost at its field", async () => {
    const out = await addRunningCost({ label: " ", monthly_amount: "1" });
    expect(out.ok ? null : costRefusal(out)).toEqual({ field: "label", key: "money.sheet.labelRequired" });
    const bad = await addRunningCost({ label: "Rent", monthly_amount: "lots" });
    expect(bad.ok ? null : costRefusal(bad)).toEqual({ field: "monthly_amount", key: "money.sheet.amountNotANumber" });
    const sheet = text(draw(<RunningCostSheet cost={null} nextPosition={2} currency="USD" onClose={() => undefined} />));
    for (const word of ["Add a running cost", "What it is", "Each month", "Add it"]) expect(sheet).toContain(word);
  });
});

describe("Archive", () => {
  it("lists the finished projects by year, each worth its sent invoices, opening its handover", async () => {
    await loadArchive();
    const rows = useDesk.getState().rows;
    const done = Object.values(rows.projects).filter((p) => p.status === "done");
    expect(done.length).toBeGreaterThan(0);
    const html = draw(<Archive />);
    const page = text(html);
    for (const p of done) expect(page).toContain(p.name);
    expect(html).toContain('placeholder="Search 1 year"');
    expect(page).toMatch(/\d+ finished projects?, \d+ years?, \$[\d,.]+ of work\./);
    for (const word of ["Delivered", "This year"]) expect(page).toContain(word);
    expect(studio.writes).toEqual([]);
  });
});

describe("Every email we send", () => {
  it("lists every email and draws the first — Adminium's sign-in link — with a code and no token", async () => {
    await loadSampleRows();
    const html = draw(<Emails />);
    const page = text(html);
    for (const word of ["To clients", "To the studio", "Sign-in link", "Proposal sent", "Invoice sent", "Receipt", "Handover", "New enquiry", "Designed", "Plain text", "On a phone", "When it goes out", "Try it", "Follow the link", "Send a test to ourselves"]) expect(page).toContain(word);
    expect(page).toContain("481 926");
    expect(page).toContain("hello@outline.example");
    expect(html).not.toContain("KILNSTREETDONE26");
    expect(page).toContain("A test goes to hello@outline.example, the studio’s own address, and nowhere else.");
    expect(studio.writes).toEqual([]);
  });

  it("offers a test send and Email templates only to someone who manages Adminium's settings, and says who can otherwise", async () => {
    await loadSampleRows();
    const { deskWrites, loadSystemActions, setDeskWrites } = await import("../../state/desk.ts");
    const writes = deskWrites();
    const holding = async (held: string[] | Error) => {
      useDesk.setState({ systemActions: null });
      setDeskWrites({ ...writes, systemActions: async () => (held instanceof Error ? Promise.reject(held) : held) });
      await loadSystemActions();
      return draw(<Emails />);
    };
    const manager = await holding(["users.manage", "settings.manage"]);
    expect(text(manager)).toContain("Send a test to ourselves");
    expect(manager).toContain('href="/email-templates"');
    expect(text(manager)).toContain("Change the words in Email templates");

    for (const html of [await holding(["audit.read"]), await holding(new Error("refused"))]) {
      expect(text(html)).not.toContain("Send a test to ourselves");
      expect(html).not.toContain("/email-templates");
      expect(text(html)).toContain("Only someone who manages Adminium’s settings can send a test.");
    }
    setDeskWrites(writes);
  });
});
