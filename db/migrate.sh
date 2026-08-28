#!/bin/sh
# Apply the schema, and optionally the demo rows, to a managed database.
#
# `DATABASE_URL` is bound by the platform from the database component; on
# DigitalOcean it arrives with `sslmode=require` already on it.
#
# DEMO_DATA mirrors the compose flag deliberately: 1 loads the sample rows so a
# fresh deploy has something to look at, 0 leaves an empty database with the
# same schema. Either way `npm run demo:wipe` removes them later without
# touching the schema or anything the operator added — which is why loading them
# here is safe and hiding a demo behind a deploy button was not.
set -eu

# Where the SQL lives. Defaults to this script's own directory, so the same
# script runs inside the job container (/db) and against a local Postgres with
# nothing moved. It hardcoded /db, which made it correct in exactly one place
# and impossible to test anywhere.
DB_DIR="${DB_DIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}"

if [ -z "${DATABASE_URL:-}" ]; then
  echo "migrate: DATABASE_URL is not set — nothing to migrate into." >&2
  exit 1
fi

# ─── THE GUARD, and why it is not optional ───────────────────────────────────
#
# `schema.sql` OPENS WITH `DROP TABLE ... CASCADE` on every table. That is
# correct where it was written for — Docker's `docker-entrypoint-initdb.d`,
# which runs once on an empty volume — and catastrophic here, because a
# PRE_DEPLOY job runs on EVERY deploy. Unguarded, this file would silently
# destroy the operator's data each time they pushed.
#
# So the schema is applied only to a database that does not already have it.
# Detected by asking the catalog, not by trusting a flag: a half-applied schema
# from an interrupted first run still counts as present, and re-running the
# drops over it would turn a recoverable state into an empty one.
existing=$(psql "$DATABASE_URL" -tAc   "select count(*) from information_schema.tables where table_schema='public' and table_name='clients'"   2>/dev/null || echo 0)

if [ "$existing" = "0" ]; then
  echo "migrate: empty database — applying schema"
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DB_DIR/schema.sql"
else
  echo "migrate: schema already present — NOT re-applying (it would drop your tables)"
fi

echo "migrate: installing the demo-data toolkit"
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DB_DIR/demo-toolkit.sql"

if [ "${DEMO_DATA:-1}" = "1" ]; then
  # Only into an empty table set — a redeploy must never duplicate the rows,
  # and must never overwrite real ones the operator has since entered.
  rows=$(psql "$DATABASE_URL" -tAc "select count(*) from clients" 2>/dev/null || echo 0)
  if [ "$rows" = "0" ]; then
    echo "migrate: loading sample rows"
    psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$DB_DIR/seed.sql"
  else
    echo "migrate: $rows client(s) already present — leaving data alone"
  fi
else
  echo "migrate: DEMO_DATA=0 — schema only"
fi

echo "migrate: done"
