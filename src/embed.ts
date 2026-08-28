/**
 * The child half of the host bridge (29-app-surfaces.md D6).
 *
 * ─── What "internal placement" is ────────────────────────────────────────────
 *
 * A staff surface can appear as a SECTION OF THE DASHBOARD: its pages render at
 * `admin.example.com/a/<key>/<path>`, inside the dashboard's own shell, with
 * the app's screens in the content area and the app's navigation folded into
 * the dashboard's sidebar. Nobody leaves the dashboard to use the app.
 *
 * The mechanism is a SAME-ORIGIN IFRAME, not DOM-level merging, and that is a
 * decision rather than a shortcut. The fifteen apps ship global stylesheets —
 * a reset, `body`-level rules, their own token layer — and putting two React
 * roots, two i18n runtimes and two design systems in one document would be a
 * rewrite of all fifteen. A same-origin iframe keeps each app's CSS world
 * intact and is invisible at 1× zoom.
 *
 * ─── EMBEDDED is a RUNTIME fact, not a build constant ───────────────────────
 *
 * The same `hosted-staff` bundle serves both placements: framed by the
 * dashboard (internal) and opened directly at `/apps/<key>/staff/` (external).
 * What folds at build time is `HOSTED`; what is discovered at runtime is "am I
 * framed, by a host that speaks this protocol". Making it a build flag would
 * mean two staff builds per app and an operator choice that requires a rebuild
 * — the opposite of D9, where placement is a setting.
 *
 * ─── Every failure mode degrades to USABLE, loudly ──────────────────────────
 *
 * There is no state in which this file can blank a screen:
 *
 *   no parent          → `hello` times out after 250 ms → full own chrome,
 *                        i.e. exactly the external placement. Silent, because
 *                        it is not an error: someone opened the surface
 *                        directly.
 *   parent, wrong v    → console error naming both versions → full own chrome.
 *                        Fails OPEN to something a person can work in, never
 *                        to a blank frame with a mystery in the console.
 *   parent never
 *   answers `navigate` → nothing waits on it. URL sync is COSMETIC; the screen
 *                        change already happened locally.
 */

/** Bumped only for a BREAKING protocol change; both ends check it. */
export const BRIDGE_VERSION = 1;

/*
 * The answer, cached at module scope, so components can ask synchronously.
 *
 * `connectToHost` is awaited before the first render, so by the time any
 * component calls `isEmbedded()` the handshake has already settled — which is
 * what stops the app painting its own sidebar and then removing it 250 ms
 * later. Module state rather than context because the chrome check happens in
 * fifteen different component trees and a provider would be fifteen splices.
 */
let embeddedFlag = false;

/** Is this bundle running inside the dashboard's frame? */
export function isEmbedded(): boolean {
  return embeddedFlag;
}

/** How long a framed surface waits for a host that may not be one. */
const HELLO_TIMEOUT_MS = 250;

export type BridgeTheme = 'light' | 'dark';

export interface HostInit {
  v: number;
  path?: string;
  persona?: string;
  theme?: BridgeTheme;
  locale?: string;
}

export interface HostSet {
  v?: number;
  path?: string;
  theme?: BridgeTheme;
  locale?: string;
}

export interface EmbedHandlers {
  /** Adopt the host's theme. The app applies it to its OWN token layer. */
  onTheme?: (theme: BridgeTheme) => void;
  /** Adopt the host's locale. Unknown tags are the app's problem, not ours. */
  onLocale?: (locale: string) => void;
  /** Navigate to a path under the surface base (back/forward, sidebar click). */
  onPath?: (path: string) => void;
  /** The lens the host wants (D7's `persona`), applied once at init. */
  onPersona?: (persona: string) => void;
}

export interface EmbedBridge {
  /** Is a protocol-speaking host actually on the other side? */
  readonly embedded: boolean;
  /** Tell the host the app moved. No-op when not embedded. */
  navigated: (path: string) => void;
  /** Stop listening. */
  detach: () => void;
}

/** Not embedded, and everything is a no-op. The one object this file returns
 *  when there is no host — so no call site needs a null check. */
const INERT: EmbedBridge = {
  embedded: false,
  navigated: () => {
    /* nothing to tell */
  },
  detach: () => {
    /* nothing attached */
  },
};

/**
 * Handshake with the host, if there is one.
 *
 * Resolves as soon as the answer is known: on `host:init` (embedded) or on the
 * timeout (not embedded). Callers await it BEFORE the first paint, which is
 * what stops the app rendering its own sidebar for 250 ms and then removing it.
 *
 * `window.parent !== window` is checked first so an unframed surface pays
 * nothing at all — no listener, no timer, no 250 ms delay on the boot path that
 * every non-embedded placement takes.
 */
export async function connectToHost(
  appKey: string,
  side: 'staff' | 'customer',
  path: string,
  handlers: EmbedHandlers = {},
): Promise<EmbedBridge> {
  // Reset first: a second call must not inherit the first's answer. Nothing
  // calls this twice today, but the flag is module state and a stale `true`
  // would strip an app's chrome with no host to replace it.
  embeddedFlag = false;
  if (typeof window === 'undefined' || window.parent === window) return INERT;

  const origin = window.location.origin;

  const init = await new Promise<HostInit | null>((resolve) => {
    let settled = false;
    const done = (value: HostInit | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onHello);
      resolve(value);
    };

    const onHello = (event: MessageEvent): void => {
      /*
       * ORIGIN CHECK FIRST, always. The frame is same-origin by construction,
       * so anything from elsewhere is either a mistake or an attempt, and both
       * are ignored rather than parsed.
       */
      if (event.origin !== origin) return;
      const data = event.data as { type?: string } | null;
      if (data === null || typeof data !== 'object' || data.type !== 'adminium:host:init') return;
      const message = data as unknown as HostInit & { type: string };
      if (message.v !== BRIDGE_VERSION) {
        console.error(
          `[adminium] surface bridge version mismatch: the host speaks v${String(message.v)}, ` +
            `this build speaks v${String(BRIDGE_VERSION)}. Rendering the app's own chrome instead. ` +
            'Rebuild the surface, or update Adminium.',
        );
        done(null);
        return;
      }
      done(message);
    };

    const timer = window.setTimeout(() => done(null), HELLO_TIMEOUT_MS);
    window.addEventListener('message', onHello);
    window.parent.postMessage(
      { type: 'adminium:surface:hello', v: BRIDGE_VERSION, appKey, side, path },
      origin,
    );
  });

  if (init === null) return INERT;
  embeddedFlag = true;

  // Init order matters: the LENS first (it can change which screens exist),
  // then locale, then theme, then the path — so the first paint is already
  // the right screen in the right language, not a corrected one.
  if (init.persona !== undefined) handlers.onPersona?.(init.persona);
  if (init.locale !== undefined) handlers.onLocale?.(init.locale);
  if (init.theme !== undefined) handlers.onTheme?.(init.theme);
  if (init.path !== undefined && init.path !== '') handlers.onPath?.(init.path);

  const onSet = (event: MessageEvent): void => {
    if (event.origin !== origin) return;
    const data = event.data as { type?: string } | null;
    if (data === null || typeof data !== 'object' || data.type !== 'adminium:host:set') return;
    const message = data as unknown as HostSet;
    if (message.theme !== undefined) handlers.onTheme?.(message.theme);
    if (message.locale !== undefined) handlers.onLocale?.(message.locale);
    if (message.path !== undefined) handlers.onPath?.(message.path);
  };
  window.addEventListener('message', onSet);

  return {
    embedded: true,
    navigated: (path: string) => {
      // Fire and forget. The screen already changed; the URL is cosmetic, and
      // waiting on an acknowledgement would make navigation feel laggy for a
      // benefit nobody can see.
      window.parent.postMessage({ type: 'adminium:surface:navigate', v: BRIDGE_VERSION, path }, origin);
    },
    detach: () => window.removeEventListener('message', onSet),
  };
}
