/**
 * A tiny, dependency-free i18n runtime for this example app.
 *
 * Deliberately not i18next: the app ships as a self-contained demo people
 * clone and read, so a ~120-line context beats a 40 KB dependency. It covers
 * exactly what the app needs — message lookup with `{placeholder}`
 * substitution, a persisted locale, `lang`/`dir` stamping on <html>, and
 * memoized `Intl` formatters for money, numbers and dates.
 *
 * Plurals: `t()` takes an optional `count`, and a message may carry
 * `|`-separated variants selected through `Intl.PluralRules`, e.g.
 *   "{count} deal|{count} deals"                        (en: one|other)
 *   "{count} obchod|{count} obchody|{count} obchodů"     (cs: one|few|other)
 * The variant order is the locale's own CLDR category order, declared per
 * locale in `PLURAL_ORDER` so a translator never has to guess.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { tenantCurrency } from "./ambient.ts";
import { formatMoney } from "../lib/money.ts";
import type { Decimal } from "../data/types.ts";

import {
  DEFAULT_LOCALE,
  LOCALES,
  dirFor,
  isLocaleTag,
  resolveLocale,
  type LocaleTag,
} from "./locales.ts";
import type { MessageKey } from "./messages/index.ts";
import { RUNTIME_MESSAGES } from "./messages/runtime.ts";

const STORAGE_KEY = "client-portal-locale";

/** CLDR cardinal categories, in the order translators write `|` variants. */
const PLURAL_ORDER: Record<LocaleTag, Intl.LDMLPluralRule[]> = {
  "en-US": ["one", "other"],
  "de-DE": ["one", "other"],
  "fr-FR": ["one", "other"],
  "da-DK": ["one", "other"],
  "cs-CZ": ["one", "few", "other"],
  "zh-CN": ["other"],
  "zh-TW": ["other"],
  "ar-EG": ["zero", "one", "two", "few", "many", "other"],
};

export type TFunction = (
  key: MessageKey,
  params?: Record<string, string | number>,
  count?: number,
) => string;

interface I18nValue {
  locale: LocaleTag;
  dir: "ltr" | "rtl";
  setLocale: (t: LocaleTag) => void;
  t: TFunction;
  /**
   * An amount as Adminium stored it (a decimal string, "1950.00"), in the
   * page's language, with its currency's own minor units (JPY none, KWD three).
   * Display only: see `lib/money.ts`. The currency is the document's, else the
   * studio's.
   */
  money: (value: Decimal | number | null | undefined, currency?: string | null) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  date: (d: Date | number, opts?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

/**
 * The locale the Adminium host frame pushed, and the live setter that applies
 * it.
 *
 * Module scope because it arrives from the embed bridge BEFORE React mounts —
 * the host hands over its locale during the handshake — and again later when an
 * operator switches language in the dashboard. Neither is persisted: the host's
 * language is the host's setting, and writing it here would leave the app stuck
 * in it once opened standalone.
 */
let hostLocale: LocaleTag | null = null;
let applyLocale: ((t: LocaleTag) => void) | null = null;

export function setHostLocale(tag: string): void {
  if (!isLocaleTag(tag)) return; // an unknown tag leaves the app's own default
  hostLocale = tag;
  applyLocale?.(tag);
}

/** The language the page opens in: the host's, else the one chosen before, else the browser's. */
export function initialLocale(): LocaleTag {
  if (hostLocale !== null) return hostLocale;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocaleTag(stored)) return stored;
  } catch {
    // Private mode / storage disabled — fall through to the browser's list.
  }
  return resolveLocale(navigator.languages ?? [navigator.language]);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleTag>(initialLocale);
  const dir = dirFor(locale);

  // Stamp <html> so CSS logical properties resolve and screen readers announce
  // the right language. This is the single switch that turns RTL on.
  // Register the un-persisted setter for `setHostLocale`, so a language flip in
  // the dashboard restyles this frame live rather than on next load.
  useEffect(() => {
    applyLocale = setLocaleState;
    return () => {
      applyLocale = null;
    };
  }, []);

  useEffect(() => {
    const el = document.documentElement;
    el.setAttribute("lang", LOCALES[locale].tag);
    el.setAttribute("dir", dir);
  }, [locale, dir]);

  const setLocale = useCallback((next: LocaleTag) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Not being able to remember the choice is not a reason to refuse it.
    }
  }, []);

  const value = useMemo<I18nValue>(() => {
    const bundle = RUNTIME_MESSAGES[locale];
    const fallback = RUNTIME_MESSAGES[DEFAULT_LOCALE];
    const pr = new Intl.PluralRules(locale);
    const nf = new Intl.NumberFormat(locale);

    const lookup = (
      key: string,
      params?: Record<string, string | number>,
      count?: number,
    ): string => {
      let raw = bundle[key] ?? fallback[key] ?? key;

      if (count !== undefined && raw.includes("|")) {
        const variants = raw.split("|");
        const order = PLURAL_ORDER[locale];
        const idx = order.indexOf(pr.select(count));
        raw =
          variants[
            idx === -1 ? variants.length - 1 : Math.min(idx, variants.length - 1)
          ];
      }

      const all = count === undefined ? params : { count, ...params };
      if (!all) return raw;
      return raw.replace(/\{(\w+)\}/g, (m: string, name: string) =>
        name in all ? String(all[name as keyof typeof all]) : m,
      );
    };

    const t: TFunction = (key, params, count) => lookup(key, params, count);

    return {
      locale,
      dir,
      setLocale,
      t,
      money: (v, currency) => formatMoney(v, currency ?? tenantCurrency(), locale),
      number: (n, opts) =>
        opts ? new Intl.NumberFormat(locale, opts).format(n) : nf.format(n),
      date: (d, opts) => new Intl.DateTimeFormat(locale, opts).format(d),
    };
  }, [locale, dir, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const ctx = useContext(I18nContext);
  if (ctx === null) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}

/** Shorthand for the common case. */
export function useT(): TFunction {
  return useI18n().t;
}

export { LOCALES, LOCALE_TAGS, DEFAULT_LOCALE, type LocaleTag } from "./locales.ts";
export type { MessageKey } from "./messages/index.ts";
