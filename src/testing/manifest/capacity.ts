/*
 * VENDORED VERBATIM from packages/manifest/src/capacity.ts.
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
 * `capacity` — how much of a pool a table's rows may take. One rule, three
 * ways of naming the pool:
 *
 *  - `slot` (the default, and the only kind before): rows add up per start
 *    time, a table in a restaurant or an order in a pickup slot. A rule with
 *    no `kind` is a slot rule, and its parse gives back exactly what was
 *    written — no `kind` is added — so a released app's stored rule reads the
 *    same as it always has.
 *  - `parent`: rows take from a limit held on the row they point at (tickets
 *    of a type, portions of a dish, uses of a code), within its sales window,
 *    up to a number per order, and within wider pools (`also`).
 *  - `night`: a stay takes one unit on every night from its arrival to the
 *    day before it leaves, from a pool counted in another table (the rooms of
 *    a type), less the ones out of service.
 *
 * A table may carry up to three rules as a list (a pool per room type and a
 * pool per room on the same stays).
 *
 * `hold` makes a row count only while its hold has not ended, and only while
 * its state is one of `hold.states` (a paid order counts whatever its old
 * hold says). `reserved` keeps places that came back (a refunded ticket held
 * for the waitlist) counted against the public while staff decide.
 *
 * Every table a rule names sits under a key called `table`, so the installer
 * maps each of them to the real table. Columns of the rows a rule reaches
 * through a foreign key (`via`) are named plainly and found at run time.
 */
import { z } from 'zod';

import { BOOKING_WEEKDAYS } from './booking.ts';
import {
  NUMERIC_TYPES,
  numberOrSetting,
  refSchema,
  settingRefSchema,
  valueFits,
  type ColumnShape,
  type ReferenceIssue,
  type TableIndex,
  type TableShape,
} from './refs.ts';

/** One hop to the row this row belongs to (an order's tickets read the order's status). */
const ownerVia = { via: refSchema.optional() };

/** Only rows whose column holds one of `values` count (a cancelled order holds nothing). */
const countConditionSchema = z
  .object({ column: refSchema, values: z.array(z.string().min(1)).min(1), ...ownerVia })
  .strict();
/** One condition, or one on the row and one on its owner (a ticket's status and its order's). */
const countWhereSchema = z.union([countConditionSchema, z.array(countConditionSchema).min(1).max(2)]);

/** Where a hold's end is read when it is not a column of the row itself. */
const holdEndSchema = z.object({ column: refSchema, via: refSchema.optional() }).strict();
/**
 * A hold that ends at a moment of a linked row: `via` is a foreign key of the
 * row the hold reads (the owner's, when the hold has a `via`), and the first
 * of `or` that is filled answers when the link is empty (a waitlist offer's
 * end, else the order's own).
 */
const holdMomentSchema = z
  .object({ column: refSchema, via: refSchema.optional(), or: z.array(holdEndSchema).min(1).max(2).optional() })
  .strict();
const holdSchema = z
  .object({
    column: z.union([refSchema, holdMomentSchema]),
    states: z.array(z.string().min(1)).min(1).max(8),
    ...ownerVia,
  })
  .strict();

/** States whose places still count against the public, and are left for staff to hand on. */
const reservedSchema = z.object({ states: z.array(z.string().min(1)).min(1).max(8), ...ownerVia }).strict();

/**
 * A number, a setting, or a column of the row the rule points at (empty
 * there: no limit). With `onDay`, a date column of that row, the number holds
 * only on that venue day, and any other day has no limit (today's portions).
 */
const sizeSchema = z.union([numberOrSetting, z.object({ column: refSchema, onDay: refSchema.optional() }).strict()]);
const timeSchema = z.union([z.string().regex(/^\d{2}:\d{2}$/), settingRefSchema]);
const amountSchema = z.union([refSchema, z.number().int().min(1).max(1000)]);

const slotRuleSchema = z
  .object({
    kind: z.literal('slot').optional(),
    slot: refSchema,
    amount: amountSchema,
    perSlot: numberOrSetting,
    countWhere: countWhereSchema.optional(),
    slotMinutes: numberOrSetting,
    windowDays: numberOrSetting.optional(),
    opens: timeSchema.optional(),
    closes: timeSchema.optional(),
    /** A table, a room: the limit applies per value of this column too. */
    resource: refSchema.optional(),
    /**
     * How many hours before its time a guest may still cancel through the
     * public API; later, only the venue can. Staff are never held to it.
     */
    cancelHours: numberOrSetting.optional(),
    /** Opening hours per weekday, in place of `opens` and `closes`. */
    hours: z
      .object({ table: refSchema, weekday: refSchema, open: refSchema.optional(), opens: refSchema, closes: refSchema })
      .strict()
      .optional(),
    /** Days the venue is closed, `from` to `to` inclusive. */
    closures: z.object({ table: refSchema, from: refSchema, to: refSchema, active: refSchema.optional() }).strict().optional(),
    /** Slots the venue has paused (a kitchen that is full). */
    pauses: z.object({ table: refSchema, slot: refSchema, active: refSchema.optional() }).strict().optional(),
    /** How many minutes ahead a guest's slot must be. */
    noticeMinutes: numberOrSetting.optional(),
    hold: holdSchema.optional(),
  })
  .strict();

const parentRuleSchema = z
  .object({
    kind: z.literal('parent'),
    /** The foreign key to the row holding the limit; an empty one leaves the row out of this rule. */
    via: refSchema,
    size: sizeSchema,
    /** How much a row takes: a column of the row, or a number (absent: one). */
    amount: amountSchema.optional(),
    countWhere: countWhereSchema.optional(),
    /** The parent's columns a sale must fall between (empty: no bound). */
    window: z.object({ opens: refSchema.optional(), closes: refSchema.optional() }).strict().optional(),
    /** At most `max` per row of `within` (up to six tickets an order). */
    perWrite: z.object({ max: sizeSchema, within: refSchema }).strict().optional(),
    /** Wider pools the same rows also take from (a room's cap across its ticket types). */
    also: z
      .array(
        z
          .object({
            via: refSchema,
            size: z.union([sizeSchema, z.object({ via: refSchema, column: refSchema }).strict()]),
          })
          .strict(),
      )
      .min(1)
      .max(2)
      .optional(),
    /** Count only the rows of the same venue day as this time (a dish's portions today). */
    day: z.union([refSchema, z.object({ column: refSchema, ...ownerVia }).strict()]).optional(),
    /** The column whose value names the lock (absent: the whole table). */
    lockBy: refSchema.optional(),
    hold: holdSchema.optional(),
    reserved: reservedSchema.optional(),
  })
  .strict();

const outOfServiceSchema = z
  .object({ table: refSchema, room: refSchema, from: refSchema, to: refSchema, active: refSchema.optional() })
  .strict();
const nightPoolSchema = z.union([
  /** The rows of `count.table` pointing at the same row as `via` (the rooms of a type). */
  z
    .object({
      via: refSchema,
      count: z.object({ table: refSchema, column: refSchema, outOfService: outOfServiceSchema.optional() }).strict(),
      /** A column of the pool's row a guest count must fit (how many it sleeps). */
      fits: z.object({ column: refSchema }).strict().optional(),
      /**
       * When the row's `via` link is set, it counts against that row's
       * `column` instead (the type of the room given, not the one booked).
       */
      given: z.object({ via: refSchema, column: refSchema }).strict().optional(),
    })
    .strict(),
  /**
   * One unit per row pointed at (a room holds one stay a night), or the
   * number in a column of that row (parking spaces of an extra).
   */
  z
    .object({
      via: refSchema,
      size: z.union([z.literal(1), z.object({ column: refSchema }).strict()]),
      outOfService: outOfServiceSchema.optional(),
    })
    .strict(),
]);

/** A date of the row, or of the row it belongs to (an extra's nights are its stay's). */
const nightDateSchema = z.union([refSchema, z.object({ via: refSchema, column: refSchema }).strict()]);

const nightRuleSchema = z
  .object({
    kind: z.literal('night'),
    /** The arrival and the departure: two dates. */
    from: nightDateSchema,
    to: nightDateSchema,
    countWhere: countWhereSchema.optional(),
    pool: nightPoolSchema,
    nights: z
      .object({
        min: numberOrSetting.optional(),
        max: numberOrSetting.optional(),
        minByArrival: z.partialRecord(z.enum(BOOKING_WEEKDAYS), z.number().int().min(1).max(60)).optional(),
        /** How many days ahead a stay may start. */
        aheadDays: numberOrSetting.optional(),
      })
      .strict()
      .optional(),
    hold: holdSchema.optional(),
    /**
     * The states of a stay whose guest has arrived (its own, or its owner's
     * with `via`): a change of such a stay — another room, another type, other
     * dates — is judged from the venue's today on. The nights already slept
     * are never judged again (a room closed last night takes nothing from a
     * guest moved today).
     */
    arrived: reservedSchema.optional(),
  })
  .strict();

/** One limit on a table: a slot rule (with or without `kind`), a parent rule or a night rule. */
export const capacityRuleSchema = z.discriminatedUnion('kind', [slotRuleSchema, parentRuleSchema, nightRuleSchema]);
export type CapacityRule = z.infer<typeof capacityRuleSchema>;
export type SlotCapacityRule = z.infer<typeof slotRuleSchema>;
export type ParentCapacityRule = z.infer<typeof parentRuleSchema>;
export type NightCapacityRule = z.infer<typeof nightRuleSchema>;
export type CapacityKind = 'slot' | 'parent' | 'night';

/** Up to three limits on one table. */
export const capacityListSchema = z.array(capacityRuleSchema).min(1).max(3);

/** One rule or a list of them, as a table declares it. */
export type Capacity = CapacityRule | CapacityRule[];

/**
 * `capacity` on a table: one rule, or a list of up to three. Parsed by the
 * schema of the form written, so a mistake is named where it is (a union of
 * the two would only say the input is invalid). What comes back is what was
 * written: nothing is added.
 */
export const capacitySchema = z.custom<Capacity>().superRefine((value, ctx) => {
  const parsed = (Array.isArray(value) ? capacityListSchema : capacityRuleSchema).safeParse(value);
  if (parsed.success) return;
  for (const issue of parsed.error.issues) ctx.addIssue({ ...issue, path: [...issue.path], continue: false } as never);
});

/** A table's limits as a list, whichever form it wrote. */
export function rulesOf(capacity: Capacity | undefined): CapacityRule[] {
  if (capacity === undefined) return [];
  return Array.isArray(capacity) ? capacity : [capacity];
}

/** The kind of a rule: a rule that names none is a slot rule. */
export function kindOf(rule: CapacityRule): CapacityKind {
  return rule.kind ?? 'slot';
}

/** The keys a slot rule had before it had kinds, and one with no `kind` using only these reads as before. */
const LEGACY_KEYS: ReadonlySet<string> = new Set([
  'slot',
  'amount',
  'perSlot',
  'countWhere',
  'slotMinutes',
  'windowDays',
  'opens',
  'closes',
  'resource',
  'cancelHours',
]);

/**
 * Whether a table's capacity is the one rule a released app writes: a single
 * slot rule with only the keys it had before kinds, its `amount` a column and
 * its `countWhere` one condition on the row itself.
 */
export function isLegacyCapacity(capacity: Capacity | undefined): boolean {
  if (capacity === undefined || Array.isArray(capacity)) return false;
  if (capacity.kind !== undefined) return false;
  if (Object.keys(capacity).some((key) => !LEGACY_KEYS.has(key))) return false;
  if (typeof capacity.amount !== 'string') return false;
  const count = capacity.countWhere;
  return count === undefined || (!Array.isArray(count) && count.via === undefined);
}

/** What the capacity checks read of a column beyond the plain shape: its rules. */
type ColumnWithRules = ColumnShape & {
  unique?: true | undefined;
  rules?: { stamp?: unknown; copy?: { via: string; from: string; follow?: boolean | undefined } | undefined; code?: { renew?: { on?: unknown } | undefined } | undefined } | undefined;
};

/** The columns a trigger (a stamp's, a code renewal's) watches: `{column}` or `{columns}`, one or a list. */
function watchedBy(on: unknown): string[] {
  const triggers = Array.isArray(on) ? on : [on];
  return triggers.flatMap((trigger) => {
    if (typeof trigger !== 'object' || trigger === null) return [];
    const t = trigger as { column?: unknown; columns?: unknown };
    return [...(typeof t.column === 'string' ? [t.column] : []), ...(Array.isArray(t.columns) ? t.columns.filter((c): c is string => typeof c === 'string') : [])];
  });
}

/**
 * Everything in a table's capacity that names something the manifest does
 * not declare, or a column of the wrong kind. A released app's rule (see
 * {@link isLegacyCapacity}) gets exactly the checks it always had, so no app
 * that validated before is refused now.
 */
export function capacityIssues(
  table: TableShape,
  capacity: Capacity,
  index: TableIndex,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  if (isLegacyCapacity(capacity)) return legacyIssues(table, capacity as SlotCapacityRule, index, at);
  const out: ReferenceIssue[] = [];
  const rules = rulesOf(capacity);
  const list = Array.isArray(capacity);
  if (rules.filter((rule) => kindOf(rule) === 'slot').length > 1) {
    out.push({ path: at('capacity'), message: 'a table has one slot limit' });
  }
  rules.forEach((rule, r) => {
    const here = (...rest: (string | number)[]) => (list ? at('capacity', r, ...rest) : at('capacity', ...rest));
    out.push(...ruleIssues(table, rule, index, here));
  });
  return out;
}

/** The checks a slot rule has always had: its own columns, and each setting it reads. */
function legacyIssues(
  table: TableShape,
  cap: SlotCapacityRule,
  index: TableIndex,
  at: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const countWhere = Array.isArray(cap.countWhere) ? undefined : cap.countWhere;
  for (const [name, value] of [['slot', cap.slot], ['amount', cap.amount], ['resource', cap.resource], ['countWhere', countWhere?.column]] as const) {
    if (typeof value === 'string' && !index.has(table.ref, value)) {
      out.push({ path: at('capacity', name), message: `"${table.ref}" has no column "${value}"` });
    }
  }
  for (const [name, value] of Object.entries(cap)) {
    if (typeof value === 'object' && value !== null && 'table' in value && 'column' in value) {
      const setting = value as { table: string; column: string };
      if (!index.has(setting.table, setting.column)) {
        out.push({ path: at('capacity', name), message: `"${setting.table}" has no column "${setting.column}"` });
      }
    }
  }
  return out;
}

function ruleIssues(
  table: TableShape,
  rule: CapacityRule,
  index: TableIndex,
  here: (...rest: (string | number)[]) => (string | number)[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const column = (tableRef: string, ref: string) => index.column(tableRef, ref) as ColumnWithRules | undefined;

  /** The column, when its table and it exist and it is one of `types`; an issue otherwise. */
  const want = (tableRef: string, ref: string, types: readonly string[] | null, path: (string | number)[], what = ''): ColumnWithRules | undefined => {
    if (index.table(tableRef) === undefined) {
      out.push({ path, message: `"${tableRef}" is not a table of this app` });
      return undefined;
    }
    const found = column(tableRef, ref);
    if (found === undefined) {
      out.push({ path, message: `"${tableRef}" has no column "${ref}"` });
      return undefined;
    }
    if (types !== null && !types.includes(found.type)) {
      out.push({ path, message: `"${tableRef}.${ref}" must be ${what}` });
      return undefined;
    }
    return found;
  };
  /** A foreign key of `tableRef`, and the table it points at. */
  const wantFk = (tableRef: string, ref: string, path: (string | number)[]): string | undefined => {
    const found = want(tableRef, ref, null, path);
    if (found === undefined) return undefined;
    if (found.type !== 'fk' || found.references === undefined) {
      out.push({ path, message: `"${tableRef}.${ref}" must be a foreign key` });
      return undefined;
    }
    return found.references;
  };
  /** A setting a rule reads when it runs: a column of the app's settings row, of the kind asked. */
  const setting = (value: unknown, path: (string | number)[], types: readonly string[], what: string) => {
    const parsed = settingRefSchema.safeParse(value);
    if (parsed.success) want(parsed.data.table, parsed.data.column, types, path, what);
  };
  const number = (value: unknown, path: (string | number)[]) => setting(value, path, NUMERIC_TYPES, 'a number');
  const time = (value: unknown, path: (string | number)[]) => setting(value, path, ['text'], 'a text column holding HH:MM');

  /*
   * The owner: the row one hop up that a condition, a hold or a day reads
   * through. A rule reads one owner, through one foreign key.
   */
  const owners = new Map<string, (string | number)[]>();
  const ownerOf = (via: string | undefined, path: (string | number)[]): string | undefined => {
    if (via === undefined) return table.ref;
    if (!owners.has(via)) owners.set(via, path);
    return wantFk(table.ref, via, path);
  };

  // What counts, per level: the row's own states and its owner's.
  const conditions = rule.countWhere === undefined ? [] : Array.isArray(rule.countWhere) ? rule.countWhere : [rule.countWhere];
  const counted = new Map<string, Set<string>>();
  const levels = new Set<string>();
  conditions.forEach((condition, k) => {
    const path = Array.isArray(rule.countWhere) ? here('countWhere', k) : here('countWhere');
    const level = condition.via ?? '';
    if (levels.has(level)) {
      out.push({ path, message: level === '' ? 'one condition on the row itself' : 'one condition on the row it belongs to' });
      return;
    }
    levels.add(level);
    const owner = ownerOf(condition.via, [...path, 'via']);
    if (owner === undefined) return;
    const found = want(owner, condition.column, null, [...path, 'column']);
    if (found === undefined) return;
    for (const value of condition.values) {
      if (!valueFits(found, value)) out.push({ path: [...path, 'values'], message: `"${value}" is not a value of "${owner}.${found.ref}"` });
    }
    counted.set(level, new Set(condition.values));
  });

  /** States a hold or a reservation names must be states that count at the same level. */
  const statesCount = (states: readonly string[], via: string | undefined, path: (string | number)[], what: string) => {
    const values = counted.get(via ?? '');
    if (values === undefined) {
      out.push({ path, message: `nothing says which ${via === undefined ? 'rows' : `rows of "${via}"`} count, so ${what}` });
      return;
    }
    for (const state of states) {
      if (!values.has(state)) out.push({ path, message: `"${state}" is not counted, so ${what}` });
    }
  };

  /** A time column a hold ends at: a timestamptz Adminium stamps, never one a guest writes. */
  const holdEnd = (tableRef: string | undefined, ref: string, path: (string | number)[]) => {
    if (tableRef === undefined) return;
    const found = want(tableRef, ref, ['timestamptz'], path, 'a timestamptz');
    if (found !== undefined && found.rules?.stamp === undefined) {
      out.push({ path, message: `a hold ends when Adminium says: "${tableRef}.${ref}" needs a stamp` });
    }
  };
  /**
   * A hold's end on the row itself is written directly when a buyer's new
   * hold lets the old one go — no rule runs on that write. So nothing may
   * watch it: a stamp or a code renewal set off by it, or rows that follow it.
   */
  const unwatchedEnd = (tableRef: string | undefined, ref: string, path: (string | number)[]) => {
    const shape = tableRef === undefined ? undefined : index.table(tableRef);
    if (tableRef === undefined || shape === undefined) return;
    const said = (what: string) => out.push({ path, message: `"${tableRef}.${ref}" is a hold's end, which a new hold writes directly as it lets the old one go, so ${what} may not watch it` });
    for (const other of shape.columns as readonly ColumnWithRules[]) {
      const stamp = other.rules?.stamp as { on?: unknown } | undefined;
      if (stamp !== undefined && watchedBy(stamp.on).includes(ref)) said(`the stamp of "${other.ref}"`);
      if (watchedBy(other.rules?.code?.renew?.on).includes(ref)) said(`the code renewal of "${other.ref}"`);
    }
    for (const child of index.tables()) {
      for (const other of child.columns as readonly ColumnWithRules[]) {
        const copy = other.rules?.copy;
        if (copy?.follow !== true || copy.from !== ref) continue;
        const via = column(child.ref, copy.via);
        if (via?.references === tableRef) said(`"${child.ref}.${other.ref}", which follows it,`);
      }
    }
  };
  if (rule.hold !== undefined) {
    const hold = rule.hold;
    const level = ownerOf(hold.via, here('hold', 'via'));
    statesCount(hold.states, hold.via, here('hold', 'states'), 'it holds nothing');
    if (typeof hold.column === 'string') {
      holdEnd(level, hold.column, here('hold', 'column'));
      unwatchedEnd(level, hold.column, here('hold', 'column'));
    } else if (level !== undefined) {
      const moment = hold.column;
      const ends: { column: string; via?: string | undefined; path: (string | number)[] }[] = [
        { column: moment.column, via: moment.via, path: here('hold', 'column') },
        ...(moment.or ?? []).map((end, k) => ({ column: end.column, via: end.via, path: here('hold', 'column', 'or', k) })),
      ];
      for (const end of ends) {
        const target = end.via === undefined ? level : wantFk(level, end.via, [...end.path, 'via']);
        holdEnd(target, end.column, [...end.path, 'column']);
      }
      if (moment.via === undefined) out.push({ path: here('hold', 'column', 'via'), message: 'a hold read through a link names the link: otherwise it is a column' });
    }
  }

  if (rule.kind === 'parent') {
    const target = wantFk(table.ref, rule.via, here('via'));
    const onTarget = (ref: string, types: readonly string[], path: (string | number)[], what: string) => {
      if (target !== undefined) want(target, ref, types, path, what);
    };
    const size = (value: z.infer<typeof sizeSchema>, path: (string | number)[], on: string | undefined) => {
      if (typeof value === 'object' && 'column' in value && !('table' in value)) {
        if (on !== undefined) want(on, value.column, NUMERIC_TYPES, [...path, 'column'], 'a number');
        if (value.onDay !== undefined) {
          if (on !== undefined) want(on, value.onDay, ['date'], [...path, 'onDay'], 'a date');
          if (rule.day === undefined) out.push({ path: [...path, 'onDay'], message: 'a size for one day needs a rule that counts by day (day)' });
        }
      } else {
        number(value, path);
      }
    };
    size(rule.size, here('size'), target);
    if (typeof rule.amount === 'string') want(table.ref, rule.amount, ['int', 'bigint'], here('amount'), 'an int');
    if (rule.window !== undefined) {
      for (const name of ['opens', 'closes'] as const) {
        const ref = rule.window[name];
        if (ref !== undefined) onTarget(ref, ['timestamptz'], here('window', name), 'a timestamptz');
      }
    }
    if (rule.perWrite !== undefined) {
      wantFk(table.ref, rule.perWrite.within, here('perWrite', 'within'));
      size(rule.perWrite.max, here('perWrite', 'max'), target);
    }
    const alsoVias: string[] = [];
    (rule.also ?? []).forEach((wider, k) => {
      const path = here('also', k);
      alsoVias.push(wider.via);
      const pool = wantFk(table.ref, wider.via, [...path, 'via']);
      const s = wider.size;
      if (typeof s === 'object' && 'via' in s) {
        const hop = pool === undefined ? undefined : wantFk(pool, s.via, [...path, 'size', 'via']);
        if (hop !== undefined) want(hop, s.column, NUMERIC_TYPES, [...path, 'size', 'column'], 'a number');
      } else {
        size(s, [...path, 'size'], pool);
      }
    });
    if (rule.day !== undefined) {
      const day = typeof rule.day === 'string' ? { column: rule.day, via: undefined } : rule.day;
      const path = typeof rule.day === 'string' ? here('day') : here('day', 'column');
      const on = ownerOf(day.via, here('day', 'via'));
      if (on !== undefined) want(on, day.column, ['timestamptz'], path, 'a timestamptz');
    }
    if (rule.lockBy !== undefined) {
      if (rule.lockBy !== rule.via && !alsoVias.includes(rule.lockBy)) {
        out.push({ path: here('lockBy'), message: `the lock follows a pool: "${rule.via}"${alsoVias.length > 0 ? ` or ${alsoVias.map((v) => `"${v}"`).join(', ')}` : ''}` });
      } else if (rule.lockBy !== rule.via) {
        // A wider pool's key names the lock only when the pool's own key decides it.
        const copy = column(table.ref, rule.lockBy)?.rules?.copy;
        if (copy?.via !== rule.via) {
          out.push({ path: here('lockBy'), message: `the lock must follow the pool: copy "${rule.lockBy}" from "${rule.via}"` });
        }
      }
    }
    if (rule.reserved !== undefined) {
      const reserved = rule.reserved;
      ownerOf(reserved.via, here('reserved', 'via'));
      statesCount(reserved.states, reserved.via, here('reserved', 'states'), 'it keeps no place');
      if (rule.hold !== undefined && (rule.hold.via ?? '') === (reserved.via ?? '')) {
        for (const state of reserved.states) {
          if (rule.hold.states.includes(state)) out.push({ path: here('reserved', 'states'), message: `"${state}" is held, so it is not also kept back` });
        }
      }
    }
  } else if (rule.kind === 'night') {
    for (const name of ['from', 'to'] as const) {
      const date = rule[name];
      if (typeof date === 'string') {
        want(table.ref, date, ['date'], here(name), 'a date');
      } else {
        const on = ownerOf(date.via, here(name, 'via'));
        if (on !== undefined) want(on, date.column, ['date'], here(name, 'column'), 'a date');
      }
    }
    const pool = rule.pool;
    const target = wantFk(table.ref, pool.via, here('pool', 'via'));
    const outOfService = (oos: z.infer<typeof outOfServiceSchema>, rooms: string | undefined, path: (string | number)[]) => {
      if (index.table(oos.table) === undefined) {
        out.push({ path: [...path, 'table'], message: `"${oos.table}" is not a table of this app` });
        return;
      }
      const room = wantFk(oos.table, oos.room, [...path, 'room']);
      if (room !== undefined && rooms !== undefined && room !== rooms) {
        out.push({ path: [...path, 'room'], message: `"${oos.table}.${oos.room}" does not point at "${rooms}"` });
      }
      want(oos.table, oos.from, ['date'], [...path, 'from'], 'a date');
      want(oos.table, oos.to, ['date'], [...path, 'to'], 'a date');
      if (oos.active !== undefined) want(oos.table, oos.active, ['bool'], [...path, 'active'], 'a bool');
    };
    if ('count' in pool) {
      const count = pool.count;
      if (index.table(count.table) === undefined) {
        out.push({ path: here('pool', 'count', 'table'), message: `"${count.table}" is not a table of this app` });
      } else {
        const counts = wantFk(count.table, count.column, here('pool', 'count', 'column'));
        if (counts !== undefined && target !== undefined && counts !== target) {
          out.push({ path: here('pool', 'count', 'column'), message: `"${count.table}.${count.column}" does not point at "${target}"` });
        }
        if (count.outOfService !== undefined) outOfService(count.outOfService, count.table, here('pool', 'count', 'outOfService'));
      }
      if (pool.fits !== undefined && target !== undefined) want(target, pool.fits.column, NUMERIC_TYPES, here('pool', 'fits', 'column'), 'a number');
      if (pool.given !== undefined) {
        const given = wantFk(table.ref, pool.given.via, here('pool', 'given', 'via'));
        const typed = given === undefined ? undefined : wantFk(given, pool.given.column, here('pool', 'given', 'column'));
        if (typed !== undefined && target !== undefined && typed !== target) {
          out.push({ path: here('pool', 'given', 'column'), message: `"${given!}.${pool.given.column}" does not point at "${target}"` });
        }
      }
    } else {
      if (typeof pool.size === 'object' && target !== undefined) want(target, pool.size.column, NUMERIC_TYPES, here('pool', 'size', 'column'), 'a number');
      if (pool.outOfService !== undefined) outOfService(pool.outOfService, target, here('pool', 'outOfService'));
    }
    if (rule.arrived !== undefined) {
      ownerOf(rule.arrived.via, here('arrived', 'via'));
      statesCount(rule.arrived.states, rule.arrived.via, here('arrived', 'states'), 'no stay counted in it has begun');
    }
    if (rule.nights !== undefined) {
      number(rule.nights.min, here('nights', 'min'));
      number(rule.nights.max, here('nights', 'max'));
      number(rule.nights.aheadDays, here('nights', 'aheadDays'));
      const { min, max } = rule.nights;
      if (typeof min === 'number' && typeof max === 'number' && min > max) {
        out.push({ path: here('nights'), message: 'the shortest stay is not longer than the longest' });
      }
      if (typeof min === 'number' && min === 0) out.push({ path: here('nights', 'min'), message: 'a stay is at least one night' });
    }
  } else {
    want(table.ref, rule.slot, ['timestamptz'], here('slot'), 'a timestamptz');
    if (typeof rule.amount === 'string') want(table.ref, rule.amount, ['int', 'bigint'], here('amount'), 'an int');
    if (rule.resource !== undefined) want(table.ref, rule.resource, null, here('resource'));
    number(rule.perSlot, here('perSlot'));
    number(rule.slotMinutes, here('slotMinutes'));
    if (typeof rule.slotMinutes === 'number' && rule.slotMinutes === 0) out.push({ path: here('slotMinutes'), message: 'the grid is at least one minute' });
    number(rule.windowDays, here('windowDays'));
    number(rule.cancelHours, here('cancelHours'));
    number(rule.noticeMinutes, here('noticeMinutes'));
    time(rule.opens, here('opens'));
    time(rule.closes, here('closes'));
    if (rule.hours !== undefined) {
      const hours = rule.hours;
      if (rule.opens !== undefined || rule.closes !== undefined) {
        out.push({ path: here('hours'), message: 'the hours come from the hours table, not from opens and closes' });
      }
      const weekday = want(hours.table, hours.weekday, ['enum'], here('hours', 'weekday'), `an enum of ${BOOKING_WEEKDAYS.join(', ')}`);
      if (weekday !== undefined && (weekday.enum ?? []).join(',') !== BOOKING_WEEKDAYS.join(',')) {
        out.push({ path: here('hours', 'weekday'), message: `"${hours.table}.${hours.weekday}" must be an enum of ${BOOKING_WEEKDAYS.join(', ')}` });
      }
      for (const name of ['opens', 'closes'] as const) want(hours.table, hours[name], ['text'], here('hours', name), 'a text column holding HH:MM');
      if (hours.open !== undefined) want(hours.table, hours.open, ['bool'], here('hours', 'open'), 'a bool');
    }
    if (rule.closures !== undefined) {
      const closures = rule.closures;
      want(closures.table, closures.from, ['date'], here('closures', 'from'), 'a date');
      want(closures.table, closures.to, ['date'], here('closures', 'to'), 'a date');
      if (closures.active !== undefined) want(closures.table, closures.active, ['bool'], here('closures', 'active'), 'a bool');
    }
    if (rule.pauses !== undefined) {
      const pauses = rule.pauses;
      want(pauses.table, pauses.slot, ['timestamptz'], here('pauses', 'slot'), 'a timestamptz');
      if (pauses.active !== undefined) want(pauses.table, pauses.active, ['bool'], here('pauses', 'active'), 'a bool');
    }
  }

  if (owners.size > 1) {
    const [first, second] = [...owners.keys()];
    out.push({ path: [...owners.values()][1]!, message: `a rule reads one owner: "${first!}" and "${second!}" differ` });
  }
  return out;
}

/**
 * The foreign keys a limit counts by, on `tableRef`: the pool's, a wider
 * pool's, the per-order key and the owner's. A plain index on one of them
 * keeps the count from reading the whole table.
 */
export function capacityViaColumns(capacity: Capacity | undefined): string[] {
  const out = new Set<string>();
  for (const rule of rulesOf(capacity)) {
    const conditions = rule.countWhere === undefined ? [] : Array.isArray(rule.countWhere) ? rule.countWhere : [rule.countWhere];
    for (const condition of conditions) if (condition.via !== undefined) out.add(condition.via);
    if (rule.hold?.via !== undefined) out.add(rule.hold.via);
    if (rule.kind === 'parent') {
      out.add(rule.via);
      if (rule.perWrite !== undefined) out.add(rule.perWrite.within);
      for (const wider of rule.also ?? []) out.add(wider.via);
      if (typeof rule.day === 'object' && rule.day.via !== undefined) out.add(rule.day.via);
      if (rule.reserved?.via !== undefined) out.add(rule.reserved.via);
    } else if (rule.kind === 'night') {
      out.add(rule.pool.via);
      for (const date of [rule.from, rule.to]) if (typeof date === 'object') out.add(date.via);
      if ('given' in rule.pool && rule.pool.given !== undefined) out.add(rule.pool.given.via);
    }
  }
  return [...out];
}

/**
 * Columns marked `index: true`: each must be a foreign key a limit or a total
 * counts by (a capacity's `via`, or the `via` of a rollup that adds up this
 * table's rows), and not already unique.
 */
export function viaIndexIssues(
  tables: readonly (TableShape<ColumnShape & { index?: true | undefined; unique?: true | undefined; rules?: { rollup?: { from: string; via: string } | undefined } | undefined }> & {
    capacity?: Capacity | undefined;
  })[],
): ReferenceIssue[] {
  const out: ReferenceIssue[] = [];
  const rolledUpBy = new Set<string>();
  for (const table of tables) {
    for (const column of table.columns) {
      const rollup = column.rules?.rollup;
      if (rollup !== undefined) rolledUpBy.add(`${rollup.from}\u0000${rollup.via}`);
    }
  }
  tables.forEach((table, t) => {
    const vias = new Set(capacityViaColumns(table.capacity));
    table.columns.forEach((column, c) => {
      if (column.index !== true) return;
      const path = ['requiredSchema', 'tables', t, 'columns', c, 'index'];
      if (column.unique === true || column.role === 'pk') {
        out.push({ path, message: `"${table.ref}.${column.ref}" is unique, so it is indexed already` });
      } else if (column.type !== 'fk' || (!vias.has(column.ref) && !rolledUpBy.has(`${table.ref}\u0000${column.ref}`))) {
        out.push({ path, message: `"${table.ref}.${column.ref}" is indexed only as a foreign key a limit or a total counts by` });
      }
    });
  });
  return out;
}
