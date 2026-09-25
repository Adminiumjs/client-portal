/**
 * MONEY, ARCHIVE AND EVERY EMAIL WE SEND IN A REAL BROWSER, ON A BUILT ADMINIUM.
 *
 * One Adminium is booted by the contract's harness at 10:00 on Tuesday
 * 28 July 2026, the Invoices & Receipts add-on and this app are installed and
 * the sample is added; the studio is signed in through the API's cookie. Each
 * screen and each of its states is opened as a person opens it, in light,
 * dark, Arabic and at phone width, shot full-page and swept by axe.
 *
 * Beside the sweeps:
 *   - Money shows the sample's figures at that moment, every one worked out
 *     from the rows Adminium stored (read back over HTTP): six months of
 *     invoiced and collected, July itemised, the four figures, the aging and
 *     the running costs; a running cost added, changed and taken off lands in
 *     Adminium's table;
 *   - the Archive lists the finished project, worth its sent invoices;
 *   - the emails are the app's installed templates, filled from the studio's
 *     rows; "Send a test to ourselves" delivers one email to the studio's own
 *     address through Adminium's test send — no client receives anything, and
 *     it carries no sign-in link and no share code.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { normaliseAll } from "../src/data/rows.ts";
import type { Invoice } from "../src/data/types.ts";
import { aging, chart, figures, type MoneyInputs } from "../src/screens/money/model.ts";
import { finished, worth } from "../src/screens/archive/model.ts";
import { ok, type Engine } from "../src/contract/harness.ts";
import { check, newContext, settle, SHOTS, SWEEPS, VARIANTS, type Variant } from "./browser.ts";
import { DESK, screenOf } from "./desk.ts";
import { stackUp, type Stack } from "./stack.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 5050);
const RUN_STARTED = Number(process.env["E2E_RUN_STARTED"] ?? Date.now());
const PAY = "Bank transfer to Outline Studio · account 0123 4567 · quote the invoice number";
const STUDIO = "hello@outline.example";
const usd = (value: string | number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(value));

let engine: Engine;
let stack: Stack;

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as Engine;
  stack = await stackUp(engine, PORT);
  ok(await stack.staff.put("/api/v1/add-ons/invoices/settings", { values: { payment_instructions: PAY } }));
});

test.afterAll(async () => {
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "money-sweeps.json");
  const earlier = existsSync(file) && statSync(file).mtimeMs >= RUN_STARTED ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  const mine = Object.fromEntries([...SWEEPS].filter(([key]) => key.startsWith(`${engine}/`)));
  writeFileSync(file, JSON.stringify({ ...earlier, ...mine }, null, 1));
  await stack?.server.stop();
});

/** The stored rows the Money screen reads, as the desk reads them. */
async function moneyInputs(): Promise<MoneyInputs> {
  const invoices = normaliseAll("invoices", await stack.rows("invoices"));
  return {
    today: "2026-07-28",
    currency: "USD",
    invoices: Object.fromEntries(invoices.map((i) => [i.id, i])) as Record<number, Invoice>,
    payments: normaliseAll("payments", await stack.rows("payments")),
    proposals: normaliseAll("proposals", await stack.rows("proposals")),
    costs: normaliseAll("running_costs", await stack.rows("running_costs")),
  };
}

/** A signed-in desk page on one screen, in one variant. */
async function deskAt(browser: Browser, variant: Variant, path: string, screen: string): Promise<Page> {
  const context = await newContext(browser, stack.server.base, variant, stack.staff.cookies);
  const page = await context.newPage();
  await page.goto(`${DESK}${path}`);
  await expect(screenOf(page, screen)).toBeVisible({ timeout: 30_000 });
  await settle(page);
  return page;
}

test("Money at 10:00 on 28 July — every state, light, dark, Arabic, phone — every figure from the stored rows", async ({ browser }, info) => {
  info.setTimeout(1_200_000);
  const input = await moneyInputs();
  const f = figures(input);
  // The sample's figures at that moment, worked out from what Adminium stored.
  expect([f.sixMonths, f.average, f.costs, f.collectedThisMonth, f.invoicedThisMonth]).toEqual(["20350.25", "3391.71", "2850.00", "1200.00", "6510.00"]);
  expect([f.open, f.openCount, f.overdue, f.outForSignature, f.proposalsOut, f.holdsUntil, f.monthsCovered]).toEqual(["6937.50", 4, "3797.50", "4231.50", 1, "2026-08-11", 2.4]);
  const bars = chart(input);
  expect(bars.map((b) => [b.month, b.invoiced, b.collected])).toEqual([
    ["2026-02", "5967.50", "6076.00"],
    ["2026-03", "3634.75", "3526.25"],
    ["2026-04", "5208.00", "3472.00"],
    ["2026-05", "2495.50", "3689.00"],
    ["2026-06", "2387.00", "2387.00"],
    ["2026-07", "6510.00", "1200.00"],
  ]);
  expect(aging(input).map((b) => [b.key, b.amount, b.count])).toEqual([
    ["current", "3140.00", 2],
    ["d30", "2170.00", 1],
    ["d60", "1627.50", 1],
    ["d61", "0.00", 0],
  ]);

  for (const variant of VARIANTS) {
    const page = await deskAt(browser, variant, "money", "money");
    const main = page.locator("[data-screen=money]");
    await test.step(`money (${variant})`, async () => {
      if (variant === "light") {
        await expect(main.locator(".money-lead")).toHaveText("Collected $20,350.25 in six months, an average of $3,391.71 a month against $2,850.00 of costs. July is thin because 3 invoices are sitting open.");
        const kpi = (key: string) => main.locator(`[data-kpi=${key}]`);
        await expect(kpi("collected")).toContainText("Collected in July");
        await expect(kpi("collected")).toContainText("$1,200.00");
        await expect(kpi("collected")).toContainText("$6,510.00 was invoiced");
        await expect(kpi("open")).toContainText("$6,937.50");
        await expect(kpi("open")).toContainText("$3,797.50 of it overdue");
        await expect(kpi("out")).toContainText("$4,231.50");
        await expect(kpi("out")).toContainText("one proposal, holds to Aug 11");
        await expect(kpi("covered")).toContainText("2.4 months");
        for (const b of bars) {
          const month = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${b.month}-15T12:00:00Z`));
          await expect(main.getByRole("button", { name: `${month}: ${usd(b.invoiced)} invoiced, ${usd(b.collected)} collected` })).toHaveCount(1);
        }
        const buckets = main.locator(".money-bucket");
        await expect(buckets).toHaveText([/Current\s*\$3,140\.00\s*2 invoices/, /1–30 days\s*\$2,170\.00\s*1 invoice/, /31–60 days\s*\$1,627\.50\s*1 invoice/, /61\+ days\s*\$0\.00\s*0 invoices/]);
        for (const c of input.costs) await expect(main.locator(".money-cost").filter({ hasText: c.label })).toContainText(usd(c.monthly_amount));
        await expect(main.locator(".money-cost--total")).toContainText("$2,850.00");
        await expect(main).not.toContainText(/Year-end/i);
      }
      await check(page, engine, "money", variant);
    });

    await test.step(`money-july (${variant})`, async () => {
      await main.locator(".money-bar").nth(5).click();
      await expect(main.locator(".money-drill")).toBeVisible();
      if (variant === "light") {
        await expect(main.locator(".money-drill-head")).toContainText("July 2026");
        await expect(main.locator(".money-drill-head")).toContainText("$6,510.00 invoiced · $1,200.00 collected");
        const july = Object.values(input.invoices).filter((i) => i.status === "sent" && i.issued_on?.startsWith("2026-07"));
        expect(july).toHaveLength(3);
        for (const inv of july) await expect(main.locator(".money-drill-row").filter({ hasText: inv.number! }).filter({ hasNotText: "Paid —" })).toContainText(usd(inv.total!));
        await expect(main.locator(".money-drill-row").filter({ hasText: "Paid — Hearth & Loaf" })).toContainText("$1,200.00");
      }
      await check(page, engine, "money-july", variant);
    });

    await test.step(`money-cost-sheet (${variant})`, async () => {
      await main.locator(".money-costs-add").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await check(page, engine, "money-cost-sheet", variant);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
    });

    if (variant === "light") {
      await test.step("money-aging opens the invoices on that bucket", async () => {
        await main.locator(".money-bucket").nth(2).click();
        await expect(screenOf(page, "invoices")).toBeVisible();
        await expect(page.locator("[data-screen=invoices]")).toContainText("INV-S2037");
      });
    }
    await page.context().close();
  }
});

test("a running cost added, changed and taken off on Money lands in Adminium's table", async ({ browser }) => {
  const page = await deskAt(browser, "light", "money", "money");
  const main = page.locator("[data-screen=money]");
  await main.locator(".money-costs-add").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("What it is").fill("Bookkeeping app");
  await dialog.getByLabel("Each month").fill("19.50");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(main.locator(".money-cost").filter({ hasText: "Bookkeeping app" })).toContainText("$19.50");
  await expect(main.locator(".money-cost--total")).toContainText("$2,869.50");
  let stored = (await stack.rows("running_costs")).find((r) => r["label"] === "Bookkeeping app");
  expect(Number(stored?.["monthly_amount"])).toBe(19.5);

  await main.getByRole("button", { name: "Change Bookkeeping app" }).click();
  await dialog.getByLabel("Each month").fill("24");
  await dialog.locator("button[type=submit]").click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(main.locator(".money-cost--total")).toContainText("$2,874.00");
  stored = (await stack.rows("running_costs")).find((r) => r["label"] === "Bookkeeping app");
  expect(Number(stored?.["monthly_amount"])).toBe(24);

  await main.getByRole("button", { name: "Change Bookkeeping app" }).click();
  await dialog.getByRole("button", { name: "Take it off" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(main.locator(".money-cost--total")).toContainText("$2,850.00");
  expect((await stack.rows("running_costs")).map((r) => r["label"])).not.toContain("Bookkeeping app");
  await page.context().close();
});

test("the Archive — light, dark, Arabic, phone — the finished project worth its sent invoices", async ({ browser }, info) => {
  info.setTimeout(900_000);
  const projects = normaliseAll("projects", await stack.rows("projects"));
  const invoices = normaliseAll("invoices", await stack.rows("invoices"));
  const clients = Object.fromEntries(normaliseAll("clients", await stack.rows("clients")).map((c) => [c.id, c]));
  const done = finished(projects, invoices, clients, "USD");
  expect(done.map((d) => [d.project.number, d.project.name, d.year])).toEqual([["PRJ-S04", "Menu & cup system", 2026]]);
  const value = worth(done, "USD");
  expect(Number(value)).toBeGreaterThan(0);

  for (const variant of VARIANTS) {
    const page = await deskAt(browser, variant, "archive", "archive");
    const main = page.locator("[data-screen=archive]");
    await test.step(`archive (${variant})`, async () => {
      if (variant === "light") {
        await expect(main.locator(".archive-lead")).toHaveText(`1 finished project, 1 year, ${usd(value)} of work. Each keeps its handover page and its invoices.`);
        const row = main.locator(".archive-row");
        await expect(row).toHaveCount(1);
        await expect(row).toContainText("Menu & cup system");
        await expect(row).toContainText("Ferngrove Coffee");
        await expect(row).toContainText(usd(value));
        await expect(main.locator(".archive-sum")).toContainText(`1 project · ${usd(value)}`);
      }
      await check(page, engine, "archive", variant);
    });
    await test.step(`archive-search (${variant})`, async () => {
      await main.locator(".archive-search-input").fill("Ferngrove");
      await expect(main.locator(".archive-row")).toHaveCount(1);
      await check(page, engine, "archive-search", variant);
      await main.locator(".archive-search-input").fill("zzz-nothing");
      await expect(main.locator(".archive-row")).toHaveCount(0);
      await expect(main.locator(".archive-none")).toBeVisible();
      await check(page, engine, "archive-nomatch", variant);
    });
    if (variant === "light") {
      await main.locator(".archive-search-input").fill("");
      await main.locator(".archive-row").click();
      await expect(screenOf(page, "handover")).toBeVisible();
    }
    await page.context().close();
  }
});

test("every email we send — light, dark, Arabic, phone — and a test that only ever reaches the studio", async ({ browser }, info) => {
  info.setTimeout(1_200_000);
  const invoices = await stack.rows("invoices");
  const shareCodes = (await stack.rows("projects")).map((p) => p["share_token"]).filter((t): t is string => typeof t === "string" && t !== "");
  const clientEmails = (await stack.rows("clients")).map((c) => String(c["email"]));

  for (const variant of VARIANTS) {
    const page = await deskAt(browser, variant, "emails", "emails");
    const main = page.locator("[data-screen=emails]");
    const tabs = main.locator(".em-tab");
    await expect(tabs).toHaveCount(21);
    await test.step(`emails (${variant})`, async () => {
      if (variant === "light") {
        // Adminium's own sign-in email, as installed: a code, and the link shown with its token left out.
        await expect(main.locator(".em-head-subject")).toHaveText("Your sign-in link for Outline");
        await expect(main.locator(".em-code")).toHaveText("481 926");
        await expect(main.locator(".em-url")).toContainText("/apps/clients/customer/c#••••••");
      }
      await check(page, engine, "emails", variant);
    });
    await test.step(`emails-invoice (${variant})`, async () => {
      await tabs.nth(3).click();
      await expect(tabs.nth(3)).toHaveAttribute("aria-pressed", "true");
      if (variant === "light") {
        const subject = (await main.locator(".em-head-subject").textContent()) ?? "";
        const number = /INV-S\d+/.exec(subject)?.[0] ?? "";
        const invoice = invoices.find((i) => i["number"] === number)!;
        expect(subject).toBe(`${number} from Outline — ${usd(Number(invoice["total"]))}`);
        await expect(main.locator(".em-box")).toContainText(PAY);
        await expect(main.locator(".em-box")).toContainText(`Reference: ${number}`);
        await expect(main.locator(".em-rows")).toContainText(usd(Number(invoice["total"])));
      }
      await check(page, engine, "emails-invoice", variant);
    });
    await test.step(`emails-invoice-plain (${variant})`, async () => {
      await main.locator(".em-mode").nth(1).click();
      await expect(main.locator(".em-plain")).toBeVisible();
      await check(page, engine, "emails-invoice-plain", variant);
    });
    await test.step(`emails-invoice-narrow (${variant})`, async () => {
      await main.locator(".em-mode").nth(2).click();
      await expect(main.locator(".em-card--narrow")).toBeVisible();
      await check(page, engine, "emails-invoice-narrow", variant);
      await main.locator(".em-mode").nth(0).click();
    });
    await test.step(`emails-notice (${variant})`, async () => {
      await tabs.nth(13).click();
      await expect(main.locator(".em-plain")).toBeVisible();
      await expect(main.locator(".em-mode").nth(0)).toBeDisabled();
      if (variant === "light") await expect(main.locator(".em-head-row").nth(1)).toContainText(STUDIO);
      await check(page, engine, "emails-notice", variant);
    });
    await test.step(`emails-german (${variant})`, async () => {
      if (variant !== "light") return;
      await tabs.nth(1).click();
      await main.locator(".em-lang-select").selectOption("de-DE");
      await expect(main.locator(".em-card")).toHaveAttribute("lang", "de-DE");
      await expect(main.locator(".em-head-subject")).toContainText("Angebot");
      await check(page, engine, "emails-german", variant);
      await main.locator(".em-lang-select").selectOption("en-US");
    });

    if (variant === "light") {
      await test.step("a test goes to the studio's own address only, with no live link", async () => {
        await tabs.nth(3).click();
        const before = await stack.mail();
        await main.locator(".em-try button").nth(1).click();
        await expect(page.locator(".toasts")).toContainText(`Test sent to ${STUDIO}.`, { timeout: 30_000 });
        const subject = (await main.locator(".em-head-subject").textContent()) ?? "";
        let fresh: Awaited<ReturnType<Stack["mail"]>> = [];
        await expect
          .poll(async () => {
            fresh = (await stack.mail()).slice(before.length);
            return fresh.length;
          }, { timeout: 60_000 })
          .toBeGreaterThan(0);
        expect(fresh.map((m) => m.to)).toEqual([[STUDIO]]);
        expect(fresh[0]!.subject).toBe(subject);
        const body = `${fresh[0]!.text}\n${fresh[0]!.html ?? ""}`;
        expect(body).toContain(PAY);
        expect(body).not.toMatch(/\/[a-z]*#[A-Za-z0-9_-]{8,}/);
        for (const code of shareCodes) expect(body).not.toContain(code);
        for (const m of fresh) for (const to of m.to) expect(clientEmails).not.toContain(to);
        await check(page, engine, "emails-test-sent", variant);
      });
      await test.step("following an email's link opens the client's page as the studio's preview", async () => {
        await main.locator(".em-try button").nth(0).click();
        await expect(page.locator(".preview-bar")).toBeVisible({ timeout: 30_000 });
        await expect(screenOf(page, "client-invoice")).toBeVisible();
      });
    }
    await page.context().close();
  }
});
