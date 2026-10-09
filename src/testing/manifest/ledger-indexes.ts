/*
 * VENDORED VERBATIM from packages/manifest/src/ledger-indexes.ts.
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
 * THE KEY AND THE INDEXES ADMINIUM MAKES FOR A LEDGER.
 *
 * An add-on declares its receipt table's columns and nothing about how the
 * table is keyed. Adminium derives that itself, from the ledger declaration,
 * so no manifest can get it wrong — and so the one unique key that makes a
 * posting happen once (source, line, posting, phase and round) is always
 * there, on a new table and on one an install reuses:
 *
 *  - the receipt table: unique on its six key columns; an index on
 *    (`line_table`, `source_line`), which a line's guard reads by; an index
 *    on `held_until`, which the timed job scans;
 *  - every ledger table an action inserts into: an index on `receipt_id`,
 *    which a reverse reads the round's rows by.
 *
 * One function, called by the path that creates the tables and by the
 * planner that edits a reused one. Pure.
 */
import { RECEIPT_KEY, type Ledger } from './ledgers.ts';
import { MYSQL_UNIQUE_KEY_BYTES, uniqueSetBytes } from './key-bytes.ts';
import { ledgersOf, type Manifest, type RequiredColumn } from './schema.ts';

export interface LedgerIndex {
  /** The add-on's own short name for the table. */
  table: string;
  columns: string[];
  unique: boolean;
}

/** Every key and index a manifest's ledgers need, each table and column set once, in declaration order. */
export function ledgerIndexes(manifest: Manifest): LedgerIndex[] {
  return indexesOf(ledgersOf(manifest));
}

function indexesOf(ledgers: readonly Ledger[]): LedgerIndex[] {
  const out: LedgerIndex[] = [];
  const seen = new Set<string>();
  const add = (table: string, columns: readonly string[], unique: boolean) => {
    const key = `${table}|${columns.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ table, columns: [...columns], unique });
  };
  for (const ledger of ledgers) {
    add(ledger.receipts, RECEIPT_KEY, true);
    add(ledger.receipts, ['line_table', 'source_line'], false);
    add(ledger.receipts, ['held_until'], false);
    for (const [table, scope] of Object.entries(ledger.writes)) {
      if (scope.insert !== undefined) add(table, ['receipt_id'], false);
    }
  }
  return out;
}

/**
 * A receipt key too wide for MySQL to index (3,072 bytes, four a character of
 * text): the widths of its text columns are the add-on's to choose, so the
 * manifest is refused before any database is asked to make the key.
 */
export function ledgerIndexIssues(manifest: Manifest): { path: string; message: string }[] {
  const out: { path: string; message: string }[] = [];
  const tables = (manifest.requiredSchema?.tables ?? []) as readonly { ref: string; columns: readonly RequiredColumn[] }[];
  for (const index of ledgerIndexes(manifest)) {
    if (!index.unique) continue;
    const t = tables.findIndex((candidate) => candidate.ref === index.table);
    const table = tables[t];
    if (table === undefined) continue;
    const bytes = uniqueSetBytes(index.columns, table, tables);
    if (bytes > MYSQL_UNIQUE_KEY_BYTES) {
      const widths = index.columns.map((ref) => `${ref} ${String(table.columns.find((column) => column.ref === ref)?.maxLength ?? '')}`.trim()).join(', ');
      out.push({
        path: `requiredSchema.tables.${String(t)}.columns`,
        message: `the key of the receipt table "${index.table}" (${widths}) takes ${String(bytes)} bytes, and MySQL indexes at most ${String(MYSQL_UNIQUE_KEY_BYTES)}: shorten its text columns (four bytes a character)`,
      });
    }
  }
  return out;
}
