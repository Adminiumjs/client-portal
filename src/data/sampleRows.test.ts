/**
 * THE BROWSER'S SAMPLE LOADER GIVES ADMINIUM'S ANSWERS.
 *
 * `resolveSample()` stands in for Adminium's loader in the website's demo, so
 * each directive is held here to the answer Adminium's own resolver gives
 * (`apps/server/src/apps/sample-data.ts` and its tests): the same days, the
 * same "never later than now", the same language fallback. Then what the
 * loader does once the rows are in: ids in bundle order, the database's
 * defaults, copies through a row's link, and the totals settled last — a
 * line's amount, a document's subtotal, tax and total, an invoice's paid and
 * balance — worked out the way the manifest's formulas say.
 */
import { describe, expect, it } from "vitest";

import { evaluateFormula, type FormulaExpr } from "../testing/manifest/formula.ts";
import { RULES, currencyScale, pickText, resolveSample, workOut, zonedMonthDay, type ResolveOptions } from "./sampleRows.ts";

const NEW_YORK = "America/New_York";
type Rows = Record<string, unknown>[];
const bundle = (...tables: [string, Rows][]) => ({ format: "adminium.sample/1", app: "clients", tables: tables.map(([ref, rows]) => ({ ref, rows })) });
/** One message row's columns, resolved at `now`: a table whose only required column is `kind`. */
function one(values: Record<string, unknown>, options: Partial<ResolveOptions> & { now: number }) {
  const out = resolveSample(bundle(["messages", [{ kind: "handover", ...values }]]), { zone: NEW_YORK, locale: "en-US", ...options });
  return out["messages"]![0]!;
}

describe("a day of a month, from the adding moment", () => {
  // 3 October 2026, 08:00 in New York (12:00 UTC) — Adminium's own example.
  const now = Date.parse("2026-10-03T12:00:00Z");

  it("keeps the day of the month, whatever day it is added on", () => {
    expect(zonedMonthDay(now, NEW_YORK, -2, 14)).toEqual({ y: 2026, m: 8, d: 14, today: false });
    expect(zonedMonthDay(now, NEW_YORK, -9, 20)).toEqual({ y: 2026, m: 1, d: 20, today: false });
    expect(zonedMonthDay(now, NEW_YORK, -10, 20)).toEqual({ y: 2025, m: 12, d: 20, today: false });
  });

  it("takes a short month’s last day, and today for a day not yet come", () => {
    expect(zonedMonthDay(now, NEW_YORK, -1, 31)).toEqual({ y: 2026, m: 9, d: 30, today: false });
    expect(zonedMonthDay(now, NEW_YORK, -8, 30)).toEqual({ y: 2026, m: 2, d: 28, today: false });
    expect(zonedMonthDay(now, NEW_YORK, 0, 2)).toEqual({ y: 2026, m: 10, d: 2, today: false });
    expect(zonedMonthDay(now, NEW_YORK, 0, 3)).toEqual({ y: 2026, m: 10, d: 3, today: true });
    expect(zonedMonthDay(now, NEW_YORK, 0, 28)).toEqual({ y: 2026, m: 10, d: 3, today: true });
  });

  it("counts months on the studio’s calendar, not the computer’s", () => {
    // 1 November 02:00 UTC is still 31 October in New York.
    expect(zonedMonthDay(Date.parse("2026-11-01T02:00:00Z"), NEW_YORK, -1, 15)).toEqual({ y: 2026, m: 9, d: 15, today: false });
  });

  it("writes a date, a wall time, and never a time still to come", () => {
    const row = one(
      {
        due: { "@month": -2, "@dom": 14 },
        sent_at: { "@month": -1, "@dom": 5, "@time": "10:00" },
        effect_at: { "@month": 0, "@dom": 20, "@time": "17:00" },
        error: { "@month": 0, "@dom": 20, "@time": "07:30" },
        subject_override: { "@month": -1, "@dom": 31 },
        body_override: { "@month": 0, "@dom": 28 },
      },
      { now },
    );
    expect(row["due"]).toBe("2026-08-14");
    expect(row["sent_at"]).toBe("2026-09-05T14:00:00.000Z");
    expect(row["effect_at"]).toBe(new Date(now).toISOString());
    expect(row["error"]).toBe("2026-10-03T11:30:00.000Z");
    expect(row["subject_override"]).toBe("2026-09-30");
    expect(row["body_override"]).toBe("2026-10-03");
  });
});

describe("the other directives", () => {
  // Tuesday 28 July 2026, 10:00 in New York.
  const now = Date.parse("2026-07-28T14:00:00Z");

  it("counts days on the studio’s clock, with and without a time", () => {
    const row = one({ due: { "@day": -12 }, sent_at: { "@day": -1, "@time": "16:20" }, subject_override: { "@day": 6 } }, { now });
    expect(row["due"]).toBe("2026-07-16");
    expect(row["sent_at"]).toBe("2026-07-27T20:20:00.000Z");
    expect(row["subject_override"]).toBe("2026-08-03");
  });

  it("counts working days, and starts a weekend’s day 0 on the Monday after", () => {
    expect(one({ due: { "@day": 4, "@workdays": true } }, { now })["due"]).toBe("2026-08-03");
    const saturday = Date.parse("2026-08-01T15:00:00Z");
    expect(one({ due: { "@day": 0, "@workdays": true }, error: { "@day": 1, "@workdays": true } }, { now: saturday })).toMatchObject({ due: "2026-08-03", error: "2026-08-04" });
  });

  it("takes a duration back from now", () => {
    expect(one({ sent_at: { "@ago": "PT4H" }, effect_at: { "@ago": "P1DT30M" } }, { now })).toMatchObject({
      sent_at: "2026-07-28T10:00:00.000Z",
      effect_at: "2026-07-27T13:30:00.000Z",
    });
  });

  it("reads the text in the reader’s language, then the same language, then US English", () => {
    const texts = { "en-US": "Paid", "de-DE": "Bezahlt", "zh-TW": "已付" };
    expect(pickText(texts, "de-DE")).toBe("Bezahlt");
    expect(pickText(texts, "de-AT")).toBe("Bezahlt");
    expect(pickText(texts, "zh_TW")).toBe("已付");
    expect(pickText(texts, "fr-FR")).toBe("Paid");
    expect(one({ subject_override: { "@t": texts } }, { now, locale: "de-DE" })["subject_override"]).toBe("Bezahlt");
  });

  it("merges the set @byClock picks, and leaves a row out when it says to skip", () => {
    const out = resolveSample(
      bundle([
        "messages",
        [
          { kind: "handover", "@byClock": { at: { "@day": 0, "@time": "08:00" }, before: { status: "sent" }, after: { status: "queued" } } },
          { kind: "handover", "@byClock": { at: { "@day": 0, "@time": "10:10" }, around: { status: "held" } } },
          { kind: "handover", "@byClock": { at: { "@day": 0, "@time": "15:00" }, after: { "@skip": true } } },
          { kind: "approved" },
        ],
      ]),
      { now, zone: NEW_YORK, locale: "en-US" },
    );
    expect(out["messages"]!.map((row) => [row["id"], row["kind"], row["status"]])).toEqual([
      [1, "handover", "sent"],
      [2, "handover", "held"],
      [3, "approved", "queued"],
    ]);
  });
});

describe("rows as the loader writes them", () => {
  const now = Date.parse("2026-07-28T14:00:00Z");
  const options: ResolveOptions = { now, zone: NEW_YORK, locale: "en-US", currency: "USD", settings: { "invoices.default_terms": "net14", "invoices.default_ladder": "gentle" } };
  const client = { "@label": "c", company: "Hearth & Loaf", contact_name: "Amara Okafor", email: "amara@hearthandloaf.example", tax_rate: 8.5 };

  it("numbers each table 1, 2, 3 … in bundle order and points a @ref at the labelled row", () => {
    const out = resolveSample(
      bundle(
        ["clients", [client, { "@label": "d", company: "Slow Signal", contact_name: "Theo Marsh", email: "theo@slowsignal.example" }]],
        ["client_notes", [{ client_id: { "@ref": "d" }, body: "One" }, { client_id: { "@ref": "c" }, body: "Two" }]],
      ),
      options,
    );
    expect(out["clients"]!.map((row) => row["id"])).toEqual([1, 2]);
    expect(out["client_notes"]!.map((row) => [row["id"], row["client_id"]])).toEqual([
      [1, 2],
      [2, 1],
    ]);
  });

  it("fills what the database fills: defaults, the adding moment, a setting, and null", () => {
    const out = resolveSample(bundle(["clients", [client]], ["invoices", [{ client_id: { "@ref": "c" } }]]), options);
    const [row] = out["clients"]!;
    expect(row).toMatchObject({ phone: null, terms: null, created_at: new Date(now).toISOString() });
    // The client's tax rate is copied onto the invoice; the add-on's settings fill terms and ladder; the connection the currency.
    expect(out["invoices"]![0]).toMatchObject({ status: "draft", tax_rate: 8.5, terms: "net14", ladder: "gentle", currency: "USD", number_seq: 1, number: null });
  });

  it("refuses a row that leaves out a column with no default, and a column the table lacks", () => {
    expect(() => resolveSample(bundle(["clients", [{ company: "Nameless" }]]), options)).toThrow(/has no "contact_name"/);
    expect(() => resolveSample(bundle(["messages", [{ kind: "handover", colour: "red" }]]), options)).toThrow(/has no column "colour"/);
    expect(() => resolveSample(bundle(["client_notes", [{ client_id: { "@ref": "nobody" }, body: "x" }]]), options)).toThrow(/was not written/);
  });

  it("keeps a numbered row’s own sample number when it spells none for the series", () => {
    const out = resolveSample(bundle(["clients", [client]], ["invoices", [{ client_id: { "@ref": "c" }, number_seq: null, number: "INV-S2041" }]]), options);
    expect(out["invoices"]![0]).toMatchObject({ number_seq: null, number: "INV-S2041" });
  });

  it("settles every total last: lines, subtotal, tax, total, then a stage line and what was paid", () => {
    const out = resolveSample(
      bundle(
        ["clients", [client]],
        ["proposals", [{ "@label": "q", client_id: { "@ref": "c" }, title: "Bakehouse rebrand", currency: "USD", tax_rate: 8.5 }]],
        [
          "proposal_lines",
          [
            { document_id: { "@ref": "q" }, qty: 1, rate: 2600 },
            { document_id: { "@ref": "q" }, qty: 4, rate: 250, discount_kind: "percent", discount: 20 },
            { document_id: { "@ref": "q" }, qty: 2, rate: 200, discount: 100 },
            // An amount off more than the line is worth leaves it at nothing, not below.
            { document_id: { "@ref": "q" }, qty: 1, rate: 50, discount: 80 },
          ],
        ],
        [
          "invoices",
          [
            { "@label": "stage", client_id: { "@ref": "c" }, status: "sent", currency: "USD", tax_rate: 8.5, from_quote_id: { "@ref": "q" }, share_pct: 40 },
            { "@label": "one-off", client_id: { "@ref": "c" }, status: "sent", currency: "USD", tax_rate: 8.5 },
          ],
        ],
        [
          "invoice_lines",
          [
            { document_id: { "@ref": "stage" }, quote_id: { "@ref": "q" } },
            { document_id: { "@ref": "one-off" }, qty: 3, rate: 33.33 },
          ],
        ],
        [
          "payments",
          [
            { document_id: { "@ref": "stage" }, amount: 1000, paid_on: "2026-07-20" },
            { document_id: { "@ref": "stage" }, amount: 500, paid_on: "2026-07-21", voided: true },
            { document_id: { "@ref": "one-off" }, amount: 108.49, paid_on: "2026-07-22" },
          ],
        ],
      ),
      options,
    );
    expect(out["proposal_lines"]!.map((line) => line["amount"])).toEqual([2600, 800, 300, 0]);
    // 3,700 × 8.5 % = 314.50.
    expect(out["proposals"]![0]).toMatchObject({ subtotal: 3700, tax: 314.5, total: 4014.5 });
    // The stage line's rate is the proposal's settled subtotal, its share the invoice's: 40 % of 3,700, taxed once on the invoice.
    expect(out["invoice_lines"]![0]).toMatchObject({ rate: 3700, share_pct: 40, amount: 1480, client_id: 1, currency: "USD" });
    expect(out["invoices"]![0]).toMatchObject({ subtotal: 1480, tax: 125.8, total: 1605.8, paid: 1000, balance: 605.8 });
    // 99.99 × 8.5 % = 8.49915, rounded half away from zero once.
    expect(out["invoices"]![1]).toMatchObject({ subtotal: 99.99, tax: 8.5, total: 108.49, paid: 108.49, balance: 0 });
  });

  it("rounds money to the currency’s own places", () => {
    expect([currencyScale("USD"), currencyScale("JPY"), currencyScale("KWD"), currencyScale(null)]).toEqual([2, 0, 3, 2]);
    const out = resolveSample(
      bundle(
        ["clients", [client]],
        ["proposals", [{ "@label": "q", client_id: { "@ref": "c" }, title: "x", currency: "JPY", tax_rate: 10 }]],
        ["proposal_lines", [{ document_id: { "@ref": "q" }, qty: 3, rate: 1235 }]],
      ),
      options,
    );
    expect(out["proposals"]![0]).toMatchObject({ subtotal: 3705, tax: 371, total: 4076 });
  });
});

describe("the formulas are worked out as the manifest’s own evaluator works them out", () => {
  // Every formula the manifest declares, over rows that reach each branch: an empty rate, a percent, an amount off, a stage line.
  const rows: Record<string, unknown>[] = [
    { qty: 1, rate: 2600, discount_kind: "amount", discount: null, quote_id: null, share_pct: null, subtotal: 5200, tax_rate: 8.5, tax: 442 },
    { qty: "4.000", rate: "250.00", discount_kind: "percent", discount: "20", quote_id: null, subtotal: "99.99", tax_rate: "8.500", tax: "8.50" },
    { qty: 2, rate: 200, discount_kind: "amount", discount: 500, quote_id: null, subtotal: null, tax_rate: null, tax: null },
    { qty: 1, rate: null, discount_kind: "amount", discount: null, quote_id: null, subtotal: 0.005, tax_rate: 100, tax: 0 },
    { qty: 1, rate: 3000, quote_id: 7, share_pct: 50, subtotal: 1500, tax_rate: 8.5, tax: 127.5 },
    { qty: 1, rate: "5000.00", quote_id: 3, share_pct: "40.00", subtotal: 2000, tax_rate: "8.500", tax: 170 },
  ];

  it.each(RULES.formulas.map((formula) => [`${formula.table}.${formula.column}`, formula] as const))("%s", (_, formula) => {
    for (const row of rows) {
      const expected = evaluateFormula(formula.expr as FormulaExpr, row, 2);
      expect(workOut(formula.expr, row, 2), JSON.stringify(row)).toBe(expected === null ? null : Number(expected));
    }
  });
});
