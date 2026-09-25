/**
 * The scoping worksheet is a calculator: its figures come from the studio's
 * rows, nothing is written while it is worked, and "Turn this into a
 * proposal" saves one draft with its lines — then nothing more.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Rate } from "../data/types.ts";
import { fakeStudio, tableOf, type FakeStudio } from "../testing/fakeStudio.ts";
import type { Outcome } from "./outcome.ts";
import { pastStages, reserveQty, turnIntoProposal, workSheet, type Worksheet, type WorksheetInputs } from "./scoping.ts";

const rate = (id: number, label: string, amount: string, hours: string | null): Rate => ({ id, label, amount, hours_per_unit: hours, position: id, active: true });

const inputs: WorksheetInputs = {
  rates: [rate(1, "Day rate, design", "750.00", "6"), rate(2, "Half day", "400.00", "3"), rate(3, "Template, each", "90.00", null)],
  settings: { hours_per_day: 6, days_per_week: 4 },
  people: [{ days_per_week: null }, { days_per_week: null }],
  runningCosts: [{ monthly_amount: "1450.00" }, { monthly_amount: "1400.00" }],
  milestones: [
    { id: 1, project_id: 1, title: "Logo direction", state: "done", estimated_days: "2" },
    { id: 2, project_id: 2, title: "Pattern studies", state: "done", estimated_days: "1.5" },
    // Open, or with no estimate: not history.
    { id: 3, project_id: 1, title: "Wordmark", state: "now", estimated_days: "3" },
    { id: 4, project_id: 3, title: "Sleeve grid", state: "done", estimated_days: null },
  ],
  time: [
    { milestone_id: 1, hours: "9.00" },
    { milestone_id: 1, hours: "6.00" },
    { milestone_id: 2, hours: "9.00" },
    { milestone_id: 3, hours: "2.00" },
  ],
  taxRate: "8.5",
};

const sheet: Worksheet = {
  clientId: 4,
  stage: "Podcast identity — mark & wordmark",
  rows: [
    { rateId: 1, qty: "6" },
    { rateId: 2, qty: "1" },
    { rateId: 3, qty: "12" },
  ],
  expenses: [
    { what: "Type licence — two weights", amount: "420", passOn: true },
    { what: "Reference books", amount: "38", passOn: false },
  ],
  contingency: false,
  split: "5050",
};

describe("the worksheet's figures", () => {
  it("prices the rows against the rate card and counts the studio's days by its own hours", () => {
    const f = workSheet(sheet, inputs);
    expect(f.rows.map((r) => [r.label, r.amount, r.hours])).toEqual([
      ["Day rate, design", 4500, 36],
      ["Half day", 400, 3],
      ["Template, each", 1080, null],
    ]);
    expect([f.fees, f.hours, f.days]).toEqual([5980, 39, 6.5]);
    expect([f.expensesAtCost, f.expensesCarried]).toEqual([420, 38]);
    // The price is what the proposal carries: the fees. The licence passed on at cost is not in it.
    expect([f.price, f.tax, f.priceWithTax]).toEqual([5980, 508.3, 6488.3]);
    // Two people at the studio's four days: eight days a week.
    expect([f.studioDaysAWeek, f.weeks, f.dayRate, f.monthsCovered]).toEqual([8, 0.8, 920, 2.1]);
    expect(f.stages).toEqual([3244.15, 3244.15]);
  });

  it("learns from finished stages: estimated days against the hours logged on them", () => {
    expect(pastStages(inputs).map((p) => [p.title, p.quotedDays, p.actualDays])).toEqual([
      ["Logo direction", 2, 2.5],
      ["Pattern studies", 1.5, 1.5],
    ]);
    const f = workSheet({ ...sheet, contingency: true }, inputs);
    // Stages ran 12.5 % over on average; the reserve is that share of the fees.
    expect([f.drift, f.contingency, f.price]).toEqual([0.13, 777.4, 6757.4]);
    // The reserve is held per row, in thousandths of the rate: what the lines will carry.
    expect([reserveQty("6", 0.13), reserveQty("1", 0.13), reserveQty("12", 0.13), reserveQty("0.5", 0.13), reserveQty("1.25", 0.13), reserveQty("3", 0)]).toEqual(["0.78", "0.13", "1.56", "0.065", "0.163", "0"]);
    expect(workSheet({ ...sheet, contingency: true }, { ...inputs, milestones: [] }).contingency).toBe(0);
  });

  it("splits the price into the stages as each stage invoice will read: its share, and the tax on that share", () => {
    // $90 at 8.5 %: 36 + 3.06, then 27 + 2.30 twice (2.295 rounds away from zero) — a cent over the total, as the invoices will be.
    expect(workSheet({ ...sheet, split: "403030", rows: [{ rateId: 3, qty: "1" }], expenses: [] }, inputs).stages).toEqual([39.06, 29.3, 29.3]);
    // $11.07: the first stage is 4.43 and its 0.38 tax — not 40 % of the $12.01 total.
    expect(workSheet({ ...sheet, split: "403030", rows: [{ rateId: 3, qty: "0.123" }], expenses: [] }, inputs).stages).toEqual([4.81, 3.6, 3.6]);
  });
});

describe("turning it into a proposal", () => {
  let studio: FakeStudio;
  beforeEach(async () => {
    studio = await fakeStudio();
  });
  const ok = <T,>(outcome: Outcome<T>): T => {
    if (!outcome.ok) throw new Error(`refused: ${outcome.reason} ${outcome.code}`);
    return outcome.value;
  };

  it("saves one draft for the client with a line per rate and a reserve line per rate — and nothing before", async () => {
    workSheet({ ...sheet, contingency: true }, inputs);
    expect(studio.writes).toEqual([]);
    const proposal = ok(await turnIntoProposal({ ...sheet, contingency: true }, inputs, { contingencyWords: (label) => `Time held in reserve — ${label}` }));
    expect(studio.writes.map((w) => `${w.op} ${w.table}`)).toEqual(["insert proposals", ...Array(6).fill("insert proposal_lines")]);
    expect(studio.writes[0]!.values).toMatchObject({ client_id: 4, title: "Podcast identity — mark & wordmark", split: "5050", valid_until: "2026-08-18", terms_version_id: 3 });
    // Every rate is the card's and every reserve a quantity of it: no amount the browser worked out is sent.
    expect(studio.writes.slice(1).map((w) => [w.values!["description"], w.values!["qty"], w.values!["rate"]])).toEqual([
      ["Day rate, design", "6", "750.00"],
      ["Half day", "1", "400.00"],
      ["Template, each", "12", "90.00"],
      ["Time held in reserve — Day rate, design", "0.78", "750.00"],
      ["Time held in reserve — Half day", "0.13", "400.00"],
      ["Time held in reserve — Template, each", "1.56", "90.00"],
    ]);
    // The expenses stay on the worksheet: they reach the invoice with their receipts.
    expect(studio.writes.some((w) => w.values?.["description"] === "Type licence — two weights")).toBe(false);
    // The totals are Adminium's: 5980 + 585 + 52 + 140.40 — and what the page said, to the cent.
    expect(proposal).toMatchObject({ status: "draft", subtotal: "6757.40" });
    const page = workSheet({ ...sheet, contingency: true }, { ...inputs, taxRate: proposal.tax_rate });
    expect([page.price, page.tax, page.priceWithTax]).toEqual([Number(proposal.subtotal), Number(proposal.tax), Number(proposal.total)]);
    expect(tableOf(studio, "proposals").filter((p) => p["status"] === "draft")).toHaveLength(2);
  });

  it("shows each payment as the stage invoice Adminium will draw from the proposal: its share of the subtotal, and that share's tax", async () => {
    for (const [split, rows] of [["5050", sheet.rows], ["403030", sheet.rows], ["403030", [{ rateId: 3, qty: "0.123" }]]] as const) {
      const worked = { ...sheet, split, rows: [...rows], contingency: true };
      const proposal = ok(await turnIntoProposal(worked, inputs, { contingencyWords: (label) => `Held — ${label}` }));
      const page = workSheet(worked, { ...inputs, taxRate: proposal.tax_rate });
      const drawn: number[] = [];
      for (const pct of split === "5050" ? ["50", "50"] : ["40", "30", "30"]) {
        const invoice = await studio.world.writes.insert("invoices", { client_id: 4, proposal_id: proposal.id, from_quote_id: proposal.id, share_pct: pct, tax_rate: proposal.tax_rate, title: "Stage" });
        await studio.world.writes.insert("invoice_lines", { document_id: invoice.id, quote_id: proposal.id, position: 0, description: "Stage" });
        drawn.push(Number(tableOf(studio, "invoices").find((i) => i["id"] === invoice.id)!["total"]));
      }
      expect(page.stages).toEqual(drawn);
    }
  });

  it("asks for a client and a stage name before saving anything", async () => {
    const noClient = await turnIntoProposal({ ...sheet, clientId: null }, inputs, { contingencyWords: () => "x" });
    const noStage = await turnIntoProposal({ ...sheet, stage: " " }, inputs, { contingencyWords: () => "x" });
    expect([!noClient.ok && noClient.code, !noStage.ok && noStage.code]).toEqual(["CLIENT_REQUIRED", "TITLE_REQUIRED"]);
    expect(studio.writes).toEqual([]);
  });
});
