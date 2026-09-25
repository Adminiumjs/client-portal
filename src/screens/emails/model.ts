/**
 * The studio's emails as the person receiving them sees them.
 *
 *   the list      every email the app sends — twelve to clients (the sign-in
 *                 link is Adminium's own), nine to the studio — in the order
 *                 the Emails screen shows them
 *   the document  each one's template: the one Adminium keeps (the operator
 *                 may have edited it in Email Templates) when the desk can
 *                 read it, else the template this app ships in the same
 *                 language — the words the outbox sends
 *   filled        the template with a sample's values put in its `{{…}}`
 *                 places, as Adminium puts them in when it sends
 *   plain         the plain-text lines of the same email
 *   a test        the filled email with every link into the clients' side
 *                 made harmless: no sign-in link, no share link, nothing
 *                 left to fill — checked before anything is sent
 */
import type { EmailDocument } from "../../data/ports.ts";
import type { LocaleTag } from "../../i18n/locales.ts";
import { RUNTIME_MESSAGES } from "../../i18n/messages/runtime.ts";
import { emailTemplates } from "../../manifest/emails.ts";
import { KINDS, type Kind } from "../../manifest/outbox.ts";

/** An email the app sends: one of its outbox's kinds, or Adminium's sign-in link. */
export type EmailKind = Kind | "sign-in-link";

/** To clients, in the order the screen lists them. */
export const CLIENT_EMAILS: readonly EmailKind[] = [
  "sign-in-link",
  "proposal-sent",
  "proposal-reminder",
  "invoice-sent",
  "invoice-rung-1",
  "invoice-rung-2",
  "invoice-rung-3",
  "payment-receipt",
  "new-work",
  "handover",
  "enquiry-reply",
  "ask-to-sign",
];

/** To the studio (its reply-to address), in the order the screen lists them. */
export const STUDIO_EMAILS: readonly EmailKind[] = [
  "accepted-and-signed",
  "declined",
  "asked-for-a-new-price",
  "changes-requested",
  "approved",
  "new-note",
  "client-says-paid",
  "brief-sent",
  "new-enquiry",
];

export const isStudioEmail = (kind: EmailKind): boolean => STUDIO_EMAILS.includes(kind);

/** The template's key in Adminium's Email Templates. */
export const templateKey = (kind: EmailKind): string => (kind === "sign-in-link" ? "sign-in-link" : `clients-${kind}`);

/** Adminium's locale id for a page language (`en-US` → `en_US`). */
export const adminiumLocale = (tag: LocaleTag): string => tag.replace("-", "_");

export interface EmailBlock {
  id: string;
  block: string;
  data: Record<string, unknown>;
}

export interface EmailDoc extends EmailDocument {
  /** The template's name, as Email Templates lists it. */
  name: string;
}

interface ShippedTemplate {
  key: string;
  name: Record<string, string>;
  locales: Record<string, { subject: string; preheader?: string; blocks: { block: string; id?: string; data?: Record<string, unknown> }[]; footer?: string }>;
}

let shipped: Map<string, ShippedTemplate> | null = null;

/** The templates this app ships (the ones Adminium installs with it). */
function shippedTemplates(): Map<string, ShippedTemplate> {
  shipped ??= new Map((emailTemplates(KINDS) as ShippedTemplate[]).map((t) => [t.key, t]));
  return shipped;
}

/** A page string in the email's language, not the page's. */
function word(tag: LocaleTag, key: string): string {
  return RUNTIME_MESSAGES[tag]?.[key] ?? RUNTIME_MESSAGES["en-US"]?.[key] ?? key;
}

/**
 * The sign-in link's email as Adminium's own template writes it: a heading,
 * the line about the link, the button, the other-device line, the code and
 * the notice. Used where the desk cannot read Adminium's copy.
 */
function signInLinkDoc(tag: LocaleTag): EmailDoc {
  const w = (key: string) => word(tag, `emails.signIn.${key}`);
  return {
    name: w("name"),
    subject: w("subject"),
    preheader: w("preheader"),
    blocks: [
      { id: "heading", block: "email.heading", data: { text: w("heading") } },
      { id: "intro", block: "email.text", data: { paras: [w("intro")] } },
      { id: "action", block: "email.button", data: { label: w("action"), url: "{{link}}" } },
      { id: "other-device", block: "email.text", data: { paras: [w("codeIntro")] } },
      { id: "code", block: "email.box", data: { label: w("codeLabel"), value: "{{code}}" } },
      { id: "notice", block: "email.text", data: { paras: [w("notice")] } },
    ],
    footer: "{{appName}}",
  };
}

/** The template this app ships for an email, in a language (US English when it has none in it). */
export function shippedDoc(kind: EmailKind, tag: LocaleTag): EmailDoc {
  if (kind === "sign-in-link") return signInLinkDoc(tag);
  const template = shippedTemplates().get(templateKey(kind));
  if (template === undefined) throw new Error(`no template for ${kind}`);
  const content = template.locales[tag] ?? template.locales["en-US"]!;
  return {
    name: template.name[tag] ?? template.name["en-US"] ?? kind,
    subject: content.subject,
    preheader: content.preheader ?? "",
    blocks: content.blocks.map((b, i) => ({ id: b.id ?? `${b.block.slice("email.".length)}-${String(i + 1)}`, block: b.block, data: b.data ?? {} })),
    footer: content.footer ?? "",
  };
}

// ── filling the places ──────────────────────────────────────────────────────

/** `{{name}}` places, as Adminium's templates write them. */
const PLACE = /\{\{\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\}\}/g;

/** The names a text leaves to fill. */
export const placesIn = (text: string): string[] => [...text.matchAll(PLACE)].map((m) => m[1]!);

/** A text with its places filled; a place the sample has no value for reads as its name in brackets. */
export function fill(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(PLACE, (_, name: string) => values[name] ?? `[${name}]`);
}

/** Every string inside a block's data, filled. */
function fillData(data: unknown, values: Readonly<Record<string, string>>): unknown {
  if (typeof data === "string") return fill(data, values);
  if (Array.isArray(data)) return data.map((d) => fillData(d, values));
  if (typeof data === "object" && data !== null) return Object.fromEntries(Object.entries(data).map(([k, v]) => [k, fillData(v, values)]));
  return data;
}

/** The email with a sample's values in every place. */
export function filled(doc: EmailDoc, values: Readonly<Record<string, string>>): EmailDoc {
  return {
    name: doc.name,
    subject: fill(doc.subject, values),
    preheader: fill(doc.preheader, values),
    blocks: doc.blocks.map((b) => ({ id: b.id, block: b.block, data: fillData(b.data, values) as Record<string, unknown> })),
    footer: fill(doc.footer, values),
  };
}

// ── what the card draws ─────────────────────────────────────────────────────

/** One piece of the drawn email, in the order the template has it. */
export type Piece =
  | { kind: "lead"; text: string }
  | { kind: "para"; text: string }
  | { kind: "code"; text: string }
  | { kind: "quote"; text: string }
  | { kind: "rows"; rows: { a: string; b: string; c: string }[] }
  | { kind: "box"; label: string; lines: string[]; reference: string | null }
  | { kind: "button"; label: string; url: string }
  | { kind: "after"; text: string }
  | { kind: "sign"; text: string };

const str = (value: unknown): string => (typeof value === "string" ? value : "");
const paras = (data: Record<string, unknown>): string[] => (Array.isArray(data["paras"]) ? (data["paras"] as unknown[]).map(str) : str(data["text"]) === "" ? [] : [str(data["text"])]).filter((p) => p.trim() !== "");

/** A six-digit code the way the email sets it: two groups of three. */
export const spacedCode = (code: string): string => code.replace(/^(\d{3})(\d{3})$/, "$1 $2");

/**
 * The pieces of a filled email: the greeting or the heading leads, the
 * paragraphs follow, a list becomes rows (its " · " parts side by side), the
 * payment box takes the reference line under it, the code shows large, and
 * the sign-off closes. A paragraph after the button reads as the small print.
 */
export function pieces(doc: EmailDoc): Piece[] {
  const out: Piece[] = [];
  let sawButton = false;
  for (const b of doc.blocks) {
    const d = b.data;
    if (b.block === "email.heading") {
      if (str(d["text"]) !== "") out.push({ kind: "lead", text: str(d["text"]) });
    } else if (b.block === "email.text") {
      const texts = paras(d);
      if (texts.length === 0) continue;
      if (b.id === "greeting") out.push({ kind: "lead", text: texts.join(" ") });
      else if (b.id === "sign-off") out.push({ kind: "sign", text: texts.join(" ") });
      else if (b.id === "reference" && out[out.length - 1]?.kind === "box") (out[out.length - 1] as Extract<Piece, { kind: "box" }>).reference = texts.join(" ");
      else for (const text of texts) out.push({ kind: sawButton && b.id === "notice" ? "after" : "para", text });
    } else if (b.block === "email.quote") {
      if (str(d["text"]).trim() !== "") out.push({ kind: "quote", text: str(d["text"]) });
    } else if (b.block === "email.list") {
      const items = Array.isArray(d["items"]) ? (d["items"] as unknown[]).map(str).filter((s) => s.trim() !== "") : [];
      if (items.length > 0) out.push({ kind: "rows", rows: items.map((item) => { const [a = "", b2 = "", ...rest] = item.split(" · "); return { a, b: b2, c: rest.join(" · ") }; }) });
    } else if (b.block === "email.box") {
      if (b.id === "code") out.push({ kind: "code", text: spacedCode(str(d["value"])) });
      else if (str(d["value"]).trim() !== "") out.push({ kind: "box", label: str(d["label"]), lines: str(d["value"]).split("\n").filter((l) => l.trim() !== ""), reference: null });
    } else if (b.block === "email.button") {
      if (str(d["label"]) !== "") {
        out.push({ kind: "button", label: str(d["label"]), url: str(d["url"]) });
        sawButton = true;
      }
    }
  }
  return out;
}

/** Where the email's button goes, if it has one. */
export const buttonOf = (ps: readonly Piece[]): Extract<Piece, { kind: "button" }> | null => (ps.find((p) => p.kind === "button") as Extract<Piece, { kind: "button" }> | undefined) ?? null;

/** The plain-text email, line by line: the same pieces as text, then the footer after `--`. */
export function plainLines(ps: readonly Piece[], footer: string): { text: string; tone: "body" | "link" | "foot" }[] {
  const out: { text: string; tone: "body" | "link" | "foot" }[] = [];
  for (const p of ps) {
    if (p.kind === "lead" || p.kind === "para" || p.kind === "after" || p.kind === "sign") out.push({ text: p.text, tone: "body" });
    else if (p.kind === "code") out.push({ text: p.text, tone: "link" });
    else if (p.kind === "quote") out.push({ text: `> ${p.text}`, tone: "body" });
    else if (p.kind === "rows") for (const r of p.rows) out.push({ text: [r.a, r.b, r.c].filter((x) => x !== "").join("  ·  "), tone: "body" });
    else if (p.kind === "box") out.push({ text: `${p.label}:\n${[...p.lines, ...(p.reference === null ? [] : [p.reference])].join("\n")}`, tone: "body" });
    else if (p.kind === "button") out.push({ text: `${p.label}: ${p.url}`, tone: "link" });
  }
  if (footer.trim() !== "") out.push({ text: `--\n${footer}`, tone: "foot" });
  return out;
}

// ── a test, to the studio's own address ─────────────────────────────────────

/** What a test email must never carry, and where its links may go instead. */
export interface TestGuard {
  /** Where a link into the clients' side goes in a test: the portal's front page, which asks for a link. */
  portal: string;
  /** Every share code the desk holds: none of them may appear in a test. */
  secrets: readonly string[];
}

/** A token riding a link's fragment (`/c#…`, `/h#…`): what makes a link open something on its own. */
const TOKEN_IN_LINK = /\/[a-z]*#[A-Za-z0-9_-]{8,}/;

/** The first thing that would make a test email dangerous to send, or null when there is nothing. */
export function testProblem(doc: EmailDocument, guard: Pick<TestGuard, "secrets">): "unfilled" | "live-link" | null {
  const text = JSON.stringify(doc);
  if (placesIn(text).length > 0) return "unfilled";
  if (TOKEN_IN_LINK.test(text)) return "live-link";
  for (const secret of guard.secrets) if (secret.length >= 6 && text.includes(secret)) return "live-link";
  return null;
}

/**
 * The document a test sends: the filled email with every button to the
 * clients' side pointed at the portal's front page (a desk link needs the
 * studio's own sign-in, so it stays). The studio notices go to the desk.
 */
export function testDocument(doc: EmailDoc, studio: boolean, guard: TestGuard): EmailDocument {
  return {
    subject: doc.subject,
    preheader: doc.preheader,
    footer: doc.footer,
    blocks: doc.blocks.map((b) => (b.block === "email.button" && !studio ? { ...b, data: { ...b.data, url: guard.portal } } : b)),
  };
}
