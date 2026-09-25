/**
 * The message registry.
 *
 * The app's strings are split across area modules under `../strings/`, one per
 * part of the app (the shared chrome, then one per screen area), so each area
 * is authored — and reviewed — on its own. This module is the only place that
 * knows they are separate: it flattens them into one bundle per locale, which
 * is what the runtime looks keys up in.
 *
 * Every area is already listed here, the empty ones included, so adding words
 * to an area never touches this file. Keys must be unique across areas — a
 * later area silently wins a collision — so each area namespaces its keys by
 * its own name (`home.*`, `invoices.*`, `client.*`); `strings.test.ts` fails
 * on a key that appears in two areas.
 */
import type { Translated } from "../untranslated.ts";
import { LOCALE_TAGS, type LocaleTag } from "../locales.ts";
import { chrome } from "../strings/chrome.ts";
import { home } from "../strings/home.ts";
import { enquiries } from "../strings/enquiries.ts";
import { proposals } from "../strings/proposals.ts";
import { composer } from "../strings/composer.ts";
import { projects } from "../strings/projects.ts";
import { review } from "../strings/review.ts";
import { handover } from "../strings/handover.ts";
import { clients } from "../strings/clients.ts";
import { invoices } from "../strings/invoices.ts";
import { chasing } from "../strings/chasing.ts";
import { terms } from "../strings/terms.ts";
import { settings } from "../strings/settings.ts";
import { sheets } from "../strings/sheets.ts";
import { client } from "../strings/client.ts";

/**
 * Parity guard. `en-US` defines the keys; the other seven must each carry a
 * string for every one of them. Each area file types itself this way, so a
 * translation missing an English key is a COMPILE error in that file rather
 * than a silent per-key fallback to English at runtime.
 */
export type Area<EN extends Record<string, string>> = { "en-US": EN } & Record<Exclude<LocaleTag, "en-US">, Translated<EN>>;

/** Every area, by name — what the strings tests walk. */
export const AREAS = {
  chrome,
  home,
  enquiries,
  proposals,
  composer,
  projects,
  review,
  handover,
  clients,
  invoices,
  chasing,
  terms,
  settings,
  sheets,
  client,
} as const;

export const MESSAGES = Object.fromEntries(
  LOCALE_TAGS.map((t) => [t, Object.assign({}, ...Object.values(AREAS).map((a) => (a as Record<LocaleTag, Record<string, string>>)[t] ?? {}))]),
) as Record<LocaleTag, Record<string, string>>;

/** Keys are typed off English — the source of truth — so a typo is a compile error. */
export type MessageKey =
  | keyof (typeof chrome)["en-US"]
  | keyof (typeof home)["en-US"]
  | keyof (typeof enquiries)["en-US"]
  | keyof (typeof proposals)["en-US"]
  | keyof (typeof composer)["en-US"]
  | keyof (typeof projects)["en-US"]
  | keyof (typeof review)["en-US"]
  | keyof (typeof handover)["en-US"]
  | keyof (typeof clients)["en-US"]
  | keyof (typeof invoices)["en-US"]
  | keyof (typeof chasing)["en-US"]
  | keyof (typeof terms)["en-US"]
  | keyof (typeof settings)["en-US"]
  | keyof (typeof sheets)["en-US"]
  | keyof (typeof client)["en-US"];
