/**
 * SCHEDULE AND CAPACITY IN A REAL BROWSER, ON A BUILT ADMINIUM.
 *
 * One Adminium booted by the contract's harness at 10:00 on Tuesday 28 July
 * 2026, the Invoices & Receipts add-on and this app (its built surfaces)
 * installed, the sample added — then the studio's month and "Can we take
 * this?" opened as the studio opens them, every state in light, dark, Arabic
 * (right to left) and at phone width: shot full-page and swept by axe (WCAG
 * 2.0/2.1 A and AA; no violation at all, and never a sweep that analysed
 * nothing).
 *
 * Beside the sweeps:
 *   - the weeks Capacity draws are the sample's at 28 July, worked out from
 *     the rows Adminium stores, and August on the Schedule reads 21 working
 *     days, 5 milestones, Tomas away 3 days;
 *   - "Add a date" writes one `events` row — an away stretch naming who and
 *     until when, under an action key — and the month shows it;
 *   - with Holiday calendars attached, its days reach the desk through the
 *     staff config: a public holiday shows on the Schedule under its name and
 *     takes a day from everyone's week in Capacity.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync } from "node:zlib";

import { expect, test, type Browser, type Page } from "@playwright/test";

import type { Id } from "../src/data/types.ts";
import { capacityWeeks } from "../src/state/capacity.ts";
import { ADD_ONS_REPO, ok, type Engine } from "../src/contract/harness.ts";
import { check, newContext, SHOTS, SWEEPS, VARIANTS, type Variant } from "./browser.ts";
import { DESK, screenOf } from "./desk.ts";
import { stackUp, type Stack } from "./stack.ts";
import { localeOf, say } from "./words.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 5040);

let engine: Engine;
let stack: Stack;

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as Engine;
  stack = await stackUp(engine, PORT);
});

test.afterAll(async () => {
  // Every sweep of this spec, for the report: its passes and what it found.
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "schedule-sweeps.json"), JSON.stringify(Object.fromEntries([...SWEEPS].filter(([key]) => key.startsWith(`${engine}/`))), null, 1));
  await stack?.server.stop();
});

/** The shot and the sweep: nothing axe finds at any impact, and a sweep that analysed something. */
async function shoot(page: Page, name: string, variant: Variant): Promise<void> {
  const result = await check(page, engine, name, variant);
  expect.soft(result.violations, `${name} (${variant}): ${JSON.stringify(result.violations, null, 1)}`).toEqual([]);
}

async function open(browser: Browser, variant: Variant, screen: "schedule" | "capacity"): Promise<Page> {
  const context = await newContext(browser, stack.server.base, variant, stack.staff.cookies);
  const page = await context.newPage();
  await page.goto(`${DESK}${screen}`);
  await expect(screenOf(page, screen)).toBeVisible({ timeout: 30_000 });
  // The studio's dates arrive after the frame: wait for the sample's press check on the 30th.
  if (screen === "schedule") await expect(page.locator('[data-day="2026-07-30"] .sch-item')).toHaveCount(1, { timeout: 20_000 });
  else await expect(page.locator(".cap-row")).toHaveCount(13);
  return page;
}

const num = (n: number) => String(Math.round(n * 10) / 10);

test("the sample's weeks and month at 28 July — worked out from Adminium's rows, drawn by the desk", async ({ browser }) => {
  const [people, projects, milestones, events, settings] = await Promise.all(["people", "projects", "milestones", "events", "settings"].map((ref) => stack.rows(ref)));
  const view = capacityWeeks({
    today: "2026-07-28",
    studioDaysPerWeek: Number(settings![0]!["days_per_week"]),
    people: people!.map((p) => ({ id: p.id, days_per_week: (p["days_per_week"] as number | null) ?? null })),
    projects: projects!.map((p) => ({ id: p.id, status: String(p["status"]), started_on: (p["started_on"] as string | null) ?? null })),
    milestones: milestones!.map((m) => ({ id: m.id, project_id: m["project_id"] as Id, due_on: (m["due_on"] as string | null) ?? null, state: String(m["state"]), estimated_days: m["estimated_days"] === null ? null : String(m["estimated_days"]), position: Number(m["position"]) })),
    events: events!.map((e) => ({ date: String(e["date"]), to_date: (e["to_date"] as string | null) ?? null, kind: String(e["kind"]), person_id: (e["person_id"] as Id | null) ?? null })),
  });
  const expected: [string, number, number, number][] = [
    ["2026-07-27", 8, 9.61, 0],
    ["2026-08-03", 8, 5.14, 2.86],
    ["2026-08-10", 5, 3.67, 1.33],
    ["2026-08-17", 8, 2.08, 5.92],
    ["2026-08-24", 8, 1, 7],
  ];
  expect(view.weeks.slice(0, 5).map((w) => [w.start, w.capacity, w.used, w.free])).toEqual(expected);

  const page = await open(browser, "light", "capacity");
  for (const [start, capacity, used, open] of expected) {
    await expect(page.locator(`[data-week="${start}"] .cap-cells`)).toHaveAttribute("aria-label", say("en-US", "capacity.week.cells", { capacity: num(capacity), used: num(used), open: num(open) }));
  }
  await expect(page.locator(".cap-headline")).toHaveText(say("en-US", "capacity.headline.later", { day: "Aug 17" }));
  await expect(page.locator(".cap-chip").first()).toHaveText("Rosa · tile shop");

  await page.goto(`${DESK}schedule`);
  await expect(screenOf(page, "schedule")).toBeVisible();
  await page.getByRole("button", { name: say("en-US", "schedule.next") }).click();
  await expect(page.locator('[data-stat="working"] .sch-stat-v')).toHaveText("21");
  await expect(page.locator('[data-stat="committed"] .sch-stat-v')).toHaveText("5");
  await expect(page.locator('[data-stat="short"]')).toContainText("3 days");
  await expect(page.locator('[data-stat="short"]')).toContainText("Tomas away");
  for (const day of ["2026-08-10", "2026-08-11", "2026-08-12"]) await expect(page.locator(`[data-day="${day}"]`)).toContainText("Tomas away");
  await page.context().close();
});

test("every state of both screens — light, dark, Arabic, phone", async ({ browser }, info) => {
  info.setTimeout(900_000);
  for (const variant of VARIANTS) {
    const word = (key: Parameters<typeof say>[1], params?: Record<string, string | number>) => say(localeOf(variant), key, params);
    await test.step(`schedule (${variant})`, async () => {
      const page = await open(browser, variant, "schedule");
      await shoot(page, "schedule", variant);
      await page.getByRole("button", { name: word("schedule.next") }).click();
      await page.locator('[data-day="2026-08-10"]').click();
      await expect(page.locator(".sch-day-item")).toHaveCount(1);
      await shoot(page, "schedule-day", variant);
      await page.locator('[data-day="2026-08-19"]').click();
      await expect(page.locator(".sch-day-note")).toHaveText(word("schedule.day.open"));
      await shoot(page, "schedule-day-clear", variant);
      await page.locator(".sch-add").click();
      await page.locator(".sch-sheet select").first().selectOption("away");
      await page.locator(".sch-sheet .add-submit").click();
      await expect(page.locator(".sch-sheet .field-error")).toHaveCount(2);
      await shoot(page, "schedule-add-date", variant);
      await page.context().close();
    });
    await test.step(`capacity (${variant})`, async () => {
      const page = await open(browser, variant, "capacity");
      await shoot(page, "capacity", variant);
      await page.locator(".cap-out").click();
      await expect(page.locator(".cap-out")).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".cap-cell--held")).toHaveCount(5);
      await shoot(page, "capacity-proposals-out", variant);
      await page.locator(".cap-out").click();
      await page.locator(".cap-size").nth(2).click();
      await expect(page.locator(".cap-headline")).toHaveText(word("capacity.headline.later", { day: new Intl.DateTimeFormat(localeOf(variant), { day: "numeric", month: "short", timeZone: "UTC" }).format(Date.UTC(2026, 7, 17, 12)) }));
      await shoot(page, "capacity-large", variant);
      await page.locator(".cap-size").nth(0).click();
      await expect(page.locator('[data-verdict="soon"]')).toBeVisible();
      await page.locator(".cap-actions button").nth(2).click();
      await expect(page.locator(".sch-sheet input").nth(1)).toHaveValue(word("capacity.hold.title", { business: "Vento & Sons" }));
      await shoot(page, "capacity-hold", variant);
      await page.context().close();
    });
  }
});

test("Open the enquiry opens the enquiry Capacity is answering, not the newest", async ({ browser }) => {
  const page = await open(browser, "light", "capacity");
  const chips = page.locator(".cap-chip");
  await expect(chips.nth(1)).toBeVisible();
  await chips.nth(1).click();
  await expect(chips.nth(1)).toHaveAttribute("aria-pressed", "true");
  const asked = (await stack.rows("enquiries")).filter((e) => e["fit"] !== "no" && ["new", "replied", "parked"].includes(String(e["status"])));
  asked.sort((a, b) => String(b["received_at"] ?? "").localeCompare(String(a["received_at"] ?? "")) || Number(b.id) - Number(a.id));
  const second = asked[1]!;
  await page.locator(".cap-actions button").nth(1).click();
  await expect(screenOf(page, "enquiries")).toBeVisible();
  await expect(page.locator(".enq-business")).toHaveText(String(second["business"] ?? second["name"]));
  await page.context().close();
});

test("Add a date writes one studio date, and the month shows it", async ({ browser }) => {
  const page = await open(browser, "light", "schedule");
  await page.locator(".sch-add").click();
  const sheet = page.locator(".sch-sheet");
  await sheet.locator('input[type="date"]').first().fill("2026-08-19");
  await sheet.locator("input:not([type])").fill("Nadia at the type conference");
  await sheet.locator("select").first().selectOption("away");
  await sheet.locator("select").nth(1).selectOption({ label: "Nadia Cole" });
  await sheet.locator('input[type="date"]').nth(1).fill("2026-08-20");
  await sheet.locator(".add-submit").click();
  await expect(sheet).toHaveCount(0);
  const row = (await stack.rows("events")).find((e) => e["title"] === "Nadia at the type conference");
  expect(row).toBeDefined();
  const nadia = (await stack.rows("people")).find((p) => p["name"] === "Nadia Cole")!;
  expect([row!["date"], row!["to_date"], row!["kind"], row!["person_id"]]).toEqual(["2026-08-19", "2026-08-20", "away", nadia.id]);
  expect(String(row!["client_key"])).toMatch(/^[0-9a-f-]{36}$/);
  // The month moved to the date, with its day open.
  await expect(page.locator('[data-day="2026-08-19"]')).toContainText("Nadia at the type conference");
  await expect(page.locator('[data-day="2026-08-20"]')).toContainText("Nadia at the type conference");
  await expect(page.locator(".sch-day-title")).toBeVisible();
  await page.context().close();
});

// ── Holiday calendars, as an operator installs it ───────────────────────────

const BLOCK = 512;
function tarball(files: Record<string, Buffer>): Buffer {
  const members: Buffer[] = [];
  const put = (block: Buffer, at: number, length: number, value: string) => Buffer.from(value, "latin1").subarray(0, length).copy(block, at);
  for (const [path, body] of Object.entries(files)) {
    const header = Buffer.alloc(BLOCK);
    put(header, 0, 100, `package/${path}`);
    put(header, 100, 8, "0000644\0");
    put(header, 124, 12, `${body.length.toString(8).padStart(11, "0")}\0`);
    put(header, 136, 12, "00000000000\0");
    put(header, 156, 1, "0");
    put(header, 257, 6, "ustar\0");
    put(header, 263, 2, "00");
    header.fill(0x20, 148, 156);
    let sum = 0;
    for (const byte of header) sum += byte;
    put(header, 148, 8, `${sum.toString(8).padStart(6, "0")}\0 `);
    members.push(header, body, Buffer.alloc((BLOCK - (body.length % BLOCK)) % BLOCK));
  }
  members.push(Buffer.alloc(BLOCK * 2));
  return gzipSync(Buffer.concat(members), { mtime: 0 } as never);
}

/** The Holiday calendars package from the add-ons checkout, packed as its release packs it. */
function holidayBundle(): { buffer: Buffer; integrity: string; key: string; version: string } {
  const root = join(ADD_ONS_REPO, "packages", "holiday-calendars");
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown> & { name: string; version: string; files: string[] };
  const files: Record<string, Buffer> = {};
  const add = (path: string) => {
    const absolute = join(root, path);
    if (!existsSync(absolute)) return;
    if (statSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute)) add(join(path, name));
      return;
    }
    files[relative(root, absolute).split("\\").join("/")] = readFileSync(absolute);
  };
  for (const entry of pkg.files) add(entry);
  const { devDependencies: _dev, scripts: _scripts, ...shipped } = pkg;
  files["package.json"] = Buffer.from(JSON.stringify({ ...shipped, name: pkg.name.replace(/^@adminium\//, "@adminiumjs/") }));
  const manifest = JSON.parse(readFileSync(join(root, "manifest.json"), "utf8")) as { key: string; version: string };
  const buffer = tarball(files);
  return { buffer, integrity: `sha512-${createHash("sha512").update(buffer).digest("base64")}`, key: manifest.key, version: manifest.version };
}

test("Holiday calendars attached: a public holiday on the Schedule, and a day off everyone's week in Capacity", async ({ browser }) => {
  const addOn = holidayBundle();
  ok(await stack.staff.post(`/api/v1/add-ons/upload?expectedSha512=${encodeURIComponent(addOn.integrity)}`, addOn.buffer));
  ok(await stack.staff.post("/api/v1/add-ons", { key: addOn.key, version: addOn.version, attachTo: ["clients"] }));
  ok(await stack.staff.put(`/api/v1/add-ons/${addOn.key}/settings`, { values: { days: [{ date: "2026-09-07", name: "Labor Day" }] } }));
  const config = ok(await stack.staff.get<{ addOns?: Record<string, { settings: Record<string, unknown> }> }>("/apps/clients/staff/surface-config.json"));
  expect(config.addOns?.["holiday-calendars"]?.settings["days"]).toEqual([{ date: "2026-09-07", name: "Labor Day" }]);

  const page = await open(browser, "light", "capacity");
  await expect(page.locator('[data-week="2026-09-07"] .cap-cells')).toHaveAttribute("aria-label", say("en-US", "capacity.week.cells", { capacity: "6", used: "0", open: "6" }));
  await expect(page.locator('[data-week="2026-09-07"] .cap-row-why')).toHaveText("Labor Day");
  await expect(page.locator('[data-week="2026-09-07"] .cap-cell--none')).toHaveCount(2);
  await shoot(page, "capacity-holiday", "light");

  await page.goto(`${DESK}schedule`);
  await expect(screenOf(page, "schedule")).toBeVisible();
  await page.getByRole("button", { name: say("en-US", "schedule.next") }).click();
  await page.getByRole("button", { name: say("en-US", "schedule.next") }).click();
  await expect(page.locator('[data-day="2026-09-07"]')).toContainText("Labor Day");
  await expect(page.locator('[data-stat="working"]')).toContainText(say("en-US", "schedule.stat.workingSubHolidays", { month: "September", n: 1 }).split("|")[0]!);
  await expect(page.locator('[data-stat="working"] .sch-stat-v')).toHaveText("21");
  await shoot(page, "schedule-holiday", "light");
  await page.context().close();
});
