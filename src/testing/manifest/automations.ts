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

import { placeholderNames, requiredNamesOfEmail, showWhenNames } from './placeholders.ts';
import { bcp47TagSchema, refSchema, type ReferenceIssue } from './refs.ts';

/** The most rules one manifest ships, and the most steps one rule holds. */
export const MANIFEST_AUTOMATIONS_MAX = 24;
/** How many a manifest could ship before: one with more says so, so a server that reads only these refuses it by its version. */
export const MANIFEST_AUTOMATIONS_FIRST_MAX = 12;
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

/**
 * An amount of time; `setting` reads it from a whole-number column of the app's settings row when
 * the conditions are read, and `amount` is used while that holds none.
 */
const operand = z.union([
  z.string().max(2000),
  z.number(),
  z.object({ amount: z.number().int().min(1).max(3650), unit: durationUnit, setting: z.object({ table: refSchema, column: refSchema }).strict().optional() }).strict(),
]);
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
      /**
       * The rows a run visits. `once: true` visits a row one time ever;
       * `once: "per-spell"` one time for each spell the row matches: a row that
       * stops matching and matches again later is visited again (a deal gone
       * quiet, worked on, and quiet once more).
       */
      forEach: z.object({ table: refSchema, where: z.array(manifestConditionSchema).max(8), once: z.union([z.boolean(), z.literal('per-spell')]) }).strict().optional(),
    })
    .strict(),
]);
export type ManifestTrigger = z.infer<typeof manifestTriggerSchema>;

/** A column of the app's settings row: the row of that table with the lowest key. */
const settingRef = z.object({ table: refSchema, column: refSchema }).strict();

/**
 * A value a step writes: text, which may carry `{{record.<column>}}`; the
 * moment it runs; what a column of the app's settings row holds when it runs
 * (`setting`); or a day so many days after a date of the record, or after
 * now, on the business's calendar (`daysAfter`), the days read from a
 * whole-number setting when it holds some.
 */
const writeValue = z.union([
  z.string().max(4000),
  z.object({ now: z.literal(true) }).strict(),
  z.object({ setting: settingRef }).strict(),
  z
    .object({
      daysAfter: z
        .object({
          column: refSchema.optional(),
          now: z.literal(true).optional(),
          days: z.number().int().min(0).max(3650),
          setting: settingRef.optional(),
          /** The wall time on that day, for a column that holds a moment. */
          at: z.string().regex(HHMM, 'a time such as 09:00').optional(),
        })
        .strict()
        .refine((after) => (after.column === undefined) !== (after.now === undefined), { message: 'days after a column of the record ("column") or after now ("now": true): one of the two' }),
    })
    .strict(),
]);
export type ManifestWriteValue = z.infer<typeof writeValue>;
const values = z.record(refSchema, writeValue);

const roleKey = z.string().regex(/^[a-z][a-z0-9-]*$/, 'a role key');
/** A staff column of the record, or one of the row a link of it names: `owner_id`, `deal_id.owner_id`. */
const staffPath = z.string().regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$/, 'a column, or <link column>.<column>');
/** What later steps call a row a step made. */
const stepName = z.string().regex(/^[a-z][a-z0-9_]{0,39}$/, 'a step name is snake_case, at most 40 characters');

export const manifestActionSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('email'),
      /** One of the manifest's own templates. */
      templateKey: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a template key'),
      /**
       * Who it goes to: `field`, the record's column that holds the address;
       * or `staff`, a staff column of the record (or `<link>.<staff column>`
       * of the row a link of it names), whose person's address Adminium looks up;
       * or `listed`, the people a table that lists people against the record
       * (one of its `belongs` ways `through`) names for it: one mail each, to
       * those of them who can open the record when it is sent.
       */
      to: z.union([
        z.object({ kind: z.literal('field'), column: refSchema }).strict(),
        z.object({ kind: z.literal('staff'), column: staffPath }).strict(),
        z.object({ kind: z.literal('listed'), table: refSchema }).strict(),
      ]),
      /**
       * Where a reply goes: to the person a staff column of the record names
       * (or `<link>.<staff column>` of the row a link of it names), by the
       * address they sign in with. Nobody there: no Reply-To.
       */
      replyTo: z.object({ staff: staffPath }).strict().optional(),
      /** What fills a placeholder of the template that the record does not. */
      vars: z
        .record(z.string().regex(/^[A-Za-z0-9_.-]{1,120}$/), z.string().max(2000))
        .refine((value) => Object.keys(value).length <= 60, 'at most 60 placeholders')
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('notification'),
      /**
       * Everybody who holds one of the roles; or the person a staff column of
       * the record names (or `<link>.<staff column>`). With `lead: true`, not
       * that person but whoever leads a team they are in (never the person
       * themselves), and of those only who can open the record. `else`: the
       * roles told when the column, or its lead, names nobody; a lead always
       * has one. Or `listed`: the people a table that lists people against the
       * record (one of its `belongs` ways `through`) names for it, of those
       * only who can open the record when the step runs.
       */
      to: z.union([
        z.object({ roles: z.array(roleKey).min(1).max(20) }).strict(),
        z.object({ listed: refSchema }).strict(),
        z
          .object({ column: staffPath, lead: z.literal(true).optional(), else: z.object({ roles: z.array(roleKey).min(1).max(20) }).strict().optional() })
          .strict()
          .refine((to) => to.lead !== true || to.else !== undefined, { message: 'a notice to a lead says who is told when there is none ("else": { "roles": [...] })', path: ['else'] }),
      ]),
      title: localized(200),
      body: localized(2000).optional(),
      /** Told at once, also in the person's quiet hours (a change to today's day sheet). */
      urgent: z.literal(true).optional(),
    })
    .strict(),
  /** `name`: what later steps call the row this one makes, in `{{steps.<name>.<column>}}`. */
  z.object({ kind: z.literal('record.create'), table: refSchema, values, name: stepName.optional() }).strict(),
  /**
   * A summary for each person: one email each, of the rows that are theirs.
   * Each section lists the rows of a table whose `owner` (a staff column) is
   * the person, that meet `where` and that the person may read; a block
   * `email.rows` of the template with `"section": "<key>"` draws it.
   * `"reach": "team"` adds the rows of the people the person leads when it is
   * sent; `sum` adds columns up over every such row; `"by": "owner"` lists a
   * line a person; `target` measures a sum against those people's targets.
   * Nothing in it is read further than the person's own roles reach.
   */
  z
    .object({
      kind: z.literal('digest'),
      templateKey: z.string().regex(/^[a-z][a-z0-9-]{1,79}$/, 'a template key'),
      to: z.object({ roles: z.array(roleKey).min(1).max(20) }).strict(),
      sections: z
        .array(
          z
            .object({
              key: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a section key is kebab-case'),
              table: refSchema,
              owner: refSchema,
              where: z.array(manifestConditionSchema).max(8).optional(),
              orderBy: z.object({ column: refSchema, dir: z.enum(['asc', 'desc']).optional() }).strict().optional(),
              limit: z.number().int().min(1).max(50).optional(),
              /** `team`: the person's rows and those of the people they lead when it is sent. Never "all". */
              reach: z.enum(['own', 'team']).optional(),
              /** Number columns added up over every row of the section: `{{sum.<section>.<column>}}`. */
              sum: z.array(refSchema).min(1).max(4).optional(),
              /** One line a person (their name, how many, each sum) instead of one a row. */
              by: z.literal('owner').optional(),
              /** What the sum `of` is measured against: `column` of the rows of `table` whose `owner` names the same people. */
              target: z.object({ table: refSchema, owner: refSchema, column: refSchema, year: refSchema.optional(), of: refSchema }).strict().optional(),
            })
            .strict(),
        )
        .min(1)
        .max(6),
      /** Sent also to a person none of whose sections lists a row. Default: such a person gets no email. */
      sendEmpty: z.literal(true).optional(),
    })
    .strict(),
  z.object({ kind: z.literal('record.update'), values }).strict(),
  /**
   * A step an add-on gives (its `addOn.steps`): which add-on, which step, and
   * what fills each of the step's inputs: text, which may carry `{{record.<column>}}`.
   */
  z
    .object({
      kind: z.literal('add-on.step'),
      addOn: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, 'an add-on key'),
      step: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a step key'),
      inputs: z.record(z.string().regex(/^[a-z][a-z0-9-]{0,39}$/), z.string().max(2000)).refine((value) => Object.keys(value).length <= 8, 'at most 8 inputs'),
    })
    .strict(),
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
    /** The part of the app the rule belongs to: not run while it is off (see `modules.ts`). */
    module: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a module id is kebab-case').optional(),
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
    /** The table a link column points at. */
    references?: string | undefined;
    rules?: Readonly<Record<string, unknown>> | undefined;
  }[];
  /** How people belong to its rows: a way `through` names a table that lists people against them. */
  belongs?: readonly unknown[] | undefined;
  /** Read by its own people alone: no rule reads a value of it. */
  private?: boolean | undefined;
}

/** What the checks read of an email template: its key and, per language, the text it is made of. */
export interface AutomationTemplateShape {
  key: string;
  attach?: unknown;
  locales: Readonly<Record<string, { subject: string; preheader?: string | undefined; blocks: readonly { block: string; data?: Readonly<Record<string, unknown>> | undefined }[]; footer?: string | undefined }>>;
}

/** What every rule's email can read whatever its record is. */
export const RULE_EMAIL_VARS = ['now', 'ruleName', 'recordLabel', 'appName'] as const;
/** What a summary's email can read beside its sections' figures: the person's name, and when the figures were read (`readAt`). */
export const DIGEST_EMAIL_VARS = ['now', 'ruleName', 'appName', 'name', 'readAt'] as const;

/**
 * Every placeholder a template reads in one language, in the order it reads
 * them. A `{{row.*}}` is left out: it belongs to the rows a list block draws.
 */
export function templatePlaceholdersOf(content: { subject: string; preheader?: string | undefined; blocks: readonly unknown[]; footer?: string | undefined }): string[] {
  return [...new Set([...placeholderNames([content.subject, content.preheader, content.blocks, content.footer]), ...showWhenNames(content.blocks)])].filter((name) => !name.startsWith('row.'));
}

/**
 * The placeholders of a template that must be given a value: written
 * somewhere with no backup. One that says its own backup (`{{first_name|there}}`),
 * that only decides whether a block is shown, or that is read only inside the
 * block it decides, is asked of nobody.
 */
export function templateRequiredPlaceholdersOf(content: { subject: string; preheader?: string | undefined; blocks: readonly unknown[]; footer?: string | undefined }): string[] {
  return requiredNamesOfEmail(content).filter((name) => !name.startsWith('row.'));
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
  /** An add-on's own steps, when the manifest is one that gives any: a rule of its own that names one is checked against them. */
  steps?: { addOn: string; steps: readonly { key: string; inputs: readonly { key: string; required?: boolean | undefined }[] }[] } | undefined;
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
    /** An amount read from a setting: a whole-number column of one of the manifest's tables, where the run can read it. */
    const settingIssues = (condition: ManifestCondition, path: (string | number)[], settingsOk: boolean) => {
      const right = condition.right;
      if (typeof right !== 'object' || right === null || right.setting === undefined) return;
      const at = [...path, 'right', 'setting'];
      if (!settingsOk) {
        out.push({ path: at, message: 'an amount read from a setting is read where a rule visits rows by the clock (forEach.where) and in a condition step, not here' });
        return;
      }
      const held = tableAt(right.setting.table, [...at, 'table']);
      const found = column(held, right.setting.column, [...at, 'column']);
      if (found !== undefined && !['int', 'bigint'].includes(found.type)) out.push({ path: [...at, 'column'], message: `"${right.setting.table}.${right.setting.column}" is not a whole-number column: it holds an amount of ${right.unit}` });
    };
    const conditionIssues = (of: AutomationTableShape | undefined, condition: ManifestCondition, path: (string | number)[], inScan: boolean, settingsOk = false) => {
      settingIssues(condition, path, settingsOk);
      if ('count' in condition.left) {
        // A scan's filter is one query over the scanned table: it cannot count another table's rows.
        if (inScan) out.push({ path: [...path, 'left'], message: 'a rule that runs by the clock cannot filter the rows it visits by a count: keep the count in a column of the row (a rollup), and compare that' });
        const count = condition.left.count;
        if (typeof count.where?.right === 'object' && count.where.right.setting !== undefined) out.push({ path: [...path, 'left', 'count', 'where', 'right', 'setting'], message: 'a count reads no setting: write the amount' });
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
      forEach.where.forEach((condition, c) => conditionIssues(record, condition, at('trigger', 'forEach', 'where', c), true, true));
      if (forEach.once !== false && forEach.where.length === 0) out.push({ path: at('trigger', 'forEach', 'once'), message: 'a row visited once needs a condition that picks it: without one every row is visited on the first run' });
    }
    if (trigger.kind === 'schedule' && trigger.schedule.kind !== 'interval') {
      const schedule = trigger.schedule;
      if (schedule.kind === 'weekly' && schedule.dayOfWeek === undefined) out.push({ path: at('trigger', 'schedule', 'dayOfWeek'), message: 'a weekly rule names its day (0 = Sunday)' });
      if (schedule.kind === 'monthly' && schedule.dayOfMonth === undefined) out.push({ path: at('trigger', 'schedule', 'dayOfMonth'), message: 'a monthly rule names its day (1 to 28)' });
    }

    /** A staff column of the rule's record, or of the row one of its links names: who a step tells. */
    const staffAt = (path: string, where: (string | number)[]) => {
      if (record === undefined) {
        out.push({ path: where, message: 'this rule runs for no record, so there is no person on it to tell' });
        return;
      }
      const [first, second] = path.split('.') as [string, string | undefined];
      let of: AutomationTableShape | undefined = record;
      let ref = first;
      if (second !== undefined) {
        const link = column(record, first, where);
        if (link === undefined) return;
        if (link.references === undefined) {
          out.push({ path: where, message: `"${record.ref}.${first}" is not a link to another table` });
          return;
        }
        of = tables.get(link.references);
        // A link into an add-on's table, or one this manifest cannot see: checked where the rule is installed.
        if (of === undefined) return;
        ref = second;
      }
      const found = column(of, ref, where);
      if (found !== undefined && found.rules?.['staff'] !== true) {
        out.push({ path: where, message: `"${of.ref}.${ref}" is not a staff column ("rules": { "staff": true }): only one names a person to tell` });
      }
    };

    /** A table that lists people against the rule's record (a `belongs` way `through` it): who a step to "the people listed" tells. */
    const listedAt = (ref: string, where: (string | number)[]) => {
      if (record === undefined) {
        out.push({ path: where, message: 'this rule runs for no record, so nobody is listed on it to tell' });
        return;
      }
      const lists = (record.belongs ?? []).some((way) => typeof way === 'object' && way !== null && 'through' in way && (way as { through?: { table?: unknown } }).through?.table === ref);
      if (!lists) out.push({ path: where, message: `"${ref}" lists nobody against "${record.ref}": name a table one of its "belongs" ways reads "through"` });
    };

    /** `{{was.<column>}}`: a column of the record, in a rule run by its change. */
    const changing = trigger.kind === 'record' && trigger.event === 'updated';
    const wasIssue = (ref: string, path: (string | number)[]): void => {
      if (!changing) out.push({ path, message: `{{was.${ref}}}: only a rule run when its record is updated reads the record as it was` });
      else if (record !== undefined && !record.columns.some((candidate) => candidate.ref === ref)) out.push({ path, message: `{{was.${ref}}}: "${record.ref}" has no column "${ref}"` });
    };

    // The rows earlier steps made, by the name each step gave its row.
    const made = new Map<string, AutomationTableShape | undefined>();
    // Every `{{record.<column>}}` a text carries is a column of the rule's record; every `{{steps.<name>.<column>}}` a column of a row an earlier step made.
    const tokens = (text: unknown, path: (string | number)[]) => {
      const texts = typeof text === 'string' ? [text] : typeof text === 'object' && text !== null ? Object.values(text as Record<string, unknown>).filter((value): value is string => typeof value === 'string') : [];
      for (const each of texts) {
        for (const match of each.matchAll(/\{\{\s*steps\.([A-Za-z0-9_]+)\.([A-Za-z0-9_]+)\s*(\|[^{}]*)?\}\}/g)) {
          const name = match[1] as string;
          if (!made.has(name)) out.push({ path, message: `{{steps.${name}.${match[2] as string}}}: no earlier step makes a row called "${name}" (give a "record.create" step "name": "${name}")` });
          else if (made.get(name) !== undefined && !made.get(name)!.columns.some((candidate) => candidate.ref === match[2])) out.push({ path, message: `{{steps.${name}.${match[2] as string}}}: "${made.get(name)!.ref}" has no column "${match[2] as string}"` });
          // A row that was not made has no value to stand in for: the run stops instead.
          if (match[3] !== undefined) out.push({ path, message: `{{steps.${name}.${match[2] as string}}} takes no backup: a row that was not made stops the run` });
        }
        // The record as it was before the change: only a rule about a change has one.
        for (const match of each.matchAll(/\{\{\s*was\.([A-Za-z0-9_]+)\s*(?:\|[^{}]*)?\}\}/g)) wasIssue(match[1] as string, path);
        for (const match of each.matchAll(/\{\{\s*record\.([A-Za-z0-9_]+)\s*(?:\|[^{}]*)?\}\}/g)) {
          if (record === undefined) out.push({ path, message: `{{record.${match[1] as string}}}: this rule runs for no record (a clock with no rows to visit)` });
          else if (!record.columns.some((candidate) => candidate.ref === match[1])) out.push({ path, message: `{{record.${match[1] as string}}}: "${record.ref}" has no column "${match[1] as string}"` });
        }
      }
    };

    /** A setting a value reads: a column of one of the manifest's tables that is neither secret nor personal, of a table that is not private. */
    const settingAt = (setting: { table: string; column: string }, path: (string | number)[]) => {
      const held = tableAt(setting.table, [...path, 'table']);
      if (held?.private === true) out.push({ path: [...path, 'table'], message: `"${setting.table}" is private: no rule reads a value of it` });
      const found = column(held, setting.column, [...path, 'column']);
      if (found?.rules?.['secret'] === true || found?.rules?.['personal'] === true) {
        out.push({ path: [...path, 'column'], message: `"${setting.table}.${setting.column}" is ${found.rules['secret'] === true ? 'a secret' : 'a personal'} column: a rule never writes it into another row` });
      }
      return found;
    };
    /** One value a step writes into `ref` of `into`: its placeholders, the setting it reads, the date it counts from. */
    const valueIssues = (into: AutomationTableShape | undefined, ref: string, value: ManifestWriteValue, path: (string | number)[]) => {
      if (typeof value === 'string') {
        tokens(value, path);
        return;
      }
      const target = into?.columns.find((candidate) => candidate.ref === ref);
      if ('setting' in value) {
        const found = settingAt(value.setting, [...path, 'setting']);
        if (found === undefined || target === undefined) return;
        // A person is filled from a column that holds one; any other value from a column of its own kind.
        if (target.rules?.['staff'] === true && found.rules?.['staff'] !== true) out.push({ path: [...path, 'setting', 'column'], message: `"${into?.ref ?? ''}.${ref}" holds a staff member, and "${value.setting.table}.${value.setting.column}" is not a staff column` });
        else if (found.type !== target.type || found.references !== target.references) out.push({ path: [...path, 'setting', 'column'], message: `"${value.setting.table}.${value.setting.column}" is ${found.type} and "${into?.ref ?? ''}.${ref}" is ${target.type}: a setting fills a column of its own kind` });
        return;
      }
      if ('daysAfter' in value) {
        const after = value.daysAfter;
        const at = [...path, 'daysAfter'];
        if (target !== undefined && !DATES.includes(target.type)) out.push({ path, message: `"${into?.ref ?? ''}.${ref}" is ${target.type}: a day so many days on is written into a date column` });
        if (after.at !== undefined && target?.type === 'date') out.push({ path: [...at, 'at'], message: `"${into?.ref ?? ''}.${ref}" holds a day, which has no time of day` });
        if (after.column !== undefined) {
          if (record === undefined) out.push({ path: [...at, 'column'], message: 'this rule runs for no record, so there is no date of it to count from' });
          const from = column(record, after.column, [...at, 'column']);
          if (from !== undefined && !DATES.includes(from.type)) out.push({ path: [...at, 'column'], message: `"${record?.ref ?? ''}.${after.column}" is ${from.type}: days are counted from a date` });
          if (from?.rules?.['secret'] === true || from?.rules?.['personal'] === true) out.push({ path: [...at, 'column'], message: `"${record?.ref ?? ''}.${after.column}" is a protected column: a day counted from it would tell it` });
        }
        if (after.setting !== undefined) {
          const found = settingAt(after.setting, [...at, 'setting']);
          if (found !== undefined && !['int', 'bigint'].includes(found.type)) out.push({ path: [...at, 'setting', 'column'], message: `"${after.setting.table}.${after.setting.column}" is not a whole-number column: it holds a number of days` });
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
        if (node.kind === 'condition' || node.kind === 'branch') conditionIssues(record, node.condition, [...path, 'condition'], false, true);
        if (node.kind !== 'action') return;
        const action = node.action;
        const here = (...rest: (string | number)[]) => [...path, 'action', ...rest];
        if (action.kind === 'notification') {
          if ('roles' in action.to) {
            action.to.roles.forEach((role, i) => {
              if (!m.roles.includes(role)) out.push({ path: here('to', 'roles', i), message: `"${role}" is not one of this manifest's roles` });
            });
          } else if ('listed' in action.to) {
            listedAt(action.to.listed, here('to', 'listed'));
          } else {
            staffAt(action.to.column, here('to', 'column'));
            (action.to.else?.roles ?? []).forEach((role, i) => {
              if (!m.roles.includes(role)) out.push({ path: here('to', 'else', 'roles', i), message: `"${role}" is not one of this manifest's roles` });
            });
          }
          tokens(action.title, here('title'));
          tokens(action.body, here('body'));
          return;
        }
        if (action.kind === 'record.create') {
          const into = tableAt(action.table, here('table'));
          for (const [ref, value] of Object.entries(action.values)) {
            column(into, ref, here('values', ref));
            valueIssues(into, ref, value, here('values', ref));
          }
          // Named after its own values are read: a step does not read the row it is about to make.
          if (action.name !== undefined) {
            if (made.has(action.name)) out.push({ path: here('name'), message: `"${action.name}" already names a row an earlier step makes` });
            if (['record', 'steps', 'now'].includes(action.name)) out.push({ path: here('name'), message: `"${action.name}" is a word a rule already reads: choose another name` });
            made.set(action.name, into);
          }
          return;
        }
        if (action.kind === 'digest') {
          action.to.roles.forEach((role, i) => {
            if (!m.roles.includes(role)) out.push({ path: here('to', 'roles', i), message: `"${role}" is not one of this manifest's roles` });
          });
          const keys = new Set<string>();
          action.sections.forEach((section, s) => {
            if (keys.has(section.key)) out.push({ path: here('sections', s, 'key'), message: `"${section.key}" is the key of an earlier section` });
            keys.add(section.key);
            const of = tableAt(section.table, here('sections', s, 'table'));
            const owner = column(of, section.owner, here('sections', s, 'owner'));
            if (owner !== undefined && owner.rules?.['staff'] !== true) {
              out.push({ path: here('sections', s, 'owner'), message: `"${section.table}.${section.owner}" is not a staff column ("rules": { "staff": true }): a section lists the rows whose person is the one written to` });
            }
            (section.where ?? []).forEach((condition, c) => conditionIssues(of, condition, here('sections', s, 'where', c), true));
            if (section.orderBy !== undefined) column(of, section.orderBy.column, here('sections', s, 'orderBy', 'column'));
            // A sum adds up numbers; the same column twice is one figure with two names.
            (section.sum ?? []).forEach((ref, n) => {
              const added = column(of, ref, here('sections', s, 'sum', n));
              if (added !== undefined && !NUMBERS.includes(added.type)) out.push({ path: here('sections', s, 'sum', n), message: `"${section.table}.${ref}" is not a number column: a sum adds numbers up` });
              if ((section.sum ?? []).indexOf(ref) !== n) out.push({ path: here('sections', s, 'sum', n), message: `"${ref}" is summed twice` });
            });
            // A line a person has no row to sort by.
            if (section.by !== undefined && section.orderBy !== undefined) out.push({ path: here('sections', s, 'orderBy'), message: 'a section with one line a person ("by": "owner") is listed by name: it has no orderBy' });
            if (section.target !== undefined) {
              const target = section.target;
              if (!(section.sum ?? []).includes(target.of)) out.push({ path: here('sections', s, 'target', 'of'), message: `"${target.of}" is not one of this section's sums ("sum")` });
              const goals = tableAt(target.table, here('sections', s, 'target', 'table'));
              const whose = column(goals, target.owner, here('sections', s, 'target', 'owner'));
              if (whose !== undefined && whose.rules?.['staff'] !== true) out.push({ path: here('sections', s, 'target', 'owner'), message: `"${target.table}.${target.owner}" is not a staff column ("rules": { "staff": true }): a target is somebody's` });
              const goal = column(goals, target.column, here('sections', s, 'target', 'column'));
              if (goal !== undefined && !NUMBERS.includes(goal.type)) out.push({ path: here('sections', s, 'target', 'column'), message: `"${target.table}.${target.column}" is not a number column` });
              if (target.year !== undefined) {
                const year = column(goals, target.year, here('sections', s, 'target', 'year'));
                if (year !== undefined && !['int', 'bigint'].includes(year.type)) out.push({ path: here('sections', s, 'target', 'year'), message: `"${target.table}.${target.year}" is not a whole-number column: it holds a calendar year` });
              }
            }
          });
          const template = templates.get(action.templateKey);
          if (template === undefined) {
            out.push({ path: here('templateKey'), message: `"${action.templateKey}" is not one of this manifest's emailTemplates: a shipped rule sends only its own` });
            return;
          }
          if (template.attach !== undefined) out.push({ path: here('templateKey'), message: `"${action.templateKey}" carries a document, which a summary does not` });
          for (const [locale, content] of Object.entries(template.locales)) {
            const drawn = new Set<string>();
            content.blocks.forEach((block) => {
              if (block.block !== 'email.rows') return;
              const section = block.data?.['section'];
              if (typeof section !== 'string' || !keys.has(section)) {
                out.push({ path: here('templateKey'), message: `"${action.templateKey}" (${locale}) has a rows block that names no section of this step ("section": one of ${[...keys].join(', ')})` });
                return;
              }
              drawn.add(section);
              const drawing = action.sections.find((one) => one.key === section)!;
              // A line a person reads the person's name, how many rows, each sum, and the target with its cover.
              if (drawing.by !== undefined) {
                const lines = new Set(['row.owner', 'row.count', ...(drawing.sum ?? []).map((ref) => `row.sum.${ref}`), ...(drawing.target === undefined ? [] : ['row.target', 'row.cover'])]);
                for (const name of placeholderNames([block.data?.['row']])) {
                  if (name.startsWith('row.') && !lines.has(name)) out.push({ path: here('templateKey'), message: `"${action.templateKey}" (${locale}) reads {{${name}}} in the section "${section}", which lists one line a person: a line reads ${[...lines].map((one) => `{{${one}}}`).join(', ')}` });
                }
                return;
              }
              // Each line reads the columns of its section's table: {{row.<column>}}, or a form of one ({{row.<column>.money}}).
              const of = tables.get(drawing.table);
              for (const name of placeholderNames([block.data?.['row']])) {
                if (!name.startsWith('row.')) continue;
                const ref = name.slice('row.'.length).split('.')[0] as string;
                if (of !== undefined && !of.columns.some((candidate) => candidate.ref === ref)) {
                  out.push({ path: here('templateKey'), message: `"${action.templateKey}" (${locale}) reads {{${name}}}, and "${of.ref}" has no column "${ref}"` });
                }
              }
            });
            for (const key of keys) {
              if (!drawn.has(key)) out.push({ path: here('sections'), message: `"${action.templateKey}" (${locale}) draws no rows block for the section "${key}"` });
            }
            // A section's own figures: how many rows, each sum. They are there for everybody who reads the section.
            const figures = new Set(action.sections.flatMap((one) => [`count.${one.key}`, ...(one.sum ?? []).map((ref) => `sum.${one.key}.${ref}`)]));
            // A target and its cover are there only for a person who has one: a template that reads either says what it writes without.
            const sometimes = new Set(action.sections.flatMap((one) => (one.target === undefined ? [] : [`target.${one.key}`, `cover.${one.key}`])));
            const required = templateRequiredPlaceholdersOf(content);
            const unfilled = required.filter((name) => !(DIGEST_EMAIL_VARS as readonly string[]).includes(name) && !figures.has(name) && !sometimes.has(name));
            if (unfilled.length > 0) {
              out.push({ path: here(), message: `"${action.templateKey}" (${locale}) reads ${unfilled.map((name) => `{{${name}}}`).join(', ')}, which a summary cannot fill: it fills {{name}}, {{appName}}, {{ruleName}}, {{now}}, {{readAt}}, {{count.<section>}}, and {{sum.<section>.<column>}}, {{target.<section>}} and {{cover.<section>}} of a section that asks for them` });
            }
            const bare = required.filter((name) => sometimes.has(name));
            if (bare.length > 0) {
              out.push({ path: here(), message: `"${action.templateKey}" (${locale}) reads ${bare.map((name) => `{{${name}}}`).join(', ')} with nothing to write for a person who has no target: give it a backup ({{${bare[0]!}|none set}}), or tie its block to it with "showWhen"` });
            }
          }
          return;
        }
        if (action.kind === 'record.update') {
          if (record === undefined) out.push({ path: here(), message: 'this rule runs for no record, so there is none to change' });
          const decided = record === undefined ? new Set<string>() : (m.decided?.(record.ref) ?? new Set<string>());
          for (const [ref, value] of Object.entries(action.values)) {
            const found = column(record, ref, here('values', ref));
            valueIssues(record, ref, value, here('values', ref));
            const rule2 = DECIDING.find((name) => found?.rules?.[name] !== undefined);
            if (found !== undefined && (rule2 !== undefined || decided.has(ref))) {
              out.push({ path: here('values', ref), message: `"${record?.ref ?? ''}.${ref}" is decided by Adminium${rule2 === undefined ? '' : ` (its ${rule2} rule)`}: a rule cannot write it` });
            }
          }
          return;
        }
        if (action.kind === 'add-on.step') {
          for (const [name, value] of Object.entries(action.inputs)) tokens(value, here('inputs', name));
          // Another add-on's step is checked where the rule is installed: this manifest cannot see it.
          if (m.steps === undefined || m.steps.addOn !== action.addOn) return;
          const step = m.steps.steps.find((candidate) => candidate.key === action.step);
          if (step === undefined) {
            out.push({ path: here('step'), message: `"${action.step}" is not one of this add-on's steps` });
            return;
          }
          for (const name of Object.keys(action.inputs)) {
            if (!step.inputs.some((input) => input.key === name)) out.push({ path: here('inputs', name), message: `the step "${step.key}" has no input "${name}"` });
          }
          for (const input of step.inputs) {
            if (input.required === true && (action.inputs[input.key] ?? '').trim() === '') out.push({ path: here('inputs'), message: `the step "${step.key}" needs its input "${input.key}"` });
          }
          return;
        }
        // An email: one of the manifest's own templates, to a column of the record, and only one a rule can fill.
        if (record === undefined) out.push({ path: here(), message: 'this rule runs for no record, so there is no address to send to' });
        if (action.to.kind === 'staff') staffAt(action.to.column, here('to', 'column'));
        else if (action.to.kind === 'listed') listedAt(action.to.table, here('to', 'table'));
        else column(record, action.to.column, here('to', 'column'));
        if (action.replyTo !== undefined) staffAt(action.replyTo.staff, here('replyTo', 'staff'));
        const template = templates.get(action.templateKey);
        if (template === undefined) {
          out.push({ path: here('templateKey'), message: `"${action.templateKey}" is not one of this manifest's emailTemplates: a shipped rule sends only its own` });
          return;
        }
        const vars = action.vars ?? {};
        for (const [name, text] of Object.entries(vars)) tokens(text, here('vars', name));
        const columns = new Set((record?.columns ?? []).map((candidate) => candidate.ref));
        // The name of the person a staff column of the record names; the record's address, in a mail to a person.
        const people = new Set((record?.columns ?? []).filter((candidate) => candidate.rules?.['staff'] === true).flatMap((candidate) => [`${candidate.ref}.name`, `record.${candidate.ref}.name`]));
        // A mail to a person, or to each of the people listed on the record: each is somebody the address is worked out for.
        const toPerson = action.to.kind === 'staff' || action.to.kind === 'listed';
        const filled = (name: string): boolean =>
          (RULE_EMAIL_VARS as readonly string[]).includes(name) ||
          Object.hasOwn(vars, name) ||
          columns.has(name) ||
          (name.startsWith('record.') && columns.has(name.slice('record.'.length))) ||
          people.has(name) ||
          (toPerson && name === 'recordUrl') ||
          (changing && name.startsWith('was.') && columns.has(name.slice('was.'.length)));
        const everywhere = new Set<string>();
        if (template.attach !== undefined) out.push({ path: here('templateKey'), message: `"${action.templateKey}" carries a document, which only the outbox draws: send it from the outbox, or give the rule a template with no "attach"` });
        for (const [locale, content] of Object.entries(template.locales)) {
          const marked = content.blocks.find((block) => ['withAttachment', 'onlyWith', 'onlyWithout'].some((mark) => block.data?.[mark] !== undefined) || /^email\.(rows|list)$/.test(block.block));
          if (marked !== undefined) {
            out.push({ path: here('templateKey'), message: `"${action.templateKey}" (${locale}) has a block only the outbox fills or drops (${marked.block}): send it from the outbox, or give the rule a template without it` });
          }
          const names = templatePlaceholdersOf(content);
          for (const name of names) everywhere.add(name);
          const unfilled = templateRequiredPlaceholdersOf(content).filter((name) => !filled(name));
          if (unfilled.includes('recordUrl') && !toPerson) {
            out.push({ path: here(), message: `"${action.templateKey}" (${locale}) reads {{recordUrl}}, which only a mail to a person carries ("to": { "kind": "staff", … }): an address of the record is no link for anybody else` });
          }
          const others = unfilled.filter((name) => name !== 'recordUrl' || toPerson);
          if (others.length > 0) {
            const first = others[0] as string;
            out.push({
              path: here(),
              message: `"${action.templateKey}" (${locale}) reads ${others.map((name) => `{{${name}}}`).join(', ')}, which a rule cannot fill. Add "vars": { "${first}": "{{record.<column>}}" } to this step, or send this email from the outbox.`,
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
