/**
 * What the Suppliers screen draws, worked out from the stored rows. A purchase
 * names its supplier (`expenses.supplier_id`); everything a supplier shows —
 * what went through them, when they were last used, what for — is read from
 * the purchases that name them.
 *
 *   spend        this calendar year's purchases naming them (the studio's year,
 *                from today on the studio's calendar), added up to show
 *   used         a supplier with a purchase this year
 *   never used   no purchase names them at all
 *   biggest      the most spent this year; none when nothing was spent
 *
 * Sums are for showing only (`sumDecimals`, exact); nothing here is saved.
 */
import type { Decimal, Expense, Id, Supplier, SupplierKind } from "../../data/types.ts";
import { decimalValue, sumDecimals } from "../../lib/money.ts";
import { newestFirst } from "../expenses/model.ts";

/** Every kind a supplier can be, in the order the form offers them. */
export const SUPPLIER_KINDS: readonly SupplierKind[] = ["print", "paper", "signage", "courier", "fonts", "finishing", "photography", "software", "other"];

export interface SupplierFigures {
  supplier: Supplier;
  /** Every purchase naming them, newest first. */
  purchases: Expense[];
  /** This year's purchases naming them, added up. */
  spend: Decimal;
  /** The newest purchase naming them. */
  last: Expense | null;
}

export interface BookFigures {
  year: number;
  bySupplier: Map<Id, SupplierFigures>;
  /** Spent through suppliers this year. */
  total: Decimal;
  /** Suppliers with a purchase this year. */
  used: number;
  /** Suppliers no purchase names. */
  never: number;
  biggest: SupplierFigures | null;
  /** Spend per kind this year, most first (only the kinds some supplier is; a tie keeps the book's order). */
  byKind: { kind: SupplierKind; spend: Decimal }[];
  /** The kinds some supplier is, in the order the book first names them, with how many. */
  kinds: { kind: SupplierKind; count: number }[];
}

export function bookFigures(suppliers: readonly Supplier[], expenses: readonly Expense[], today: string): BookFigures {
  const year = Number(today.slice(0, 4));
  const thisYear = (e: Expense) => e.date.slice(0, 4) === today.slice(0, 4);
  const bySupplier = new Map<Id, SupplierFigures>();
  for (const s of suppliers) {
    const purchases = expenses.filter((e) => e.supplier_id === s.id).sort(newestFirst);
    bySupplier.set(s.id, { supplier: s, purchases, spend: sumDecimals(purchases.filter(thisYear).map((e) => e.amount)), last: purchases[0] ?? null });
  }
  const all = [...bySupplier.values()];
  const value = (d: Decimal) => decimalValue(d) ?? 0;
  const spent = all.filter((f) => value(f.spend) > 0);
  const biggest = spent.length === 0 ? null : spent.reduce((a, b) => (value(b.spend) > value(a.spend) ? b : a));
  // The kinds in the order the book first names them.
  const present = [...new Set(suppliers.map((s) => s.kind))];
  const byKind = present
    .map((kind) => ({ kind, spend: sumDecimals(all.filter((f) => f.supplier.kind === kind).map((f) => f.spend)) }))
    .sort((a, b) => value(b.spend) - value(a.spend) || present.indexOf(a.kind) - present.indexOf(b.kind));
  return {
    year,
    bySupplier,
    total: sumDecimals(all.map((f) => f.spend)),
    used: spent.length,
    never: all.filter((f) => f.purchases.length === 0).length,
    biggest,
    byKind,
    kinds: present.map((kind) => ({ kind, count: suppliers.filter((s) => s.kind === kind).length })),
  };
}

/** A bar's length, in whole percent of the largest (at least 2 so an empty kind still shows a sliver). */
export function barPercent(spend: Decimal, largest: Decimal): number {
  const top = decimalValue(largest) ?? 0;
  const v = decimalValue(spend) ?? 0;
  return top <= 0 ? 2 : Math.max(2, Math.round((v / top) * 100));
}

/** The postal address to copy: the name, then the address as written. */
export const postalAddress = (s: Pick<Supplier, "name" | "address">): string => `${s.name}\n${(s.address ?? "").trim()}`;
