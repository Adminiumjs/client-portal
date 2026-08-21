#!/bin/bash
# First-boot demo-data import. Runs inside the Postgres container, once, on an
# empty data volume — after 01-schema.sql and 02-demo-toolkit.sql.
#
# Set DEMO_DATA=0 in .env to boot with the schema only and no rows at all. The
# demo data is not lost by doing that: `npm run demo:import` loads it whenever
# you want it, and `npm run demo:wipe` takes it back out again.
#
# seed.sql is deliberately mounted at /demo/seed.sql rather than in
# /docker-entrypoint-initdb.d — Postgres would otherwise run it itself, with no
# way to skip it and no record of which rows it inserted.

case "$(printf '%s' "${DEMO_DATA-1}" | tr '[:upper:]' '[:lower:]')" in
  0 | off | no | false | none | "")
    echo "demo data: SKIPPED (DEMO_DATA=${DEMO_DATA-}). The schema is in place and every table is empty."
    echo "demo data: load it later with  npm run demo:import"
    ;;
  *)
    echo "demo data: importing /demo/seed.sql …"
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
         -c "SELECT adminium_demo.begin_import();" &&
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
         -f /demo/seed.sql &&
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
         -c "SELECT adminium_demo.finish_import('first boot') AS demo_rows_imported;" &&
    echo "demo data: imported. Remove it later with  npm run demo:wipe  (your own rows stay)"
    ;;
esac
