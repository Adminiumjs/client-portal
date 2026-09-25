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
  gate: z.union([z.literal('enabled'), z.object({ setting: settingRefSchema }).strict()]).optional(),
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
  /** Sent to an address a setting holds (the studio's own) instead of the outbox's recipient. */
  recipient: z.object({ setting: settingSourceSchema }).strict().optional(),
  /** One message per linked row in each window of this many minutes. */
  batchMinutes: z.number().int().min(1).max(240).optional(),
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
      onChange: z
        .object({
          table: refSchema,
          via: refSchema.optional(),
          column: refSchema,
          to: z.union([scalarSchema, z.array(scalarSchema).min(1).max(16)]),
          where: conditionSchema.optional(),
        })
        .strict(),
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
    language: refSchema.optional(),
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
      .object({ table: refSchema, enabled: refSchema.optional(), name: refSchema.optional(), phone: refSchema.optional() })
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
    attach: z.object({ kind: z.string().regex(/^[a-z][a-z0-9-]*$/, 'a document kind'), link: z.string().min(1).max(40) }).strict().optional(),
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
const DECIDING_RULES = ['copy', 'default', 'sequence', 'format', 'code', 'rollup', 'formula', 'stamp'] as const;

/** Everything in `outbox` and `emailTemplates` that names something undeclared, or does not fit. */
export function outboxIssues(
  m: {
    key: string;
    outbox?: Outbox | undefined;
    emailTemplates?: readonly EmailTemplate[] | undefined;
    addOns?: AddOnNeeds | undefined;
  },
  index: TableIndex,
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const templates = new Set<string>();
  (m.emailTemplates ?? []).forEach((template, i) => {
    if (template.attach !== undefined && m.outbox?.links?.[template.attach.link] === undefined) {
      out.push({ path: ['emailTemplates', i, 'attach', 'link'], message: `"${template.attach.link}" is not one of the outbox's links` });
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
  /*
   * The columns Adminium writes as it sends and as a person approves or skips
   * a message. A rule of the app's own that decides one of them (a stamp of
   * who approved) races Adminium for it, and the desk's every message is then
   * refused for writing a column only Adminium writes.
   */
  for (const name of ['status', 'sentAt', 'error', 'skipReason', 'approvedBy', 'effectAt', 'effectError'] as const) {
    const ref = box.columns[name];
    if (ref === undefined) continue;
    const rules = (index.column(box.table, ref) as { rules?: Partial<Record<(typeof DECIDING_RULES)[number], unknown>> } | undefined)?.rules;
    const deciding = DECIDING_RULES.filter((rule) => rules?.[rule] !== undefined);
    if (deciding.length > 0) {
      out.push({
        path: at('columns', name),
        message: `"${box.table}.${ref}" is the outbox's ${name}, which Adminium writes, so it takes no ${deciding.join(' or ')} rule`,
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
  if (r.language !== undefined) col(r.table, r.language, ['text'], at('recipient', 'language'), 'a text column');
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
  }

  for (const [value, template] of Object.entries(box.kinds)) {
    if (kind !== undefined && !(kind.enum ?? []).includes(value)) {
      out.push({ path: at('kinds', value), message: `"${value}" is not a value of "${box.table}.${kind.ref}"` });
    }
    if (!templates.has(template)) out.push({ path: at('kinds', value), message: `"${template}" is not one of the app's emailTemplates` });
  }

  (box.producers ?? []).forEach((producer, p) => {
    const here = (...rest: (string | number)[]) => at('producers', p, ...rest);
    if (box.kinds[producer.kind] === undefined) out.push({ path: here('kind'), message: `"${producer.kind}" is not one of the outbox's kinds` });
    if (producer.gate === 'enabled' && box.settings?.enabled === undefined) {
      out.push({ path: here('gate'), message: 'the outbox names no settings column to be gated by' });
    } else if (typeof producer.gate === 'object') {
      col(producer.gate.setting.table, producer.gate.setting.column, ['bool'], here('gate', 'setting'), 'a bool');
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
    if (producer.dropWhen !== undefined && producer.hold !== true && producer.due === undefined && producer.batchMinutes === undefined) {
      out.push({ path: here('dropWhen'), message: 'only a message that waits (held, or due later) can be dropped' });
    }
    if (producer.recipient !== undefined) setting(producer.recipient.setting, here('recipient', 'setting'));
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
        for (const [ref, value] of Object.entries(effect.set)) {
          const found = col(effect.table, ref, null, here('onSent', 'set', ref), '');
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
      const watched = col(change.table, change.column, null, here('onChange', 'column'), '');
      if (watched !== undefined) for (const value of Array.isArray(change.to) ? change.to : [change.to]) {
        if (!valueFits(watched, value)) out.push({ path: here('onChange', 'to'), message: `${JSON.stringify(value)} is not a value of "${change.table}.${change.column}"` });
      }
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
  return out;
}
