/**
 * One value read straight from the studio's own database — the one place the
 * browser pass reaches past HTTP, and only because Adminium itself hands the
 * value to nobody: a handover's share code is hidden from every staff read,
 * and the handover email goes out with its placeholder unfilled (see the lane
 * report). The visitor's side of the handover is still checked in the
 * browser, with the code the database holds.
 *
 * The drivers are the Adminium checkout's own (its e2e app installs all
 * three), so this repo adds none.
 */
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ADMINIUM_REPO, type Engine } from "../src/contract/harness.ts";

/** Asked for when used, so listing the tests needs no Adminium checkout. */
const need = (name: string): unknown => createRequire(join(ADMINIUM_REPO, "apps", "e2e", "package.json"))(name);

/** `SELECT <column> FROM <table> WHERE id = <id>` on the engine's source database. */
export async function readColumn(engine: Engine, port: number, database: string, table: string, column: string, id: number): Promise<unknown> {
  if (!/^[a-z_]+$/.test(table) || !/^[a-z_]+$/.test(column)) throw new Error("a plain table and column name only");
  if (engine === "sqlite") {
    const Database = need("better-sqlite3") as new (file: string, options: { readonly: boolean }) => { prepare(sql: string): { get(...args: unknown[]): Record<string, unknown> | undefined }; close(): void };
    const db = new Database(join(tmpdir(), `adminium-e2e-source-sqlite-${String(port)}.db`), { readonly: true });
    try {
      return db.prepare(`SELECT ${column} AS v FROM ${table} WHERE id = ?`).get(id)?.["v"];
    } finally {
      db.close();
    }
  }
  if (engine === "postgres") {
    const pg = need("pg") as { Client: new (options: { connectionString: string }) => { connect(): Promise<void>; query(sql: string, args: unknown[]): Promise<{ rows: Record<string, unknown>[] }>; end(): Promise<void> } };
    const url = new URL(process.env["TEST_POSTGRES_URL"] ?? "");
    url.pathname = `/${database}`;
    const client = new pg.Client({ connectionString: url.toString() });
    await client.connect();
    try {
      return (await client.query(`SELECT ${column} AS v FROM ${table} WHERE id = $1`, [id])).rows[0]?.["v"];
    } finally {
      await client.end();
    }
  }
  const mysql = need("mysql2/promise") as { createConnection(uri: string): Promise<{ query(sql: string, args: unknown[]): Promise<[Record<string, unknown>[]]>; end(): Promise<void> }> };
  const url = new URL(process.env["TEST_MYSQL_URL"] ?? "");
  url.pathname = `/${database}`;
  const connection = await mysql.createConnection(url.toString());
  try {
    return (await connection.query(`SELECT ${column} AS v FROM ${table} WHERE id = ?`, [id]))[0][0]?.["v"];
  } finally {
    await connection.end();
  }
}
