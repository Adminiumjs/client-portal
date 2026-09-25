/**
 * The manifest's promises the app's screens stand on: a client's statement
 * is a declared document over the client (and the client may ask for it), a
 * studio's approval keeps its own day while a client's is stamped today, a
 * handover item may be a link, and the third reminder reads right for an
 * invoice with no project.
 */
import { describe, expect, it } from "vitest";

import { buildManifest } from "./build.ts";
import { EMAIL_EN } from "./emails.ts";
import { EMAIL_TRANSLATIONS } from "./email-words.ts";

type Json = Record<string, unknown>;
const manifest = buildManifest() as Json & { requiredSchema: { tables: (Json & { ref: string; columns: (Json & { ref: string })[] })[] }; documents: Json[]; publicAccess: Json[] };
const column = (t: string, c: string) => manifest.requiredSchema.tables.find((x) => x.ref === t)!.columns.find((x) => x.ref === c);

describe("what the app's screens stand on", () => {
  it("declares a client's statement over the client, their sent invoices and unvoided payments", () => {
    expect(manifest.documents).toContainEqual(
      expect.objectContaining({ kind: "statement", addOn: "invoices", table: "clients", statement: expect.objectContaining({ documents: expect.objectContaining({ table: "invoices", where: { column: "status", in: ["sent"] } }), payments: expect.objectContaining({ table: "payments", unless: "voided" }) }) }),
    );
    const identity = manifest.publicAccess.find((e) => e["table"] === "clients" && e["claim"] !== undefined)!;
    expect(identity["documents"]).toEqual(["statement"]);
    expect(identity["select"]).toContain("id");
  });

  it("makes each quote, invoice and receipt out to the client its row points at", () => {
    for (const [kind, table] of [["quote", "proposals"], ["invoice", "invoices"], ["receipt", "payments"]] as const) {
      const entry = manifest.documents.find((d) => d["kind"] === kind && d["table"] === table)!;
      expect(entry["addOn"]).toBe("invoices");
      expect(entry["mapping"]).toEqual({
        customerName: { via: "client_id", column: "company" },
        customerContact: { via: "client_id", column: "contact_name" },
        customerEmail: { via: "client_id", column: "email" },
        customerLines: { via: "client_id", column: "address" },
        customerTaxNumber: { via: "client_id", column: "tax_number" },
      });
      expect(column(table, "client_id")).toMatchObject({ type: "fk", references: "clients" });
    }
    // The client asks for each on its own table; a statement is over the client, not an invoice.
    const granted = (table: string) => manifest.publicAccess.filter((e) => e["table"] === table).flatMap((e) => (e["documents"] as string[] | undefined) ?? []);
    expect(granted("proposals")).toEqual(["quote"]);
    expect(granted("invoices")).toEqual(["invoice"]);
    expect(granted("payments")).toEqual(["receipt"]);
  });

  it("stamps a deliverable's approval day for the clients' side only", () => {
    expect(column("deliverables", "approved_on")?.["rules"]).toEqual({ stamp: { set: { byOrigin: { public: "today" } }, on: { column: "status", values: ["approved"] } } });
  });

  it("lets a handover item be a link, and shows it on the shared page", () => {
    expect(column("handover_files", "link")).toMatchObject({ type: "text", maxLength: 500, nullable: true });
    const shared = manifest.publicAccess.find((e) => e["table"] === "handover_files")!;
    expect(shared["select"]).toContain("link");
  });

  it("words the third reminder without naming a project, in every language", () => {
    for (const words of [EMAIL_EN, ...Object.values(EMAIL_TRANSLATIONS)]) {
      const rung = words["invoice-rung-3"];
      expect(`${rung.subject} ${rung.paras.join(" ")}`).not.toContain("{{project.");
    }
  });
});
