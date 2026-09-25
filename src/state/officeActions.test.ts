/**
 * The back office's actions against the test studio: purchases (and passing
 * them on at cost), suppliers, running costs, the studio's dates and the
 * milestones' estimates — what each writes, and what is refused first.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import { useDesk } from "./desk.ts";
import { takeOffDraft } from "./invoiceDrafts.ts";
import * as office from "./officeActions.ts";
import type { Outcome } from "./outcome.ts";

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

const ok = <T,>(outcome: Outcome<T>): T => {
  if (!outcome.ok) throw new Error(`refused: ${outcome.reason} ${outcome.code} ${String(outcome.field)}`);
  return outcome.value;
};
const refusal = <T,>(outcome: Outcome<T>) => (outcome.ok ? null : [outcome.code, outcome.field]);
const trail = () => studio.writes.map((w) => `${w.op} ${w.table}`);
const TITLE = { newTitle: () => "Purchases at cost" };

describe("purchases", () => {
  it("sends the receipt first, then the row naming it; the number and the project's client are Adminium's", async () => {
    const made = ok(
      await office.addPurchase({ what: " Board samples ", amount: "52.5", project_id: 1, supplier_id: 1, rebill: true, receipt: { file: new Blob(["pdf"]), filename: "receipt.pdf" } }),
    );
    expect(trail()).toEqual(["upload expenses", "insert expenses"]);
    expect(studio.writes[1]!.values).toMatchObject({ what: "Board samples", amount: "52.5", project_id: 1, supplier_id: 1, rebill: true, receipt: "demo-file:receipt.pdf", date: "2026-07-28" });
    expect(studio.writes[1]!.values).not.toHaveProperty("client_id");
    expect(made).toMatchObject({ number: "EX-004", client_id: 2, amount: "52.50" });
  });

  it("keeps a client of its own when no project is named", async () => {
    ok(await office.addPurchase({ what: "Type licence", amount: "180", client_id: 4, rebill: true }));
    expect(studio.writes[0]!.values).toMatchObject({ project_id: null, client_id: 4 });
  });

  it("refuses what the form must say first", async () => {
    expect(refusal(await office.addPurchase({ what: " ", amount: "5", rebill: false }))).toEqual(["WHAT_REQUIRED", "what"]);
    expect(refusal(await office.addPurchase({ what: "Stamps", amount: "0", rebill: false }))).toEqual(["AMOUNT_ABOVE_ZERO", "amount"]);
    expect(refusal(await office.addPurchase({ what: "Stamps", amount: "5", rebill: true }))).toEqual(["CLIENT_REQUIRED", "client_id"]);
    expect(studio.writes).toEqual([]);
  });

  it("passes purchases on: one line each, at cost, on the client's draft — once, however it is pressed", async () => {
    const [a, b] = await Promise.all([office.passOn([1, 2, 3], TITLE), office.passOn([1, 2, 3], TITLE)]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    const carried = tableOf(studio, "invoice_lines").filter((l) => l["expense_id"] !== null && l["expense_id"] !== undefined);
    // The studio's own purchase (3) is not passed on.
    expect(carried.map((l) => [l["expense_id"], l["description"], l["qty"], l["rate"]])).toEqual([
      [1, "Proof prints, twelve sheets", "1.000", "86.40"],
      [2, "Courier, samples to Cleo", "1.000", "24.00"],
    ]);
    const draft = tableOf(studio, "invoices").find((i) => i["id"] === carried[0]!["document_id"])!;
    expect(draft).toMatchObject({ status: "draft", client_id: 2, project_id: 1, subtotal: "110.40", title: "Purchases at cost" });
    expect(office.purchaseState(useDesk.getState().rows.expenses[1]!)).toBe("passed-on");
    expect(office.purchaseState(useDesk.getState().rows.expenses[3]!)).toBe("ours");
  });

  it("keeps a passed-on purchase's cost as the line has it, until the line comes off the draft", async () => {
    const passed = ok(await office.passOn([1], TITLE));
    expect(refusal(await office.editPurchase(1, { amount: "90" }))).toEqual(["ALREADY_INVOICED", "amount"]);
    expect(refusal(await office.editPurchase(1, { rebill: false }))).toEqual(["ALREADY_INVOICED", "rebill"]);
    expect(ok(await office.editPurchase(1, { what: "Proof prints, uncoated" })).what).toBe("Proof prints, uncoated");
    ok(await takeOffDraft(passed.lines[0]!.id));
    expect(office.purchaseState(useDesk.getState().rows.expenses[1]!)).toBe("to-pass-on");
    expect(ok(await office.editPurchase(1, { rebill: false })).rebill).toBe(false);
  });

  it("puts a receipt on a purchase after the fact, and cannot remove one a line carries", async () => {
    expect(ok(await office.attachReceipt(3, { file: new Blob(["jpg"]), filename: "library.jpg" })).receipt).toBe("demo-file:library.jpg");
    ok(await office.passOn([2], TITLE));
    expect(refusal(await office.removePurchase(2))).toEqual(["FK_VIOLATION", null]);
    ok(await office.removePurchase(3));
  });
});

describe("suppliers", () => {
  it("adds one (its number is Adminium's) and keeps what the studio wrote", async () => {
    const made = ok(await office.addSupplier({ name: "Coldbrook Paper", kind: "paper", email: " nel@coldbrookpaper.example ", address: "Coldbrook Mill\nPortland", note: "" }));
    expect(made).toMatchObject({ number: "SUP-03", kind: "paper", email: "nel@coldbrookpaper.example", note: null, would_use_again: true });
    expect(ok(await office.editSupplier(made.id, { would_use_again: false, lead_time: "Two days" }))).toMatchObject({ would_use_again: false, lead_time: "Two days" });
    expect(refusal(await office.addSupplier({ name: "  " }))).toEqual(["NAME_REQUIRED", "name"]);
  });

  it("keeps a supplier a purchase names", async () => {
    expect(refusal(await office.removeSupplier(1))).toEqual(["FK_VIOLATION", null]);
  });
});

describe("running costs", () => {
  it("adds and changes one; a cost is a number", async () => {
    const made = ok(await office.addRunningCost({ label: "Accountant", monthly_amount: "340", position: 2 }));
    expect(made).toMatchObject({ label: "Accountant", monthly_amount: "340.00" });
    expect(ok(await office.editRunningCost(made.id, { monthly_amount: "360" })).monthly_amount).toBe("360.00");
    expect(refusal(await office.addRunningCost({ label: "Rent", monthly_amount: "lots" }))).toEqual(["AMOUNT_NOT_A_NUMBER", "monthly_amount"]);
  });
});

describe("the studio's dates", () => {
  it("asks who is away for an away day, and a stretch that ends after it starts", async () => {
    expect(refusal(await office.addStudioDate({ date: "2026-08-10", to_date: "2026-08-12", title: "Nadia away", kind: "away" }))).toEqual(["PERSON_REQUIRED", "person_id"]);
    expect(refusal(await office.addStudioDate({ date: "2026-08-10", to_date: "2026-08-09", title: "Nadia away", kind: "away", person_id: 1 }))).toEqual(["UNTIL_BEFORE_DATE", "to_date"]);
    expect(studio.writes).toEqual([]);
    const away = ok(await office.addStudioDate({ date: "2026-08-10", to_date: "2026-08-12", title: "Nadia away", kind: "away", person_id: 1 }));
    expect(away).toMatchObject({ kind: "away", person_id: 1, to_date: "2026-08-12" });
    expect(ok(await office.addStudioDate({ date: "2026-08-03", title: "Call with Rosa", kind: "call" }))).toMatchObject({ to_date: null, person_id: null });
    // Turning a call into an away day asks who, too.
    const call = tableOf(studio, "events").find((e) => e["title"] === "Call with Rosa")!;
    expect(refusal(await office.editStudioDate(call["id"] as number, { kind: "away" }))).toEqual(["PERSON_REQUIRED", "person_id"]);
  });

  it("reads the dates that touch a stretch, an away week begun before it included", async () => {
    const found = await office.loadStudioDates("2026-08-11", "2026-08-31");
    expect(found.map((e) => e.title)).toEqual(["Tomas away"]);
  });
});

describe("estimated days", () => {
  it("sets and clears a milestone's estimate", async () => {
    expect(ok(await office.setEstimatedDays(3, "2.5")).estimated_days).toBe("2.5");
    expect(ok(await office.setEstimatedDays(3, null)).estimated_days).toBeNull();
    expect(refusal(await office.setEstimatedDays(3, "-1"))).toEqual(["DAYS_ABOVE_ZERO", "estimated_days"]);
  });
});
