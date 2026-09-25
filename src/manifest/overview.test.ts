/**
 * THE OVERVIEW'S CARDS ASK FOR THE FIGURES THE SAMPLE HOLDS.
 *
 * `sample-figures.test.ts` works out, by hand, every figure the Overview
 * should show when the sample is added on Tuesday 28 July 2026. This file
 * asks the other half: do the Overview's OWN card queries — the ones
 * Adminium will run — come to those figures? Each card's query is evaluated
 * here over the resolved sample rows, the way Adminium's widget queries work:
 *
 *   - filters compare as SQL does (a missing value matches nothing);
 *   - a calendar window counts whole days, weeks (Monday on) and months on
 *     the studio's clock, moved back `offset` periods; one that reaches ahead
 *     runs from the start of today on, with no end; a window with no
 *     calendar ends at this moment;
 *   - a date is its own day, a time the day it falls on in the studio's zone;
 *   - a sum of nothing is nothing (drawn as 0), a count of nothing is 0;
 *   - a month's bar is the month of the date; a list keeps its order and its
 *     first `limit` rows, and a looked-up column reads through the link.
 *
 * Then, where the product is checked out beside this app (the same rule as
 * `manifest-pages.test.ts`), the layout is put through the product's own
 * schemas — the dashboard layout, every card's settings, every query — and
 * every card's link through the product's own reading of a link's
 * narrowing, which must use every piece and leave none out.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { describe, expect, it } from "vitest";

import manifest from "../../manifest.json";
import { resolveSample, type ResolvedRow, type ResolvedSample, type SampleBundleRows } from "../data/sampleRows.ts";
import { OVERVIEW_LAYOUT } from "./overview.ts";

const ZONE = "America/New_York";
const bundle = JSON.parse(readFileSync(fileURLToPath(new URL("../../seeds/clients.sample.json", import.meta.url)), "utf8")) as SampleBundleRows;

type Json = Record<string, unknown>;
interface Item {
  i: string;
  widget: string;
  x: number;
  y: number;
  w: number;
  h: number;
  config: Json & { href?: string; viewAllHref?: string; binding?: Descriptor };
}
interface Filter {
  column: string;
  op: string;
  value?: unknown;
}
interface Window {
  column: string;
  last: number;
  unit: "day" | "week" | "month";
  calendar?: boolean;
  offset?: number;
  ahead?: boolean;
}
interface Descriptor {
  source: { name: string };
  shape: string;
  select?: string[];
  lookups?: string[];
  aggregations?: { fn: string; column?: string; alias: string }[];
  filters?: Filter[];
  window?: Window;
  bucket?: { column: string; unit: string };
  orderBy?: { column: string; dir: "asc" | "desc" }[];
  limit?: number;
}

const ITEMS = (OVERVIEW_LAYOUT as { items: Item[] }).items;
const item = (id: string): Item => {
  const found = ITEMS.find((candidate) => candidate.i === id);
  if (found === undefined) throw new Error(`no card "${id}"`);
  return found;
};

// ── the columns' kinds, from the manifest ───────────────────────────────────

const TABLES = manifest.requiredSchema.tables as { ref: string; columns: { ref: string; type: string; references?: string }[] }[];
const typeOf = (table: string, column: string): string => {
  const found = TABLES.find((t) => t.ref === table)?.columns.find((c) => c.ref === column);
  if (found === undefined) throw new Error(`${table} has no column "${column}"`);
  return found.type;
};

// ── the studio's calendar ───────────────────────────────────────────────────

const DAY = 86_400_000;
const money = (n: number) => Math.round(n * 100) / 100;
/** A date, or the day an instant falls on in the studio's zone. */
const studioDay = (value: unknown) =>
  String(value).length === 10 ? String(value) : new Intl.DateTimeFormat("en-CA", { timeZone: ZONE }).format(new Date(String(value)));
const shiftDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const shiftMonths = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const shift = (day: string, unit: Window["unit"], n: number) => (unit === "month" ? shiftMonths(day, n) : shiftDays(day, unit === "week" ? n * 7 : n));
/** The first day of the period `day` is in. */
function periodStart(day: string, unit: Window["unit"]): string {
  if (unit === "day") return day;
  if (unit === "month") return `${day.slice(0, 7)}-01`;
  return shiftDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}

// ── one query, over the rows ────────────────────────────────────────────────

function matches(row: ResolvedRow, filter: Filter): boolean {
  const value = row[filter.column];
  if (filter.op === "is_null") return value === null || value === undefined;
  if (filter.op === "not_null") return value !== null && value !== undefined;
  if (value === null || value === undefined) return false;
  const same = (a: unknown, b: unknown) => (typeof b === "number" ? Number(a) === b : a === b);
  switch (filter.op) {
    case "eq":
      return same(value, filter.value);
    case "neq":
      return !same(value, filter.value);
    case "gt":
      return Number(value) > Number(filter.value);
    case "in":
      return (filter.value as unknown[]).some((v) => same(value, v));
    default:
      throw new Error(`the evaluator does not read "${filter.op}"`);
  }
}

/** A calendar window's first day and the day after its last (null: no end), on the studio's calendar. */
function calendarDays(window: Window, now: number): { start: string; end: string | null } {
  const current = periodStart(studioDay(new Date(now).toISOString()), window.unit);
  if (window.ahead === true) return { start: current, end: null };
  const offset = window.offset ?? 0;
  return { start: shift(current, window.unit, -(offset + window.last - 1)), end: shift(current, window.unit, 1 - offset) };
}

function inWindow(table: string, row: ResolvedRow, window: Window, now: number): boolean {
  const value = row[window.column];
  if (value === null || value === undefined) return false;
  const type = typeOf(table, window.column);
  if (window.ahead === true || window.calendar === true) {
    const { start, end } = calendarDays(window, now);
    const day = studioDay(value);
    return day >= start && (end === null || day < end);
  }
  // A window with no calendar ends at this moment (instants only here).
  if (type === "date") throw new Error("the Overview uses no rolling window over a date");
  const at = Date.parse(String(value));
  const span = window.unit === "month" ? 31 * window.last * DAY : window.last * (window.unit === "week" ? 7 : 1) * DAY;
  return at >= now - span && at < now;
}

function rowsOf(rows: ResolvedSample, query: Descriptor, now: number): ResolvedRow[] {
  const table = query.source.name;
  return (rows[table] ?? []).filter(
    (row) => (query.filters ?? []).every((filter) => matches(row, filter)) && (query.window === undefined || inWindow(table, row, query.window, now)),
  );
}

function aggregate(rows: ResolvedRow[], aggregation: { fn: string; column?: string }): number {
  if (aggregation.fn === "count") return rows.length;
  if (aggregation.fn === "sum") return money(rows.reduce((total, row) => total + Number(row[aggregation.column!]), 0));
  throw new Error(`the evaluator does not read "${aggregation.fn}"`);
}

/** A card's figure, its bars, or its rows. */
function evaluate(rows: ResolvedSample, query: Descriptor, now: number): unknown {
  const found = rowsOf(rows, query, now);
  const aggregation = query.aggregations?.[0];
  if (query.shape === "metric+delta") return aggregate(found, aggregation!);
  if (query.shape === "timeseries") {
    const byMonth = new Map<string, ResolvedRow[]>();
    for (const row of found) {
      const month = studioDay(row[query.bucket!.column]).slice(0, 7);
      byMonth.set(month, [...(byMonth.get(month) ?? []), row]);
    }
    return [...byMonth].sort(([a], [b]) => a.localeCompare(b)).map(([month, group]) => [month, aggregate(group, aggregation!)]);
  }
  if (query.shape === "record-list") {
    const order = query.orderBy ?? [];
    const sorted = [...found].sort((a, b) => {
      for (const { column, dir } of order) {
        const [x, y] = [String(a[column]), String(b[column])];
        if (x !== y) return (x < y ? -1 : 1) * (dir === "asc" ? 1 : -1);
      }
      return 0;
    });
    return sorted.slice(0, query.limit ?? 50).map((row) => {
      const out: Json = Object.fromEntries((query.select ?? []).map((column) => [column, row[column]]));
      for (const lookup of query.lookups ?? []) {
        const [alias, path] = lookup.split(":") as [string, string];
        const [fk, target] = path.split(".") as [string, string];
        const table = TABLES.find((t) => t.ref === query.source.name)!.columns.find((c) => c.ref === fk)!.references!;
        out[alias] = rows[table]!.find((r) => r["id"] === row[fk])?.[target] ?? null;
      }
      return out;
    });
  }
  throw new Error(`the evaluator does not read shape "${query.shape}"`);
}

/** Every card's answer, by id — over the sample, and any rows a test adds to it. */
function cards(now: number, extra: Record<string, ResolvedRow[]> = {}): Record<string, unknown> {
  const rows = resolveSample(bundle, { now, zone: ZONE, locale: "en-US", currency: "USD" });
  for (const [table, added] of Object.entries(extra)) rows[table] = [...(rows[table] ?? []), ...added];
  return Object.fromEntries(ITEMS.map((card) => [card.i, evaluate(rows, card.config.binding!, now)]));
}

/** A list's rows, as the visible columns read them. */
const list = (answer: unknown, ...columns: string[]) => (answer as Json[]).map((row) => columns.map((column) => row[column]));

// ── at the design's moment ──────────────────────────────────────────────────

describe("the Overview’s cards at 10:00 on Tuesday 28 July 2026", () => {
  const c = cards(Date.parse("2026-07-28T14:00:00Z"));

  it("reads every card from a query", () => {
    expect(ITEMS).toHaveLength(23);
    expect(ITEMS.every((card) => card.config.binding !== undefined)).toBe(true);
  });

  it("owes $6,937.50, $3,797.50 of it overdue; collected $1,200.00 in July; $4,231.50 waiting on a proposal still in date", () => {
    expect(c["kpi-outstanding"]).toBe(6937.5);
    expect(c["kpi-overdue"]).toBe(3797.5);
    expect(c["kpi-collected"]).toBe(1200);
    expect(c["kpi-proposals"]).toBe(4231.5);
  });

  it("has two projects active, one paused and one done this month", () => {
    expect([c["kpi-active"], c["kpi-paused"], c["kpi-done"]]).toEqual([2, 1, 1]);
  });

  it("ages the money owed: $3,140 not yet due, $2,170 at 1–30 days, $1,627.50 at 31–60, nothing older", () => {
    expect([c["owed-current"], c["owed-30"], c["owed-60"], c["owed-older"]]).toEqual([3140, 2170, 1627.5, 0]);
    // The four bands are the whole of what is owed.
    expect(money(3140 + 2170 + 1627.5)).toBe(c["kpi-outstanding"]);
  });

  it("needs a partner for one chase reminder whose day has come, one client who says they paid, one change asked, three new enquiries", () => {
    expect([c["needs-chase"], c["needs-paid"], c["needs-changes"], c["needs-enquiries"]]).toEqual([1, 1, 1, 3]);
  });

  it("charts February to July: July invoiced $6,510, collected $1,200", () => {
    expect(c["invoiced"]).toEqual([
      ["2026-02", 5967.5],
      ["2026-03", 3634.75],
      ["2026-04", 5208],
      ["2026-05", 2495.5],
      ["2026-06", 2387],
      ["2026-07", 6510],
    ]);
    expect(c["collected"]).toEqual([
      ["2026-02", 6076],
      ["2026-03", 3526.25],
      ["2026-04", 3472],
      ["2026-05", 3689],
      ["2026-06", 2387],
      ["2026-07", 1200],
    ]);
  });

  it("waits on clients for the shopfront proposal, three files and the two late invoices, oldest first", () => {
    expect(list(c["wait-proposals"], "number", "client", "valid_until")).toEqual([["QUO-S1142", "Marigold Lane", "2026-08-11"]]);
    expect(list(c["wait-files"], "title", "client").map(([title, client]) => [title, client])).toEqual([
      ["Label marks, second round", "Northlight Records"],
      ["Wordmark for dark surfaces", "Hearth & Loaf"],
      ["Sleeve dieline", "Fold & Rule"],
    ]);
    expect((c["wait-files"] as Json[]).map((row) => studioDay(row["shared_at"]))).toEqual(["2026-07-06", "2026-07-25", "2026-07-27"]);
    expect(list(c["wait-overdue"], "number", "client", "due_on", "balance")).toEqual([
      ["INV-S2037", "Northlight Records", "2026-06-11", 1627.5],
      ["INV-S2038", "Fold & Rule", "2026-07-16", 2170],
    ]);
  });

  it("falls due this week: two milestones — and the next invoices due are INV-S2040 on 3 August, then INV-S2039", () => {
    expect(list(c["week-milestones"], "title", "client", "due_on")).toEqual([
      ["Wordmark refinement", "Hearth & Loaf", "2026-07-29"],
      ["Box & sleeve layouts", "Fold & Rule", "2026-07-31"],
    ]);
    expect(list(c["due-next"], "number", "client", "due_on")).toEqual([
      ["INV-S2040", "Marigold Lane", "2026-08-03"],
      ["INV-S2039", "Hearth & Loaf", "2026-08-07"],
    ]);
  });

  it("has the work in progress: the two active projects, then the paused one with its own note", () => {
    expect(list(c["wip-projects"], "name", "status", "pause_note")).toEqual([
      ["Bakehouse rebrand", "active", null],
      ["Packaging & stationery system", "active", null],
      ["Vinyl sleeve system", "paused", "Paused until INV-S2037 clears."],
    ]);
  });
});

// ── rows the sample does not hold ────────────────────────────────────────────

describe("the Overview’s cards leave out what they do not count", () => {
  const now = Date.parse("2026-07-28T14:00:00Z");
  const c = cards(now, {
    // A sent proposal whose date has passed: lapsed, no longer waiting.
    proposals: [{ id: 901, number: "QUO-X1", status: "sent", valid_until: "2026-07-27", total: 999, client_id: 1 }],
    // A held email that is not a chase rung, due already.
    messages: [{ id: 901, kind: "proposal-reminder", status: "held", due: "2026-07-27T13:00:00.000Z" }],
    // A payment this month that was voided.
    payments: [{ id: 901, amount: 500, paid_on: "2026-07-20", voided: true }],
  });

  it("counts a proposal only while it is in date, a chase only for its rungs, and no voided payment", () => {
    expect(c["kpi-proposals"]).toBe(4231.5);
    expect(list(c["wait-proposals"], "number")).toEqual([["QUO-S1142"]]);
    expect(c["needs-chase"]).toBe(1);
    expect(c["kpi-collected"]).toBe(1200);
    expect((c["collected"] as [string, number][]).at(-1)).toEqual(["2026-07", 1200]);
  });
});

// ── added on other days ─────────────────────────────────────────────────────

describe.each([
  ["on Saturday 3 October 2026", Date.parse("2026-10-03T12:00:00Z")],
  ["on 1 September 2026, before dawn", Date.parse("2026-09-01T08:30:00Z")],
  ["on 1 March 2027", Date.parse("2027-03-01T15:00:00Z")],
  ["on 31 December 2026, late", Date.parse("2027-01-01T04:00:00Z")],
])("the Overview’s cards when the sample is added %s", (_, now) => {
  const c = cards(now);

  it("keep the money owed, how late it is, and what needs a partner", () => {
    expect([c["kpi-outstanding"], c["kpi-overdue"]]).toEqual([6937.5, 3797.5]);
    expect([c["owed-current"], c["owed-30"], c["owed-60"], c["owed-older"]]).toEqual([3140, 2170, 1627.5, 0]);
    expect([c["needs-chase"], c["needs-enquiries"]]).toEqual([1, 3]);
    expect(list(c["wait-overdue"], "number")).toEqual([["INV-S2037"], ["INV-S2038"]]);
  });

  it("keep a payment this month, the proposal in date, and the projects", () => {
    expect(c["kpi-collected"]).toBe(1200);
    expect(c["kpi-proposals"]).toBe(4231.5);
    expect([c["kpi-active"], c["kpi-paused"], c["kpi-done"]]).toEqual([2, 1, 1]);
  });

  it("keep six months in each chart", () => {
    expect(c["invoiced"]).toHaveLength(6);
    expect(c["collected"]).toHaveLength(6);
  });
});

// ── where a card leads ──────────────────────────────────────────────────────

const PAGES = manifest.pages as { ref: string; template: string; bindings?: { rows?: string } }[];
/** The link-narrowing words a records list reads. */
const LINK_OPS = ["eq", "neq", "in", "gt", "gte", "lt", "lte", "before", "after", "month", "set", "unset"];

/** Each card's links, as `[card, href]`. */
const LINKS = ITEMS.flatMap((card) =>
  [card.config.href, card.config.viewAllHref].filter((href): href is string => href !== undefined).map((href) => [card.i, href] as const),
);

function parse(href: string): { ref: string; pieces: { column: string; raw: string }[] } {
  const [path, search = ""] = href.split("?") as [string, string?];
  const ref = path.replace(/^\/p\//, "");
  const pieces = [...new URLSearchParams(search)].map(([key, raw]) => ({ column: key.replace(/^f\./, ""), raw }));
  return { ref, pieces };
}

describe("where the Overview’s cards lead", () => {
  it("opens the desk from the page’s own link", () => {
    expect((OVERVIEW_LAYOUT as { toolbar: { link: { href: string } } }).toolbar.link.href).toBe("@staff");
  });

  it("links only to the app’s own records pages, narrowed by columns those pages have", () => {
    expect(LINKS.length).toBeGreaterThan(15);
    for (const [card, href] of LINKS) {
      expect(href, card).toMatch(/^\/p\/clients-[a-z-]+(\?f\.[a-z_]+=[^&]+(&f\.[a-z_]+=[^&]+)*)?$/);
      const { ref, pieces } = parse(href);
      const target = PAGES.find((p) => p.ref === ref);
      expect(target, `${card} → ${ref}`).toBeDefined();
      for (const { column, raw } of pieces) {
        // Only a records list reads a narrowing from its address.
        expect(target!.template, `${card}: ${ref} reads no narrowing`).toBe("page-crud");
        expect(LINK_OPS, `${card}: ${raw}`).toContain(raw.split(":")[0]);
        expect(() => typeOf(target!.bindings!.rows!, column), `${card}: ${column}`).not.toThrow();
      }
    }
  });

  it("narrows each list the way its card counts", () => {
    const href = (id: string) => item(id).config.href;
    expect(href("kpi-overdue")).toBe("/p/clients-invoices?f.status=eq:sent&f.balance=gt:0&f.due_on=before:today");
    expect(href("kpi-proposals")).toBe("/p/clients-proposals?f.status=eq:sent&f.valid_until=gte:today");
    expect(href("kpi-collected")).toBe("/p/clients-payments?f.voided=eq:false&f.paid_on=month:this");
    expect(href("needs-chase")).toBe("/p/clients-messages?f.status=eq:held&f.kind=in:invoice-rung-1,invoice-rung-2,invoice-rung-3&f.due=lte:today");
    expect(href("needs-paid")).toBe("/p/clients-invoices?f.status=eq:sent&f.balance=gt:0&f.client_paid_at=set");
    // A late band's figure cannot be said as a narrowing, so it opens nothing.
    expect(["owed-30", "owed-60", "owed-older"].map(href)).toEqual([undefined, undefined, undefined]);
  });
});

// ── against the product, where it is checked out ────────────────────────────

const PRODUCT_ROOT = process.env.ADMINIUM_REPO || fileURLToPath(new URL("../../../adminium", import.meta.url));
const WIDGETS = join(PRODUCT_ROOT, "packages", "widgets", "dist");
const LINK_FILTERS = join(PRODUCT_ROOT, "apps", "server", "dist", "widget-data", "link-filters.js");
const available = existsSync(join(WIDGETS, "page-config", "index.js")) && existsSync(LINK_FILTERS);
const load = async <T,>(path: string): Promise<T> => (await import(/* @vite-ignore */ pathToFileURL(path).href)) as T;

interface Schema {
  safeParse: (value: unknown) => { success: boolean; error?: { issues: unknown[] } };
}

describe.skipIf(!available)("the Overview, put through the product’s own schemas", () => {
  it("is a dashboard layout the product accepts, every card’s settings and query included", async () => {
    const { pageLayoutSchema, queryDescriptorSchema } = await load<{ pageLayoutSchema: Schema; queryDescriptorSchema: Schema }>(join(WIDGETS, "page-config", "index.js"));
    const kpi = await load<Record<string, Schema>>(join(WIDGETS, "families", "kpi", "kpi-config.js"));
    const tables = await load<Record<string, Schema>>(join(WIDGETS, "families", "tables", "tables-config.js"));
    const charts = await load<Record<string, Schema>>(join(WIDGETS, "families", "charts", "charts-config.js"));
    const settings: Record<string, Schema | undefined> = {
      "kpi-stat-card": kpi["kpiStatCardConfigSchema"],
      "kpi-stat-tile-compact": kpi["kpiStatTileCompactConfigSchema"],
      "mini-table": tables["miniTableConfigSchema"],
      "chart-bar": charts["chartBarConfigSchema"],
    };
    const layout = pageLayoutSchema.safeParse(OVERVIEW_LAYOUT);
    expect(layout.error?.issues ?? []).toEqual([]);
    for (const card of ITEMS) {
      // Adminium names the connection when it installs the page.
      const bound = { ...card.config, binding: { ...card.config.binding, connectionId: "installed" } };
      const schema = settings[card.widget];
      expect(schema, card.widget).toBeDefined();
      expect(schema!.safeParse(bound).error?.issues ?? [], card.i).toEqual([]);
      expect(queryDescriptorSchema.safeParse(bound.binding).error?.issues ?? [], card.i).toEqual([]);
    }
  });

  it("counts the same days the product’s windows do", async () => {
    const { calendarBounds, aheadBounds } = await load<{
      calendarBounds: (last: number, unit: string, offset: number, now: Date, zone: string) => { start: Date; end: Date };
      aheadBounds: (unit: string, now: Date, zone: string) => { start: Date; end: Date | null };
    }>(join(PRODUCT_ROOT, "apps", "server", "dist", "widget-data", "compiler.js"));
    const windows = ITEMS.map((card) => card.config.binding!.window).filter((w): w is Window => w !== undefined && (w.calendar === true || w.ahead === true));
    expect(windows.length).toBeGreaterThan(10);
    for (const now of [Date.parse("2026-07-28T14:00:00Z"), Date.parse("2026-10-03T12:00:00Z"), Date.parse("2027-01-01T04:00:00Z")]) {
      for (const window of windows) {
        const product = window.ahead === true ? aheadBounds(window.unit, new Date(now), ZONE) : calendarBounds(window.last, window.unit, window.offset ?? 0, new Date(now), ZONE);
        // A bound is the instant a studio day starts; the day it starts is the day it names.
        const days = { start: studioDay(product.start.toISOString()), end: product.end === null ? null : studioDay(product.end.toISOString()) };
        expect(calendarDays(window, now), JSON.stringify(window)).toEqual(days);
      }
    }
  });

  it("links with narrowings the product uses whole — none left out", async () => {
    const { resolveLinkFilters } = await load<{
      resolveLinkFilters: (options: unknown) => { filters: { column: string; raw: string; status: string; reason?: string }[] };
    }>(LINK_FILTERS);
    const logical: Record<string, string> = { int: "integer", fk: "integer", decimal: "decimal", text: "text", enum: "enum", date: "date", timestamptz: "timestamptz", bool: "boolean" };
    for (const [card, href] of LINKS) {
      const { ref, pieces } = parse(href);
      if (pieces.length === 0) continue;
      const tableRef = PAGES.find((p) => p.ref === ref)!.bindings!.rows!;
      const columns = new Map(
        TABLES.find((t) => t.ref === tableRef)!.columns.map((c) => [
          c.ref,
          { name: c.ref, logicalType: logical[c.type] ?? "unknown", nullable: true, isPrimaryKey: false, masked: false, secret: false, textish: c.type === "text" },
        ]),
      );
      const resolved = resolveLinkFilters({
        pieces,
        table: { id: tableRef, schema: "", name: tableRef, primaryKey: ["id"], readOnly: false, table: {}, columns },
        canReadPii: true,
        dialect: "postgres",
        timezone: ZONE,
        now: new Date("2026-07-28T14:00:00Z"),
      });
      expect(resolved.filters.filter((filter) => filter.status !== "applied"), `${card}: ${href}`).toEqual([]);
    }
  });
});
