/**
 * Locale registry — a deliberate mirror of Adminium's canonical registry
 * (`@adminium/i18n`'s `locales.ts`). This app is a standalone repo published to
 * the Adminiumjs org and cannot depend on the monorepo, so the table is copied
 * rather than imported. It carries the same invariant: `dir` is DERIVED from
 * the locale and is never independently settable, so adding an RTL language
 * later is a data change here and nothing else.
 */

export interface Locale {
  /** BCP-47 tag — used for the `lang` attribute and every `Intl.*` call. */
  tag: string;
  /** Endonym. A locale picker always lists languages in their own language. */
  native: string;
  dir: "ltr" | "rtl";
}

export const LOCALES = {
  "en-US": { tag: "en-US", native: "English (US)", dir: "ltr" },
  "de-DE": { tag: "de-DE", native: "Deutsch", dir: "ltr" },
  "fr-FR": { tag: "fr-FR", native: "Français", dir: "ltr" },
  "cs-CZ": { tag: "cs-CZ", native: "Čeština", dir: "ltr" },
  "da-DK": { tag: "da-DK", native: "Dansk", dir: "ltr" },
  "zh-CN": { tag: "zh-CN", native: "简体中文", dir: "ltr" },
  "zh-TW": { tag: "zh-TW", native: "繁體中文", dir: "ltr" },
  "ar-EG": { tag: "ar-EG", native: "العربية (مصر)", dir: "rtl" },
} as const satisfies Record<string, Locale>;

export type LocaleTag = keyof typeof LOCALES;

export const LOCALE_TAGS = Object.keys(LOCALES) as LocaleTag[];
export const DEFAULT_LOCALE: LocaleTag = "en-US";

export function isLocaleTag(v: unknown): v is LocaleTag {
  return typeof v === "string" && v in LOCALES;
}

export function dirFor(tag: LocaleTag): "ltr" | "rtl" {
  return LOCALES[tag].dir;
}

/**
 * Best-effort match of a browser language to a supported locale: exact tag
 * first, then language-only (`de-AT` → `de-DE`), else English. `zh` is
 * disambiguated by script/region because Simplified and Traditional are
 * separately translated and must not fall through to each other.
 */
export function resolveLocale(preferred: readonly string[]): LocaleTag {
  for (const raw of preferred) {
    if (isLocaleTag(raw)) return raw;
    const lower = raw.toLowerCase();
    if (lower.startsWith("zh")) {
      return /hant|tw|hk|mo/.test(lower) ? "zh-TW" : "zh-CN";
    }
    const lang = lower.split("-")[0];
    const hit = LOCALE_TAGS.find((t) => t.toLowerCase().split("-")[0] === lang);
    if (hit) return hit;
  }
  return DEFAULT_LOCALE;
}
