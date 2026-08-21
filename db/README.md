# Database

Everything this app needs to run on a real database, and a way to get the demo
rows back out once you have data of your own.

```
schema.sql         the tables, keys, constraints and indexes — the app's shape
seed.sql           realistic demo rows, so the app is useful the moment it boots
demo-toolkit.sql   bookkeeping that records which rows came from seed.sql
init-demo.sh       first-boot hook: loads the demo rows unless DEMO_DATA=0
demo.mjs           the command behind `npm run demo:*`
```

`schema.sql` is always applied. It is also a valid **schema-only import** for
Adminium on its own, if you want to see the generated admin app without a
database at all.

## Out of the box

`docker compose up` gives you a working product: `clients-db` creates the
schema, installs the demo bookkeeping, and loads `seed.sql`. Nothing to decide,
nothing to run.

To start with an empty database instead — same schema, no rows — set this in
`.env` before the first `docker compose up`:

```
DEMO_DATA=0
```

That choice is not permanent in either direction. The demo data can be loaded
later, and removed again, as often as you like.

## Commands

| Command | What it does |
|---|---|
| `npm run demo:status` | What is loaded right now, table by table |
| `npm run demo:import` | Load `seed.sql` |
| `npm run demo:wipe`   | Remove the demo rows — the schema and your own rows stay |
| `npm run demo:reset`  | Wipe, then import a fresh copy |

`wipe` and `reset` ask before they do anything. Pass `--yes` to skip the
question (`npm run demo:wipe -- --yes`), which is also what you need in a
script, where there is nobody to ask.

By default these talk to the `clients-db` container through
`docker compose exec`, so nothing has to be installed locally. To point them at
a database somewhere else — Neon, Supabase, RDS, a plain local Postgres — set
`DATABASE_URL` and they will use `psql` directly:

```bash
DATABASE_URL=postgres://user:pass@host:5432/outline npm run demo:status
```

## How `wipe` knows what to remove

Before the seed runs, the toolkit records the primary key of every row that
already exists. After the seed runs, it records every key that appeared. That
difference — the ledger in the `adminium_demo` schema — is exactly the set of
rows the demo data added, and it is the only thing `wipe` deletes.

Nothing is written to your tables to make this work: no `is_demo` column, no
trigger, no reserved id range. A table only has to have a primary key.

The ledger lives in its own `adminium_demo` schema rather than in `public`, so it
never mixes with your own tables. Adminium treats that schema as reserved and
skips it when introspecting, so it does not turn into pages in the generated
admin app either.

Three things are worth knowing about a wipe:

- **A demo row your own data depends on is kept, not force-deleted.** If you
  wrote a record against a demo customer, deleting that customer would take
  your record with it, so the wipe leaves it and reports it under `kept`. Clear
  the reference and run the wipe again to finish the job.
- **`ON DELETE CASCADE` still applies.** A demo order takes its line items with
  it, including a line item you added to it yourself — that is what the schema
  says should happen. Those rows are counted separately under `cascaded` rather
  than folded into the total, so you can see it happened.
- **Emptied tables get their sequence reset.** Any table the wipe leaves with
  nothing in it goes back to where its id counter started, so a later import
  lays down the same ids again. A table still holding rows of yours keeps its
  counter, because rewinding it would hand out an id twice.

## Loading the demo data on top of your own data

`demo:import` warns first, and for a good reason: `seed.sql` uses fixed ids, so
on a database that already has rows it can collide with them. On an empty
database, or one where a wipe cleared the demo rows out, it is always safe.

## A database seeded before this toolkit existed

An older data volume has demo rows in it but no ledger, so `wipe` has nothing to
go on. One command adopts them:

```bash
node db/demo.mjs adopt
```

That marks **every** row currently in the database as demo data, so only do it
on a database that holds nothing but the seed. After it, `npm run demo:wipe`
works normally.

## Regenerating from scratch

If you would rather throw the whole database away and start over, that is still
the fastest route and nothing here gets in the way:

```bash
docker compose down -v && docker compose up
```
