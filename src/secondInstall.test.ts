/**
 * A SECOND INSTALL OF THE PORTAL'S DESK: the same bundle, served at another
 * database's mount, must say it is that install on every call.
 *
 * Adminium installs one app once per database. Each install's staff side is
 * served at its own mount (`/apps/clients/<slug>/staff/`) with its own
 * `surface-config.json`, naming its `installId`. The desk reads that document
 * from the mount it was opened at and sends the id back as
 * `X-Adminium-Install` — through the transport and through the sink's own
 * calls (a file's bytes, an add-on's settings) — so the server draws the
 * document and saves Invoices & Receipts' values for THIS studio. From the
 * add-ons' list it reads the copy attached to this install, never the first
 * of that key.
 */
import { describe, expect, it, vi } from "vitest";

import { sessionDeskReads } from "./data/adminiumSource.ts";
import { createSessionTransport, INSTALL_HEADER } from "./data/sessionSource.ts";
import { addOnRowFor, sessionSink, type AddOnListRow } from "./data/sink.ts";
import { realTables } from "./data/tableOfRef.ts";
import { configBase, loadStaffConfig } from "./staffConnection.ts";

const BAKED = "/apps/clients/staff/";

/** Two installs' documents, each at its own mount. */
const DOCS: Record<string, unknown> = {
  "/apps/clients/staff/surface-config.json": { connectionId: "conn-1", installId: "install-1", csrfToken: "tok-1", timezone: "Europe/London" },
  "/apps/clients/kiln/staff/surface-config.json": { connectionId: "conn-2", installId: "install-2", csrfToken: "tok-2", timezone: "Europe/Lisbon" },
};

/** Invoices & Receipts installed on both databases: two rows of one key, each attached to its own install of the app. */
const ADD_ONS: AddOnListRow[] = [
  {
    key: "invoices",
    installId: "inv-1",
    settings: [{ key: "business_name" }],
    settingValues: { business_name: "First studio" },
    attachments: [{ attachedTo: "clients", enabled: true, installId: "inv-1", hostInstall: "install-1" }],
  },
  {
    key: "invoices",
    installId: "inv-2",
    settings: [{ key: "business_name" }],
    settingValues: { business_name: "Kiln studio" },
    attachments: [{ attachedTo: "clients", enabled: true, installId: "inv-2", hostInstall: "install-2" }],
  },
];

interface Sent {
  url: string;
  headers: Record<string, string>;
}

function server() {
  const sent: Sent[] = [];
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    sent.push({ url, headers: (init?.headers ?? {}) as Record<string, string> });
    const path = url.split("?")[0] ?? url;
    const payload =
      DOCS[path] ??
      (path === "/api/v1/add-ons"
        ? { addOns: ADD_ONS }
        : path.endsWith("/documents/render")
          ? { printUrl: "/api/v1/documents/d1/print", contentUrl: "/api/v1/documents/d1/content" }
          : path.endsWith("/settings")
            ? { values: { business_name: "Kiln studio" } }
            : path === "/api/v1/files"
              ? { ref: "file-1" }
              : { data: [] });
    return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
  });
  return { sent, fetchImpl: fetchImpl as unknown as typeof fetch };
}

async function deskAt(pathname: string) {
  const { sent, fetchImpl } = server();
  const staff = await loadStaffConfig({ hostedStaff: true, base: configBase(BAKED, pathname), fetchImpl });
  if (staff === null) throw new Error("no staff config");
  const tables = realTables(staff.tables);
  // Built the way `main.tsx` builds the desk's transport and sink.
  const transport = createSessionTransport({
    tableOfRef: tables,
    ...(staff.connectionId === null ? {} : { connectionId: staff.connectionId }),
    installId: staff.installId,
    ...(staff.csrfToken === null ? {} : { staff: { csrfToken: staff.csrfToken, timezone: staff.timezone } }),
    fetchImpl,
  });
  await transport.port.config();
  const sink = sessionSink(transport, tables, { csrfToken: () => staff.csrfToken, installId: staff.installId, fetchImpl });
  return { staff, transport, sink, reads: sessionDeskReads(transport), sent };
}

describe("a second install of the desk", () => {
  it("reads its own install from its own mount", async () => {
    const first = await deskAt("/apps/clients/staff/home");
    const second = await deskAt("/apps/clients/kiln/staff/home");
    expect([first.staff.installId, first.staff.connectionId]).toEqual(["install-1", "conn-1"]);
    expect([second.staff.installId, second.staff.connectionId]).toEqual(["install-2", "conn-2"]);
  });

  it("says which install it is on the document render, a file's bytes, the add-ons' list and an add-on's values", async () => {
    const { reads, sink, sent } = await deskAt("/apps/clients/kiln/staff/invoices");
    const before = sent.length;
    await reads.documentUrl!("invoice", "invoices", 7, "en_US");
    await sink.upload("deliverable_versions", "file", new Blob(["x"], { type: "text/plain" }), "x.txt");
    await sink.addOnSettings!("invoices");
    await sink.saveAddOnSettings("invoices", { business_name: "Kiln studio" });
    const calls = sent.slice(before);
    expect(calls.map((c) => c.url.split("?")[0])).toEqual([
      "/api/v1/apps/clients/documents/render",
      "/api/v1/files",
      "/api/v1/add-ons",
      "/api/v1/add-ons/invoices/settings",
    ]);
    for (const call of calls) expect(call.headers[INSTALL_HEADER]).toBe("install-2");
  });

  it("reads the add-on copy attached to this install, not the first of its key", async () => {
    const first = await deskAt("/apps/clients/staff/settings");
    const second = await deskAt("/apps/clients/kiln/staff/settings");
    expect((await first.sink.addOnSettings!("invoices"))?.values).toEqual({ business_name: "First studio" });
    expect((await second.sink.addOnSettings!("invoices"))?.values).toEqual({ business_name: "Kiln studio" });
  });
});

describe("addOnRowFor", () => {
  const OLD: AddOnListRow[] = [{ key: "invoices", settingValues: { a: 1 }, attachments: [{ attachedTo: "clients", enabled: true }] }];

  it("picks by the key alone from an Adminium that sends no install fields", () => {
    expect(addOnRowFor(OLD, "invoices", "install-2")).toBe(OLD[0]);
    expect(addOnRowFor(OLD, "invoices", null)).toBe(OLD[0]);
  });

  it("picks the first of the key when the desk knows no install of its own", () => {
    expect(addOnRowFor(ADD_ONS, "invoices", null)?.installId).toBe("inv-1");
  });

  it("takes the one copy of a key whatever it is attached to (a copy kept once per server)", () => {
    const one: AddOnListRow[] = [{ key: "invoices", installId: "inv-s", attachments: [{ attachedTo: "clients", enabled: true, installId: "inv-s", hostInstall: "install-1" }] }];
    expect(addOnRowFor(one, "invoices", "install-2")).toBe(one[0]);
  });

  it("reads no other database's copy when none is attached to this install", () => {
    expect(addOnRowFor(ADD_ONS, "invoices", "install-3")).toBeUndefined();
    expect(addOnRowFor(ADD_ONS, "offers", "install-2")).toBeUndefined();
  });
});
