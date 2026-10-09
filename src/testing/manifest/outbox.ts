/*
 * VENDORED VERBATIM from packages/manifest/src/outbox.ts.
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
 * `outbox` and `emailTemplates` — the emails an app sends, declared with the
 * app and versioned with it.
 *
 * The app's own table IS the outbox: every email is a row in it, queued by
 * whatever wants it sent (a producer below, the desk's "Send now", an
 * operator), then sent by Adminium, which records `sent`, `failed` or
 * `skipped` on the row. So the table is the log a person reads, and a row of
 * a kind already there for the same source is what stops a second send.
 *
 * Producers queue rows by themselves: when a row is created, when a column
 * changes to a value, or a lead time before a timestamp (a reminder at the
 * time each patient chose).
 *
 * Templates are stored with the app as their owner. An operator who edits
 * one keeps the edit across the app's updates.
 *
 * A producer may HOLD what it queues: the row is written `held`, with the
 * moment it becomes due, and nothing is sent until someone approves it (a
 * reminder about an unpaid invoice, whose wording the sender may edit).
 * Messages of one `supersede` group give way to a later one that comes due,
 * `dropWhen` skips waiting ones once they are no longer needed (the invoice
 * was paid), and `onSent` changes a linked row once the message has gone
 * (the third reminder pauses the project).
 */
import { z } from 'zod';

import type { AddOnNeeds } from './add-ons.ts';
import { formulaColumns, type FormulaExpr } from './formula.ts';
import { personalColumn, unlistedColumn } from './public-access.ts';
import { reachedOnlyByUndo, type StateMove } from './states.ts';
import {
  bcp47TagSchema,
  refSchema,
  scalarSchema,
  settingRefSchema,
  settingSourceSchema,
  textOrLabels,
  valueFits,
  type ReferenceIssue,
  type SettingSource,
  type TableIndex,
} from './refs.ts';

/** The statuses an outbox table's status column must offer. */
export const OUTBOX_STATUSES = ['queued', 'sent', 'failed', 'skipped'] as const;

/** The status a held message waits in, when any producer holds. */
export const OUTBOX_HELD = 'held';

/** Why a waiting message was skipped. `overtaken` and `by-hand` are Adminium's and the desk's. */
export const OUTBOX_SKIP_REASONS = ['overtaken', 'paid', 'void', 'no-longer-needed', 'by-hand'] as const;

/** One condition on a row: equal to a value, one of several, or empty (or not). */
const conditionSchema = z
  .object({
    column: refSchema,
    eq: scalarSchema.optional(),
    in: z.array(scalarSchema).min(1).max(32).optional(),
    isNull: z.boolean().optional(),
  })
  .strict()
  .refine((c) => [c.eq, c.in, c.isNull].filter((part) => part !== undefined).length === 1, {
    message: 'a condition says one of eq, in or isNull',
  });
type Condition = z.infer<typeof conditionSchema>;

/** How many days after the source row's date a held message comes due. */
const dueDaysSchema = z.union([
  z.number().int().min(0).max(3650),
  /** A number per value of a column of the source row (`ladder`: gentle 7, firm 1). */
  z.object({ byColumn: refSchema, values: z.record(z.string().min(1), z.number().int().min(0).max(3650)) }).strict(),
  /**
   * Read from a setting when the message is made (and again when the date
   * moves): a number, a list (`index` picks one), or lists per value of
   * `byColumn` (`{gentle: [7, 21, 45], …}`).
   */
  z
    .object({ setting: settingSourceSchema, byColumn: refSchema.optional(), index: z.number().int().min(0).max(9).optional() })
    .strict(),
]);

const dropConditionSchema = z
  .object({
    column: refSchema,
    eq: scalarSchema.optional(),
    in: z.array(scalarSchema).min(1).max(32).optional(),
    isNull: z.boolean().optional(),
    lte: z.number().finite().optional(),
    gte: z.number().finite().optional(),
    reason: z.enum(['paid', 'void', 'no-longer-needed']),
  })
  .strict()
  .refine((c) => [c.eq, c.in, c.isNull, c.lte, c.gte].filter((part) => part !== undefined).length === 1, {
    message: 'a condition says one of eq, in, isNull, lte or gte',
  });

const producerBase = {
  /** The kind of row it queues (a key of `outbox.kinds`). */
  kind: z.string().min(1).max(40),
  /** The outbox column that links the queued row to the row that produced it. */
  link: refSchema,
  /**
   * Paused while the settings row's `enabled` column is false — or, naming
   * one, while that bool of the settings row is false (each of a studio's
   * notices has its own switch).
   */
  gate: z
    .union([
      z.literal('enabled'),
      z.object({ setting: settingRefSchema }).strict(),
      /** Only while a feature of the app is on (its add-ons attached): a receipt, with Invoices & Receipts. */
      z.object({ feature: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id') }).strict(),
      /** Both at once: only while the feature is on AND that bool of the settings row is true (a receipt, when the manager wants one sent). */
      z.object({ feature: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a feature id'), setting: settingRefSchema }).strict(),
    ])
    .optional(),
  /** Skipped for a recipient whose `recipient.optIn` column is false. */
  optIn: z.literal(true).optional(),
  /** Written `held`: sent only once someone approves it. */
  hold: z.literal(true).optional(),
  /** When it comes due: days after a date of the source row, at a time of day on the venue's clock (09:00 by default). */
  due: z
    .object({
      date: refSchema,
      days: dueDaysSchema,
      at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time such as 09:00').optional(),
    })
    .strict()
    .optional(),
  /** Messages of this group for one row: when one comes due, the earlier ones not yet sent are skipped as overtaken. */
  supersede: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a group name').optional(),
  /** While the source row meets one of these, its waiting messages are skipped, with the reason. */
  dropWhen: z.array(dropConditionSchema).min(1).max(4).optional(),
  /**
   * Sent instead of the outbox's recipient: to an address a setting holds
   * (the studio's own), or to an address a text column of the producing row
   * holds (a ticket's `send_to_email`, the friend it is offered to), with
   * that row's `name` column as the name.
   */
  recipient: z
    .union([
      z.object({ setting: settingSourceSchema }).strict(),
      /** `language`: a text column of the same row, the language the message is written in. */
      z.object({ column: refSchema, name: refSchema.optional(), language: refSchema.optional() }).strict(),
    ])
    .optional(),
  /** One message per linked row in each window of this many minutes. */
  batchMinutes: z.number().int().min(1).max(240).optional(),
  /**
   * The message waits this many seconds before it may go, so a move taken
   * back at once (an order marked ready by mistake) drops it by `dropWhen`
   * before anyone is told. A message dropped so does not stop the next one.
   */
  holdSeconds: z.number().int().min(1).max(3600).optional(),
  /**
   * A column of the row the message is about: one message for each value it
   * holds, not one for the row for ever — a ticket offered again, its link
   * made afresh, is emailed again. Kept as a digest in the outbox's
   * `repeatKey` column.
   */
  repeatBy: refSchema.optional(),
  /**
   * One message for each change it hears of, not one for the row for ever:
   * "Resend tickets" twice is two messages, a stay's dates moved twice is two
   * notices. On a producer that listens for changes (`onChange`).
   */
  repeat: z.literal(true).optional(),
  /**
   * The columns of the changed row as they were before the change (a stay's
   * old dates, its old total), kept on the message in the outbox's `was`
   * column and read by its template as `{{was.<column>}}`, in every form the
   * column has. On a producer that listens for changes (`onChange`).
   */
  was: z.array(refSchema).min(1).max(8).optional(),
  /**
   * A change made once the message has gone, through the ordinary write: to
   * the source row, or (with `via`) the row its foreign key points at.
   */
  onSent: z
    .object({
      table: refSchema,
      via: refSchema.optional(),
      set: z.record(refSchema, z.union([scalarSchema, z.null()])),
    })
    .strict()
    .optional(),
};

export const outboxProducerSchema = z.union([
  z
    .object({
      ...producerBase,
      /** `via`: the source is a child row, and the message links the row its foreign key points at. */
      onCreate: z.object({ table: refSchema, via: refSchema.optional(), where: conditionSchema.optional() }).strict(),
    })
    .strict(),
  z
    .object({
      ...producerBase,
      onChange: z.union([
        z
          .object({
            table: refSchema,
            via: refSchema.optional(),
            column: refSchema,
            to: z.union([scalarSchema, z.array(scalarSchema).min(1).max(16)]),
            where: conditionSchema.optional(),
          })
          .strict(),
        /** Any change of one of these columns, compared with the row as it was stored (a stay's dates, whatever they became). */
        z
          .object({
            table: refSchema,
            via: refSchema.optional(),
            columns: z.array(refSchema).min(1).max(8),
            changed: z.literal(true),
            where: conditionSchema.optional(),
          })
          .strict(),
      ]),
    })
    .strict(),
  z
    .object({
      ...producerBase,
      before: z
        .object({
          table: refSchema,
          /** The moment the email leads: a timestamptz. */
          at: refSchema,
          /** How many hours before: read through one link, with a settings fallback. */
          lead: z
            .object({
              via: refSchema,
              table: refSchema,
              column: refSchema,
              fallback: settingRefSchema.optional(),
              /** The largest lead anyone may choose, in hours — how far ahead Adminium looks. */
              max: z.number().int().min(1).max(24 * 14),
              /**
               * Sent at this wall time on the venue's day the lead reaches,
               * not at the hour itself: 24 hours before an 20:00 show, at
               * 09:00, is 09:00 the day before.
               */
              at: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'a time such as 09:00').optional(),
            })
            .strict(),
          where: conditionSchema.optional(),
        })
        .strict(),
    })
    .strict(),
]);
export type OutboxProducer = z.infer<typeof outboxProducerSchema>;

const recipientSchema = z
  .object({
    /** The outbox column pointing at the person, and their table's columns. */
    via: refSchema,
    table: refSchema,
    email: refSchema,
    name: refSchema.optional(),
    /**
     * The language the message is written in: a text column of the person's
     * row, or (`{column}`) of the row the message is about — an order placed
     * in German is written to in German, whatever the person's own row says.
     */
    language: z.union([refSchema, z.object({ column: refSchema }).strict()]).optional(),
    /** A bool the person sets: false means no reminders. */
    optIn: refSchema.optional(),
    /**
     * Where the address comes from when `via` is empty — a first visit made
     * by someone not yet on file carries their details on the row itself.
     */
    fallback: z
      .object({ via: refSchema, email: refSchema, name: refSchema.optional(), language: refSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();

export const outboxSchema = z
  .object({
    table: refSchema,
    columns: z
      .object({
        kind: refSchema,
        status: refSchema,
        to: refSchema,
        language: refSchema.optional(),
        due: refSchema.optional(),
        sentAt: refSchema.optional(),
        error: refSchema.optional(),
        /** Why a message was skipped (overtaken, paid, void, no-longer-needed, by-hand). */
        skipReason: refSchema.optional(),
        /** The wording a person approving a held message wrote instead of the template's. */
        subjectOverride: refSchema.optional(),
        bodyOverride: refSchema.optional(),
        /** Who approved a held message. */
        approvedBy: refSchema.optional(),
        /** When `onSent`'s change was made, or why it was refused. */
        effectAt: refSchema.optional(),
        effectError: refSchema.optional(),
        /** A text column (at least 43 characters) Adminium fills with the digest of a producer's `repeatBy` value. */
        repeatKey: refSchema.optional(),
        /** A text column (unbounded, or at least 1000 characters) Adminium fills with a producer's `was` columns, as they were. */
        was: refSchema.optional(),
      })
      .strict(),
    /**
     * The outbox's foreign keys, by the name a template reads them under:
     * `{appointment: 'appointment_id'}` gives a template `appointment.*`.
     */
    links: z.record(z.string().regex(/^[a-z][a-z_]*$/, 'a link name is snake_case'), refSchema).optional(),
    recipient: recipientSchema,
    /**
     * The app's one-row settings table, read as `practice.*` by every template;
     * `name` is the column its emails are signed with (the sign-in code's too),
     * and `phone` the number Adminium's own notices give a person to ring —
     * the one sent to an old address after a change of email.
     */
    settings: z
      .object({
        table: refSchema,
        enabled: refSchema.optional(),
        name: refSchema.optional(),
        phone: refSchema.optional(),
        /** The address a reply to any of the app's messages goes to (the house's own): a Reply-To on each. Empty or not an address: none. */
        replyTo: refSchema.optional(),
      })
      .strict()
      .optional(),
    /**
     * Where a template's links lead on the app's guest side: `manage_url` and
     * `booking_url`, as paths under its address (default: its front page).
     */
    pages: z
      .object({
        manage: z.string().regex(/^\/[A-Za-z0-9/_-]{0,119}$/, 'a path on the guest side, e.g. /my-visits').optional(),
        booking: z.string().regex(/^\/[A-Za-z0-9/_-]{0,119}$/, 'a path on the guest side, e.g. /').optional(),
        /**
         * An add-on's links into the customer side of whichever app it serves:
         * a name of its own → the key of a route that app declares. A template
         * reads it as `{{app_url.<name>}}`; it is empty when no app of the
         * add-on's has that route.
         */
        app: z
          .record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a kebab-case name'), z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,39}$/, 'a route key'))
          .refine((names) => Object.keys(names).length >= 1 && Object.keys(names).length <= 6, { message: 'one to six links into an app' })
          .optional(),
      })
      .strict()
      .optional(),
    /** Each value of the kind column, and the template it is sent with. */
    kinds: z.record(z.string().min(1).max(40), z.string().min(1).max(80)),
    producers: z.array(outboxProducerSchema).max(24).optional(),
  })
  .strict();
export type Outbox = z.infer<typeof outboxSchema>;

/**
 * One block of a template, in the shape the template store keeps. The `html`
 * block is refused: its variables are not escaped, and a manifest's template
 * renders values a stranger typed (a name on a first visit).
 */
const emailBlockSchema = z
  .object({
    block: z
      .string()
      .regex(/^email\.[a-z][a-z0-9-]*$/, 'an email block kind, e.g. email.text')
      .refine((kind) => kind !== 'email.html', { message: 'an app template may not use the html block' }),
    id: z.string().min(1).max(60).optional(),
    label: z.string().min(1).max(120).optional(),
    data: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const emailContentSchema = z
  .object({
    subject: z.string().min(1).max(200),
    preheader: z.string().min(1).max(200).optional(),
    blocks: z.array(emailBlockSchema).min(1).max(40),
    footer: z.string().min(1).max(1000).optional(),
  })
  .strict();

/**
 * A variable a template reads, spelled as the sender fills it: a column of the
 * row or of a row it links (`patient.name`, `practice.phone`, a column with a
 * number in its name), one of the sender's own (`appName`, `manage_url`), or
 * an add-on's public setting (`addOn.<add-on key>.<setting>`). A template may
 * use any of them, so the list may name any of them.
 */
const templateVariableSchema = z
  .string()
  .regex(
    /^(?:appName|addOn\.[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9_]*|[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)*)$/,
    'a variable such as patient.name or appName',
  );

export const emailTemplateSchema = z
  .object({
    /** `<app key>-<name>`: an app names only its own templates. */
    key: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a template key is kebab-case'),
    name: textOrLabels,
    /**
     * A document the email carries, drawn by an add-on for the row an
     * outbox link names (a receipt for a sale): the PDF where its text allows,
     * else the print copy. A message whose document cannot be drawn fails
     * rather than going without it.
     */
    attach: z
      .object({
        kind: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a document kind'),
        link: z.string().min(1).max(40),
        /**
         * Sent without the document when no add-on the app has draws its
         * kind (a receipt, without Invoices & Receipts): the part is left out,
         * and so is every block marked `data.withAttachment: true`. Without
         * it, such a message fails rather than go without its document.
         */
        optional: z.literal(true).optional(),
      })
      .strict()
      .optional(),
    /** The variables it reads, for the editor's list. */
    vars: z.array(templateVariableSchema).max(60).optional(),
    /** The template in each language it ships, US English always among them. */
    locales: z
      .record(bcp47TagSchema, emailContentSchema)
      .refine((locales) => locales['en-US'] !== undefined, { message: 'a template includes en-US' }),
  })
  .strict();
export type EmailTemplate = z.infer<typeof emailTemplateSchema>;

/** The column rules that decide a value on the server (see `columnRulesSchema`). */
const DECIDING_RULES = ['copy', 'default', 'sequence', 'format', 'code', 'rollup', 'formula', 'stamp', 'perNight'] as const;
/** The column rules that refuse a value: Adminium's own writes to the column would be refused by them. */
const REFUSING_RULES = ['options', 'validation', 'required', 'requiredWhen', 'notAfter', 'notBefore'] as const;
/** How long a `repeatKey` is: a SHA-256 digest in base64url. */
export const REPEAT_KEY_LENGTH = 43;
/** The fewest characters a bounded `was` column holds: the columns a message keeps, as they were. */
export const WAS_MIN_LENGTH = 1000;
/** The mark on a template's block that is sent only with the document the template carries (`attach.optional`). */
export const WITH_ATTACHMENT = 'withAttachment';
/** The marks on a block that is sent only when a variable is filled (`onlyWith`), or only when it is empty (`onlyWithout`). */
export const ONLY_WITH = 'onlyWith';
export const ONLY_WITHOUT = 'onlyWithout';

/** What the outbox writes, and which rules each refuses: everything, but a check of the address a person types. */
export const OUTBOX_WRITTEN = {
  status: [...DECIDING_RULES, ...REFUSING_RULES],
  sentAt: [...DECIDING_RULES, ...REFUSING_RULES],
  error: [...DECIDING_RULES, ...REFUSING_RULES],
  skipReason: [...DECIDING_RULES, ...REFUSING_RULES],
  approvedBy: [...DECIDING_RULES, ...REFUSING_RULES],
  effectAt: [...DECIDING_RULES, ...REFUSING_RULES],
  effectError: [...DECIDING_RULES, ...REFUSING_RULES],
  repeatKey: [...DECIDING_RULES, ...REFUSING_RULES],
  was: [...DECIDING_RULES, ...REFUSING_RULES],
  // Left empty by a desk that asks Adminium to look the address up, and written when it sends.
  to: [...DECIDING_RULES, 'options', 'required', 'requiredWhen'],
  language: [...DECIDING_RULES, 'options', 'required', 'requiredWhen'],
} as const satisfies Record<string, readonly string[]>;

/**
 * The columns of its own row one column's rules read where the read can
 * refuse a write of that row: a `requiredWhen`'s watched column, a
 * `notBefore`'s bound (or its link), a `copy`'s link, a formula's inputs (a
 * result the column cannot hold is refused). The manifest's rule shape, which
 * is also the value of the override each is kept as (`column.requiredWhen`,
 * `column.bounds`, `column.copy`, `column.formula`).
 */
export function rulesReading(rules: unknown): { rule: 'requiredWhen' | 'notBefore' | 'copy' | 'formula'; reads: string }[] {
  if (typeof rules !== 'object' || rules === null) return [];
  const r = rules as { requiredWhen?: { column?: unknown }; notBefore?: { column?: unknown; via?: unknown }; copy?: { via?: unknown }; formula?: unknown };
  const out: ReturnType<typeof rulesReading> = [];
  if (typeof r.requiredWhen?.column === 'string') out.push({ rule: 'requiredWhen', reads: r.requiredWhen.column });
  const bound = r.notBefore?.via ?? r.notBefore?.column;
  if (typeof bound === 'string') out.push({ rule: 'notBefore', reads: bound });
  if (typeof r.copy?.via === 'string') out.push({ rule: 'copy', reads: r.copy.via });
  if (typeof r.formula === 'object' && r.formula !== null) {
    for (const reads of formulaColumns(r.formula as FormulaExpr)) out.push({ rule: 'formula', reads });
  }
  return out;
}

/** Everything in `outbox` and `emailTemplates` that names something undeclared, or does not fit. */
export function outboxIssues(
  m: {
    key: string;
    outbox?: Outbox | undefined;
    emailTemplates?: readonly EmailTemplate[] | undefined;
    addOns?: AddOnNeeds | undefined;
    /** `add-on` when the outbox is an add-on's own: it links into its apps' pages, and has no guest side of its own. */
    kind?: string | undefined;
  } & Parameters<typeof unlistedColumn>[0],
  index: TableIndex,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const templates = new Set<string>();
  (m.emailTemplates ?? []).forEach((template, i) => {
    if (template.attach !== undefined && m.outbox?.links?.[template.attach.link] === undefined) {
      out.push({ path: ['emailTemplates', i, 'attach', 'link'], message: `"${template.attach.link}" is not one of the outbox's links` });
    }
    // A block sent only with the document: marked `true`, and only where the document may be left out.
    for (const [locale, content] of Object.entries(template.locales)) {
      content.blocks.forEach((block, b) => {
        // A block sent only when a variable is filled, or only when it is empty: one name, without braces.
        const marks = [ONLY_WITH, ONLY_WITHOUT].filter((name) => block.data?.[name] !== undefined);
        if (marks.length === 2) out.push({ path: ['emailTemplates', i, 'locales', locale, 'blocks', b, 'data'], message: `a block is sent ${ONLY_WITH} a variable or ${ONLY_WITHOUT} one, not both` });
        for (const name of marks) {
          const variable = block.data?.[name];
          const path = ['emailTemplates', i, 'locales', locale, 'blocks', b, 'data', name];
          if (typeof variable !== 'string' || !/^[A-Za-z_][A-Za-z0-9_.-]{0,119}$/.test(variable)) {
            out.push({ path, message: `${name} names one variable, without braces (card.sender_name)` });
          } else if (variable.startsWith('app_url.') && m.outbox?.pages?.app?.[variable.slice('app_url.'.length)] === undefined) {
            out.push({ path, message: `"${variable}" is not a link the outbox declares (outbox.pages.app)` });
          } else if (variable.startsWith('row.')) {
            out.push({ path, message: 'a row\'s own value is read inside an email.rows block, which is sent with its rows or not at all' });
          }
        }
        const mark = block.data?.[WITH_ATTACHMENT];
        if (mark === undefined) return;
        const path = ['emailTemplates', i, 'locales', locale, 'blocks', b, 'data', WITH_ATTACHMENT];
        if (mark !== true) out.push({ path, message: `${WITH_ATTACHMENT} is true or absent` });
        else if (template.attach?.optional !== true) out.push({ path, message: 'a block is sent only with the document when the template may go without it (attach.optional)' });
      });
    }
    if (!template.key.startsWith(`${m.key}-`)) {
      out.push({ path: ['emailTemplates', i, 'key'], message: `an app's template key starts with "${m.key}-"` });
    }
    if (templates.has(template.key)) out.push({ path: ['emailTemplates', i, 'key'], message: `"${template.key}" is declared twice` });
    templates.add(template.key);
  });

  const box = m.outbox;
  if (box === undefined) {
    if (templates.size > 0) out.push({ path: ['emailTemplates'], message: 'templates are sent through an outbox, and this app declares none' });
    return out;
  }
  const at = (...rest: (string | number)[]) => ['outbox', ...rest];
  // Whose pages a link leads to: an app's own guest side, or — for an add-on — a page of the app it serves.
  if (m.kind === 'add-on') {
    for (const own of ['manage', 'booking'] as const) {
      if (box.pages?.[own] !== undefined) out.push({ path: at('pages', own), message: `an add-on has no guest side of its own: link into its app's pages by name (outbox.pages.app)` });
    }
  } else if (box.pages?.app !== undefined) {
    out.push({ path: at('pages', 'app'), message: 'an app links to its own guest side (pages.manage, pages.booking): "app" is how an add-on links into an app' });
  }
  if (index.table(box.table) === undefined) {
    out.push({ path: at('table'), message: `"${box.table}" is not a table of this app` });
    return out;
  }
  const col = (table: string, ref: string, types: readonly string[] | null, path: (string | number)[], what: string) => {
    if (index.table(table) === undefined) {
      out.push({ path, message: `"${table}" is not a table of this app` });
      return undefined;
    }
    const found = index.column(table, ref);
    if (found === undefined) out.push({ path, message: `"${table}" has no column "${ref}"` });
    else if (types !== null && !types.includes(found.type)) out.push({ path, message: `"${table}.${ref}" must be ${what}` });
    else return found;
    return undefined;
  };
  const fk = (table: string, ref: string, target: string | undefined, path: (string | number)[]) => {
    const found = col(table, ref, ['fk'], path, 'a foreign key');
    if (found !== undefined && target !== undefined && found.references !== target) {
      out.push({ path, message: `"${table}.${ref}" does not point at "${target}"` });
    }
    if (found !== undefined && found.nullable !== true && table === box.table) {
      out.push({ path, message: `"${table}.${ref}" must be nullable: not every email is about one` });
    }
    return found;
  };
  const condition = (table: string, cond: Condition | undefined, path: (string | number)[]) => {
    if (cond === undefined) return;
    const found = col(table, cond.column, null, [...path, 'column'], '');
    const values = cond.eq !== undefined ? [cond.eq] : (cond.in ?? []);
    if (found !== undefined) for (const value of values) {
      if (!valueFits(found, value)) out.push({ path, message: `${JSON.stringify(value)} is not a value of "${table}.${cond.column}"` });
    }
    if (found !== undefined && cond.isNull !== undefined && found.nullable !== true) {
      out.push({ path, message: `"${table}.${cond.column}" is never empty` });
    }
  };

  const kind = col(box.table, box.columns.kind, ['enum'], at('columns', 'kind'), 'an enum of the kinds');
  const status = col(box.table, box.columns.status, ['enum'], at('columns', 'status'), `an enum of ${OUTBOX_STATUSES.join(', ')}`);
  if (status !== undefined) {
    const missing = OUTBOX_STATUSES.filter((value) => !(status.enum ?? []).includes(value));
    if (missing.length > 0) out.push({ path: at('columns', 'status'), message: `"${box.table}.${status.ref}" lacks ${missing.join(', ')}` });
  }
  col(box.table, box.columns.to, ['text'], at('columns', 'to'), 'a text column');
  if (box.columns.language !== undefined) col(box.table, box.columns.language, ['text'], at('columns', 'language'), 'a text column');
  if (box.columns.due !== undefined) col(box.table, box.columns.due, ['timestamptz'], at('columns', 'due'), 'a timestamptz');
  if (box.columns.sentAt !== undefined) col(box.table, box.columns.sentAt, ['timestamptz'], at('columns', 'sentAt'), 'a timestamptz');
  if (box.columns.error !== undefined) col(box.table, box.columns.error, ['text'], at('columns', 'error'), 'a text column');
  for (const name of ['skipReason', 'subjectOverride', 'bodyOverride', 'approvedBy', 'effectError'] as const) {
    const ref = box.columns[name];
    if (ref !== undefined) col(box.table, ref, name === 'skipReason' ? ['text', 'enum'] : ['text'], at('columns', name), 'a text column');
  }
  if (box.columns.effectAt !== undefined) col(box.table, box.columns.effectAt, ['timestamptz'], at('columns', 'effectAt'), 'a timestamptz');
  if (box.columns.repeatKey !== undefined) {
    const found = col(box.table, box.columns.repeatKey, ['text'], at('columns', 'repeatKey'), 'a text column');
    if (found !== undefined && found.maxLength !== undefined && found.maxLength < REPEAT_KEY_LENGTH) {
      out.push({ path: at('columns', 'repeatKey'), message: `"${box.table}.${found.ref}" must hold ${REPEAT_KEY_LENGTH} characters (a digest)` });
    }
  }
  if (box.columns.was !== undefined) {
    const found = col(box.table, box.columns.was, ['text'], at('columns', 'was'), 'a text column');
    if (found !== undefined && found.maxLength !== undefined && found.maxLength < WAS_MIN_LENGTH) {
      out.push({ path: at('columns', 'was'), message: `"${box.table}.${found.ref}" keeps a message's values from before a change: it holds ${WAS_MIN_LENGTH} characters or more` });
    }
  }
  /*
   * The columns Adminium writes as it sends and as a person approves or skips
   * a message — and the address and language it writes when it looks them up.
   * A rule of the app's own that decides one of them (a stamp of who
   * approved) races Adminium for it, and the desk's every message is then
   * refused for writing a column only Adminium writes; one that refuses a
   * value (allowed values, a length, required) refuses Adminium's own write,
   * and the message is stuck. A check of the address a person types
   * (`validation`) stays: Adminium only ever writes an address.
   */
  for (const [name, refused] of Object.entries(OUTBOX_WRITTEN) as [keyof typeof OUTBOX_WRITTEN, readonly string[]][]) {
    const ref = box.columns[name];
    if (ref === undefined) continue;
    const rules = (index.column(box.table, ref) as { rules?: Record<string, unknown> } | undefined)?.rules;
    const found = refused.filter((rule) => rules?.[rule] !== undefined);
    if (found.length > 0) {
      out.push({
        path: at('columns', name),
        message: `"${box.table}.${ref}" is the outbox's ${name}, which Adminium writes, so it takes no ${found.join(' or ')} rule`,
      });
    }
  }
  /*
   * Nor may a rule of ANOTHER column read one of them where the read can
   * refuse a write: a `skip_note` required while the status is `sent` refuses
   * the very write that marks a message sent, and the message is stuck.
   */
  const written = new Map<string, string>();
  for (const name of Object.keys(OUTBOX_WRITTEN) as (keyof typeof OUTBOX_WRITTEN)[]) {
    const ref = box.columns[name];
    if (ref !== undefined) written.set(ref, name);
  }
  for (const column of index.table(box.table)?.columns ?? []) {
    for (const { rule, reads } of rulesReading((column as { rules?: unknown }).rules)) {
      const name = written.get(reads);
      if (name === undefined || reads === column.ref) continue;
      out.push({
        path: at('columns', name),
        message: `"${box.table}.${column.ref}" has a ${rule} rule that reads "${reads}", the outbox's ${name}, which Adminium writes as it sends, so its own writes would be refused`,
      });
    }
  }
  const holds = (box.producers ?? []).some((producer) => producer.hold === true);
  if (holds && status !== undefined && !(status.enum ?? []).includes(OUTBOX_HELD)) {
    out.push({ path: at('columns', 'status'), message: `a producer holds its messages, so "${box.table}.${status.ref}" offers "${OUTBOX_HELD}"` });
  }
  if (holds && box.columns.due === undefined) {
    out.push({ path: at('columns'), message: 'a held message waits for its due moment: name the outbox\'s due column' });
  }
  const setting = (source: SettingSource, path: (string | number)[]) => {
    if ('addOn' in source) {
      if (!(m.addOns?.requires ?? []).some((need) => need.key === source.addOn)) {
        out.push({ path, message: `"${source.addOn}" is not required by the app (addOns.requires), so its setting may not be there` });
      }
    } else {
      col(source.table, source.column, null, path, '');
    }
  };

  const linkTargets = new Map<string, string | undefined>();
  for (const [name, ref] of Object.entries(box.links ?? {})) {
    linkTargets.set(ref, fk(box.table, ref, undefined, at('links', name))?.references);
  }

  const r = box.recipient;
  fk(box.table, r.via, r.table, at('recipient', 'via'));
  col(r.table, r.email, ['text'], at('recipient', 'email'), 'a text column');
  if (r.name !== undefined) col(r.table, r.name, ['text'], at('recipient', 'name'), 'a text column');
  if (typeof r.language === 'string') col(r.table, r.language, ['text'], at('recipient', 'language'), 'a text column');
  else if (r.language !== undefined && box.columns.language === undefined) {
    out.push({ path: at('recipient', 'language'), message: 'a message\'s language read from the row it is about is kept in the outbox\'s language column: name it' });
  }
  if (r.optIn !== undefined) col(r.table, r.optIn, ['bool'], at('recipient', 'optIn'), 'a bool');
  if (r.fallback !== undefined) {
    const via = fk(box.table, r.fallback.via, undefined, at('recipient', 'fallback', 'via'));
    const holder = via?.references;
    if (holder !== undefined) {
      col(holder, r.fallback.email, ['text'], at('recipient', 'fallback', 'email'), 'a text column');
      if (r.fallback.name !== undefined) col(holder, r.fallback.name, ['text'], at('recipient', 'fallback', 'name'), 'a text column');
      if (r.fallback.language !== undefined) col(holder, r.fallback.language, ['text'], at('recipient', 'fallback', 'language'), 'a text column');
    }
  }

  if (box.settings !== undefined && index.table(box.settings.table) === undefined) {
    out.push({ path: at('settings', 'table'), message: `"${box.settings.table}" is not a table of this app` });
  } else if (box.settings !== undefined) {
    if (box.settings.enabled !== undefined) col(box.settings.table, box.settings.enabled, ['bool'], at('settings', 'enabled'), 'a bool');
    if (box.settings.name !== undefined) col(box.settings.table, box.settings.name, ['text'], at('settings', 'name'), 'a text column');
    if (box.settings.phone !== undefined) col(box.settings.table, box.settings.phone, ['text'], at('settings', 'phone'), 'a text column');
    if (box.settings.replyTo !== undefined) col(box.settings.table, box.settings.replyTo, ['text'], at('settings', 'replyTo'), 'a text column (an address)');
  }

  for (const [value, template] of Object.entries(box.kinds)) {
    if (kind !== undefined && !(kind.enum ?? []).includes(value)) {
      out.push({ path: at('kinds', value), message: `"${value}" is not a value of "${box.table}.${kind.ref}"` });
    }
    if (!templates.has(template)) out.push({ path: at('kinds', value), message: `"${template}" is not one of the app's emailTemplates` });
  }

  const unlisted = (table: string, column: string) => unlistedColumn(m, table, column);
  (box.producers ?? []).forEach((producer, p) => {
    const here = (...rest: (string | number)[]) => at('producers', p, ...rest);
    if (box.kinds[producer.kind] === undefined) out.push({ path: here('kind'), message: `"${producer.kind}" is not one of the outbox's kinds` });
    if (producer.gate === 'enabled' && box.settings?.enabled === undefined) {
      out.push({ path: here('gate'), message: 'the outbox names no settings column to be gated by' });
    } else if (typeof producer.gate === 'object') {
      // Each half judged as it is alone: a feature the app declares, a bool of the settings row.
      if ('feature' in producer.gate) {
        const feature = producer.gate.feature;
        if (!(m.addOns?.features ?? []).some((candidate) => candidate.id === feature)) {
          out.push({ path: here('gate', 'feature'), message: `"${feature}" is not one of the app's addOns.features` });
        }
      }
      if ('setting' in producer.gate) col(producer.gate.setting.table, producer.gate.setting.column, ['bool'], here('gate', 'setting'), 'a bool');
    }
    if (producer.optIn === true && r.optIn === undefined) {
      out.push({ path: here('optIn'), message: 'the recipient names no opt-in column' });
    }
    const source = 'onCreate' in producer ? producer.onCreate : 'onChange' in producer ? producer.onChange : producer.before;
    if (index.table(source.table) === undefined) {
      out.push({ path: here(), message: `"${source.table}" is not a table of this app` });
      return;
    }
    // A child source links the row its foreign key points at.
    const via = 'via' in source ? source.via : undefined;
    let linked = source.table;
    if (via !== undefined) {
      const found = fk(source.table, via, undefined, here('via'));
      if (found?.references !== undefined) linked = found.references;
    }
    if (!linkTargets.has(producer.link)) {
      out.push({ path: here('link'), message: `"${producer.link}" is not one of the outbox's links` });
    } else if (linkTargets.get(producer.link) !== undefined && linkTargets.get(producer.link) !== linked) {
      out.push({ path: here('link'), message: `"${box.table}.${producer.link}" does not point at "${linked}"` });
    }
    condition(source.table, source.where, here('where'));
    if (producer.due !== undefined) {
      const due = producer.due;
      if (box.columns.due === undefined) out.push({ path: here('due'), message: 'a due moment is kept in the outbox\'s due column, and none is named' });
      col(linked, due.date, ['date', 'timestamptz'], here('due', 'date'), 'a date');
      if (typeof due.days === 'object') {
        if ('setting' in due.days) setting(due.days.setting, here('due', 'days', 'setting'));
        const by = due.days.byColumn;
        if (by !== undefined) {
          const found = col(linked, by, null, here('due', 'days', 'byColumn'), '');
          if (found !== undefined && 'values' in due.days) {
            const missing = (found.enum ?? []).filter((value) => (due.days as { values: Record<string, number> }).values[value] === undefined);
            if (missing.length > 0) out.push({ path: here('due', 'days', 'values'), message: `each value of "${linked}.${by}" needs its days (${missing.join(', ')})` });
          }
        }
      }
      if ('before' in producer) out.push({ path: here('due'), message: 'a reminder before a moment is due by its lead, not by due' });
    }
    // A batch comes due when its window closes: that is its due, and it takes no other.
    if (producer.batchMinutes !== undefined && producer.due !== undefined) {
      out.push({ path: here('due'), message: 'a batch comes due when its window closes, so it takes no due of its own' });
    }
    if (producer.supersede !== undefined && producer.due === undefined && producer.batchMinutes === undefined) {
      out.push({ path: here('supersede'), message: 'one message overtakes another when it comes due: name its due' });
    }
    (producer.dropWhen ?? []).forEach((drop, d) => {
      const found = col(linked, drop.column, null, here('dropWhen', d, 'column'), '');
      const values = drop.eq !== undefined ? [drop.eq] : (drop.in ?? []);
      if (found !== undefined) for (const value of values) {
        if (!valueFits(found, value)) out.push({ path: here('dropWhen', d), message: `${JSON.stringify(value)} is not a value of "${linked}.${drop.column}"` });
      }
    });
    if (producer.dropWhen !== undefined && producer.hold !== true && producer.due === undefined && producer.batchMinutes === undefined && producer.holdSeconds === undefined) {
      out.push({ path: here('dropWhen'), message: 'only a message that waits (held, or due later) can be dropped' });
    }
    // A short wait before it may go: kept in the due column, and the only wait it has.
    if (producer.holdSeconds !== undefined) {
      if (box.columns.due === undefined) out.push({ path: here('holdSeconds'), message: 'a message waits in the outbox\'s due column, and none is named' });
      const other = producer.hold === true ? 'hold' : producer.due !== undefined ? 'due' : producer.batchMinutes !== undefined ? 'batchMinutes' : 'before' in producer ? 'before' : null;
      if (other !== null) out.push({ path: here('holdSeconds'), message: `a message that waits a few seconds takes no ${other} as well` });
    }
    // One message per value of a column of the row it is about: kept as a digest in the outbox.
    if (producer.repeatBy !== undefined) {
      col(linked, producer.repeatBy, null, here('repeatBy'), '');
      if (box.columns.repeatKey === undefined) out.push({ path: here('repeatBy'), message: 'which value a message was sent for is kept in the outbox\'s repeatKey column, and none is named' });
      const other = 'before' in producer ? 'before' : producer.batchMinutes !== undefined ? 'batchMinutes' : null;
      if (other !== null) out.push({ path: here('repeatBy'), message: `a message sent again for each value takes no ${other}: that is one per row or window already` });
    }
    if (producer.recipient !== undefined) {
      if ('setting' in producer.recipient) setting(producer.recipient.setting, here('recipient', 'setting'));
      else {
        col(linked, producer.recipient.column, ['text'], here('recipient', 'column'), 'a text column');
        if (producer.recipient.name !== undefined) col(linked, producer.recipient.name, ['text'], here('recipient', 'name'), 'a text column');
        if (producer.recipient.language !== undefined) {
          col(linked, producer.recipient.language, ['text'], here('recipient', 'language'), 'a text column');
          if (box.columns.language === undefined) out.push({ path: here('recipient', 'language'), message: 'a message\'s language is kept in the outbox\'s language column: name it' });
        }
      }
    }
    // The language read from the row a message is about: every producer's row has it.
    if (typeof r.language === 'object') col(linked, r.language.column, ['text'], here(), 'a text column (the message\'s language)');
    if (producer.batchMinutes !== undefined && 'before' in producer) {
      out.push({ path: here('batchMinutes'), message: 'a reminder before a moment is one per row already' });
    }
    if (producer.onSent !== undefined) {
      const effect = producer.onSent;
      if (index.table(effect.table) === undefined) {
        out.push({ path: here('onSent', 'table'), message: `"${effect.table}" is not a table of this app` });
      } else {
        if (effect.via === undefined) {
          if (effect.table !== linked) out.push({ path: here('onSent', 'table'), message: `the message is about "${linked}"; name the foreign key (via) that reaches "${effect.table}"` });
        } else {
          fk(linked, effect.via, effect.table, here('onSent', 'via'));
        }
        const states = (index.table(effect.table) as { states?: { column: string; moves: Readonly<Record<string, readonly StateMove[]>> } } | undefined)?.states;
        for (const [ref, value] of Object.entries(effect.set)) {
          const found = col(effect.table, ref, null, here('onSent', 'set', ref), '');
          // An email's change names no state it saw: a state only an undo reaches is never its to make.
          if (states?.column === ref && value !== null && reachedOnlyByUndo(states, value)) {
            out.push({ path: here('onSent', 'set', ref), message: `every move of "${effect.table}" to ${JSON.stringify(value)} is an undo, which only a person makes` });
          }
          if (found !== undefined && value === null && found.nullable !== true) {
            out.push({ path: here('onSent', 'set', ref), message: `"${effect.table}.${ref}" is never empty` });
          } else if (found !== undefined && value !== null && !valueFits(found, value)) {
            out.push({ path: here('onSent', 'set', ref), message: `${JSON.stringify(value)} is not a value of "${effect.table}.${ref}"` });
          }
        }
      }
    }
    if ('onChange' in producer) {
      const change = producer.onChange;
      if ('columns' in change) {
        change.columns.forEach((column, c) => {
          col(change.table, column, null, here('onChange', 'columns', c), '');
          if (change.columns.indexOf(column) !== c) out.push({ path: here('onChange', 'columns', c), message: `"${column}" is listed twice` });
        });
      } else {
        const watched = col(change.table, change.column, null, here('onChange', 'column'), '');
        if (watched !== undefined) for (const value of Array.isArray(change.to) ? change.to : [change.to]) {
          if (!valueFits(watched, value)) out.push({ path: here('onChange', 'to'), message: `${JSON.stringify(value)} is not a value of "${change.table}.${change.column}"` });
        }
      }
    }
    // One message per change it hears of: a producer that listens for changes, and repeats no other way.
    if (producer.repeat === true) {
      if (!('onChange' in producer)) out.push({ path: here('repeat'), message: 'a message is sent for each change by a producer that listens for changes (onChange)' });
      const other = producer.repeatBy !== undefined ? 'repeatBy' : producer.batchMinutes !== undefined ? 'batchMinutes' : null;
      if (other !== null) out.push({ path: here('repeat'), message: `a message sent for each change takes no ${other}` });
    }
    // The changed row's columns as they were: kept on the message, read as {{was.<column>}}.
    if (producer.was !== undefined) {
      if (!('onChange' in producer)) out.push({ path: here('was'), message: 'a message keeps what a row was before a change on a producer that listens for changes (onChange)' });
      else {
        const table = producer.onChange.table;
        producer.was.forEach((column, c) => {
          const found = col(table, column, null, here('was', c), '');
          if (producer.was!.indexOf(column) !== c) out.push({ path: here('was', c), message: `"${column}" is listed twice` });
          // Personal data as the install tells it too: by its mark, or guessed by its name — a message keeps it empty.
          const tableDoc = m.requiredSchema.tables.find((candidate) => candidate.ref === table) as Parameters<typeof personalColumn>[0] | undefined;
          const guessed = tableDoc !== undefined && personalColumn(tableDoc, column) === 'guessed' ? 'personal data' : null;
          const kept = found === undefined ? null : (unlisted(table, column) ?? guessed);
          if (kept !== null) out.push({ path: here('was', c), message: `"${table}.${column}" is ${kept}, which a message never keeps` });
        });
      }
      if (box.columns.was === undefined) out.push({ path: here('was'), message: 'a message keeps what a row was in the outbox\'s was column, and none is named' });
    }
    if ('before' in producer) {
      const before = producer.before;
      col(before.table, before.at, ['timestamptz'], here('before', 'at'), 'a timestamptz');
      fk(before.table, before.lead.via, before.lead.table, here('before', 'lead', 'via'));
      col(before.lead.table, before.lead.column, ['int', 'bigint'], here('before', 'lead', 'column'), 'an int');
      if (before.lead.fallback !== undefined) {
        col(before.lead.fallback.table, before.lead.fallback.column, ['int', 'bigint'], here('before', 'lead', 'fallback'), 'an int');
      }
      if (box.columns.due === undefined) {
        out.push({ path: here('before'), message: 'a reminder records the moment it leads in the outbox\'s due column, and none is named' });
      }
    }
  });
  const named = new Set([...(m.kind === 'add-on' ? [m.key] : []), ...(m.addOns?.requires ?? []), ...(m.addOns?.suggests ?? [])].map((need) => (typeof need === 'string' ? need : need.key)));
  out.push(...emailBlockIssues(m.emailTemplates ?? [], box, index, (table, column) => unlistedColumn(m, table, column), named));
  return out;
}

// ── blocks that list rows, and QR codes ──────────────────────────────────────

/**
 * `email.rows`: the rows of a child table that link to the row an outbox link
 * names, one line each (an order's tickets, with a QR code each). `from` is
 * the documents' collection spelling: the link, the child table, the child's
 * link back, its order, a filter and a bool that leaves a row out, and at
 * most 50 rows. `joins` gathers up to two child lists of each row into one
 * text (a dish's options). `row` is each line's text, reading `{{row.<column>}}`
 * (`{{row.<link>.<column>}}` through one of the row's own links, and a join by
 * its name); `image` is a QR code of a code column (`{{row.code.qr}}`) and
 * nothing else. `empty` is said when there are no rows; without it the block
 * is left out.
 */
export const emailRowsDataSchema = z
  .object({
    from: z.union([
      z
        .object({
          link: z.string().regex(/^[a-z][a-z_]*$/, 'a link name is snake_case'),
          table: refSchema,
          via: refSchema,
          orderBy: refSchema.optional(),
          where: z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(32) }).strict().optional(),
          unless: refSchema.optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .strict(),
      /**
       * Rows of an add-on's table that belong to the row a link names, found
       * by the table-and-row pair the add-on keeps (what was applied to an
       * order). `table` and `match` are the add-on's own short names.
       */
      z
        .object({
          link: z.string().regex(/^[a-z][a-z_]*$/, 'a link name is snake_case'),
          addOn: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'an add-on key'),
          table: refSchema,
          match: z.object({ table: refSchema, row: refSchema }).strict(),
          orderBy: refSchema.optional(),
          where: z.object({ column: refSchema, in: z.array(scalarSchema).min(1).max(32) }).strict().optional(),
          unless: refSchema.optional(),
          limit: z.number().int().min(1).max(50).optional(),
        })
        .strict(),
    ]),
    joins: z
      .record(
        refSchema,
        z
          .object({ table: refSchema, via: refSchema, column: refSchema, orderBy: refSchema.optional(), separator: z.string().min(1).max(8).optional() })
          .strict(),
      )
      .refine((joins) => Object.keys(joins).length >= 1 && Object.keys(joins).length <= 2, { message: 'a row joins one or two lists' })
      .optional(),
    row: z
      .object({
        title: z.string().min(1).max(300).optional(),
        meta: z.string().min(1).max(300).optional(),
        amount: z.string().min(1).max(300).optional(),
        note: z.string().min(1).max(300).optional(),
        image: z.string().min(1).max(300).optional(),
      })
      .strict(),
    empty: z.string().min(1).max(200).optional(),
  })
  .strict();
export type EmailRowsData = z.infer<typeof emailRowsDataSchema>;

/** A QR code of a code column, as the whole value of an image: `{{ticket.code.qr}}`. */
const QR_VALUE = /^\{\{\s*([A-Za-z0-9_.-]+)\.qr\s*\}\}$/;
const PLACEHOLDERS = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;

/** Every string inside a value, with the path it sits at. */
function stringsIn(value: unknown, path: (string | number)[], out: { text: string; path: (string | number)[] }[] = []) {
  if (typeof value === 'string') out.push({ text: value, path });
  else if (Array.isArray(value)) value.forEach((item, i) => stringsIn(item, [...path, i], out));
  else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) stringsIn(item, [...path, key], out);
  return out;
}

/**
 * Everything wrong with the blocks of the app's templates that list rows or
 * draw a QR code: the rows' link, table and columns; each `{{row.*}}` a row
 * can fill; the same rows in every language; and a QR code only as a whole
 * image value, of a code column.
 */
function emailBlockIssues(
  templates: readonly EmailTemplate[],
  box: Outbox,
  index: TableIndex,
  unlisted: (table: string, column: string) => string | null,
  /** The add-ons whose rows a block may list: the ones the manifest names, and itself when it is one. */
  named: ReadonlySet<string> = new Set(),
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const links = box.links ?? {};
  /** The table a link names. */
  const linkTable = (link: string): string | undefined => {
    const column = links[link];
    return column === undefined ? undefined : index.column(box.table, column)?.references;
  };
  /** The table a template prefix reads (`ticket`, `order.event`), when the manifest can place it. */
  const prefixTable = (prefix: string): string | undefined => {
    const [head, ...rest] = prefix.split('.');
    let table = linkTable(head!);
    for (const base of rest) {
      if (table === undefined) return undefined;
      table = index.column(table, `${base}_id`)?.references;
    }
    return table;
  };
  /** Why `{{<prefix>.<column>.qr}}` draws no QR code, or null. */
  const qrIssue = (table: string | undefined, name: string): string | null => {
    const parts = name.split('.');
    const column = parts.at(-1)!;
    if (table === undefined) return null;
    const found = index.column(table, column) as (ReturnType<typeof index.column> & { rules?: { code?: unknown } }) | undefined;
    if (found === undefined) return `"${table}" has no column "${column}"`;
    if (found.type !== 'text' || found.rules?.code === undefined) return `"${table}.${column}" is not a code column, so it has no QR code`;
    return null;
  };

  templates.forEach((template, t) => {
    let rowsOf: string | undefined;
    for (const [locale, content] of Object.entries(template.locales)) {
      const here = (...rest: (string | number)[]) => ['emailTemplates', t, 'locales', locale, ...rest];
      const rows: string[] = [];
      content.blocks.forEach((block, b) => {
        const at = (...rest: (string | number)[]) => here('blocks', b, ...rest);
        const qrSlot = block.block === 'email.image' ? block.data?.['qr'] : undefined;
        // A QR code is the whole value of an image, and nothing else.
        for (const { text, path } of stringsIn({ subject: content.subject, preheader: content.preheader, footer: content.footer, data: block.data }, [])) {
          if (!/\.qr\s*\}\}/.test(text)) continue;
          const isSlot = (block.block === 'email.image' && path.join('.') === 'data.qr') || (block.block === 'email.rows' && path.join('.') === 'data.row.image');
          if (!isSlot || !QR_VALUE.test(text)) out.push({ path: path[0] === 'data' ? at(...path) : here(path[0]!), message: 'a QR code is the whole value of an image (email.image "qr", or a row\'s "image"), nowhere else' });
        }
        if (block.block === 'email.image' && qrSlot !== undefined) {
          const match = typeof qrSlot === 'string' ? QR_VALUE.exec(qrSlot) : null;
          if (match === null) out.push({ path: at('data', 'qr'), message: 'an image\'s QR code is written {{<link>.<column>.qr}}' });
          else if (match[1]!.startsWith('row.')) out.push({ path: at('data', 'qr'), message: 'a row\'s QR code is drawn by an email.rows block' });
          else {
            const parts = match[1]!.split('.');
            const issue = qrIssue(prefixTable(parts.slice(0, -1).join('.')), match[1]!);
            if (issue !== null) out.push({ path: at('data', 'qr'), message: issue });
          }
          const size = block.data?.['size'];
          if (size !== undefined && (typeof size !== 'number' || !Number.isInteger(size) || size < 80 || size > 200)) {
            out.push({ path: at('data', 'size'), message: 'a QR code is 80 to 200 pixels across' });
          }
        }
        if (block.block !== 'email.rows') {
          // Only a block that lists rows has a row to read.
          for (const { text, path } of stringsIn(block.data, [])) {
            if ([...text.matchAll(PLACEHOLDERS)].some((m) => m[1]!.startsWith('row.'))) {
              out.push({ path: at('data', ...path), message: '{{row.…}} is read only inside an email.rows block' });
            }
          }
          return;
        }
        const parsed = emailRowsDataSchema.safeParse(block.data ?? {});
        if (!parsed.success) {
          for (const issue of parsed.error.issues) out.push({ path: at('data', ...issue.path.map((p) => (typeof p === 'symbol' ? String(p) : p))), message: issue.message });
          return;
        }
        const data = parsed.data;
        rows.push(JSON.stringify({ from: data.from, joins: data.joins ?? null }));
        const from = data.from;
        const parent = linkTable(from.link);
        if (links[from.link] === undefined) out.push({ path: at('data', 'from', 'link'), message: `"${from.link}" is not one of the outbox's links` });
        if ('addOn' in from) {
          // An add-on's rows: its table and columns are checked where its manifest is at hand, at install.
          if (!named.has(from.addOn)) out.push({ path: at('data', 'from', 'addOn'), message: `"${from.addOn}" is not an add-on this manifest names: add it to addOns.requires or addOns.suggests` });
          if (data.joins !== undefined) out.push({ path: at('data', 'joins'), message: 'rows of an add-on\'s table join no list of this manifest\'s' });
          return;
        }
        if (index.table(from.table) === undefined) {
          out.push({ path: at('data', 'from', 'table'), message: `"${from.table}" is not a table of this app` });
          return;
        }
        const via = index.column(from.table, from.via);
        if (via?.type !== 'fk' || (parent !== undefined && via.references !== parent)) {
          out.push({ path: at('data', 'from', 'via'), message: `"${from.table}.${from.via}" does not point at the row "${from.link}" names` });
        }
        for (const [name, ref] of [['orderBy', from.orderBy], ['where', from.where?.column], ['unless', from.unless]] as const) {
          if (ref !== undefined && index.column(from.table, ref) === undefined) out.push({ path: at('data', 'from', name), message: `"${from.table}" has no column "${ref}"` });
        }
        if (from.unless !== undefined && index.column(from.table, from.unless) !== undefined && index.column(from.table, from.unless)?.type !== 'bool') {
          out.push({ path: at('data', 'from', 'unless'), message: `"${from.table}.${from.unless}" is not a bool` });
        }
        const where = from.where;
        const filter = where === undefined ? undefined : index.column(from.table, where.column);
        if (where !== undefined && filter !== undefined) {
          for (const value of where.in) if (!valueFits(filter, value)) out.push({ path: at('data', 'from', 'where'), message: `${JSON.stringify(value)} is not a value of "${from.table}.${where.column}"` });
        }
        for (const [name, join] of Object.entries(data.joins ?? {})) {
          const path = at('data', 'joins', name);
          if (index.table(join.table) === undefined) {
            out.push({ path, message: `"${join.table}" is not a table of this app` });
            continue;
          }
          const back = index.column(join.table, join.via);
          if (back?.type !== 'fk' || back.references !== from.table) out.push({ path: [...path, 'via'], message: `"${join.table}.${join.via}" does not point at "${from.table}"` });
          const shown = index.column(join.table, join.column);
          if (shown === undefined) out.push({ path: [...path, 'column'], message: `"${join.table}" has no column "${join.column}"` });
          else if (shown.type !== 'text') out.push({ path: [...path, 'column'], message: `"${join.table}.${join.column}" is not a text column` });
          else {
            const kept = unlisted(join.table, join.column);
            if (kept !== null) out.push({ path: [...path, 'column'], message: `"${join.table}.${join.column}" is ${kept}, which an email never lists from another row` });
          }
          if (join.orderBy !== undefined && index.column(join.table, join.orderBy) === undefined) out.push({ path: [...path, 'orderBy'], message: `"${join.table}" has no column "${join.orderBy}"` });
        }
        // Each {{row.*}} names something a row fills, in a form its type has.
        for (const { text, path } of stringsIn({ row: data.row, empty: data.empty }, [])) {
          for (const m of text.matchAll(PLACEHOLDERS)) {
            const name = m[1]!;
            if (!name.startsWith('row.')) continue;
            const parts = name.split('.').slice(1);
            const where = at('data', ...path);
            if (parts.length === 1 && data.joins?.[parts[0]!] !== undefined) continue;
            const qr = parts.at(-1) === 'qr';
            const bare = qr ? parts.slice(0, -1) : parts;
            // `row.col`, `row.col.form`, and one link of the row's own: `row.base.col`, `row.base.col.form` (through `base_id`).
            let table = from.table;
            let column = bare[0]!;
            let form = bare[1];
            if (index.column(from.table, column) === undefined) {
              const link = index.column(from.table, `${column}_id`);
              if (link?.type !== 'fk' || link.references === undefined) {
                out.push({ path: where, message: `{{${name}}}: "${from.table}" has no column "${column}", no link "${column}_id" and no join "${column}"` });
                continue;
              }
              table = link.references;
              column = bare[1] ?? '';
              form = bare[2];
            }
            const found = index.column(table, column);
            if (found === undefined) {
              out.push({ path: where, message: `{{${name}}}: "${table}" has no column "${column}"` });
              continue;
            }
            if (qr) {
              if (path.join('.') !== 'row.image') continue; // said above
              const issue = qrIssue(table, `${table}.${column}`);
              if (issue !== null) out.push({ path: where, message: issue });
            } else if (form !== undefined && !rowFormsOf(found).includes(form)) {
              out.push({
                path: where,
                message:
                  form === 'time' && found.type === 'text'
                    ? `{{${name}}}: "${table}.${column}" is not a time of day kept as text (a text column of at most 8 characters), so it has no "time" form`
                    : `{{${name}}}: "${table}.${column}" is a ${found.type} column, which has no "${form}" form`,
              });
            }
          }
        }
        if (data.row.image !== undefined && !QR_VALUE.test(data.row.image)) {
          out.push({ path: at('data', 'row', 'image'), message: 'a row\'s image is a QR code of a code column: {{row.<column>.qr}}' });
        }
      });
      // A translation changes the words, never which rows are listed.
      const key = rows.join('\n');
      if (rowsOf === undefined) rowsOf = key;
      else if (key !== rowsOf) out.push({ path: here('blocks'), message: 'every language lists the same rows: from and joins are the same in each' });
    }
  });
  return out;
}

/** The forms of a number: as a number, a percentage and an amount of money, in the message's language. */
const NUMBER_FORMS = ['number', 'percent', 'money'] as const;

/** The forms of a value a row's column may be read in, by its type (as the sender fills a template's). */
const ROW_FORMS: Readonly<Record<string, readonly string[]>> = {
  timestamptz: ['date', 'time', 'day_month', 'relative_day'],
  date: ['day_month', 'days_since'],
  int: NUMBER_FORMS,
  bigint: NUMBER_FORMS,
  decimal: NUMBER_FORMS,
  money: NUMBER_FORMS,
  float: NUMBER_FORMS,
  // A choice by its label; a time of day kept as text (`15:00`) in the reader's clock.
  enum: ['label'],
  text: ['time'],
};

/** The most characters a time of day kept as text takes: `09:30:00`. */
export const CLOCK_TEXT_MAX = 8;

/**
 * Whether a text column keeps a time of day (`15:00`): one no longer than
 * {@link CLOCK_TEXT_MAX} characters. Only such a column has a `time` form —
 * the sender fills it from a value shaped like a clock, and a longer text
 * column (a note, a name) never holds one.
 */
export function clockShaped(column: { type: string; maxLength?: number | undefined; rules?: { validation?: { maxLength?: number | undefined } | undefined } | undefined }): boolean {
  if (column.type !== 'text') return false;
  const widths = [column.maxLength, column.rules?.validation?.maxLength].filter((width): width is number => typeof width === 'number');
  return widths.length > 0 && Math.min(...widths) <= CLOCK_TEXT_MAX;
}

/** The form of a code in groups of four (`K7QX-M2PD`), as a person reads it out. */
export const GROUPED_FORM = 'grouped';

/**
 * A code in groups of four joined by `-` (`K7QXM2PD` → `K7QX-M2PD`), the way
 * a person reads it out; separators already in it are dropped first. Empty
 * stays empty.
 *
 * A code kept with a prefix keeps it whole (`GC-7K2M9QXA41TR` with `GC-` →
 * `GC-7K2M-9QXA-41TR`): the prefix is what tells a card from a voucher, and
 * cut into the first group of four it reads as part of the code. A value
 * that does not start with the prefix is grouped as any other.
 */
export function groupedCode(value: unknown, prefix = ''): string {
  if (value === null || value === undefined) return '';
  const fours = (text: string): string => (text.match(/.{1,4}/g) ?? []).join('-');
  const bare = String(value).replace(/[\s-]+/g, '');
  const head = prefix.replace(/[^0-9A-Za-z]/g, '');
  if (head !== '' && bare.length > head.length && bare.toUpperCase().startsWith(head.toUpperCase())) return prefix + fours(bare.slice(head.length));
  return fours(bare);
}

/** Whether a column holds a code Adminium makes: a text column with a `code` rule. */
export function isCodeColumn(column: { type: string; rules?: { code?: unknown } | undefined }): boolean {
  return column.type === 'text' && column.rules?.code !== undefined;
}

/** The forms a row's column may be read in: its type's, a text column's `time` only when it keeps a time of day, and a code's groups. */
export function rowFormsOf(column: Parameters<typeof clockShaped>[0] & { rules?: { code?: unknown } | undefined }): readonly string[] {
  const forms = ROW_FORMS[column.type] ?? [];
  const own = column.type === 'text' && !clockShaped(column) ? forms.filter((form) => form !== 'time') : forms;
  return isCodeColumn(column) ? [...own, GROUPED_FORM] : own;
}
