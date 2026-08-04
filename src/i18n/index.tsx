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

import {
  DEFAULT_LOCALE,
  LOCALES,
  dirFor,
  isLocaleTag,
  resolveLocale,
  type LocaleTag,
} from "./locales.ts";
import { MESSAGES, type MessageKey } from "./messages/index.ts";

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
  /** Currency is a property of the money, not of the reader's language. */
  money: (value: number, currency?: string) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  date: (d: Date | number, opts?: Intl.DateTimeFormatOptions) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

function initialLocale(): LocaleTag {
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
    const bundle = MESSAGES[locale];
    const fallback = MESSAGES[DEFAULT_LOCALE];
    const pr = new Intl.PluralRules(locale);
    const nf = new Intl.NumberFormat(locale);

    const t: TFunction = (key, params, count) => {
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

    return {
      locale,
      dir,
      setLocale,
      t,
      money: (v, currency = "USD") =>
        new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
        }).format(v),
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
