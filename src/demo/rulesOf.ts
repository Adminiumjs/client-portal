/**
 * The rules the demo's stand-in world keeps, read out of the app's manifest.
 *
 * The world plays Adminium with no server, so it needs the rules Adminium
 * applies to every write: a table's states (the moves it allows, what they
 * need, what a state locks), the values stamped when something happens, the
 * places a decimal is kept to, and the messages the outbox makes and when.
 * The manifest is far too big to ship to the browser for that (it carries
 * every email in eight languages), so `writeRules.ts` writes this function's
 * answer into `rules.ts`, and `rules.test.ts` fails when the two drift apart.
 *
 * The copies, fills, formulas, rollups and running numbers are the sample
 * loader's (`data/sampleRows.ts` `RULES`), held to the same manifest by its own
 * drift test; this adds only what a sample load never needs.
 */

/** A condition a move needs of the row (`requires.where`). */
export interface RowCondition {
  column: string;
  gt?: number;
  gte?: number;
  lt?: number;
  lte?: number;
  eq?: string | number | boolean;
  neq?: string | number | boolean;
}

export interface Move {
  to: string;
  requires?: { children?: Record<string, number>; where?: RowCondition[] };
  roles?: string[];
}

export interface StatesRule {
  column: string;
  initial: string;
  /** From each state, the moves it allows (a bare name is a move with no conditions). */
  moves: Record<string, Move[]>;
  lock?: { when: string[]; except: string[] };
  children?: Record<string, { via: string; lock?: boolean; parentIn?: string[]; clearOnCreate?: string[] }>;
  noDelete?: { when: "numbered" | string[] };
  onlyLater?: string[];
  lockedWhenReferencedBy?: { table: string; via: string; in: string[] }[];
}

export interface StampRule {
  column: string;
  /** `now`, `today`, `user-name`, or an object: `{claim}`, `{byOrigin}`, `{addDays}`, `{hashOf}`, `{copy}`. */
  set: unknown;
  /** `create`, `{column, values}`, `{column, filled}`, or a list of those. */
  on: unknown;
}

export interface OutboxProducerRule {
  kind: string;
  link: string;
  onCreate?: { table: string; via?: string; where?: RowCondition };
  onChange?: { table: string; via?: string; column: string; to: unknown; where?: RowCondition };
  hold?: boolean;
  due?: { date: string; days: unknown; at?: string };
  supersede?: string;
  dropWhen?: (RowCondition & { reason: string })[];
  onSent?: { table: string; via?: string; set: Record<string, unknown> };
  recipient?: { setting: { table: string; column: string } };
  gate?: { setting: { table: string; column: string } };
  batchMinutes?: number;
}

export interface OutboxRule {
  table: string;
  columns: Record<string, string>;
  links: Record<string, string>;
  recipient: { via: string; table: string; email: string; name: string; language?: string; fallback?: { via: string; email: string; name: string } };
  producers: OutboxProducerRule[];
}

export interface DemoRules {
  /** Every decimal column's places: a number, or the row's currency's own. */
  decimals: Record<string, Record<string, number | "currency">>;
  states: Record<string, StatesRule>;
  stamps: Record<string, StampRule[]>;
  /** A code the server draws at random (a share link's token), and its length. */
  codes: Record<string, { column: string; length: number }[]>;
  outbox: OutboxRule | null;
  /** The manifest type of every column a fingerprint reads (it spells each by its type). */
  kinds: Record<string, Record<string, string>>;
  /** Numbers without gaps: the column, and the add-on setting its series starts at. */
  numbered: Record<string, { column: string; startSetting: string | null }[]>;
  /** Tables whose balance may never go below zero (`rollup.cap`). */
  capped: string[];
  /** Columns no two rows may share, and those kept as an address (trimmed, lower case) before they are compared. */
  unique: Record<string, string[]>;
  normalize: Record<string, string[]>;
  /** Every foreign key: the table it points at (what the outbox fills a message's links through). */
  references: Record<string, Record<string, string>>;
  /** The numbers a column keeps within (`validation.min`/`max`), judged on the value a write leaves, worked out ones too. */
  ranges: Record<string, Record<string, { min?: number; max?: number }>>;
}

interface ManifestColumn {
  ref: string;
  type: string;
  unique?: boolean;
  references?: string;

  scale?: number | "currency";
  rules?: {
    stamp?: { set: unknown; on: unknown };
    code?: { length?: number };
    sequence?: { gapless?: boolean; startSetting?: { addOn: string; setting: string } };
    rollup?: { cap?: boolean };
    normalize?: string;
    validation?: { min?: number; max?: number };
  };
}

export interface ManifestForRules {
  requiredSchema: { tables: { ref: string; columns: ManifestColumn[]; states?: Record<string, unknown> }[] };
  outbox?: Record<string, unknown>;
}

/** A move as the manifest writes it (a name, or an object), always as an object. */
function moveOf(move: unknown): Move {
  if (typeof move === "string") return { to: move };
  const m = move as { to: string; requires?: Move["requires"]; roles?: string[] };
  return { to: m.to, ...(m.requires === undefined ? {} : { requires: m.requires }), ...(m.roles === undefined ? {} : { roles: m.roles }) };
}

export function demoRulesOf(manifest: ManifestForRules): DemoRules {
  const decimals: DemoRules["decimals"] = {};
  const states: DemoRules["states"] = {};
  const stamps: DemoRules["stamps"] = {};
  const codes: DemoRules["codes"] = {};
  const numbered: DemoRules["numbered"] = {};
  const capped: string[] = [];
  const hashed = new Set<string>();
  const unique: DemoRules["unique"] = {};
  const normalize: DemoRules["normalize"] = {};
  const references: DemoRules["references"] = {};
  const ranges: DemoRules["ranges"] = {};
  for (const table of manifest.requiredSchema.tables) {
    for (const column of table.columns) {
      if (column.type === "fk" && typeof column.references === "string") (references[table.ref] ??= {})[column.ref] = column.references;
      if (column.unique === true) (unique[table.ref] ??= []).push(column.ref);
      const { min, max } = column.rules?.validation ?? {};
      if (min !== undefined || max !== undefined) (ranges[table.ref] ??= {})[column.ref] = { ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) };
      if (column.rules?.normalize === "email") (normalize[table.ref] ??= []).push(column.ref);
      const sequence = column.rules?.sequence;
      if (sequence?.gapless === true) {
        const start = sequence.startSetting;
        (numbered[table.ref] ??= []).push({ column: column.ref, startSetting: start === undefined ? null : `${start.addOn}.${start.setting}` });
      }
      if (column.rules?.rollup?.cap === true && !capped.includes(table.ref)) capped.push(table.ref);
      const seal = column.rules?.stamp?.set as { hashOf?: { children?: { table: string; children?: { table: string }[] }[]; linked?: { table: string; children?: { table: string }[] }[] } } | undefined;
      if (typeof seal === "object" && seal !== null && seal.hashOf !== undefined) {
        hashed.add(table.ref);
        for (const part of [...(seal.hashOf.children ?? []), ...(seal.hashOf.linked ?? [])]) {
          hashed.add(part.table);
          for (const child of part.children ?? []) hashed.add(child.table);
        }
      }
      if (column.type === "decimal") (decimals[table.ref] ??= {})[column.ref] = column.scale ?? 4;
      const stamp = column.rules?.stamp;
      if (stamp !== undefined) (stamps[table.ref] ??= []).push({ column: column.ref, set: stamp.set, on: stamp.on });
      const code = column.rules?.code;
      if (code !== undefined) (codes[table.ref] ??= []).push({ column: column.ref, length: code.length ?? 16 });
    }
    const s = table.states as (Omit<StatesRule, "moves"> & { moves: Record<string, unknown[]>; lock?: { when: string[]; except?: string[] } }) | undefined;
    if (s !== undefined) {
      states[table.ref] = {
        column: s.column,
        initial: s.initial,
        moves: Object.fromEntries(Object.entries(s.moves).map(([from, list]) => [from, list.map(moveOf)])),
        ...(s.lock === undefined ? {} : { lock: { when: s.lock.when, except: s.lock.except ?? [] } }),
        ...(s.children === undefined ? {} : { children: s.children }),
        ...(s.noDelete === undefined ? {} : { noDelete: s.noDelete }),
        ...(s.onlyLater === undefined ? {} : { onlyLater: s.onlyLater }),
        ...(s.lockedWhenReferencedBy === undefined ? {} : { lockedWhenReferencedBy: s.lockedWhenReferencedBy }),
      };
    }
  }
  const box = manifest.outbox as (OutboxRule & { kinds?: unknown; settings?: unknown; pages?: unknown }) | undefined;
  const outbox: OutboxRule | null =
    box === undefined ? null : { table: box.table, columns: box.columns, links: box.links, recipient: box.recipient, producers: box.producers };
  const kinds: DemoRules["kinds"] = {};
  for (const table of manifest.requiredSchema.tables) {
    if (hashed.has(table.ref)) kinds[table.ref] = Object.fromEntries(table.columns.map((column) => [column.ref, column.type]));
  }
  return { decimals, states, stamps, codes, outbox, kinds, numbered, capped, unique, normalize, references, ranges };
}

/** `rules.ts` as `writeRules.ts` writes it. */
export function rulesSource(manifest: ManifestForRules): string {
  const rules = demoRulesOf(manifest);
  return [
    "/**",
    " * The rules the demo's stand-in world keeps — WRITTEN from manifest.json by",
    " * `npx vite-node src/demo/writeRules.ts`; do not edit by hand (`rules.test.ts`",
    " * fails when this and the manifest disagree). What each part means is in",
    " * `rulesOf.ts`.",
    " */",
    'import type { DemoRules } from "./rulesOf.ts";',
    "",
    `export const DEMO_RULES: DemoRules = ${JSON.stringify(rules, null, 2)};`,
    "",
  ].join("\n");
}

