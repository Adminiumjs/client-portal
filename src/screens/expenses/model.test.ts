/**
 * What Expenses and Suppliers show for the sample at its moment (10:00 on
 * Tuesday 28 July 2026, the studio in New York), worked out by the screens'
 * own functions over the sample's rows — and how a purchase stands.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { normaliseAll } from "../../data/rows.ts";
import { resolveSample, type SampleBundleRows } from "../../data/sampleRows.ts";
import type { Expense, Invoice, InvoiceLine, Supplier } from "../../data/types.ts";
import { barPercent, bookFigures, postalAddress } from "../suppliers/model.ts";
import { carriersOf, carrierState, expenseFigures, inFilter, newestFirst, openProjects, passable, standingOf } from "./model.ts";

const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;
const resolved = resolveSample(bundle, { now: Date.parse("2026-07-28T14:00:00Z"), zone: "America/New_York", locale: "en-US", currency: "USD" });
// As the desk reads them: decimals as the server's digits, days as days.
const rows = Object.fromEntries(Object.entries(resolved).map(([ref, list]) => [ref, normaliseAll(ref as never, list as never)])) as Record<string, unknown[]>;
const expenses = rows["expenses"] as unknown as Expense[];
const suppliers = rows["suppliers"] as unknown as Supplier[];
const lines = rows["invoice_lines"] as unknown as InvoiceLine[];
const invoices = Object.fromEntries((rows["invoices"] as unknown as Invoice[]).map((i) => [i.id, i]));
const carriers = carriersOf(lines, invoices);
const number = (id: number) => expenses.find((e) => e.id === id)?.number;

describe("Expenses at 28 July", () => {
  it("shows $762.90 to put on an invoice (5), $300.00 passed on (1), $29.00 ours (1), 7 in all", () => {
    const f = expenseFigures(expenses, carriers);
    expect([f["to-pass-on"].sum, f["to-pass-on"].count]).toEqual(["762.90", 5]);
    expect([f["passed-on"].sum, f["passed-on"].count]).toEqual(["300.00", 1]);
    expect([f.ours.sum, f.ours.count]).toEqual(["29.00", 1]);
    expect(f.all.count).toBe(7);
  });

  it("knows the print check went on INV-S2031, a sent invoice whose line is locked", () => {
    const passed = expenses.filter((e) => standingOf(e, carriers) === "passed-on");
    expect(passed.map((e) => e.number)).toEqual(["EX-S040"]);
    const carrier = carriers.get(passed[0]!.id);
    expect(carrier?.invoice?.number).toBe("INV-S2031");
    expect(carrierState(carrier)).toBe("locked");
  });

  it("lists newest first, and 'Pass on' takes the five waiting — never the studio's own, never one already on a line", () => {
    expect([...expenses].sort(newestFirst).map((e) => e.number)).toEqual(["EX-S046", "EX-S045", "EX-S044", "EX-S043", "EX-S042", "EX-S041", "EX-S040"]);
    expect(passable(expenses, carriers).map((e) => number(e.id))).toEqual(["EX-S046", "EX-S045", "EX-S044", "EX-S043", "EX-S041"]);
    expect(expenses.filter((e) => inFilter("ours", e, carriers)).map((e) => e.number)).toEqual(["EX-S042"]);
  });

  it("offers every project not done for a purchase", () => {
    const projects = rows["projects"] as unknown as { id: number; status: string }[];
    expect(openProjects(projects).every((p) => p.status !== "done")).toBe(true);
    expect(openProjects(projects).length).toBe(projects.filter((p) => p.status !== "done").length);
  });
});

describe("Suppliers at 28 July", () => {
  const book = [...suppliers].sort((a, b) => a.id - b.id);
  const f = bookFigures(book, expenses, "2026-07-28");
  const spend = (name: string) => [...f.bySupplier.values()].find((s) => s.supplier.name === name)!.spend;

  it("spent $1,091.90 through 6 of 7 names this year; Bell Type Foundry the biggest at $420.00; 1 never used", () => {
    expect([f.total, f.used, book.length, f.never]).toEqual(["1091.90", 6, 7, 1]);
    expect([f.biggest?.supplier.name, f.biggest?.spend]).toEqual(["Bell Type Foundry", "420.00"]);
  });

  it("puts $386.40 through Kestrel Press, $420.00 through Bell, nothing through Pike & Vane", () => {
    expect([spend("Kestrel Press"), spend("Bell Type Foundry"), spend("Pike & Vane")]).toEqual(["386.40", "420.00", "0.00"]);
  });

  it("draws where the money went by kind, most first, with the kinds in the book's order", () => {
    expect(f.byKind.map((k) => [k.kind, k.spend])).toEqual([
      ["fonts", "600.00"],
      ["print", "386.40"],
      ["paper", "52.50"],
      ["software", "29.00"],
      ["courier", "24.00"],
      ["signage", "0.00"],
    ]);
    expect(f.kinds.map((k) => [k.kind, k.count])).toEqual([
      ["print", 1],
      ["signage", 1],
      ["courier", 1],
      ["paper", 1],
      ["fonts", 2],
      ["software", 1],
    ]);
    expect([barPercent("600.00", "600.00"), barPercent("386.40", "600.00"), barPercent("0.00", "600.00")]).toEqual([100, 64, 2]);
  });

  it("counts only this year's purchases as spend, but any purchase as used", () => {
    const next = bookFigures(book, expenses, "2027-01-04");
    expect([next.total, next.used, next.never]).toEqual(["0.00", 0, 1]);
    expect(next.biggest).toBeNull();
  });

  it("copies the name and the postal address as written", () => {
    expect(postalAddress({ name: "Kestrel Press", address: "Unit 7, Kestrel Yard\nPortland, OR 97210" })).toBe("Kestrel Press\nUnit 7, Kestrel Yard\nPortland, OR 97210");
  });
});
