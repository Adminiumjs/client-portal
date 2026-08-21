/**
 * The message registry.
 *
 * The app's strings are split across three area modules under `../strings/` so
 * they can be authored without one enormous file. This module is the only
 * place that knows they are separate: it flattens them into one bundle per
 * locale, which is what the runtime looks keys up in.
 *
 * Keys must be unique across areas — a later area silently wins a collision,
 * so namespace them (`chrome.*`, `today.*`, `data.*`).
 */
import type { Translated } from "../untranslated.ts";
import { LOCALE_TAGS, type LocaleTag } from "../locales.ts";
import { chrome } from "../strings/chrome.ts";
import { screens } from "../strings/screens.ts";
import { data } from "../strings/data.ts";

/**
 * Parity guard. `en-US` defines the keys; the other seven must each carry a
 * string for every one of them. A translation module that is missing an English
 * key is a COMPILE error here rather than a silent per-key fallback to English
 * at runtime — which is the failure mode this whole layer exists to prevent.
 */
type Area<EN extends Record<string, string>> = { "en-US": EN } & Record<
  Exclude<LocaleTag, "en-US">,
  Translated<EN>
>;

const AREAS: [
  Area<(typeof chrome)["en-US"]>,
  Area<(typeof screens)["en-US"]>,
  Area<(typeof data)["en-US"]>,
] = [chrome, screens, data];

export const MESSAGES = Object.fromEntries(
  LOCALE_TAGS.map((t) => [t, Object.assign({}, ...AREAS.map((a) => a[t] ?? {}))]),
) as Record<LocaleTag, Record<string, string>>;

/** Keys are typed off English — the source of truth — so a typo is a compile error. */
export type MessageKey =
  | keyof (typeof chrome)["en-US"]
  | keyof (typeof screens)["en-US"]
  | keyof (typeof data)["en-US"];
