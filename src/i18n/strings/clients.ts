/**
 * Area bundle: **clients** — the Clients list and one client's record.
 *
 * Keys are namespaced by the area (`clients.*`), so they never collide with
 * another area's. Add the English here, then the same keys in every other
 * language; `messages/index.ts` already reads this file.
 */
import type { LocaleTag } from "../locales.ts";
import type { Translated } from "../untranslated.ts";

const EN = {} as const;

type Messages = typeof EN;

export const clients: { "en-US": Messages } & Record<Exclude<LocaleTag, "en-US">, Translated<Messages>> = {
  "en-US": EN,
  "de-DE": {},
  "fr-FR": {},
  "da-DK": {},
  "cs-CZ": {},
  "ar-EG": {},
  "zh-CN": {},
  "zh-TW": {},
};
