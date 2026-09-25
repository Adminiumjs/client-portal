/**
 * The enquiry form's own reasoning: what it refuses before sending (the same
 * rules the studio's server applies), exactly what it sends, and that every
 * answer the server can give is said in words in every language.
 */
import { PUBLIC_ERROR_CODES } from "@adminiumjs/public-client";
import { describe, expect, it } from "vitest";

import { LOCALE_TAGS } from "../../../i18n/locales.ts";
import { MESSAGES } from "../../../i18n/messages/index.ts";
import type { Outcome } from "../../../state/outcome.ts";
import { BUDGETS, EMPTY, MAX, OTHERWISE, REFUSAL_WORDS, budgetWords, formProblems, payloadOf, plainName, refusalWords, shortMoney, type EnquireInput } from "./model.ts";

const FILLED: EnquireInput = {
  name: " Rosa Vento ",
  email: " rosa@ventoandsons.example ",
  business: " Vento & Sons ",
  trade: "Tile shop",
  budget: "2to4k",
  start_when: "",
  body: " A sign and a name people can find. ",
};

const refused = (code: string, column: string | null = null, reason: "invalid" | "busy" | "offline" = "invalid"): Outcome<unknown> => ({
  ok: false,
  reason,
  code,
  field: column,
  details: column === null ? {} : { column },
  unfinished: null,
});

/** Every code the enquiry door itself can answer with (the rest belong to sign-in, bookings and kiosks). */
const DOOR_CODES = [
  "PUBLIC_API_DISABLED",
  "PUBLIC_KEY_INVALID",
  "PUBLIC_KEY_OFF",
  "PUBLIC_SWITCHED_OFF",
  "APP_DISABLED",
  "SURFACE_OFF",
  "PUBLIC_ORIGIN_REFUSED",
  "PUBLIC_RATE_LIMITED",
  "PUBLIC_PROOF_REQUIRED",
  "PUBLIC_REF_NOT_FOUND",
  "PUBLIC_ACTION_NOT_ALLOWED",
  "PUBLIC_WRITE_REFUSED",
  "PUBLIC_WRITE_REJECTED",
  "PUBLIC_LIMIT_REACHED",
  "PUBLIC_NETWORK_UNAVAILABLE",
  "PUBLIC_UPSTREAM_UNAVAILABLE",
];

describe("before anything is sent", () => {
  it("asks for a name, an address to answer and what they want", () => {
    expect(formProblems(EMPTY).map((p) => [p.field, p.key])).toEqual([
      ["name", "enquire.error.nameEmpty"],
      ["email", "enquire.error.emailEmpty"],
      ["body", "enquire.error.bodyEmpty"],
    ]);
    expect(formProblems(FILLED)).toEqual([]);
    expect(formProblems({ ...FILLED, email: "rosa@" })).toEqual([{ field: "email", key: "enquire.error.emailShape" }]);
    expect(formProblems({ ...FILLED, body: "   " })).toEqual([{ field: "body", key: "enquire.error.bodyEmpty" }]);
  });

  it("holds a name to the server's rule for a stranger's name: letters, spaces, ordinary punctuation, 80 at most, no link", () => {
    for (const ok of ["Rosa Vento", "Zoë O’Brien-Smith", "Kit (Alderman)", "Dr. A. Okafor & Partners", "李小龙", "رحمة الله", "Ødegård, Jens"]) expect(plainName(ok), ok).toBe(true);
    for (const bad of ["Rosa 2", "<b>Rosa</b>", "<b>Rosa", "Rosa > Vento", "Rosa=Vento", "Rosa\"Vento", "Rosa_Vento", "Rosa\nVento", "Rosa http://x.example", "www.spam", "Rosa@vento", "Rosa; DROP", "a".repeat(81), "=HYPERLINK(1)"]) {
      expect(plainName(bad), bad).toBe(false);
      expect(formProblems({ ...FILLED, name: bad }).find((p) => p.field === "name")?.key, bad).toBe(bad.trim() === "" ? "enquire.error.nameEmpty" : "enquire.error.namePlain");
    }
  });

  it("stops each field at what its column holds", () => {
    expect(formProblems({ ...FILLED, business: "x".repeat(MAX.business + 1) })).toEqual([{ field: "business", key: "enquire.error.tooLong" }]);
    expect(formProblems({ ...FILLED, trade: "x".repeat(MAX.trade + 1) })).toEqual([{ field: "trade", key: "enquire.error.tooLong" }]);
    expect(formProblems({ ...FILLED, start_when: "x".repeat(MAX.start_when + 1) })).toEqual([{ field: "start_when", key: "enquire.error.tooLong" }]);
    expect(formProblems({ ...FILLED, body: "x".repeat(MAX.body + 1) })).toEqual([{ field: "body", key: "enquire.error.tooLong" }]);
    expect(formProblems({ ...FILLED, email: `${"x".repeat(250)}@a.example` })).toEqual([{ field: "email", key: "enquire.error.emailShape" }]);
  });
});

describe("what is sent", () => {
  it("is the form's own seven fields, trimmed, the budget as its words, an empty field as nothing — never a status, a source or a number", () => {
    const sent = payloadOf(FILLED, (band) => `band:${band}`);
    expect(sent).toEqual({
      name: "Rosa Vento",
      email: "rosa@ventoandsons.example",
      body: "A sign and a name people can find.",
      business: "Vento & Sons",
      trade: "Tile shop",
      budget: "band:2to4k",
      start_when: null,
    });
    expect(Object.keys(sent).sort()).toEqual(["body", "budget", "business", "email", "name", "start_when", "trade"]);
  });

  it("leaves out a NUL byte a paste can carry", () => {
    const sent = payloadOf({ ...FILLED, body: "A sign\u0000 and a name.", business: "\u0000" }, String);
    expect(sent.body).toBe("A sign and a name.");
    expect(sent.business).toBeNull();
  });

  it("sends no budget for 'not sure', nor for a value the page never offered", () => {
    expect(payloadOf({ ...FILLED, budget: "" }, String).budget).toBeNull();
    expect(payloadOf({ ...FILLED, budget: "1000000" }, String).budget).toBeNull();
    expect(payloadOf({ ...FILLED, budget: "__proto__" }, String).budget).toBeNull();
  });

  it("says each band in the studio's currency, in the visitor's language", () => {
    const say = (locale: (typeof LOCALE_TAGS)[number]) => (key: string, params: Record<string, string | number> = {}) =>
      (MESSAGES[locale][key] ?? "").replace(/\{(\w+)\}/g, (_hole, name: string) => String(params[name]));
    const usd = shortMoney("en-US", "USD");
    expect(BUDGETS.map((band) => budgetWords(band, say("en-US") as never, usd))).toEqual(["Under $1K", "$1K–$2K", "$2K–$4K", "$4K–$8K", "$8K or more"]);
    for (const locale of LOCALE_TAGS) {
      for (const band of BUDGETS) {
        const words = budgetWords(band, say(locale) as never, shortMoney(locale, "USD"));
        expect(words, `${locale} ${band}`).not.toMatch(/\{|undefined/);
        expect(words.length, `${locale} ${band}`).toBeGreaterThan(2);
      }
    }
    // A currency code the browser does not know still reads as a number.
    expect(shortMoney("en-US", "NOT-A-CODE")(2000)).toBe("2K");
  });
});

describe("every answer in words", () => {
  it("words each code the door can answer with, in every language — none falls to the general words", () => {
    for (const code of DOOR_CODES) {
      expect(PUBLIC_ERROR_CODES as readonly string[], code).toContain(code);
      const words = refusalWords(refused(code));
      expect(words, code).not.toBeNull();
      expect(words, code).not.toBe(OTHERWISE);
      for (const locale of LOCALE_TAGS) expect(MESSAGES[locale][words!.key], `${locale} ${code}`).toBeTruthy();
    }
  });

  it("still says something, and offers the studio's address, for any code at all", () => {
    for (const code of [...PUBLIC_ERROR_CODES, "SOMETHING_NEW"]) {
      const words = refusalWords(refused(code));
      expect(words, code).not.toBeNull();
      for (const locale of LOCALE_TAGS) expect(MESSAGES[locale][words!.key], `${locale} ${code}`).toBeTruthy();
    }
    expect(refusalWords(refused("SOMETHING_NEW"))).toEqual(OTHERWISE);
    expect(OTHERWISE.writeInstead).toBe(true);
    expect(MESSAGES["en-US"]["enquire.refused.writeTo"]).toContain("{email}");
  });

  it("points at the field the server named, and words a column the form never sends as the form's problem, not a field", () => {
    expect(refusalWords(refused("PUBLIC_WRITE_REFUSED", "name"))).toMatchObject({ field: "name", key: "enquire.error.namePlain" });
    expect(refusalWords(refused("PUBLIC_WRITE_REFUSED", "email"))).toMatchObject({ field: "email", key: "enquire.error.emailShape" });
    expect(refusalWords(refused("PUBLIC_WRITE_REFUSED", "business"))).toMatchObject({ field: "business", key: "enquire.refused.written" });
    expect(refusalWords(refused("PUBLIC_WRITE_REFUSED", "status"))).toMatchObject({ field: null, key: "enquire.refused.written" });
    expect(refusalWords(refused("PUBLIC_WRITE_REFUSED"))).toMatchObject({ field: null, key: "enquire.refused.written" });
  });

  it("tells a limit apart from a mistake: try later, or write instead", () => {
    expect(REFUSAL_WORDS["PUBLIC_LIMIT_REACHED"]).toMatchObject({ key: "enquire.refused.limit", tone: "warn", writeInstead: true });
    expect(REFUSAL_WORDS["PUBLIC_RATE_LIMITED"]).toMatchObject({ key: "enquire.refused.busy", tone: "warn", writeInstead: false });
    expect(REFUSAL_WORDS["PUBLIC_PROOF_REQUIRED"]).toMatchObject({ key: "enquire.refused.check", writeInstead: true });
    // A refusal the shared layer read as "busy" or "offline" with a code of its own still reads right.
    expect(refusalWords(refused("NUMBER_BUSY", null, "busy"))?.key).toBe("enquire.refused.busy");
    expect(refusalWords(refused("ECONNRESET", null, "offline"))?.key).toBe("enquire.refused.offline");
    expect(refusalWords({ ok: true, value: null })).toBeNull();
  });
});
