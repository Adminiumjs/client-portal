/**
 * The clients' side, walked as a client walks it.
 *
 * A client's session lives in the page (the public client holds it in
 * memory), so a reload signs them out: once signed in by the emailed link,
 * the walk moves by the page's own buttons, and the variants change in place
 * — the header's light/dark switch and language menu, the window's width —
 * rather than in a fresh browser that would need a fresh link (three a
 * quarter-hour per address).
 */
import { expect, type Page } from "@playwright/test";

import type { MessageKey } from "../src/i18n/messages/index.ts";
import { DESKTOP, PHONE, settle, type Variant } from "./browser.ts";
import { screenOf } from "./desk.ts";
import { localeOf, say } from "./words.ts";

export const PORTAL = "/apps/clients/customer/";

/** Put a signed-in page into a variant with the page's own controls. */
export async function become(page: Page, variant: Variant): Promise<void> {
  const html = page.locator("html");
  const dark = (await html.getAttribute("data-theme")) === "dark";
  if ((variant === "dark") !== dark) await page.locator(".portal-bar > button.icon-btn").click();
  await expect(html).toHaveAttribute("data-theme", variant === "dark" ? "dark" : "light");
  const lang = variant === "arabic" ? "ar-EG" : "en-US";
  if ((await html.getAttribute("lang")) !== lang) {
    await page.locator(".lang > button").click();
    await page.locator(`.lang-menu [role=menuitemradio][lang="${lang}"]`).click();
  }
  await expect(html).toHaveAttribute("lang", lang);
  await page.setViewportSize(variant === "phone" ? PHONE : DESKTOP);
  await settle(page);
}

export class Portal {
  constructor(
    readonly page: Page,
    public variant: Variant,
  ) {}

  word(key: MessageKey, params?: Record<string, string | number>): string {
    return say(localeOf(this.variant), key, params);
  }

  async shows(screen: string): Promise<void> {
    await expect(screenOf(this.page, screen)).toBeVisible({ timeout: 20_000 });
    await settle(this.page);
  }

  async row(text: string, screen: string): Promise<void> {
    await this.page.locator("main button").filter({ hasText: text }).first().click();
    await this.shows(screen);
  }

  async press(key: MessageKey, screen?: string): Promise<void> {
    await this.page.locator("main button, main a").filter({ hasText: this.word(key) }).first().click();
    if (screen !== undefined) await this.shows(screen);
  }

  /** Back to the client's Home from any page: the "also with" list's last row, or the way back. */
  async home(): Promise<void> {
    const all = this.page.locator("main .cl-list-row--last");
    if (await all.isVisible()) await all.click();
    else await this.page.locator("main .cl-back").first().click();
    await this.shows("client-home");
  }
}

export interface PortalStop {
  name: string;
  go(p: Portal): Promise<void>;
  light?(p: Portal): Promise<void>;
}

/** Every page a signed-in client has, from their Home and back to it. */
export function portalStops(checks: { invoice?(p: Portal, number: string): Promise<void> }): PortalStop[] {
  return [
    { name: "client-home", go: (p) => p.shows("client-home") },
    { name: "client-invoice-open", go: (p) => p.row("INV-S2039", "client-invoice"), light: (p) => checks.invoice?.(p, "INV-S2039") ?? Promise.resolve() },
    {
      name: "client-invoice-paid",
      go: async (p) => (await p.home(), p.row("INV-S2036", "client-invoice")),
      light: (p) => checks.invoice?.(p, "INV-S2036") ?? Promise.resolve(),
    },
    { name: "client-proposal-accepted", go: async (p) => (await p.home(), p.row("QUO-S1138", "client-proposal")) },
    { name: "client-project", go: async (p) => (await p.home(), p.press("client.home.openProject", "client-project")) },
    {
      name: "client-review",
      go: async (p) => {
        // A deliverable's card: its first button opens it.
        await p.page.locator("main li.cl-deliv").filter({ hasText: "wordmark_dark.svg" }).locator("button").first().click();
        await p.shows("client-review");
      },
    },
    {
      name: "client-statement",
      go: async (p) => {
        await p.page.locator("main .cl-back").first().click();
        await p.shows("client-project");
        await p.home();
        await p.press("client.home.statementLink", "client-statement");
      },
    },
    {
      name: "client-receipt",
      go: async (p) => {
        // A payment's Receipt button, by the start of its label ("Receipt for the payment of {date}").
        const prefix = p.word("client.statement.receiptFor", { date: "\u0000" }).split("\u0000")[0]!;
        await p.page.locator(`main button[aria-label^="${prefix}"]`).last().click();
        await expect(p.page.locator("[role=dialog]")).toBeVisible();
        await settle(p.page);
      },
    },
    {
      name: "client-brief",
      go: async (p) => {
        await p.page.keyboard.press("Escape");
        await expect(p.page.locator("[role=dialog]")).toHaveCount(0);
        await p.home();
        await p.press("client.home.briefSent", "client-brief");
      },
    },
  ];
}
