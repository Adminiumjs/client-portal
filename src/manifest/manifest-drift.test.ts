/**
 * `manifest.json` is written from `src/manifest/` (`npm run manifest`), and
 * this is what keeps the two from drifting: an edit to a module that was not
 * written out, or a hand edit to the file, fails here with the fix named.
 *
 * It also holds the manifest's own promises that the product's validator
 * cannot see: every label in all eight languages, every email in all eight,
 * the tables built on the add-on's shapes agreeing with them, and the rules a
 * studio depends on present on the tables they guard.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import SHAPES from "./vendored/invoices-shapes.json" with { type: "json" };
import { shapeConformanceIssues, shapeKey, type ShapeDefinitionView } from "../testing/manifest/index.ts";
import { buildManifest, manifestText } from "./build.ts";
import { LOCALES } from "./labels.ts";

const FILE = join(__dirname, "..", "..", "manifest.json");

type Json = Record<string, unknown>;
const manifest = buildManifest() as Json & { requiredSchema: { tables: (Json & { ref: string; columns: (Json & { ref: string })[] })[] } };
const table = (ref: string) => manifest.requiredSchema.tables.find((t) => t.ref === ref)!;
const column = (t: string, c: string) => table(t).columns.find((col) => col.ref === c)!;
const rules = (t: string, c: string) => column(t, c)["rules"] as Json;

describe("manifest.json is what src/manifest/ writes", () => {
  it("is byte for byte the modules' output — run `npm run manifest` after changing them", () => {
    expect(readFileSync(FILE, "utf8") === manifestText()).toBe(true);
  });
});

describe("the tables built on Invoices & Receipts are what its shapes say", () => {
  it("passes the conformance check Adminium runs at install, against the vendored shapes", () => {
    const shapes = new Map(
      (SHAPES as { shapes: ShapeDefinitionView[] }).shapes.map((shape) => [shapeKey((SHAPES as { addOn: string }).addOn, shape), shape]),
    );
    expect(shapeConformanceIssues(manifest as never, shapes)).toEqual([]);
  });

  it("requires the add-on the five tables are built on", () => {
    const needs = manifest["addOns"] as { requires: { key: string }[] };
    expect(needs.requires.map((need) => need.key)).toEqual(["invoices"]);
    for (const ref of ["proposals", "proposal_lines", "invoices", "invoice_lines", "payments"]) {
      expect(table(ref)["builtOn"], ref).toMatch(/^invoices\/(invoice|quote)@1$/);
    }
  });
});

describe("every word a person reads is in all eight languages", () => {
  it("labels every table, column and choice in each language", () => {
    const labels: unknown[] = [];
    const walk = (value: unknown, key: string): void => {
      if (Array.isArray(value)) value.forEach((v) => walk(v, key));
      else if (value !== null && typeof value === "object") {
        const record = value as Json;
        if (["label", "labelPlural", "reason"].includes(key) || (key === "labels" && "en-US" in record)) labels.push(record);
        for (const [k, v] of Object.entries(record)) walk(v, k);
      }
    };
    walk(manifest.requiredSchema, "");
    walk(manifest["navGroups"], "");
    walk(manifest["addOns"], "");
    expect(labels.length).toBeGreaterThan(300);
    for (const label of labels) expect(Object.keys(label as Json).sort()).toEqual([...LOCALES].sort());
  });

  it("titles every page in each language", () => {
    for (const page of manifest["pages"] as { ref: string; titles: Json }[]) {
      expect(Object.keys(page.titles).sort(), page.ref).toEqual(LOCALES.filter((tag) => tag !== "en-US").sort());
    }
  });

  it("ships every email in each language, with the English email's variables and no others", () => {
    const vars = (value: unknown): string[] => [...JSON.stringify(value).matchAll(/\{\{([A-Za-z_.]+)\}\}/g)].map((m) => m[1]!).sort();
    const templates = manifest["emailTemplates"] as { key: string; locales: Record<string, unknown> }[];
    expect(templates).toHaveLength(20);
    for (const template of templates) {
      expect(Object.keys(template.locales).sort(), template.key).toEqual([...LOCALES].sort());
      const english = vars(template.locales["en-US"]);
      for (const tag of LOCALES) expect(vars(template.locales[tag]), `${template.key} ${tag}`).toEqual(english);
    }
  });

  it("asks of each column only a form Adminium fills for its type", () => {
    // Adminium's email guide: a time also reads as `.date`, `.time`, `.day_month` and `.relative_day`; a date
    // (already written as its day) as `.day_month` and `.days_since`. A form nothing fills stops the email at
    // send — the invoice, its receipt, a reminder — marked failed, and the client is sent nothing.
    const FORMS: Record<string, string[]> = { timestamptz: ["date", "time", "day_month", "relative_day"], date: ["day_month", "days_since"] };
    const links = new Map(table("messages").columns.filter((c) => c["type"] === "fk").map((c) => [c.ref.replace(/_id$/, ""), String(c["references"])]));
    const wrong: string[] = [];
    for (const template of manifest["emailTemplates"] as { key: string; locales: Record<string, unknown> }[]) {
      for (const [, link, name, form] of JSON.stringify(template.locales).matchAll(/\{\{([a-z_]+)\.([a-z_]+)\.([a-z_]+)\}\}/g)) {
        const target = links.get(link!);
        const type = target === undefined ? undefined : String(column(target, name!)?.["type"]);
        if (type === undefined || !(FORMS[type] ?? []).includes(form!)) wrong.push(`${template.key}: {{${link!}.${name!}.${form!}}} on a ${type ?? "missing"} column`);
      }
    }
    expect([...new Set(wrong)]).toEqual([]);
  });
});

describe("the rules a studio depends on are declared on the tables they guard", () => {
  it("numbers enquiries, projects, terms and versions without gaps, with their prefixes", () => {
    expect(rules("enquiries", "number")["format"]).toMatchObject({ from: "number_seq", prefix: "ENQ-" });
    expect(rules("projects", "number")["format"]).toMatchObject({ from: "number_seq", prefix: "PRJ-" });
    expect(rules("deliverable_versions", "v")["sequence"]).toEqual({ gapless: true, scope: "deliverable_id" });
  });

  it("stores a client's address the way they sign in with it", () => {
    expect(rules("clients", "email")).toMatchObject({ normalize: "email" });
    expect(column("clients", "email")).toMatchObject({ unique: true });
  });

  it("fingerprints what a client accepts: the proposal, its lines and the terms it names", () => {
    const stamp = rules("proposals", "fingerprint")["stamp"] as { set: { hashOf: Json } };
    expect(stamp.set.hashOf).toMatchObject({
      children: [{ table: "proposal_lines" }],
      linked: [{ table: "terms_versions", children: [{ table: "terms_clauses" }] }],
    });
  });

  it("clears the client's \"I've sent a payment\" when the studio records one", () => {
    const states = table("invoices")["states"] as { children: Record<string, { clearOnCreate?: string[] }> };
    expect(states.children["payments"]!.clearOnCreate).toEqual(
      expect.arrayContaining(["client_paid", "client_paid_at", "client_paid_on", "client_paid_amount", "client_paid_note"]),
    );
  });

  it("lets only a manager reopen a finished project", () => {
    expect((table("projects")["states"] as { moves: Json })["moves"]).toMatchObject({ done: [{ to: "active", roles: ["studio-manager"] }] });
  });

  it("gives every multi-step create a per-action key, so a retry finds what the first try saved", () => {
    for (const ref of ["clients", "proposals", "proposal_lines", "projects", "milestones", "invoices", "invoice_lines", "payments", "deliverables", "deliverable_versions", "deliverable_notes", "project_fonts", "handover_files", "messages"]) {
      expect(column(ref, "client_key"), ref).toMatchObject({ unique: true, nullable: true });
    }
  });
});
