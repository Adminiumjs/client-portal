/**
 * The studio's tables, as the manifest asks Adminium to make them.
 *
 * Everything the desk and the clients' pages read or write is here, and so is
 * every rule the server keeps on their behalf, because a rule the browser
 * keeps is a rule another browser can skip:
 *
 *   - proposals and invoices are built on the Invoices & Receipts add-on's
 *     shapes (`quote@1`, `invoice@1`): their numbers run without gaps, their
 *     lines, tax, totals, what is paid and what is still owed are worked out by
 *     the server, and a sent document is locked and voided, never deleted;
 *   - a client's details, a proposal's signature and fingerprint, who posted a
 *     version and when a deliverable was approved are stamped by the server;
 *   - every child row carries the client it belongs to, copied from its
 *     parent — for the desk's lists only: what a client may see is decided by
 *     the parent row their session reaches, never by this column.
 *
 * The shape tables spell out the add-on's columns and rules beside the
 * studio's own: they are generated here from the copy of the shapes in
 * `src/testing/shapes/invoices.json`, so they agree with it by construction,
 * and Adminium checks them against the installed add-on when the app installs.
 */
import SHAPES from "./vendored/invoices-shapes.json" with { type: "json" };
import { l, type Labels } from "./labels.ts";

type Tone = "pos" | "warn" | "danger" | "info" | "neutral" | "accent";

export interface Column {
  ref: string;
  type: "int" | "text" | "decimal" | "bool" | "enum" | "date" | "timestamptz" | "fk";
  role?: "pk" | "created_at";
  semantic?: "name" | "email" | "image" | "money";
  nullable?: true;
  enum?: string[];
  references?: string;
  default?: string | number | boolean;
  maxLength?: number;
  unique?: true;
  scale?: number | "currency";
  rules?: Record<string, unknown>;
  label?: Labels;
}

export interface Table {
  ref: string;
  label: Labels;
  labelPlural: Labels;
  keyField?: string;
  builtOn?: string;
  part?: string;
  states?: Record<string, unknown>;
  columns: Column[];
}

// ── column makers ───────────────────────────────────────────────────────────

const id: Column = { ref: "id", type: "int", role: "pk" };
const opt = { nullable: true } as const;

/** The desk's per-action key: a retried create finds the row the first try saved. */
const clientKey: Column = { ref: "client_key", type: "text", maxLength: 36, nullable: true, unique: true, label: l("Action key") };

function text(ref: string, maxLength: number | null, label: string, more: Partial<Column> = {}): Column {
  return { ref, type: "text", ...(maxLength === null ? {} : { maxLength }), label: l(label), ...more };
}
function int(ref: string, label: string, more: Partial<Column> = {}): Column {
  return { ref, type: "int", label: l(label), ...more };
}
function bool(ref: string, label: string, value: boolean): Column {
  return { ref, type: "bool", default: value, label: l(label) };
}
function decimal(ref: string, label: string, scale: number | "currency", more: Partial<Column> = {}): Column {
  return { ref, type: "decimal", scale, label: l(label), ...more };
}
function fk(ref: string, references: string, label: string, nullable = false, more: Partial<Column> = {}): Column {
  return { ref, type: "fk", references, label: l(label), ...(nullable ? opt : {}), ...more };
}
function date(ref: string, label: string, more: Partial<Column> = {}): Column {
  return { ref, type: "date", label: l(label), ...more };
}
function at(ref: string, label: string, more: Partial<Column> = {}): Column {
  return { ref, type: "timestamptz", label: l(label), ...more };
}
/** An enum whose values read as words, with the tone each shows in. */
function choice(
  ref: string,
  label: string,
  values: Record<string, string>,
  more: Partial<Column> & { tones?: Record<string, Tone> } = {},
): Column {
  const { tones, rules, ...rest } = more;
  return {
    ref,
    type: "enum",
    enum: Object.keys(values),
    label: l(label),
    ...rest,
    rules: {
      ...rules,
      enumLabels: {
        labels: Object.fromEntries(Object.entries(values).map(([value, word]) => [value, l(word)])),
        ...(tones === undefined ? {} : { tones }),
      },
    },
  };
}
/** The client a child row belongs to, copied from its parent whenever the parent link is written. */
function clientOf(via: string): Column {
  return { ref: "client_id", type: "fk", references: "clients", nullable: true, label: l("Client"), rules: { copy: { via, from: "client_id", mode: "always" } } };
}
/** Written by the server when something happens (see the manifest's `stamp`). */
function stamp(set: unknown, on: unknown): Record<string, unknown> {
  return { stamp: { set, on } };
}
const onCreate = "create";
function when(column: string, ...values: (string | boolean)[]): Record<string, unknown> {
  return { column, values };
}

/**
 * A time entry's hours: the typed ones, else the clock's from its start to its stop, to the
 * nearest quarter hour and never under a quarter.
 */
const CLOCK_HOURS = {
  coalesce: ["logged_hours", { max: [0.25, { div: [{ round: [{ mul: [{ hoursBetween: ["started_at", "stopped_at"] }, 4] }, 0] }, 4] }] }],
};

// ── the add-on's shapes, spelled out ────────────────────────────────────────

interface ShapeColumn extends Omit<Column, "label"> {
  label?: unknown;
}
interface ShapePart {
  columns: ShapeColumn[];
  states?: Record<string, unknown>;
}
interface Shape {
  name: string;
  version: number;
  parts: Record<string, ShapePart>;
}

const SHAPE_ADD_ON = (SHAPES as { addOn: string }).addOn;
/** A vendored shape by `<name>@<version>`. */
const shapeOf = (id: string): Shape => {
  const [name, version] = id.split("@");
  const found = (SHAPES as { shapes: Shape[] }).shapes.find((shape) => shape.name === name && String(shape.version) === version);
  if (found === undefined) throw new Error(`the vendored shapes have no "${id}"`);
  return found;
};

/**
 * One part of a shape as this app's table: the shape's columns with their
 * rules untouched, every part it names swapped for this app's table built on
 * that part, and each column given the studio's word for it.
 */
function partColumns(shape: string, part: string, tableOf: Record<string, string>, labels: Record<string, string>): Column[] {
  const map = (value: string) => {
    const target = value.includes("/") ? value : `${shape}/${value}`;
    const found = tableOf[target];
    if (found === undefined) throw new Error(`no table of this app is built on ${target}`);
    return found;
  };
  const mapRules = (rules: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (rules === undefined) return undefined;
    const rollup = rules["rollup"] as { from: string } | undefined;
    return rollup === undefined ? rules : { ...rules, rollup: { ...rollup, from: map(rollup.from) } };
  };
  return shapeOf(shape).parts[part]!.columns.map((column) => {
    const { label: _label, ...rest } = column;
    const word = labels[column.ref];
    if (word === undefined && column.role !== "pk") throw new Error(`${shape}/${part}.${column.ref} has no label here`);
    const mapped = mapRules(rest.rules);
    return {
      ...rest,
      ...(rest.references === undefined ? {} : { references: map(rest.references) }),
      ...(mapped === undefined ? {} : { rules: mapped }),
      ...(word === undefined ? {} : { label: l(word) }),
    } as Column;
  });
}

/** A part's states, with its child parts named as this app's tables, and what the app adds. */
function partStates(
  shape: string,
  part: string,
  tableOf: Record<string, string>,
  extend: { except?: string[]; clearOnCreate?: Record<string, string[]>; roles?: Record<string, string[]>; children?: Record<string, Record<string, unknown>> } = {},
): Record<string, unknown> {
  const states = structuredClone(shapeOf(shape).parts[part]!.states!) as {
    moves: Record<string, (string | { to: string; requires?: { children?: Record<string, number> }; roles?: string[] })[]>;
    lock?: { when: string[]; except?: string[] };
    children?: Record<string, { via: string; clearOnCreate?: string[] }>;
  };
  const map = (value: string) => tableOf[`${shape}/${value}`] ?? value;
  for (const [from, moves] of Object.entries(states.moves)) {
    states.moves[from] = moves.map((move) => {
      if (typeof move === "string") {
        const roles = extend.roles?.[`${from}>${move}`];
        return roles === undefined ? move : { to: move, roles };
      }
      const children = move.requires?.children;
      const roles = extend.roles?.[`${from}>${move.to}`];
      return {
        ...move,
        ...(children === undefined ? {} : { requires: { ...move.requires, children: Object.fromEntries(Object.entries(children).map(([ref, n]) => [map(ref), n])) } }),
        ...(roles === undefined ? {} : { roles }),
      };
    });
  }
  if (states.lock !== undefined && extend.except !== undefined) {
    states.lock.except = [...(states.lock.except ?? []), ...extend.except];
  }
  if (states.children !== undefined) {
    states.children = Object.fromEntries(
      Object.entries(states.children).map(([ref, rule]) => {
        const own = extend.clearOnCreate?.[map(ref)];
        const cleared = own === undefined ? rule : { ...rule, clearOnCreate: [...(rule.clearOnCreate ?? []), ...own] };
        return [map(ref), { ...cleared, ...extend.children?.[map(ref)] }];
      }),
    );
  }
  return states as unknown as Record<string, unknown>;
}

/** Which table of this app is built on each part: `invoice@1/document` → `invoices`. */
const BUILT: Record<string, string> = {
  "invoice@1/document": "invoices",
  "invoice@1/lines": "invoice_lines",
  "invoice@1/payments": "payments",
  "quote@1/document": "proposals",
  "quote@1/lines": "proposal_lines",
};
const builtOn = (shape: string, part: string) => ({ builtOn: `${SHAPE_ADD_ON}/${shape}`, part });

/** The studio's words for the shapes' columns. */
const DOCUMENT_WORDS: Record<string, string> = {
  number_seq: "Number in the series",
  number: "Number",
  status: "Status",
  currency: "Currency",
  tax_name: "Tax",
  tax_rate: "Tax rate",
  subtotal: "Subtotal",
  tax: "Tax amount",
  total: "Total",
  sent_at: "Sent",
};
const INVOICE_WORDS: Record<string, string> = {
  ...DOCUMENT_WORDS,
  issued_on: "Issued on",
  terms: "Payment terms",
  due_on: "Due on",
  paid: "Paid",
  balance: "Still owed",
  ladder: "Reminders",
  void_reason: "Why it was voided",
  voided_at: "Voided",
  voided_by: "Voided by",
  from_quote_id: "From the proposal",
  share_pct: "Share of the proposal",
};
const QUOTE_WORDS: Record<string, string> = {
  ...DOCUMENT_WORDS,
  valid_until: "Holds until",
  decided_at: "Decided",
  withdraw_reason: "Why it was withdrawn",
};
const LINE_WORDS: Record<string, string> = {
  document_id: "Document",
  position: "Position",
  description: "Description",
  qty: "Quantity",
  rate: "Rate",
  discount_kind: "Discount kind",
  discount: "Discount",
  currency: "Currency",
  quote_id: "Proposal",
  share_pct: "Share of the proposal",
  amount: "Amount",
};
const PAYMENT_WORDS: Record<string, string> = {
  document_id: "Invoice",
  number_seq: "Number in the series",
  number: "Receipt number",
  amount: "Amount",
  currency: "Currency",
  method: "Paid by",
  method_note: "Payment note",
  paid_on: "Paid on",
  recorded_by: "Recorded by",
  recorded_at: "Recorded",
  voided: "Voided",
  void_reason: "Why it was voided",
  voided_by: "Voided by",
  voided_at: "Voided on",
};

/** The shape's enum columns, given the studio's words for their values. */
function withWords(columns: Column[], words: Record<string, Record<string, string>>): Column[] {
  return columns.map((column) => {
    const values = words[column.ref];
    if (values === undefined) return column;
    return {
      ...column,
      rules: {
        ...column.rules,
        enumLabels: { labels: Object.fromEntries(Object.entries(values).map(([value, word]) => [value, l(word)])) },
      },
    };
  });
}

const INVOICE_STATUS = { draft: "Draft", sent: "Sent", void: "Void" };
const QUOTE_STATUS = { draft: "Draft", sent: "Sent", accepted: "Accepted", declined: "Declined", withdrawn: "Withdrawn" };
const TERMS = { net7: "7 days", net14: "14 days", net30: "30 days", "on-receipt": "On receipt" };
const LADDER = { gentle: "Gentle", standard: "Standard", firm: "Firm" };
const DISCOUNT_KIND = { amount: "Amount off", percent: "Percent off" };
const METHOD = { "bank-transfer": "Bank transfer", card: "Card", cheque: "Cheque", cash: "Cash", other: "Other" };

// ── the tables ──────────────────────────────────────────────────────────────

/** The client-side emails and the studio's notices each have a switch in settings. */
const NOTIFY: [string, string][] = [
  ["notify_accepted", "Tell us when a proposal is accepted"],
  ["notify_declined", "Tell us when a proposal is declined"],
  ["notify_files", "Tell us when work is approved or sent back"],
  ["notify_paid", "Tell us when a client says they have paid"],
  ["notify_brief", "Tell us when a brief is sent"],
  ["notify_new_price", "Tell us when a client asks for a new price"],
  ["notify_notes", "Tell us when a client writes a note"],
  ["notify_enquiry", "Tell us about new enquiries"],
];

export const TABLES: Table[] = [
  {
    ref: "settings",
    label: l("Studio settings"),
    labelPlural: l("Studio settings"),
    keyField: "name",
    columns: [
      id,
      // One row, and a second is refused: the value is fixed and unique.
      text("singleton", 16, "Settings row", { unique: true, default: "studio", rules: { options: { values: [{ value: "studio" }] } } }),
      text("name", 120, "Studio name", opt),
      text("mark", 255, "Studio mark", opt),
      // The studio's own address and number, which its clients read: a business's, not personal data.
      text("reply_to", 254, "Reply-to address", { ...opt, rules: { personal: false, validation: { format: "email" } } }),
      text("phone", 40, "Phone", { ...opt, rules: { personal: false } }),
      text("website", 200, "Website", { ...opt, rules: { validation: { format: "url" } } }),
      text("sign_off", 500, "How we sign off", opt),
      int("hours_per_day", "Hours in a working day", { default: 6 }),
      int("days_per_week", "Days in a working week", { default: 4 }),
      ...NOTIFY.map(([ref, label]) => bool(ref, label, true)),
    ],
  },
  {
    ref: "people",
    label: l("Person"),
    labelPlural: l("People"),
    keyField: "name",
    columns: [
      id,
      text("name", 120, "Name", { semantic: "name" }),
      text("role_label", 80, "Role", opt),
      text("initials", 4, "Initials", opt),
      text("email", 254, "Email", { ...opt, semantic: "email", rules: { normalize: "email", validation: { format: "email" } } }),
      text("user_id", 36, "Adminium user", opt),
      bool("shown_to_clients", "Shown to clients", true),
      int("position", "Position", { default: 0 }),
      int("days_per_week", "Days a week", opt),
    ],
  },
  {
    ref: "rates",
    label: l("Rate"),
    labelPlural: l("Rate card"),
    keyField: "label",
    columns: [
      id,
      text("label", 120, "What it is"),
      decimal("amount", "Amount", "currency", { semantic: "money" }),
      decimal("hours_per_unit", "Hours it stands for", 2, opt),
      int("position", "Position", { default: 0 }),
      bool("active", "In use", true),
    ],
  },
  {
    ref: "terms_versions",
    label: l("Terms version"),
    labelPlural: l("Terms versions"),
    keyField: "version",
    columns: [
      id,
      int("version", "Version", { ...opt, rules: { sequence: { gapless: true } } }),
      choice("status", "Status", { draft: "Draft", in_force: "In force", retired: "Retired" }, { default: "draft", tones: { draft: "neutral", in_force: "pos", retired: "neutral" } }),
      date("in_force_from", "In force from", opt),
      text("note", 500, "What changed", opt),
      clientKey,
    ],
    // A version a client has been sent is never edited again: the next change is a new version.
    states: {
      column: "status",
      initial: "draft",
      moves: { draft: ["in_force"], in_force: ["retired"] },
      lock: { when: ["retired"] },
      children: { terms_clauses: { via: "version_id", lock: true } },
      lockedWhenReferencedBy: [{ table: "proposals", via: "terms_version_id", in: ["sent", "accepted", "declined", "withdrawn"] }],
    },
  },
  {
    ref: "terms_clauses",
    label: l("Clause"),
    labelPlural: l("Clauses"),
    keyField: "title",
    columns: [
      id,
      fk("version_id", "terms_versions", "Terms version"),
      int("position", "Position", { default: 0 }),
      text("title", 200, "Title"),
      text("body", null, "Text", opt),
      choice("change", "Change", { added: "Added", changed: "Changed", same: "Same" }, { default: "same", tones: { added: "pos", changed: "warn", same: "neutral" } }),
      text("change_note", 500, "What changed", opt),
      clientKey,
    ],
  },
  {
    ref: "brief_questions",
    label: l("Brief question"),
    labelPlural: l("Brief questions"),
    keyField: "question",
    columns: [
      id,
      text("key", 40, "Key", { unique: true }),
      text("question", 300, "Question"),
      text("hint", 300, "Hint", opt),
      choice("kind", "Answer", { text: "A line", area: "A paragraph" }, { default: "area" }),
      int("position", "Position", { default: 0 }),
      bool("active", "Asked", true),
    ],
  },
  {
    ref: "clients",
    label: l("Client"),
    labelPlural: l("Clients"),
    keyField: "company",
    columns: [
      id,
      text("company", 160, "Company", { semantic: "name" }),
      text("trade", 80, "Trade", opt),
      text("contact_name", 120, "Contact"),
      // Stored trimmed and in lower case, so the unique index and the sign-in agree on every database.
      text("email", 254, "Email", { unique: true, semantic: "email", rules: { normalize: "email", validation: { format: "email" } } }),
      text("phone", 40, "Phone", opt),
      text("address", 500, "Address", opt),
      text("tax_number", 60, "Tax number", opt),
      choice("terms", "Payment terms", TERMS, opt),
      decimal("tax_rate", "Tax rate", 3, opt),
      text("language", 16, "Language", opt),
      text("tint", 16, "Colour", opt),
      at("created_at", "Created", { role: "created_at", default: "now" }),
      clientKey,
    ],
  },
  {
    ref: "client_notes",
    label: l("Client note"),
    labelPlural: l("Client notes"),
    columns: [
      id,
      fk("client_id", "clients", "Client"),
      text("body", null, "Note"),
      text("by", 120, "Written by", { ...opt, rules: stamp("user-name", onCreate) }),
      at("at", "Written", { ...opt, rules: stamp("now", onCreate) }),
    ],
  },
  {
    ref: "enquiries",
    label: l("Enquiry"),
    labelPlural: l("Enquiries"),
    keyField: "number",
    columns: [
      id,
      int("number_seq", "Number in the series", { ...opt, rules: { sequence: { gapless: true } } }),
      text("number", 24, "Number", { ...opt, unique: true, rules: { format: { from: "number_seq", prefix: "ENQ-", pad: 3 } } }),
      text("business", 160, "Business", opt),
      text("name", 120, "Name", { semantic: "name" }),
      text("email", 254, "Email", { ...opt, semantic: "email", rules: { normalize: "email", validation: { format: "email" } } }),
      text("trade", 80, "Trade", opt),
      text("budget", 60, "Budget", opt),
      text("start_when", 60, "When they want to start", opt),
      text("source", 60, "How they found us", opt),
      choice("fit", "Fit", { good: "Good fit", maybe: "Maybe", no: "Not for us" }, { ...opt, tones: { good: "pos", maybe: "warn", no: "neutral" } }),
      text("body", null, "What they wrote", { ...opt, rules: { validation: { maxLength: 4000 } } }),
      choice(
        "status",
        "Status",
        { new: "New", replied: "Replied", parked: "Parked", proposal: "Proposal", declined: "Declined" },
        { default: "new", tones: { new: "info", replied: "neutral", parked: "neutral", proposal: "pos", declined: "neutral" } },
      ),
      date("parked_until", "Parked until", opt),
      fk("client_id", "clients", "Client", true),
      fk("proposal_id", "proposals", "Proposal", true),
      at("received_at", "Received", { ...opt, rules: stamp("now", onCreate) }),
      clientKey,
    ],
  },
  {
    ref: "proposals",
    label: l("Proposal"),
    labelPlural: l("Proposals"),
    keyField: "number",
    ...builtOn("quote@1", "document"),
    columns: [
      ...withWords(partColumns("quote@1", "document", BUILT, QUOTE_WORDS), { status: QUOTE_STATUS }),
      fk("client_id", "clients", "Client"),
      text("title", 200, "Title"),
      text("scope", null, "Scope", opt),
      choice("split", "How it is paid", { "5050": "Half now, half at handover", "403030": "40 / 30 / 30", end: "All at the end" }, { default: "5050" }),
      fk("terms_version_id", "terms_versions", "Terms version", true),
      fk("revision_of", "proposals", "Revision of", true),
      text("signed_name", 120, "Signed by", opt),
      text("signed_email", 254, "Signed with", { ...opt, rules: stamp({ claim: "email" }, when("status", "accepted")) }),
      at("signed_at", "Signed", { ...opt, rules: stamp("now", { column: "signed_name", filled: true }) }),
      text("fingerprint", 64, "Fingerprint", {
        ...opt,
        rules: stamp(
          {
            hashOf: {
              columns: ["number", "title", "scope", "split", "currency", "tax_rate", "subtotal", "tax", "total", "valid_until", "signed_name", "signed_email"],
              children: [{ table: "proposal_lines", via: "document_id", columns: ["position", "description", "qty", "rate", "discount_kind", "discount", "amount"], orderBy: "position" }],
              linked: [
                {
                  via: "terms_version_id",
                  table: "terms_versions",
                  columns: ["version"],
                  children: [{ table: "terms_clauses", via: "version_id", columns: ["position", "title", "body"], orderBy: "position" }],
                },
              ],
            },
          },
          [when("status", "accepted"), { column: "signed_name", filled: true }],
        ),
      }),
      choice("accepted_how", "Accepted by", { portal: "The portal", email: "Email", call: "A call", meeting: "A meeting" }, { ...opt, rules: stamp({ byOrigin: { public: "portal" } }, when("status", "accepted")) }),
      text("decline_note", 1000, "Why they declined", opt),
      bool("new_price_asked", "Asked for a new price", false),
      at("new_price_asked_at", "New price asked", { ...opt, rules: stamp("now", when("new_price_asked", true)) }),
      clientKey,
    ],
    states: partStates("quote@1", "document", BUILT, {
      except: ["signed_name", "signed_email", "signed_at", "fingerprint", "accepted_how", "decline_note", "new_price_asked", "new_price_asked_at"],
    }),
  },
  {
    ref: "proposal_lines",
    label: l("Proposal line"),
    labelPlural: l("Proposal lines"),
    ...builtOn("quote@1", "lines"),
    columns: [...withWords(partColumns("quote@1", "lines", BUILT, LINE_WORDS), { discount_kind: DISCOUNT_KIND }), clientOf("document_id"), clientKey],
  },
  {
    ref: "projects",
    label: l("Project"),
    labelPlural: l("Projects"),
    keyField: "name",
    columns: [
      id,
      int("number_seq", "Number in the series", { ...opt, rules: { sequence: { gapless: true } } }),
      text("number", 24, "Number", { ...opt, unique: true, rules: { format: { from: "number_seq", prefix: "PRJ-", pad: 3 } } }),
      fk("client_id", "clients", "Client"),
      fk("proposal_id", "proposals", "Proposal", true, { unique: true }),
      text("name", 200, "Name", { semantic: "name" }),
      choice("status", "Status", { active: "Active", paused: "Paused", done: "Done" }, { default: "active", tones: { active: "pos", paused: "warn", done: "neutral" } }),
      text("pause_note", 500, "Why it is paused", opt),
      date("started_on", "Started", { ...opt, rules: stamp("today", onCreate) }),
      date("done_on", "Finished", { ...opt, rules: stamp("today", when("status", "done")) }),
      text("share_token", 16, "Handover link code", { ...opt, unique: true, rules: { code: { length: 16 } } }),
      date("share_expires_on", "Handover link expires", opt),
      bool("share_stopped", "Handover link stopped", false),
      at("share_stopped_at", "Handover link stopped on", { ...opt, rules: stamp("now", when("share_stopped", true)) }),
      text("handover_notes", null, "Handover notes", opt),
      bool("handover_sent", "Handover sent", false),
      at("handover_sent_at", "Handover sent on", { ...opt, rules: stamp("now", when("handover_sent", true)) }),
      clientKey,
    ],
    states: {
      column: "status",
      initial: "active",
      // Reopening a finished project is a manager's call.
      moves: { active: ["paused", "done"], paused: ["active", "done"], done: [{ to: "active", roles: ["studio-manager"] }] },
    },
  },
  {
    ref: "project_fonts",
    label: l("Font"),
    labelPlural: l("Fonts"),
    keyField: "name",
    columns: [id, fk("project_id", "projects", "Project"), clientOf("project_id"), text("name", 120, "Name"), text("licence", 200, "Licence", opt), int("position", "Position", { default: 0 }), clientKey],
  },
  {
    ref: "handover_files",
    label: l("Handover file"),
    labelPlural: l("Handover files"),
    columns: [
      id,
      fk("project_id", "projects", "Project"),
      clientOf("project_id"),
      text("file", 255, "File", opt),
      // A handover item may be a link instead of a file (a shared folder, a font's page).
      text("link", 500, "Link", { ...opt, rules: { validation: { format: "url" } } }),
      text("note", 300, "Note", opt),
      int("position", "Position", { default: 0 }),
      clientKey,
    ],
  },
  {
    ref: "milestones",
    label: l("Milestone"),
    labelPlural: l("Milestones"),
    keyField: "title",
    columns: [
      id,
      fk("project_id", "projects", "Project"),
      clientOf("project_id"),
      text("title", 200, "Title"),
      date("due_on", "Due on", opt),
      choice("state", "State", { next: "Next", now: "Now", done: "Done" }, { default: "next", tones: { next: "neutral", now: "info", done: "pos" } }),
      at("done_at", "Done", { ...opt, rules: stamp("now", when("state", "done")) }),
      decimal("estimated_days", "Estimated days", 1, opt),
      int("position", "Position", { default: 0 }),
      clientKey,
    ],
  },
  {
    ref: "deliverables",
    label: l("Deliverable"),
    labelPlural: l("Deliverables"),
    keyField: "title",
    columns: [
      id,
      fk("project_id", "projects", "Project"),
      clientOf("project_id"),
      fk("milestone_id", "milestones", "Milestone", true),
      text("title", 200, "Title"),
      text("icon", 40, "Icon", opt),
      choice(
        "status",
        "Status",
        { unshared: "Not shared", pending: "Waiting for review", approved: "Approved", changes: "Changes asked" },
        { default: "unshared", tones: { unshared: "neutral", pending: "info", approved: "pos", changes: "warn" } },
      ),
      at("shared_at", "Shared", { ...opt, rules: stamp("now", when("status", "pending")) }),
      at("reviewed_at", "Reviewed", { ...opt, rules: stamp("now", when("status", "approved", "changes")) }),
      text("review_note", 1000, "What they said", opt),
      choice("approved_how", "Approved by", { portal: "The portal", email: "Email", call: "A call", meeting: "A meeting" }, { ...opt, rules: stamp({ byOrigin: { public: "portal" } }, when("status", "approved")) }),
      // Stamped for the clients' side only: a studio's "approved by email on 24 Jul" keeps its own day.
      date("approved_on", "Approved on", { ...opt, rules: stamp({ byOrigin: { public: "today" } }, when("status", "approved")) }),
      text("approved_by", 120, "Marked approved by", { ...opt, rules: stamp({ claim: "contact_name", staff: "user-name" }, when("status", "approved")) }),
      int("position", "Position", { default: 0 }),
      clientKey,
    ],
    states: {
      column: "status",
      initial: "unshared",
      // A version sent back goes to review again; the studio may still mark the current one approved.
      moves: { unshared: ["pending"], pending: ["approved", "changes", "unshared"], changes: ["pending", "approved"] },
    },
  },
  {
    ref: "deliverable_versions",
    label: l("Version"),
    labelPlural: l("Versions"),
    columns: [
      id,
      fk("deliverable_id", "deliverables", "Deliverable"),
      clientOf("deliverable_id"),
      int("v", "Version", { ...opt, rules: { sequence: { gapless: true, scope: "deliverable_id" } } }),
      text("file", 255, "File", opt),
      text("link", 500, "Link", { ...opt, rules: { validation: { format: "url" } } }),
      text("note", 500, "Note", opt),
      text("posted_by", 120, "Posted by", { ...opt, rules: stamp("user-name", onCreate) }),
      at("posted_at", "Posted", { ...opt, rules: stamp("now", onCreate) }),
      clientKey,
    ],
  },
  {
    ref: "deliverable_notes",
    label: l("Review note"),
    labelPlural: l("Review notes"),
    columns: [
      id,
      fk("deliverable_id", "deliverables", "Deliverable"),
      clientOf("deliverable_id"),
      fk("version_id", "deliverable_versions", "Version", true),
      choice("side", "From", { studio: "The studio", client: "The client" }, { ...opt, rules: stamp({ byOrigin: { public: "client", staff: "studio" } }, onCreate) }),
      text("author", 120, "Written by", { ...opt, rules: stamp({ claim: "contact_name", staff: "user-name" }, onCreate) }),
      text("body", null, "Note"),
      decimal("pin_x", "Pin across", 4, opt),
      decimal("pin_y", "Pin down", 4, opt),
      at("at", "Written", { ...opt, rules: stamp("now", onCreate) }),
      clientKey,
    ],
  },
  {
    ref: "briefs",
    label: l("Brief"),
    labelPlural: l("Briefs"),
    columns: [
      id,
      fk("project_id", "projects", "Project", false, { unique: true }),
      clientOf("project_id"),
      choice("status", "Status", { open: "Being answered", sent: "Sent" }, { default: "open", tones: { open: "info", sent: "pos" } }),
      at("sent_at", "Sent on", { ...opt, rules: stamp("now", when("status", "sent")) }),
    ],
    // Once the client sends the brief, their answers stay as sent.
    states: { column: "status", initial: "open", moves: { open: ["sent"] }, lock: { when: ["sent"] }, children: { brief_answers: { via: "brief_id", lock: true } } },
  },
  {
    ref: "brief_answers",
    label: l("Brief answer"),
    labelPlural: l("Brief answers"),
    columns: [
      id,
      fk("brief_id", "briefs", "Brief"),
      clientOf("brief_id"),
      text("question_key", 40, "Question"),
      text("answer", null, "Answer", opt),
      text("first_answer", null, "First answer", { ...opt, rules: stamp({ copy: "answer" }, onCreate) }),
      clientKey,
    ],
  },

  // ── the back office: who we buy from, what we bought, the hours we kept ──
  {
    ref: "suppliers",
    label: l("Supplier"),
    labelPlural: l("Suppliers"),
    keyField: "name",
    columns: [
      id,
      int("number_seq", "Number in the series", { ...opt, rules: { sequence: { gapless: true } } }),
      text("number", 24, "Number", { ...opt, unique: true, rules: { format: { from: "number_seq", prefix: "SUP-", pad: 2 } } }),
      text("name", 160, "Name", { semantic: "name" }),
      choice(
        "kind",
        "What for",
        {
          print: "Print",
          paper: "Paper",
          signage: "Signage",
          courier: "Courier",
          fonts: "Fonts",
          finishing: "Finishing",
          photography: "Photography",
          software: "Software",
          other: "Other",
        },
        { default: "other" },
      ),
      text("contact", 120, "Ask for", opt),
      text("email", 254, "Email", { ...opt, semantic: "email", rules: { normalize: "email", validation: { format: "email" } } }),
      text("phone", 40, "Phone", opt),
      text("address", 500, "Address", opt),
      text("lead_time", 120, "Lead time", opt),
      text("typical_cost", 160, "What it costs", opt),
      text("note", 1000, "What to remember", opt),
      bool("would_use_again", "Would use again", true),
      clientKey,
    ],
  },
  {
    ref: "expenses",
    label: l("Purchase"),
    labelPlural: l("Expenses"),
    keyField: "number",
    columns: [
      id,
      int("number_seq", "Number in the series", { ...opt, rules: { sequence: { gapless: true } } }),
      text("number", 24, "Number", { ...opt, unique: true, rules: { format: { from: "number_seq", prefix: "EX-", pad: 3 } } }),
      // A purchase is dated the day it was made, never a day still to come.
      date("date", "Bought on", { rules: { notAfter: "today" } }),
      text("what", 300, "What it was"),
      decimal("amount", "Cost", "currency", { semantic: "money", rules: { validation: { min: 0.01 } } }),
      // The project's client whenever a project is named; a client of its own otherwise.
      fk("client_id", "clients", "Client", true, { rules: { copy: { via: "project_id", from: "client_id", mode: "always" } } }),
      fk("project_id", "projects", "Project", true),
      fk("supplier_id", "suppliers", "Supplier", true),
      // Passed on to the client at cost, never marked up; ours to carry when not.
      bool("rebill", "Pass on at cost", false),
      text("receipt", 255, "Purchase receipt", opt),
      clientKey,
    ],
  },
  {
    ref: "time_entries",
    label: l("Time entry"),
    labelPlural: l("Time"),
    keyField: "note",
    columns: [
      id,
      fk("project_id", "projects", "Project"),
      clientOf("project_id"),
      fk("milestone_id", "milestones", "Milestone", true),
      fk("person_id", "people", "Who"),
      // Logged for a day that has happened, never one still to come.
      date("date", "Day", { rules: { notAfter: "today" } }),
      // The hours the entry counts, worked out by Adminium: the ones a person typed, else the
      // clock's own, from its start to its stop (both Adminium's moments) to the nearest quarter
      // hour, a quarter at least. Empty while the clock runs. Nobody works more than sixteen
      // hours in a day: a clock left running longer is refused at its stop, and asks for the hours.
      decimal("hours", "Hours", 2, { ...opt, rules: { formula: CLOCK_HOURS, validation: { min: 0.01, max: 16 } } }),
      // Hours a person typed: time logged by hand, or the real figure for a clock.
      decimal("logged_hours", "Hours as logged", 2, { ...opt, rules: { validation: { min: 0.01, max: 16 } } }),
      text("note", 500, "What it went on", opt),
      // Whose clock is running on this entry, emptied when it stops. Unique, so one person
      // never has two clocks running, whichever computer started the second.
      fk("running_for", "people", "Clock running for", true, { unique: true }),
      at("started_at", "Clock started", { ...opt, rules: stamp("now", { column: "running_for", filled: true }) }),
      // Set as the clock stops, so the moment it stopped is Adminium's too.
      bool("clock_stopped", "Clock has stopped", false),
      at("stopped_at", "Clock stopped", { ...opt, rules: stamp("now", when("clock_stopped", true)) }),
      clientKey,
    ],
  },
  {
    ref: "invoices",
    label: l("Invoice"),
    labelPlural: l("Invoices"),
    keyField: "number",
    ...builtOn("invoice@1", "document"),
    columns: [
      ...withWords(
        partColumns("invoice@1", "document", BUILT, INVOICE_WORDS).map((column) =>
          // A client's own tax rate comes first; the add-on's default when they have none.
          column.ref === "tax_rate" ? { ...column, rules: { ...column.rules, copy: { via: "client_id", from: "tax_rate" } } } : column,
        ),
        { status: INVOICE_STATUS, terms: TERMS, ladder: LADDER },
      ),
      fk("client_id", "clients", "Client"),
      fk("project_id", "projects", "Project", true),
      fk("proposal_id", "proposals", "Proposal", true),
      text("stage", 80, "Stage", opt),
      text("title", 200, "Title", opt),
      text("client_paid_note", 500, "What the client said about paying", opt),
      decimal("client_paid_amount", "Amount the client says they sent", "currency", opt),
      date("client_paid_on", "Day the client says they paid", opt),
      // Set by the client's "I've sent a payment", emptied again when the studio records one.
      { ref: "client_paid", type: "bool", nullable: true, label: l("Client says paid") },
      at("client_paid_at", "Client said so", { ...opt, rules: stamp("now", when("client_paid", true)) }),
      clientKey,
    ],
    states: partStates("invoice@1", "document", BUILT, {
      except: ["client_paid_note", "client_paid_amount", "client_paid_on", "client_paid", "client_paid_at"],
      // A recorded payment answers the client's "I've sent it": the flag goes.
      clearOnCreate: { payments: ["client_paid_note", "client_paid_amount", "client_paid_on", "client_paid", "client_paid_at"] },
      children: {
        invoice_lines: {
          // A void invoice charges nothing: its lines may let go of the hours and the purchase
          // they carried (and change nothing else), so that work can go on another invoice.
          release: { when: ["void"], columns: ["time_entry_id", "expense_id"] },
          // While an invoice that is not void carries them, the hours and the purchase stay what
          // its line billed, whichever door writes to them.
          lockLinked: {
            time_entry_id: ["hours", "logged_hours", "project_id", "date"],
            expense_id: ["amount", "project_id", "client_id", "rebill"],
          },
        },
      },
    }),
  },
  {
    ref: "invoice_lines",
    label: l("Invoice line"),
    labelPlural: l("Invoice lines"),
    ...builtOn("invoice@1", "lines"),
    columns: [
      ...withWords(partColumns("invoice@1", "lines", BUILT, LINE_WORDS), { discount_kind: DISCOUNT_KIND }),
      clientOf("document_id"),
      // The hours or the purchase a line puts on the invoice. The line is the one record of it: an
      // entry is invoiced while a line points at it, and free again once a draft's line is removed
      // or a void invoice's line lets go of it (the invoice's states, above).
      // Unique, so the same hours or purchase is never on two lines, however often "Move onto an
      // invoice" is pressed; and a row a line points at cannot be deleted from under it.
      fk("time_entry_id", "time_entries", "Time it bills", true, { unique: true }),
      fk("expense_id", "expenses", "Purchase it passes on", true, { unique: true }),
      clientKey,
    ],
  },
  {
    ref: "payments",
    label: l("Payment"),
    labelPlural: l("Payments"),
    keyField: "number",
    ...builtOn("invoice@1", "payments"),
    columns: [...withWords(partColumns("invoice@1", "payments", BUILT, PAYMENT_WORDS), { method: METHOD }), clientOf("document_id"), clientKey],
  },
  {
    ref: "messages",
    label: l("Email"),
    labelPlural: l("Emails"),
    columns: [
      id,
      choice(
        "kind",
        "Kind",
        {
          "proposal-sent": "Proposal sent",
          "proposal-reminder": "Proposal reminder",
          "new-work": "New work to review",
          handover: "Handover",
          "enquiry-reply": "Reply to an enquiry",
          "ask-to-sign": "Ask to sign the terms",
          "accepted-and-signed": "Accepted and signed",
          declined: "Declined",
          "changes-requested": "Changes asked",
          approved: "Approved",
          "client-says-paid": "Client says paid",
          "brief-sent": "Brief sent",
          "asked-for-a-new-price": "Asked for a new price",
          "new-note": "New note from a client",
          "new-enquiry": "New enquiry",
          "invoice-sent": "Invoice sent",
          "invoice-rung-1": "First reminder",
          "invoice-rung-2": "Second reminder",
          "invoice-rung-3": "Third reminder",
          "payment-receipt": "Receipt",
        },
      ),
      choice(
        "status",
        "Status",
        { held: "Waiting for approval", queued: "Going out", sent: "Sent", failed: "Not sent", skipped: "Skipped" },
        { default: "queued", tones: { held: "warn", queued: "info", sent: "pos", failed: "danger", skipped: "neutral" } },
      ),
      at("created_at", "Created", { ...opt, rules: stamp("now", onCreate) }),
      choice(
        "skip_reason",
        "Why it was skipped",
        { overtaken: "Overtaken", paid: "Paid", void: "Void", "no-longer-needed": "No longer needed", "by-hand": "By hand" },
        opt,
      ),
      text("to", 254, "To", opt),
      text("language", 16, "Language", opt),
      fk("client_id", "clients", "Client", true),
      fk("proposal_id", "proposals", "Proposal", true),
      fk("invoice_id", "invoices", "Invoice", true),
      fk("payment_id", "payments", "Payment", true),
      fk("project_id", "projects", "Project", true),
      fk("deliverable_id", "deliverables", "Deliverable", true),
      fk("enquiry_id", "enquiries", "Enquiry", true),
      text("subject_override", 200, "Subject as approved", opt),
      text("body_override", null, "Words as approved", opt),
      // Adminium's outbox writes who approved a held message (it names this column, `outbox.ts`); a
      // stamp here would fill it first and the outbox then refuses every new and every approved message.
      text("approved_by", 120, "Approved by", opt),
      at("due", "Due", opt),
      at("sent_at", "Sent", opt),
      text("error", null, "Why it was not sent", opt),
      at("effect_at", "Follow-up made", opt),
      text("effect_error", null, "Why the follow-up was refused", opt),
      clientKey,
    ],
  },

  // ── the back office: what it costs to open the door, the studio's dates ──
  {
    ref: "running_costs",
    label: l("Running cost"),
    labelPlural: l("Running costs"),
    keyField: "label",
    columns: [
      id,
      text("label", 160, "What it is"),
      decimal("monthly_amount", "Every month", "currency", { semantic: "money", rules: { validation: { min: 0 } } }),
      int("position", "Position", { default: 0 }),
      clientKey,
    ],
  },
  {
    ref: "events",
    label: l("Studio date"),
    labelPlural: l("Studio dates"),
    keyField: "title",
    columns: [
      id,
      date("date", "Date"),
      date("to_date", "Until", { ...opt, rules: { notBefore: { column: "date" } } }),
      text("title", 200, "What it is"),
      choice("kind", "Kind", { call: "A call", press: "A press check", away: "One of us away" }, { default: "call", tones: { call: "info", press: "accent", away: "warn" } }),
      // Who is away: asked for on an away day only, by every door (the desk and the dashboard's form).
      fk("person_id", "people", "Who is away", true, { rules: { requiredWhen: { column: "kind", in: ["away"] } } }),
      clientKey,
    ],
  },
];
