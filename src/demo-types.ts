/**
 * The demo card's contract — `demo.json` and the `adminium:demo:*` messages —
 * as TYPES and pure checks, and nothing else.
 *
 * ─── Who reads this ─────────────────────────────────────────────────────────
 *
 *   the app        `demo-emit.ts` writes `dist/demo.json` from it, and
 *                  `src/demoBridge.ts` speaks its messages (demo builds only);
 *   the website    keeps a VENDORED copy, refreshed by `surface-build.sh
 *                  vendor-web`, validates every app's `demo.json` against it
 *                  and drives the card with its messages. Its build compares
 *                  the vendored copy's hash with the pinned app's, so the two
 *                  ends can never speak different versions unnoticed.
 *
 * DOM-free and dependency-free on purpose: it is imported by a Vite config
 * (no DOM lib), by a browser bundle, and by an Astro build. Synced
 * byte-identically; never edit a copy.
 *
 * ─── The protocol (`dv: 1`) ─────────────────────────────────────────────────
 *
 *   1. the website attaches its listener, then sets the iframe's `src`;
 *   2. the app says `hello {dv, appKey}`;
 *   3. the website answers `init {dv, locale, theme, screen?, persona?, mode?}`;
 *   4. card → app: `go`, `do`, `set`, `clock`, `reset`;
 *   5. app → card: `state`, after init and on every change.
 *
 * `state` may also carry the app's clock as the card should print it
 * (`clockLabel`, already in the page's language), and `overlay: true` while
 * the app shows a dialog, sheet or panel — the card lives outside the app's
 * frame, so it cannot see one, and it hides itself until the flag clears.
 * Both are optional, so an app that sends neither still speaks `dv: 1`.
 *
 * Both ends accept a message only from `location.origin`, from the expected
 * window, and with a matching `dv`; neither ever posts to `*`.
 */

/** The protocol's own version, separate from `demo.json`'s. */
export const DEMO_PROTOCOL_VERSION = 1;

/** `demo.json`'s version. The website refuses any other. */
export const DEMO_JSON_VERSION = 1;

/** Every message type starts with this — and no surface bundle may contain it. */
export const DEMO_MESSAGE_PREFIX = 'adminium:demo:';

/** The eight languages every label ships in, as BCP 47 tags. */
export const DEMO_LOCALES = ['en-US', 'de-DE', 'fr-FR', 'da-DK', 'cs-CZ', 'ar-EG', 'zh-CN', 'zh-TW'] as const;
export type DemoLocale = (typeof DEMO_LOCALES)[number];

/** The frames a card can show. Their sizes belong to the website. */
export const DEMO_FRAMES = ['tablet', 'phone', 'desktop'] as const;
export type DemoFrame = (typeof DEMO_FRAMES)[number];

/** A label in every one of the eight languages. */
export type DemoLabels = Record<string, string>;

export interface DemoShortcut {
  id: string;
  /** lucide icon name, kebab-case. */
  icon: string;
  labels: DemoLabels;
}

export interface DemoScreen {
  id: string;
  /** The app's own view id. */
  view: string;
  icon: string;
  side?: 'staff' | 'customer';
  persona?: string;
  labels: DemoLabels;
  shortcuts?: DemoShortcut[];
}

export interface DemoChoice {
  id: string;
  labels: DemoLabels;
}

export interface DemoPersona extends DemoChoice {
  /** lucide icon name, kebab-case; the card draws it beside the label. */
  icon?: string;
}

/**
 * Whether the card offers a reset, and what it is called: `true` uses the
 * card's own words ("Start over"); `{labels}` names it the app's way ("Back to
 * Tuesday morning"), in all eight languages.
 */
export type DemoClockReset = boolean | { labels: DemoLabels };

export interface DemoJson {
  v: 1;
  appKey: string;
  /** `/demo/<dir>/app/`, exactly. */
  base: string;
  frames: DemoFrame[];
  screens: DemoScreen[];
  personas?: DemoPersona[];
  modes?: { id: string; options: DemoChoice[] }[];
  toggles?: 'online'[];
  clock?: { advance: DemoChoice[]; reset: DemoClockReset };
  addOns?: { key: string; labels: DemoLabels }[];
}

// ── messages ─────────────────────────────────────────────────────────────────

export type DemoTheme = 'light' | 'dark';

export type DemoMessage =
  | { type: 'adminium:demo:hello'; dv: 1; appKey: string }
  | {
      type: 'adminium:demo:init';
      dv: 1;
      locale: string;
      theme: DemoTheme;
      screen?: string;
      persona?: string;
      mode?: string;
    }
  | { type: 'adminium:demo:go'; dv: 1; screen: string }
  | { type: 'adminium:demo:do'; dv: 1; shortcut: string }
  | {
      type: 'adminium:demo:set';
      dv: 1;
      theme?: DemoTheme;
      locale?: string;
      persona?: string;
      mode?: string;
      online?: boolean;
      addOn?: { key: string; on: boolean };
    }
  | { type: 'adminium:demo:clock'; dv: 1; advance: string }
  | { type: 'adminium:demo:reset'; dv: 1 }
  | {
      type: 'adminium:demo:state';
      dv: 1;
      screen: string;
      persona: string | null;
      mode: string | null;
      online: boolean;
      toggles: Record<string, boolean>;
      locale: string;
      theme: DemoTheme;
      /** The app's clock, as the card prints it ("Tue 28 Jul · 09:20"). */
      clockLabel?: string;
      /** True while the app shows a dialog, sheet or panel: the card hides. */
      overlay?: boolean;
    };

export type DemoMessageType = DemoMessage['type'];

const TYPES: readonly DemoMessageType[] = [
  'adminium:demo:hello',
  'adminium:demo:init',
  'adminium:demo:go',
  'adminium:demo:do',
  'adminium:demo:set',
  'adminium:demo:clock',
  'adminium:demo:reset',
  'adminium:demo:state',
];

/**
 * Whether a posted value is a message of this protocol and version. The
 * origin and the source window are the caller's to check — they are facts
 * about the event, not the data.
 */
export function isDemoMessage(data: unknown): data is DemoMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as { type?: unknown; dv?: unknown };
  return (
    typeof message.type === 'string' &&
    (TYPES as readonly string[]).includes(message.type) &&
    message.dv === DEMO_PROTOCOL_VERSION
  );
}

// ── the website's check ──────────────────────────────────────────────────────

export interface DemoJsonContext {
  /** The marketplace key whose `demoPath` is `/demo/<dir>/`. */
  appKey: string;
  /** The folder under `/demo/`. */
  dir: string;
  /** Add-on keys the marketplace knows; absent = none are allowed. */
  addOnKeys?: ReadonlySet<string>;
  /** Icon names the card can draw; absent = not checked. */
  icons?: ReadonlySet<string>;
}

/**
 * Everything wrong with a `demo.json`, one message per problem — an empty
 * list is a manifest the card can show. The website fails its build on any.
 */
export function demoJsonIssues(raw: unknown, ctx: DemoJsonContext): string[] {
  const out: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return ['demo.json is not an object'];
  const doc = raw as Partial<DemoJson> & Record<string, unknown>;
  if (doc.v !== DEMO_JSON_VERSION) out.push(`v is ${JSON.stringify(doc.v)}, not ${String(DEMO_JSON_VERSION)}`);
  if (doc.appKey !== ctx.appKey) out.push(`appKey is ${JSON.stringify(doc.appKey)}, but /demo/${ctx.dir}/ belongs to "${ctx.appKey}"`);
  const base = `/demo/${ctx.dir}/app/`;
  if (doc.base !== base) out.push(`base is ${JSON.stringify(doc.base)}, not "${base}"`);

  const labels = (where: string, value: unknown): void => {
    if (typeof value !== 'object' || value === null) {
      out.push(`${where}: no labels`);
      return;
    }
    const keys = Object.keys(value).sort();
    const want = [...DEMO_LOCALES].sort();
    const missing = want.filter((l) => !keys.includes(l));
    const extra = keys.filter((l) => !(want as string[]).includes(l));
    if (missing.length > 0) out.push(`${where}: no label in ${missing.join(', ')}`);
    if (extra.length > 0) out.push(`${where}: labels in ${extra.join(', ')}, which the card does not ship`);
    for (const [locale, text] of Object.entries(value as Record<string, unknown>)) {
      if (typeof text !== 'string' || text.trim() === '') out.push(`${where}: the ${locale} label is empty`);
    }
  };
  const icon = (where: string, name: unknown): void => {
    if (typeof name !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) out.push(`${where}: ${JSON.stringify(name)} is not an icon name`);
    else if (ctx.icons !== undefined && !ctx.icons.has(name)) out.push(`${where}: no icon "${name}"`);
  };
  const unique = (where: string, ids: unknown[]): void => {
    const seen = new Set<unknown>();
    for (const id of ids) {
      if (typeof id !== 'string' || id === '') out.push(`${where}: an id is missing`);
      else if (seen.has(id)) out.push(`${where}: "${id}" is used twice`);
      seen.add(id);
    }
  };

  if (!Array.isArray(doc.frames) || doc.frames.length === 0) out.push('frames: none');
  else for (const frame of doc.frames) if (!(DEMO_FRAMES as readonly unknown[]).includes(frame)) out.push(`frames: ${JSON.stringify(frame)} is not a frame`);

  const screens = Array.isArray(doc.screens) ? doc.screens : [];
  if (screens.length === 0) out.push('screens: none');
  unique('screens', screens.map((s) => s?.id));
  unique('shortcuts', screens.flatMap((s) => (s?.shortcuts ?? []).map((c) => c?.id)));
  for (const screen of screens) {
    const at = `screens.${String(screen?.id)}`;
    icon(at, screen?.icon);
    labels(at, screen?.labels);
    for (const shortcut of screen?.shortcuts ?? []) {
      icon(`${at}.${String(shortcut?.id)}`, shortcut?.icon);
      labels(`${at}.${String(shortcut?.id)}`, shortcut?.labels);
    }
  }
  const personas = doc.personas ?? [];
  unique('personas', personas.map((p) => p?.id));
  for (const persona of personas) {
    if (persona?.icon !== undefined) icon(`personas.${String(persona.id)}`, persona.icon);
    labels(`personas.${String(persona?.id)}`, persona?.labels);
  }
  for (const screen of screens) {
    if (screen?.persona !== undefined && !personas.some((p) => p?.id === screen.persona)) {
      out.push(`screens.${String(screen.id)}: persona "${screen.persona}" is not declared`);
    }
  }
  const modes = doc.modes ?? [];
  unique('modes', modes.map((m) => m?.id));
  for (const mode of modes) {
    unique(`modes.${String(mode?.id)}`, (mode?.options ?? []).map((o) => o?.id));
    for (const option of mode?.options ?? []) labels(`modes.${String(mode?.id)}.${String(option?.id)}`, option?.labels);
  }
  for (const toggle of doc.toggles ?? []) if (toggle !== 'online') out.push(`toggles: ${JSON.stringify(toggle)} is not a toggle`);
  if (doc.clock !== undefined) {
    unique('clock.advance', (doc.clock.advance ?? []).map((a) => a?.id));
    for (const step of doc.clock.advance ?? []) labels(`clock.${String(step?.id)}`, step?.labels);
    const reset: unknown = doc.clock.reset;
    if (typeof reset === 'object' && reset !== null && !Array.isArray(reset)) labels('clock.reset', (reset as { labels?: unknown }).labels);
    else if (typeof reset !== 'boolean') out.push(`clock.reset: ${JSON.stringify(reset)} is neither true, false nor {labels}`);
  }
  for (const addOn of doc.addOns ?? []) {
    if (!(ctx.addOnKeys ?? new Set<string>()).has(addOn?.key)) out.push(`addOns: "${String(addOn?.key)}" is not an add-on the marketplace knows`);
    labels(`addOns.${String(addOn?.key)}`, addOn?.labels);
  }
  return out;
}
