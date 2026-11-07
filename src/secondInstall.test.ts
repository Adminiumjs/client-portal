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
 * of that key. And the email test send reads THIS install's template: a later
 * install's are stored under keys of their own (`clients-kiln-invoice-sent`),
 * which the templates route takes as they are.
 */
import { describe, expect, it, vi } from "vitest";

import { sessionDeskReads } from "./data/adminiumSource.ts";
import { createSessionTransport, INSTALL_HEADER } from "./data/sessionSource.ts";
import { addOnRowFor, installTemplateKey, sessionSink, type AddOnListRow } from "./data/sink.ts";
import { realTables } from "./data/tableOfRef.ts";
import { configBase, loadStaffConfig, slugOfBase } from "./staffConnection.ts";

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
    const template = /^\/api\/v1\/email-templates\/([^/]+)\/([^/]+)$/.exec(path);
    const payload =
      DOCS[path] ??
      (template !== null
        ? { id: `t-${decodeURIComponent(template[1]!)}`, name: decodeURIComponent(template[1]!), document: { subject: "Hello", blocks: [] } }
        : undefined) ??
      (path.endsWith("/test-send") ? { queued: 1 } : undefined) ??
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

async function deskAt(pathname: string, docs: Record<string, unknown> = {}) {
  const { sent, fetchImpl } = server();
  Object.assign(DOCS, docs);
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
  const sink = sessionSink(transport, tables, { csrfToken: () => staff.csrfToken, installId: staff.installId, installSlug: staff.installSlug, fetchImpl });
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

describe("the email test send of a second install", () => {
  it("reads this install's own template, and sends the test with it", async () => {
    const first = await deskAt("/apps/clients/staff/emails");
    const second = await deskAt("/apps/clients/kiln/staff/emails");
    expect([first.staff.installSlug, second.staff.installSlug]).toEqual(["", "kiln"]);
    expect((await first.sink.emailTemplate!("clients-invoice-sent", "en_US"))?.id).toBe("t-clients-invoice-sent");
    const before = second.sent.length;
    const template = await second.sink.emailTemplate!("clients-invoice-sent", "en_US");
    expect(template?.id).toBe("t-clients-kiln-invoice-sent");
    await second.sink.testEmail!(template!.id, ["hello@kiln.example"], { subject: "Hello", preheader: "", blocks: [], footer: "" });
    const calls = second.sent.slice(before);
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/email-templates/clients-kiln-invoice-sent/en_US", "/api/v1/email-templates/t-clients-kiln-invoice-sent/test-send"]);
    for (const call of calls) expect(call.headers[INSTALL_HEADER]).toBe("install-2");
  });

  it("keeps Adminium's own sign-in email, which is one per server", async () => {
    const second = await deskAt("/apps/clients/kiln/staff/emails");
    expect((await second.sink.emailTemplate!("sign-in-link", "en_US"))?.id).toBe("t-sign-in-link");
  });

  it("takes the slug the server names over the mount's", async () => {
    const mapped = await deskAt("/", { "/surface-config.json": { connectionId: "conn-2", installId: "install-2", slug: "kiln", csrfToken: "tok-2", timezone: "Europe/Lisbon" } });
    expect(mapped.staff.installSlug).toBe("kiln");
    expect((await mapped.sink.emailTemplate!("clients-declined", "ar_EG"))?.id).toBe("t-clients-kiln-declined");
  });

  it("reads the plain key on a mapped domain whose server names no slug (it serves every install at /)", async () => {
    const mapped = await deskAt("/", { "/surface-config.json": { connectionId: "conn-2", installId: "install-2", csrfToken: "tok-2", timezone: "Europe/Lisbon" } });
    expect(mapped.staff.installSlug).toBeNull();
    expect((await mapped.sink.emailTemplate!("clients-declined", "en_US"))?.id).toBe("t-clients-declined");
  });
});

describe("installTemplateKey", () => {
  it("is the engine's rule: the key for the plain install, <app>-<slug>-<rest> for a later one, cut to 80", () => {
    expect(installTemplateKey("clients-invoice-sent", "clients", "")).toBe("clients-invoice-sent");
    expect(installTemplateKey("clients-invoice-sent", "clients", null)).toBe("clients-invoice-sent");
    expect(installTemplateKey("clients-invoice-sent", "clients", "kiln")).toBe("clients-kiln-invoice-sent");
    expect(installTemplateKey("sign-in-link", "clients", "kiln")).toBe("sign-in-link");
    const long = installTemplateKey("clients-asked-for-a-new-price", "clients", "x".repeat(60));
    expect(long).toHaveLength(80);
    expect(long.startsWith(`clients-${"x".repeat(60)}-`)).toBe(true);
  });

  it("reads the slug off the mount", () => {
    expect([slugOfBase("/apps/clients/staff/"), slugOfBase("/apps/clients/kiln/staff/"), slugOfBase("/")]).toEqual(["", "kiln", null]);
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
