/*
 * VENDORED VERBATIM from packages/manifest/src/plan-model.ts.
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
 * The install planner's shapes, on their own.
 *
 * Types only, so the planner (`plan.ts`), its context extension
 * (`plan-context.ts`) and the type rules (`plan-types.ts`) can all name them
 * without importing one another in a circle. `plan.ts` and `plan-context.ts`
 * re-export them, so every importer outside keeps its path.
 */

/** The existing database, as much of it as planning needs. */
export interface SchemaModelView {
  /** Every table name that already exists, however it got there. */
  tables: readonly {
    ref: string;
    columns: readonly ExistingColumnView[];
    /**
     * The column sets the table keeps unique, one-column ones included (a
     * constraint or a unique index). Absent = not known: no unique is then
     * offered to be added.
     */
    uniques?: readonly (readonly string[])[];
    /** The names of the table's indexes and constraints, for a new rule's name never to take one. */
    indexNames?: readonly string[];
    /** The columns an index of the table leads with; absent = not known, and no index is offered. */
    indexed?: readonly string[];
    /** Every plain-column index of the table, as its whole ordered column list; absent = not known, and no index over a set is offered. */
    indexSets?: readonly (readonly string[])[];
  }[];
  /**
   * The engine the tables live on. Only the type check reads it: SQLite
   * reports the installer's own `bool` as `integer` and its `money` as
   * `float`, which would be a conflict anywhere else. Absent, a type is judged
   * by the rules every engine shares.
   */
  dialect?: 'postgres' | 'mysql' | 'sqlite' | undefined;
  /** Every index and constraint name in the database, beyond the tables read: a new rule's name takes none. */
  indexNames?: readonly string[] | undefined;
}

/**
 * One existing column. Only `ref` is required; the rest is what the database
 * reports, and a caller that does not know it leaves it out. A column that
 * says nothing is never treated as required.
 */
export interface ExistingColumnView {
  ref: string;
  nullable?: boolean;
  /** The database fills it when an insert leaves it out (a default, a sequence). */
  hasDefault?: boolean;
  isPrimaryKey?: boolean;
  isGenerated?: boolean;
  /** The engine's logical type (`integer`, `varchar`, …). Absent = not judged. */
  logicalType?: string;
  /** The engine's own name for the type (`int unsigned`, `int4`), when the read tells it. */
  dbType?: string;
  /** A `varchar`'s width, when it has one. */
  maxLength?: number | null;
  /** A key the database numbers itself. Absent = unknown, never offered a repair. */
  isIdentity?: boolean;
  /** The values an enum column's CHECK (or native enum) admits, when it has one. */
  enumValues?: readonly string[];
  /** No two rows may hold the same value in it alone. Absent = not known. */
  isUnique?: boolean;
  /**
   * The table its foreign key points at, by that table's real name; null when
   * the database keeps no foreign key on it. Absent = not known, and never
   * offered a link.
   */
  linksTo?: string | null;
}

/** What will happen to one table. */
export type TableAction = 'create' | 'reuse';

export interface PlannedColumn {
  ref: string;
  type: string;
  /** Absent from an existing table, so the install would have to add it. */
  missing: boolean;
}

export interface PlannedTable {
  ref: string;
  /** The real table name, when a plan context gave the table one (prefixed or recorded). */
  table?: string;
  action: TableAction;
  columns: PlannedColumn[];
  /**
   * Only on `reuse`: columns the manifest requires that the existing table does
   * not have. A non-empty list is a PARTIAL MATCH — the table is there but does
   * not carry what the add-on needs, which is a different situation from either
   * "create it" or "it fits", and the operator should be told which.
   */
  missingColumns: string[];
}

/** Where one declared foreign key ends up pointing. */
export interface PlannedReference {
  fromTable: string;
  fromColumn: string;
  to: string;
  /**
   * `internal` — the target is another table in this manifest.
   * `host` — the target already exists in the database (the add-on attaching to
   *   the host's data, which is the intended shape).
   * `unresolved` — the target exists nowhere, and the plan is not installable.
   */
  resolution: 'internal' | 'host' | 'unresolved';
}

/** A reason the plan cannot be applied, phrased for a person. */
export interface PlanProblem {
  code:
    | 'UNRESOLVED_REFERENCE'
    | 'COLUMN_TYPE_CONFLICT'
    | 'COLUMNS_REQUIRED'
    | 'RESERVED_TABLE'
    | 'FOREIGN_TABLE'
    // A context plan's own: a taken name waiting for an answer, a name too long
    // for the engine, two apps' prefixed names meeting.
    | 'TABLE_TAKEN'
    | 'IDENTIFIER_TOO_LONG'
    | 'PREFIX_COLLISION'
    // Added by the server, which can see the pages and read their forms.
    | 'PAGE_SLUG_TAKEN'
    | 'PAGE_FORM_INVALID'
    | 'ROLE_INVALID'
    // An email the app ships that the renderer cannot draw.
    | 'EMAIL_TEMPLATE_INVALID'
    // A table built on an add-on's shape that differs from it, or names a shape the add-on lacks.
    | 'SHAPE_MISMATCH'
    | 'SHAPE_UNKNOWN'
    // A column that must hold no value twice, wider than MySQL can index.
    | 'UNIQUE_KEY_TOO_LONG'
    // Added by the server, which can read the rows: a unique a table lacks, which rows already there break.
    | 'UNIQUE_DUPLICATES'
    // Added by the server, which can read the rows: a link a table lacks, which rows already there break.
    | 'LINK_ORPHANS'
    // Added by the server, which knows where each app is installed: the app runs on another connection.
    | 'APP_INSTALLED_ELSEWHERE'
    // An update that would take a shape off a table another installed app shares under it.
    | 'SHAPE_IN_USE'
    // Added by the server: a public endpoint this app would add under a name another app's endpoint already has.
    | 'SHARE_REF_TAKEN';
  message: string;
  table: string;
  column?: string;
  /** `APP_INSTALLED_ELSEWHERE` only: the connection the app is installed on. */
  connectionId?: string;
}

export interface InstallPlan {
  /**
   * The manifest key this plan is for.
   *
   * Named `addOnKey` because add-ons were the only caller when it was written,
   * and left named that because the wire DTOs each route builds are where a
   * reader meets it — `routes/apps` spells it `key` on its own reply. Renaming
   * it here would churn three call sites and a shipped dialog for a field only
   * the server reads.
   */
  addOnKey: string;
  version: string;
  /** Tables to create, in declaration order (targets before dependents). */
  create: PlannedTable[];
  /** Tables that already exist and will be reused rather than created. */
  reuse: PlannedTable[];
  references: PlannedReference[];
  problems: PlanProblem[];
  /**
   * `true` when there is nothing standing in the way. A plan with problems is
   * still RETURNED — the consent dialog has to be able to show WHY an add-on
   * cannot be installed here, and an exception would leave it with nothing to
   * render.
   */
  installable: boolean;
  /** No `requiredSchema` at all: install touches no data source. */
  touchesData: boolean;
  /** With a plan context: each table's class, action, offers and edits. */
  tables?: InstallTablePlan[];
  /** With a plan context: short name → real table. */
  names?: Record<string, string>;
  /**
   * With a plan context: per shape the app declares (`menu@1`), the other
   * apps whose tables of that shape this app may use as its own, and what the
   * plan does. Absent when no other app here has them.
   */
  shareOffers?: ShareOffer[];
}

/** One shape another installed app's tables have, offered to this app. */
export interface ShareOffer {
  shape: string;
  /** The app whose tables the plan uses (`share`), or the one recommended (`separate`). */
  with: string;
  /** Every app whose tables could be used, the recommended one (the first installed) first. */
  candidates: string[];
  /** `share`: the app uses `with`'s tables. `separate`: it makes its own. */
  action: 'share' | 'separate';
  /** `with`'s real tables of the shape, by this app's short names. */
  tables: string[];
  /** The columns sharing would add to `with`'s tables (this app's own, nullable). */
  addColumns: { table: string; column: string }[];
}

/** What the operator answered for the tables of one shape: use another app's, or keep separate ones. */
export type ShareChoice = { action: 'share'; with: string } | { action: 'separate' };

/** What the operator answered for one taken table. */
export type TableChoice =
  | { action: 'reuse' }
  | { action: 'share' }
  | { action: 'rename-existing'; to: string };

export interface PlanContext {
  /** The app's own prefix (`pos_`), or null for an app whose tables are not prefixed. */
  prefix: string | null;
  /** A different prefix for every table of this app, chosen on the check step. */
  altPrefix?: string | undefined;
  /** This app's own records on this connection, by short name. */
  records: Readonly<Record<string, { table: string; owned: boolean; state: string }>>;
  /**
   * What OTHER apps record on this connection. `ref` (their short name) and
   * `createdAt` let a table of a shape be found under any real name; a record
   * without `ref` is matched by its real name only. `appName` words a
   * refusal that names the app.
   */
  others: readonly { appKey: string; table: string; shape: string | null; state: string; ref?: string | undefined; createdAt?: number | undefined; appName?: string | undefined }[];
  /** The operator's answers, by short name. */
  choices?: Readonly<Record<string, TableChoice>> | undefined;
  /** The operator's answers per shape (`menu@1`): use another app's tables, or keep separate ones. */
  shares?: Readonly<Record<string, ShareChoice>> | undefined;
  dialect: 'postgres' | 'mysql' | 'sqlite';
}

export type TableClass = 'new' | 'own-leftover' | 'shared' | 'taken';
export type ContextTableAction = 'create' | 'reuse' | 'share' | 'rename-existing' | 'undecided';
export type TableOffer = 'reuse' | 'share' | 'separate' | 'rename-existing' | 'alt-prefix';

/** One change a reused table needs, every one of them unable to lose data. */
export type PlanEdit =
  | { kind: 'add-column'; column: string }
  | { kind: 'widen'; column: string; from: string; to: string }
  | { kind: 'set-identity'; column: string }
  | { kind: 'enum-values'; column: string; values: string[] }
  /**
   * The column must hold no value twice (with `with`: no two rows the same in
   * those columns and this one together), as a table made with it would, and
   * the table does not say so yet. Offered only where no two rows break it.
   */
  | { kind: 'add-unique'; column: string; with?: string[]; name?: string }
  /**
   * A plain index: one a limit or a total counts by (`index: true`), or a
   * set the table declares or a ledger reads by (`with`: the columns before
   * this one, in order).
   */
  | { kind: 'add-index'; column: string; with?: string[]; name: string }
  /**
   * The column is declared a link (`fk`) and the table keeps it as a plain
   * value with no foreign key — it was first made a number, or the table was
   * made by hand. `to` is the table it references, as the manifest names it.
   * Offered only where every row already points at a row that is there.
   */
  | { kind: 'add-link'; column: string; to: string };

export interface InstallTablePlan {
  /** The manifest's short name. */
  ref: string;
  /** The real table: prefixed, recorded, or the ref itself. */
  table: string;
  class: TableClass;
  action: ContextTableAction;
  /** What the check step offers for this table. */
  offers: TableOffer[];
  /** Why reuse is NOT offered on a taken table, for a person. */
  reuseRefusal?: string | undefined;
  /** For `rename-existing`: what the existing table is renamed to. */
  renameExistingTo?: string | undefined;
  /** For `share`: the app whose table this is. */
  sharedWith?: string | undefined;
  /** The shape the app declares the table with (`menu@1`). */
  shape?: string | undefined;
  /**
   * For `own-leftover`: the earlier install used a table that was already
   * there rather than making it. The check step words the two apart.
   */
  adopted?: true | undefined;
  edits: PlanEdit[];
  /** Columns that cannot be added this way, and why. */
  blocked: { column: string; reason: 'foreign-key' | 'primary-key' | 'unsupported-type' }[];
}
