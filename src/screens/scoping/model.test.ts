/**
 * The worksheet's page arithmetic: how the sheet is edited (a rate tapped on
 * twice is one row of two; a quantity never goes below nothing; typing keeps
 * a number a line can hold), how the time and the checks are worded, the tax
 * the estimate uses, and the refusals the page words itself.
 */
import { describe, expect, it } from "vitest";

import type { Rate } from "../../data/types.ts";
import { dayRateOf } from "../../lib/rateCard.ts";
import type { WorksheetFigures } from "../../state/scoping.ts";
import {
  addExpense,
  addRate,
  dropExpense,
  dropRow,
  editExpense,
  EMPTY_SHEET,
  estimateTax,
  hoursWords,
  overPct,
  overTone,
  refusedWords,
  shown,
  SPLIT_PARTS,
  startAgain,
  stepRow,
  studioWeek,
  thinRate,
  typedAmount,
  typedQty,
  typeRow,
} from "./model.ts";

const rate = (id: number, amount: string, hours: string | null): Rate => ({ id, label: `Rate ${String(id)}`, amount, hours_per_unit: hours, position: id, active: true });

describe("editing the sheet", () => {
  it("puts a tapped rate on as a row of one, and a second tap makes it two", () => {
    const once = addRate(EMPTY_SHEET, 7);
    expect(once.rows).toEqual([{ rateId: 7, qty: "1" }]);
    expect(addRate(once, 7).rows).toEqual([{ rateId: 7, qty: "2" }]);
    expect(addRate(once, 8).rows).toEqual([
      { rateId: 7, qty: "1" },
      { rateId: 8, qty: "1" },
    ]);
  });

  it("steps a quantity by one and never below nothing; typing keeps digits and three places", () => {
    const sheet = { ...EMPTY_SHEET, rows: [{ rateId: 1, qty: "0.5" }] };
    expect(stepRow(sheet, 0, 1).rows[0]!.qty).toBe("1.5");
    expect(stepRow(sheet, 0, -1).rows[0]!.qty).toBe("0");
    expect(typeRow(sheet, 0, "1,2505x").rows[0]!.qty).toBe("1.250");
    expect([typedQty("12"), typedQty("3.1.4"), typedQty("abc"), typedAmount("60.999"), typedAmount("€ 1,5")]).toEqual(["12", "3.14", "", "60.99", "1.5"]);
    expect(dropRow(sheet, 0).rows).toEqual([]);
  });

  it("adds an expense at cost, switches it to ours, and takes it off", () => {
    const sheet = addExpense(EMPTY_SHEET);
    expect(sheet.expenses).toEqual([{ what: "", amount: "", passOn: true }]);
    const edited = editExpense(sheet, 0, { what: "Proof prints", amount: "60.5x", passOn: false });
    expect(edited.expenses).toEqual([{ what: "Proof prints", amount: "60.5", passOn: false }]);
    expect(dropExpense(edited, 0).expenses).toEqual([]);
  });

  it("starts again without forgetting who it is for, the reserve or the split", () => {
    const sheet = { clientId: 4, stage: "Mark", rows: [{ rateId: 1, qty: "2" }], expenses: [{ what: "x", amount: "1", passOn: true }], contingency: true, split: "end" as const };
    expect(startAgain(sheet)).toEqual({ clientId: 4, stage: "", rows: [], expenses: [], contingency: true, split: "end" });
  });
});

describe("what the page says", () => {
  it("words time in hours to one place, and minutes under a tenth of an hour", () => {
    expect([hoursWords(39), hoursWords(0.75), hoursWords(0.05)]).toEqual([
      { key: "scoping.hours.h", n: 39 },
      { key: "scoping.hours.h", n: 0.8 },
      { key: "scoping.hours.min", n: 3 },
    ]);
  });

  it("colours a past stage by how far over it ran", () => {
    expect([overPct({ quotedDays: 2, actualDays: 2.33 }), overPct({ quotedDays: 1, actualDays: 0.92 }), overPct({ quotedDays: 4, actualDays: 6 })]).toEqual([17, -8, 50]);
    expect([overTone(50), overTone(10), overTone(0), overTone(-8)]).toEqual(["danger", "warn", "pos", "pos"]);
  });

  it("counts the studio's week from each person's days, else the studio's", () => {
    expect(studioWeek([{ days_per_week: null }, { days_per_week: null }], { days_per_week: 4 })).toEqual({ kind: "same", people: 2, each: 4, total: 8 });
    expect(studioWeek([{ days_per_week: 3 }, { days_per_week: null }], { days_per_week: 4 })).toEqual({ kind: "mixed", people: 2, total: 7 });
    expect(studioWeek([{ days_per_week: 5 }], null)).toEqual({ kind: "one", each: 5, total: 5 });
    expect(studioWeek([], { days_per_week: 4 })).toEqual({ kind: "none" });
  });

  it("holds the effective day rate against the rate that is one working day", () => {
    const rates = [rate(1, "400.00", "3"), rate(2, "750.00", "6"), rate(3, "90.00", null)];
    expect(dayRateOf(rates, 6)?.id).toBe(2);
    // No rate on the card is an eight-hour day: there is no day rate to hold against, and none is guessed.
    expect(dayRateOf(rates, 8)).toBeNull();
    expect([thinRate(700, rates[1]!), thinRate(749.5, rates[1]!), thinRate(null, rates[1]!)]).toEqual([true, false, false]);
  });

  it("adds the reserve's time on top when the contingency is on", () => {
    const f = { hours: 39, fees: 5980, contingency: 119.6, drift: 0.02, studioDaysAWeek: 8 } as WorksheetFigures;
    const v = shown(f, 6);
    expect([v.days, v.reserveHours, v.withReserve.hours, v.budgetDays]).toEqual([6.5, 0.78, 39.78, 6.63]);
    expect([v.dayRate, v.weeks]).toEqual([920, 0.8]);
    const off = shown({ ...f, contingency: 0 }, 6);
    expect([off.withReserve.hours, off.dayRate]).toEqual([39, 920]);
    expect(shown({ ...f, hours: 0, fees: 0, contingency: 0 }, 6).dayRate).toBeNull();
  });

  it("estimates tax at the client's rate, else the add-on's default, else the studio's latest document", () => {
    const docs = [
      { id: 1, tax_rate: "8.5", tax_name: "Sales tax", client_id: 1 },
      { id: 2, tax_rate: "0", tax_name: "Sales tax", client_id: 2 },
    ];
    const clients = { 1: { tax_rate: null }, 2: { tax_rate: "0" } };
    expect(estimateTax({ tax_rate: "20" }, { default_tax_rate: 7 }, docs, clients)).toEqual({ rate: "20", name: "Sales tax" });
    expect(estimateTax({ tax_rate: null }, { default_tax_rate: 7, tax_name: "VAT" }, docs, clients)).toEqual({ rate: "7", name: "VAT" });
    expect(estimateTax(undefined, null, docs, clients)).toEqual({ rate: "8.5", name: "Sales tax" });
    expect(estimateTax(undefined, null, [], {})).toEqual({ rate: null, name: null });
  });

  it("splits into payments that add up to the whole", () => {
    for (const parts of Object.values(SPLIT_PARTS)) expect(parts.reduce((sum, p) => sum + p.share, 0)).toBe(100);
  });

  it("words its own refusals, and leaves the rest to the shared wording", () => {
    expect([refusedWords("CLIENT_REQUIRED"), refusedWords("TITLE_REQUIRED"), refusedWords("NOTHING_TO_PRICE"), refusedWords("RECORD_LOCKED")]).toEqual(["scoping.refused.client", "scoping.refused.stage", "scoping.refused.empty", null]);
  });
});
