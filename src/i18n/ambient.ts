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

const fallbackMoney: MoneyFn = (value, currency = activeCurrency) =>
  new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);

const fallbackNumber: NumberFn = (value, opts) =>
  new Intl.NumberFormat(DEFAULT_LOCALE, opts).format(value);

/**
 * The TENANT's currency — the business's, not the reader's and not a default.
 *
 * `money()` used to default to a hardcoded `"USD"`, so a tenant currency set on
 * the connection (28-T34) reached exactly one place: the activity feed, which
 * formats through `formatTenantMoney`. Every screen formatter ignored it and
 * printed dollars — visible as `$6,338.40` above a `€1,200.00` on the same
 * page, against a database configured for EUR.
 *
 * Held here for the same reason the locale is: `lib/format.ts` is a pure module
 * called from the store and from `demo.ts`, where no hook can reach a provider.
 *
 * `USD` remains the value before anything sets one — a demo build has no tenant.
 */
let activeCurrency = "USD";

/** Set once at boot from the connection's tenant config. */
export function setTenantCurrency(code: string | null | undefined): void {
  if (typeof code === "string" && code.length === 3) activeCurrency = code;
}

/** The tenant's ISO-4217 code, for formatters that take no explicit one. */
export const tenantCurrency = (): string => activeCurrency;

/**
 * The zone every date on screen is rendered in, and who chose it.
 *
 * Held here for the same reason the currency is: it is a boot-time tenant
 * fact, and the shell that shows the notice reads it outside any provider.
 * `null` before anything sets it — a demo build has no tenant and the public
 * API always carries a real zone on its scope, so only the hosted-staff
 * session transport ever sets a source at all.
 */
let activeZone: { zone: string; source: 'operator' | 'host' | 'fallback' | null } | null = null;

/** Set once at boot, from the snapshot (which carries the transport's claim). */
export function setTimezoneClaim(
  zone: string,
  source: 'operator' | 'host' | 'fallback' | null,
): void {
  activeZone = { zone, source };
}

/**
 * What the shells should say about the zone, or `null` to say nothing.
 *
 * Only the two UNCONFIRMED sources produce a notice. An `operator` zone is a
 * decision and needs no announcement, and a missing source is no claim.
 */
export function timezoneNotice(): { zone: string; source: 'host' | 'fallback' } | null {
  if (activeZone === null) return null;
  const { zone, source } = activeZone;
  return source === 'host' || source === 'fallback' ? { zone, source } : null;
}

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
