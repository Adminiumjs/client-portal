/**
 * The studio's desk, walked as a person walks it: one load of
 * `/apps/clients/staff/`, then the sidebar (the phone's menu at phone width),
 * a row to open a document, a button to go on — every screen of the desk,
 * each one shot and swept. A reload per screen would cost the desk's twenty
 * boot reads each time and run into Adminium's per-minute budget, so only the
 * dead end (an address that names no screen) is a load of its own.
 */
import { expect, type Page } from "@playwright/test";

import type { MessageKey } from "../src/i18n/messages/index.ts";
import { settle, type Variant } from "./browser.ts";
import { localeOf, say } from "./words.ts";

/** The sidebar's items, in its order (`app/routes.ts` SIDEBAR). */
const NAV = ["home", "enquiries", "proposals", "projects", "clients", "invoices", "chasing", "settings"] as const;
type NavView = (typeof NAV)[number];

export const screenOf = (page: Page, screen: string) => page.locator(`[data-screen="${screen}"]`).first();

/** Where the desk is served, for a load. */
export const DESK = "/apps/clients/staff/";

export class Desk {
  constructor(
    readonly page: Page,
    readonly variant: Variant,
  ) {}

  word(key: MessageKey, params?: Record<string, string | number>): string {
    return say(localeOf(this.variant), key, params);
  }

  async shows(screen: string): Promise<void> {
    await expect(screenOf(this.page, screen)).toBeVisible({ timeout: 20_000 });
    await settle(this.page);
  }

  /** A sidebar item: on a phone, through the menu. */
  async nav(view: NavView): Promise<void> {
    const index = NAV.indexOf(view);
    const rail = this.page.locator(".desk-rail .desk-nav-item");
    const menu = this.page.locator(".desk-header button[aria-haspopup='dialog']");
    // The desk has drawn its frame: the sidebar, or at phone width the menu button.
    await expect(rail.first().or(menu)).toBeVisible({ timeout: 30_000 });
    if (await rail.first().isVisible()) await rail.nth(index).click();
    else {
      await menu.click();
      await this.page.locator(".menu-panel .desk-nav-item").nth(index).click();
    }
    await this.shows(view);
  }

  /** Open the row that names `text` (a number, a company — data, the same in every language). */
  async row(text: string, screen: string): Promise<void> {
    await this.page.locator("main button").filter({ hasText: text }).first().click();
    await this.shows(screen);
  }

  /** Press the page's button that says `key`. */
  async press(key: MessageKey, screen?: string): Promise<void> {
    await this.page.locator("main button, main a").filter({ hasText: this.word(key) }).first().click();
    if (screen !== undefined) await this.shows(screen);
  }
}

export interface DeskStop {
  /** The screen's name in the screenshots and the report. */
  name: string;
  /** How to get there from the stop before. */
  go(desk: Desk): Promise<void>;
  /** Checks only the English, light walk makes (figures read in one language). */
  light?(desk: Desk): Promise<void>;
  /** Only at phone width. */
  phoneOnly?: boolean;
}

/**
 * Every desk screen, in the order the walk visits them. Each `go` starts from
 * where the stop before left the page.
 */
export function deskStops(checks: { home?(d: Desk): Promise<void>; chasing?(d: Desk): Promise<void>; invoice?(d: Desk, number: string): Promise<void>; invoices?(d: Desk): Promise<void> }): DeskStop[] {
  return [
    { name: "home", go: (d) => d.shows("home"), light: checks.home },
    {
      name: "menu",
      phoneOnly: true,
      go: async (d) => {
        await d.page.locator(".desk-header button[aria-haspopup='dialog']").click();
        await expect(d.page.locator(".menu-panel")).toBeVisible();
        await settle(d.page);
      },
    },
    {
      name: "enquiries",
      go: async (d) => {
        if (await d.page.locator(".menu-panel").isVisible()) await d.page.locator(".menu-panel .desk-nav-item").nth(1).click();
        else await d.nav("enquiries");
        await d.shows("enquiries");
      },
    },
    { name: "proposals", go: (d) => d.nav("proposals") },
    { name: "proposal-sent", go: (d) => d.row("QUO-S1142", "proposal") },
    { name: "proposal-accepted", go: async (d) => (await d.nav("proposals"), d.row("QUO-S1138", "proposal")) },
    { name: "proposal-declined", go: async (d) => (await d.nav("proposals"), d.row("QUO-S1136", "proposal")) },
    {
      name: "composer",
      go: async (d) => {
        await d.nav("proposals");
        await d.page.locator("main button").filter({ hasText: "QUO-S1143" }).first().click();
        // A draft opens straight in the composer, or on its page with "Open in composer".
        const composer = screenOf(d.page, "composer");
        await expect(composer.or(screenOf(d.page, "proposal"))).toBeVisible();
        if (!(await composer.isVisible())) await d.press("proposals.openInComposer");
        await d.shows("composer");
      },
    },
    { name: "projects", go: (d) => d.nav("projects") },
    { name: "project", go: (d) => d.row("PRJ-S01", "project") },
    { name: "review", go: (d) => d.row("logo_v3.pdf", "review") },
    { name: "handover", go: async (d) => (await d.nav("projects"), await d.row("PRJ-S01", "project"), d.press("projects.page.handover", "handover")) },
    {
      name: "preview",
      go: async (d) => {
        await d.nav("projects");
        await d.row("PRJ-S01", "project");
        await d.press("projects.page.preview", "client-project");
        await expect(d.page.locator(".preview-bar")).toBeVisible();
      },
    },
    {
      name: "clients",
      go: async (d) => {
        await d.page.locator(".preview-bar button").click();
        await d.shows("project");
        await d.nav("clients");
      },
    },
    { name: "client", go: (d) => d.row("Hearth & Loaf", "client") },
    { name: "invoices", go: (d) => d.nav("invoices"), light: checks.invoices },
    { name: "invoice-open", go: (d) => d.row("INV-S2039", "invoice"), light: (d) => checks.invoice?.(d, "INV-S2039") ?? Promise.resolve() },
    { name: "print", go: (d) => d.press("invoices.page.print", "print") },
    { name: "invoice-overdue", go: async (d) => (await d.nav("invoices"), d.row("INV-S2037", "invoice")), light: (d) => checks.invoice?.(d, "INV-S2037") ?? Promise.resolve() },
    { name: "invoice-draft", go: async (d) => (await d.nav("invoices"), d.row("INV-S2041", "invoice")), light: (d) => checks.invoice?.(d, "INV-S2041") ?? Promise.resolve() },
    { name: "invoice-void", go: async (d) => (await d.nav("invoices"), d.row("INV-S2027", "invoice")), light: (d) => checks.invoice?.(d, "INV-S2027") ?? Promise.resolve() },
    { name: "invoice-paid", go: async (d) => (await d.nav("invoices"), d.row("INV-S2036", "invoice")), light: (d) => checks.invoice?.(d, "INV-S2036") ?? Promise.resolve() },
    { name: "chasing", go: (d) => d.nav("chasing"), light: checks.chasing },
    { name: "settings", go: (d) => d.nav("settings") },
    { name: "terms", go: (d) => d.press("nav.terms", "terms") },
    {
      name: "notfound",
      go: async (d) => {
        await d.page.goto(`${DESK}archive`);
        await d.shows("notfound");
      },
    },
  ];
}
