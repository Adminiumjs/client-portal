/**
 * THE TIME SCREEN IN A REAL BROWSER, ON A BUILT ADMINIUM.
 *
 * One Adminium is booted for the Playwright project's engine at 10:00 on
 * Tuesday 28 July 2026 with the sample added (`stack.ts`), and the studio's
 * session is the API's cookie — no password is typed. Every state of the
 * screen is shot and swept by axe in light, dark, Arabic (right to left) and
 * at phone width:
 *
 *   the sample as it stands (its figures asserted against the stored rows),
 *   one project's time, the log-time form refusing empty hours, the start
 *   sheet, a running clock (opened afresh — another computer — after a
 *   reload), a second clock for the same person refused, the move sheet,
 *   and the hours once a line of an invoice carries them.
 *
 * Beside the shots, what the stored rows must say after each press: a logged
 * entry dated today on the milestone under way, its client copied by
 * Adminium; a clock that is a row with Adminium's start stamp and no hours,
 * one per person; a stop that sends no hours — Adminium stamps it and counts
 * them, to the quarter hour, whatever the browser's clock says — and frees
 * the person; a clock left running overnight whose count Adminium refuses,
 * storing nothing, until the person types the hours;
 * a move that puts each entry on exactly one line of the client's draft at
 * the hourly rate, with Adminium's amount — and nothing twice.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { normaliseAll } from "../src/data/rows.ts";
import type { Invoice, InvoiceLine, Milestone, Person, Project, Rate, Settings, TableRef, TimeEntry } from "../src/data/types.ts";
import { DEMO_START } from "../src/lib/clock.ts";
import { hourly, timeSums } from "../src/screens/time/model.ts";
import { check as sweepAndShoot, contextOptions, settle, SHOTS, SWEEPS, VARIANTS, type Variant } from "./browser.ts";
import { Desk, DESK, screenOf } from "./desk.ts";
import { stackUp, type Stack } from "./stack.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 5010);
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

let stack: Stack;
let engine: string;
/** When the server's clock started at 10:00 on 28 July (its own clock runs on from there). */
let bootedAt = 0;
/** How far the server's clock has been moved on at once (a night passing). */
let passed = 0;

async function rows<T>(ref: TableRef): Promise<T[]> {
  return normaliseAll(ref, await stack.rows(ref)) as unknown as T[];
}

/**
 * A browser for one variant with the studio's session, its clock where the
 * server's is now — so a clock's face (the server's start stamp to the page's
 * now) reads the time that has passed, as it would on a real desk.
 */
async function context(browser: Browser, variant: Variant, skew = 0): Promise<BrowserContext> {
  const ctx = await browser.newContext({ ...contextOptions(variant), baseURL: stack.server.base });
  // `skew`: a computer whose clock is wrong by that much.
  const target = DEMO_START + (Date.now() - bootedAt) + passed + skew;
  await ctx.addInitScript(`(() => {
    const target = ${String(target)};
    const RealDate = Date;
    const offset = target - RealDate.now();
    class PinnedDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
      static now() { return RealDate.now() + offset; }
    }
    globalThis.Date = PinnedDate;
  })();`);
  await ctx.addCookies(
    stack.staff.cookies.split("; ").map((pair) => {
      const at = pair.indexOf("=");
      return { name: pair.slice(0, at), value: pair.slice(at + 1), url: stack.server.base };
    }),
  );
  return ctx;
}

/** Open Time at its own address, and wait for every entry to be read. */
async function openTime(page: Page, entries: number): Promise<Desk> {
  await page.goto(`${DESK}time`);
  await expect(screenOf(page, "time")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main .time-row")).toHaveCount(entries, { timeout: 30_000 });
  await settle(page);
  return new Desk(page, "light");
}

const deskIn = (page: Page, variant: Variant) => new Desk(page, variant);
const button = (page: Page, text: string) => page.locator("main button").filter({ hasText: text }).first();
const dialog = (page: Page) => page.locator("[role=dialog]");
const closeSheet = async (page: Page) => {
  await page.keyboard.press("Escape");
  await expect(dialog(page)).toHaveCount(0);
};
/** The shared check (shot, sweep, no serious finding, something analysed) — and here no finding of any impact. */
async function check(page: Page, name: string, screen: string, variant: Variant): Promise<void> {
  const result = await sweepAndShoot(page, name, screen, variant);
  expect.soft(result.violations, `${screen} (${variant}) axe findings`).toEqual([]);
}

const logged = (entries: TimeEntry[]) => entries.filter((e) => e.running_for === null && e.hours !== null).length;

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as string;
  bootedAt = Date.now();
  stack = await stackUp(engine as never, PORT);
});

test.afterAll(async () => {
  // Every sweep of this spec, for the report: passes and findings per screen and variant.
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "time-sweeps.json"), JSON.stringify(Object.fromEntries(SWEEPS), null, 1));
  await stack?.server.stop();
});

test("the sample's time at 28 July — its figures, a project, the form, the start and move sheets — light, dark, Arabic, phone", async ({ browser }, info) => {
  info.setTimeout(1_200_000);
  const entries = await rows<TimeEntry>("time_entries");
  const lines = await rows<InvoiceLine>("invoice_lines");
  const carried = new Set(lines.flatMap((l) => (l.time_entry_id === null ? [] : [l.time_entry_id])));
  const sums = timeSums(entries, carried, "2026-07-28");
  const rate = hourly(await rows<Rate>("rates"), (await rows<Settings>("settings"))[0] ?? null);
  // What the stored rows say at 28 July.
  expect([sums.month, sums.notInvoiced, sums.heaviest?.hours, rate]).toEqual(["28.50", "53.00", "28.00", "125.00"]);
  expect(entries.every((e) => e.running_for === null)).toBe(true);

  for (const variant of VARIANTS) {
    const ctx = await context(browser, variant);
    const page = await ctx.newPage();
    await openTime(page, logged(entries));
    const d = deskIn(page, variant);

    if (variant === "light") {
      // The page shows the stored figures, at the rate card's day rate over six hours.
      const main = page.locator("main");
      await expect(page.locator("[data-sum=month]")).toContainText("Logged in July");
      await expect(page.locator("[data-sum=month]")).toContainText("28.5 h");
      await expect(page.locator("[data-sum=open]")).toContainText("53 h");
      await expect(page.locator("[data-sum=open]")).toContainText(`${usd(6625)} at ${usd(125)} an hour`);
      await expect(page.locator("[data-sum=heaviest]")).toContainText("28 h");
      await expect(page.locator("[data-sum=heaviest]")).toContainText("Bakehouse rebrand");
      await expect(main).toContainText(`${usd(125)} an hour is the day rate divided by 6`);
      await expect(main).toContainText("Nothing running");
      await expect(page.locator(".time-foot")).toContainText(`53 h · ${usd(6625)}`);
      // Two entries are on sent stage invoices already: their chips open them.
      await expect(page.locator(".time-chip--on")).toHaveCount(2);
      await expect(page.locator(".time-chip--on").filter({ hasText: "INV-S2039" })).toHaveCount(1);
      await expect(page.locator(".time-chip--on").filter({ hasText: "INV-S2035" })).toHaveCount(1);
    }
    await check(page, engine, "time", variant);

    // One project: the client's name is data, the same in every language.
    await page.locator("main .filters button").filter({ hasText: "Hearth & Loaf" }).click();
    await expect(page.locator("main .time-row")).toHaveCount(8);
    if (variant === "light") await expect(page.locator(".time-foot")).toContainText(`Not invoiced on Bakehouse rebrand`);
    await check(page, engine, "time-project", variant);

    // Log time, saved with nothing typed: refused before anything is sent.
    await button(page, d.word("time.log")).click();
    await page.locator(".time-form button[type=submit]").click();
    await expect(page.locator(".time-form-error")).toHaveText(d.word("time.error.hours"));
    await check(page, engine, "time-log", variant);
    await page.locator(".time-form button").filter({ hasText: d.word("common.cancel") }).click();

    // The start sheet: project, who, what it's on.
    await page.locator("[data-clock=idle] button").click();
    await expect(dialog(page)).toBeVisible();
    await check(page, engine, "time-start-sheet", variant);
    await closeSheet(page);

    // The move sheet for this project: where the lines will go, before anything is written.
    await page.locator(".time-foot button").click();
    await expect(dialog(page)).toBeVisible();
    if (variant === "light") {
      await expect(dialog(page)).toContainText("7 entries · onto a new draft");
      await expect(dialog(page)).toContainText(`Move 22 h · ${usd(2750)}`);
    }
    await check(page, engine, "time-move-sheet", variant);
    await closeSheet(page);
    await ctx.close();
  }
  // Nothing was written by looking.
  expect(await rows<TimeEntry>("time_entries")).toHaveLength(entries.length);
  expect(await rows<InvoiceLine>("invoice_lines")).toHaveLength(lines.length);
});

test("log time: one entry, today, on the milestone under way; Adminium copies the client", async ({ browser }) => {
  const before = await rows<TimeEntry>("time_entries");
  const projects = await rows<Project>("projects");
  const milestones = await rows<Milestone>("milestones");
  const people = await rows<Person>("people");
  const ctx = await context(browser, "light");
  const page = await ctx.newPage();
  const d = await openTime(page, logged(before));
  await button(page, d.word("time.log")).click();
  const form = page.locator(".time-form");
  const project = projects.find((p) => p.name === "Packaging & stationery system")!;
  await form.locator("select").first().selectOption(String(project.id));
  await form.locator("input[inputmode=decimal]").fill("1.5");
  await form.locator(`input[placeholder="${d.word("time.form.note")}"]`).fill("Stationery proofs, second round");
  await form.locator("button[type=submit]").click();
  await expect(page.locator(".toasts")).toContainText("1.5 h on Fold & Rule. Logged.");
  await expect(page.locator("main .time-row")).toHaveCount(logged(before) + 1);

  const after = await rows<TimeEntry>("time_entries");
  const entry = after.find((e) => !before.some((b) => b.id === e.id))!;
  const under = milestones.filter((m) => m.project_id === project.id).sort((a, b) => a.position - b.position);
  const current = under.find((m) => m.state === "now") ?? under.find((m) => m.state === "next") ?? under.at(-1)!;
  expect(entry).toMatchObject({ project_id: project.id, client_id: project.client_id, milestone_id: current.id, person_id: people.sort((a, b) => a.position - b.position)[0]!.id, date: "2026-07-28", hours: expect.stringMatching(/^1\.50*$/), note: "Stationery proofs, second round", running_for: null });
  expect(entry.client_key).toHaveLength(36);
  await expect(page.locator("[data-sum=month]")).toContainText("30 h");
  await ctx.close();
});

test("the running clock is stored: it survives a reload, shows on another computer, is one a person, and stops into quarter-hours", async ({ browser }) => {
  const people = (await rows<Person>("people")).sort((a, b) => a.position - b.position);
  const nadia = people[0]!;
  const projects = await rows<Project>("projects");
  const before = await rows<TimeEntry>("time_entries");
  const ctx = await context(browser, "light");
  const page = await ctx.newPage();
  await openTime(page, logged(before));

  // Start: the studio's first open project, the first person, what it is on.
  await page.locator("[data-clock=idle] button").click();
  await dialog(page).locator("input").fill("Wordmark spacing at 12 mm");
  await dialog(page).locator("button[type=submit]").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".toasts")).toContainText("Clock running on Hearth & Loaf.");
  const running = page.locator(".time-clock--on");
  await expect(running).toHaveCount(1);
  await expect(running).toContainText("Hearth & Loaf · Bakehouse rebrand");

  const stored = (await rows<TimeEntry>("time_entries")).filter((e) => e.running_for !== null);
  expect(stored).toHaveLength(1);
  const clock = stored[0]!;
  expect(clock).toMatchObject({ running_for: nadia.id, person_id: nadia.id, project_id: projects.find((p) => p.name === "Bakehouse rebrand")!.id, hours: null, date: "2026-07-28", note: "Wordmark spacing at 12 mm" });
  expect(clock.started_at).not.toBeNull();
  expect(clock.client_key).toHaveLength(36);

  // The face runs from Adminium's stamp: after a reload it has not gone back to nothing.
  await page.waitForTimeout(2500);
  await page.reload();
  await expect(page.locator(".time-clock--on")).toHaveCount(1, { timeout: 30_000 });
  await expect(page.locator(".time-clock--on .time-clock-face")).not.toHaveText("00:00");
  await expect(page.locator(".time-clock--on .time-clock-face")).toHaveText(/^\d{2}:\d{2}$/);

  // Another computer: every variant, opened afresh, shows the same clock.
  for (const variant of VARIANTS) {
    const other = await context(browser, variant);
    const there = await other.newPage();
    await openTime(there, logged(before));
    await expect(there.locator(".time-clock--on")).toHaveCount(1);
    await expect(there.locator(".time-clock--on")).toContainText(nadia.name);
    await check(there, engine, "time-running", variant);
    // A second clock for the same person is refused by Adminium, and said in words.
    const dd = deskIn(there, variant);
    await there.locator("[data-clock=idle] button").click();
    await dialog(there).locator("input").fill("Something else");
    await dialog(there).locator("button[type=submit]").click();
    await expect(dialog(there).locator(".alert")).toHaveText(dd.word("time.error.clockRunning", { name: nadia.name }));
    await check(there, engine, "time-start-refused", variant);
    await other.close();
  }
  expect((await rows<TimeEntry>("time_entries")).filter((e) => e.running_for !== null)).toHaveLength(1);

  await ctx.close();

  // Stop, from a computer whose clock is twenty hours ahead: it sends no hours. Adminium stamps the
  // stop and counts them from its own two stamps, to the quarter hour (a quarter at least).
  const wrong = await context(browser, "light", 20 * 3_600_000);
  const stopPage = await wrong.newPage();
  const ds = await openTime(stopPage, logged(before));
  await expect(stopPage.locator(".time-clock--on .time-clock-face")).toHaveText(/^20:\d{2}:\d{2}$/);
  await stopPage.locator(".time-clock--on button").click();
  await expect(stopPage.locator(".toasts")).toContainText("0.25 h logged on Hearth & Loaf.");
  await expect(stopPage.locator(".time-clock--on")).toHaveCount(0);
  await expect(dialog(stopPage)).toHaveCount(0);
  await expect(stopPage.locator("main")).toContainText(ds.word("time.clock.nothing"));
  const stopped = (await rows<TimeEntry>("time_entries")).find((e) => e.id === clock.id)!;
  expect(stopped).toMatchObject({ running_for: null, note: "Wordmark spacing at 12 mm", logged_hours: null, clock_stopped: true });
  expect(Number(stopped.hours)).toBe(0.25);
  const ran = Date.parse(stopped.stopped_at!) - Date.parse(stopped.started_at!);
  expect(ran).toBeGreaterThanOrEqual(0);
  expect(ran).toBeLessThan(10 * 60_000);
  await wrong.close();
});

test("move onto an invoice: each entry on one line of the client's draft, at the hourly rate, Adminium's amount — nothing twice", async ({ browser }) => {
  const entries = await rows<TimeEntry>("time_entries");
  const projects = await rows<Project>("projects");
  const vinyl = projects.find((p) => p.name === "Vinyl sleeve system")!;
  const onVinyl = entries.filter((e) => e.project_id === vinyl.id && e.hours !== null);
  expect(onVinyl.map((e) => e.hours)).toEqual([expect.stringMatching(/^3(\.0+)?$/)]);
  const invoicesBefore = await rows<Invoice>("invoices");
  const ctx = await context(browser, "light");
  const page = await ctx.newPage();
  await openTime(page, logged(entries));
  await page.locator("main .filters button").filter({ hasText: "Northlight Records" }).click();
  await expect(page.locator("main .time-row")).toHaveCount(1);
  await page.locator(".time-foot button").click();
  await expect(dialog(page)).toContainText("1 entry · onto a new draft");
  await dialog(page).locator(".btn--primary").click();
  await expect(page.locator(".toasts")).toContainText(`3 h · ${usd(375)} onto a draft invoice.`);
  await expect(page.locator(".time-chip--on")).toHaveCount(1);
  await expect(page.locator(".time-foot")).toContainText("Everything here is invoiced");
  await expect(page.locator(".time-foot button")).toHaveText("Nothing to invoice");

  const lines = (await rows<InvoiceLine>("invoice_lines")).filter((l) => l.time_entry_id === onVinyl[0]!.id);
  expect(lines).toHaveLength(1);
  const line = lines[0]!;
  expect(Number(line.qty)).toBe(3);
  expect(Number(line.rate)).toBe(125);
  expect(Number(line.amount)).toBe(375);
  expect(line.client_key).toHaveLength(36);
  const draft = (await rows<Invoice>("invoices")).find((i) => i.id === line.document_id)!;
  expect(invoicesBefore.some((i) => i.id === draft.id)).toBe(false);
  expect(draft).toMatchObject({ status: "draft", client_id: vinyl.client_id, project_id: vinyl.id, from_quote_id: null, title: "Time on Vinyl sleeve system" });
  expect(Number(draft.subtotal)).toBe(375);

  // Pressed again: nothing to move; nothing written.
  await page.locator(".time-foot button").click();
  await expect(page.locator(".toasts")).toContainText("Everything here is invoiced.");
  expect((await rows<InvoiceLine>("invoice_lines")).filter((l) => l.time_entry_id === onVinyl[0]!.id)).toHaveLength(1);
  expect((await rows<Invoice>("invoices")).length).toBe(invoicesBefore.length + 1);
  // Adminium keeps an entry on one line, whoever asks: a raw second line for it is refused.
  const raw = await stack.staff.post(stack.data("invoice_lines"), { values: { document_id: draft.id, description: "Again", qty: "3", rate: "125", time_entry_id: onVinyl[0]!.id } });
  expect([raw.status, raw.code]).toEqual([409, "UNIQUE_VIOLATION"]);
  await ctx.close();

  // The invoiced state, in every variant, opened afresh.
  for (const variant of VARIANTS) {
    const other = await context(browser, variant);
    const there = await other.newPage();
    await openTime(there, logged(await rows<TimeEntry>("time_entries")));
    await there.locator("main .filters button").filter({ hasText: "Northlight Records" }).click();
    await expect(there.locator(".time-chip--on")).toHaveCount(1);
    await check(there, engine, "time-invoiced", variant);
    await other.close();
  }
});

test("the invoiced chip opens the invoice that carries the entry", async ({ browser }) => {
  const entries = await rows<TimeEntry>("time_entries");
  const ctx = await context(browser, "light");
  const page = await ctx.newPage();
  await openTime(page, logged(entries));
  await page.locator(".time-chip--on").filter({ hasText: "INV-S2039" }).click();
  await expect(screenOf(page, "invoice")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator("main")).toContainText("INV-S2039");
  await ctx.close();
});

// Last: it moves the server's clock on a night, and nothing after it may read the time.
test("a clock with nothing said stops with Adminium's count; one left running overnight is refused until its hours are typed", async ({ browser }) => {
  const people = (await rows<Person>("people")).sort((a, b) => a.position - b.position);
  const [nadia, tomas] = [people[0]!, people[1]!];
  const projects = await rows<Project>("projects");
  const bakehouse = projects.find((p) => p.name === "Bakehouse rebrand")!;
  const entries = await rows<TimeEntry>("time_entries");
  const start = async (person: Person, note: string | null): Promise<TimeEntry> => {
    const made = await stack.staff.post<{ data: Record<string, unknown> }>(stack.data("time_entries"), { values: { project_id: bakehouse.id, person_id: person.id, running_for: person.id, date: "2026-07-28", note } });
    expect(made.status, JSON.stringify(made.body).slice(0, 400)).toBe(201);
    return normaliseAll("time_entries", [made.body.data])[0] as unknown as TimeEntry;
  };

  // Started elsewhere with nothing said: Stop asks what it was on; the hours left empty are Adminium's.
  const quiet = await start(tomas, null);
  const ctx = await context(browser, "light");
  const page = await ctx.newPage();
  await openTime(page, logged(entries));
  await page.locator(".time-clock--on").filter({ hasText: tomas.name }).locator("button").click();
  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).locator(".time-sheet-lead")).toContainText("Leave Hours empty to log the clock’s own time, to the quarter hour.");
  await expect(dialog(page).locator("input[inputmode=decimal]")).toHaveValue("");
  await check(page, engine, "time-stop-note", "light");
  await dialog(page).locator("input").nth(1).fill("Press proofs, by the window");
  await dialog(page).locator("button[type=submit]").click();
  await expect(dialog(page)).toHaveCount(0);
  await expect(page.locator(".toasts")).toContainText("0.25 h logged on Hearth & Loaf.");
  const quietStopped = (await rows<TimeEntry>("time_entries")).find((e) => e.id === quiet.id)!;
  expect(quietStopped).toMatchObject({ running_for: null, logged_hours: null, clock_stopped: true, note: "Press proofs, by the window" });
  expect(Number(quietStopped.hours)).toBe(0.25);
  await ctx.close();

  // Left running overnight: seventeen hours pass on Adminium's clock.
  const long = await start(nadia, "Type specimen, overnight");
  await stack.server.pass(17 * 3_600_000);
  passed += 17 * 3_600_000;
  for (const variant of VARIANTS) {
    const other = await context(browser, variant);
    const there = await other.newPage();
    const dv = deskIn(there, variant);
    await openTime(there, logged(await rows<TimeEntry>("time_entries")));
    await there.locator(".time-clock--on").filter({ hasText: nadia.name }).locator("button").click();
    // Adminium refused its own count: the sheet asks for the hours, and nothing was stored.
    await expect(dialog(there)).toBeVisible();
    await expect(dialog(there)).toContainText(dv.word("time.error.tooLong"));
    await expect(dialog(there).locator("input[inputmode=decimal]")).toHaveValue("");
    await check(there, engine, "time-stop-long", variant);
    const held = (await rows<TimeEntry>("time_entries")).find((e) => e.id === long.id)!;
    expect(held).toMatchObject({ running_for: nadia.id, hours: null, stopped_at: null, clock_stopped: false });
    if (variant !== "phone") {
      await closeSheet(there);
      await other.close();
      continue;
    }
    // Empty hours are not taken: past sixteen, the person must say.
    await dialog(there).locator("button[type=submit]").click();
    await expect(dialog(there)).toContainText(dv.word("time.error.hours"));
    await dialog(there).locator("input[inputmode=decimal]").fill("7");
    await dialog(there).locator("button[type=submit]").click();
    await expect(dialog(there)).toHaveCount(0);
    await expect(there.locator(".toasts")).toContainText("7 h logged on Hearth & Loaf.");
    await other.close();
  }
  const typed = (await rows<TimeEntry>("time_entries")).find((e) => e.id === long.id)!;
  expect(typed).toMatchObject({ running_for: null, clock_stopped: true, note: "Type specimen, overnight" });
  expect([Number(typed.hours), Number(typed.logged_hours)]).toEqual([7, 7]);
  expect(Date.parse(typed.stopped_at!) - Date.parse(typed.started_at!)).toBeGreaterThanOrEqual(17 * 3_600_000);
});
