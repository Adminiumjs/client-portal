/**
 * THE SAMPLE DATA, THE BROWSER'S LOADER AND THE MANIFEST AGREE — AND THE
 * SAMPLE IS A STUDIO THAT COULD EXIST.
 *
 * `seeds/clients.sample.json` is what an operator adds from Adminium, and
 * what the website's demo resolves in the browser. This puts it through the
 * checks Adminium runs when it is added (vendored with the rest of the
 * manifest checks), holds the loader's written part to manifest.json, and
 * then checks what a person's write would have been refused — because a
 * sample load writes rows as history, with no states, no stamps and no
 * producer, a row the product could never have made would otherwise ship:
 * a sent invoice with no lines, a payment on a draft, a void invoice with
 * money on it, an accepted proposal with a fingerprint the loader never
 * stamps, an email to a real domain, a word the release sweep refuses.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { withWrittenPart, type ManifestForSample } from "../../scripts/write-sample-columns.ts";
import { LOCALE_TAGS } from "../i18n/locales.ts";
import { PRO_PHRASES, SUBSTRING_BANNED, TIERING_PATTERNS } from "../testing/lexicon.ts";
import { sampleBundleIssues, sampleBundleSchema } from "../testing/manifest/sample.ts";
import type { Manifest } from "../testing/manifest/schema.ts";
import { COLUMNS, resolveSample, type ResolvedRow, type ResolvedSample, type SampleBundleRows } from "./sampleRows.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

interface Column {
  ref: string;
  type: string;
  role?: string;
  nullable?: boolean;
  enum?: string[];
  maxLength?: number;
  rules?: {
    sequence?: { gapless?: boolean };
    validation?: { format?: string; min?: number; max?: number };
    options?: { values: { value: string }[] };
    stamp?: unknown;
  };
}
const manifest = JSON.parse(read("../../manifest.json")) as {
  key: string;
  sampleData?: { file: string };
  requiredSchema: { tables: { ref: string; columns: Column[] }[] };
};
const bundle = JSON.parse(read("../../seeds/clients.sample.json")) as SampleBundleRows;
const rowsOf = (ref: string) => bundle.tables.find((t) => t.ref === ref)?.rows ?? [];
const shapeOf = (ref: string) => manifest.requiredSchema.tables.find((t) => t.ref === ref)!;

/** Tuesday 28 July 2026, 10:00 in the studio's zone — the moment the Overview's figures are drawn at. */
const ZONE = "America/New_York";
const DEMO_MOMENT = Date.parse("2026-07-28T14:00:00Z");
const resolved = (locale: string, now = DEMO_MOMENT): ResolvedSample => resolveSample(bundle, { now, zone: ZONE, locale, currency: "USD" });

/** Every `@t` of the bundle, with where it sits. */
function translations(): { at: string; texts: Record<string, string> }[] {
  const found: { at: string; texts: Record<string, string> }[] = [];
  const visit = (value: unknown, at: string) => {
    if (typeof value !== "object" || value === null) return;
    const record = value as Record<string, unknown>;
    if (record["@t"] !== undefined) {
      found.push({ at, texts: record["@t"] as Record<string, string> });
      return;
    }
    for (const [key, child] of Object.entries(record)) visit(child, `${at}.${key}`);
  };
  bundle.tables.forEach((table) => table.rows.forEach((row, i) => visit(row, `${table.ref}.${String(i)}`)));
  return found;
}

describe("the bundle is one Adminium will add", () => {
  it("passes the product’s own checks against this manifest", () => {
    const parsed = sampleBundleSchema.safeParse(bundle);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    if (!parsed.success) return;
    // The checks read the app's key and its tables, which is all of the manifest a bundle meets.
    expect(sampleBundleIssues(parsed.data, manifest as unknown as Manifest)).toEqual([]);
  });

  it.skipIf(manifest.sampleData === undefined)("is the file the manifest names", () => {
    expect(manifest.sampleData).toEqual({ file: "seeds/clients.sample.json" });
  });

  it("lists every table parents first, and nothing it does not declare", () => {
    const order = manifest.requiredSchema.tables.map((t) => t.ref);
    const refs = bundle.tables.map((t) => t.ref);
    expect(refs.every((ref) => order.includes(ref))).toBe(true);
    expect([...refs].sort((a, b) => order.indexOf(a) - order.indexOf(b))).toEqual(refs);
  });

  it("names everything a reader sees in all eight languages", () => {
    const all = translations();
    expect(all.length).toBeGreaterThan(250);
    for (const { at, texts } of all) {
      expect(Object.keys(texts).sort(), at).toEqual([...LOCALE_TAGS].sort());
      for (const tag of LOCALE_TAGS) expect(texts[tag]?.trim(), `${at} ${tag}`).toBeTruthy();
    }
  });

  it("gives every text column a text that fits it, in every language", () => {
    for (const { ref, rows } of bundle.tables) {
      const shape = shapeOf(ref);
      for (const row of rows) {
        for (const [column, value] of Object.entries(row)) {
          const max = shape.columns.find((c) => c.ref === column)?.maxLength;
          if (max === undefined) continue;
          const texts = typeof value === "string" ? [value] : typeof value === "object" && value !== null && "@t" in value ? Object.values((value as { "@t": Record<string, string> })["@t"]) : [];
          for (const text of texts) expect(text.length, `${ref}.${column}: ${text}`).toBeLessThanOrEqual(max);
        }
      }
    }
  });
});

describe("the in-browser loader knows the manifest's columns and rules", () => {
  it("holds the part `npm run sample` writes, as it would write it from manifest.json today", () => {
    const source = read("./sampleRows.ts");
    expect(withWrittenPart(source, manifest as unknown as ManifestForSample) === source).toBe(true);
  });

  it("fills every column the way the database does", () => {
    const expected = Object.fromEntries(
      manifest.requiredSchema.tables.map((t) => [
        t.ref,
        Object.fromEntries(
          t.columns
            .filter((c) => c.role !== "pk")
            .map((c) => {
              const fill = (c as { default?: unknown }).default;
              return [c.ref, fill === "now" ? "now" : fill !== undefined ? fill : c.nullable === true ? null : "required"];
            }),
        ),
      ]),
    );
    const actual = Object.fromEntries(
      Object.entries(COLUMNS).map(([table, columns]) => [
        table,
        Object.fromEntries(Object.entries(columns).map(([c, fill]) => [c, typeof fill === "symbol" ? fill.description : fill])),
      ]),
    );
    expect(actual).toEqual(expected);
  });
});

describe("every value passes the checks a person's write would meet", () => {
  const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  it.each(["en-US", "ar-EG", "zh-TW"])("resolved for %s", (locale) => {
    const rows = resolved(locale);
    const problems: string[] = [];
    for (const table of manifest.requiredSchema.tables) {
      for (const row of rows[table.ref] ?? []) {
        for (const column of table.columns) {
          const value = row[column.ref];
          const at = `${table.ref} ${String(row["id"])}.${column.ref} = ${JSON.stringify(value)}`;
          // A numbered column stays empty on a sample row, off the real series.
          if (column.rules?.sequence?.gapless === true) {
            if (value !== null) problems.push(`${at}: a sample row takes no running number`);
            continue;
          }
          if (value === null || value === undefined) {
            if (column.nullable !== true && column.role !== "pk") problems.push(`${at}: may not be empty`);
            continue;
          }
          const rules = column.rules ?? {};
          const text = String(value).trim();
          const v = rules.validation;
          if (v?.format === "email" && !EMAIL.test(text)) problems.push(`${at}: not an email`);
          if (v?.format === "url" && !URL.canParse(text)) problems.push(`${at}: not a link`);
          if (v?.min !== undefined && Number(value) < v.min) problems.push(`${at}: below ${String(v.min)}`);
          if (rules.options !== undefined && !rules.options.values.some((o) => o.value === String(value))) problems.push(`${at}: not an offered choice`);
          if (column.enum !== undefined && !column.enum.includes(String(value))) problems.push(`${at}: not one of ${column.enum.join(", ")}`);
          if (column.maxLength !== undefined && String(value).length > column.maxLength) problems.push(`${at}: longer than ${String(column.maxLength)}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe("nothing in the sample can reach a real person, or says what the release sweep refuses", () => {
  /** RFC 2606 / 6761, as Adminium's sender reads them: those addresses are never mailed. */
  const reserved = (address: string) => {
    const labels = address.toLowerCase().split("@").pop()!.split(".");
    return labels.includes("example") || ["test", "invalid", "localhost"].includes(labels[labels.length - 1]!);
  };

  it("puts every email address and link on a reserved domain, the studio on outline.example", () => {
    const found: string[] = [];
    const links: string[] = [];
    const visit = (value: unknown) => {
      if (typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) found.push(value);
      else if (typeof value === "string" && /^https?:\/\//.test(value)) links.push(value);
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(visit);
    };
    visit(bundle.tables);
    expect(found.length).toBeGreaterThan(80);
    expect(found.filter((address) => !reserved(address))).toEqual([]);
    expect(links.map((link) => new URL(link).hostname).filter((host) => !host.endsWith("outline.example"))).toEqual([]);
    const studio = rowsOf("settings")[0]!;
    expect([studio["reply_to"], studio["website"], ...rowsOf("people").map((p) => p["email"])]).toEqual([
      "hello@outline.example",
      "https://outline.example",
      "nadia@outline.example",
      "tomas@outline.example",
    ]);
  });

  it("queues nothing: every message was sent, skipped, or is held for a partner", () => {
    const statuses = new Set(rowsOf("messages").map((m) => m["status"]));
    expect([...statuses].sort()).toEqual(["held", "sent", "skipped"]);
  });

  it("uses no word or idea the release sweep bans, in any of the eight languages", () => {
    // References are data, not words: a number such as INV-S2037 is left out of the word check.
    const strip = (text: string) => text.replace(/\b(?:INV|QUO|REC|ENQ|PRJ)-S\d+\b/g, "");
    const texts = [
      ...translations().flatMap(({ at, texts: t }) => Object.entries(t).map(([tag, text]) => ({ at: `${at} ${tag}`, text }))),
      ...bundle.tables.flatMap((table) =>
        table.rows.flatMap((row, i) => Object.entries(row).filter(([, v]) => typeof v === "string").map(([column, v]) => ({ at: `${table.ref}.${String(i)}.${column}`, text: v as string }))),
      ),
    ];
    const hits: string[] = [];
    for (const { at, text } of texts) {
      const words = strip(text);
      for (const banned of SUBSTRING_BANNED) if (words.toLowerCase().includes(banned)) hits.push(`${at}: "${banned}" in ${text}`);
      for (const pattern of TIERING_PATTERNS) if (pattern.test(words)) hits.push(`${at}: ${String(pattern)} in ${text}`);
      for (const match of words.matchAll(/(?<![\p{L}\p{N}])pro(?![\p{L}\p{N}])/giu)) {
        const rest = words.slice(match.index);
        if (!PRO_PHRASES.some(({ phrase }) => rest.toLowerCase().startsWith(phrase.toLowerCase()))) hits.push(`${at}: "pro" in ${text}`);
      }
    }
    expect(texts.length).toBeGreaterThan(2000);
    expect(hits).toEqual([]);
  });
});

describe("numbers on the sample's own series", () => {
  it.each([
    ["invoices", "INV-S"],
    ["proposals", "QUO-S"],
    ["payments", "REC-S"],
    ["enquiries", "ENQ-S"],
    ["projects", "PRJ-S"],
  ])("%s: every row spells number_seq null and its own %s… number, each once", (table, prefix) => {
    const rows = rowsOf(table);
    for (const row of rows) {
      expect(row["number_seq"], String(row["number"])).toBeNull();
      expect(String(row["number"])).toMatch(new RegExp(`^${prefix}\\d+$`));
    }
    expect(new Set(rows.map((row) => row["number"])).size).toBe(rows.length);
  });

  it("numbers receipts in the order the payments came in, the part-paid invoice’s last", () => {
    const rows = resolved("en-US")["payments"]!;
    const byNumber = [...rows].sort((a, b) => String(a["number"]).localeCompare(String(b["number"])));
    expect(byNumber.map((p) => p["paid_on"])).toEqual([...byNumber.map((p) => String(p["paid_on"]))].sort());
    expect(byNumber.at(-1)).toMatchObject({ number: "REC-S0018", paid_on: "2026-07-26", amount: 1200 });
  });
});

// ── the studio could exist ──────────────────────────────────────────────────

describe.each([
  ["at the demo moment", DEMO_MOMENT],
  ["on 3 October", Date.parse("2026-10-03T12:00:00Z")],
  ["on the first of a month, early", Date.parse("2026-09-01T04:30:00Z")],
  ["at the turn of a year", Date.parse("2027-01-01T06:00:00Z")],
])("every row is one the product could have made, added %s", (_, now) => {
  const rows = resolved("en-US", now);
  const byId = (table: string, id: unknown) => rows[table]!.find((row) => row["id"] === id)!;
  const invoices = rows["invoices"]!;
  const linesOf = (table: string, id: unknown) => rows[table]!.filter((line) => line["document_id"] === id);

  it("sends only invoices with lines and a total, voids only unpaid ones, keeps drafts undated", () => {
    for (const invoice of invoices) {
      const name = String(invoice["number"]);
      if (invoice["status"] !== "draft") {
        expect(linesOf("invoice_lines", invoice["id"]).length, name).toBeGreaterThan(0);
        expect(Number(invoice["total"]), name).toBeGreaterThan(0);
        expect([invoice["issued_on"], invoice["due_on"], invoice["sent_at"]].every((v) => v !== null), name).toBe(true);
        expect(String(invoice["due_on"]) > String(invoice["issued_on"]), name).toBe(true);
      } else {
        expect([invoice["issued_on"], invoice["due_on"], invoice["sent_at"]], name).toEqual([null, null, null]);
      }
      if (invoice["status"] === "void") {
        expect(invoice["paid"], name).toBe(0);
        expect(invoice["voided_at"] !== null && invoice["void_reason"] !== null, name).toBe(true);
      }
      expect(Number(invoice["paid"]) <= Number(invoice["total"]), `${name} is overpaid`).toBe(true);
      expect(Number(invoice["balance"]), name).toBe(Math.round((Number(invoice["total"]) - Number(invoice["paid"])) * 100) / 100);
    }
  });

  it("takes payments only on sent invoices, on or after the day each was issued", () => {
    for (const payment of rows["payments"]!) {
      const invoice = byId("invoices", payment["document_id"]);
      expect(invoice["status"], String(payment["number"])).toBe("sent");
      expect(String(payment["paid_on"]) >= String(invoice["issued_on"]), String(payment["number"])).toBe(true);
    }
  });

  it("gives every sent invoice its three chase rungs, each after its due date", () => {
    for (const invoice of invoices.filter((i) => i["status"] !== "draft")) {
      const rungs = rows["messages"]!.filter((m) => m["invoice_id"] === invoice["id"] && String(m["kind"]).startsWith("invoice-rung-"));
      expect(rungs.map((m) => m["kind"]).sort(), String(invoice["number"])).toEqual(["invoice-rung-1", "invoice-rung-2", "invoice-rung-3"]);
      for (const rung of rungs) expect(String(rung["due"]).slice(0, 10) >= String(invoice["due_on"]), `${String(invoice["number"])} ${String(rung["kind"])}`).toBe(true);
      for (const rung of rungs.filter((m) => m["status"] === "skipped")) expect(rung["skip_reason"]).toBe(invoice["status"] === "void" ? "void" : "paid");
      if (Number(invoice["balance"]) > 0 && invoice["status"] === "sent") expect(rungs.every((m) => m["status"] !== "skipped")).toBe(true);
    }
    for (const message of rows["messages"]!) {
      if (message["status"] === "sent") expect(message["sent_at"], String(message["kind"])).not.toBeNull();
      else expect(message["sent_at"], String(message["kind"])).toBeNull();
    }
  });

  it("sends only proposals with lines and a total, and stamps no fingerprint on the accepted ones", () => {
    for (const proposal of rows["proposals"]!) {
      const name = String(proposal["number"]);
      expect(linesOf("proposal_lines", proposal["id"]).length, name).toBeGreaterThan(0);
      expect(proposal["fingerprint"], name).toBeNull();
      if (proposal["status"] === "draft") expect(proposal["sent_at"], name).toBeNull();
      else expect(Number(proposal["total"]) > 0 && proposal["sent_at"] !== null, name).toBe(true);
      if (["accepted", "declined", "withdrawn"].includes(String(proposal["status"]))) expect(String(proposal["decided_at"]) >= String(proposal["sent_at"]), name).toBe(true);
      if (proposal["signed_name"] !== null) {
        expect(proposal["signed_email"], name).toBe(byId("clients", proposal["client_id"])["email"]);
        expect(proposal["accepted_how"], name).toBe("portal");
      }
    }
  });

  it("dates every stage invoice on or after its proposal was accepted, and every project’s start after its proposal", () => {
    const studioDay = (instant: unknown) => new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(String(instant)));
    for (const invoice of invoices.filter((i) => i["from_quote_id"] !== null)) {
      const proposal = byId("proposals", invoice["from_quote_id"]);
      expect(proposal["status"], String(invoice["number"])).toBe("accepted");
      expect(String(invoice["issued_on"]) >= studioDay(proposal["decided_at"]), String(invoice["number"])).toBe(true);
    }
    for (const project of rows["projects"]!) {
      expect(String(project["started_on"]) >= studioDay(byId("proposals", project["proposal_id"])["decided_at"]), String(project["number"])).toBe(true);
    }
  });

  it("gives every status the dates and notes it implies", () => {
    for (const project of rows["projects"]!) {
      expect(project["pause_note"] !== null, String(project["number"])).toBe(project["status"] === "paused");
      expect(project["done_on"] !== null && project["handover_sent_at"] !== null, String(project["number"])).toBe(project["status"] === "done");
    }
    for (const d of rows["deliverables"]!) {
      expect(d["shared_at"] !== null, String(d["title"])).toBe(d["status"] !== "unshared");
      expect(d["reviewed_at"] !== null, String(d["title"])).toBe(d["status"] === "approved" || d["status"] === "changes");
      expect(d["approved_on"] !== null && d["approved_by"] !== null, String(d["title"])).toBe(d["status"] === "approved");
    }
    for (const m of rows["milestones"]!) expect(m["done_at"] !== null, String(m["title"])).toBe(m["state"] === "done");
    for (const b of rows["briefs"]!) expect(b["sent_at"] !== null).toBe(b["status"] === "sent");
  });

  it("dates nothing that has happened after the moment it is added", () => {
    const PAST = ["created_at", "at", "received_at", "sent_at", "decided_at", "signed_at", "new_price_asked_at", "started_on", "done_on", "handover_sent_at", "done_at", "shared_at", "reviewed_at", "approved_on", "posted_at", "issued_on", "voided_at", "client_paid_at", "client_paid_on", "paid_on", "recorded_at", "in_force_from"];
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(now));
    const late: string[] = [];
    for (const [table, list] of Object.entries(rows)) {
      for (const row of list as ResolvedRow[]) {
        for (const column of PAST) {
          const value = row[column];
          if (value === undefined || value === null) continue;
          const text = String(value);
          if (text.length === 10 ? text > today : Date.parse(text) > now) late.push(`${table} ${String(row["id"])}.${column} = ${text}`);
        }
      }
    }
    expect(late).toEqual([]);
  });
});

describe("what the sample holds", () => {
  const rows = resolved("en-US");
  const count = (table: string, where: (row: ResolvedRow) => boolean = () => true) => rows[table]!.filter(where).length;

  it("has the studio, its two partners, its rate card, terms v1–v3 with eight clauses in force, and six brief questions", () => {
    expect([count("settings"), count("people"), count("rates"), count("brief_questions")]).toEqual([1, 2, 4, 6]);
    expect(rows["terms_versions"]!.map((v) => v["status"])).toEqual(["retired", "retired", "in_force"]);
    const inForce = rows["terms_versions"]!.find((v) => v["status"] === "in_force")!;
    const clauses = rows["terms_clauses"]!.filter((c) => c["version_id"] === inForce["id"]);
    expect(clauses).toHaveLength(8);
    // The clause the chase ladder leans on is the sixth.
    expect(clauses.find((c) => c["position"] === 6)!["title"]).toBe("If an invoice goes unpaid");
  });

  it("has six clients and five enquiries — three new, one of them spam", () => {
    expect(rows["clients"]!.map((c) => c["company"])).toEqual(["Hearth & Loaf", "Ferngrove Coffee", "Marigold Lane", "Slow Signal", "Northlight Records", "Fold & Rule"]);
    expect(rows["enquiries"]!.map((e) => e["status"])).toEqual(["new", "new", "new", "parked", "declined"]);
    expect(rows["enquiries"]!.filter((e) => e["fit"] === "no").map((e) => e["business"])).toEqual(["Growth Partners LLC"]);
  });

  it("has proposals in every state, the design’s signed history, and a revision", () => {
    expect(new Set(rows["proposals"]!.map((p) => p["status"]))).toEqual(new Set(["draft", "sent", "accepted", "declined", "withdrawn"]));
    const signed = rows["proposals"]!.filter((p) => p["signed_name"] !== null).map((p) => [p["number"], p["signed_name"], p["signed_at"]]);
    expect(signed).toContainEqual(["QUO-S1138", "Amara Okafor", "2026-04-24T13:41:00.000Z"]);
    // Accepted by email before the portal: agreed, never signed.
    expect(rows["proposals"]!.find((p) => p["number"] === "QUO-S1141")).toMatchObject({ status: "accepted", accepted_how: "email", signed_name: null });
    const revised = rows["proposals"]!.find((p) => p["number"] === "QUO-S1142")!;
    expect(rows["proposals"]!.find((p) => p["id"] === revised["revision_of"])).toMatchObject({ number: "QUO-S1140", status: "withdrawn" });
  });

  it("has four projects — active, active, paused under the unpaid-invoice clause, done with a handover", () => {
    expect(rows["projects"]!.map((p) => [p["number"], p["status"]])).toEqual([
      ["PRJ-S01", "active"],
      ["PRJ-S02", "active"],
      ["PRJ-S03", "paused"],
      ["PRJ-S04", "done"],
    ]);
    const done = rows["projects"]![3]!;
    expect(count("project_fonts", (f) => f["project_id"] === done["id"])).toBe(2);
    expect(count("handover_files", (f) => f["project_id"] === done["id"])).toBe(5);
    expect(done["handover_sent"]).toBe(true);
  });

  it("seeds pins on the client’s review of the deliverable sent back for changes", () => {
    const review = rows["deliverables"]!.find((d) => d["status"] === "changes")!;
    // Pins are percentages of the artwork (0–100 across and down), which the review screen reads as percent.
    const pins = rows["deliverable_notes"]!.filter((n) => n["deliverable_id"] === review["id"] && n["pin_x"] !== null && n["pin_y"] !== null);
    for (const pin of pins) expect(Number(pin["pin_x"]) >= 0 && Number(pin["pin_x"]) <= 100 && Number(pin["pin_y"]) >= 0 && Number(pin["pin_y"]) <= 100).toBe(true);
    expect(pins.map((n) => [n["side"], n["pin_x"], n["pin_y"]])).toEqual([
      ["client", 41, 44],
      ["client", 63, 57],
    ]);
  });

  it("fills the stage columns of the stage invoices, behind accepted proposals", () => {
    const stage = (number: string) => {
      const invoice = rows["invoices"]!.find((i) => i["number"] === number)!;
      const proposal = rows["proposals"]!.find((p) => p["id"] === invoice["from_quote_id"]);
      // Taxed once, at its proposal's rate, on its share of the proposal's subtotal.
      expect(invoice["tax_rate"], number).toBe(proposal?.["tax_rate"]);
      expect(invoice["subtotal"], number).toBe(Math.round(Number(proposal?.["subtotal"]) * Number(invoice["share_pct"])) / 100);
      return [proposal?.["number"], proposal?.["split"], invoice["share_pct"], invoice["stage"], invoice["total"]];
    };
    expect(stage("INV-S2036")).toEqual(["QUO-S1138", "5050", 50, "1/2", 2821]);
    expect(stage("INV-S2039")).toEqual(["QUO-S1138", "5050", 50, "2/2", 2821]);
    expect(stage("INV-S2037")).toEqual(["QUO-S1141", "5050", 50, "1/2", 1627.5]);
    // Fold & Rule's proposal, accepted at 40 / 30 / 30, is behind INV-S2038.
    expect(stage("INV-S2038")).toEqual(["QUO-S1139", "403030", 40, "1/3", 2170]);
    expect(rows["proposals"]!.find((p) => p["number"] === "QUO-S1139")).toMatchObject({ status: "accepted", client_id: 6, total: 5425 });
  });

  it("makes INV-S2040 a one-off for the shopfront survey, not a stage of the proposal still out", () => {
    expect(rows["invoices"]!.find((i) => i["number"] === "INV-S2040")).toMatchObject({ title: "Shopfront survey & measure-up", from_quote_id: null, proposal_id: null, project_id: null, total: 1519 });
  });

  it("has one void invoice, one voided payment, one draft", () => {
    expect(rows["invoices"]!.filter((i) => i["status"] === "void").map((i) => i["number"])).toEqual(["INV-S2027"]);
    expect(rows["payments"]!.filter((p) => p["voided"] === true).map((p) => p["number"])).toEqual(["REC-S0013"]);
    expect(rows["invoices"]!.filter((i) => i["status"] === "draft").map((i) => i["number"])).toEqual(["INV-S2041"]);
  });
});
