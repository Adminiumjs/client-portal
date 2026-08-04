/**
 * A module-level mirror of whatever locale the provider is currently rendering.
 *
 * `lib/format.ts` is a pure module: the zustand store, `data/demo.ts` and
 * `lib/pipeline.ts` all call its formatters from outside React, where no hook
 * can reach the provider. Rather than duplicate the runtime — a second lookup
 * table and a second set of `Intl` rules — `<App>` pushes the provider's own
 * `locale` / `t` / `money` / `number` in here on every render, so those callers
 * forward to exactly the functions the tree is using.
 *
 * Before the provider mounts — module initialisation, and the vitest suites,
 * which render no React at all — the fallbacks below serve the English bundle
 * and `en-US` formatting.
 */
import { DEFAULT_LOCALE, type LocaleTag } from "./locales.ts";
import { MESSAGES, type MessageKey } from "./messages/index.ts";
import type { TFunction } from "./index.tsx";

type MoneyFn = (value: number, currency?: string) => string;
type NumberFn = (value: number, opts?: Intl.NumberFormatOptions) => string;

/**
 * English-only `t`. Deliberately simpler than the runtime's: no locale to
 * resolve and only English's two plural categories, because by the time a
 * second locale is selectable the provider has mounted and replaced this.
 */
const fallbackT: TFunction = (key, params, count) => {
  let raw = MESSAGES[DEFAULT_LOCALE][key] ?? key;
  if (count !== undefined && raw.includes("|")) {
    const variants = raw.split("|");
    raw = count === 1 ? variants[0] : variants[variants.length - 1];
  }
  const all = count === undefined ? params : { count, ...params };
  if (!all) return raw;
  return raw.replace(/\{(\w+)\}/g, (m: string, name: string) =>
    name in all ? String(all[name as keyof typeof all]) : m,
  );
};

const fallbackMoney: MoneyFn = (value, currency = "USD") =>
  new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const fallbackNumber: NumberFn = (value, opts) =>
  new Intl.NumberFormat(DEFAULT_LOCALE, opts).format(value);

let activeLocale: LocaleTag = DEFAULT_LOCALE;
let activeT: TFunction = fallbackT;
let activeMoney: MoneyFn = fallbackMoney;
let activeNumber: NumberFn = fallbackNumber;

/** Called by `<App>` on every render — cheap, idempotent, and always current. */
export function setAmbient(
  next: LocaleTag,
  t: TFunction,
  money: MoneyFn,
  number: NumberFn,
): void {
  activeLocale = next;
  activeT = t;
  activeMoney = money;
  activeNumber = number;
}

/** The tag every `Intl.*` instance in `lib/format.ts` is built against. */
export const locale = (): LocaleTag => activeLocale;

export const t: TFunction = (key, params, count) => activeT(key, params, count);

export const money: MoneyFn = (value, currency) => activeMoney(value, currency);

export const number: NumberFn = (value, opts) => activeNumber(value, opts);

/**
 * Lookup for keys assembled at runtime from data (`'data.company.' + id`),
 * where the compiler cannot check the key. Returns `fallback` — the raw English
 * from the seed — when the bundle has nothing for it, so unknown seed data
 * still renders instead of leaking a dotted key onto the screen.
 */
export function tOr(key: string, fallback: string): string {
  const hit = activeT(key as MessageKey, undefined, undefined);
  return hit === key ? fallback : hit;
}
