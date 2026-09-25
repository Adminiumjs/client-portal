/**
 * Area bundle: **sheets** — the studio's sheets (add, send, start the project, record a payment …).
 *
 * Keys are namespaced by the area (`sheets.*`), so they never collide with
 * another area's. Add the English here, then the same keys in every other
 * language; `messages/index.ts` already reads this file.
 */
import type { LocaleTag } from "../locales.ts";
import type { Translated } from "../untranslated.ts";

const EN = {} as const;

type Messages = typeof EN;

export const sheets: { "en-US": Messages } & Record<Exclude<LocaleTag, "en-US">, Translated<Messages>> = {
  "en-US": EN,
  "de-DE": {},
  "fr-FR": {},
  "da-DK": {},
  "cs-CZ": {},
  "ar-EG": {},
  "zh-CN": {},
  "zh-TW": {},
};
