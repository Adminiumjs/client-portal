/**
 * The app's own words, in the language a page is in — so the browser pass
 * presses "Printed copy" in English and «النسخة المطبوعة» in Arabic by the
 * same key, never by a string the test made up.
 */
import { MESSAGES, type MessageKey } from "../src/i18n/messages/index.ts";
import type { LocaleTag } from "../src/i18n/locales.ts";
import type { Variant } from "./browser.ts";

export const localeOf = (variant: Variant): LocaleTag => (variant === "arabic" ? "ar-EG" : "en-US");

/** A message with its `{name}` holes filled, as the page says it. */
export function say(locale: LocaleTag, key: MessageKey, params: Record<string, string | number> = {}): string {
  const raw = MESSAGES[locale][key] ?? MESSAGES["en-US"][key];
  if (raw === undefined) throw new Error(`no message ${key}`);
  return raw.replace(/\{(\w+)\}/g, (hole, name: string) => (name in params ? String(params[name]) : hole));
}
