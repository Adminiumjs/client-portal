/**
 * The demo's studio: the app's REAL sample — the very bundle an operator
 * adds from Adminium (`seeds/clients.sample.json`) — resolved at the demo's
 * moment by the same resolver the tests hold to Adminium's
 * (`data/sampleRows.ts`), with the settings of the add-on it needs.
 *
 * The sample's numbers carry an `S` (`INV-S2039`) and no number in the
 * series, so a real studio's first invoice is never one of them; the demo
 * keeps them as they are, and its own new rows take the add-on's series from
 * where the sample leaves off (`INV-2042`, `QUO-1144`, `REC-0019`).
 *
 * DEMO BUILD ONLY.
 */
import bundleJson from "../../seeds/clients.sample.json" with { type: "json" };
import { resolveSample, type ResolvedSample, type SampleBundleRows } from "../data/sampleRows.ts";
import type { TableRef } from "../data/types.ts";

export const DEMO_BUNDLE = bundleJson as unknown as SampleBundleRows;

/** The connection's currency in the demo. */
export const DEMO_CURRENCY = "USD";

/**
 * The Invoices & Receipts add-on's settings, as the demo's studio set them:
 * the add-on's own defaults, with the studio's tax and each series starting
 * after the sample's last number.
 */
export const DEMO_SETTINGS: Readonly<Record<string, unknown>> = {
  "invoices.business_name": "Outline",
  "invoices.business_lines": ["hello@outline.example", "+1 (503) 555-0142", "outline.example"],
  "invoices.tax_label": "Tax",
  "invoices.tax_name": "Sales tax",
  "invoices.default_tax_rate": 8.5,
  "invoices.default_terms": "net14",
  "invoices.default_ladder": "standard",
  "invoices.ladders": { gentle: [7, 21, 45], standard: [3, 14, 30], firm: [1, 7, 21] },
  "invoices.prefix_invoice": "INV-",
  "invoices.prefix_receipt": "REC-",
  "invoices.prefix_quote": "QUO-",
  "invoices.number_start_invoice": 2042,
  "invoices.number_start_receipt": 19,
  "invoices.number_start_quote": 1144,
  "invoices.show_payment_ledger": true,
};

/** A demo source: the sample bundle, read in one language. */
export interface SampleSource {
  sample: SampleBundleRows;
  locale: string;
}

export const demoSample = (locale: string): SampleSource => ({ sample: DEMO_BUNDLE, locale });

export function isSampleSource(value: unknown): value is SampleSource {
  return typeof value === "object" && value !== null && "sample" in value && "locale" in value;
}

/** Every row of the sample as Adminium would have written it at `now`, in `locale`. */
export function resolveDemoSample(source: SampleSource, now: number, zone: string): Partial<Record<TableRef, Record<string, unknown>[]>> {
  const resolved: ResolvedSample = resolveSample(source.sample, { now, zone, locale: source.locale, currency: DEMO_CURRENCY, settings: DEMO_SETTINGS });
  return resolved as Partial<Record<TableRef, Record<string, unknown>[]>>;
}
