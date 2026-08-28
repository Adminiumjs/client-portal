/**
 * Presentation helpers.
 *
 * Money arrives here as INTEGER CENTS and is divided exactly once, at the
 * point of display. Nothing upstream of `money()` ever holds a fractional
 * dollar, which is why the studio's total and the client's total can never
 * disagree by a rounding penny.
 *
 * Everything reads the ambient locale (`i18n/ambient.ts`) rather than a hook,
 * so the store and the pure engine format identically to the React tree.
 */

import { serDate } from "../data/demo.ts";
import { tenantCurrency, locale, number as ambientNumber, t, tOr } from "../i18n/ambient.ts";
import type { MessageKey } from "../i18n/messages/index.ts";

/** Resolve a seed field that stores an i18n key; pass literal text through. */
export function label(key: string): string {
  return tOr(key, key);
}

/**
 * Cents → a currency string, always to the cent.
 *
 * "Money is always mono and always to the cent" is the studio's own house
 * rule, so `minimumFractionDigits` is pinned at 2 rather than left to the
 * locale's default.
 */
export function money(cents: number, currency = tenantCurrency()): string {
  return new Intl.NumberFormat(locale(), {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

/** A rate per unit — same formatting, named separately for readability. */
export const rate = money;

export function number(value: number, opts?: Intl.NumberFormatOptions): string {
  return ambientNumber(value, opts);
}

export function percent(fraction: number, digits = 0): string {
  return ambientNumber(fraction, {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A whole-percentage tax rate — "8%" from the stored `8`. */
export function taxLabel(wholePercent: number): string {
  return ambientNumber(wholePercent / 100, {
    style: "percent",
    maximumFractionDigits: 2,
  });
}

/* --------------------------------------------------------------------- dates */

/** Serials are UTC midnights, so every formatter is pinned to UTC. */
function fmt(serial: number, opts: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(locale(), { ...opts, timeZone: "UTC" }).format(
    serDate(serial),
  );
}

export function dateShort(serial: number): string {
  return fmt(serial, { day: "numeric", month: "short" });
}

export function dateLong(serial: number): string {
  return fmt(serial, { day: "numeric", month: "long", year: "numeric" });
}

export function dateFull(serial: number): string {
  return fmt(serial, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** "12 days ago" / "in 3 days" / "today", against the pinned clock. */
export function relative(serial: number, now: number): string {
  const diff = now - serial;
  if (diff === 0) return t("chrome.rel.today");
  if (diff > 0) return t("chrome.rel.daysAgo", { count: diff }, diff);
  return t("chrome.rel.inDays", { count: -diff }, -diff);
}

/** "12 days overdue" — the aging chip. */
export function overdueLabel(days: number): string {
  return t("chrome.overdueDays", { count: days }, days);
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/* --------------------------------------------------------------------- tints */

function toRgb(hex: string): [number, number, number] {
  let h = (hex || "#b25e09").replace("#", "");
  if (h.length === 3)
    h = h
      .split("")
      .map((c) => c + c)
      .join("");
  const n = Number.parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(hex: string, alpha: number): string {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

export function lighten(hex: string, amount: number): string {
  const [r, g, b] = toRgb(hex);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)},${mix(g)},${mix(b)})`;
}

/** The layered gradient every logo slot and deliverable thumbnail uses. */
export function tileBackground(hex: string, dark: boolean, angle = "150deg"): string {
  const highlight = dark
    ? "radial-gradient(120% 84% at 50% 0%, rgba(255,255,255,.07), transparent 56%)"
    : "radial-gradient(120% 84% at 50% 0%, rgba(255,255,255,.6), transparent 58%)";
  const glow = `radial-gradient(58% 46% at 72% 88%, ${rgba(hex, dark ? 0.3 : 0.2)}, transparent 72%)`;
  const base = `linear-gradient(${angle}, ${rgba(hex, dark ? 0.34 : 0.22)}, ${rgba(hex, dark ? 0.12 : 0.07)})`;
  return `${highlight}, ${glow}, ${base}`;
}

export { t };
export type { MessageKey };
