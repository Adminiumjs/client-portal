/**
 * The back office in the manifest: the rules the Time, Expenses, Suppliers,
 * Schedule, Capacity, Money and scoping screens stand on, the enquiry form
 * anyone may send, the notice the studio hears it by, and Holiday calendars
 * offered for Capacity. The back office's record pages are declared and not
 * installed yet — and they validate the day they are switched on.
 */
import { describe, expect, it } from "vitest";

import { workOut, type Formula } from "../data/sampleRows.ts";
import { evaluateFormula, type FormulaExpr } from "../testing/manifest/formula.ts";
import { validateManifest } from "../testing/manifest/index.ts";
import { buildManifest } from "./build.ts";
import { EMAIL_EN } from "./emails.ts";
import { EMAIL_TRANSLATIONS } from "./email-words.ts";
import { LOCALES } from "./labels.ts";
import { LATER_PAGES, PAGE_REFS } from "./pages.ts";

type Json = Record<string, unknown>;
type Table = Json & { ref: string; columns: (Json & { ref: string; rules?: Json })[] };
const manifest = buildManifest() as Json & {
  requiredSchema: { tables: Table[] };
  publicAccess: Json[];
  outbox: { producers: Json[] };
  roles: { key: string; permissions: string[] }[];
  pages: { ref: string }[];
  addOns: Json;
  emailTemplates: { key: string; locales: Json }[];
};
const table = (ref: string) => manifest.requiredSchema.tables.find((t) => t.ref === ref)!;
const column = (t: string, c: string) => table(t).columns.find((x) => x.ref === c)!;

describe("the back office's tables", () => {
  it("numbers purchases EX- and suppliers SUP- without gaps, as every numbered table", () => {
    for (const [t, prefix, pad] of [["expenses", "EX-", 3], ["suppliers", "SUP-", 2]] as const) {
      expect(column(t, "number_seq")["rules"]).toEqual({ sequence: { gapless: true } });
      expect(column(t, "number")).toMatchObject({ unique: true, rules: { format: { from: "number_seq", prefix, pad } } });
    }
  });

  it("keeps hours to two places, above zero and at most sixteen — typed ones and Adminium's own — on a day that has happened", () => {
    const hours = column("time_entries", "hours");
    expect(hours).toMatchObject({ type: "decimal", scale: 2, nullable: true, rules: { validation: { min: 0.01, max: 16 } } });
    // Adminium's figure: nothing a writer sends is kept.
    expect(Object.keys(hours["rules"]!).sort()).toEqual(["formula", "validation"]);
    expect(column("time_entries", "logged_hours")).toMatchObject({ type: "decimal", scale: 2, nullable: true, rules: { validation: { min: 0.01, max: 16 } } });
    expect(column("time_entries", "date")["rules"]).toEqual({ notAfter: "today" });
    expect(column("expenses", "date")["rules"]).toEqual({ notAfter: "today" });
  });

  it("allows one running clock per person, stamped by Adminium when it starts and when it stops", () => {
    expect(column("time_entries", "running_for")).toMatchObject({ type: "fk", references: "people", unique: true, nullable: true });
    expect(column("time_entries", "started_at")["rules"]).toEqual({ stamp: { set: "now", on: { column: "running_for", filled: true } } });
    expect(column("time_entries", "clock_stopped")).toMatchObject({ type: "bool", default: false });
    expect(column("time_entries", "stopped_at")).toMatchObject({ type: "timestamptz", nullable: true, rules: { stamp: { set: "now", on: { column: "clock_stopped", values: [true] } } } });
  });

  it("counts a clock's hours from its two stamps to the nearest quarter hour, a quarter at least — the typed hours first — as Adminium does", () => {
    const formula = column("time_entries", "hours")["rules"]!["formula"];
    const at = (minutes: number) => new Date(Date.UTC(2026, 6, 28, 13, 0) + minutes * 60_000).toISOString();
    const row = (minutes: number | null, logged: string | null = null) => ({ started_at: at(0), stopped_at: minutes === null ? null : at(minutes), logged_hours: logged });
    const cases: [ReturnType<typeof row>, string | null][] = [
      // 09:00 → 10:37: an hour and 37 minutes is an hour and a half.
      [row(97), "1.50"],
      [row(2), "0.25"],
      [row(0), "0.25"],
      // Half a quarter goes up.
      [row(22.5), "0.50"],
      [row(22.49), "0.25"],
      [row(8 * 60 + 7), "8.00"],
      [row(17 * 60), "17.00"],
      // A person's own hours are the hours, however long the clock ran.
      [row(17 * 60, "7.00"), "7.00"],
      [row(null, "2.50"), "2.50"],
      // Still running, or a stop before its start: no hours at all.
      [row(null), null],
      [row(-5), null],
    ];
    for (const [values, expected] of cases) {
      expect(evaluateFormula(formula as FormulaExpr, values, 2), JSON.stringify(values)).toBe(expected);
      // The demo's and the sample's own reckoning agrees with Adminium's.
      const own = workOut(formula as Formula, values, 2);
      expect(own === null ? null : own.toFixed(2), JSON.stringify(values)).toBe(expected);
    }
  });

  it("makes the invoice line the one record of what it carries: unique, so nothing is invoiced twice", () => {
    expect(column("invoice_lines", "time_entry_id")).toMatchObject({ type: "fk", references: "time_entries", unique: true, nullable: true });
    expect(column("invoice_lines", "expense_id")).toMatchObject({ type: "fk", references: "expenses", unique: true, nullable: true });
    // And nowhere else: an entry or a purchase does not also point at its line.
    expect(table("time_entries").columns.map((c) => c.ref)).not.toContain("invoice_line_id");
    expect(table("expenses").columns.map((c) => c.ref)).not.toContain("invoice_line_id");
  });

  it("copies a purchase's and an entry's client from the project, a receipt being a private file", () => {
    expect(column("expenses", "client_id")["rules"]).toEqual({ copy: { via: "project_id", from: "client_id", mode: "always" } });
    expect(column("time_entries", "client_id")["rules"]).toEqual({ copy: { via: "project_id", from: "client_id", mode: "always" } });
    expect(column("expenses", "receipt")).toMatchObject({ type: "text", nullable: true });
    expect(manifest.publicAccess.some((e) => ["expenses", "time_entries", "suppliers", "running_costs", "events"].includes(String(e["table"])))).toBe(false);
  });

  it("keeps a studio date's last day on or after its first, and asks nothing of Adminium it cannot do", () => {
    expect(column("events", "to_date")["rules"]).toEqual({ notBefore: { column: "date" } });
    expect(column("events", "kind")["enum"]).toEqual(["call", "press", "away"]);
    // Who is away is the desk's to ask (no engine rule asks a column only for one kind).
    expect(column("events", "person_id")).toMatchObject({ type: "fk", references: "people", nullable: true });
  });

  it("lists each table before the tables that point at it", () => {
    const refs = manifest.requiredSchema.tables.map((t) => t.ref);
    for (const t of manifest.requiredSchema.tables) {
      for (const c of t.columns) {
        const target = c["references"];
        if (typeof target !== "string" || target === t.ref) continue;
        // `enquiries.proposal_id` is the one link that points forward (a proposal is started from an enquiry).
        if (t.ref === "enquiries") continue;
        expect(refs.indexOf(target), `${t.ref}.${c.ref} → ${target}`).toBeLessThan(refs.indexOf(t.ref));
      }
    }
  });
});

describe("who may do what in the back office", () => {
  const role = (key: string) => manifest.roles.find((r) => r.key === key)!.permissions;
  it("lets the studio log time, buy things, keep suppliers and dates — and change no running cost, delete nothing", () => {
    for (const t of ["time_entries", "expenses", "suppliers", "events"]) {
      expect(role("studio")).toEqual(expect.arrayContaining([`table:@${t}:read`, `table:@${t}:create`, `table:@${t}:update`]));
      expect(role("studio")).not.toContain(`table:@${t}:delete`);
    }
    expect(role("studio")).toContain("table:@running_costs:read");
    expect(role("studio")).not.toContain("table:@running_costs:update");
    for (const t of ["time_entries", "expenses", "suppliers", "events", "running_costs"]) expect(role("studio-manager")).toContain(`table:@${t}:delete`);
  });
});

describe("the enquiry form", () => {
  const form = manifest.publicAccess.filter((e) => e["table"] === "enquiries");

  it("is one create anyone may make, behind the human check and the limits on such a create", () => {
    expect(form).toHaveLength(1);
    expect(form[0]).toEqual({
      table: "enquiries",
      methods: ["POST"],
      select: ["received_at"],
      writable: ["name", "email", "business", "trade", "budget", "start_when", "body"],
      requires: ["name", "email", "body"],
      defaults: { status: "new", source: "web" },
      humanCheck: true,
      anonymous: { perValue: { columns: ["email"], n: 3 }, perKeyHour: 30, plainText: ["name"] },
    });
  });

  it("writes none of what the studio decides: status, fit, source, the number, the client, when it came", () => {
    const writable = form[0]!["writable"] as string[];
    for (const decided of ["status", "fit", "source", "number", "number_seq", "client_id", "proposal_id", "received_at", "parked_until"]) expect(writable).not.toContain(decided);
    expect(column("enquiries", "received_at")["rules"]).toEqual({ stamp: { set: "now", on: "create" } });
  });

  it("tells the studio, behind its switch, only about enquiries from the web", () => {
    const notice = manifest.outbox.producers.find((p) => p["kind"] === "new-enquiry")!;
    expect(notice).toEqual({
      kind: "new-enquiry",
      link: "enquiry_id",
      recipient: { setting: { table: "settings", column: "reply_to" } },
      gate: { setting: { table: "settings", column: "notify_enquiry" } },
      onCreate: { table: "enquiries", where: { column: "source", eq: "web" } },
    });
    expect(column("messages", "kind")["enum"]).toContain("new-enquiry");
    const template = manifest.emailTemplates.find((t) => t.key === "clients-new-enquiry")!;
    expect(Object.keys(template.locales).sort()).toEqual([...LOCALES].sort());
    for (const words of [EMAIL_EN, ...Object.values(EMAIL_TRANSLATIONS)]) expect(JSON.stringify(words["new-enquiry"])).toContain("{{enquiry.body}}");
  });
});

describe("Holiday calendars", () => {
  it("is offered, not required and not ticked, for the public holidays in Capacity", () => {
    expect(manifest.addOns["suggests"]).toEqual([{ key: "holiday-calendars", range: ">=1.0.3", reason: expect.objectContaining({ "en-US": "Leave public holidays out of the working days Capacity counts." }) }]);
    expect(Object.keys((manifest.addOns["suggests"] as { reason: Json }[])[0]!.reason).sort()).toEqual([...LOCALES].sort());
    expect(manifest.addOns["features"]).toEqual([{ id: "capacity-holidays", label: expect.objectContaining({ "en-US": "Public holidays in Capacity" }), requires: ["holiday-calendars"] }]);
  });
});

describe("the back office's pages", () => {
  it("installs and grants each one whose screen has shipped", () => {
    for (const ref of ["clients-time", "clients-expenses", "clients-suppliers", "clients-studio-dates", "clients-running-costs"]) {
      expect(manifest.pages.map((p) => p.ref)).toContain(ref);
      expect(PAGE_REFS).toContain(ref);
    }
  });

  it("installs none still declared for later, and grants none", () => {
    const refs = LATER_PAGES.map((p) => p.ref);
    expect(refs).toEqual([]);
    for (const ref of refs) {
      expect(manifest.pages.map((p) => p.ref)).not.toContain(ref);
      expect(PAGE_REFS).not.toContain(ref);
    }
  });

  it("validates with every one of them switched on", () => {
    const withLater = buildManifest({ laterPages: true });
    const result = validateManifest(withLater);
    expect(result.ok ? [] : result.issues).toEqual([]);
    expect((withLater["pages"] as unknown[]).length).toBe(manifest.pages.length + LATER_PAGES.length);
  });
});
