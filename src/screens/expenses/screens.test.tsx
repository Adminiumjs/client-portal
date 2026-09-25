/**
 * Expenses and Suppliers drawn from the test studio's rows, and what their
 * actions write: a purchase as the form sends it (the receipt first, the
 * cost as typed, whose it is), "Pass on" (a draft for a client with none,
 * then one line per purchase at its stored cost — each under its own key —
 * and nothing the page worked out), the words after it, and the refusals.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/index.tsx";
import { MESSAGES } from "../../i18n/messages/index.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../../testing/fakeStudio.ts";
import { useDesk } from "../../state/desk.ts";
import { addPurchase, loadPurchases, loadSuppliers, passOn, removePurchase } from "../../state/officeActions.ts";
import { useSheets } from "../../state/sheets.ts";
import { refusalOf } from "../../state/outcome.ts";
import { SinkError } from "../../data/sink.ts";
import { usePortal } from "../../state/portal.ts";
import { useUi } from "../../state/ui.ts";
import Expenses from "../Expenses.tsx";
import Suppliers from "../Suppliers.tsx";
import { PurchaseSheet } from "../../sheets/expenses/PurchaseSheet.tsx";
import { dayProblem, purchaseInput } from "./PurchaseForm.tsx";
import { passedOnWords, refusalWords } from "./words.ts";

function current(): void {
  for (const store of [useDesk, usePortal, useUi, useSheets] as unknown as { getState: () => object; getInitialState: () => object }[]) {
    Object.assign(store.getInitialState(), store.getState());
  }
}
const draw = (node: React.ReactNode) => {
  current();
  return renderToStaticMarkup(<I18nProvider>{node}</I18nProvider>);
};
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/\s+/g, " ");
const en = MESSAGES["en-US"];
const t = (key: string, params: Record<string, string | number> = {}) => (en[key as keyof typeof en] as string).split("|").pop()!.replace(/\{(\w+)\}/g, (_, n: string) => String(params[n]));
const TITLE = { newTitle: () => "Purchases at cost" };

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
  // What the screens read when they open (a server render runs no effects).
  await loadPurchases(null);
  await loadSuppliers();
});

describe("Expenses, drawn", () => {
  it("adds up the stored costs at the top and counts each filter", () => {
    const words = text(draw(<Expenses />));
    expect(words).toContain("To put on an invoice $110.40 2 purchases waiting");
    expect(words).toContain("Already passed on $0.00 at cost, on nothing yet");
    expect(words).toContain("Ours to carry $29.00");
    expect(words).toMatch(/Everything 3 .*To pass on 2 .*Passed on 0 .*Ours 1/);
  });

  it("lists the purchases newest first, whose each is, and a chip for how it stands", () => {
    const html = draw(<Expenses />);
    const words = text(html);
    expect(words.indexOf("Proof prints, twelve sheets")).toBeLessThan(words.indexOf("Courier, samples to Cleo"));
    expect(words.indexOf("Courier, samples to Cleo")).toBeLessThan(words.indexOf("Image library, monthly"));
    expect(words).toContain("Outline · overhead");
    expect(html).toContain('aria-label="Pass it on: Proof prints, twelve sheets"');
    expect(html).toContain('aria-label="Ours to carry: Image library, monthly"');
    expect(words).toContain("Waiting to go on an invoice $110.40 Pass on 2");
  });

  it("says a passed-on purchase is on the draft, and offers to take it off", async () => {
    const done = await passOn([1], TITLE);
    expect(done.ok).toBe(true);
    const words = text(draw(<Expenses />));
    expect(words).toContain("Already passed on $86.40 at cost, on their invoices");
    const sheet = text(draw(<PurchaseSheet expense={useDesk.getState().rows.expenses[1]!} onClose={() => undefined} />));
    expect(sheet).toContain("On Marigold Lane’s draft invoice at cost".replace("Marigold Lane", useDesk.getState().rows.clients[2]!.company));
    expect(sheet).toContain("Take it off the draft");
    expect(sheet).not.toContain("Remove this purchase");
  });

  it("says nothing waits when every purchase is passed on or ours", async () => {
    await passOn([1, 2], TITLE);
    const words = text(draw(<Expenses />));
    expect(words).toContain("To put on an invoice $0.00 all passed on");
    expect(words).toContain("Nothing waiting $0.00 All clear");
  });
});

describe("Expenses, what the actions write", () => {
  it("sends a purchase for a project as marked to pass on, the receipt first, the cost as typed", async () => {
    const receipt = new File(["pdf"], "proofs.pdf", { type: "application/pdf" });
    const out = await addPurchase(purchaseInput({ what: "Proof prints, six sheets", amount: "48.00", forWhom: "1", date: "2026-07-27", supplier: "1", receipt }));
    expect(out.ok).toBe(true);
    expect(studio.writes.map((w) => `${w.op} ${w.table}`)).toEqual(["upload expenses", "insert expenses"]);
    expect(studio.writes[1]!.values).toMatchObject({ what: "Proof prints, six sheets", amount: "48.00", project_id: 1, supplier_id: 1, rebill: true, date: "2026-07-27", receipt: "demo-file:proofs.pdf" });
    expect(typeof studio.writes[1]!.values!["client_key"]).toBe("string");
    // The client is Adminium's, copied from the project.
    expect(studio.writes[1]!.values).not.toHaveProperty("client_id");
  });

  it("sends one for nobody as the studio's own, with no project and nothing to pass on", async () => {
    await addPurchase(purchaseInput({ what: "Stamps", amount: "12", forWhom: "ours", date: "2026-07-28", supplier: "", receipt: null }));
    expect(studio.writes.map((w) => `${w.op} ${w.table}`)).toEqual(["insert expenses"]);
    expect(studio.writes[0]!.values).toMatchObject({ project_id: null, client_id: null, rebill: false, supplier_id: null, receipt: null });
  });

  it("passes on: the client's new draft first, then one line per purchase at its stored cost — nothing the page worked out", async () => {
    const out = await passOn([1, 2], TITLE);
    expect(out.ok).toBe(true);
    const writes = studio.writes.filter((w) => w.op === "insert");
    expect(writes.map((w) => w.table)).toEqual(["invoices", "invoice_lines", "invoice_lines"]);
    expect(writes[0]!.values).toMatchObject({ client_id: 2, project_id: 1, title: "Purchases at cost" });
    for (const money of ["subtotal", "tax", "total", "balance", "paid"]) expect(writes[0]!.values).not.toHaveProperty(money);
    expect(writes.slice(1).map((w) => [w.values!["expense_id"], w.values!["description"], w.values!["qty"], w.values!["rate"]])).toEqual([
      [1, "Proof prints, twelve sheets", "1", "86.40"],
      [2, "Courier, samples to Cleo", "1", "24.00"],
    ]);
    for (const w of writes.slice(1)) expect(w.values).not.toHaveProperty("amount");
    const keys = writes.map((w) => w.values!["client_key"]);
    expect(new Set(keys).size).toBe(3);
    // The draft's totals are Adminium's, read back.
    const draft = tableOf(studio, "invoices").find((i) => i["id"] === writes[1]!.values!["document_id"])!;
    expect(draft).toMatchObject({ status: "draft", subtotal: "110.40" });
    if (!out.ok) return;
    const words = passedOnWords(out.value, [1, 2].map((id) => useDesk.getState().rows.expenses[id]!), useDesk.getState().rows.clients);
    expect(words).toMatchObject({ key: "expenses.passed.one", amount: "110.40", company: useDesk.getState().rows.clients[2]!.company });
  });

  it("pressed again, adds nothing twice and says so", async () => {
    await passOn([1, 2], TITLE);
    const before = studio.writes.length;
    const again = await passOn([1, 2], TITLE);
    expect(studio.writes.slice(before).filter((w) => w.op === "insert")).toEqual([]);
    if (!again.ok) throw new Error("refused");
    expect(passedOnWords(again.value, [], {}).key).toBe("expenses.passed.already");
  });

  it("finishes a pass on that stopped half-way under the same keys, with no second draft", async () => {
    studio.failWrite(2, "after");
    const first = await passOn([1, 2], TITLE);
    expect(first.ok).toBe(false);
    if (first.ok || first.unfinished === null) throw new Error("expected an unfinished pass on");
    const finished = await first.unfinished.resume();
    expect(finished.ok).toBe(true);
    const lines = tableOf(studio, "invoice_lines").filter((l) => l["expense_id"] === 1 || l["expense_id"] === 2);
    expect(lines).toHaveLength(2);
    expect(tableOf(studio, "invoices").filter((i) => i["title"] === "Purchases at cost")).toHaveLength(1);
  });

  it("words the refusals: on an invoice, a day still to come, a cost of nothing", async () => {
    await passOn([2], TITLE);
    const refused = await removePurchase(2);
    if (refused.ok) throw new Error("expected a refusal");
    expect(refusalWords(refused, t as never)).toBe(t("expenses.refused.onInvoice"));
    const zero = await addPurchase(purchaseInput({ what: "Stamps", amount: "0", forWhom: "ours", date: "2026-07-28", supplier: "", receipt: null }));
    if (zero.ok) throw new Error("expected a refusal");
    expect(refusalWords(zero, t as never)).toBe(t("expenses.form.needCost"));
    // Adminium refuses a day still to come on the column (the test studio's stand-in does not).
    const future = refusalOf(new SinkError("date", "refused", 422, "VALIDATION_FAILED", "date"));
    if (future.ok) throw new Error("expected a refusal");
    expect(refusalWords(future, t as never)).toBe(t("expenses.form.futureDate"));
  });
});

describe("the purchase form, before anything is sent", () => {
  it("asks for a day, and refuses one still to come", () => {
    expect(dayProblem("", "2026-07-28")).toBe("expenses.form.needDate");
    expect(dayProblem("2026-07-29", "2026-07-28")).toBe("expenses.form.futureDate");
    expect(dayProblem("2026-07-28", "2026-07-28")).toBeNull();
    expect(dayProblem("2026-03-09", "2026-07-28")).toBeNull();
  });
});

describe("Suppliers, drawn", () => {
  it("adds up this year's spend through them, the biggest, and the never used", () => {
    const words = text(draw(<Suppliers />));
    expect(words).toContain("Spent through suppliers $110.40 across 2 of 2 names, this year");
    expect(words).toContain("Biggest Kestrel Press $86.40 · print");
    expect(words).toContain("Never used 0");
    expect(words).toContain("$110.40 · 2026 so far");
  });

  it("opens the first name: who to ask for, copy and email, what we bought, would use again", () => {
    const html = draw(<Suppliers />);
    const words = text(html);
    expect(words).toContain("Kestrel Press Print · SUP-01");
    expect(words).toContain("Ask for Ray Kestrel");
    expect(words).toContain("Copy email");
    expect(html).toContain('href="mailto:ray@kestrelpress.example"');
    // No address on file: nothing to copy.
    expect(words).not.toContain("Copy address");
    expect(html).toMatch(/aria-pressed="true"[^>]*>.*Would use again/);
    expect(words).toContain("What we bought $86.40 through them this year");
    expect(words).toContain("Proof prints, twelve sheets");
    expect(words).toContain("To pass on");
    expect(words).toContain("1 purchase");
  });
});
