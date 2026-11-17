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
 * Each block is read only from a file whose publisher is `local` — but for
 * `payments.payables`, which any app may carry: a catalog app says which of its
 * tables a customer pays and how the payment lands in its own payments table.
 * Its payables arrive switched off; a person who manages payments switches the
 * app on (the server's install, `apps/saved-parts.ts`). The ways to pay and the
 * pay page stay the shop's own.
 *
 * Pure, and nothing imported from the manifest's own schema file.
 */
import { z } from 'zod';

import { refSchema, scalarSchema, settingRefSchema, valueFits, type ColumnShape, type ReferenceIssue, type TableIndex } from './refs.ts';
import { conditionIssues, moveTarget, stateConditionSchema, type StateMove } from './states.ts';

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
    /** The day it was paid; left out where a column stamps itself (`paidAt`, or a create stamp). */
    date: refSchema.optional(),
    /** The moment it was paid (a till's shift counts by it). */
    paidAt: refSchema.optional(),
    method: z.object({ column: refSchema, values: z.record(z.string().min(1).max(64), z.string().min(1).max(255)) }).strict(),
    note: refSchema.optional(),
    voided: refSchema.optional(),
    reference: refSchema,
    refunded: refSchema.optional(),
    /** The service it was taken by ("payments-stripe"): written only by Adminium, like the reference. */
    provider: refSchema.optional(),
    /** A card terminal's approval code, and the card's last four: a reader's or a standalone terminal's, never a pay page's. */
    approvalCode: refSchema.optional(),
    last4: refSchema.optional(),
    /** The payment's currency code. */
    currency: refSchema.optional(),
    /** Money given back that no refund row of the app's says (a refund made at the provider, a lost dispute): written by Adminium alone. */
    refundedElsewhere: refSchema.optional(),
    /** The tip a customer added on a card reader, beside what was asked. */
    tip: refSchema.optional(),
    amountUnit: z.enum(['units', 'minor']).optional(),
  })
  .strict();

/** A state a refund move starts from or goes to. */
const refundState = z.string().min(1).max(64);

/**
 * Refunds the app keeps as rows of its own refund table: its staff write the
 * row, and Adminium sends the money back for it (`when` says which rows), and
 * stamps `providerRef` and `state`. A free cancellation's row is written by
 * Adminium itself, as the system, with the `auto` values.
 */
const refundRowsSchema = z
  .object({
    model: z.literal('rows'),
    table: refSchema,
    payment: refSchema,
    amount: refSchema,
    when: z.array(stateConditionSchema).min(1).max(8),
    providerRef: refSchema,
    state: refSchema,
    /** The staff screen a refund is made on: Activity's "Refund in {app}" opens it. */
    openIn: z.string().max(200).regex(/^\/(?:[A-Za-z0-9._~-]+\/?)*$/, 'a path on the app\'s staff side, such as "/orders"').optional(),
    auto: z.object({ values: z.record(refSchema, z.union([z.string().max(255), z.number(), z.boolean()])) }).strict().optional(),
  })
  .strict();

/** The moves after which the full refund starts by itself, judged at the move: by whom, behind the app's own switch, and before a moment. */
const refundOnSchema = z
  .object({
    moves: z
      .array(
        z
          .object({
            from: z.array(refundState).min(1).max(16).optional(),
            to: refundState,
            /** The customer's own move, Adminium's timed move, or staff who hold the refund right. Anyone else leaves "Refund owed". */
            by: z.array(z.enum(['customer', 'system', 'refund-right'])).min(1).max(3),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    /** "Refund free cancellations automatically": a yes/no column of the app's settings row, read at the move. */
    switch: settingRefSchema.optional(),
    /** Only while the moment in `column` is at least the settings row's `hours` ahead (a clinic's late-cancel window). */
    before: z.object({ column: refSchema, hours: settingRefSchema }).strict().optional(),
  })
  .strict();

/**
 * Where the pay page sends the customer back: a path on the app's own customer
 * side. Never a query or a fragment, so never a claim or a link's token: a pay
 * link forwarded to someone else must not hand them the order.
 */
const returnToSchema = z
  .string()
  .max(200)
  .regex(/^\/(?:[A-Za-z0-9._~-]+\/?)*$/, 'a path on the app\'s customer side, such as "/orders": no query, no fragment');

/** Who sends the receipt of a payment: the app's own email, or Adminium's. Never both. */
const receiptSchema = z.enum(['app', 'engine']);

/** An invoice table built on the Invoices shape: the shape maps it; the app says only how its customers come back, and who sends the receipt. */
export const savedShapePayableSchema = z
  .object({
    table: refSchema,
    shape: z.literal(true),
    returnTo: returnToSchema.optional(),
    receipt: receiptSchema.optional(),
    onlyOnline: z.boolean().optional(),
  })
  .strict();
export type SavedShapePayable = z.infer<typeof savedShapePayableSchema>;

/** Which columns of a payable table say what is owed and how it is paid: the payments screen's mapping, by column refs. */
export const savedPayableSchema = z
  .object({
    table: refSchema,
    label: refSchema.optional(),
    amount: z.object({ column: refSchema, unit: z.enum(['units', 'minor']).optional() }).strict(),
    currency: z.union([
      z.object({ column: refSchema }).strict(),
      z.object({ fixed: currencyCode }).strict(),
      z.object({ connection: z.literal(true) }).strict(),
      /** A column of the app's one-row settings table (a clinic's own currency). */
      z.object({ setting: settingRefSchema }).strict(),
    ]),
    due: z.object({ column: refSchema }).strict().optional(),
    payments: z.union([z.object({ kind: z.literal('kept') }).strict(), ownPaymentsSchema]),
    status: z
      .object({
        column: refSchema,
        paid: z.string().min(1).max(255),
        refunded: z.string().min(1).max(255).optional(),
        /** The states a row is moved to `paid` from (an order still `paying`); a row in any other state keeps its state. */
        from: z.array(z.string().min(1).max(64)).min(1).max(16).optional(),
        /** The states a row is moved to `refunded` from. */
        refundedFrom: z.array(z.string().min(1).max(64)).min(1).max(16).optional(),
        /**
         * Further columns of the record written, with fixed values, in the same
         * write as the move to `paid` an online payment makes (a ticket order's
         * `paid_method` set to `online`). A payment recorded by hand writes none
         * of them: the screen that records it says how it was paid. Only
         * columns of the payable's own table that hold a plain value — never
         * the state column, a money column, the amount, the balance, the
         * currency, a link or a key.
         */
        set: z.record(refSchema, scalarSchema).optional(),
      })
      .strict()
      .optional(),
    customerEmail: refSchema.optional(),
    customerCountry: refSchema.optional(),
    pageFields: z.array(refSchema).max(50).optional(),
    /** While the row meets all of these, it may be paid; outside them there is no link, no checkout, and a page left open is ended. */
    payableWhen: z.array(stateConditionSchema).min(1).max(8).optional(),
    returnTo: returnToSchema.optional(),
    receipt: receiptSchema.optional(),
    /** The pay page offers no way to pay by hand: the app shows its own. */
    onlyOnline: z.boolean().optional(),
    /** Only ways that settle at once (cards, wallets): always, or while the row meets these. */
    instantOnly: z.union([z.literal(true), z.object({ where: z.array(stateConditionSchema).min(1).max(8) }).strict()]).optional(),
    /** How the app keeps refunds: a total on the payment row (`column`, the default), or rows of its own refund table. */
    refunds: z.union([z.object({ model: z.literal('column') }).strict(), refundRowsSchema]).optional(),
    refundOn: refundOnSchema.optional(),
  })
  .strict()
  .refine((payable) => payable.payments.kind === 'kept' || payable.due !== undefined, { message: 'a table that keeps its own payments names its balance column', path: ['due'] })
  .refine((payable) => payable.payments.kind === 'kept' || payable.payments.date !== undefined || payable.payments.paidAt !== undefined, {
    message: 'a payment names the day or the moment it was paid',
    path: ['payments', 'date'],
  });
export type SavedPayable = z.infer<typeof savedPayableSchema>;

/** A payable as an app's file carries it: mapped column by column, or an invoice table the shape maps. */
export const savedPayableEntrySchema = z.union([savedShapePayableSchema, savedPayableSchema]);
export type SavedPayableEntry = z.infer<typeof savedPayableEntrySchema>;

/** Whether an entry is an invoice table the shape maps. */
export function isShapePayable(entry: SavedPayableEntry): entry is SavedShapePayable {
  return 'shape' in entry && entry.shape === true;
}

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
    payables: z.array(savedPayableEntrySchema).max(16).optional(),
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
  /** What a stranger may write: never a column only a payment fills. */
  publicAccess?:
    | readonly {
        table: string;
        methods?: readonly string[] | undefined;
        writable?: readonly string[] | undefined;
        defaults?: Readonly<Record<string, unknown>> | undefined;
        humanCheck?: true | undefined;
        pay?: true | undefined;
        requirePayments?: 'on' | 'off' | undefined;
      }[]
    | undefined;
  /** The app's tables: a move that waits for no payment on its way is a move of a payable one. */
  requiredSchema?: { tables: readonly { ref: string; states?: { moves?: Readonly<Record<string, readonly StateMove[]>> | undefined } | undefined }[] } | undefined;
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

/**
 * A payable's refunds: rows of the app's own refund table that name the
 * payment row they refund, with columns only Adminium writes; and the moves
 * that refund by themselves, between states of the record's status column,
 * behind a yes/no switch and an hours setting of the settings row.
 */
function refundIssues(
  payable: Extract<SavedPayableEntry, { amount: unknown }>,
  index: TableIndex,
  at: (...rest: (string | number)[]) => (string | number)[],
  publicWrites: (table: string) => Set<string>,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const rows = payable.refunds?.model === 'rows' ? payable.refunds : null;
  if (rows !== null) {
    const kept = payable.payments.kind === 'table' ? payable.payments : null;
    if (kept === null) out.push({ path: at('refunds'), message: 'refund rows name the payment row they refund: keep payments in a table of the app\'s own (`payments.kind: "table"`)' });
    if (index.table(rows.table) === undefined) {
      out.push({ path: at('refunds', 'table'), message: `"${rows.table}" is not a table of this app` });
    } else {
      for (const [name, ref] of [['payment', rows.payment], ['amount', rows.amount], ['providerRef', rows.providerRef], ['state', rows.state]] as const) {
        if (!index.has(rows.table, ref)) out.push({ path: at('refunds', name), message: `"${rows.table}" has no column "${ref}"` });
      }
      const link = index.column(rows.table, rows.payment) as { type?: string; references?: string } | undefined;
      if (kept !== null && link !== undefined && (link.type !== 'fk' || link.references !== kept.table)) {
        out.push({ path: at('refunds', 'payment'), message: `"${rows.table}.${rows.payment}" names the payment refunded: a link to "${kept.table}"` });
      }
      rows.when.forEach((condition, c) => out.push(...conditionIssues(rows.table, condition, index, at('refunds', 'when', c))));
      const strangers = publicWrites(rows.table);
      for (const [name, ref] of [['providerRef', rows.providerRef], ['state', rows.state]] as const) {
        if (strangers.has(ref)) out.push({ path: at('refunds', name), message: `"${rows.table}.${ref}" is written only by Adminium, so no public entry may write it` });
      }
      for (const column of Object.keys(rows.auto?.values ?? {})) {
        if (!index.has(rows.table, column)) out.push({ path: at('refunds', 'auto', 'values', column), message: `"${rows.table}" has no column "${column}"` });
      }
    }
  }
  const on = payable.refundOn;
  if (on === undefined) return out;
  const status = payable.status;
  if (status === undefined) {
    out.push({ path: at('refundOn'), message: 'a refund on a move follows the record\'s states: name its status column (`status`)' });
  } else {
    const column = index.column(payable.table, status.column) as { type?: string; enum?: readonly string[] } | undefined;
    const values = column?.type === 'enum' ? (column.enum ?? []) : null;
    on.moves.forEach((move, m) => {
      for (const state of [...(move.from ?? []), move.to]) {
        if (values !== null && !values.includes(state)) out.push({ path: at('refundOn', 'moves', m), message: `"${state}" is not a value of "${payable.table}.${status.column}"` });
      }
    });
  }
  // The rows model writes the app's own refund row for an automatic refund: it says what goes in it.
  if (rows !== null && rows.auto === undefined) out.push({ path: at('refundOn'), message: 'a refund that starts by itself writes the app\'s refund row: say its values (`refunds.auto`)' });
  const setting = (ref: { table: string; column: string }, type: 'bool' | 'number', name: (string | number)[]): void => {
    const found = index.column(ref.table, ref.column) as { type?: string } | undefined;
    if (index.table(ref.table) === undefined) out.push({ path: name, message: `"${ref.table}" is not a table of this app` });
    else if (found === undefined) out.push({ path: name, message: `"${ref.table}" has no column "${ref.column}"` });
    else if (type === 'bool' ? found.type !== 'bool' : !['int', 'bigint', 'decimal', 'float'].includes(found.type ?? '')) {
      out.push({ path: name, message: type === 'bool' ? `"${ref.table}.${ref.column}" is not a yes/no column` : `"${ref.table}.${ref.column}" holds no number of hours` });
    }
  };
  if (on.switch !== undefined) setting(on.switch, 'bool', at('refundOn', 'switch'));
  if (on.before !== undefined) {
    const moment = index.column(payable.table, on.before.column) as { type?: string } | undefined;
    if (moment === undefined) out.push({ path: at('refundOn', 'before', 'column'), message: `"${payable.table}" has no column "${on.before.column}"` });
    else if (!['timestamptz', 'date'].includes(moment.type ?? '')) out.push({ path: at('refundOn', 'before', 'column'), message: `"${payable.table}.${on.before.column}" is not a moment` });
    setting(on.before.hours, 'number', at('refundOn', 'before', 'hours'));
  }
  return out;
}

/** The states a table's capacity rules count by the clock: every `hold.states` in them. */
function clockHolds(table: unknown): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) node.forEach(walk);
    else if (typeof node === 'object' && node !== null) {
      for (const [key, value] of Object.entries(node)) {
        if (key === 'hold' && typeof value === 'object' && value !== null && Array.isArray((value as { states?: unknown }).states)) out.push(...((value as { states: unknown[] }).states.map(String)));
        else walk(value);
      }
    }
  };
  walk((table as { capacity?: unknown }).capacity ?? null);
  return out;
}

/** What the blocks name, against the app's own pages and tables; and that only a file made on an Adminium carries them. */
export function savedPartsIssues(m: SavedPartsManifest, index: TableIndex): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const local = m.publisher.id === LOCAL;
  for (const block of SAVED_PART_BLOCKS) {
    if (m[block] === undefined || local) continue;
    // Any app may say which of its tables are payable; the ways to pay and the pay page are the shop's.
    if (block === 'payments') {
      for (const part of ['ways', 'payPage'] as const) {
        if (m.payments?.[part] !== undefined) out.push({ path: ['payments', part], message: `"payments.${part}" is read only from a file made on an Adminium (publisher "${LOCAL}"): the ways to pay and the pay page are the shop's` });
      }
      continue;
    }
    out.push({ path: [block], message: `"${block}" is read only from a file made on an Adminium (publisher "${LOCAL}")` });
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
  // The columns a stranger may write, by table: a payment's reference and service are never among them.
  const publicWrites = (table: string): Set<string> =>
    new Set((m.publicAccess ?? []).filter((entry) => entry.table === table).flatMap((entry) => [...(entry.writable ?? []), ...Object.keys(entry.defaults ?? {})]));
  payables.forEach((entry, p) => {
    const at = (...rest: (string | number)[]) => ['payments', 'payables', p, ...rest];
    if (tables.has(entry.table)) out.push({ path: at('table'), message: `"${entry.table}" is payable twice` });
    tables.add(entry.table);
    const found = index.table(entry.table) as { builtOn?: string; part?: string; states?: { column: string; moves?: Record<string, readonly StateMove[]> } } | undefined;
    if (found === undefined) {
      out.push({ path: at('table'), message: `"${entry.table}" is not a table of this app` });
      return;
    }
    if (isShapePayable(entry)) {
      if (!/^invoices\/invoice@[2-9]\d*$/.test(found.builtOn ?? '') || found.part !== 'document') {
        out.push({ path: at('shape'), message: `"${entry.table}" is not an invoice built on the Invoices shape at version 2 or later, so the shape does not map its payments` });
      }
      return;
    }
    const payable = entry;
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
      const named = [
        ['link', kept.link],
        ['amount', kept.amount],
        ['date', kept.date],
        ['paidAt', kept.paidAt],
        ['reference', kept.reference],
        ['note', kept.note],
        ['voided', kept.voided],
        ['refunded', kept.refunded],
        ['provider', kept.provider],
        ['approvalCode', kept.approvalCode],
        ['last4', kept.last4],
        ['currency', kept.currency],
        ['refundedElsewhere', kept.refundedElsewhere],
        ['tip', kept.tip],
      ] as const;
      for (const [name, ref] of named) {
        if (ref !== undefined && !index.has(kept.table, ref)) out.push({ path: at('payments', name), message: `"${kept.table}" has no column "${ref}"` });
      }
      if (!index.has(kept.table, kept.method.column)) out.push({ path: at('payments', 'method', 'column'), message: `"${kept.table}" has no column "${kept.method.column}"` });
      // Adminium writes each payment's reference once, and it says the payment is the provider's: unique, and never a stranger's to write.
      // (A file made on an Adminium carries the table as the database has it: its unique index is read where it installs.)
      const reference = index.column(kept.table, kept.reference) as { type: string; unique?: boolean } | undefined;
      if (!local && reference !== undefined && (reference.type !== 'text' || reference.unique !== true)) {
        out.push({ path: at('payments', 'reference'), message: `"${kept.table}.${kept.reference}" holds each payment's reference: a text column marked unique` });
      }
      const strangers = publicWrites(kept.table);
      for (const [name, ref] of [['reference', kept.reference], ['provider', kept.provider], ['approvalCode', kept.approvalCode], ['last4', kept.last4], ['refundedElsewhere', kept.refundedElsewhere]] as const) {
        if (ref !== undefined && strangers.has(ref)) out.push({ path: at('payments', name), message: `"${kept.table}.${ref}" is written only by a payment, so no public entry may write it` });
      }
    }
    // A catalog app's payment moves a record to paid only from the states it names: never a seen visit back to booked.
    if (!local && payable.status !== undefined && payable.status.from === undefined) {
      out.push({ path: at('status', 'from'), message: 'name the states a payment moves the record to paid from (`from`), such as ["paying"]' });
    }
    // The paid and refunded moves start only from states the status column holds.
    if (payable.status !== undefined) {
      const status = index.column(payable.table, payable.status.column);
      const values = status?.type === 'enum' ? (status.enum ?? []) : null;
      for (const [name, list] of [['from', payable.status.from], ['refundedFrom', payable.status.refundedFrom]] as const) {
        (list ?? []).forEach((state, i) => {
          if (values !== null && !values.includes(state)) out.push({ path: at('status', name, i), message: `"${state}" is not a value of "${payable.table}.${payable.status!.column}"` });
        });
      }
      // What the move to paid writes beside the state: plain columns of the record, never its money, keys or links.
      const sets = Object.entries(payable.status.set ?? {});
      if (sets.length > 4) out.push({ path: at('status', 'set'), message: 'a move to paid writes at most 4 more columns' });
      const moneyColumns = new Set([payable.amount.column, payable.due?.column, 'column' in payable.currency ? payable.currency.column : undefined].filter((c): c is string => c !== undefined));
      for (const [name, value] of sets) {
        const column = index.column(payable.table, name) as ColumnShape | undefined;
        const here = at('status', 'set', name);
        if (column === undefined) out.push({ path: here, message: `"${payable.table}" has no column "${name}"` });
        else if (name === payable.status.column) out.push({ path: here, message: 'the state column is moved by `paid`, not set' });
        else if (moneyColumns.has(name) || ['money', 'decimal'].includes(column.type)) out.push({ path: here, message: `"${payable.table}.${name}" holds money: a payment never writes a figure into its record` });
        else if (['id', 'fk', 'uuid', 'json', 'blob'].includes(column.type) || column.role === 'pk' || column.references !== undefined) out.push({ path: here, message: `"${payable.table}.${name}" is a key, a link or a document: a payment writes only a plain value` });
        else if (!valueFits(column, value)) out.push({ path: here, message: `${JSON.stringify(value)} does not fit "${payable.table}.${name}"` });
      }
      // On a table whose states list its moves, the paid (and refunded) move is one of them: a move not listed is refused
      // when the money lands, so the payment would stand with its record left where it was.
      const moves = found.states?.column === payable.status.column ? found.states.moves : undefined;
      if (moves !== undefined) {
        for (const [name, list, to] of [['from', payable.status.from, payable.status.paid], ['refundedFrom', payable.status.refundedFrom, payable.status.refunded]] as const) {
          if (to === undefined) continue;
          (list ?? []).forEach((state, i) => {
            if (!(moves[state] ?? []).some((move) => moveTarget(move) === to)) out.push({ path: at('status', name, i), message: `"${payable.table}" lists no move from "${state}" to "${to}" in its states` });
          });
        }
      }
    }
    (payable.payableWhen ?? []).forEach((condition, c) => out.push(...conditionIssues(payable.table, condition, index, at('payableWhen', c))));
    // A state a customer pays in is never a hold counted by the clock (`capacity.hold.states`): its places would be sold
    // again while the money is landing, and a buyer's new hold would let it go. Count it by state; only its timed move frees it.
    const paying = new Set((payable.payableWhen ?? []).flatMap((condition) => (condition.eq !== undefined ? [condition.eq] : (condition.in ?? []))).map(String));
    for (const held of clockHolds(found)) {
      if (paying.has(held)) out.push({ path: at('payableWhen'), message: `"${held}" is a hold counted by the clock (capacity.hold.states) and a state the record is paid in: count it with countWhere, and let only its timed move free it` });
    }
    if (payable.instantOnly !== undefined && payable.instantOnly !== true) {
      payable.instantOnly.where.forEach((condition, c) => out.push(...conditionIssues(payable.table, condition, index, at('instantOnly', 'where', c))));
    }
    if ('setting' in payable.currency) {
      const { table, column } = payable.currency.setting;
      if (index.table(table) === undefined) out.push({ path: at('currency', 'setting', 'table'), message: `"${table}" is not a table of this app` });
      else if (index.column(table, column)?.type !== 'text') out.push({ path: at('currency', 'setting', 'column'), message: `"${table}.${column}" is not a text column, so it holds no currency code` });
    }
    out.push(...refundIssues(payable, index, at, publicWrites));
  });
  // A create that answers a pay link: of one of the app's payable tables, behind the human check.
  const payableTables = new Set(payables.map((entry) => entry.table));
  (m.publicAccess ?? []).forEach((entry, e) => {
    if (entry.pay !== true) return;
    const at = ['publicAccess', e, 'pay'];
    if (!(entry.methods ?? []).includes('POST')) out.push({ path: at, message: 'a pay link is answered by a create, and this entry makes none' });
    if (!payableTables.has(entry.table)) out.push({ path: at, message: `"${entry.table}" is not one of this app's payable tables (payments.payables)` });
    if (entry.humanCheck !== true) out.push({ path: at, message: 'a create that answers a pay link asks the human check' });
  });
  // A move refused while a payment is on its way: of a payable table, where payments can be on their way.
  (m.requiredSchema?.tables ?? []).forEach((table, t) => {
    for (const [from, moves] of Object.entries(table.states?.moves ?? {})) {
      moves.forEach((move, i) => {
        if (typeof move === 'object' && move.requires?.noPaymentInFlight === true && !payableTables.has(table.ref)) {
          out.push({ path: ['requiredSchema', 'tables', t, 'states', 'moves', from, i, 'requires', 'noPaymentInFlight'], message: `"${table.ref}" is not one of this app's payable tables (payments.payables), so no payment is ever on its way for its rows` });
        }
      });
    }
  });
  // An entry open only while payments are on (or off): a create of one of the app's payable tables.
  (m.publicAccess ?? []).forEach((entry, e) => {
    if (entry.requirePayments === undefined) return;
    const at = ['publicAccess', e, 'requirePayments'];
    if (!(entry.methods ?? []).includes('POST')) out.push({ path: at, message: 'payments being on or off opens a create, and this entry makes none' });
    if (!payableTables.has(entry.table)) out.push({ path: at, message: `"${entry.table}" is not one of this app's payable tables (payments.payables)` });
  });
  const ways = new Set<string>();
  (m.payments?.ways ?? []).forEach((way, w) => {
    const key = `${way.source}/${way.method}`;
    if (ways.has(key)) out.push({ path: ['payments', 'ways', w], message: `"${key}" is listed twice` });
    ways.add(key);
  });
  return out;
}
