/**
 * The demo card's declaration: the screens that ship, per persona, with
 * their shortcuts and the clock row, labelled in all eight languages — and the
 * `demo.json` it writes is one the website accepts.
 */
import { describe, expect, it } from "vitest";

import { buildDemoJson } from "../demo-emit.ts";
import { CLIENT_VIEWS, DESK_VIEWS } from "./app/routes.ts";
import { DEMO_APP_KEY, DEMO_CLOCK, DEMO_DIR, DEMO_FRAMES, DEMO_LIT_BY, DEMO_PERSONAS, DEMO_SCREENS } from "./demo-card.ts";
import { DEMO_LOCALES, demoJsonIssues } from "./demo-types.ts";
import { DEMO_MESSAGES } from "./demo/strings.ts";
import { HOMOGRAPH_TOKENS, IDEA_IN_LANGUAGE, OTHER_LANGUAGES, SUBSTRING_BANNED, WORD_BANNED } from "./testing/lexicon.ts";

const json = () =>
  buildDemoJson({ appKey: DEMO_APP_KEY, dir: DEMO_DIR, frames: DEMO_FRAMES, screens: DEMO_SCREENS, personas: DEMO_PERSONAS, clock: DEMO_CLOCK, messages: DEMO_MESSAGES });

describe("demo.json", () => {
  it("is one the website accepts, at the demo's own base", () => {
    const doc = json();
    expect(demoJsonIssues(doc, { appKey: "clients", dir: "client-portal" })).toEqual([]);
    expect(doc).toMatchObject({ v: 1, appKey: "clients", base: "/demo/client-portal/app/", frames: ["desktop", "phone"] });
    expect(doc).not.toHaveProperty("modes");
    expect(doc).not.toHaveProperty("toggles");
    expect(doc).not.toHaveProperty("addOns");
  });

  it("offers two personas, and the studio's seventeen screens and the client's ten", () => {
    const doc = json();
    expect(doc.personas?.map((p) => [p.id, p.icon, p.labels["en-US"]])).toEqual([
      ["studio", "pen-tool", "Studio"],
      ["client", "user-round", "Client"],
    ]);
    const of = (persona: string) => doc.screens.filter((s) => s.persona === persona).map((s) => [s.id, s.icon]);
    expect(of("studio")).toEqual([
      ["home", "house"],
      ["enquiries", "inbox"],
      ["proposals", "file-text"],
      ["composer", "square-pen"],
      ["terms", "file-signature"],
      ["projects", "folder-kanban"],
      ["project", "folder-open"],
      ["review", "message-square-dashed"],
      ["handover", "package-check"],
      ["clients", "users-round"],
      ["client", "id-card"],
      ["invoices", "receipt-text"],
      ["invoice", "file-digit"],
      ["chasing", "bell-ring"],
      ["print", "printer"],
      ["settings", "settings"],
      ["archive", "triangle-alert"],
    ]);
    expect(of("client")).toEqual([
      ["entry", "key-round"],
      ["chome", "house"],
      ["cproposal", "file-text"],
      ["cproject", "folder-open"],
      ["cinvoice", "receipt-text"],
      ["cstatement", "scroll-text"],
      ["cbrief", "clipboard-list"],
      ["cwrap", "package-check"],
      ["cna", "circle-slash"],
      ["c404", "file-x"],
    ]);
    expect(doc.screens.every((s) => (s.persona === "studio" ? s.side === "staff" : s.side === "customer"))).toBe(true);
  });

  it("opens only views the app has, and lights a chip for the views it stands for", () => {
    for (const screen of DEMO_SCREENS) {
      expect((screen.persona === "studio" ? (DESK_VIEWS as readonly string[]) : (CLIENT_VIEWS as readonly string[])).includes(screen.view), screen.id).toBe(true);
    }
    for (const [key, id] of Object.entries(DEMO_LIT_BY)) {
      const [persona, view] = key.split(":");
      expect((persona === "studio" ? (DESK_VIEWS as readonly string[]) : (CLIENT_VIEWS as readonly string[])).includes(view!), key).toBe(true);
      expect(DEMO_SCREENS.some((s) => s.id === id && s.persona === persona), key).toBe(true);
    }
  });

  it("carries the fourteen shortcuts, each on its screen", () => {
    const doc = json();
    expect(doc.screens.flatMap((s) => (s.shortcuts ?? []).map((c) => `${s.id}: ${c.labels["en-US"]!} (${c.icon})`))).toEqual([
      "enquiries: A call comes in (phone-incoming)",
      "proposals: The client accepts and signs (pen-line)",
      "composer: Fill a sample proposal (wand-sparkles)",
      "project: The client asks for changes (message-square)",
      "project: The client approves (check)",
      "invoice: Part payment (receipt)",
      "invoice: The client says they paid (hand-coins)",
      "entry: Amara · Hearth & Loaf (wand-sparkles)",
      "entry: An address we don’t know (mail-x)",
      "entry: Open the emailed link (mail-open)",
      "entry: Let the link expire (unplug)",
      "cproposal: Show an out-of-date one (calendar-x)",
      "cproject: Paused work (pause)",
      "cinvoice: An invoice already paid (check-check)",
    ]);
  });

  it("has the clock row: a week on, and back to 28 July", () => {
    expect(json().clock).toEqual({
      advance: [{ id: "1w", labels: expect.objectContaining({ "en-US": "+1 week", "de-DE": "+1 Woche", "ar-EG": "+أسبوع" }) }],
      reset: { labels: expect.objectContaining({ "en-US": "Back to 28 July", "fr-FR": "Retour au 28 juillet" }) },
    });
  });
});

describe("the demo's words", () => {
  it("are in every language, key for key", () => {
    const keys = Object.keys(DEMO_MESSAGES["en-US"]).sort();
    for (const locale of DEMO_LOCALES) expect(Object.keys(DEMO_MESSAGES[locale]).sort(), locale).toEqual(keys);
    for (const locale of DEMO_LOCALES) for (const key of keys) expect(DEMO_MESSAGES[locale][key]!.trim(), `${locale} ${key}`).not.toBe("");
  });

  it("keep the same placeholders in every language", () => {
    const names = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    for (const [key, text] of Object.entries(DEMO_MESSAGES["en-US"])) {
      for (const locale of DEMO_LOCALES) expect(names(DEMO_MESSAGES[locale][key]!), `${locale} ${key}`).toEqual(names(text));
    }
  });

  it("say none of the words the fleet bans, in any language", () => {
    const allowed = new Set(HOMOGRAPH_TOKENS.map((h) => h.token.toLowerCase()));
    const hits: string[] = [];
    for (const locale of DEMO_LOCALES) {
      for (const [key, text] of Object.entries(DEMO_MESSAGES[locale])) {
        for (const token of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
          if (allowed.has(token)) continue;
          if (SUBSTRING_BANNED.some((word) => token.includes(word)) || (WORD_BANNED as readonly string[]).includes(token)) hits.push(`${locale} ${key}: ${token}`);
        }
        if ((OTHER_LANGUAGES as readonly string[]).includes(locale)) {
          for (const [idea, patterns] of Object.entries(IDEA_IN_LANGUAGE[locale as (typeof OTHER_LANGUAGES)[number]])) {
            if (patterns.some((pattern) => pattern.test(text))) hits.push(`${locale} ${key}: ${idea}`);
          }
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
