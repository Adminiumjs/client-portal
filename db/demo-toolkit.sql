-- Adminium demo-data toolkit — bookkeeping so demo rows can be removed later.
--
-- WHAT THIS IS FOR
-- The app ships with a schema (schema.sql) and a set of realistic demo rows
-- (seed.sql) so `docker compose up` gives you a working product on the first
-- boot. Eventually you want your own data instead. Dropping the database would
-- also drop the schema; deleting rows by hand means knowing which of them came
-- from the seed. So the import records exactly which rows it inserted, and
-- `wipe()` removes those and nothing else — your schema and anything you
-- created yourself survive.
--
-- HOW IT WORKS
-- `begin_import()` snapshots the primary keys of every row that already exists,
-- and the position of every sequence. The seed then runs. `finish_import()`
-- diffs against the snapshot and records the primary key of every row that
-- appeared — that ledger is what `wipe()` replays in reverse. Nothing is
-- written to your tables: no marker column, no trigger, no reserved id range.
-- A table only has to have a primary key.
--
-- WHERE IT LIVES
-- Its own `adminium_demo` schema, so it never mixes with the application's own
-- tables in `public`. Adminium treats that schema as reserved and skips it when
-- introspecting, so it does not turn into pages in the generated admin app.
--
-- This file is idempotent — applying it to a database that already has it is a
-- no-op, so it doubles as the upgrade path for a database seeded before the
-- toolkit existed (see `adopt()`).
--
-- Requires PostgreSQL 10 or newer. Driven by `db/demo.mjs` — you should not
-- need to call any of this by hand.

CREATE SCHEMA IF NOT EXISTS adminium_demo;

COMMENT ON SCHEMA adminium_demo IS
  'Adminium demo-data bookkeeping. Not part of the application schema — records which rows came from db/seed.sql so they can be removed without touching your own data.';

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One row per import. Kept after a wipe as a history of what was loaded when.
CREATE TABLE IF NOT EXISTS adminium_demo.imports (
  id          serial PRIMARY KEY,
  label       text NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count   bigint NOT NULL DEFAULT 0,
  wiped_at    timestamptz
);

-- The ledger: one row per demo row, identified by its primary key rendered as
-- text. `blocked` is set by wipe() on a row it could not remove because your
-- own data still depends on it, with the database's own reason alongside.
CREATE TABLE IF NOT EXISTS adminium_demo.seeded_rows (
  import_id      integer NOT NULL REFERENCES adminium_demo.imports (id) ON DELETE CASCADE,
  schema_name    text NOT NULL,
  table_name     text NOT NULL,
  pk             text[] NOT NULL,
  blocked        boolean NOT NULL DEFAULT false,
  blocked_reason text,
  PRIMARY KEY (schema_name, table_name, pk)
);

-- Widen a ledger written by an earlier version of this file.
ALTER TABLE adminium_demo.seeded_rows ADD COLUMN IF NOT EXISTS blocked_reason text;

CREATE INDEX IF NOT EXISTS seeded_rows_import_idx
  ON adminium_demo.seeded_rows (import_id);

-- Where each sequence stood before the import. Restored on wipe for any table
-- the wipe leaves completely empty, so a later import can hand out the same
-- ids again — several seeds insert a serial row and then reference its id by
-- number, which only lines up when the sequence starts where it started.
CREATE TABLE IF NOT EXISTS adminium_demo.import_sequences (
  import_id   integer NOT NULL REFERENCES adminium_demo.imports (id) ON DELETE CASCADE,
  schema_name text NOT NULL,
  table_name  text NOT NULL,
  sequence_id text NOT NULL,
  last_value  bigint NOT NULL,
  is_called   boolean NOT NULL,
  PRIMARY KEY (import_id, sequence_id)
);

-- Scratch space for the pre-import snapshot. Unlogged: it never needs to
-- survive a crash, and it is truncated at the end of every import.
CREATE UNLOGGED TABLE IF NOT EXISTS adminium_demo.pre_import (
  schema_name text NOT NULL,
  table_name  text NOT NULL,
  pk          text[] NOT NULL,
  PRIMARY KEY (schema_name, table_name, pk)
);

CREATE UNLOGGED TABLE IF NOT EXISTS adminium_demo.pre_sequences (
  schema_name text NOT NULL,
  table_name  text NOT NULL,
  sequence_id text PRIMARY KEY,
  last_value  bigint NOT NULL,
  is_called   boolean NOT NULL
);

-- Single-row table remembering the in-flight import, so finish_import() scans
-- exactly the schemas begin_import() snapshotted.
CREATE TABLE IF NOT EXISTS adminium_demo.state (
  id              boolean PRIMARY KEY DEFAULT true CHECK (id),
  pending_schemas text[],
  pending_started timestamptz
);

INSERT INTO adminium_demo.state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION adminium_demo.toolkit_version()
RETURNS integer LANGUAGE sql IMMUTABLE AS $fn$ SELECT 2 $fn$;

-- `x.id::text, x.slug::text` for a table aliased `x` — primary key order is the
-- constraint's own column order, which is what the ledger stores.
CREATE OR REPLACE FUNCTION adminium_demo.pk_expr(p_alias text, p_cols text[])
RETURNS text LANGUAGE sql IMMUTABLE AS $fn$
  SELECT string_agg(format('%I.%I::text', p_alias, u.col), ', ' ORDER BY u.ord)
  FROM unnest(p_cols) WITH ORDINALITY AS u(col, ord)
$fn$;

-- Every ordinary table with a primary key in the given schemas. Partitions are
-- skipped (their parent covers them) and adminium_demo never includes itself.
CREATE OR REPLACE FUNCTION adminium_demo.target_tables(p_schemas text[])
RETURNS TABLE (schema_name text, table_name text, pk_cols text[])
LANGUAGE sql STABLE AS $fn$
  SELECT n.nspname::text,
         c.relname::text,
         array_agg(a.attname::text ORDER BY k.ord)
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_catalog.pg_constraint pc ON pc.conrelid = c.oid AND pc.contype = 'p'
   CROSS JOIN LATERAL unnest(pc.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
   WHERE c.relkind = 'r'
     AND NOT c.relispartition
     AND n.nspname::text = ANY (p_schemas)
     AND n.nspname <> 'adminium_demo'
   GROUP BY n.nspname, c.relname
   ORDER BY n.nspname, c.relname
$fn$;

-- Every serial/identity sequence owned by a column of those tables.
CREATE OR REPLACE FUNCTION adminium_demo.target_sequences(p_schemas text[])
RETURNS TABLE (schema_name text, table_name text, sequence_id text)
LANGUAGE sql STABLE AS $fn$
  SELECT t.schema_name, t.table_name, s.seq
    FROM adminium_demo.target_tables(p_schemas) t
   CROSS JOIN LATERAL (
          SELECT pg_catalog.pg_get_serial_sequence(
                   format('%I.%I', t.schema_name, t.table_name), a.attname) AS seq
            FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = format('%I.%I', t.schema_name, t.table_name)::regclass
             AND a.attnum > 0 AND NOT a.attisdropped
        ) s
   WHERE s.seq IS NOT NULL
$fn$;

-- ---------------------------------------------------------------------------
-- Import
-- ---------------------------------------------------------------------------

-- Call immediately before running seed.sql.
CREATE OR REPLACE FUNCTION adminium_demo.begin_import(p_schemas text[] DEFAULT ARRAY['public'])
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE
  t record;
  s record;
BEGIN
  TRUNCATE adminium_demo.pre_import;
  TRUNCATE adminium_demo.pre_sequences;
  UPDATE adminium_demo.state
     SET pending_schemas = p_schemas, pending_started = now()
   WHERE state.id;

  FOR t IN SELECT * FROM adminium_demo.target_tables(p_schemas) LOOP
    EXECUTE format(
      'INSERT INTO adminium_demo.pre_import (schema_name, table_name, pk)
       SELECT %L, %L, ARRAY[%s] FROM %I.%I x
       ON CONFLICT DO NOTHING',
      t.schema_name, t.table_name, adminium_demo.pk_expr('x', t.pk_cols),
      t.schema_name, t.table_name);
  END LOOP;

  FOR s IN SELECT * FROM adminium_demo.target_sequences(p_schemas) LOOP
    EXECUTE format(
      'INSERT INTO adminium_demo.pre_sequences
         (schema_name, table_name, sequence_id, last_value, is_called)
       SELECT %L, %L, %L, last_value, is_called FROM %s
       ON CONFLICT DO NOTHING',
      s.schema_name, s.table_name, s.sequence_id, s.sequence_id);
  END LOOP;
END
$fn$;

-- Call immediately after seed.sql. Returns the number of rows recorded.
CREATE OR REPLACE FUNCTION adminium_demo.finish_import(p_label text DEFAULT 'demo data')
RETURNS bigint LANGUAGE plpgsql AS $fn$
DECLARE
  t         record;
  v_schemas text[];
  v_import  integer;
  v_total   bigint := 0;
  v_n       bigint;
BEGIN
  SELECT s.pending_schemas INTO v_schemas FROM adminium_demo.state s WHERE s.id;
  IF v_schemas IS NULL THEN
    RAISE EXCEPTION 'no import in progress — call adminium_demo.begin_import() before the seed';
  END IF;

  INSERT INTO adminium_demo.imports (label) VALUES (p_label) RETURNING id INTO v_import;

  FOR t IN SELECT * FROM adminium_demo.target_tables(v_schemas) LOOP
    EXECUTE format(
      'INSERT INTO adminium_demo.seeded_rows (import_id, schema_name, table_name, pk)
       SELECT %s, %L, %L, ARRAY[%s] FROM %I.%I x
        WHERE NOT EXISTS (
                SELECT 1 FROM adminium_demo.pre_import p
                 WHERE p.schema_name = %L AND p.table_name = %L
                   AND p.pk = ARRAY[%s])
       ON CONFLICT DO NOTHING',
      v_import, t.schema_name, t.table_name, adminium_demo.pk_expr('x', t.pk_cols),
      t.schema_name, t.table_name,
      t.schema_name, t.table_name, adminium_demo.pk_expr('x', t.pk_cols));
    GET DIAGNOSTICS v_n = ROW_COUNT;
    v_total := v_total + v_n;
  END LOOP;

  INSERT INTO adminium_demo.import_sequences
    (import_id, schema_name, table_name, sequence_id, last_value, is_called)
  SELECT v_import, p.schema_name, p.table_name, p.sequence_id, p.last_value, p.is_called
    FROM adminium_demo.pre_sequences p
   ON CONFLICT DO NOTHING;

  TRUNCATE adminium_demo.pre_import;
  TRUNCATE adminium_demo.pre_sequences;
  UPDATE adminium_demo.state SET pending_schemas = NULL, pending_started = NULL WHERE state.id;
  UPDATE adminium_demo.imports SET row_count = v_total WHERE imports.id = v_import;

  -- An import with nothing in it is noise in the history.
  IF v_total = 0 THEN
    DELETE FROM adminium_demo.imports WHERE imports.id = v_import;
  END IF;

  RETURN v_total;
END
$fn$;

-- Escape hatch for a database that was seeded before this toolkit existed:
-- records EVERY row currently present as demo data. Only safe on a database
-- that holds nothing but the seed — after this, wipe() empties it.
CREATE OR REPLACE FUNCTION adminium_demo.adopt(
  p_label   text DEFAULT 'adopted existing rows',
  p_schemas text[] DEFAULT ARRAY['public'])
RETURNS bigint LANGUAGE plpgsql AS $fn$
BEGIN
  TRUNCATE adminium_demo.pre_import;
  -- No pre-import position to go back to; wipe() falls back to each sequence's
  -- own start value, which is where a freshly created database would have it.
  TRUNCATE adminium_demo.pre_sequences;
  UPDATE adminium_demo.state
     SET pending_schemas = p_schemas, pending_started = now()
   WHERE state.id;
  RETURN adminium_demo.finish_import(p_label);
END
$fn$;

-- ---------------------------------------------------------------------------
-- Wipe
-- ---------------------------------------------------------------------------

-- Removes every row the ledger attributes to a demo import and nothing else.
--
-- Deletes are retried table by table until no more succeed, so the foreign-key
-- order does not have to be known in advance. Anything the database refuses —
-- a restricted reference, or a referential action that would leave one of your
-- rows violating a constraint — is retried in a later round and then row by
-- row, so one stuck row does not strand the rest of its table. A demo row your
-- own data still depends on is KEPT, not force-deleted, and comes back in the
-- `kept` column with the database's reason recorded against it.
--
-- `cascaded` counts rows that disappeared beyond the ledger because the schema
-- declares ON DELETE CASCADE from a demo row. Those are the schema's own rules
-- (an order's line items go with the order), but they are reported rather than
-- hidden, because a row you added under a demo parent is counted there too.
--
-- Any table the wipe leaves completely empty has its sequence put back where it
-- stood before the import, so re-importing lays the same ids down again.
CREATE OR REPLACE FUNCTION adminium_demo.wipe()
RETURNS TABLE (schema_name text, table_name text, removed bigint, kept bigint, cascaded bigint)
LANGUAGE plpgsql AS $fn$
DECLARE
  -- No variable may be named `s`, `p` or `c` here: those are table aliases in
  -- the statements below, and a declared record of the same name wins the name
  -- resolution and silently reads from the wrong thing.
  t         record;
  r         record;
  v_seq     record;
  v_schemas text[];
  v_before  bigint;
  v_after   bigint;
  v_count   bigint;
BEGIN
  -- Nothing recorded means nothing to undo. Returning here also keeps a stray
  -- call from resetting sequences on tables that are simply empty.
  IF NOT EXISTS (SELECT 1 FROM adminium_demo.seeded_rows) THEN
    RETURN;
  END IF;

  SELECT coalesce(array_agg(DISTINCT s2.schema_name), ARRAY['public'])
    INTO v_schemas
    FROM adminium_demo.seeded_rows s2;

  CREATE TEMP TABLE IF NOT EXISTS adminium_demo_wipe_counts (
    schema_name text, table_name text, pk_cols text[],
    before_rows bigint, after_rows bigint, ledger_rows bigint, kept_rows bigint
  ) ON COMMIT DROP;
  TRUNCATE adminium_demo_wipe_counts;

  -- Row counts before, for every table in scope — cascade can touch a table
  -- that has no demo rows of its own, and that has to show up in the report.
  FOR t IN SELECT * FROM adminium_demo.target_tables(v_schemas) LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', t.schema_name, t.table_name) INTO v_before;
    SELECT count(*) INTO v_count
      FROM adminium_demo.seeded_rows s2
     WHERE s2.schema_name = t.schema_name AND s2.table_name = t.table_name;
    INSERT INTO adminium_demo_wipe_counts
      VALUES (t.schema_name, t.table_name, t.pk_cols, v_before, NULL, v_count, 0);
  END LOOP;

  UPDATE adminium_demo.seeded_rows
     SET blocked = false, blocked_reason = NULL
   WHERE blocked;

  -- Delete in rounds until a whole round frees nothing new. Each round tries
  -- the fast path first — one bulk DELETE per table — and only falls back to
  -- deleting row by row when the bulk statement is refused, because a single
  -- depended-on row would otherwise strand every other row in its table.
  --
  -- The rounds matter: a row that is stuck behind another demo row becomes
  -- deletable once that one goes, so anything marked blocked gets another try
  -- as long as the round made progress somewhere. What survives the last round
  -- is genuinely held by data that is not part of the demo import.
  LOOP
    SELECT count(*) INTO v_before FROM adminium_demo.seeded_rows;
    EXIT WHEN v_before = 0;

    FOR t IN SELECT c.* FROM adminium_demo_wipe_counts c
              WHERE EXISTS (SELECT 1 FROM adminium_demo.seeded_rows s2
                             WHERE s2.schema_name = c.schema_name
                               AND s2.table_name = c.table_name
                               AND NOT s2.blocked) LOOP
      BEGIN
        EXECUTE format(
          'DELETE FROM %I.%I x
            WHERE EXISTS (SELECT 1 FROM adminium_demo.seeded_rows s
                           WHERE s.schema_name = %L AND s.table_name = %L
                             AND NOT s.blocked
                             AND s.pk = ARRAY[%s])',
          t.schema_name, t.table_name,
          t.schema_name, t.table_name, adminium_demo.pk_expr('x', t.pk_cols));
      EXCEPTION WHEN integrity_constraint_violation THEN
        -- Refused as a batch. Work out which individual rows are actually held.
        FOR r IN SELECT s2.*, t.pk_cols
                   FROM adminium_demo.seeded_rows s2
                  WHERE s2.schema_name = t.schema_name
                    AND s2.table_name = t.table_name
                    AND NOT s2.blocked LOOP
          BEGIN
            EXECUTE format('DELETE FROM %I.%I x WHERE ARRAY[%s] = $1',
                           r.schema_name, r.table_name,
                           adminium_demo.pk_expr('x', r.pk_cols))
              USING r.pk;
          EXCEPTION WHEN integrity_constraint_violation THEN
            UPDATE adminium_demo.seeded_rows s
               SET blocked = true, blocked_reason = SQLERRM
             WHERE s.schema_name = r.schema_name
               AND s.table_name = r.table_name
               AND s.pk = r.pk;
          END;
        END LOOP;
      END;
    END LOOP;

    -- Reconcile: drop ledger entries whose row is gone, however it went
    -- (deleted above, or cascaded from another table's delete).
    FOR t IN SELECT c.* FROM adminium_demo_wipe_counts c
              WHERE EXISTS (SELECT 1 FROM adminium_demo.seeded_rows s2
                             WHERE s2.schema_name = c.schema_name
                               AND s2.table_name = c.table_name) LOOP
      EXECUTE format(
        'DELETE FROM adminium_demo.seeded_rows s
          WHERE s.schema_name = %L AND s.table_name = %L
            AND NOT EXISTS (SELECT 1 FROM %I.%I x WHERE ARRAY[%s] = s.pk)',
        t.schema_name, t.table_name,
        t.schema_name, t.table_name, adminium_demo.pk_expr('x', t.pk_cols));
    END LOOP;

    SELECT count(*) INTO v_after FROM adminium_demo.seeded_rows;
    EXIT WHEN v_after = 0 OR v_after = v_before;

    -- The round moved something, so every row it gave up on deserves another
    -- attempt against the smaller graph that is left.
    UPDATE adminium_demo.seeded_rows
       SET blocked = false, blocked_reason = NULL
     WHERE blocked;
  END LOOP;

  -- Counts after, and what stayed behind.
  FOR t IN SELECT * FROM adminium_demo_wipe_counts LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', t.schema_name, t.table_name) INTO v_after;
    SELECT count(*) INTO v_count
      FROM adminium_demo.seeded_rows s2
     WHERE s2.schema_name = t.schema_name AND s2.table_name = t.table_name;
    UPDATE adminium_demo_wipe_counts c
       SET after_rows = v_after, kept_rows = v_count
     WHERE c.schema_name = t.schema_name AND c.table_name = t.table_name;
  END LOOP;

  -- Put sequences back, but only for tables that ended up with nothing in them
  -- at all — resetting one under rows of your own would hand out ids twice.
  FOR v_seq IN SELECT q.schema_name, q.table_name, q.sequence_id
                 FROM adminium_demo.target_sequences(v_schemas) q
                 JOIN adminium_demo_wipe_counts c
                   ON c.schema_name = q.schema_name AND c.table_name = q.table_name
                WHERE c.after_rows = 0 LOOP
    BEGIN
      EXECUTE format(
        'SELECT setval(%L, coalesce((SELECT i.last_value FROM adminium_demo.import_sequences i
                                      WHERE i.sequence_id = %L ORDER BY i.import_id LIMIT 1),
                                    (SELECT q.start_value FROM pg_catalog.pg_sequences q
                                      WHERE format(''%%I.%%I'', q.schemaname, q.sequencename) = %L)),
                       coalesce((SELECT i.is_called FROM adminium_demo.import_sequences i
                                  WHERE i.sequence_id = %L ORDER BY i.import_id LIMIT 1),
                                false))',
        v_seq.sequence_id, v_seq.sequence_id, v_seq.sequence_id, v_seq.sequence_id);
    EXCEPTION WHEN OTHERS THEN
      -- A sequence we may not touch is not a reason to fail the wipe.
      NULL;
    END;
  END LOOP;

  UPDATE adminium_demo.imports i
     SET wiped_at = now()
   WHERE i.wiped_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM adminium_demo.seeded_rows s2 WHERE s2.import_id = i.id);

  DELETE FROM adminium_demo.import_sequences i
   WHERE NOT EXISTS (SELECT 1 FROM adminium_demo.seeded_rows s2 WHERE s2.import_id = i.import_id);

  RETURN QUERY
    SELECT c.schema_name,
           c.table_name,
           least(c.ledger_rows - c.kept_rows, c.before_rows - c.after_rows) AS removed,
           c.kept_rows AS kept,
           greatest((c.before_rows - c.after_rows)
                    - least(c.ledger_rows - c.kept_rows, c.before_rows - c.after_rows), 0) AS cascaded
      FROM adminium_demo_wipe_counts c
     WHERE c.before_rows <> c.after_rows OR c.kept_rows > 0
     ORDER BY c.schema_name, c.table_name;
END
$fn$;

-- ---------------------------------------------------------------------------
-- Status
-- ---------------------------------------------------------------------------

-- Per table: how many rows are demo rows, how many are yours, how many in all.
CREATE OR REPLACE FUNCTION adminium_demo.status(p_schemas text[] DEFAULT ARRAY['public'])
RETURNS TABLE (schema_name text, table_name text, demo_rows bigint, your_rows bigint, total_rows bigint)
LANGUAGE plpgsql STABLE AS $fn$
DECLARE
  t       record;
  v_total bigint;
  v_demo  bigint;
BEGIN
  FOR t IN SELECT * FROM adminium_demo.target_tables(p_schemas) LOOP
    EXECUTE format('SELECT count(*) FROM %I.%I', t.schema_name, t.table_name) INTO v_total;
    SELECT count(*) INTO v_demo
      FROM adminium_demo.seeded_rows s
     WHERE s.schema_name = t.schema_name AND s.table_name = t.table_name;
    schema_name := t.schema_name;
    table_name  := t.table_name;
    demo_rows   := v_demo;
    your_rows   := greatest(v_total - v_demo, 0);
    total_rows  := v_total;
    RETURN NEXT;
  END LOOP;
END
$fn$;

-- True when a demo import is currently loaded.
CREATE OR REPLACE FUNCTION adminium_demo.is_loaded()
RETURNS boolean LANGUAGE sql STABLE AS $fn$
  SELECT EXISTS (SELECT 1 FROM adminium_demo.seeded_rows)
$fn$;
