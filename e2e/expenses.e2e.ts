/**
 * EXPENSES AND SUPPLIERS IN A REAL BROWSER, ON A BUILT ADMINIUM.
 *
 * One Adminium (the contract's harness, its clock at 10:00 on Tuesday
 * 28 July 2026), the Invoices & Receipts add-on and this app installed from
 * the built surfaces, the sample added — then every state of the two screens
 * in light, dark, Arabic (right to left) and at phone width, each shot
 * full-page and swept by axe, with the sample's figures at that moment:
 *
 *   Expenses    $762.90 to put on an invoice (5 purchases), $300.00 already
 *               passed on, $29.00 ours; 7 · 5 · 1 · 1 under the filters;
 *               "Pass on 5"
 *   Suppliers   $1,091.90 through 6 of 7 names this year; Bell Type Foundry
 *               the biggest at $420.00; 1 never used; Kestrel Press $386.40
 *
 * And what the screens write, read back from Adminium: a purchase with its
 * receipt (the file first), "Pass on" — one line per purchase at its stored
 * cost on each client's draft, each line under its own key, the drafts'
 * totals Adminium's — a line taken off a draft, a supplier added, marked and
 * noted, and a refusal worded.
 *
 * These two screens have no path of their own until they are switched on in
 * the sidebar, so the walk opens them by setting the desk's own screen (the
 * same store the sidebar sets) — never by typing an address or a password.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import type { MessageKey } from "../src/i18n/messages/index.ts";
import type { Engine } from "../src/contract/harness.ts";
import { check, newContext, settle, SHOTS, SWEEPS, VARIANTS, type Variant } from "./browser.ts";
import { DESK, screenOf } from "./desk.ts";
import { stackUp, type Row, type Stack } from "./stack.ts";
import { localeOf, say } from "./words.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 5020);

let engine: Engine;
let stack: Stack;

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as Engine;
  stack = await stackUp(engine, PORT);
});

test.afterAll(async () => {
  // Every sweep of this spec, for the report: `<engine>/<state>-<variant>` → passes and violations.
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "expenses-sweeps.json"), JSON.stringify(Object.fromEntries(SWEEPS), null, 1));
  await stack?.server.stop();
});

/** Open one of the desk's screens at its own address. */
async function showView(page: Page, view: "expenses" | "suppliers"): Promise<void> {
  await page.goto(DESK + view);
  await expect(screenOf(page, view)).toBeVisible({ timeout: 30_000 });
}

/** A signed-in desk page in one variant. */
async function deskPage(browser: Browser, variant: Variant) {
  const context = await newContext(browser, stack.server.base, variant, stack.staff.cookies);
  const page = await context.newPage();
  await page.goto(DESK);
  return { context, page, word: (key: MessageKey, params?: Record<string, string | number>) => say(localeOf(variant), key, params) };
}

/** Wait until the list has read its purchases (the loading line is gone and the rows are drawn). */
async function purchasesDrawn(page: Page): Promise<void> {
  await expect(page.locator(".ex-row").first()).toBeVisible({ timeout: 30_000 });
  await settle(page);
}

const kpi = (page: Page, key: string) => page.locator(`[data-kpi="${key}"]`);

test("Expenses and Suppliers — every state, light, dark, Arabic, phone — with the sample's figures at 28 July", async ({ browser }, info) => {
  info.setTimeout(1_800_000);
  for (const variant of VARIANTS) {
    const { context, page, word } = await deskPage(browser, variant);
    const shoot = (name: string) => test.step(`${name} (${variant})`, async () => void (await check(page, engine, name, variant)));

    // ── Expenses ──
    await showView(page, "expenses");
    await purchasesDrawn(page);
    if (variant === "light") {
      await expect(kpi(page, "to-pass-on")).toContainText("$762.90");
      await expect(kpi(page, "to-pass-on")).toContainText("5 purchases waiting");
      await expect(kpi(page, "passed-on")).toContainText("$300.00");
      await expect(kpi(page, "ours")).toContainText("$29.00");
      const chips = page.locator(".filters .filter");
      await expect(chips).toHaveText(["Everything7", "To pass on5", "Passed on1", "Ours1"]);
      await expect(page.locator(".ex-row")).toHaveCount(7);
      await expect(page.locator(".ex-row").first()).toContainText("Bell Grotesk");
      await expect(page.locator(".ex-row").first()).toContainText("$420.00");
      await expect(page.locator(".ex-foot")).toContainText("$762.90");
      await expect(page.locator(".ex-foot button")).toHaveText("Pass on 5");
      await expect(page.locator('.ex-row[data-number="EX-S040"] .ex-tag')).toHaveText("Passed on");
      await expect(page.locator('.ex-row[data-number="EX-S042"] .ex-tag')).toHaveText("Ours");
    }
    await shoot("expenses");

    // A filter.
    await page.locator(".filters .filter").nth(1).click();
    await expect(page.locator(".ex-row")).toHaveCount(5);
    await shoot("expenses-to-pass-on");
    await page.locator(".filters .filter").nth(0).click();

    // The form, and what it says before anything is sent.
    await page.locator(".ex-add").click();
    await expect(page.locator(".ex-form")).toBeVisible();
    await shoot("expenses-form");
    await page.locator(".ex-form button[type=submit]").click();
    await expect(page.locator(".ex-form-err")).toHaveText(word("expenses.form.needWhat"));
    await shoot("expenses-form-error");
    await page.locator(".ex-form .btn:not(.btn--primary)").click();

    // A purchase waiting to be passed on, and one already on a sent invoice.
    await page.locator('.ex-row[data-number="EX-S045"] .ex-what').click();
    await expect(page.locator(".sheet .ex-sh-standing--to-pass-on")).toBeVisible();
    await shoot("expenses-sheet-waiting");
    await page.keyboard.press("Escape");
    await page.locator('.ex-row[data-number="EX-S040"] .ex-what').click();
    await expect(page.locator(".sheet .ex-sh-standing--passed-on")).toContainText("INV-S2031");
    await shoot("expenses-sheet-sent");
    await page.keyboard.press("Escape");

    // ── Suppliers ──
    await showView(page, "suppliers");
    await expect(page.locator(".sup-row").first()).toBeVisible({ timeout: 30_000 });
    await settle(page);
    if (variant === "light") {
      await expect(kpi(page, "spent")).toContainText("$1,091.90");
      await expect(kpi(page, "spent")).toContainText("across 6 of 7 names, this year");
      await expect(kpi(page, "biggest")).toContainText("Bell Type Foundry");
      await expect(kpi(page, "biggest")).toContainText("$420.00 · fonts");
      await expect(kpi(page, "never")).toContainText("1");
      await expect(page.locator(".sup-bar-row").first()).toContainText("Fonts");
      await expect(page.locator(".sup-bar-row").first()).toContainText("$600.00");
      await expect(page.locator(".sup-row").filter({ hasText: "Kestrel Press" })).toContainText("$386.40");
      await expect(page.locator(".sup-row").filter({ hasText: "Pike & Vane" })).toContainText("never used yet");
      await expect(page.locator(".sup-card")).toContainText("Kestrel Press");
      await expect(page.locator(".sup-bought")).toContainText("$386.40");
    }
    await shoot("suppliers");

    // A kind, from its bar.
    await page.locator(".sup-bar-row").first().click();
    await expect(page.locator(".sup-row")).toHaveCount(2);
    await shoot("suppliers-fonts");
    await page.locator(".sup-bar-row").first().click();

    // A name never used.
    await page.locator(".sup-row").filter({ hasText: "Pike & Vane" }).click();
    await expect(page.locator(".sup-bought")).toContainText("Pike & Vane");
    await shoot("suppliers-never-used");

    // "A new name", refused without one.
    await page.locator(".sup-add").click();
    await expect(page.locator(".sup-form")).toBeVisible();
    await page.locator(".sup-form button[type=submit]").click();
    await expect(page.locator(".sup-form .ex-form-err")).toHaveText(word("suppliers.form.needName"));
    await shoot("suppliers-form-error");
    await context.close();
  }
});

test("what the screens write: a purchase with its receipt, Pass on at cost, a line taken off a draft, a supplier", async ({ browser }, info) => {
  info.setTimeout(900_000);
  const { context, page } = await deskPage(browser, "light");
  await showView(page, "expenses");
  await purchasesDrawn(page);
  const projects = await stack.rows("projects");
  const prj = projects.find((p) => p["number"] === "PRJ-S01")!;

  // A purchase for PRJ-S01, with its receipt.
  await page.locator(".ex-add").click();
  await page.locator(".ex-fld--what input").fill("Proof prints, six sheets");
  await page.locator(".ex-fld--cost input").fill("48.00");
  await page.locator(".ex-fld--for select").selectOption(String(prj.id));
  await page.locator(".ex-fld--supplier select").selectOption({ label: "Kestrel Press" });
  await page.locator(".ex-file-input").setInputFiles({ name: "proofs.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });
  await page.locator(".ex-form button[type=submit]").click();
  await expect(page.locator(".toast").last()).toContainText("$48.00 to go on");
  await expect(page.locator(".ex-row")).toHaveCount(8);
  const made = (await stack.rows("expenses")).find((e) => e["what"] === "Proof prints, six sheets")!;
  expect(made).toMatchObject({ project_id: prj.id, client_id: prj["client_id"], rebill: true, date: "2026-07-28" });
  // The cost as typed (an engine may spell 48.00 as 48).
  expect(Number(made["amount"])).toBe(48);
  expect(String(made["number"])).toMatch(/^EX-\d{3}$/);
  expect(made["receipt"]).toBeTruthy();
  expect(made["client_key"]).toBeTruthy();
  await expect(kpi(page, "to-pass-on")).toContainText("$810.90");
  await check(page, engine, "expenses-added", "light");

  // The sheet names the receipt Adminium keeps.
  await page.locator(".ex-row").filter({ hasText: "Proof prints, six sheets" }).locator(".ex-what").click();
  await expect(page.locator(".sheet .ex-sh-link")).toContainText("proofs.pdf");
  await page.keyboard.press("Escape");

  // Pass on the six waiting.
  const before = await stack.rows("invoices");
  await expect(page.locator(".ex-foot button")).toHaveText("Pass on 6");
  await page.locator(".ex-foot button").click();
  await expect(page.locator(".toast").last()).toContainText("$810.90 added at cost to");
  await expect(kpi(page, "to-pass-on")).toContainText("$0.00");
  await expect(kpi(page, "passed-on")).toContainText("$1,110.90");
  await expect(page.locator(".ex-foot button")).toHaveText("All clear");
  await check(page, engine, "expenses-passed-on", "light");

  const expenses = await stack.rows("expenses");
  const lines = (await stack.rows("invoice_lines")).filter((l) => l["expense_id"] !== null && l["expense_id"] !== undefined);
  const invoices = await stack.rows("invoices");
  const waiting = expenses.filter((e) => e["rebill"] === true && e["number"] !== "EX-S040");
  expect(waiting).toHaveLength(6);
  for (const e of waiting) {
    const carried = lines.filter((l) => l["expense_id"] === e.id);
    expect(carried, String(e["number"])).toHaveLength(1);
    const line = carried[0]!;
    // At cost: the purchase's stored amount, once; the line's amount is Adminium's.
    expect([Number(line["rate"]), Number(line["qty"]), Number(line["amount"])]).toEqual([Number(e["amount"]), 1, Number(e["amount"])]);
    expect(line["client_key"]).toBeTruthy();
    const invoice = invoices.find((i) => i.id === line["document_id"])!;
    expect([invoice["status"], invoice["client_id"], invoice["from_quote_id"] ?? null]).toEqual(["draft", e["client_id"], null]);
  }
  expect(new Set(lines.map((l) => l["client_key"])).size).toBe(lines.length);
  // The drafts' totals are Adminium's: each subtotal is its lines' amounts.
  const newDrafts = invoices.filter((i) => !before.some((b) => b.id === i.id));
  expect(newDrafts.length).toBeGreaterThan(0);
  for (const draft of newDrafts) {
    expect(draft["title"]).toBe("Purchases at cost");
    const all = (await stack.rows("invoice_lines")).filter((l) => l["document_id"] === draft.id);
    expect(Number(draft["subtotal"])).toBeCloseTo(all.reduce((s, l) => s + Number(l["amount"]), 0), 2);
  }

  // Take one line off its draft: the purchase waits again.
  await page.locator(".ex-row").filter({ hasText: "Bell Grotesk" }).locator(".ex-what").click();
  await page.locator(".sheet .ex-sh-standing button").click();
  await check(page, engine, "expenses-sheet-take-off", "light");
  await page.locator(".sheet .ex-sh-confirm .btn--danger").click();
  await expect(page.locator(".sheet .ex-sh-standing--to-pass-on")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(kpi(page, "to-pass-on")).toContainText("$420.00");
  const bell = expenses.find((e) => String(e["what"]).startsWith("Bell Grotesk"))!;
  expect((await stack.rows("invoice_lines")).filter((l) => l["expense_id"] === bell.id)).toHaveLength(0);

  // A purchase on a sent invoice cannot come off: its sheet only opens the invoice.
  await page.locator('.ex-row[data-number="EX-S040"] .ex-what').click();
  await expect(page.locator(".sheet .ex-sh-standing button")).toContainText("INV-S2031");
  await page.keyboard.press("Escape");

  // ── Suppliers ──
  await showView(page, "suppliers");
  await expect(page.locator(".sup-row").first()).toBeVisible({ timeout: 30_000 });
  // Kestrel Press now carries the new purchase too.
  await expect(page.locator(".sup-row").filter({ hasText: "Kestrel Press" })).toContainText("$434.40");
  await page.locator(".sup-add").click();
  const fields = page.locator(".sup-form input");
  await fields.nth(0).fill("Ardent Bindery");
  await page.locator(".sup-form select").selectOption("finishing");
  await fields.nth(1).fill("Mara");
  await fields.nth(2).fill("mara@ardentbindery.example");
  await page.locator(".sup-form button[type=submit]").click();
  await expect(page.locator(".toast").last()).toContainText("Ardent Bindery is in the book.");
  await expect(page.locator(".sup-card")).toContainText("Ardent Bindery");
  let ardent: Row = (await stack.rows("suppliers")).find((s) => s["name"] === "Ardent Bindery")!;
  expect(ardent).toMatchObject({ kind: "finishing", contact: "Mara", email: "mara@ardentbindery.example", would_use_again: true });
  expect(String(ardent["number"])).toMatch(/^SUP-\d{2}$/);
  await expect(kpi(page, "never")).toContainText("2");

  // Would use again, and what to remember.
  await page.locator(".sup-again").click();
  await expect(page.locator(".sup-again")).toHaveAttribute("aria-pressed", "false");
  await page.locator("#sup-note").fill("Hand-sewn only. Ask Mara for the linen sample book.");
  await page.locator("#sup-note").blur();
  await expect(page.locator("#sup-note-state")).toHaveText("Saved.");
  ardent = (await stack.rows("suppliers")).find((s) => s["name"] === "Ardent Bindery")!;
  expect(ardent).toMatchObject({ would_use_again: false, note: "Hand-sewn only. Ask Mara for the linen sample book." });
  await check(page, engine, "suppliers-added", "light");

  // A name purchases mention stays in the book: the refusal, worded.
  await page.locator(".sup-row").filter({ hasText: "Kestrel Press" }).click();
  await page.locator(".sup-act--icon").click();
  await page.locator(".sup-remove").click();
  await page.locator(".sup-remove").click();
  await expect(page.locator(".sup-form .ex-form-err")).toHaveText("Purchases name them, so they stay in the book.");
  await check(page, engine, "suppliers-remove-refused", "light");
  expect((await stack.rows("suppliers")).some((s) => s["name"] === "Kestrel Press")).toBe(true);
  await context.close();
});

test("the money words: nothing on these pages says billing", async ({ browser }) => {
  const { context, page } = await deskPage(browser, "light");
  for (const view of ["expenses", "suppliers"] as const) {
    await showView(page, view);
    await settle(page);
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/billing|rebill/i);
  }
  await context.close();
});

