/*
 * VENDORED VERBATIM from packages/manifest/src/placeholders.ts.
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
 * THE PLACEHOLDER, WRITTEN ONCE: `{{name}}` and `{{name|backup}}`.
 *
 * A placeholder names a value. After a bar it may carry a BACKUP: the words
 * written when the value is not there or is empty — `Thanks, {{first_name|there}}!`
 * reads "Thanks, there!" for a customer with no first name. The backup is
 * plain text up to the closing braces; it holds no braces of its own, and the
 * spaces around it are not part of it. `{{first_name|}}` is a backup of
 * nothing: the placeholder then prints nothing rather than itself.
 *
 * Without a bar nothing changes from before there was one: a value that is
 * there is written (an empty one writes nothing), and a name nothing fills is
 * left exactly as written, so the person who wrote it can see which.
 *
 * The bar was never legal inside a name, so no text stored before this reads
 * differently now.
 *
 * Every reader of the grammar — the email renderer, a rule's own fields, the
 * checks of an app's manifest, the outbox — reads it from here, so they cannot
 * come to disagree about what a placeholder is.
 */

/** A placeholder's name: letters, digits, `_`, `.` and `-`. */
const NAME = '[A-Za-z0-9_.-]+';

/** One placeholder, anywhere in a text. A fresh expression each call: a shared global one keeps its place between readers. */
export function placeholderPattern(): RegExp {
  return new RegExp(`\\{\\{\\s*(${NAME})\\s*(?:\\|([^{}]*))?\\}\\}`, 'g');
}

/** One placeholder as it is written. */
export interface Placeholder {
  /** The whole of it, braces included. */
  whole: string;
  name: string;
  /** The words after the bar, trimmed; `undefined` when there is no bar. */
  backup: string | undefined;
  /** Where it starts in the text. */
  at: number;
}

/** Every placeholder of a text, in reading order. */
export function placeholdersIn(text: string): Placeholder[] {
  const out: Placeholder[] = [];
  for (const match of text.matchAll(placeholderPattern())) {
    out.push({ whole: match[0], name: match[1] as string, backup: match[2]?.trim(), at: match.index });
  }
  return out;
}

/** Whether a value is there: held, and not blank. */
function filled(vars: Readonly<Record<string, string>>, name: string): boolean {
  return Object.hasOwn(vars, name) && String(vars[name] ?? '').trim() !== '';
}

/**
 * What one placeholder writes: its value; its backup when the value is not
 * there or is empty; and with neither, an empty value as nothing and an
 * unknown name as itself.
 */
export function placeholderValue(placeholder: Pick<Placeholder, 'whole' | 'name' | 'backup'>, vars: Readonly<Record<string, string>>): string {
  if (filled(vars, placeholder.name)) return vars[placeholder.name] as string;
  if (placeholder.backup !== undefined) return placeholder.backup;
  return Object.hasOwn(vars, placeholder.name) ? (vars[placeholder.name] ?? '') : placeholder.whole;
}

/** A text with every placeholder written out. `escape` is applied once to each piece, written and filled alike. */
export function fillPlaceholders(text: string, vars: Readonly<Record<string, string>>, escape: (piece: string) => string = (piece) => piece): string {
  let out = '';
  let cursor = 0;
  for (const placeholder of placeholdersIn(text)) {
    out += escape(text.slice(cursor, placeholder.at)) + escape(placeholderValue(placeholder, vars));
    cursor = placeholder.at + placeholder.whole.length;
  }
  return out + escape(text.slice(cursor));
}

function walk(value: unknown, visit: (text: string) => void): void {
  if (typeof value === 'string') visit(value);
  else if (Array.isArray(value)) for (const entry of value) walk(entry, visit);
  else if (typeof value === 'object' && value !== null) for (const entry of Object.values(value)) walk(entry, visit);
}

/** Every name the texts of a value read, however deep, in reading order, each once: with a backup or without. */
export function placeholderNames(value: unknown): string[] {
  const out = new Set<string>();
  walk(value, (text) => {
    for (const placeholder of placeholdersIn(text)) out.add(placeholder.name);
  });
  return [...out];
}

/**
 * The names a value must be given: those written somewhere WITHOUT a backup.
 * A name that carries a backup everywhere it is written says itself what to
 * write when nothing fills it, and is asked of nobody.
 */
export function requiredPlaceholderNames(value: unknown): string[] {
  const out = new Set<string>();
  walk(value, (text) => {
    for (const placeholder of placeholdersIn(text)) if (placeholder.backup === undefined) out.add(placeholder.name);
  });
  return [...out];
}

/** A placeholder, written: `{{name}}`, or `{{name|backup}}`. A backup loses the braces it cannot hold. */
export function writePlaceholder(name: string, backup?: string | undefined): string {
  return backup === undefined ? `{{${name}}}` : `{{${name}|${backup.replaceAll(/[{}]/g, '').trim()}}}`;
}

// ── a block tied to a value ──────────────────────────────────────────────────

/** A block's own condition: shown only when this variable has a value. */
export interface ShowWhen {
  var: string;
}

/** The condition a block record carries, or null: `showWhen: { var: 'first_name' }`. */
export function showWhenOf(block: unknown): ShowWhen | null {
  if (typeof block !== 'object' || block === null) return null;
  const mark = (block as Record<string, unknown>)['showWhen'];
  if (typeof mark !== 'object' || mark === null) return null;
  const name = (mark as Record<string, unknown>)['var'];
  return typeof name === 'string' && new RegExp(`^${NAME}$`).test(name) ? { var: name } : null;
}

/** The words a block shows in its own place when its condition is not met, or null. */
export function otherwiseOf(block: unknown): string | null {
  if (typeof block !== 'object' || block === null) return null;
  const text = (block as Record<string, unknown>)['otherwise'];
  return typeof text === 'string' && text.trim() !== '' ? text : null;
}

/** The kinds of block that can say other words: the ones that are a single text. */
export const OTHERWISE_BLOCKS: readonly string[] = ['email.text', 'email.heading'];

/**
 * The blocks an email is made of for these values: a block tied to a value
 * that is not there is left out, or — a text block that says what to show
 * otherwise — written with those words in place of its own. Read by the
 * renderer and by every check of what an email will print, so a name only a
 * hidden block reads is asked of nobody.
 */
export function blocksShownFor<T>(blocks: readonly T[], vars: Readonly<Record<string, string>>): T[] {
  const out: T[] = [];
  for (const block of blocks) {
    const when = showWhenOf(block);
    if (when === null || filled(vars, when.var)) {
      out.push(block);
      continue;
    }
    const otherwise = otherwiseOf(block);
    const record = block as unknown as Record<string, unknown>;
    if (otherwise === null || !OTHERWISE_BLOCKS.includes(String(record['block']))) continue;
    const data = typeof record['data'] === 'object' && record['data'] !== null ? (record['data'] as Record<string, unknown>) : {};
    const { paras: _paras, ...rest } = data;
    out.push({ ...record, data: { ...rest, text: otherwise } } as unknown as T);
  }
  return out;
}

/** The variables the blocks of a document are tied to, each once. */
export function showWhenNames(blocks: readonly unknown[]): string[] {
  const out = new Set<string>();
  for (const block of blocks) {
    const when = showWhenOf(block);
    if (when !== null) out.add(when.var);
  }
  return [...out];
}

/**
 * The names a whole email must be given, whoever reads it: written with no
 * backup, outside a block tied to that same name. `{{first_name}}` in a block
 * shown only when there is a first name is never met unfilled.
 */
export function requiredNamesOfEmail(email: { subject?: unknown; preheader?: unknown; blocks: readonly unknown[]; footer?: unknown }): string[] {
  const out = new Set(requiredPlaceholderNames([email.subject, email.preheader, email.footer]));
  for (const block of email.blocks) {
    const tiedTo = showWhenOf(block)?.var;
    for (const name of requiredPlaceholderNames(block)) if (name !== tiedTo) out.add(name);
  }
  return [...out];
}
