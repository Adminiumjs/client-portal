/**
 * The strings allowed to read exactly as the English does, and why.
 *
 * A string that equals its English passes every parity check — the key is
 * there, it just says the English — so `identical.test.ts` fails on any such
 * string in any language unless it is named here: in the app's own strings,
 * the manifest's labels, the emails and the demo card. A string with no
 * letters outside its placeholders ("{number} · {title}", "—", "40 / 30 / 30")
 * reads the same everywhere and needs no entry.
 *
 * Each entry is one exact text and the languages it is kept in. An entry
 * nothing matches any more fails the test too, so this list only ever
 * describes what ships.
 *
 * Tests only; nothing that ships imports it.
 */
import type { LocaleTag } from "../i18n/locales.ts";

export interface SameAsEnglish {
  text: string;
  locales: readonly Exclude<LocaleTag, "en-US">[];
  why: string;
}

const ALL7 = ["de-DE", "fr-FR", "da-DK", "cs-CZ", "ar-EG", "zh-CN", "zh-TW"] as const;
const LATIN4 = ["de-DE", "fr-FR", "da-DK", "cs-CZ"] as const;

export const SAME_AS_ENGLISH: readonly SameAsEnglish[] = [
  // ── The same word in that language ─────────────────────────────────────────
  { text: "Budget", locales: ["de-DE", "fr-FR", "da-DK"], why: "the ordinary word for a budget in German, French and Danish" },
  { text: "Client", locales: ["fr-FR"], why: "French for a client" },
  { text: "Clients", locales: ["fr-FR"], why: "French for clients" },
  { text: "Code", locales: ["de-DE", "fr-FR"], why: "a sign-in code is a Code in German and a code in French" },
  { text: "Contact", locales: ["fr-FR"], why: "French for the person to contact" },
  { text: "Date", locales: ["fr-FR"], why: "French for a date" },
  { text: "Description", locales: ["fr-FR"], why: "French for a description" },
  { text: "Document", locales: ["fr-FR"], why: "French for a document" },
  { text: "Documents", locales: ["fr-FR"], why: "French for documents" },
  { text: "{count} document|{count} documents", locales: ["fr-FR"], why: "French, singular and plural, for documents" },
  { text: "Question", locales: ["fr-FR"], why: "French for a question" },
  { text: "Clause", locales: ["fr-FR"], why: "French for a clause of the terms" },
  { text: "Clauses", locales: ["fr-FR"], why: "French for the clauses of the terms" },
  { text: "Note", locales: ["fr-FR", "da-DK"], why: "a note is a note in French and in Danish" },
  { text: "{count} note|{count} notes", locales: ["fr-FR"], why: "French, singular and plural, for notes" },
  { text: "Total", locales: ["fr-FR"], why: "French for the total" },
  { text: "Version", locales: ["de-DE", "fr-FR", "da-DK"], why: "a version is a Version in German and Danish and a version in French" },
  { text: "Versions", locales: ["fr-FR"], why: "French for versions" },
  { text: "{count} version|{count} versions", locales: ["fr-FR"], why: "French, singular and plural, for versions" },
  { text: "Standard", locales: ["fr-FR", "da-DK"], why: "the ordinary word for the default in French and Danish" },
  { text: "Link", locales: ["de-DE", "da-DK"], why: "a web link is a Link in German and a link in Danish" },
  { text: "Name", locales: ["de-DE"], why: "German for a name" },
  { text: "Person", locales: ["de-DE", "da-DK"], why: "German and Danish for a person" },
  { text: "Status", locales: ["de-DE", "da-DK"], why: "the ordinary word for a state of things in German and Danish" },
  { text: "Text", locales: ["de-DE", "cs-CZ"], why: "German and Czech for text" },
  { text: "Role", locales: ["cs-CZ"], why: "Czech for a role" },
  { text: "Licence", locales: ["fr-FR", "cs-CZ"], why: "a font's licence is a licence in French and in Czech" },
  { text: "Studio", locales: ["de-DE", "fr-FR", "cs-CZ"], why: "a design studio is a Studio in German and a studio in French and Czech" },
  { text: "optional", locales: ["de-DE"], why: "German for optional" },
  { text: "For", locales: ["da-DK"], why: "Danish for “for”, naming the invoice a receipt is for" },
  { text: "Send", locales: ["da-DK"], why: "Danish for “send”, the imperative of sende" },
  { text: "Start", locales: ["da-DK"], why: "Danish for starting a clock" },
  { text: "Stop", locales: ["da-DK"], why: "Danish for stopping a clock" },
  { text: "Under {amount}", locales: ["da-DK"], why: "Danish for “under” an amount" },
  { text: "Reference: {id}", locales: ["da-DK"], why: "Danish for the reference a payment carries" },
  { text: "Reference: {{invoice.number}}", locales: ["da-DK"], why: "Danish for the reference a payment carries, in the invoice email" },
  { text: "{{payment.number}} · for {{invoice.number}} · {{payment.amount}}", locales: ["da-DK"], why: "Danish: a payment “for” an invoice" },

  // ── A word the language has borrowed and uses as its own ──────────────────
  { text: "Software", locales: ["de-DE", "da-DK", "cs-CZ"], why: "the word German, Danish and Czech use for software" },
  { text: "Website", locales: ["de-DE"], why: "the word German uses for a website" },
  { text: "Subtotal", locales: ["da-DK"], why: "the word Danish invoices use for the sum before tax" },
  { text: "Brief", locales: ["fr-FR", "da-DK", "cs-CZ"], why: "what a studio's brief is called in French, Danish and Czech agencies" },
  { text: "Briefs", locales: ["fr-FR", "da-DK"], why: "the plural of the borrowed “brief” in French and Danish" },

  // ── A unit, or a paper size by the name printers give it ──────────────────
  { text: "216 × 279 mm", locales: LATIN4, why: "millimetres are mm in these languages" },
  { text: "{h} h", locales: ["fr-FR", "cs-CZ"], why: "hours are h in French and Czech" },
  { text: "{n} h", locales: ["fr-FR", "cs-CZ"], why: "hours are h in French and Czech" },
  { text: "{m} min", locales: ["fr-FR", "cs-CZ"], why: "minutes are min in French and Czech" },
  { text: "{n} min", locales: ["fr-FR", "cs-CZ"], why: "minutes are min in French and Czech" },
  { text: "A4", locales: ALL7, why: "the paper size's name, the same on every printer" },
  { text: "v{n}", locales: ["de-DE", "fr-FR", "da-DK", "cs-CZ", "zh-CN", "zh-TW"], why: "a version's short tag, the way these languages' studios tag files (Arabic says الإصدار)" },
  { text: "Letter", locales: ["de-DE", "da-DK", "cs-CZ", "ar-EG"], why: "the US paper size's name as printers in these languages show it" },

  // ── Data, not words: an example of what to type, a name, an address ───────
  { text: "Ada Moreno", locales: LATIN4, why: "an example person's name" },
  { text: "Rosa Vento", locales: LATIN4, why: "an example contact's name" },
  { text: "Kit Alderman", locales: ALL7, why: "an example person's name" },
  { text: "Alderman Cycles", locales: ALL7, why: "an example business's name" },
  { text: "AM", locales: ALL7, why: "example initials: a person's tile shows Latin initials in every language, as the sample's own people's do" },
  { text: "kit@aldermancycles.example", locales: ALL7, why: "an example email address" },
  { text: "rosa@ventoandsons.example", locales: ALL7, why: "an example email address" },
  { text: "name@studio.example", locales: ALL7, why: "an example email address" },
  { text: "you@yourbrand.example", locales: ["ar-EG", "zh-CN", "zh-TW"], why: "an example email address, kept in the letters an address is typed in" },
  { text: "you@yourbusiness.example", locales: ["ar-EG", "zh-CN", "zh-TW"], why: "an example email address, kept in the letters an address is typed in" },
  { text: "https://www.figma.com/file/…", locales: ALL7, why: "an example web address" },
  { text: "Amara · Hearth & Loaf", locales: ALL7, why: "the sample client's contact and business, by name" },
];
