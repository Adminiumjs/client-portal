/**
 * THE CLIENT PORTAL IN A REAL BROWSER, ON A BUILT ADMINIUM, PER ENGINE.
 *
 * The Playwright project names the engine (`sqlite`, `postgres`, `mysql`).
 * One Adminium is booted for it by the contract's harness at 10:00 on
 * Tuesday 28 July 2026, the Invoices & Receipts add-on and this app (its
 * built surfaces) are installed, the sample is added — and then every screen
 * of the studio's desk and of the clients' side, the dead ends included, is
 * opened as a person opens it, in light, dark, Arabic and at phone width:
 * shot full-page and swept by axe (WCAG 2.0/2.1 A and AA).
 *
 * Beside the sweeps, what a browser can check of what the app promises:
 *   - the Overview and the desk's Home show the sample's figures at that
 *       moment; Chasing lists the seeded reminders;
 *   - every total, tax, paid and balance shown is the stored one;
 *   - accept-and-sign stores the typed name, the email, the terms version
 *       and a fingerprint that works out again; an out-of-date proposal
 *       cannot be accepted;
 *   - the handover link opens only its handover; stopping it closes it;
 *   - the printed documents carry the number, both parties, how to pay and
 *       the amount due, and Arabic prints right to left;
 *   - no demo wording, card fields or "billing" on any rendered page.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Browser, type Page } from "@playwright/test";

import { overview } from "../src/demo/figures.ts";
import { fingerprint, type HashOf } from "../src/demo/fingerprint.ts";
import { placesOf } from "../src/demo/engine.ts";
import { DEMO_RULES } from "../src/demo/rules.ts";
import { COPY_DENY_LIST } from "../src/demo/denyList.ts";
import { DEMO_MESSAGES } from "../src/demo/strings.ts";
import { DEMO_CURRENCY } from "../src/demo/sample.ts";
import { DEMO_START, DEMO_ZONE } from "../src/lib/clock.ts";
import { dayLabel } from "../src/lib/dates.ts";
import { Caller, ok, solve, until, type Engine } from "../src/contract/harness.ts";
import { check, newContext, settle, SHOTS, SWEEPS, VARIANTS, type Variant } from "./browser.ts";
import { Desk, DESK, deskStops, screenOf } from "./desk.ts";
import { become, Portal, PORTAL, portalStops } from "./portal.ts";
import { stackUp, type Row, type Stack } from "./stack.ts";
import { readColumn } from "./sourceDb.ts";
import { say } from "./words.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 4961);
/** When this run began (the config stamps it once for every worker), so a stale sweeps file is started afresh. */
const RUN_STARTED = Number(process.env["E2E_RUN_STARTED"] ?? Date.now());
const AMARA = { email: "amara@hearthandloaf.example", company: "Hearth & Loaf" };
const CLEO = { email: "cleo@marigoldlane.example", name: "Cleo Nkemdi" };
/** Where the handover goes: an address the outbox will send to (it skips the sample's reserved `.example`). */
const MILO = "milo@foldandrule.dev";
const PAY = "Bank transfer to Outline Studio · account 0123 4567 · quote the invoice number";
const SPEC = (DEMO_RULES.stamps["proposals"]!.find((s) => s.column === "fingerprint")!.set as { hashOf: HashOf }).hashOf;

const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
/** A figure as the Overview's cards draw it: whole units from a thousand up (Adminium's widget format). */
const card = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: Math.abs(n) >= 1000 ? 0 : 2 }).format(n);

let engine: Engine;
let stack: Stack;
/** Every English page's words, for the check that no demo wording reached a real build. */
const pages = new Map<string, string>();
/** Every form field's autofill hint, for the card-field check. */
const autofill = new Set<string>();

async function collect(page: Page, name: string): Promise<void> {
  pages.set(name, await page.evaluate(() => document.body.innerText));
  for (const hint of await page.evaluate(() => [...document.querySelectorAll("input, select, textarea")].map((e) => e.getAttribute("autocomplete") ?? ""))) autofill.add(hint);
}

/** The shot and the sweep, and the English text for the demo-wording check. */
async function shoot(page: Page, name: string, variant: Variant): Promise<void> {
  await check(page, engine, name, variant);
  if (variant !== "arabic") await collect(page, `${name}-${variant}`);
}

const byNumber = (rows: Row[], number: string) => rows.find((r) => r["number"] === number)!;

/** A client's sign-in link, asked for on the Find page and read from the SMTP sink. */
async function askForLink(page: Page, email: string): Promise<string> {
  const before = (await stack.mail()).length;
  await page.locator("input[type=email]").fill(email);
  await page.locator("[data-screen=client-find] form button[type=submit], [data-screen=client-find] button.btn--primary").first().click();
  await expect(page.locator("input[aria-label]").first()).toBeVisible({ timeout: 30_000 });
  const mail = await until(async () => (await stack.mail()).slice(before).find((m) => m.to.some((to) => to.includes(email)) && /\/c#/.test(m.text)), `${email}'s sign-in link`);
  return /(https?:\/\/\S+\/c#[A-Za-z0-9_-]+)/.exec(mail.text)![1]!;
}

/** A client signed in over HTTP (the page's session cannot be borrowed), as the contract signs one in. */
async function clientOverHttp(email: string) {
  const config = ok(await new Caller(stack.server.base).get<{ publishableKey: string }>(`${PORTAL}surface-config.json`));
  const guest = new Caller(stack.server.base, { authorization: `Bearer ${config.publishableKey}`, origin: stack.server.base });
  const challenge = ok(await guest.get<{ data: { id: string; salt: string; difficulty: number } }>("/api/v1/public/challenge?purpose=claim")).data;
  const before = (await stack.mail()).length;
  ok(await guest.post("/api/v1/public/claim/link", { email, lang: "en-US" }, { "x-adminium-proof": `${challenge.id}.${solve(challenge.salt, challenge.difficulty)}` }), 202);
  const mail = await until(async () => (await stack.mail()).slice(before).find((m) => m.to.some((to) => to.includes(email)) && /\/c#/.test(m.text)), `${email}'s link`);
  const token = /\/c#([A-Za-z0-9_-]{43})/.exec(mail.text)![1]!;
  const session = ok(await guest.post<{ data: { session: string } }>("/api/v1/public/claim/link/verify", { token })).data.session;
  return { guest, as: { "x-adminium-public-session": session } };
}

/** Each variant in a fresh browser: for pages that need no session. */
async function eachFresh(browser: Browser, name: string, open: (page: Page, variant: Variant) => Promise<void>, cookies?: string): Promise<void> {
  for (const variant of VARIANTS) {
    const context = await newContext(browser, stack.server.base, variant, cookies);
    const page = await context.newPage();
    await open(page, variant);
    await shoot(page, name, variant);
    await context.close();
  }
}

/** Shoot one signed-in client page in all four variants, in place, ending as it began (light). */
async function inPlace(page: Page, name: string): Promise<void> {
  for (const variant of VARIANTS) {
    await become(page, variant);
    await shoot(page, name, variant);
  }
  await become(page, "light");
}

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as Engine;
  stack = await stackUp(engine, PORT);
  // A studio that tells clients how to pay (the printed copy and the client's invoice both show it).
  ok(await stack.staff.put("/api/v1/add-ons/invoices/settings", { values: { payment_instructions: PAY } }));
});

test.afterAll(async () => {
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  // A failed test restarts the worker: each worker adds its sweeps to what the run already wrote.
  const file = join(dir, "sweeps.json");
  const earlier = existsSync(file) && statSync(file).mtimeMs >= RUN_STARTED ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  const mine = Object.fromEntries([...SWEEPS].filter(([key]) => key.startsWith(`${engine}/`)));
  writeFileSync(file, JSON.stringify({ ...earlier, ...mine }, null, 1));
  await stack?.server.stop();
});

test("the Overview shows the sample's figures at 10:00 on 28 July", async ({ browser }) => {
  const rows = Object.fromEntries(await Promise.all(Object.keys(stack.real).map(async (ref) => [ref, await stack.rows(ref)] as const)));
  const o = overview(rows, DEMO_START, DEMO_ZONE);
  expect(o.outstanding).toEqual({ amount: 6937.5, invoices: 4 });
  const context = await newContext(browser, stack.server.base, "light", stack.staff.cookies);
  const page = await context.newPage();
  await page.goto("/p/clients-overview");
  const tile = (id: string) => page.locator(`[data-grid-item="${id}"]`);
  await expect(tile("kpi-outstanding")).toContainText(card(o.outstanding.amount), { timeout: 30_000 });
  const expected: [string, string][] = [
    ["kpi-overdue", card(o.overdue.amount)],
    ["kpi-collected", card(o.collectedThisMonth.amount)],
    ["kpi-proposals", card(o.proposalsWaiting.amount)],
    ["kpi-active", String(o.projects.active)],
    ["kpi-paused", String(o.projects.paused)],
    ["kpi-done", String(o.projects.doneThisMonth)],
    ["owed-current", card(o.aging.notYetDue.amount)],
    ["owed-30", card(o.aging.days1to30.amount)],
    ["owed-60", card(o.aging.days31to60.amount)],
    ["owed-older", card(o.aging.over60.amount)],
    ["needs-chase", String(o.needs.chaseReady.length)],
    ["needs-paid", String(o.needs.clientSaysPaid.length)],
    ["needs-changes", String(o.needs.changesAsked.length)],
    ["needs-enquiries", String(o.needs.newEnquiries)],
  ];
  for (const [id, value] of expected) await expect.soft(tile(id), id).toContainText(value);
  await settle(page);
  // Adminium's own page: shot and swept for the report, not held to this app's gate.
  mkdirSync(join(SHOTS, engine), { recursive: true });
  await page.screenshot({ path: join(SHOTS, engine, "overview-light.png"), fullPage: true });
  await context.close();
});

test("every desk screen — light, dark, Arabic, phone — with the Home and Chasing figures and every amount as stored", async ({ browser }, info) => {
  info.setTimeout(1_800_000);
  const rows = Object.fromEntries(await Promise.all(Object.keys(stack.real).map(async (ref) => [ref, await stack.rows(ref)] as const)));
  const o = overview(rows, DEMO_START, DEMO_ZONE);
  const invoices = rows["invoices"]!;
  const payments = rows["payments"]!;
  const main = (d: Desk) => d.page.locator("main");

  const stops = deskStops({
    home: async (d) => {
      const text = main(d);
      await expect(text).toContainText(usd(o.outstanding.amount));
      await expect(text).toContainText(`Across ${String(o.outstanding.invoices)} open invoices`);
      await expect(text).toContainText(`Oldest is ${String(o.overdue.oldestDays)} days past due`);
      for (const bucket of [o.aging.notYetDue, o.aging.days1to30, o.aging.days31to60, o.aging.over60]) await expect(text).toContainText(usd(bucket.amount));
      await expect(text).toContainText(`${String(o.projects.paused)} paused · ${String(o.projects.doneThisMonth)} done`);
    },
    chasing: async (d) => {
      // Every open invoice, with the rungs the sample seeded: the one ready waits on the studio.
      const owing = invoices.filter((i) => i["status"] === "sent" && Number(i["balance"]) > 0);
      for (const invoice of owing) await expect(main(d).locator("button").filter({ hasText: String(invoice["number"]) })).toHaveCount(1);
      const rungs = rows["messages"]!.filter((m) => String(m["kind"]).startsWith("invoice-rung-"));
      for (const invoice of owing) expect(rungs.filter((m) => m["invoice_id"] === invoice.id), String(invoice["number"])).toHaveLength(3);
      expect(o.needs.chaseReady).toEqual([{ invoice: "INV-S2038", client: "Fold & Rule", daysLate: 12, rung: "invoice-rung-1" }]);
      await expect(main(d).locator("button").filter({ hasText: "INV-S2038" })).toContainText("waiting on you");
      await expect(main(d).locator("button").filter({ hasText: "INV-S2037" })).toContainText("All three sent");
    },
    invoices: async (d) => {
      for (const invoice of invoices) {
        const row = main(d).locator("button").filter({ hasText: String(invoice["number"]) }).first();
        await expect.soft(row, String(invoice["number"])).toContainText(usd(Number(invoice["total"])));
        if (invoice["status"] === "sent" && Number(invoice["balance"]) > 0 && Number(invoice["balance"]) !== Number(invoice["total"])) await expect.soft(row).toContainText(usd(Number(invoice["balance"])));
      }
    },
    invoice: async (d, number) => {
      const invoice = byNumber(invoices, number);
      const shown = main(d);
      for (const column of ["subtotal", "tax", "total"]) await expect.soft(shown, `${number} ${column}`).toContainText(usd(Number(invoice[column])));
      for (const payment of payments.filter((p) => p["document_id"] === invoice.id)) await expect.soft(shown, `${number} ${String(payment["number"])}`).toContainText(usd(Number(payment["amount"])));
      if (invoice["status"] === "sent" && Number(invoice["balance"]) > 0) await expect.soft(shown, `${number} balance`).toContainText(usd(Number(invoice["balance"])));
      expect(Number(invoice["paid"])).toBe(payments.filter((p) => p["document_id"] === invoice.id && p["voided"] !== true).reduce((sum, p) => sum + Number(p["amount"]), 0));
    },
  });

  for (const variant of VARIANTS) {
    const context = await newContext(browser, stack.server.base, variant, stack.staff.cookies);
    const page = await context.newPage();
    const desk = new Desk(page, variant);
    await page.goto(DESK);
    for (const stop of stops) {
      if (stop.phoneOnly === true && variant !== "phone") continue;
      await test.step(`${stop.name} (${variant})`, async () => {
        await stop.go(desk);
        if (variant === "light" && stop.light !== undefined) await stop.light(desk);
        await shoot(page, stop.name, variant);
      });
    }
    await context.close();
  }
});

test("the printed documents — number, both parties, how to pay, amount due; Arabic right to left", async ({ browser }) => {
  const printed = async (variant: Variant, open: (d: Desk) => Promise<void>, name: string) => {
    const context = await newContext(browser, stack.server.base, variant, stack.staff.cookies);
    const page = await context.newPage();
    const desk = new Desk(page, variant);
    await page.goto(DESK);
    await desk.shows("home");
    await open(desk);
    const frame = page.locator("[data-screen=print] iframe");
    await expect(frame).toHaveAttribute("src", /\/api\/v1\/documents\/.+\/print/, { timeout: 60_000 });
    const src = (await frame.getAttribute("src"))!;
    const reply = await page.request.get(src);
    expect(reply.status()).toBe(200);
    // Served to draw in the frame (inline, sandboxed), never as a download that leaves the frame blank.
    expect(reply.headers()["content-disposition"] ?? "").toMatch(/^inline/);
    expect(reply.headers()["content-security-policy"] ?? "").toContain("sandbox");
    const html = await reply.text();
    // … and the desk's own frame draws it.
    const number = /<title>[^<]*?([A-Z]+-S?\d+)/.exec(html)?.[1] ?? "";
    expect(number, "the printed copy names its document").not.toBe("");
    await expect(page.frameLocator("[data-screen=print] iframe").locator("body")).toContainText(number, { timeout: 30_000 });
    mkdirSync(join(SHOTS, engine), { recursive: true });
    await page.screenshot({ path: join(SHOTS, engine, `printed-${name}-${variant}.png`), fullPage: true });
    await context.close();
    return html.replace(/&amp;/g, "&").replace(/&#39;|&#x27;/g, "'");
  };
  const toInvoice = (number: string) => async (d: Desk) => (await d.nav("invoices"), await d.row(number, "invoice"), d.press("invoices.page.print", "print"));

  const invoice = await printed("light", toInvoice("INV-S2039"), "invoice");
  for (const words of ["INV-S2039", "Outline", "hello@outline.example", "Hearth & Loaf", "Amara Okafor", AMARA.email, PAY, "Amount due", usd(1621), usd(2821)]) expect.soft(invoice, words).toContain(words);

  const quote = await printed("light", async (d) => (await d.nav("proposals"), await d.row("QUO-S1138", "proposal"), d.press("invoices.page.print", "print")), "quote");
  for (const words of ["QUO-S1138", "Outline", "Hearth & Loaf", "Amara Okafor", usd(5642)]) expect.soft(quote, words).toContain(words);

  const arabic = await printed("arabic", toInvoice("INV-S2039"), "invoice");
  expect(arabic).toMatch(/<html[^>]*\bdir="rtl"/);
  expect(arabic).toMatch(/<html[^>]*\blang="ar/);
  for (const words of ["INV-S2039", "Hearth & Loaf", PAY]) expect.soft(arabic, words).toContain(words);
});

test("every client page and dead end — light, dark, Arabic, phone — signed in by the emailed link, every amount as stored", async ({ browser }, info) => {
  info.setTimeout(1_800_000);
  const invoices = await stack.rows("invoices");
  const foreign = byNumber(invoices, "INV-S2038");

  // Before anyone signs in: the Find page, and an address that names no page.
  await eachFresh(browser, "client-find", async (page) => {
    await page.goto(PORTAL);
    await expect(screenOf(page, "client-find")).toBeVisible();
  });
  await eachFresh(browser, "client-notfound-address", async (page) => {
    await page.goto(`${PORTAL}nowhere`);
    await expect(screenOf(page, "client-notfound")).toBeVisible();
  });

  const context = await newContext(browser, stack.server.base, "light");
  const page = await context.newPage();
  await page.goto(PORTAL);
  await expect(screenOf(page, "client-find")).toBeVisible();
  const link = await askForLink(page, AMARA.email);
  await inPlace(page, "client-check-email");

  // The link, landing on another client's invoice: it greets, then signs in, then says there is no such page.
  await page.goto(`${link}&to=invoices/${String(foreign.id)}`);
  await expect(screenOf(page, "client-link")).toBeVisible();
  await inPlace(page, "client-link");
  await page.locator("[data-screen=client-link] button").first().click();
  await expect(screenOf(page, "client-notfound")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("main")).not.toContainText("INV-S2038");
  await inPlace(page, "client-notfound");
  await page.locator("[data-screen=client-notfound] button").first().click();

  const portal = new Portal(page, "light");
  await portal.shows("client-home");
  const stops = portalStops({
    invoice: async (p, number) => {
      const row = byNumber(invoices, number);
      for (const column of ["subtotal", "tax", "total"]) await expect.soft(p.page.locator("main"), `${number} ${column}`).toContainText(usd(Number(row[column])));
      if (Number(row["balance"]) > 0) await expect.soft(p.page.locator("main"), `${number} balance`).toContainText(usd(Number(row["balance"])));
      if (number === "INV-S2039") await expect.soft(p.page.locator("main"), "how to pay").toContainText(PAY);
    },
  });
  for (const variant of VARIANTS) {
    portal.variant = variant;
    await become(page, variant);
    for (const stop of stops) {
      await test.step(`${stop.name} (${variant})`, async () => {
        await stop.go(portal);
        if (variant === "light" && stop.light !== undefined) await stop.light(portal);
        await shoot(page, stop.name, variant);
      });
    }
    await portal.home();
  }
  await become(page, "light");
  await context.close();

  // The same link again: used, so it opens nothing and offers a new one.
  await eachFresh(browser, "client-expired", async (fresh) => {
    await fresh.goto(link);
    await expect(screenOf(fresh, "client-expired")).toBeVisible({ timeout: 30_000 });
  });
});

test("the day an invoice falls due is the same day on the desk and on a client's page, in a browser east and west of UTC", async ({ browser }, info) => {
  info.setTimeout(600_000);
  const invoice = byNumber(await stack.rows("invoices"), "INV-S2039");
  const due = String(invoice["due_on"]);
  expect(due).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const words = dayLabel(due, "en-US", "long");
  // Fourteen hours ahead of UTC, and eleven behind: a day read through either zone would land on another.
  for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
    await test.step(zone, async () => {
      const deskContext = await newContext(browser, stack.server.base, "light", stack.staff.cookies, zone);
      const deskPage = await deskContext.newPage();
      await deskPage.goto(DESK);
      const desk = new Desk(deskPage, "light");
      await desk.nav("invoices");
      await desk.row("INV-S2039", "invoice");
      await expect(deskPage.locator(`main time[datetime="${due}"]`).first()).toHaveText(words);
      await deskContext.close();

      const context = await newContext(browser, stack.server.base, "light", undefined, zone);
      const page = await context.newPage();
      await page.goto(PORTAL);
      await expect(screenOf(page, "client-find")).toBeVisible();
      const link = await askForLink(page, AMARA.email);
      await page.goto(`${link}&to=invoices/${String(invoice.id)}`);
      await expect(screenOf(page, "client-link")).toBeVisible();
      await page.locator("[data-screen=client-link] button").first().click();
      await expect(page.locator("[data-screen=client-invoice][aria-labelledby]")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator("main")).toContainText(words);
      await context.close();
    });
  }
});

test("accept and sign stores the name, the email, the terms version and a fingerprint that works out again; an out-of-date proposal can't be accepted", async ({ browser }, info) => {
  info.setTimeout(900_000);
  // An out-of-date proposal for the same client: sent, its price held until yesterday.
  const late = ok(await stack.staff.post<{ data: Row }>(stack.data("proposals"), { values: { client_id: 3, title: "Window lettering", valid_until: "2026-07-27", status: "draft" } }), 201).data;
  ok(await stack.staff.post(stack.data("proposal_lines"), { values: { document_id: late.id, description: "Lettering, two windows", qty: "1", rate: "400", position: 0 } }), 201);
  ok(await stack.staff.patch(`${stack.data("proposals")}/${String(late.id)}`, { values: { status: "sent" } }));

  const context = await newContext(browser, stack.server.base, "light");
  const page = await context.newPage();
  await page.goto(PORTAL);
  const link = await askForLink(page, CLEO.email);
  await page.goto(link);
  await page.locator("[data-screen=client-link] button").first().click();
  const portal = new Portal(page, "light");
  await portal.shows("client-home");
  await portal.row("QUO-S1142", "client-proposal");
  await inPlace(page, "client-proposal-open");
  await portal.press("client.proposal.accept");
  await expect(page.locator(".cl-input-sign")).toBeVisible();
  await inPlace(page, "client-proposal-sign");
  await page.locator(".cl-input-sign").fill(CLEO.name);
  await page.locator(".cl-tick input[type=checkbox]").check();
  await page.locator(".cl-btn-sign").click();
  await expect(page.locator(".cl-btn-sign")).toHaveCount(0, { timeout: 30_000 });
  await settle(page);
  await inPlace(page, "client-proposal-signed");

  const held = Object.fromEntries(await Promise.all(Object.keys(stack.real).map(async (ref) => [ref, await stack.rows(ref)] as const)));
  const signed = byNumber(held["proposals"]!, "QUO-S1142");
  expect(signed).toMatchObject({ status: "accepted", signed_name: CLEO.name, signed_email: CLEO.email, accepted_how: "portal" });
  expect(signed["terms_version_id"]).not.toBeNull();
  expect(signed["fingerprint"]).toMatch(/^[0-9a-f]{64}$/);
  const again = fingerprint("proposals", signed, SPEC, {
    rows: (table) => held[table] ?? [],
    kind: (table, column) => DEMO_RULES.kinds[table]?.[column],
    places: (table, column, row) => placesOf(table, column, row, DEMO_CURRENCY),
  });
  expect(again).toBe(signed["fingerprint"]);

  // An open invoice of hers: "I've sent a payment" opens its little form.
  await portal.home();
  await portal.row("INV-S2040", "client-invoice");
  for (const variant of VARIANTS) {
    // Opened afresh in each variant: the header's switches are outside the little form and close it.
    portal.variant = variant;
    await become(page, variant);
    await portal.press("client.invoice.sentPayment");
    await expect(page.locator(".cl-pop")).toBeVisible();
    await shoot(page, "client-payment-sent", variant);
    await page.locator(".cl-pop-close").click();
  }
  portal.variant = "light";
  await become(page, "light");

  // The out-of-date one: no way to accept it on the page …
  await portal.home();
  await portal.row(String(late["number"]), "client-proposal");
  await expect(page.locator(".cl-stale")).toBeVisible();
  await expect(page.locator("main button").filter({ hasText: portal.word("client.proposal.accept") })).toHaveCount(0);
  await inPlace(page, "client-proposal-out-of-date");
  await context.close();

  // … nor over the wire, through the very door that accepted the other.
  const { guest, as } = await clientOverHttp(CLEO.email);
  const refs = ok(await guest.get<{ data: { refs: Record<string, { writable: string[] }> } }>("/api/v1/public/config", as)).data.refs;
  const accept = Object.entries(refs).find(([ref, r]) => ref.startsWith(stack.real["proposals"]!) && r.writable.includes("status") && r.writable.includes("signed_name") && !r.writable.includes("decline_note"))![0];
  const refused = await guest.patch(`/api/v1/public/records/${accept}/${String(late.id)}`, { values: { status: "accepted", signed_name: CLEO.name } }, as);
  expect(refused.status, JSON.stringify(refused.body)).toBeGreaterThanOrEqual(400);
  expect(byNumber(await stack.rows("proposals"), String(late["number"]))["status"]).toBe("sent");
});

test("the handover link opens only its handover, and stopping it closes it at once", async ({ browser }, info) => {
  info.setTimeout(900_000);
  const clients = await stack.rows("clients");
  const milo = clients.find((c) => c["company"] === "Fold & Rule")!;
  ok(await stack.staff.patch(`${stack.data("clients")}/${String(milo.id)}`, { values: { email: MILO } }));

  // The studio sends the handover from the desk; the link arrives in the sink.
  const staff = await newContext(browser, stack.server.base, "light", stack.staff.cookies);
  const deskPage = await staff.newPage();
  const desk = new Desk(deskPage, "light");
  await deskPage.goto(DESK);
  await desk.nav("projects");
  await desk.row("PRJ-S02", "project");
  await desk.press("projects.page.handover", "handover");
  await expect(deskPage.locator("main")).not.toContainText("#undefined");
  // A sample project has no code yet (the sample is added as history): the studio makes the link first.
  const project = byNumber(await stack.rows("projects"), "PRJ-S02");
  const codeNow = async () => (await readColumn(engine, PORT, stack.database, stack.real["projects"]!, "share_token", Number(project.id))) as string | null;
  if ((await codeNow()) === null) test.info().annotations.push({ type: "engine gap", description: "a sample project has no share code: the sample's rows get no code from the column's `code` rule" });
  // No address on the page (no code yet, or one Adminium keeps from the desk): the studio makes a link.
  if (await deskPage.locator(".ho-address--words").isVisible()) await desk.press("handover.link.renew");
  const code = await until(async () => (await codeNow()) ?? undefined, "the share code", 30_000);
  expect(code).toMatch(/^[A-Za-z0-9_-]{16}$/);
  // Where the desk can read the code, the address it offers to copy is that project's.
  const shown = deskPage.locator(".ho-address:not(.ho-address--words)");
  if (await shown.isVisible()) await expect(shown).toContainText(`/h#${code}`);
  else test.info().annotations.push({ type: "engine gap", description: "the desk cannot read the share code it made" });
  const before = (await stack.mail()).length;
  await desk.press("handover.send.action");
  const mail = await until(async () => (await stack.mail()).slice(before).find((m) => m.to.some((to) => to.includes(MILO)) && /\/h#/.test(m.text)), "the handover email", 240_000);
  const sent = /(https?:\/\/\S+\/h#)(\S+)/.exec(mail.text);
  expect(sent, mail.text).not.toBeNull();
  if (sent![2] !== code) {
    // Adminium hides a column named like a credential from the email's words too: the link goes out unfilled.
    test.info().annotations.push({ type: "engine gap", description: `the handover email's link reads "${sent![1]!}${sent![2]!}", not the project's code` });
  }
  const link = `${sent![1]!}${code}`;

  // It opens this project's handover, and nothing of any other.
  const others = (await stack.rows("projects")).filter((p) => p.id !== project.id).map((p) => String(p["name"]));
  await eachFresh(browser, "client-handover", async (page) => {
    await page.goto(link);
    await expect(screenOf(page, "client-handover")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("main")).toContainText(String(project["name"]));
    for (const name of others) await expect(page.locator("main")).not.toContainText(name);
  });
  // A code that is nobody's opens nothing.
  const visitor = await newContext(browser, stack.server.base, "light");
  const stranger = await visitor.newPage();
  await stranger.goto(link.replace(/#.*$/, "#AAAAAAAAAAAAAAAA"));
  await expect(screenOf(stranger, "client-notfound")).toBeVisible({ timeout: 30_000 });
  // A visitor holding the page open.
  const open = await visitor.newPage();
  await open.goto(link);
  await expect(screenOf(open, "client-handover").locator("h1")).toBeVisible({ timeout: 30_000 });

  // The studio stops it …
  await desk.press("handover.link.stop");
  await deskPage.locator("[role=dialog] .psh-danger").click();
  await expect(deskPage.locator(".ho-address--stopped")).toBeVisible({ timeout: 30_000 });
  await shootDesk(deskPage, "handover-stopped");
  await staff.close();

  // … and the very next look is refused.
  await open.reload();
  const stopped = say("en-US", "client.handover.stopped");
  await expect(open.locator("[data-screen=client-handover]")).toContainText(stopped, { timeout: 30_000 });
  await visitor.close();
  await eachFresh(browser, "client-handover-stopped", async (page, variant) => {
    await page.goto(link);
    await expect(screenOf(page, "client-handover")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-screen=client-handover]")).toContainText(say(variant === "arabic" ? "ar-EG" : "en-US", "client.handover.stopped"));
  });
});

/** A desk page shot in light only (a state reached by an action, not a screen of its own). */
async function shootDesk(page: Page, name: string): Promise<void> {
  await shoot(page, name, "light");
}

test("the clients' side switched off: not available", async ({ browser }) => {
  ok(await stack.staff.put("/api/v1/public-api", { enabled: false }));
  try {
    await eachFresh(browser, "client-notavailable", async (page) => {
      await page.goto(PORTAL);
      await expect(screenOf(page, "client-notavailable")).toBeVisible({ timeout: 30_000 });
    });
  } finally {
    ok(await stack.staff.put("/api/v1/public-api", { enabled: true }));
  }
});

/**
 * Over the English pages a test drew: no demo wording, no card fields and
 * no "billing". Run at the end of each test that draws pages (a failed test
 * restarts the worker, so nothing is carried from one test to the next).
 */
function noDemoWords(): void {
  const english = DEMO_MESSAGES["en-US"] as Record<string, string>;
  // The demo card's own phrases, and the wording no build may carry. ("11:04" and "(v3)" are left
  // to the build test: on a rendered page a real time or a real terms version may say them.)
  const deny = [
    ...["demo.clock.reset", "demo.do.sampleProposal", "demo.do.acceptsAndSigns", "demo.do.expireLink", "demo.fill.changesNote", "demo.fill.proposalTitle"].map((key) => english[key]).filter((v): v is string => v !== undefined),
    ...COPY_DENY_LIST.filter((phrase) => phrase !== "11:04" && phrase !== "(v3)"),
  ];
  expect(deny.length).toBeGreaterThan(6);
  expect(pages.size, "the demo-wording check read no page").toBeGreaterThan(0);
  const found: string[] = [];
  for (const [name, text] of pages) {
    for (const phrase of deny) if (text.includes(phrase)) found.push(`${name}: ${phrase}`);
    if (/billing/i.test(text)) found.push(`${name}: billing`);
    if (/card number|\bcvc\b|\bcvv\b|expiry date/i.test(text)) found.push(`${name}: a card field`);
  }
  for (const hint of autofill) if (hint.startsWith("cc-")) found.push(`autocomplete=${hint}`);
  expect.soft(found, "demo wording, card fields or billing").toEqual([]);
  pages.clear();
  autofill.clear();
}

test.afterEach(() => {
  if (pages.size > 0) noDemoWords();
});
