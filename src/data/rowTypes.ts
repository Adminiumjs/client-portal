/**
 * The text of `types.ts`, written from `manifest.json`.
 *
 * Every table the manifest declares becomes one row type in the table's own
 * column names, with the column's kind as Adminium returns it:
 *
 *   int, fk        number            (a key is a number: the tables number their rows)
 *   text           string
 *   decimal        Decimal           a string, exactly as Adminium sends it ("1950.00")
 *   bool           boolean
 *   date           Day               "YYYY-MM-DD" on the studio's calendar
 *   timestamptz    Instant           an ISO instant in UTC
 *   enum           the union of its values
 *
 * A column the manifest lets be empty is `| null`. Nothing here is written by
 * hand: `npm run row-types` (vite-node scripts/write-row-types.ts) rewrites
 * `types.ts`, and `types.test.ts` fails when the two disagree.
 *
 * Only a test and the script import this module; no screen does.
 */

interface ManifestColumn {
  ref: string;
  type: string;
  nullable?: boolean;
  role?: string;
  enum?: string[];
  references?: string;
}

interface ManifestTable {
  ref: string;
  columns: ManifestColumn[];
}

export interface ManifestLike {
  requiredSchema: { tables: ManifestTable[] };
}

/** The row type's name, per table. A table missing here fails the script, naming it. */
export const ROW_NAMES: Readonly<Record<string, string>> = {
  settings: "Settings",
  people: "Person",
  rates: "Rate",
  terms_versions: "TermsVersion",
  terms_clauses: "TermsClause",
  brief_questions: "BriefQuestion",
  clients: "Client",
  client_notes: "ClientNote",
  enquiries: "Enquiry",
  proposals: "Proposal",
  proposal_lines: "ProposalLine",
  projects: "Project",
  project_fonts: "ProjectFont",
  handover_files: "HandoverFile",
  milestones: "Milestone",
  deliverables: "Deliverable",
  deliverable_versions: "DeliverableVersion",
  deliverable_notes: "DeliverableNote",
  briefs: "Brief",
  brief_answers: "BriefAnswer",
  invoices: "Invoice",
  invoice_lines: "InvoiceLine",
  payments: "Payment",
  messages: "Message",
};

/** The kind `rows.ts` normalises a column to. Text needs nothing and is left out. */
export type ColumnKind = "int" | "decimal" | "bool" | "day" | "instant";

const pascal = (snake: string): string =>
  snake
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

function tsType(table: string, column: ManifestColumn): string {
  switch (column.type) {
    case "int":
    case "fk":
      return column.role === "pk" || column.type === "fk" ? "Id" : "number";
    case "text":
      return "string";
    case "decimal":
      return "Decimal";
    case "bool":
      return "boolean";
    case "date":
      return "Day";
    case "timestamptz":
      return "Instant";
    case "enum":
      return `${ROW_NAMES[table]}${pascal(column.ref)}`;
    default:
      throw new Error(`${table}.${column.ref}: no type for the manifest's "${column.type}"`);
  }
}

function kindOf(column: ManifestColumn): ColumnKind | null {
  switch (column.type) {
    case "int":
    case "fk":
      return "int";
    case "decimal":
      return "decimal";
    case "bool":
      return "bool";
    case "date":
      return "day";
    case "timestamptz":
      return "instant";
    default:
      return null;
  }
}

const HEADER = `/**
 * WRITTEN BY \`scripts/write-row-types.ts\` FROM \`manifest.json\` — do not edit.
 * Change the manifest, then run \`npx vite-node scripts/write-row-types.ts\`;
 * \`types.test.ts\` fails while this file and the manifest disagree.
 *
 * One row type per table, in the table's own column names. Three conventions
 * hold for every row the app holds (\`rows.ts\` makes them true on the way in):
 *
 *   - a key is a number;
 *   - an amount or any other decimal is a STRING, as Adminium returns it
 *     ("1950.00"): the app never does arithmetic on money it then saves, and
 *     shows it through \`lib/money.ts\`;
 *   - an instant is an ISO string in UTC; a calendar day is "YYYY-MM-DD" on
 *     the studio's calendar.
 */

export type Id = number;
/** A decimal as Adminium sends it: "1950.00", "8.5". Display only. */
export type Decimal = string;
/** A calendar day on the studio's calendar, "YYYY-MM-DD". */
export type Day = string;
/** An instant, as an ISO string in UTC. */
export type Instant = string;
`;

/** The whole of `types.ts`. */
export function rowTypesText(manifest: ManifestLike): string {
  const tables = manifest.requiredSchema.tables;
  const unnamed = tables.map((t) => t.ref).filter((ref) => ROW_NAMES[ref] === undefined);
  if (unnamed.length > 0) throw new Error(`name these tables' row types in src/data/rowTypes.ts: ${unnamed.join(", ")}`);

  const parts: string[] = [HEADER];
  parts.push(`/** Every table, by the manifest's short name (Adminium adds the prefix). */`);
  parts.push(`export const TABLE_REFS = [\n${tables.map((t) => `  "${t.ref}",`).join("\n")}\n] as const;\n`);
  parts.push(`export type TableRef = (typeof TABLE_REFS)[number];\n`);

  for (const table of tables) {
    const name = ROW_NAMES[table.ref]!;
    for (const column of table.columns) {
      if (column.type !== "enum") continue;
      const values = (column.enum ?? []).map((v) => JSON.stringify(v)).join(" | ");
      parts.push(`export type ${name}${pascal(column.ref)} = ${values === "" ? "never" : values};`);
    }
    const lines = table.columns.map((column) => `  ${column.ref}: ${tsType(table.ref, column)}${column.nullable === true ? " | null" : ""};`);
    parts.push(`/** A row of \`${table.ref}\`. */\nexport interface ${name} {\n${lines.join("\n")}\n}\n`);
  }

  parts.push(`/** Each table's row type, by short name. */\nexport interface Tables {\n${tables.map((t) => `  ${t.ref}: ${ROW_NAMES[t.ref]};`).join("\n")}\n}\n`);

  const kinds = tables.map((table) => {
    const entries = table.columns
      .map((column) => [column.ref, kindOf(column)] as const)
      .filter((entry): entry is readonly [string, ColumnKind] => entry[1] !== null)
      .map(([ref, kind]) => `${ref}: "${kind}"`);
    return `  ${table.ref}: { ${entries.join(", ")} },`;
  });
  parts.push(
    `/** Every column that is not plain text, per table: what \`rows.ts\` normalises. */\nexport const COLUMN_KINDS = {\n${kinds.join("\n")}\n} as const satisfies Record<TableRef, Record<string, "int" | "decimal" | "bool" | "day" | "instant">>;\n`,
  );

  const nullable = tables.map((table) => {
    const refs = table.columns.filter((c) => c.nullable === true).map((c) => `"${c.ref}"`);
    return `  ${table.ref}: [${refs.join(", ")}],`;
  });
  parts.push(`/** The columns a row may leave empty, per table. */\nexport const NULLABLE: Readonly<Record<TableRef, readonly string[]>> = {\n${nullable.join("\n")}\n};\n`);

  return parts.filter((p) => p !== "").join("\n");
}
