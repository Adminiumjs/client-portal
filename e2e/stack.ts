/**
 * One engine's Adminium for the browser pass: the contract's own harness
 * (`src/contract/harness.ts`) boots the BUILT Adminium with its clock at 10:00
 * on Tuesday 28 July 2026, installs the Invoices & Receipts add-on and this
 * app — with the surfaces `npm run build:surface` made, so the browser opens
 * the real pages — and adds the sample, as an operator does over HTTP.
 *
 * Nothing here reaches into the server's modules, and no password is ever
 * typed into a page: the staff session is the API's cookie, handed to the
 * browser.
 */
import { normaliseAll } from "../src/data/rows.ts";
import { setServerZone } from "../src/data/venueTime.ts";
import type { Id, TableRef } from "../src/data/types.ts";
import { DEMO_START, DEMO_ZONE } from "../src/lib/clock.ts";
import { DEMO_CURRENCY, DEMO_SETTINGS } from "../src/demo/sample.ts";
import { addOnBundle, appBundle, boot, Caller, ok, until, type Engine, type Server } from "../src/contract/harness.ts";

export type Row = Record<string, unknown> & { id: Id };

export const ADMIN = { email: process.env["E2E_ADMIN_EMAIL"] ?? "e2e@adminium.local", password: process.env["E2E_ADMIN_PASSWORD"] ?? "adminium-e2e-password" };

export interface Stack {
  engine: Engine;
  /** The Postgres/MySQL database the run owns (SQLite: a file by the port). */
  database: string;
  server: Server;
  staff: Caller;
  connectionId: string;
  /** The app's tables by the manifest's names → their real names. */
  real: Record<string, string>;
  /** The app's tables by the manifest's names → the data API's table ids. */
  tableIds: Record<string, string>;
  /** The data API's address for one of the app's tables. */
  data(ref: string): string;
  /** Every row of one of the app's tables, as the portal reads it. */
  rows(ref: TableRef | string): Promise<Row[]>;
  /** The sink's messages. */
  mail(): Promise<{ to: string[]; subject: string; text: string; html?: string }[]>;
}

/** Boot, install the add-on and the app (built surfaces), set the studio up as the demo's, and add the sample. */
export async function stackUp(engine: Engine, port: number): Promise<Stack> {
  // `CONTRACT_DB_SUFFIX` keeps two checkouts' runs on one Postgres or MySQL apart, as the contract's.
  const database = `cp_t57_e2e_${engine}${process.env["CONTRACT_DB_SUFFIX"] ?? ""}`;
  const server = await boot(engine, port, DEMO_START, { database });
  try {
    const staff = new Caller(server.base, { origin: server.base });
    await staff.signIn(ADMIN.email, ADMIN.password);
    const connections = ok(await staff.get<{ connections: { id: string; name: string }[] }>("/api/v1/connections"));
    const connectionId = connections.connections.find((c) => c.name === "northwind")!.id;

    const addOn = addOnBundle();
    ok(await staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(addOn.integrity)}`, addOn.buffer));
    const app = appBundle({ built: true });
    const staged = await staff.post(`/api/v1/apps/upload?expectedSha512=${encodeURIComponent(app.integrity)}`, app.buffer);
    if (staged.status !== 200 && staged.status !== 201) throw new Error(`app upload: ${String(staged.status)} ${JSON.stringify(staged.body).slice(0, 800)}`);
    const body = { key: app.key, version: app.version, connectionId };
    const plan = ok(await staff.post<{ plan: { installable: boolean; checksum: string } }>("/api/v1/apps/plan", body)).plan;
    if (!plan.installable) throw new Error(`the app is not installable: ${JSON.stringify(plan).slice(0, 1500)}`);
    const installed = ok(await staff.post<{ schema: { created: string[] } }>("/api/v1/apps/install", { ...body, planChecksum: plan.checksum }));
    const created = installed.schema.created;
    const prefix = created.find((name) => name.endsWith("deliverable_versions"))!.slice(0, -"deliverable_versions".length);
    const real = Object.fromEntries(created.map((name) => [name.slice(prefix.length), name]));
    const schema = ok(await staff.get<{ model: { tables: { id: string; name: string }[] } }>(`/api/v1/connections/${connectionId}/schema`));
    const tableIds = Object.fromEntries(Object.entries(real).map(([ref, name]) => [ref, schema.model.tables.find((t) => t.name === name)!.id]));

    ok(await staff.patch(`/api/v1/connections/${connectionId}`, { timezone: DEMO_ZONE, currency: DEMO_CURRENCY }));
    const values = Object.fromEntries(Object.entries(DEMO_SETTINGS).map(([name, value]) => [name.slice("invoices.".length), value]));
    ok(await staff.put("/api/v1/add-ons/invoices/settings", { values }));
    const surface = ok(await staff.get<{ serverTimezone: string | null }>("/apps/clients/staff/surface-config.json"));
    setServerZone(surface.serverTimezone);

    ok(await staff.post("/api/v1/apps/clients/sample-data"));
    await until(async () => (ok(await staff.get<{ loaded: boolean }>("/api/v1/apps/clients/sample-data")).loaded ? true : undefined), "the sample to be added");

    // The clients' side: the public API on, and sign-in links pointing at this server.
    ok(await staff.put("/api/v1/public-api", { enabled: true }));
    ok(await staff.put("/api/v1/settings/email", { publicOrigin: server.base }));

    const data = (ref: string) => `/api/v1/data/${connectionId}/${encodeURIComponent(tableIds[ref]!)}`;
    const rows = async (ref: string): Promise<Row[]> => {
      const out: Row[] = [];
      for (let offset = 0; ; offset += 200) {
        const page = ok(await staff.get<{ data: Row[] }>(`${data(ref)}?limit=200&offset=${String(offset)}`)).data;
        out.push(...(normaliseAll(ref as TableRef, page) as unknown as Row[]));
        if (page.length < 200) return out;
      }
    };
    const mail = async () => (await (await fetch(`${server.sink}/messages`)).json()) as { to: string[]; subject: string; text: string; html?: string }[];
    return { engine, database, server, staff, connectionId, real, tableIds, data, rows, mail };
  } catch (error) {
    const log = server.log().slice(-3000);
    await server.stop();
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n--- server log ---\n${log}`);
  }
}
