/*
 * VENDORED VERBATIM from packages/manifest/src/saved-parts.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * WHAT ONLY A FILE MADE ON AN ADMINIUM CARRIES.
 *
 * A dashboard someone built by hand holds things no catalog app ships: report
 * documents and invoice layouts written in the builders, reports sent on a
 * schedule, and which tables are payable and how. Saved as an app (publisher
 * `local`), they travel in four blocks of their own:
 *
 *  - `reports`: Report Builder documents, by a key of the file's own;
 *  - `invoiceLayouts`: invoice templates (a design, never an issued invoice);
 *  - `scheduledReports`: a page's report on a schedule. Who it goes to never
 *    travels: it arrives switched off with nobody on it, for the owner to choose;
 *  - `payments`: payable tables, the ways to pay and the pay page's plain
 *    settings. Never a key, a bank account or a contact: those are the owner's
 *    to give after the install. Adminium is never a party to a payment.
 *
 * Each block is read only from a file whose publisher is `local`.
 *
 * Pure, and nothing imported from the manifest's own schema file.
 */
import { z } from 'zod';

import { refSchema, type ReferenceIssue, type TableIndex } from './refs.ts';

/** The publisher of a file made on an Adminium. */
const LOCAL = 'local';

export const SAVED_PART_BLOCKS = ['reports', 'invoiceLayouts', 'scheduledReports', 'payments'] as const;

/** The most of each a file carries. */
export const SAVED_REPORTS_MAX = 32;
export const SAVED_INVOICE_LAYOUTS_MAX = 32;
export const SAVED_SCHEDULED_REPORTS_MAX = 32;

/** The largest document body a file carries: the builders' own cap. */
export const SAVED_BODY_MAX_BYTES = 4 * 1024 * 1024;

const partKey = z.string().regex(/^[a-z][a-z0-9-]{0,79}$/, 'a key is kebab-case, at most 80 characters');
const partName = z.string().trim().min(1).max(120);

/** A builder's document, as the builder stores it: checked whole by the server that installs it. */
const bodySchema = z
  .record(z.string(), z.unknown())
  .refine((body) => new TextEncoder().encode(JSON.stringify(body)).length <= SAVED_BODY_MAX_BYTES, { message: 'a document body is at most 4 MiB' });

export const savedReportSchema = z
  .object({
    key: partKey,
    /** A reusable layout, or a report built from one. Default: a report. */
    kind: z.enum(['report', 'template']).optional(),
    name: partName,
    status: z.enum(['draft', 'sent', 'live']).optional(),
    body: bodySchema,
  })
  .strict();
export type SavedReport = z.infer<typeof savedReportSchema>;

export const INVOICE_LAYOUT_TOPICS = ['recurring', 'services', 'receipts', 'sales', 'logistics', 'other'] as const;
export const INVOICE_LAYOUT_LANGS = ['en', 'de', 'fr', 'es', 'pt', 'ja'] as const;

export const savedInvoiceLayoutSchema = z
  .object({
    key: partKey,
    name: partName,
    topic: z.enum(INVOICE_LAYOUT_TOPICS).optional(),
    lang: z.enum(INVOICE_LAYOUT_LANGS).optional(),
    body: bodySchema,
  })
  .strict();
export type SavedInvoiceLayout = z.infer<typeof savedInvoiceLayoutSchema>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const savedScheduledReportSchema = z
  .object({
    key: partKey,
    name: partName,
    /** One of the app's pages, by its ref. */
    page: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a page ref'),
    /** When it goes, in the database's own zone: a file names none. */
    schedule: z
      .object({
        frequency: z.enum(['daily', 'weekly', 'monthly']),
        /** 0 = Sunday; weekly only. */
        dayOfWeek: z.number().int().min(0).max(6).optional(),
        /** Monthly only. */
        dayOfMonth: z.number().int().min(1).max(31).optional(),
        time: z.string().regex(HHMM, 'a time such as 08:00'),
      })
      .strict(),
    format: z.enum(['pdf', 'png']).optional(),
  })
  .strict();
export type SavedScheduledReport = z.infer<typeof savedScheduledReportSchema>;

// ── payments ─────────────────────────────────────────────────────────────────

const currencyCode = z.string().regex(/^[A-Z]{3}$/, 'a currency code such as EUR');

/** How a payment lands in the table's OWN payments table, column by column. */
const ownPaymentsSchema = z
  .object({
    kind: z.literal('table'),
    table: refSchema,
    link: refSchema,
    amount: refSchema,
    date: refSchema,
    method: z.object({ column: refSchema, values: z.record(z.string().min(1).max(64), z.string().min(1).max(255)) }).strict(),
    note: refSchema.optional(),
    voided: refSchema.optional(),
    reference: refSchema,
    refunded: refSchema.optional(),
    amountUnit: z.enum(['units', 'minor']).optional(),
  })
  .strict();

/** Which columns of a payable table say what is owed and how it is paid: the payments screen's mapping, by column refs. */
export const savedPayableSchema = z
  .object({
    table: refSchema,
    label: refSchema.optional(),
    amount: z.object({ column: refSchema, unit: z.enum(['units', 'minor']).optional() }).strict(),
    currency: z.union([z.object({ column: refSchema }).strict(), z.object({ fixed: currencyCode }).strict(), z.object({ connection: z.literal(true) }).strict()]),
    due: z.object({ column: refSchema }).strict().optional(),
    payments: z.union([z.object({ kind: z.literal('kept') }).strict(), ownPaymentsSchema]),
    status: z.object({ column: refSchema, paid: z.string().min(1).max(255), refunded: z.string().min(1).max(255).optional() }).strict().optional(),
    customerEmail: refSchema.optional(),
    customerCountry: refSchema.optional(),
    pageFields: z.array(refSchema).max(50).optional(),
  })
  .strict()
  .refine((payable) => payable.payments.kind === 'kept' || payable.due !== undefined, { message: 'a table that keeps its own payments names its balance column', path: ['due'] });
export type SavedPayable = z.infer<typeof savedPayableSchema>;

/** One way to pay: by hand (`manual`), or a payment service's. Its details (a bank account) never travel. */
export const savedPaymentWaySchema = z
  .object({
    source: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a payment service, or "manual"'),
    method: z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/, 'a way to pay'),
    enabled: z.boolean().optional(),
    label: z.record(z.string().min(2).max(10), z.string().trim().min(1).max(60)).optional(),
    rules: z
      .object({
        countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(250).optional(),
        currencies: z.array(currencyCode).max(200).optional(),
        min: z.string().regex(/^\d+(\.\d+)?$/).optional(),
        max: z.string().regex(/^\d+(\.\d+)?$/).optional(),
      })
      .strict()
      .optional(),
    position: z.number().int().min(0).max(1000).optional(),
  })
  .strict();
export type SavedPaymentWay = z.infer<typeof savedPaymentWaySchema>;

export const savedPaymentsSchema = z
  .object({
    payables: z.array(savedPayableSchema).max(16).optional(),
    ways: z.array(savedPaymentWaySchema).max(32).optional(),
    /** The pay page's plain settings: its name, the shop's country, whether lines are listed. Never a logo or a contact. */
    payPage: z
      .object({ shopName: z.string().trim().min(1).max(120).optional(), shopCountry: z.string().regex(/^[A-Z]{2}$/).optional(), showLines: z.boolean().optional() })
      .strict()
      .optional(),
  })
  .strict();
export type SavedPayments = z.infer<typeof savedPaymentsSchema>;

/** The blocks, spread into the app manifest's own object. */
export const savedPartsShape = {
  reports: z.array(savedReportSchema).max(SAVED_REPORTS_MAX).optional(),
  invoiceLayouts: z.array(savedInvoiceLayoutSchema).max(SAVED_INVOICE_LAYOUTS_MAX).optional(),
  scheduledReports: z.array(savedScheduledReportSchema).max(SAVED_SCHEDULED_REPORTS_MAX).optional(),
  payments: savedPaymentsSchema.optional(),
};

export interface SavedPartsManifest {
  publisher: { id: string };
  pages: readonly { ref: string }[];
  reports?: readonly SavedReport[] | undefined;
  invoiceLayouts?: readonly SavedInvoiceLayout[] | undefined;
  scheduledReports?: readonly SavedScheduledReport[] | undefined;
  payments?: SavedPayments | undefined;
}

/** Two entries of a block that share a key. */
function twiceIssues(block: string, entries: readonly { key: string }[]): ReferenceIssue[] {
  const seen = new Set<string>();
  const out: ReferenceIssue[] = [];
  entries.forEach((entry, n) => {
    if (seen.has(entry.key)) out.push({ path: [block, n, 'key'], message: `"${entry.key}" is the key of another entry of ${block}` });
    seen.add(entry.key);
  });
  return out;
}

/** What the blocks name, against the app's own pages and tables; and that only a file made on an Adminium carries them. */
export function savedPartsIssues(m: SavedPartsManifest, index: TableIndex): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  for (const block of SAVED_PART_BLOCKS) {
    if (m[block] !== undefined && m.publisher.id !== LOCAL) out.push({ path: [block], message: `"${block}" is read only from a file made on an Adminium (publisher "${LOCAL}")` });
  }
  out.push(...twiceIssues('reports', m.reports ?? []), ...twiceIssues('invoiceLayouts', m.invoiceLayouts ?? []), ...twiceIssues('scheduledReports', m.scheduledReports ?? []));

  const pages = new Set(m.pages.map((page) => page.ref));
  (m.scheduledReports ?? []).forEach((report, r) => {
    if (!pages.has(report.page)) out.push({ path: ['scheduledReports', r, 'page'], message: `"${report.page}" is not one of this app's pages` });
    const { frequency, dayOfWeek, dayOfMonth } = report.schedule;
    if (frequency === 'weekly' && dayOfWeek === undefined) out.push({ path: ['scheduledReports', r, 'schedule', 'dayOfWeek'], message: 'a weekly report names its day (0 = Sunday)' });
    if (frequency === 'monthly' && dayOfMonth === undefined) out.push({ path: ['scheduledReports', r, 'schedule', 'dayOfMonth'], message: 'a monthly report names its day' });
    if (frequency !== 'weekly' && dayOfWeek !== undefined) out.push({ path: ['scheduledReports', r, 'schedule', 'dayOfWeek'], message: 'a day of the week is said of a weekly report' });
    if (frequency !== 'monthly' && dayOfMonth !== undefined) out.push({ path: ['scheduledReports', r, 'schedule', 'dayOfMonth'], message: 'a day of the month is said of a monthly report' });
  });

  const payables = m.payments?.payables ?? [];
  const tables = new Set<string>();
  payables.forEach((payable, p) => {
    const at = (...rest: (string | number)[]) => ['payments', 'payables', p, ...rest];
    if (tables.has(payable.table)) out.push({ path: at('table'), message: `"${payable.table}" is payable twice` });
    tables.add(payable.table);
    if (index.table(payable.table) === undefined) {
      out.push({ path: at('table'), message: `"${payable.table}" is not a table of this app` });
      return;
    }
    const own = (ref: string | undefined, ...path: (string | number)[]) => {
      if (ref !== undefined && !index.has(payable.table, ref)) out.push({ path: at(...path), message: `"${payable.table}" has no column "${ref}"` });
    };
    own(payable.label, 'label');
    own(payable.amount.column, 'amount', 'column');
    if ('column' in payable.currency) own(payable.currency.column, 'currency', 'column');
    own(payable.due?.column, 'due', 'column');
    own(payable.status?.column, 'status', 'column');
    own(payable.customerEmail, 'customerEmail');
    own(payable.customerCountry, 'customerCountry');
    (payable.pageFields ?? []).forEach((ref, f) => own(ref, 'pageFields', f));
    const kept = payable.payments;
    if (kept.kind === 'table') {
      if (index.table(kept.table) === undefined) {
        out.push({ path: at('payments', 'table'), message: `"${kept.table}" is not a table of this app` });
        return;
      }
      for (const [name, ref] of [['link', kept.link], ['amount', kept.amount], ['date', kept.date], ['reference', kept.reference], ['note', kept.note], ['voided', kept.voided], ['refunded', kept.refunded]] as const) {
        if (ref !== undefined && !index.has(kept.table, ref)) out.push({ path: at('payments', name), message: `"${kept.table}" has no column "${ref}"` });
      }
      if (!index.has(kept.table, kept.method.column)) out.push({ path: at('payments', 'method', 'column'), message: `"${kept.table}" has no column "${kept.method.column}"` });
    }
  });
  const ways = new Set<string>();
  (m.payments?.ways ?? []).forEach((way, w) => {
    const key = `${way.source}/${way.method}`;
    if (ways.has(key)) out.push({ path: ['payments', 'ways', w], message: `"${key}" is listed twice` });
    ways.add(key);
  });
  return out;
}
