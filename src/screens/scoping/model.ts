/**
 * The scoping worksheet's own arithmetic for the page: how the sheet is
 * edited (a rate tapped on, a quantity stepped or typed, an expense line
 * added or switched between "at cost" and "we carry it"), and the running
 * estimate it shows around the figures `state/scoping.ts` works out — the
 * hours with the reserve on, the effective day rate, the studio's week, the
 * tax rate the estimate uses, the split's payments.
 *
 * Everything here is display: the worksheet stores nothing, and the one
 * thing it saves (a proposal draft) carries only the rate card's own rates
 * and quantities, so every stored amount is Adminium's.
 */
import type { Client, Decimal, Id, Person, ProposalSplit, Rate, Settings } from "../../data/types.ts";
import type { MessageKey } from "../../i18n/messages/index.ts";
import type { PastStage, Worksheet, WorksheetFigures } from "../../state/scoping.ts";

/** A sheet with nothing on it: no client, no stage, no rows, paid half and half. */
export const EMPTY_SHEET: Worksheet = { clientId: null, stage: "", rows: [], expenses: [], contingency: false, split: "5050" };

/** The splits, in the order the chips show them. */
export const SPLITS: readonly ProposalSplit[] = ["5050", "403030", "end"];

/** Past this many clients, "For" is a list to pick from rather than a row of chips. */
export const CHIP_LIMIT = 8;

const num = (text: string | number | null | undefined): number => {
  if (typeof text === "number") return Number.isFinite(text) ? text : 0;
  const n = Number((text ?? "").trim().replace(",", "."));
  return Number.isFinite(n) ? n : 0;
};
const round = (n: number, places: number): number => Math.round(n * 10 ** places) / 10 ** places;

// ── editing the sheet ───────────────────────────────────────────────────────

/** A number as typed: digits and one decimal point (a comma read as one), at most `places` after it. */
export function typedNumber(text: string, places: number): string {
  const cleaned = text.replace(/,/g, ".").replace(/[^0-9.]/g, "");
  const at = cleaned.indexOf(".");
  if (at < 0) return cleaned;
  return `${cleaned.slice(0, at + 1)}${cleaned.slice(at + 1).replace(/\./g, "").slice(0, places)}`;
}

/** A quantity to thousandths, as a line keeps it. */
export const typedQty = (text: string): string => typedNumber(text, 3);
/** An amount to cents. */
export const typedAmount = (text: string): string => typedNumber(text, 2);

/** Tap a rate on the card: one more of it when it is on the sheet already, else a row of one. */
export function addRate(sheet: Worksheet, rateId: Id): Worksheet {
  const at = sheet.rows.findIndex((r) => r.rateId === rateId);
  if (at < 0) return { ...sheet, rows: [...sheet.rows, { rateId, qty: "1" }] };
  return { ...sheet, rows: sheet.rows.map((r, i) => (i === at ? { ...r, qty: String(round(num(r.qty) + 1, 3)) } : r)) };
}

/** One more or one fewer of a row (never below nothing). */
export function stepRow(sheet: Worksheet, index: number, delta: 1 | -1): Worksheet {
  return { ...sheet, rows: sheet.rows.map((r, i) => (i === index ? { ...r, qty: String(Math.max(0, round(num(r.qty) + delta, 3))) } : r)) };
}

export function typeRow(sheet: Worksheet, index: number, text: string): Worksheet {
  return { ...sheet, rows: sheet.rows.map((r, i) => (i === index ? { ...r, qty: typedQty(text) } : r)) };
}

export function dropRow(sheet: Worksheet, index: number): Worksheet {
  return { ...sheet, rows: sheet.rows.filter((_, i) => i !== index) };
}

/** A new expense line, passed on at cost until said otherwise. */
export function addExpense(sheet: Worksheet): Worksheet {
  return { ...sheet, expenses: [...sheet.expenses, { what: "", amount: "", passOn: true }] };
}

export function editExpense(sheet: Worksheet, index: number, patch: { what?: string; amount?: string; passOn?: boolean }): Worksheet {
  const clean = patch.amount === undefined ? patch : { ...patch, amount: typedAmount(patch.amount) };
  return { ...sheet, expenses: sheet.expenses.map((e, i) => (i === index ? { ...e, ...clean } : e)) };
}

export function dropExpense(sheet: Worksheet, index: number): Worksheet {
  return { ...sheet, expenses: sheet.expenses.filter((_, i) => i !== index) };
}

/** "Start the sheet again": the rows, the expenses and the stage go; who it is for, the reserve and the split stay. */
export function startAgain(sheet: Worksheet): Worksheet {
  return { ...sheet, stage: "", rows: [], expenses: [] };
}

// ── what the page shows ─────────────────────────────────────────────────────

/** An amount of time as the page words it: minutes under a tenth of an hour, else hours to one place. */
export function hoursWords(hours: number): { key: "scoping.hours.min" | "scoping.hours.h"; n: number } {
  const v = round(hours, 2);
  return v < 0.1 ? { key: "scoping.hours.min", n: Math.round(v * 60) } : { key: "scoping.hours.h", n: round(v, 1) };
}

/** How far over its estimate one past stage ran, in whole percent (negative: under). */
export const overPct = (p: Pick<PastStage, "quotedDays" | "actualDays">): number => Math.round((p.actualDays / p.quotedDays - 1) * 100);

/** Its colour: well over, a little over, or on or under. */
export const overTone = (pct: number): "danger" | "warn" | "pos" => (pct > 15 ? "danger" : pct > 0 ? "warn" : "pos");

/** The history's pill: more than five percent over is worth a warning. */
export const driftTone = (drift: number): "warn" | "pos" => (drift > 0.05 ? "warn" : "pos");

export const driftPct = (drift: number): number => Math.round(drift * 100);

/**
 * The time the page shows: the sheet's hours, with the reserve's share on top
 * when the contingency is on (the reserve holds back time, as well as money),
 * in the studio's working days, and what a day of it earns.
 */
export interface Shown {
  /** The sheet's hours and days, before any reserve. */
  hours: number;
  days: number;
  /** With the reserve on top, when it is on. */
  withReserve: { hours: number; days: number };
  /** The reserve's hours, when it is on. */
  reserveHours: number;
  /** Days if history is right: the sheet's days and the drift on top. */
  budgetDays: number | null;
  /** What a day earns at this price (fees and reserve over the days); null with no days. */
  dayRate: number | null;
  /** Weeks of the studio's calendar the stage fills; null with no days or no week. */
  weeks: number | null;
}

export function shown(figures: WorksheetFigures, hoursPerDay: number | null | undefined): Shown {
  const perDay = hoursPerDay !== null && hoursPerDay !== undefined && hoursPerDay > 0 ? hoursPerDay : 6;
  const drift = figures.drift ?? 0;
  const on = figures.contingency > 0;
  const reserveHours = on ? figures.hours * drift : 0;
  const withHours = figures.hours + reserveHours;
  const withDays = withHours / perDay;
  return {
    hours: figures.hours,
    days: figures.hours / perDay,
    withReserve: { hours: withHours, days: withDays },
    reserveHours,
    budgetDays: figures.drift === null ? null : (figures.hours / perDay) * (1 + figures.drift),
    dayRate: withDays > 0 ? round((figures.fees + figures.contingency) / withDays, 2) : null,
    weeks: withDays > 0 && figures.studioDaysAWeek > 0 ? round(withDays / figures.studioDaysAWeek, 1) : null,
  };
}

/** How the studio's week is put: one person; everyone on the same days; or a total between people on different days. */
export type StudioWeek =
  | { kind: "none" }
  | { kind: "one"; each: number; total: number }
  | { kind: "same"; people: number; each: number; total: number }
  | { kind: "mixed"; people: number; total: number };

export function studioWeek(people: readonly Pick<Person, "days_per_week">[], settings: Pick<Settings, "days_per_week"> | null): StudioWeek {
  const days = people.map((p) => p.days_per_week ?? settings?.days_per_week ?? 5);
  const total = days.reduce((a, b) => a + b, 0);
  if (days.length === 0 || total <= 0) return { kind: "none" };
  if (days.length === 1) return { kind: "one", each: days[0]!, total };
  if (days.every((d) => d === days[0])) return { kind: "same", people: days.length, each: days[0]!, total };
  return { kind: "mixed", people: days.length, total };
}

/** Whether the effective day rate falls short of the card's (a dollar's grace). */
export const thinRate = (effective: number | null, card: Rate | null): boolean => effective !== null && card !== null && effective < num(card.amount) - 1;

/**
 * The tax rate the estimate uses — the client's own, else the Invoices &
 * Receipts add-on's default, else the rate on the studio's latest document
 * for a client with none of their own — and the tax's name. Display only:
 * the proposal's tax is Adminium's.
 */
export function estimateTax(
  client: Pick<Client, "tax_rate"> | undefined,
  addOn: Record<string, unknown> | null,
  docs: readonly { id: Id; tax_rate: Decimal | null; tax_name: string | null; client_id: Id }[],
  clients: Readonly<Record<Id, Pick<Client, "tax_rate"> | undefined>>,
): { rate: string | null; name: string | null } {
  const text = (value: unknown): string | null => (typeof value === "number" ? String(value) : typeof value === "string" && value.trim() !== "" ? value.trim() : null);
  const newest = [...docs].filter((d) => d.tax_rate !== null).sort((a, b) => b.id - a.id);
  const name = text(addOn?.["tax_name"]) ?? newest[0]?.tax_name ?? null;
  if (client !== undefined && client.tax_rate !== null) return { rate: client.tax_rate, name };
  const fallback = text(addOn?.["default_tax_rate"]) ?? newest.find((d) => clients[d.client_id]?.tax_rate === null)?.tax_rate ?? null;
  return { rate: fallback, name };
}

/** Each payment of a split, with the words for when it falls due. */
export const SPLIT_PARTS: Readonly<Record<ProposalSplit, readonly { share: number; when: MessageKey }[]>> = {
  "5050": [
    { share: 50, when: "scoping.part.startFirst" },
    { share: 50, when: "scoping.part.deliveryStage" },
  ],
  "403030": [
    { share: 40, when: "scoping.part.start" },
    { share: 30, when: "scoping.part.halfway" },
    { share: 30, when: "scoping.part.delivery" },
  ],
  end: [{ share: 100, when: "scoping.part.lands" }],
};

/** A refusal from "Turn this into a proposal", in the worksheet's own words where it has them. */
export function refusedWords(code: string | null | undefined): MessageKey | null {
  switch (code) {
    case "CLIENT_REQUIRED":
      return "scoping.refused.client";
    case "TITLE_REQUIRED":
      return "scoping.refused.stage";
    case "NOTHING_TO_PRICE":
      return "scoping.refused.empty";
    default:
      return null;
  }
}

/** One decimal place, as the page rounds days and weeks. */
export const oneDecimal = (n: number): number => round(n, 1);
