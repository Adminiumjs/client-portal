/**
 * The scoping worksheet: a CALCULATOR. Nothing on it is stored — not the
 * rows, not the expenses, not the contingency — until "Turn this into a
 * proposal", which saves one proposal draft and its lines (the composer's own
 * save), and the studio carries on in the composer.
 *
 * The figures come from the studio's own rows: the rate card's amounts and
 * the hours each stands for (`rates.hours_per_unit`), the hours in a working
 * day (`settings.hours_per_day`), the days each person works a week
 * (`people.days_per_week`, else the studio's), what it costs to open the door
 * each month (`running_costs`), and how the last stages actually went — each
 * finished milestone's estimated days against the hours logged on it. They
 * are an estimate to price with: every figure the proposal then carries
 * (amounts, tax, totals) is Adminium's, worked out when the lines are saved.
 */
import type { Day, Id, Milestone, Person, ProposalSplit, Rate, RunningCost, Settings, TermsVersion, TimeEntry } from "../data/types.ts";
import { addDays } from "../data/venueTime.ts";
import { today } from "../lib/clock.ts";
import { saveProposal, type LineInput, type ProposalDraft } from "./actions.ts";
import { rowsOf, useDesk } from "./desk.ts";
import { invalid } from "./officeWrites.ts";
import type { Outcome } from "./outcome.ts";
import type { Proposal } from "../data/types.ts";

export interface WorksheetRow {
  rateId: Id;
  /** How many of the rate, as typed ("6", "0.5"). */
  qty: string;
}

export interface WorksheetExpense {
  what: string;
  /** Decimal text. */
  amount: string;
  /** Passed on at cost (on the proposal), or the studio's to carry (not). */
  passOn: boolean;
}

export interface Worksheet {
  clientId: Id | null;
  /** The stage being priced: the proposal's title. */
  stage: string;
  rows: WorksheetRow[];
  expenses: WorksheetExpense[];
  /** Hold time in reserve, by how far past stages ran over their estimates. */
  contingency: boolean;
  split: ProposalSplit;
}

/** What the worksheet reads: the studio's rows, as the desk holds them. */
export interface WorksheetInputs {
  rates: readonly Rate[];
  settings: Pick<Settings, "hours_per_day" | "days_per_week"> | null;
  people: readonly Pick<Person, "days_per_week">[];
  runningCosts: readonly Pick<RunningCost, "monthly_amount">[];
  /** Finished milestones and the time logged on them (the history card). */
  milestones: readonly Pick<Milestone, "id" | "state" | "estimated_days" | "title" | "project_id">[];
  time: readonly Pick<TimeEntry, "milestone_id" | "hours">[];
  /** The client's own tax rate, else the add-on's default, as decimal text (display only). */
  taxRate: string | null;
}

export interface PastStage {
  milestoneId: Id;
  projectId: Id;
  title: string;
  quotedDays: number;
  actualDays: number;
}

export interface WorksheetFigures {
  rows: { rateId: Id; label: string; qty: number; amount: number; hours: number | null }[];
  fees: number;
  /** Hours the rows stand for (rows whose rate has none are left out). */
  hours: number;
  days: number;
  expensesAtCost: number;
  expensesCarried: number;
  past: PastStage[];
  /** How far past stages ran over, on average (0.15 = 15 % over); null with no history. */
  drift: number | null;
  contingency: number;
  price: number;
  tax: number;
  priceWithTax: number;
  /** Studio days a week: each person's, else the studio's. */
  studioDaysAWeek: number;
  weeks: number | null;
  /** What a day of the studio earns at this price. */
  dayRate: number | null;
  /** Months of running costs the price covers. */
  monthsCovered: number | null;
  /** Each payment of the split, of the price with tax. */
  stages: number[];
}

/** The split's shares, in order. */
export const SPLIT_SHARES: Readonly<Record<ProposalSplit, readonly number[]>> = {
  "5050": [0.5, 0.5],
  "403030": [0.4, 0.3, 0.3],
  end: [1],
};

const num = (text: string | null | undefined): number => {
  const n = Number((text ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const cents = (n: number): number => Math.round(n * 100) / 100;

/** The history card: each finished milestone with an estimate, against the hours logged on it. */
export function pastStages(inputs: Pick<WorksheetInputs, "milestones" | "time" | "settings">): PastStage[] {
  const hoursPerDay = inputs.settings?.hours_per_day ?? 6;
  return inputs.milestones
    .filter((m) => m.state === "done" && num(m.estimated_days) > 0)
    .map((m) => {
      const hours = inputs.time.filter((t) => t.milestone_id === m.id).reduce((sum, t) => sum + num(t.hours), 0);
      return { milestoneId: m.id, projectId: m.project_id, title: m.title, quotedDays: num(m.estimated_days), actualDays: Math.round((hours / hoursPerDay) * 100) / 100 };
    })
    .filter((p) => p.actualDays > 0);
}

/** Everything the worksheet shows, worked out from the sheet and the studio's rows. */
export function workSheet(sheet: Worksheet, inputs: WorksheetInputs): WorksheetFigures {
  const hoursPerDay = inputs.settings?.hours_per_day ?? 6;
  const rows = sheet.rows.flatMap((row) => {
    const rate = inputs.rates.find((r) => r.id === row.rateId);
    if (rate === undefined) return [];
    const qty = num(row.qty);
    const perUnit = rate.hours_per_unit === null ? null : num(rate.hours_per_unit);
    return [{ rateId: rate.id, label: rate.label, qty, amount: cents(qty * num(rate.amount)), hours: perUnit === null ? null : qty * perUnit }];
  });
  const fees = cents(rows.reduce((sum, r) => sum + r.amount, 0));
  const hours = rows.reduce((sum, r) => sum + (r.hours ?? 0), 0);
  const days = Math.round((hours / hoursPerDay) * 100) / 100;
  const expensesAtCost = cents(sheet.expenses.filter((e) => e.passOn).reduce((sum, e) => sum + num(e.amount), 0));
  const expensesCarried = cents(sheet.expenses.filter((e) => !e.passOn).reduce((sum, e) => sum + num(e.amount), 0));
  const past = pastStages(inputs);
  const drift = past.length === 0 ? null : Math.round((past.reduce((sum, p) => sum + p.actualDays / p.quotedDays, 0) / past.length - 1) * 100) / 100;
  const contingency = sheet.contingency && drift !== null && drift > 0 ? cents(fees * drift) : 0;
  const price = cents(fees + contingency + expensesAtCost);
  const tax = cents((price * num(inputs.taxRate)) / 100);
  const priceWithTax = cents(price + tax);
  const studioDaysAWeek = inputs.people.reduce((sum, p) => sum + (p.days_per_week ?? inputs.settings?.days_per_week ?? 5), 0);
  const costs = inputs.runningCosts.reduce((sum, c) => sum + num(c.monthly_amount), 0);
  const shares = SPLIT_SHARES[sheet.split];
  const stages = shares.map((share, i) => (i === shares.length - 1 ? cents(priceWithTax - shares.slice(0, -1).reduce((s, x) => s + cents(priceWithTax * x), 0)) : cents(priceWithTax * share)));
  return {
    rows,
    fees,
    hours,
    days,
    expensesAtCost,
    expensesCarried,
    past,
    drift,
    contingency,
    price,
    tax,
    priceWithTax,
    studioDaysAWeek,
    weeks: studioDaysAWeek > 0 && days > 0 ? Math.round((days / studioDaysAWeek) * 10) / 10 : null,
    dayRate: days > 0 ? cents((fees + contingency) / days) : null,
    monthsCovered: costs > 0 ? Math.round((price / costs) * 10) / 10 : null,
    stages,
  };
}

/** The terms a new proposal names: the version in force (the newest of them). */
export function termsInForce(versions: readonly TermsVersion[]): TermsVersion | null {
  return [...versions].filter((v) => v.status === "in_force").sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
}

export interface TurnInput {
  /** The line that holds the contingency, in the studio's words ("Time held in reserve for this stage"). */
  contingencyWords: string;
  /** How long the proposal holds: three weeks from today unless said. */
  validUntil?: Day;
}

/**
 * Turn this into a proposal: ONE proposal draft for the client, titled with
 * the stage, with a line per rate row (the rate's words, how many, its
 * amount), the contingency as a line of its own, and the expenses passed on
 * at cost — never marked up. It names the terms in force, holds three weeks,
 * and is paid in the sheet's split. Before this, nothing was stored.
 */
export function turnIntoProposal(sheet: Worksheet, inputs: WorksheetInputs, words: TurnInput): Promise<Outcome<Proposal>> {
  if (sheet.clientId === null) return Promise.resolve(invalid("CLIENT_REQUIRED", "client_id"));
  if (sheet.stage.trim() === "") return Promise.resolve(invalid("TITLE_REQUIRED", "stage"));
  const figures = workSheet(sheet, inputs);
  const lines: LineInput[] = [];
  for (const row of sheet.rows) {
    const rate = inputs.rates.find((r) => r.id === row.rateId);
    if (rate === undefined || num(row.qty) <= 0) continue;
    lines.push({ description: rate.label, qty: row.qty.trim(), rate: rate.amount });
  }
  if (figures.contingency > 0) lines.push({ description: words.contingencyWords, qty: "1", rate: figures.contingency.toFixed(2) });
  for (const expense of sheet.expenses) {
    if (!expense.passOn || num(expense.amount) <= 0 || expense.what.trim() === "") continue;
    lines.push({ description: expense.what.trim(), qty: "1", rate: expense.amount.trim() });
  }
  if (lines.length === 0) return Promise.resolve(invalid("NOTHING_TO_PRICE", "rows"));
  const draft: ProposalDraft = {
    id: null,
    client: { id: sheet.clientId },
    title: sheet.stage.trim(),
    scope: null,
    split: sheet.split,
    valid_until: words.validUntil ?? addDays(today(), 21),
    terms_version_id: termsInForce(rowsOf(useDesk.getState(), "terms_versions"))?.id ?? null,
    lines,
  };
  return saveProposal(draft);
}
