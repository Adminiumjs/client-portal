/*
 * VENDORED VERBATIM from packages/add-on-contracts/src/document-render.ts.
 * Never hand-edit this copy: change the monorepo package and re-run
 * `node scripts/sync-manifest-validator.mjs`.
 *
 * WHY A COPY. `@adminium/manifest` is not published to npm and this app is a
 * standalone repo that must build from a clean clone, so it cannot depend on
 * the monorepo. It lives under `testing/` because `zod` is a devDependency
 * here and a runtime dependency the host does not carry — nothing in
 * the shipped bundle's import graph may reach it, which sources.test.ts gates.
 *
 * The only edits are import specifiers: `.js` becomes `.ts`, and the
 * `@adminium/add-on-contracts` package import becomes relative ones.
 */
/**
 * `document-render@1` (Appendices A and B) — the fourth contract, and the
 * first one Adminium ITSELF consumes.
 *
 * It provides KINDS OF DOCUMENT an add-on can describe — an outline of slots,
 * every label written in all eight compiled locales — and render to BYTES. The
 * consumer is the engine document pipeline (profiles, the record trigger, the
 * `document.render` job, the `/documents` routes), which is the first
 * production read of `runtime.providers`: a provider is selected by the
 * profile's add-on key, never by `resolveProvider`'s lowest-key choice.
 *
 * ── THE SUBJECT IS THE ONLY DOOR (31 A.1's rule, applied to a contract) ─────
 *
 * A provider receives VALUES and returns BYTES. It gets no database handle, no
 * network, and — the one that gets forgotten — no clock: `subject.now` is the
 * only time it may read, which is what makes byte-identical claim testable
 * rather than aspirational. `describeDocumentRenderer` renders twice and
 * compares every byte.
 *
 * ── BYTES, NOT A `FileRef` ─────────────────────────────────────────────────
 *
 * {@link RenderedDocument.bytes} is a `Uint8Array`. `FileRef.bytes`
 * (`common.ts:14,22`) is a COUNT, and a provider that returned one would be
 * claiming it had already stored the file — which it cannot do, having no file
 * seam. The engine stores what comes back; the provider never does.
 *
 * ── PER-KIND `formats` AND `coverage`, AND WHY THEY ARE ON THE KIND ────────
 *
 * "HTML always, PDF always" is NOT this contract's law. `label-sheet` is
 * `['pdf']` with nothing to say in HTML; `receipt` draws on 80 mm paper no A4
 * consumer wants. And a writer that draws Helvetica's WinAnsi repertoire
 * cannot draw Arabic or Han — so a kind declares the glyphs it covers and
 * REFUSES what it cannot draw, typed, as {@link DocumentError} `LATIN_ONLY`
 * carrying the offending glyphs. A silent drop would ship an invoice with a
 * customer's name missing letters.
 *
 * ── THE `body` CHANNEL IS A ONE-WAY DOOR, AND IT IS OPEN ───────────────────
 *
 * This module ships verbatim into eighteen repos before the first
 * provider exists, so a field added later is a second eighteen-repo ceremony
 * plus a second contract release. {@link RenderInput.body} is therefore here in
 * the first release. Its shape was ruled on 2026-09-07: an opaque
 * `Readonly<Record<string, unknown>>` whose schema the PROVIDER owns. A
 * typed union would have frozen the redesigned comp's 27 block kinds
 * (`Invoice Builder.dc.html` blockOrder:1114, custom:1266-1272) into a
 * contract eighteen repos vendor, making every later block a contract release.
 *
 * A starter is a TEMPLATE PRESET, not a kind (the same ruling) — which is why
 * `kinds()` stays at three for the invoices provider while the surface offers
 * twelve starters over eight titles.
 */

import { z } from 'zod';

/**
 * The eight compiled locales, HYPHENATED — the spelling the add-ons repo
 * already writes (`barcode-labels/src/i18n/strings.ts`, and the `LOCALES`
 * array repeated in `host/src/app-neutral.test.ts:435`).
 *
 * **[DEP-33 — a departure from Appendix B, forced and minimal.]** Appendix B
 * names this type `BuiltinLocaleId`. `@adminium/i18n` ALREADY exports a
 * `BuiltinLocaleId` (`locales.ts:82`) and its members are the UNDERSCORE
 * spellings — `en_US`, `ar_EG`. Two same-named unions with different members
 * is not a nuisance, it is a data bug waiting in `apps/server`, which will
 * import both the moment 34b wires the pipeline: `'en-US'` assigned where
 * `'en_US'` is meant fails no compile and produces a missing translation at
 * run time. So the contract's type is named for the contract. The MEMBERS are
 * Appendix B's, unchanged.
 */
export const DOCUMENT_LOCALE_IDS = [
  'ar-EG',
  'cs-CZ',
  'da-DK',
  'de-DE',
  'en-US',
  'fr-FR',
  'zh-CN',
  'zh-TW',
] as const;

export type DocumentLocaleId = (typeof DOCUMENT_LOCALE_IDS)[number];

/**
 * A string in every one of the eight locales. There is no fallback and no
 * partial: a record missing one locale fails `describeDocumentRenderer`
 * (0.3 trap 19), because the Studio profile editor renders these labels
 * directly and a hole in one language becomes a raw slot id on somebody's
 * screen. The server half of an add-on carries its own strings — the engine
 * needs no bundle from it.
 */
export type LocalizedText = Readonly<Record<DocumentLocaleId, string>>;

export const localizedTextSchema = z
  .object(
    Object.fromEntries(
      DOCUMENT_LOCALE_IDS.map((id) => [id, z.string().min(1)]),
    ) as Record<DocumentLocaleId, z.ZodString>,
  )
  .strict();

/** What a kind may be rendered to. */
export const DOCUMENT_FORMATS = ['html', 'pdf'] as const;
export type DocumentFormat = (typeof DOCUMENT_FORMATS)[number];

/** The paper a kind is drawn for. `a6` is a card (105 × 148 mm); `receipt-80mm` is a till roll, not a sheet. */
export const DOCUMENT_PAPERS = ['a4', 'letter', 'a6', 'receipt-80mm'] as const;
export type DocumentPaper = (typeof DOCUMENT_PAPERS)[number];

/**
 * Which glyphs the kind's PDF writer can draw.
 *
 * `ascii` — 0x20..0x7E only (barcode-labels' scaffold: every byte is ASCII, so
 * `String.length` is the byte length and the xref offsets are exact).
 * `winansi` — the 224 drawable code points of WinAnsiEncoding, which is base-14
 * Helvetica's repertoire: Latin-1 plus €, the smart quotes and the dashes.
 * `all` — no refusal is possible; nothing claims it yet.
 */
export const DOCUMENT_COVERAGES = ['ascii', 'winansi', 'all'] as const;
export type DocumentCoverage = (typeof DOCUMENT_COVERAGES)[number];

export interface DocumentKind {
  /** `invoice` | `receipt` | `credit-note` | `label-sheet` | … */
  id: string;
  label: LocalizedText;
  /** PER KIND. `label-sheet` is `['pdf']`; "html always" is not the law. */
  formats: readonly DocumentFormat[];
  paper: readonly DocumentPaper[];
  /** The suite's `é ß ø €` assertion runs only where coverage includes them. */
  coverage: DocumentCoverage;
}

export const documentKindSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/, 'kind id must be kebab-case'),
    label: localizedTextSchema,
    formats: z.array(z.enum(DOCUMENT_FORMATS)).min(1),
    paper: z.array(z.enum(DOCUMENT_PAPERS)).min(1),
    coverage: z.enum(DOCUMENT_COVERAGES),
  })
  .strict();

/** The value types a slot can carry. `money` is integer minor units; `percent` is basis points. */
export const OUTLINE_SLOT_TYPES = [
  'text',
  'text[]',
  'date',
  'email',
  'money',
  'percent',
  'currency',
  'number',
  'collection',
  'qr',
] as const;
export type OutlineSlotType = (typeof OUTLINE_SLOT_TYPES)[number];

/**
 * A `qr` slot's value, made by the host (a provider needs no encoder): the
 * text it encodes, its modules as rows of `0` and `1` with no quiet zone
 * around them (a provider draws them as squares), and the same code as a PNG
 * data URL (for a provider that draws HTML). A provider that declares a `qr`
 * slot needs a host that knows the type.
 */
export interface DocumentQrValue {
  text: string;
  modules: readonly string[];
  png: string;
}

export const documentQrValueSchema = z
  .object({
    text: z.string().min(1).max(64),
    // Version 1 (21 modules) to version 40 (177), square.
    modules: z.array(z.string().regex(/^[01]+$/)).min(21).max(177),
    png: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
  })
  .strict()
  .refine((value) => value.modules.every((row) => row.length === value.modules.length), {
    message: 'a QR code is square: as many modules in each row as there are rows',
    path: ['modules'],
  });

/**
 * Where an unmapped slot's value comes from, if anywhere.
 *
 * `sequence` — the engine's CAS document number, minted after render.
 * `connection` — the connection's currency. `setting` — one of the add-on's
 * own non-secret settings. `now` — `subject.now.iso`, never the provider's own
 * clock.
 */
export const OUTLINE_SLOT_DEFAULTS = ['sequence', 'connection', 'setting', 'now'] as const;
export type OutlineSlotDefault = (typeof OUTLINE_SLOT_DEFAULTS)[number];

export interface OutlineSlot {
  id: string;
  /** The Studio mapping editor's row label — never a raw id on a screen. */
  label: LocalizedText;
  help?: LocalizedText;
  type: OutlineSlotType;
  required: boolean;
  default?: OutlineSlotDefault;
  /** For `collection` only — the columns of one row. Never nested twice. */
  columns?: readonly OutlineSlot[];
}

const outlineSlotShape = {
  id: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'slot id must be an identifier'),
  label: localizedTextSchema,
  help: localizedTextSchema.optional(),
  type: z.enum(OUTLINE_SLOT_TYPES),
  required: z.boolean(),
  default: z.enum(OUTLINE_SLOT_DEFAULTS).optional(),
};

/** One column of a `collection`. A column is never itself a collection. */
export const outlineLeafSlotSchema = z.object(outlineSlotShape).strict();

/**
 * The depth limit is in the SCHEMA, not in a comment.
 *
 * `OutlineSlot.columns` is typed `readonly OutlineSlot[]` (Appendix B), which
 * would admit a collection of collections; nothing maps one, no renderer draws
 * one, and the Studio mapping editor has no row for one. So the validator
 * accepts exactly two levels and refuses the third — a provider that returns a
 * nested collection fails `describeDocumentRenderer` with a parse error naming
 * the slot, rather than passing here and rendering an empty table later.
 */
export const outlineSlotSchema = z
  .object({ ...outlineSlotShape, columns: z.array(outlineLeafSlotSchema).optional() })
  .strict();

export interface DocumentOutline {
  slots: readonly OutlineSlot[];
}

export const documentOutlineSchema = z
  .object({ slots: z.array(outlineSlotSchema) })
  .strict();

/**
 * A soft reference to the record a document was issued for.
 *
 * Structurally the same object as `@adminium/meta`'s `recordRefSchema`
 * (`json-payloads.ts:17-25`), which is the AUTHORITY for the shape; it is
 * restated here because this package has no `node:` and no meta dependency by
 * design. A file that imports both should alias one — they are two
 * declarations of one shape, not two shapes.
 */
export interface RecordRef {
  connectionId: string;
  /** Qualified source name, e.g. `public.orders`. */
  table: string;
  /** Full PK map — composite keys included. */
  pk: Readonly<Record<string, unknown>>;
  /** Display snapshot taken at write time. */
  label: string;
}

/**
 * What a PUBLIC caller may send: values, and nothing that decides anything.
 * The server stamps `business`, `now`, `currency`, `entity: null` and
 * `number: null` itself — a request that carries one of them is refused
 * `INVALID_REQUEST` rather than quietly overwritten, so a customer cannot
 * post a document that claims to come from a different business or to have
 * been issued last year.
 *
 * `customerEmail` is stored on the row and NEVER sent unattended: delivery
 * starts `pending-review` and a person presses send.
 */
export interface PublicDocumentRequest {
  kind: string;
  locale?: string;
  /** Scalar slots by id. Money arrives as a decimal string, coerced server-side. */
  fields: Readonly<Record<string, unknown>>;
  collections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
  customerEmail?: string;
}

export const publicDocumentRequestSchema = z
  .object({
    kind: z.string().min(1),
    locale: z.string().min(2).optional(),
    fields: z.record(z.string(), z.unknown()),
    collections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
    // Loose on purpose, the way `emailTestSendBody` is
    // (`apps/server/src/routes/email-templates/schema.ts:160-165`): the SMTP
    // relay is the real authority on what it will accept, and this address is
    // stored for a person to review before anything is sent.
    customerEmail: z.string().trim().min(3).max(320).optional(),
  })
  .strict();

export interface DocumentSubject {
  /** The only clock the provider may read. */
  now: { iso: string; timezone: string };
  locale: string;
  /** ISO-4217. */
  currency: string;
  /**
   * The letterhead, from the rendering add-on's own settings. The last three
   * are optional and additive: a business's tax number, how to pay it, and a
   * line for the foot of the page — an older server never sends them, and a
   * provider draws each only when it is there.
   */
  business: {
    name: string;
    lines: readonly string[];
    logoDataUrl?: string;
    taxNumber?: string;
    paymentInstructions?: string;
    footer?: string;
  };
  /** `null` for request-shaped intents. */
  entity: RecordRef | null;
  /** `null` until minted; a re-render carries the number it already has. */
  number: string | null;
  /** Scalar slots by id. Money is INTEGER MINOR UNITS; percent is BASIS POINTS. */
  fields: Readonly<Record<string, unknown>>;
  collections: Readonly<Record<string, readonly Readonly<Record<string, unknown>>[]>>;
}

export const documentSubjectSchema = z
  .object({
    now: z.object({ iso: z.string().min(1), timezone: z.string().min(1) }).strict(),
    locale: z.string().min(2),
    currency: z.string().length(3),
    business: z
      .object({
        name: z.string().min(1),
        lines: z.array(z.string()),
        logoDataUrl: z.string().optional(),
        taxNumber: z.string().max(80).optional(),
        paymentInstructions: z.string().max(2000).optional(),
        footer: z.string().max(500).optional(),
      })
      .strict(),
    entity: z
      .object({
        connectionId: z.string(),
        table: z.string(),
        pk: z.record(z.string(), z.unknown()),
        label: z.string(),
      })
      .strict()
      .nullable(),
    number: z.string().nullable(),
    fields: z.record(z.string(), z.unknown()),
    collections: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  })
  .strict();

export interface RenderInput {
  kind: string;
  subject: DocumentSubject;
  formats: readonly DocumentFormat[];
  paper: DocumentPaper;
  /** The add-on's own non-secret values. A secret never reaches a renderer. */
  settings: Readonly<Record<string, unknown>>;
  /**
   * The authored composition, when there is one — the redesigned comp makes a
   * document's BODY per-record data (`blockOrder`, the 18 `*Show` flags, the
   * `custom[]` entries and ~70 authored fields), and none of that can be drawn
   * from `subject`, which is a slot map.
   *
   * OPAQUE BY RULING (2026-09-07): the provider owns the schema and
   * validates it. Absent for a purely mapped render.
   */
  body?: Readonly<Record<string, unknown>>;
}

export interface RenderedDocument {
  format: DocumentFormat;
  filename: string;
  mediaType: string;
  /** The document itself. NOT a `FileRef` — that one's `bytes` is a count. */
  bytes: Uint8Array;
  locale: string;
  warnings: readonly string[];
}

export const renderedDocumentSchema = z
  .object({
    format: z.enum(DOCUMENT_FORMATS),
    filename: z.string().min(1),
    mediaType: z.string().min(1),
    bytes: z.instanceof(Uint8Array),
    locale: z.string().min(2),
    warnings: z.array(z.string()),
  })
  .strict();

/**
 * A refusal is DATA, returned — never thrown, and never a silent partial
 * result. `shipping-carrier`'s `CarrierError` is a class because a carrier's
 * own words have to reach the screen verbatim; here every refusal is one of
 * four things the engine can act on, so a union of codes is the honest shape.
 */
export const DOCUMENT_ERROR_CODES = [
  /** A glyph the kind's writer cannot draw. `dropped` names them. */
  'LATIN_ONLY',
  /** `render`/`describe` was called with a kind `kinds()` does not list. */
  'UNSUPPORTED_KIND',
  /** A slot the outline marks `required` had no value. */
  'MISSING_SLOT',
  /** The subject did not parse — a wrong type, a malformed body. */
  'INVALID_SUBJECT',
] as const;
export type DocumentErrorCode = (typeof DOCUMENT_ERROR_CODES)[number];

export interface DocumentError {
  code: DocumentErrorCode;
  detail?: string;
  /** `LATIN_ONLY` only: the glyphs that could not be drawn. Never empty when set. */
  dropped?: readonly string[];
}

export const documentErrorSchema = z
  .object({
    code: z.enum(DOCUMENT_ERROR_CODES),
    detail: z.string().optional(),
    dropped: z.array(z.string()).optional(),
  })
  .strict();

/** Narrows `render`'s union without a `code in x` incantation at every call site. */
export function isDocumentError(
  value: readonly RenderedDocument[] | DocumentError,
): value is DocumentError {
  return !Array.isArray(value);
}

export interface DocumentRenderer {
  /** The add-on's key — how a profile names the provider it wants. */
  readonly key: string;
  kinds(): readonly DocumentKind[];
  describe(kind: string): DocumentOutline;
  render(input: RenderInput): Promise<readonly RenderedDocument[] | DocumentError>;
}
