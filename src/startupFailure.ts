/**
 * The screen for a startup that failed: the data layer, the configuration or
 * the tables were not there, so the app itself never started.
 *
 * Plain DOM, no React: nothing else has loaded. It is still in the page's
 * language, with its direction, and in its light or dark colours. An English
 * card drawn light over an Arabic dashboard in dark mode reads as a crash.
 * The strings are bundled with the app, so looking one up cannot fail the way
 * the data did.
 *
 * A server's own message (a refusal, a missing table) arrives as text and is
 * shown as sent; the headline and this app's own sentences are translated.
 */
import { RUNTIME_MESSAGES } from "./i18n/messages/runtime.ts";
import { dirFor, type LocaleTag } from "./i18n/locales.ts";

/** This app's name as a failure screen says it: the product's, never a studio's. */
const PRODUCT = "Client Portal";

/** This app's own explanations, by key. */
export type StartupDetailKey = "startup.noConfig" | "startup.noBookingKey" | "startup.noServer" | "startup.deskUnread";

/** What went wrong: one of this app's sentences, or the server's own words. */
export type StartupDetail = { key: StartupDetailKey } | { text: string };

export interface StartupFailureCopy {
  title: string;
  detail: string;
  lang: LocaleTag;
  dir: "ltr" | "rtl";
}

/** The headline for a startup failure, chosen by cause. */
function titleKey(code: string | null): string {
  switch (code) {
    case "NO_CONNECTION":
      return "startup.notConnected";
    case "NO_BACKEND":
      return "startup.noBackend";
    case "SCHEMA_MISMATCH":
      return "startup.schemaMismatch";
    default:
      return "startup.couldNotLoad";
  }
}

function lookup(locale: LocaleTag, key: string): string {
  return RUNTIME_MESSAGES[locale]?.[key] ?? RUNTIME_MESSAGES["en-US"][key] ?? key;
}

/** The words, language and direction of the failure screen. */
export function startupFailureCopy(detail: StartupDetail, code: string | null, locale: LocaleTag): StartupFailureCopy {
  return {
    title: lookup(locale, titleKey(code)).replace("{product}", PRODUCT),
    detail: "key" in detail ? lookup(locale, detail.key) : detail.text,
    lang: locale,
    dir: dirFor(locale),
  };
}

/** Replace `mount`'s content with the failure card. */
export function showStartupFailure(mount: HTMLElement, detail: StartupDetail, code: string | null, locale: LocaleTag): void {
  const copy = startupFailureCopy(detail, code, locale);
  console.error(`[adminium] ${copy.title}: ${copy.detail}`);
  mount.innerHTML = "";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.lang = copy.lang;
  box.dir = copy.dir;
  // `light-dark()` follows the colour scheme the page is shown in; the app's
  // own theme tokens are not there to lean on.
  box.style.cssText =
    "color-scheme:light dark;max-width:34rem;margin:12vh auto;padding:1.5rem;font:400 15px/1.6 system-ui,sans-serif;" +
    "border:1px solid light-dark(#d4d4d8,#3f3f46);border-radius:12px;" +
    "color:light-dark(#18181b,#f4f4f5);background:light-dark(#fff,#18181b)";
  const h = document.createElement("h1");
  h.textContent = copy.title;
  h.style.cssText = "margin:0 0 .5rem;font-size:1.05rem;font-weight:600";
  const p = document.createElement("p");
  p.textContent = copy.detail;
  p.style.cssText = "margin:0;color:light-dark(#52525b,#a1a1aa);white-space:pre-wrap";
  box.append(h, p);
  mount.append(box);
}
