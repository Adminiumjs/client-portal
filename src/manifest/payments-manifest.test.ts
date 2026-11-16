/**
 * Paying online, in the manifest: the invoices on the invoice shape's second
 * version, the one payable entry the shape needs, who may refund, what a
 * client reads of a payment and never writes, and the pay button in the
 * emails about an invoice still owed — sent only with a live pay link.
 */
import { describe, expect, it } from "vitest";

import { validateManifest } from "../testing/manifest/index.ts";
import { buildManifest, CUSTOMER_ROUTES, MIN_ADMINIUM, PAYMENTS } from "./build.ts";
import { LOCALES } from "./labels.ts";

type Json = Record<string, unknown>;
type Table = Json & { ref: string; builtOn?: string; columns: (Json & { ref: string })[] };
type Block = { block: string; id: string; data: Json };
const manifest = buildManifest() as Json & {
  compatibility: { minAdminiumVersion: string };
  requiredSchema: { tables: Table[] };
  publicAccess: (Json & { table: string; methods: string[]; select?: string[]; writable?: string[] })[];
  outbox: { producers: Json[] };
  roles: { key: string; permissions: string[]; limits?: Record<string, { writable?: string[] }> }[];
  payments: { payables: Json[] };
  addOns: { requires: { key: string; range: string }[] };
  emailTemplates: { key: string; vars: string[]; locales: Record<string, { blocks: Block[] }> }[];
};
const table = (ref: string) => manifest.requiredSchema.tables.find((t) => t.ref === ref)!;
const column = (t: string, c: string) => table(t).columns.find((x) => x.ref === c);
/** What only an online payment carries: Adminium writes it, nobody else. */
const ONLINE_ONLY = ["payment_ref", "provider", "refunded_amount", "net_amount"];

describe("the invoices take payments online", () => {
  it("are built on the invoice shape's second version, with what an online payment fills", () => {
    for (const ref of ["invoices", "invoice_lines", "payments"]) expect(table(ref).builtOn, ref).toBe("invoices/invoice@2");
    expect(column("payments", "payment_ref")).toMatchObject({ type: "text", maxLength: 64, unique: true });
    expect(column("payments", "provider")).toMatchObject({ type: "text" });
    expect(column("payments", "refunded_amount")).toMatchObject({ type: "decimal", default: 0 });
    expect(column("payments", "method")).toMatchObject({ enum: ["bank-transfer", "card", "cheque", "cash", "other", "online"] });
    // An invoice's paid sums what is left of each payment after its refunds.
    expect(column("invoices", "paid")).toMatchObject({ rules: { rollup: { sum: "net_amount" } } });
    // The add-on that has that version, and the Adminium that reads the payable.
    expect(manifest.addOns.requires.find((r) => r.key === "invoices")?.range).toBe(">=1.0.13");
    expect(manifest.compatibility.minAdminiumVersion).toBe(MIN_ADMINIUM);
    expect(MIN_ADMINIUM).toBe("0.3.60");
  });

  it("name the invoices once, as the shape maps them: where a client comes back, and that the receipt is the app's own", () => {
    expect(manifest.payments).toEqual(PAYMENTS);
    expect(manifest.payments.payables).toEqual([{ table: "invoices", shape: true, returnTo: "/invoices", receipt: "app" }]);
    // The way back is one of the clients' own pages, never carrying a token.
    expect(Object.values(CUSTOMER_ROUTES)).toContain("/invoices");
    // The app's receipt goes on every recorded payment, the ones made online included.
    expect(manifest.outbox.producers).toContainEqual({ kind: "payment-receipt", link: "payment_id", onCreate: { table: "payments" } });
  });

  it("is a manifest the validator takes", () => {
    const result = validateManifest(manifest);
    expect(result.ok, JSON.stringify((result as { issues?: unknown }).issues ?? null)).toBe(true);
  });
});

describe("who may do what with a payment made online", () => {
  const role = (key: string) => manifest.roles.find((r) => r.key === key)!;

  it("a studio manager may give it back; the studio may not", () => {
    expect(role("studio-manager").permissions).toContain("payments:@:refund");
    expect(role("studio").permissions).not.toContain("payments:@:refund");
  });

  it("the studio's own writes leave out what only an online payment carries", () => {
    const writable = role("studio").limits?.["payments"]?.writable ?? [];
    expect(writable).toContain("amount");
    expect(writable).toContain("method");
    for (const ref of ONLINE_ONLY) expect(writable, ref).not.toContain(ref);
  });

  it("a client reads that a payment was made online and what was refunded, never its reference, and writes none of it", () => {
    const reads = manifest.publicAccess.filter((e) => e.table === "payments");
    expect(reads).toHaveLength(1);
    expect(reads[0]!.methods).toEqual(["GET"]);
    expect(reads[0]!.select).toEqual(expect.arrayContaining(["provider", "refunded_amount"]));
    for (const ref of ["payment_ref", "approval_code", "card_last4"]) expect(reads[0]!.select, ref).not.toContain(ref);
    for (const entry of manifest.publicAccess) for (const ref of [...ONLINE_ONLY, "approval_code", "card_last4"]) expect(entry.writable ?? [], `${entry.table} ${ref}`).not.toContain(ref);
  });
});

describe("the pay button in the emails", () => {
  const PAYABLE = ["clients-invoice-sent", "clients-invoice-rung-1", "clients-invoice-rung-2", "clients-invoice-rung-3"];

  it("the invoice and its three reminders carry it, in every language, sent only with a live pay link", () => {
    for (const key of PAYABLE) {
      const template = manifest.emailTemplates.find((t) => t.key === key)!;
      expect(template.vars, key).toContain("pay_url");
      for (const tag of LOCALES) {
        const blocks = template.locales[tag]!.blocks;
        const pay = blocks.find((b) => b.id === "pay");
        const note = blocks.find((b) => b.id === "pay-note");
        expect(pay, `${key} ${tag}`).toMatchObject({ block: "email.button", data: { url: "{{pay_url}}", onlyWith: "pay_url" } });
        expect(String(pay!.data["label"]), `${key} ${tag}`).toContain("{{invoice.balance}}");
        expect(note, `${key} ${tag}`).toMatchObject({ block: "email.text", data: { onlyWith: "pay_url" } });
        // Above How to pay and the button to the portal: the way to pay is first.
        const at = (id: string) => blocks.findIndex((b) => b.id === id);
        expect(at("pay"), `${key} ${tag}`).toBeLessThan(at("open"));
        if (at("how-to-pay") !== -1) expect(at("pay"), `${key} ${tag}`).toBeLessThan(at("how-to-pay"));
      }
    }
  });

  it("no other email carries it", () => {
    for (const template of manifest.emailTemplates.filter((t) => !PAYABLE.includes(t.key))) {
      expect(template.vars, template.key).not.toContain("pay_url");
      for (const tag of LOCALES) expect(JSON.stringify(template.locales[tag]), `${template.key} ${tag}`).not.toContain("pay_url");
    }
  });

  it("the English says where they will pay, by the services' plain names", () => {
    const sent = manifest.emailTemplates.find((t) => t.key === "clients-invoice-sent")!.locales["en-US"]!.blocks;
    expect(sent.find((b) => b.id === "pay")!.data["label"]).toBe("Pay {{invoice.balance}} online");
    expect(sent.find((b) => b.id === "pay-note")!.data["paras"]).toEqual(["You’ll pay on the Stripe or PayPal page."]);
  });
});
