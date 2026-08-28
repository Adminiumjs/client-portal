// SPDX-License-Identifier: AGPL-3.0-only
/**
 * How many rows `db/seed.sql` actually inserts, per table.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * 28-public-surface.md §5.2 item 3 asks for maker-shop's `db/generate-seed.mjs`
 * in every repo, so `seed.sql` cannot drift from `src/data/demo.ts`. That
 * script is 372 lines of THIS studio's domain — it prices every line through
 * `piecesTotalCents()` and books every shelf movement through
 * `consumptionForLine()` — so "port it" is thirteen bespoke generators, not a
 * copy. Until that is funded, this is the cheap half that catches the failure
 * the generator exists to prevent: somebody edits one side and not the other.
 *
 * It asserts COUNTS, and it says so. A generator guarantees every value; this
 * guarantees that the two seeds describe the same number of things. That is
 * weaker and it is not nothing — every drift anybody has actually shipped in
 * this fleet was a row added on one side only.
 *
 * ── WHY A LEXER AND NOT A REGULAR EXPRESSION ───────────────────────────────
 * A seed row contains apostrophes (`'Selma''s'`), commas inside prose, and
 * parentheses inside prose — `'Mirror Phase (DJ set)'` is in event-ticketing's
 * seed today. Counting `(` with a regex reports that row twice. So this tracks
 * quote state and paren depth and counts only the parens that open at depth
 * zero, which is the same discipline `testing/egress.ts` had to learn.
 *
 * Synced byte-for-byte into every repo by `apply.sh`; edit the copy in
 * `workplan/tools/seed-drift/` and re-run it, never a repo's copy.
 */

/**
 * `INSERT INTO <table> … VALUES (…), (…);` → `Map<table, rows>`.
 *
 * Statements are accumulated, so a table inserted in three batches counts once
 * with the total — which is how every seed in this fleet is written.
 *
 * An `INSERT … SELECT` is NOT counted and is not silently treated as zero: it
 * lands in `uncountable` instead. clinic-desk seeds `clinician_hours` that way,
 * from a `CROSS JOIN (VALUES …)` whose tuples belong to the join and not to the
 * insert — counting them would have reported 22 rows for a table that has 20,
 * which is worse than admitting the shape is out of reach.
 */
export function rowCounts(sql) {
  const { counts } = scan(sql);
  return counts;
}

/** The tables seeded by an `INSERT … SELECT`, whose rows this cannot count. */
export function uncountableTables(sql) {
  return scan(sql).uncountable;
}

function scan(sql) {
  const counts = new Map();
  const uncountable = new Set();
  let i = 0;
  while (i < sql.length) {
    const at = sql.indexOf('INSERT INTO', i);
    if (at === -1) break;
    const head = /INSERT INTO\s+([a-zA-Z_][\w.]*)/y;
    head.lastIndex = at;
    const m = head.exec(sql);
    if (m === null) {
      i = at + 11;
      continue;
    }
    const table = (m[1] ?? '').split('.').pop();
    const parsed = countTuples(sql, head.lastIndex);
    if (parsed.rows === null) uncountable.add(table);
    else counts.set(table, (counts.get(table) ?? 0) + parsed.rows);
    i = parsed.end;
  }
  return { counts, uncountable };
}

/**
 * Count the top-level tuples of one statement, starting after its table name.
 *
 * `rows` is `null` when the statement is an `INSERT … SELECT`. Returns where
 * the statement ended so the caller resumes past it rather than re-scanning
 * prose that happens to contain the word INSERT.
 */
function countTuples(sql, from) {
  let i = skipTrivia(sql, from);

  // The optional column list. Balanced, and it is not a row.
  if (sql[i] === '(') i = skipTrivia(sql, skipGroup(sql, i));

  // What follows decides everything: VALUES counts, anything else cannot.
  if (!/^values/i.test(sql.slice(i, i + 6))) {
    return { rows: null, end: endOfStatement(sql, i) };
  }
  i += 6;

  let rows = 0;
  let depth = 0;
  while (i < sql.length) {
    const next = skipTrivia(sql, i);
    if (next !== i) { i = next; continue; }
    const ch = sql[i];
    if (ch === '(') {
      if (depth === 0) rows += 1;
      depth += 1;
      i += 1;
      continue;
    }
    if (ch === ')') { depth -= 1; i += 1; continue; }
    if (ch === ';' && depth === 0) return { rows, end: i + 1 };
    i += 1;
  }
  return { rows, end: i };
}

/** Past whitespace, `--` lines, `/* *\/` blocks, and whole string literals. */
function skipTrivia(sql, from) {
  let i = from;
  for (;;) {
    if (/\s/.test(sql[i] ?? '')) { i += 1; continue; }
    if (sql.startsWith('--', i)) {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl + 1;
      continue;
    }
    if (sql.startsWith('/*', i)) {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    if (sql[i] === "'") { i = skipString(sql, i); continue; }
    if (sql.startsWith('$$', i)) {
      const end = sql.indexOf('$$', i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    return i;
  }
}

/** Past a `'…'` literal, `''` escapes included. */
function skipString(sql, from) {
  let i = from + 1;
  while (i < sql.length) {
    if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
    if (sql[i] === "'") return i + 1;
    i += 1;
  }
  return i;
}

/** Past a balanced `( … )`, strings and comments included. */
function skipGroup(sql, from) {
  let i = from + 1;
  let depth = 1;
  while (i < sql.length && depth > 0) {
    const next = skipTrivia(sql, i);
    if (next !== i) { i = next; continue; }
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') depth -= 1;
    i += 1;
  }
  return i;
}

/** Past the next top-level `;`. */
function endOfStatement(sql, from) {
  let i = from;
  let depth = 0;
  while (i < sql.length) {
    const next = skipTrivia(sql, i);
    if (next !== i) { i = next; continue; }
    if (sql[i] === '(') depth += 1;
    else if (sql[i] === ')') depth -= 1;
    else if (sql[i] === ';' && depth === 0) return i + 1;
    i += 1;
  }
  return i;
}
