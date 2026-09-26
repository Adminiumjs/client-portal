/**
 * MOVING HOURS AND PASSING PURCHASES ON, WHEN THE DRAFTS MOVED ON — IN A REAL
 * BROWSER, ON A BUILT ADMINIUM.
 *
 * One Adminium (the contract's harness, its clock at 10:00 on Tuesday
 * 28 July 2026), the Invoices & Receipts add-on and this app installed from
 * the built surfaces, the sample added. The desk does the moving; Adminium's
 * data API plays the other computer that changed the drafts in between:
 *
 *   a later move is a new action   hours moved onto a new draft, taken off it,
 *                                  the emptied draft given to another client —
 *                                  moved again, they go on a draft of their own
 *                                  client, never the other client's; a
 *                                  purchase passed on, taken off, its draft
 *                                  then sent with another purchase on it —
 *                                  passed on again, it goes on a new draft in
 *                                  one press, never refused as locked
 *   a voided invoice bills nothing  its hours and purchases say so, count as
 *                                  not invoiced, and move again in one press:
 *                                  the voided line lets go of them (and keeps
 *                                  everything else), and once billed again
 *                                  Adminium keeps their hours and cost as the
 *                                  new line bills them
 *
 * Screens open at their own addresses; nothing types an address or a password.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { ok, type Engine } from "../src/contract/harness.ts";
import { check, newContext, settle, SHOTS, SWEEPS } from "./browser.ts";
import { DESK, screenOf } from "./desk.ts";
import { stackUp, type Row, type Stack } from "./stack.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 5030);

let engine: Engine;
let stack: Stack;

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as Engine;
  stack = await stackUp(engine, PORT);
});

test.afterAll(async () => {
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "drafts-sweeps.json"), JSON.stringify(Object.fromEntries(SWEEPS), null, 1));
  await stack?.server.stop();
});

/** Adminium's data API, as the other computer: one row changed, removed, or read. */
const patch = async (ref: string, id: unknown, values: Record<string, unknown>) => ok(await stack.staff.patch(`${stack.data(ref)}/${String(id)}`, { values }));
const remove = async (ref: string, id: unknown) => ok(await stack.staff.send("DELETE", `${stack.data(ref)}/${String(id)}?confirm=true`));
const row = async (ref: string, id: unknown): Promise<Row> => (await stack.rows(ref)).find((r) => r.id === id)!;
/** The invoice the line carrying a row is on, as Adminium has it now. */
async function invoiceCarrying(column: "time_entry_id" | "expense_id", id: unknown): Promise<Row | undefined> {
  const line = (await stack.rows("invoice_lines")).find((l) => l[column] === id);
  return line === undefined ? undefined : row("invoices", line["document_id"]);
}
/** Sent, then voided: what a studio manager does with an invoice raised in error. */
async function sendAndVoid(invoiceId: unknown): Promise<void> {
  await patch("invoices", invoiceId, { status: "sent" });
  await patch("invoices", invoiceId, { status: "void", void_reason: "Raised in error" });
}

async function deskAt(browser: Browser, view: "time" | "expenses"): Promise<Page> {
  const context = await newContext(browser, stack.server.base, "light", stack.staff.cookies);
  const page = await context.newPage();
  await page.goto(DESK + view);
  await expect(screenOf(page, view)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(view === "time" ? "main .time-row" : ".ex-row").first()).toBeVisible({ timeout: 30_000 });
  await settle(page);
  return page;
}

const dialog = (page: Page) => page.locator("[role=dialog]");

test("hours moved again after their draft went to another client land on their own client's draft — and a voided invoice lets them go again", async ({ browser }, info) => {
  info.setTimeout(900_000);
  const projects = await stack.rows("projects");
  const vinyl = projects.find((p) => p["name"] === "Vinyl sleeve system")!;
  const entry = (await stack.rows("time_entries")).find((e) => e["project_id"] === vinyl.id && e["hours"] !== null)!;
  const other = (await stack.rows("clients")).find((c) => c.id !== vinyl["client_id"])!;

  const moveVinyl = async (page: Page) => {
    await page.locator("main .filters button").filter({ hasText: "Northlight Records" }).click();
    await expect(page.locator("main .time-row")).toHaveCount(1);
    await page.locator(".time-foot button").click();
    await dialog(page).locator(".btn--primary").click();
    await expect(page.locator(".toasts")).toContainText("onto a draft invoice.");
  };

  // Moved once: a new draft for Northlight Records.
  let page = await deskAt(browser, "time");
  await moveVinyl(page);
  const first = (await invoiceCarrying("time_entry_id", entry.id))!;
  expect([first["status"], first["client_id"]]).toEqual(["draft", vinyl["client_id"]]);
  await page.context().close();

  // Elsewhere: the line comes off, and the emptied draft is given to another client.
  const line = (await stack.rows("invoice_lines")).find((l) => l["time_entry_id"] === entry.id)!;
  await remove("invoice_lines", line.id);
  await patch("invoices", first.id, { client_id: other.id });

  // Moved again: a draft of Northlight's own, never the draft that is now another client's.
  page = await deskAt(browser, "time");
  await moveVinyl(page);
  const again = (await invoiceCarrying("time_entry_id", entry.id))!;
  expect(again.id).not.toBe(first.id);
  expect([again["status"], again["client_id"]]).toEqual(["draft", vinyl["client_id"]]);
  expect(await row("invoices", first.id)).toMatchObject({ client_id: other.id });
  expect((await stack.rows("invoice_lines")).filter((l) => l["document_id"] === first.id)).toHaveLength(0);
  await page.context().close();

  // Billed on a draft, the hours stay as the line bills them, whichever door is used.
  const kept = await stack.staff.patch(`${stack.data("time_entries")}/${String(entry.id)}`, { values: { logged_hours: "9" } });
  expect([kept.status, kept.code, String(kept.details["linkedFrom"]).endsWith("invoice_lines")]).toEqual([409, "RECORD_LOCKED", true]);

  // The invoice is sent and voided: the hours are billed nowhere, the page says so, and they can move again.
  await sendAndVoid(again.id);
  page = await deskAt(browser, "time");
  await page.locator("main .filters button").filter({ hasText: "Northlight Records" }).click();
  await expect(page.locator(".time-chip--void")).toHaveCount(1);
  await expect(page.locator(".time-chip--void")).toContainText("Invoice voided");
  await expect(page.locator(".time-foot")).toContainText("Not invoiced on Vinyl sleeve system");
  await expect(page.locator(".time-foot button")).toHaveText("Move onto an invoice");
  await check(page, engine, "time-voided", "light");
  // The voided line keeps everything but the link: its figures stay as they were billed.
  const voidedLine = (await stack.rows("invoice_lines")).find((l) => l["time_entry_id"] === entry.id)!;
  const figures = await stack.staff.patch(`${stack.data("invoice_lines")}/${String(voidedLine.id)}`, { values: { qty: "1" } });
  expect([figures.status, figures.code]).toEqual([409, "RECORD_LOCKED"]);

  // Moved again: the voided line lets go of the hours, and they go on a new draft of Northlight's.
  await page.locator(".time-foot button").click();
  await dialog(page).locator(".btn--primary").click();
  await expect(page.locator(".toasts")).toContainText("onto a draft invoice.");
  const third = (await invoiceCarrying("time_entry_id", entry.id))!;
  expect([third["status"], third["client_id"]]).toEqual(["draft", vinyl["client_id"]]);
  expect(third.id).not.toBe(again.id);
  expect(await row("invoice_lines", voidedLine.id)).toMatchObject({ document_id: again.id, time_entry_id: null });
  await expect(page.locator(".time-chip--void")).toHaveCount(0);
  // Billed again: kept again.
  const keptAgain = await stack.staff.patch(`${stack.data("time_entries")}/${String(entry.id)}`, { values: { logged_hours: "9" } });
  expect([keptAgain.status, keptAgain.code]).toEqual([409, "RECORD_LOCKED"]);
  await page.context().close();
});

test("a purchase passed on again after its draft went out with another one goes on a new draft in one press — and a voided invoice lets it go again", async ({ browser }, info) => {
  info.setTimeout(900_000);
  // A client with no draft of their own, and a project of theirs.
  const invoices = await stack.rows("invoices");
  const withDraft = new Set(invoices.filter((i) => i["status"] === "draft" && (i["from_quote_id"] ?? null) === null).map((i) => i["client_id"]));
  const northlight = (await stack.rows("projects")).find((p) => p["name"] === "Vinyl sleeve system")!["client_id"];
  const project = (await stack.rows("projects")).find((p) => p["status"] === "active" && !withDraft.has(p["client_id"]) && p["client_id"] !== northlight)!;
  expect(project, "a project whose client has no draft").toBeDefined();
  // Two purchases for it, marked to pass on (made elsewhere, as Adminium's form would).
  for (const what of ["Foil blocking die", "Courier, proofs to the client"]) {
    ok(await stack.staff.post(stack.data("expenses"), { values: { date: "2026-07-27", what, amount: what.startsWith("Foil") ? "64.00" : "18.00", project_id: project.id, rebill: true } }), 201);
  }
  const bought = (await stack.rows("expenses")).filter((e) => e["project_id"] === project.id && ["Foil blocking die", "Courier, proofs to the client"].includes(String(e["what"])));
  const die = bought.find((e) => e["what"] === "Foil blocking die")!;
  const courier = bought.find((e) => e["what"] !== "Foil blocking die")!;
  const tag = (page: Page, what: string) => page.locator(".ex-row").filter({ hasText: what }).locator(".ex-tag");

  const page = await deskAt(browser, "expenses");
  // The die, passed on alone: a new draft for the client.
  await tag(page, "Foil blocking die").click();
  await expect(tag(page, "Foil blocking die")).toHaveText("Passed on");
  const draft = (await invoiceCarrying("expense_id", die.id))!;
  expect([draft["status"], draft["client_id"]]).toEqual(["draft", project["client_id"]]);

  // Taken off the draft here, the courier passed on (it goes on that same draft), and the draft sent elsewhere.
  await page.locator(".ex-row").filter({ hasText: "Foil blocking die" }).locator(".ex-what").click();
  await page.locator(".sheet .ex-sh-standing button").click();
  await page.locator(".sheet .ex-sh-confirm .btn--danger").click();
  await expect(page.locator(".sheet .ex-sh-standing--to-pass-on")).toBeVisible();
  await page.keyboard.press("Escape");
  await tag(page, "Courier, proofs to the client").click();
  await expect(tag(page, "Courier, proofs to the client")).toHaveText("Passed on");
  expect((await invoiceCarrying("expense_id", courier.id))!.id).toBe(draft.id);
  await patch("invoices", draft.id, { status: "sent" });

  // The die, passed on again — one press, no refusal: a new draft, never the sent one.
  await tag(page, "Foil blocking die").click();
  await expect(tag(page, "Foil blocking die")).toHaveText("Passed on");
  await expect(page.locator(".ex-problem")).toHaveCount(0);
  const again = (await invoiceCarrying("expense_id", die.id))!;
  expect(again.id).not.toBe(draft.id);
  expect([again["status"], again["client_id"]]).toEqual(["draft", project["client_id"]]);
  await page.context().close();

  // On the sent invoice, the courier's cost stays as it was billed.
  const kept = await stack.staff.patch(`${stack.data("expenses")}/${String(courier.id)}`, { values: { amount: "20.00" } });
  expect([kept.status, kept.code, kept.details["column"], String(kept.details["linkedFrom"]).endsWith("invoice_lines")]).toEqual([409, "RECORD_LOCKED", "amount", true]);

  // The sent invoice is voided: the courier was never charged, the page says so, and Pass on offers it again.
  await patch("invoices", draft.id, { status: "void", void_reason: "Raised in error" });
  const after = await deskAt(browser, "expenses");
  await expect(tag(after, "Courier, proofs to the client")).toHaveText("Invoice voided");
  await expect(tag(after, "Foil blocking die")).toHaveText("Passed on");
  // It counts with what is still to pass on (the sample's $762.90 and the $18.00 courier), and Pass on takes all six.
  await expect(after.locator('[data-kpi="to-pass-on"]')).toContainText("$780.90");
  await expect(after.locator(".ex-foot button")).toHaveText("Pass on 6");
  await tag(after, "Courier, proofs to the client").click();
  await expect(after.locator(".sheet")).toContainText("which was voided: nothing was charged for it");
  await check(after, engine, "expenses-sheet-voided", "light");
  // Passed on from its sheet: the voided line lets go of it, and it joins the die on the client's draft.
  await after.locator(".sheet .ex-sh-standing .btn--primary").click();
  await expect(tag(after, "Courier, proofs to the client")).toHaveText("Passed on");
  const rebilled = (await invoiceCarrying("expense_id", courier.id))!;
  expect(rebilled.id).toBe(again.id);
  const voidedLine = (await stack.rows("invoice_lines")).find((l) => l["document_id"] === draft.id && l["description"] === "Courier, proofs to the client")!;
  expect(voidedLine["expense_id"]).toBeNull();
  await after.keyboard.press("Escape");
  await expect(after.locator(".ex-foot button")).toHaveText("Pass on 5");
  await check(after, engine, "expenses-voided", "light");
  await after.context().close();
});
