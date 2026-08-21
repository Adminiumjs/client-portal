#!/usr/bin/env node
// Demo-data control for this app's database.
//
//   npm run demo:status    what is loaded right now, table by table
//   npm run demo:import    load db/seed.sql (recorded, so it can be removed)
//   npm run demo:wipe      remove the demo rows — schema and your own data stay
//   npm run demo:reset     wipe, then import a fresh copy
//
// Targets, in order:
//   1. $DATABASE_URL, if set — any Postgres, including a hosted one. Needs
//      `psql` on your PATH.
//   2. otherwise the `DB_SERVICE` container from docker-compose.yml, via
//      `docker compose exec`. Needs nothing installed locally.
//
// Zero dependencies: it shells out to psql, the same way you would.

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";

// --- per-app configuration (matches docker-compose.yml) ---------------------
const DB_SERVICE = "clients-db";
const DB_USER = "adminium";
const DB_NAME = "outline";
// ---------------------------------------------------------------------------

const DB_DIR = dirname(fileURLToPath(import.meta.url));
const SEED_SQL = join(DB_DIR, "seed.sql");
const TOOLKIT_SQL = join(DB_DIR, "demo-toolkit.sql");
const REPO_DIR = dirname(DB_DIR);

const USAGE = `Demo data for this app's database.

  node db/demo.mjs status     what is loaded, table by table
  node db/demo.mjs import     load db/seed.sql
  node db/demo.mjs wipe       remove the demo rows (schema + your data stay)
  node db/demo.mjs reset      wipe, then import a fresh copy
  node db/demo.mjs adopt      for a database seeded before this tool existed:
                              record every row now present as demo data, so it
                              can be wiped. Only safe if it holds just the seed.

Options
  --yes       do not ask for confirmation (required when not on a terminal)
  --label=X   name this import in the history (default: "manual import")

Set DATABASE_URL to target a database directly instead of the
docker-compose "${DB_SERVICE}" service.`;

const args = process.argv.slice(2);
const command = args.find((a) => !a.startsWith("-")) ?? "help";
const assumeYes = args.includes("--yes") || args.includes("-y");
const label =
  args.find((a) => a.startsWith("--label="))?.slice("--label=".length) ??
  "manual import";

// --- talking to Postgres ---------------------------------------------------

/** How we reach the database, and a human-readable name for it. */
function target() {
  const url = process.env.DATABASE_URL;
  if (url) {
    return {
      kind: "url",
      describe: url.replace(/\/\/[^@]*@/, "//***@"),
      argv: (extra) => [
        "psql",
        ["-v", "ON_ERROR_STOP=1", "-P", "pager=off", "-d", url, ...extra],
      ],
    };
  }
  return {
    kind: "compose",
    describe: `docker compose service "${DB_SERVICE}" (database ${DB_NAME})`,
    argv: (extra) => [
      "docker",
      [
        "compose",
        "exec",
        "-T",
        DB_SERVICE,
        "psql",
        "-v",
        "ON_ERROR_STOP=1",
        "-P",
        "pager=off",
        "-U",
        DB_USER,
        "-d",
        DB_NAME,
        ...extra,
      ],
    ],
  };
}

const TARGET = target();

/** Run SQL (a string, or the contents of a file) and return stdout. */
function psql(sql, { quiet = false, tuplesOnly = false } = {}) {
  const extra = tuplesOnly ? ["-tA"] : [];
  const [cmd, argv] = TARGET.argv(extra);
  const run = spawnSync(cmd, argv, {
    input: sql,
    cwd: REPO_DIR,
    encoding: "utf8",
  });

  if (run.error?.code === "ENOENT") {
    fail(
      TARGET.kind === "compose"
        ? `\`docker\` is not on your PATH.\n\nEither start the stack with \`docker compose up\`, or point this at a\ndatabase directly:  DATABASE_URL=postgres://… npm run demo:${command}`
        : "`psql` is not on your PATH. Install the Postgres client, or drop\nDATABASE_URL to go through docker compose instead.",
    );
  }
  if (run.status !== 0) {
    const stderr = (run.stderr || "").trim();
    if (TARGET.kind === "compose" && /is not running|No such service|not found/i.test(stderr)) {
      fail(
        `The database is not running.\n\n  ${stderr}\n\nStart it with \`docker compose up\`, or set DATABASE_URL to reach a\ndatabase somewhere else.`,
      );
    }
    fail(stderr || `psql exited ${run.status}`);
  }
  if (!quiet && run.stdout.trim()) process.stdout.write(run.stdout);
  return run.stdout;
}

function scalar(sql) {
  return psql(sql, { quiet: true, tuplesOnly: true }).trim();
}

function fail(message) {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

/** Idempotent — also the upgrade path for a database created before the toolkit. */
function ensureToolkit() {
  if (!existsSync(TOOLKIT_SQL)) fail(`missing ${TOOLKIT_SQL}`);
  psql(readFileSync(TOOLKIT_SQL, "utf8"), { quiet: true });
}

function demoRowCount() {
  return Number(scalar("SELECT count(*) FROM adminium_demo.seeded_rows;"));
}

function appRowCount() {
  return Number(
    scalar(
      "SELECT coalesce(sum(total_rows), 0) FROM adminium_demo.status();",
    ),
  );
}

async function confirm(question) {
  if (assumeYes) return true;
  if (!process.stdin.isTTY) {
    fail(
      `${question}\n\nNot running on a terminal, so there is nobody to ask. Re-run with --yes\nif you meant it:  npm run demo:${command} -- --yes`,
    );
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// --- commands --------------------------------------------------------------

function status() {
  ensureToolkit();
  console.log(`Database: ${TARGET.describe}\n`);
  psql(
    `SELECT table_name AS "table",
            demo_rows  AS "demo",
            your_rows  AS "yours",
            total_rows AS "total"
       FROM adminium_demo.status()
      ORDER BY table_name;`,
  );

  const demo = demoRowCount();
  const blocked = Number(
    scalar("SELECT count(*) FROM adminium_demo.seeded_rows WHERE blocked;"),
  );

  const s = (n) => (n === 1 ? "" : "s");
  if (demo === 0) {
    console.log("\nNo demo data loaded. `npm run demo:import` puts it in.");
  } else if (blocked === demo) {
    console.log(
      `\nThe demo data has been wiped, apart from ${demo} row${s(demo)} kept because your own\ndata still depends on ${demo === 1 ? "it" : "them"}. Clear that dependency and wipe again to finish.`,
    );
  } else {
    console.log(
      `\n${demo} demo row${s(demo)} loaded. \`npm run demo:wipe\` takes them out; your own rows stay.`,
    );
    if (blocked > 0) {
      console.log(
        `${blocked} of them survived an earlier wipe because your own data depends on them.`,
      );
    }
  }

  const history = psql(
    `SELECT label AS "import",
            to_char(imported_at, 'YYYY-MM-DD HH24:MI') AS "when",
            row_count AS "rows",
            coalesce(to_char(wiped_at, 'YYYY-MM-DD HH24:MI'), '—') AS "wiped"
       FROM adminium_demo.imports ORDER BY id;`,
    { quiet: true },
  );
  if (!/\(0 rows\)/.test(history)) process.stdout.write(`\nHistory:\n${history}`);
}

async function importDemo() {
  ensureToolkit();
  if (!existsSync(SEED_SQL)) fail(`missing ${SEED_SQL}`);

  if (demoRowCount() > 0) {
    fail(
      "Demo data is already loaded.\n\n  npm run demo:reset   replace it with a fresh copy\n  npm run demo:wipe    remove it and keep your own rows",
    );
  }

  const existing = appRowCount();
  if (existing > 0) {
    const ok = await confirm(
      `This database already holds ${existing} row${existing === 1 ? "" : "s"} that are not demo data.\nThe seed uses fixed ids, so it may collide with them. Import anyway?`,
    );
    if (!ok) {
      console.log("Nothing imported.");
      return;
    }
  }

  console.log(`Importing demo data into ${TARGET.describe} …`);
  psql("SELECT adminium_demo.begin_import();", { quiet: true });
  psql(readFileSync(SEED_SQL, "utf8"), { quiet: true });
  const count = scalar(
    `SELECT adminium_demo.finish_import(${quote(label)});`,
  );
  console.log(
    `✓ Imported ${count} demo rows. Remove them any time with \`npm run demo:wipe\`.`,
  );
}

async function wipe({ ask = true } = {}) {
  ensureToolkit();
  const demo = demoRowCount();
  if (demo === 0) {
    console.log("No demo data to remove — nothing is recorded as demo in this database.");
    console.log(
      "If this database was seeded before the demo toolkit existed, adopt those rows first:\n" +
        "  node db/demo.mjs adopt   (marks EVERY existing row as demo data)",
    );
    return;
  }

  if (ask) {
    const ok = await confirm(
      `Remove ${demo} demo row${demo === 1 ? "" : "s"} from ${TARGET.describe}?\nYour schema, and any rows you created yourself, stay.`,
    );
    if (!ok) {
      console.log("Nothing removed.");
      return;
    }
  }

  psql("SELECT * FROM adminium_demo.wipe();");

  const left = demoRowCount();
  console.log(
    left === 0
      ? "\n✓ Demo data removed. The schema is untouched — the app is ready for your own data."
      : `\n✓ Demo data removed, except ${left} row${left === 1 ? "" : "s"} your own data still references (the \`kept\` column above).\n  Delete or re-point those rows and run this again to clear the rest.`,
  );
}

async function reset() {
  ensureToolkit();
  const demo = demoRowCount();
  if (demo > 0) {
    const ok = await confirm(
      `Replace the ${demo} demo row${demo === 1 ? "" : "s"} in ${TARGET.describe} with a fresh copy?\nAny edits you made to demo rows are lost. Rows you created yourself stay.`,
    );
    if (!ok) {
      console.log("Nothing changed.");
      return;
    }
    await wipe({ ask: false });
    if (demoRowCount() > 0) {
      fail(
        "Some demo rows could not be removed (see `kept` above), so a fresh import\nwould collide with them. Clear what references them and try again.",
      );
    }
  }
  await importDemo();
}

async function adopt() {
  ensureToolkit();
  if (demoRowCount() > 0) {
    fail("Demo rows are already recorded — there is nothing to adopt.");
  }
  const rows = appRowCount();
  if (rows === 0) {
    console.log(
      "This database is empty, so there is nothing to adopt. `npm run demo:import`\nloads the demo data with the bookkeeping already in place.",
    );
    return;
  }
  const ok = await confirm(
    `Mark all ${rows} row${rows === 1 ? "" : "s"} currently in ${TARGET.describe} as demo data?\nOnly do this on a database that holds nothing but the seed — after this,\n\`demo:wipe\` will remove every one of them.`,
  );
  if (!ok) {
    console.log("Nothing adopted.");
    return;
  }
  const count = scalar(`SELECT adminium_demo.adopt(${quote(label)});`);
  console.log(`✓ ${count} rows are now recorded as demo data. \`npm run demo:wipe\` removes them.`);
}

function quote(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const COMMANDS = { status, import: importDemo, wipe, reset, adopt };

const handler = COMMANDS[command];
if (!handler) {
  console.log(USAGE);
  process.exit(command === "help" || command === "--help" ? 0 : 1);
}
await handler();
