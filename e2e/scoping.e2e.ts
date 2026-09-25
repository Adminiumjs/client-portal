/**
 * THE SCOPING WORKSHEET IN A REAL BROWSER, ON A BUILT ADMINIUM.
 *
 * The same stack as the portal's pass (`stack.ts`: Adminium at 10:00 on
 * Tuesday 28 July 2026, the Invoices & Receipts add-on and this app installed,
 * the sample added), the studio signed in through the API's cookie. The
 * worksheet is opened as a person opens it — Proposals, then "Scope a stage" —
 * and walked through each of its states in light, dark, Arabic and at phone
 * width, each shot full-page and swept by axe (no violation of any impact):
 *
 *   empty       nothing on the sheet; the history of the sample's five
 *               finished stages, 2 % over on average
 *   refused     "Turn this into a proposal" on an empty sheet: who it is for
 *   worked      Slow Signal's podcast identity: six design days, a half day,
 *               twelve templates, two purchases at cost and one ours — the
 *               running estimate at the sample's figures
 *   reserve     the contingency on: a held quantity of each rate
 *
 * Then, once (light): "Turn this into a proposal" saves ONE draft whose
 * lines carry the rate card's own rates and quantities — the reserve as held
 * quantities of the same rates, no purchase, every line under a key of its
 * own — and whose subtotal, tax and total are Adminium's; the composer opens
 * on it.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { expect, test, type Page } from "@playwright/test";

import type { Engine } from "../src/contract/harness.ts";
import { check, newContext, SHOTS, VARIANTS, type Sweep, type Variant } from "./browser.ts";
import { Desk, DESK, screenOf } from "./desk.ts";
import { stackUp, type Row, type Stack } from "./stack.ts";

const PORT = Number(process.env["E2E_PORT"] ?? 5030);
const usd = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

let engine: Engine;
let stack: Stack;
const sweeps: Record<string, Sweep> = {};

test.beforeAll(async ({}, info) => {
  info.setTimeout(900_000);
  engine = info.project.metadata["engine"] as Engine;
  stack = await stackUp(engine, PORT);
});

test.afterAll(async () => {
  mkdirSync(join(SHOTS, engine), { recursive: true });
  writeFileSync(join(SHOTS, engine, "scoping-sweeps.json"), JSON.stringify(sweeps, null, 1));
  await stack?.server.stop();
});

/** Shoot and sweep a state; the worksheet is held to no violation at all, of any impact. */
async function shoot(page: Page, name: string, variant: Variant): Promise<void> {
  const result = await check(page, engine, name, variant);
  sweeps[`${name}-${variant}`] = result;
  expect.soft(result.passes, `${name} (${variant}) analysed nothing`).toBeGreaterThan(0);
  expect.soft(result.violations, `${name} (${variant})`).toEqual([]);
}

test("the scoping worksheet — every state, light, dark, Arabic, phone — at the sample's figures, and the draft it saves", async ({ browser }, info) => {
  info.setTimeout(1_800_000);
  const rates = (await stack.rows("rates")).sort((a, b) => Number(a["position"]) - Number(b["position"]));
  const rateId = (label: string) => rates.find((r) => r["label"] === label)!.id;
  const clients = await stack.rows("clients");
  const slow = clients.find((c) => c["company"] === "Slow Signal")!;

  for (const variant of VARIANTS) {
    const context = await newContext(browser, stack.server.base, variant, stack.staff.cookies);
    const page = await context.newPage();
    const desk = new Desk(page, variant);
    const main = page.locator("main");
    const sheet = screenOf(page, "scoping");
    await page.goto(DESK);

    await test.step(`empty (${variant})`, async () => {
      await desk.nav("proposals");
      await desk.press("scoping.fromProposals", "scoping");
      // The history is read: the sample's five finished stages.
      await expect(sheet.locator(".scope-past")).toHaveCount(5, { timeout: 30_000 });
      if (variant === "light") {
        await expect(main).toContainText("Empty sheet. Tap something on the rate card to start putting hours against it.");
        await expect(main).toContainText("2% over, on average");
        for (const title of ["Discovery & audit", "Logo direction", "Pattern studies", "Cup sizes & marks", "Print handoff"]) await expect(main).toContainText(title);
        await expect(sheet.locator(".scope-past").filter({ hasText: "Logo direction" })).toContainText("quoted 2d2.33d+17%");
        await expect(sheet.locator(".scope-past").filter({ hasText: "Print handoff" })).toContainText("quoted 1d0.92d−8%");
        await expect(sheet.locator(".scope-rate")).toHaveCount(4);
        await expect(sheet.locator(`.scope-rate[data-rate="${String(rateId("Day rate, design"))}"]`)).toContainText("6 h of studio time");
        await expect(sheet.locator(`.scope-rate[data-rate="${String(rateId("Template, each"))}"]`)).toContainText("hours vary");
      }
      await shoot(page, "scoping-empty", variant);
    });

    await test.step(`refused (${variant})`, async () => {
      await sheet.locator(".scope-turn").click();
      await expect(sheet.locator(".alert")).toHaveText(desk.word("scoping.refused.client"));
      await shoot(page, "scoping-refused", variant);
    });

    await test.step(`worked (${variant})`, async () => {
      await sheet.locator(".scope-chip").filter({ hasText: String(slow["company"]) }).click();
      await sheet.locator(".scope-what input").fill("Podcast identity — mark & wordmark");
      for (const label of ["Day rate, design", "Half day", "Template, each"]) await sheet.locator(`.scope-rate[data-rate="${String(rateId(label))}"]`).click();
      await sheet.locator(".scope-qty").nth(0).fill("6");
      await sheet.locator(".scope-qty").nth(2).fill("12");
      for (const [what, amount, ours] of [
        ["Type licence — two weights, desktop & web", "420", false],
        ["Proof prints, two rounds", "60", false],
        ["Reference books", "38", true],
      ] as const) {
        await sheet.locator("button").filter({ hasText: desk.word("scoping.exp.add") }).click();
        const row = sheet.locator(".scope-exp").last();
        await row.locator(".scope-exp-what").fill(what);
        await row.locator(".scope-exp-amount").fill(amount);
        if (ours) await row.locator(".scope-tag").click();
      }
      if (variant === "light") {
        // 6 × 750 + 400 + 12 × 90; 39 hours of a six-hour day; tax at the client's 8.5 %.
        await expect(main).toContainText("39 h · 6.5 days");
        await expect(sheet.locator(".scope-foot--sum")).toContainText(usd(5980));
        await expect(main).toContainText(`Passed on at cost: ${usd(480)} · ours to carry: ${usd(38)}.`);
        await expect(sheet.locator("[data-figure=price]")).toHaveText(usd(6460));
        await expect(main).toContainText(`Sales tax 8.5%, added on the invoice${usd(549.1)}`);
        await expect(sheet.locator("[data-figure=total]")).toHaveText(usd(7009.1));
        await expect(main).toContainText("39 h of work — 6.5 studio days, or 3.3 each if you both take it.");
        await expect(main).toContainText("2 of you at 4 days a week is 8 studio days a week, so this stage fills about 0.8 weeks of the calendar.");
        await expect(main).toContainText(`${usd(920)} a day`);
        await expect(main).toContainText("2.3 months of fixed costs");
        await expect(main).toContainText(`Your running costs come to ${usd(2850)} a month before anyone is paid.`);
        await expect(main).toContainText(`To start, before anything moves${usd(3504.55)}`);
        await expect(main).toContainText("The sheet says 6.5 days. History says budget 6.6 and be pleasantly surprised.");
      }
      await shoot(page, "scoping-worked", variant);
    });

    await test.step(`reserve (${variant})`, async () => {
      await sheet.locator(".scope-cont").click();
      await expect(sheet.locator(".scope-cont")).toHaveAttribute("aria-pressed", "true");
      if (variant === "light") {
        // 6 × 0.02 days at $750, 0.02 half days at $400, 0.24 templates at $90.
        await expect(main).toContainText(`Contingency, 2% from your record${usd(119.6)}`);
        await expect(sheet.locator("[data-figure=price]")).toHaveText(usd(6579.6));
      }
      await shoot(page, "scoping-reserve", variant);
    });

    if (variant === "light") {
      await test.step("turn it into a proposal (light)", async () => {
        const before = new Set((await stack.rows("proposals")).map((p) => p.id));
        await sheet.locator(".scope-turn").click();
        await expect(screenOf(page, "composer")).toBeVisible({ timeout: 30_000 });
        await expect(page.locator(".toasts")).toContainText("6 lines carried over. The wording is still yours to write.");
        const made = (await stack.rows("proposals")).filter((p) => !before.has(p.id));
        expect(made).toHaveLength(1);
        const draft = made[0]!;
        expect(draft).toMatchObject({ status: "draft", client_id: slow.id, title: "Podcast identity — mark & wordmark", split: "5050", valid_until: "2026-08-18" });
        const inForce = (await stack.rows("terms_versions")).filter((v) => v["status"] === "in_force");
        expect(draft["terms_version_id"]).toBe(inForce.sort((a, b) => Number(b["version"]) - Number(a["version"]))[0]!.id);
        const lines: Row[] = (await stack.rows("proposal_lines")).filter((l) => l["document_id"] === draft.id).sort((a, b) => Number(a["position"]) - Number(b["position"]));
        expect(lines.map((l) => [l["description"], Number(l["qty"]), Number(l["rate"]), Number(l["amount"])])).toEqual([
          ["Day rate, design", 6, 750, 4500],
          ["Half day", 1, 400, 400],
          ["Template, each", 12, 90, 1080],
          ["Time held in reserve — Day rate, design", 0.12, 750, 90],
          ["Time held in reserve — Half day", 0.02, 400, 8],
          ["Time held in reserve — Template, each", 0.24, 90, 21.6],
        ]);
        // Every line under a key of its own; no purchase reaches the proposal.
        expect(new Set(lines.map((l) => l["client_key"])).size).toBe(6);
        expect(lines.every((l) => typeof l["client_key"] === "string")).toBe(true);
        expect(lines.some((l) => String(l["description"]).includes("Type licence"))).toBe(false);
        // The figures are Adminium's, and the composer shows them.
        expect([Number(draft["subtotal"]), Number(draft["tax"]), Number(draft["total"])]).toEqual([6099.6, 518.47, 6618.07]);
        await expect(screenOf(page, "composer")).toContainText(usd(6618.07));
        await shoot(page, "scoping-turned-composer", variant);
      });
    }
    await context.close();
  }
});
