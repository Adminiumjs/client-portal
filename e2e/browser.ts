/**
 * What every screen of the browser pass does: the page's clock at the
 * sample's moment, the variant it is seen in, a wait for the page to be
 * still, a full-page screenshot, and an axe sweep that fails on a serious or
 * critical violation — and on a sweep that analysed nothing, which would
 * otherwise pass by silence.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import AxeBuilder from "@axe-core/playwright";
import { expect, type Browser, type BrowserContext, type Page } from "@playwright/test";

import { DEMO_START } from "../src/lib/clock.ts";

export type Variant = "light" | "dark" | "arabic" | "phone";
export const VARIANTS: readonly Variant[] = ["light", "dark", "arabic", "phone"];

/** Where the screenshots go: `<SHOTS>/<engine>/<screen>-<variant>.png`. */
export const SHOTS = process.env["E2E_SHOTS"] ?? join(process.cwd(), "e2e-results", "shots");

export const DESKTOP = { width: 1280, height: 900 };
export const PHONE = { width: 390, height: 844 };

/** How a variant is set on a fresh browser context: its language, its colour scheme, its width, its zone. */
export function contextOptions(variant: Variant, timezoneId = "America/New_York") {
  return {
    locale: variant === "arabic" ? "ar-EG" : "en-US",
    colorScheme: variant === "dark" ? ("dark" as const) : ("light" as const),
    viewport: variant === "phone" ? PHONE : DESKTOP,
    ...(variant === "phone" ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    timezoneId,
  };
}

/**
 * The page's clock at the moment the server's was started at (10:00 on
 * 28 July 2026 at the studio), running on from there — as the contract's
 * preload moves the server's. Timers are left alone: only `Date` moves.
 */
export const CLOCK_SCRIPT = `(() => {
  const target = ${String(DEMO_START)};
  const RealDate = Date;
  const offset = target - RealDate.now();
  class PinnedDate extends RealDate {
    constructor(...args) { if (args.length === 0) super(RealDate.now() + offset); else super(...args); }
    static now() { return RealDate.now() + offset; }
  }
  globalThis.Date = PinnedDate;
})();`;

/** A browser context for a variant, its clock pinned, carrying the staff session when given one, in a zone when given one. */
export async function newContext(browser: Browser, base: string, variant: Variant, cookies?: string, timezoneId?: string): Promise<BrowserContext> {
  const context = await browser.newContext({ ...contextOptions(variant, timezoneId), baseURL: base });
  await context.addInitScript(CLOCK_SCRIPT);
  if (cookies !== undefined && cookies !== "") {
    await context.addCookies(
      cookies.split("; ").map((pair) => {
        const at = pair.indexOf("=");
        return { name: pair.slice(0, at), value: pair.slice(at + 1), url: base };
      }),
    );
  }
  return context;
}

/**
 * Wait until the page is still: fonts loaded, no request in flight for a
 * moment, and every entrance animation finished — infinite ones (a spinner, a
 * pulse) never finish and are left running.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(finite.map((a) => a.finished.catch(() => undefined)));
  });
  await page.waitForTimeout(150);
}

export interface Sweep {
  passes: number;
  violations: { id: string; impact: string | null | undefined; help: string; nodes: string[] }[];
}

/** Every sweep of the run, for the report: `<engine>/<screen>-<variant>` → its result. */
export const SWEEPS = new Map<string, Sweep>();

/** Run axe (WCAG 2.0/2.1 A and AA) over the page. */
export async function sweep(page: Page): Promise<Sweep> {
  const result = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  return {
    passes: result.passes.length,
    violations: result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 40).map((n) => `${n.target.join(" ")} — ${n.failureSummary?.split("\n").slice(1).join(" ").trim() ?? ""}`) })),
  };
}

/**
 * The check every screen gets, in every variant: settle, shoot the full page,
 * sweep it, and fail on a serious or critical violation, on a sweep with no
 * passes, and on a page wider than the window. The failures are soft — the
 * walk goes on and the test fails at its end with every finding — while the
 * page's language and direction, held to the variant, are hard.
 */
export async function check(page: Page, engine: string, screen: string, variant: Variant): Promise<Sweep> {
  // From the top: a sticky header photographs where the page was scrolled to.
  await page.evaluate(() => window.scrollTo(0, 0));
  await settle(page);
  if (variant === "arabic") await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  else await expect(page.locator("html")).not.toHaveAttribute("dir", "rtl");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect.soft(overflow, `${screen} (${variant}) is ${String(overflow)} px wider than the window`).toBeLessThanOrEqual(0);
  const dir = join(SHOTS, engine);
  mkdirSync(dir, { recursive: true });
  await page.screenshot({ path: join(dir, `${screen}-${variant}.png`), fullPage: true });
  const result = await sweep(page);
  SWEEPS.set(`${engine}/${screen}-${variant}`, result);
  expect.soft(result.passes, `axe analysed nothing on ${screen} (${variant})`).toBeGreaterThan(0);
  const blocking = result.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect.soft(blocking, `${screen} (${variant}): ${JSON.stringify(blocking, null, 1)}`).toEqual([]);
  return result;
}
