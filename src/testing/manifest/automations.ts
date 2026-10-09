/*
 * VENDORED VERBATIM from packages/manifest/src/automations.ts.
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
 * RULES A MANIFEST SHIPS (`automations`).
 *
 * An app or an add-on may bring automation rules with it: "when a stock
 * point falls to its reorder level, write a request and tell the managers".
 * A rule is written here as the rules page stores one — a trigger, then a
 * flow of steps — with three differences, because a manifest knows nothing of
 * the install it will land on:
 *
 *  - tables are the manifest's own, by their short names; no connection;
 *  - a notice goes to the manifest's own roles, an email to a column of the
 *    record through one of the manifest's own templates: never a fixed
 *    address, a user, a web address or a document profile's id;
 *  - a title or a notice's text may be given in several languages; the
 *    install keeps the one the instance speaks.
 *
 * Each rule has a `key`. It is how an update finds the rule it shipped
 * before, and tells one the owner has edited from one it may replace.
 *
 * Pure, and nothing imported from the manifest's own schema file.
 */
import { z } from 'zod';

import { bcp47TagSchema, refSchema, type ReferenceIssue } from './refs.ts';

/** The most rules one manifest ships, and the most steps one rule holds. */
export const MANIFEST_AUTOMATIONS_MAX = 12;
export const AUTOMATION_NODES_MAX = 40;

/** One text, or the same text in several languages (US English always among them). */
const localized = (max: number) =>
  z.union([z.string().max(max), z.record(bcp47TagSchema, z.string().min(1).max(max)).refine((texts) => texts['en-US'] !== undefined, { message: 'a text in several languages includes en-US' })]);

const durationUnit = z.enum(['minutes', 'hours', 'days']);
const DAY_MS = 86_400_000;
const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: DAY_MS } as const;

export const AUTOMATION_CONDITION_OPS = ['is', 'is_not', 'contains', 'gt', 'lt', 'is_empty', 'not_empty', 'within_next', 'within_last', 'more_than_ago', 'more_than_ahead'] as const;
type ConditionOp = (typeof AUTOMATION_CONDITION_OPS)[number];
const RELATIVE_OPS: readonly ConditionOp[] = ['within_next', 'within_last', 'more_than_ago', 'more_than_ahead'];
const NO_OPERAND_OPS: readonly ConditionOp[] = ['is_empty', 'not_empty'];
const COUNT_OPS: readonly ConditionOp[] = ['is', 'is_not', 'gt', 'lt'];

const operand = z.union([z.string().max(2000), z.number(), z.object({ amount: z.number().int().min(1).max(3650), unit: durationUnit }).strict()]);
const fieldLeft = z.object({ field: refSchema }).strict();
const leaf = z.object({ left: fieldLeft, op: z.enum(AUTOMATION_CONDITION_OPS), right: operand.optional() }).strict();
const countLeft = z.object({ count: z.object({ table: refSchema, matchColumn: refSchema, equalsField: refSchema, where: leaf.optional() }).strict() }).strict();

/** An operator takes the operand its kind needs: none, an amount with a unit, or a plain value. */
function operandIssue(op: ConditionOp, right: unknown): string | null {
  if (NO_OPERAND_OPS.includes(op)) return right === undefined ? null : `${op} takes no value`;
  if (right === undefined) return `${op} needs a value: a shipped rule is complete`;
  const relative = RELATIVE_OPS.includes(op);
  const object = typeof right === 'object' && right !== null;
  if (relative && !object) return `${op} needs an amount and a unit`;
  if (!relative && object) return `${op} needs a plain value`;
  return null;
}

export const manifestConditionSchema = z
  .object({ left: z.union([fieldLeft, countLeft]), op: z.enum(AUTOMATION_CONDITION_OPS), right: operand.optional() })
  .strict()
  .superRefine((condition, ctx) => {
    const issue = operandIssue(condition.op, condition.right);
    if (issue !== null) ctx.addIssue({ code: 'custom', path: ['right'], message: issue });
    if ('count' in condition.left) {
      if (!COUNT_OPS.includes(condition.op)) ctx.addIssue({ code: 'custom', path: ['op'], message: `${condition.op} cannot compare a count` });
      const nested = condition.left.count.where;
      const inner = nested === undefined ? null : operandIssue(nested.op, nested.right);
      if (inner !== null) ctx.addIssue({ code: 'custom', path: ['left', 'count', 'where', 'right'], message: inner });
    }
  });
export type ManifestCondition = z.infer<typeof manifestConditionSchema>;

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/** When a rule runs by the clock. The zone is the install's: a manifest names none. */
const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('interval'), everyMinutes: z.enum(['5', '10', '15', '30', '60']) }).strict(),
  z
    .object({
      kind: z.enum(['daily', 'weekly', 'monthly']),
      time: z.string().regex(HHMM, 'a time such as 17:00'),
      /** 0 = Sunday; weekly only. */
      dayOfWeek: z.number().int().min(0).max(6).optional(),
      /** 1 to 28, so no month is skipped; monthly only. */
      dayOfMonth: z.number().int().min(1).max(28).optional(),
    })
    .strict(),
]);

export const manifestTriggerSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('record'),
      event: z.enum(['created', 'updated', 'deleted']),
      table: refSchema,
      /** `updated` only: run only when this column's value changed. */
      changedColumn: refSchema.optional(),
      when: z.array(manifestConditionSchema).max(8).optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('schedule'),
      schedule: scheduleSchema,
      forEach: z.object({ table: refSchema, where: z.array(manifestConditionSchema).max(8), once: z.boolean() }).strict().optional(),
    })
    .strict(),
]);
export type ManifestTrigger = z.infer<typeof manifestTriggerSchema>;

/** A value a step writes: text, which may carry `{{record.<column>}}`, or the moment it runs. */
const writeValue = z.union([z.string().max(4000), z.object({ now: z.literal(true) }).strict()]);
const values = z.record(refSchema, writeValue);

const roleKey = z.string().regex(/^[a-z][a-z0-9-]*$/, 'a role key');

export const manifestActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('email'),
      /** One of the manifest's own templates. */
      templateKey: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a template key'),
      /** The record's column that holds the address. */
      to: z.object({ kind: z.literal('field'), column: refSchema }).strict(),
      /** What fills a placeholder of the template that the record does not. */
      vars: z
        .record(z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/), z.string().max(2000))
        .refine((value) => Object.keys(value).length <= 60, 'at most 60 placeholders')
        .optional(),
    })
    .strict(),
  z.object({ kind: z.literal('notification'), to: z.object({ roles: z.array(roleKey).min(1).max(20) }).strict(), title: localized(200), body: localized(2000).optional() }).strict(),
  z.object({ kind: z.literal('record.create'), table: refSchema, values }).strict(),
  z.object({ kind: z.literal('record.update'), values }).strict(),
]);
export type ManifestAction = z.infer<typeof manifestActionSchema>;

const nodeBase = { id: z.string().min(1).max(40), title: localized(120), sub: localized(200).optional() };

const triggerNode = z.object({ ...nodeBase, kind: z.literal('trigger') }).strict();
const actionNode = z.object({ ...nodeBase, kind: z.literal('action'), onError: z.boolean().optional(), action: manifestActionSchema }).strict();
const conditionNode = z.object({ ...nodeBase, kind: z.literal('condition'), onError: z.boolean().optional(), condition: manifestConditionSchema }).strict();
const stopNode = z.object({ ...nodeBase, kind: z.literal('stop') }).strict();
const waitNode = z
  .object({ ...nodeBase, kind: z.literal('wait'), amount: z.number().int().min(1).max(3650), unit: durationUnit })
  .strict()
  .refine((node) => node.amount * UNIT_MS[node.unit] <= 30 * DAY_MS, { message: 'a wait may not exceed 30 days', path: ['amount'] });

/** What a branch may hold: everything but a trigger and another branch. */
const branchChild = z.union([actionNode, conditionNode, stopNode, waitNode]);
const branchSchema = z.object({ id: z.string().min(1).max(40), label: z.string().max(60), nodes: z.array(branchChild).max(20) }).strict();
const branchNode = z.object({ ...nodeBase, kind: z.literal('branch'), condition: manifestConditionSchema, branches: z.tuple([branchSchema, branchSchema]) }).strict();

export const manifestNodeSchema = z.union([triggerNode, actionNode, conditionNode, stopNode, waitNode, branchNode]);
export type ManifestNode = z.infer<typeof manifestNodeSchema>;

type AnyNode = ManifestNode | z.infer<typeof branchChild>;

/** Every step of a flow with the path it is written at, a branch's own steps after it. */
function walk(nodes: readonly AnyNode[], path: (string | number)[], visit: (node: AnyNode, path: (string | number)[]) => void, ids: string[]): void {
  nodes.forEach((node, n) => {
    ids.push(node.id);
    visit(node, [...path, n]);
    if (node.kind !== 'branch') return;
    node.branches.forEach((branch, b) => {
      ids.push(branch.id);
      walk(branch.nodes, [...path, n, 'branches', b, 'nodes'], visit, ids);
    });
  });
}

export const manifestGraphSchema = z
  .object({ version: z.literal(1), nodes: z.array(manifestNodeSchema).min(1).max(AUTOMATION_NODES_MAX) })
  .strict()
  .superRefine((graph, ctx) => {
    const triggers = graph.nodes.filter((node) => node.kind === 'trigger');
    if (triggers.length !== 1) ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'a rule has exactly one trigger' });
    else if (graph.nodes[0]?.kind !== 'trigger') ctx.addIssue({ code: 'custom', path: ['nodes', 0], message: 'the trigger is the first step' });
    const ids: string[] = [];
    walk(graph.nodes, ['nodes'], () => undefined, ids);
    if (ids.length > AUTOMATION_NODES_MAX) ctx.addIssue({ code: 'custom', path: ['nodes'], message: `a rule holds at most ${String(AUTOMATION_NODES_MAX)} steps` });
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: 'custom', path: ['nodes'], message: 'step ids must be unique' });
  });

export const manifestAutomationSchema = z
  .object({
    /** Kebab-case, unique in the manifest, at most 80 characters: how an update finds the rule again. */
    key: z.string().regex(/^[a-z][a-z0-9-]{0,79}$/, 'a rule key is kebab-case, at most 80 characters'),
    name: localized(120),
    description: localized(500).optional(),
    /** Whether the rule is switched on when it is first installed. The owner's switch stands after that. */
    enabled: z.boolean(),
    trigger: manifestTriggerSchema,
    graph: manifestGraphSchema,
  })
  .strict();
export type ManifestAutomation = z.infer<typeof manifestAutomationSchema>;

export const manifestAutomationsSchema = z
  .array(manifestAutomationSchema)
  .max(MANIFEST_AUTOMATIONS_MAX)
  .refine((rules) => new Set(rules.map((rule) => rule.key)).size === rules.length, { message: 'two rules share a key' });

// ── what one manifest can check ──────────────────────────────────────────────

/** What the checks read of a table. */
export interface AutomationTableShape {
  ref: string;
  columns: readonly {
    ref: string;
    type: string;
    rules?: Readonly<Record<string, unknown>> | undefined;
  }[];
}

/** What the checks read of an email template: its key and, per language, the text it is made of. */
export interface AutomationTemplateShape {
  key: string;
  attach?: unknown;
  locales: Readonly<Record<string, { subject: string; preheader?: string | undefined; blocks: readonly { block: string; data?: Readonly<Record<string, unknown>> | undefined }[]; footer?: string | undefined }>>;
}

/** What every rule's email can read whatever its record is. */
export const RULE_EMAIL_VARS = ['now', 'ruleName', 'recordLabel', 'appName'] as const;

/**
 * Every placeholder a template reads in one language, in the order it reads
 * them. A `{{row.*}}` is left out: it belongs to the rows a list block draws.
 */
export function templatePlaceholdersOf(content: { subject: string; preheader?: string | undefined; blocks: readonly unknown[]; footer?: string | undefined }): string[] {
  const text = JSON.stringify([content.subject, content.preheader, content.blocks, content.footer]);
  return [...new Set([...text.matchAll(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g)].map((match) => match[1] as string))].filter((name) => !name.startsWith('row.'));
}

const NUMBERS = ['int', 'bigint', 'decimal', 'money', 'float'];
const DATES = ['date', 'timestamptz'];
/** The rules through which Adminium fills a column itself. */
const DECIDING = ['copy', 'sequence', 'code', 'rollup', 'stamp', 'formula', 'format', 'lookup', 'perNight', 'customerKey', 'codeLast4'];

/**
 * Everything wrong with a manifest's shipped rules that the manifest itself
 * can see: a table, a column, a role or a template that is not its own; a
 * comparison that could hold on no database; a rule that could never fire;
 * an email a rule cannot fill.
 */
export function automationIssues(m: {
  automations?: readonly ManifestAutomation[] | undefined;
  tables: readonly AutomationTableShape[];
  roles: readonly string[];
  templates: readonly AutomationTemplateShape[];
  /** The columns Adminium decides beyond a column's own rule (a balance, what a posting fills), by table. */
  decided?: (table: string) => ReadonlySet<string>;
}): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const tables = new Map(m.tables.map((table) => [table.ref, table]));
  const templates = new Map(m.templates.map((template) => [template.key, template]));

  (m.automations ?? []).forEach((rule, r) => {
    const at = (...rest: (string | number)[]) => ['automations', r, ...rest];
    const column = (of: AutomationTableShape | undefined, ref: string, path: (string | number)[]) => {
      const found = of?.columns.find((candidate) => candidate.ref === ref);
      if (of !== undefined && found === undefined) out.push({ path, message: `"${of.ref}" has no column "${ref}"` });
      return found;
    };
    const tableAt = (ref: string, path: (string | number)[]) => {
      const found = tables.get(ref);
      if (found === undefined) out.push({ path, message: `"${ref}" is not one of this manifest's tables` });
      return found;
    };

    /** One comparison, against the table whose record it reads. */
    const leafIssues = (of: AutomationTableShape | undefined, left: { field: string }, op: ConditionOp, right: unknown, path: (string | number)[]) => {
      const found = column(of, left.field, [...path, 'left', 'field']);
      if (found === undefined) return;
      if (RELATIVE_OPS.includes(op) && !DATES.includes(found.type)) {
        out.push({ path: [...path, 'op'], message: `"${op}" compares a date with now, and "${of?.ref ?? ''}.${found.ref}" is ${found.type}` });
      }
      // A 0/1 flag compared with 'true' holds on no database: a number is compared with a number.
      if (NUMBERS.includes(found.type) && ['is', 'is_not', 'gt', 'lt'].includes(op) && typeof right !== 'number') {
        out.push({ path: [...path, 'right'], message: `"${of?.ref ?? ''}.${found.ref}" is a number: compare it with a number (${JSON.stringify(right)} is not one)` });
      }
    };
    const conditionIssues = (of: AutomationTableShape | undefined, condition: ManifestCondition, path: (string | number)[], inScan: boolean) => {
      if ('count' in condition.left) {
        // A scan's filter is one query over the scanned table: it cannot count another table's rows.
        if (inScan) out.push({ path: [...path, 'left'], message: 'a rule that runs by the clock cannot filter the rows it visits by a count: keep the count in a column of the row (a rollup), and compare that' });
        const count = condition.left.count;
        const counted = tableAt(count.table, [...path, 'left', 'count', 'table']);
        column(counted, count.matchColumn, [...path, 'left', 'count', 'matchColumn']);
        column(of, count.equalsField, [...path, 'left', 'count', 'equalsField']);
        if (count.where !== undefined) leafIssues(counted, count.where.left, count.where.op, count.where.right, [...path, 'left', 'count', 'where']);
        if (typeof condition.right !== 'number') out.push({ path: [...path, 'right'], message: 'a count is compared with a number' });
        return;
      }
      leafIssues(of, condition.left, condition.op, condition.right, path);
    };

    // The trigger: which record the rule is about.
    const trigger = rule.trigger;
    let record: AutomationTableShape | undefined;
    if (trigger.kind === 'record') {
      record = tableAt(trigger.table, at('trigger', 'table'));
      if (trigger.changedColumn !== undefined) {
        if (trigger.event !== 'updated') out.push({ path: at('trigger', 'changedColumn'), message: 'a changed column is said of a record that is updated' });
        const changed = column(record, trigger.changedColumn, at('trigger', 'changedColumn'));
        const balance = record?.columns.some((candidate) => (candidate.rules?.['rollup'] as { balance?: { column?: string } } | undefined)?.balance?.column === trigger.changedColumn) === true;
        // A total is settled after the save: only a formula over it that is marked `announce` is told.
        if (changed !== undefined && (changed.rules?.['rollup'] !== undefined || balance)) {
          out.push({
            path: at('trigger', 'changedColumn'),
            message: `"${trigger.table}.${trigger.changedColumn}" is a total Adminium settles after the save, and a rule is not told of that: name a formula column over it that carries "announce": true`,
          });
        }
      }
      (trigger.when ?? []).forEach((condition, c) => conditionIssues(record, condition, at('trigger', 'when', c), false));
    } else if (trigger.forEach !== undefined) {
      const forEach = trigger.forEach;
      record = tableAt(forEach.table, at('trigger', 'forEach', 'table'));
      forEach.where.forEach((condition, c) => conditionIssues(record, condition, at('trigger', 'forEach', 'where', c), true));
      if (forEach.once && forEach.where.length === 0) out.push({ path: at('trigger', 'forEach', 'once'), message: 'a row visited once needs a condition that picks it: without one every row is visited on the first run' });
    }
    if (trigger.kind === 'schedule' && trigger.schedule.kind !== 'interval') {
      const schedule = trigger.schedule;
      if (schedule.kind === 'weekly' && schedule.dayOfWeek === undefined) out.push({ path: at('trigger', 'schedule', 'dayOfWeek'), message: 'a weekly rule names its day (0 = Sunday)' });
      if (schedule.kind === 'monthly' && schedule.dayOfMonth === undefined) out.push({ path: at('trigger', 'schedule', 'dayOfMonth'), message: 'a monthly rule names its day (1 to 28)' });
    }

    // Every `{{record.<column>}}` a text carries is a column of the rule's record.
    const tokens = (text: unknown, path: (string | number)[]) => {
      const texts = typeof text === 'string' ? [text] : typeof text === 'object' && text !== null ? Object.values(text as Record<string, unknown>).filter((value): value is string => typeof value === 'string') : [];
      for (const each of texts) {
        for (const match of each.matchAll(/\{\{\s*record\.([A-Za-z0-9_]+)\s*\}\}/g)) {
          if (record === undefined) out.push({ path, message: `{{record.${match[1] as string}}}: this rule runs for no record (a clock with no rows to visit)` });
          else if (!record.columns.some((candidate) => candidate.ref === match[1])) out.push({ path, message: `{{record.${match[1] as string}}}: "${record.ref}" has no column "${match[1] as string}"` });
        }
      }
    };

    const ids: string[] = [];
    walk(
      rule.graph.nodes,
      at('graph', 'nodes'),
      (node, path) => {
        tokens(node.title, [...path, 'title']);
        tokens(node.sub, [...path, 'sub']);
        if (node.kind === 'condition' || node.kind === 'branch') conditionIssues(record, node.condition, [...path, 'condition'], false);
        if (node.kind !== 'action') return;
        const action = node.action;
        const here = (...rest: (string | number)[]) => [...path, 'action', ...rest];
        if (action.kind === 'notification') {
          action.to.roles.forEach((role, i) => {
            if (!m.roles.includes(role)) out.push({ path: here('to', 'roles', i), message: `"${role}" is not one of this manifest's roles` });
          });
          tokens(action.title, here('title'));
          tokens(action.body, here('body'));
          return;
        }
        if (action.kind === 'record.create') {
          const into = tableAt(action.table, here('table'));
          for (const [ref, value] of Object.entries(action.values)) {
            column(into, ref, here('values', ref));
            tokens(value, here('values', ref));
          }
          return;
        }
        if (action.kind === 'record.update') {
          if (record === undefined) out.push({ path: here(), message: 'this rule runs for no record, so there is none to change' });
          const decided = record === undefined ? new Set<string>() : (m.decided?.(record.ref) ?? new Set<string>());
          for (const [ref, value] of Object.entries(action.values)) {
            const found = column(record, ref, here('values', ref));
            tokens(value, here('values', ref));
            const rule2 = DECIDING.find((name) => found?.rules?.[name] !== undefined);
            if (found !== undefined && (rule2 !== undefined || decided.has(ref))) {
              out.push({ path: here('values', ref), message: `"${record?.ref ?? ''}.${ref}" is decided by Adminium${rule2 === undefined ? '' : ` (its ${rule2} rule)`}: a rule cannot write it` });
            }
          }
          return;
        }
        // An email: one of the manifest's own templates, to a column of the record, and only one a rule can fill.
        if (record === undefined) out.push({ path: here(), message: 'this rule runs for no record, so there is no address to send to' });
        column(record, action.to.column, here('to', 'column'));
        const template = templates.get(action.templateKey);
        if (template === undefined) {
          out.push({ path: here('templateKey'), message: `"${action.templateKey}" is not one of this manifest's emailTemplates: a shipped rule sends only its own` });
          return;
        }
        const vars = action.vars ?? {};
        for (const [name, text] of Object.entries(vars)) tokens(text, here('vars', name));
        const columns = new Set((record?.columns ?? []).map((candidate) => candidate.ref));
        const filled = (name: string): boolean => (RULE_EMAIL_VARS as readonly string[]).includes(name) || Object.hasOwn(vars, name) || columns.has(name) || (name.startsWith('record.') && columns.has(name.slice('record.'.length)));
        const everywhere = new Set<string>();
        if (template.attach !== undefined) out.push({ path: here('templateKey'), message: `"${action.templateKey}" carries a document, which only the outbox draws: send it from the outbox, or give the rule a template with no "attach"` });
        for (const [locale, content] of Object.entries(template.locales)) {
          const marked = content.blocks.find((block) => ['withAttachment', 'onlyWith', 'onlyWithout'].some((mark) => block.data?.[mark] !== undefined) || /^email\.(rows|list)$/.test(block.block));
          if (marked !== undefined) {
            out.push({ path: here('templateKey'), message: `"${action.templateKey}" (${locale}) has a block only the outbox fills or drops (${marked.block}): send it from the outbox, or give the rule a template without it` });
          }
          const names = templatePlaceholdersOf(content);
          for (const name of names) everywhere.add(name);
          const unfilled = names.filter((name) => !filled(name));
          if (unfilled.length > 0) {
            const first = unfilled[0] as string;
            out.push({
              path: here(),
              message: `"${action.templateKey}" (${locale}) reads ${unfilled.map((name) => `{{${name}}}`).join(', ')}, which a rule cannot fill. Add "vars": { "${first}": "{{record.<column>}}" } to this step, or send this email from the outbox.`,
            });
          }
        }
        for (const name of Object.keys(vars)) {
          if (!everywhere.has(name)) out.push({ path: here('vars', name), message: `"${action.templateKey}" reads no {{${name}}} in any language: take it out, or fix the name` });
        }
      },
      ids,
    );
  });
  return out;
}
