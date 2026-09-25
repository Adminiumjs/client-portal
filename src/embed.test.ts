/**
 * The host bridge's FAILURE modes.
 *
 * The happy path demos well and is the least valuable thing here. What this
 * file is actually for is the design's own warning: version mismatch, parent
 * absent, parent silent — "each must degrade to something usable and loud, and
 * each is a test nobody writes when the happy path demos well".
 *
 * There is no DOM in the fleet's test environment, and adding one to fifteen
 * repos to exercise `postMessage` would cost more than the fake below.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BRIDGE_VERSION, connectToHost, isEmbedded } from './embed.ts';

const ORIGIN = 'https://admin.example.test';

interface Fake {
  /** Everything the child sent upward. */
  posted: { data: Record<string, unknown>; origin: string }[];
  /** Deliver a message to the child, as the parent (or as an impostor). */
  deliver: (data: unknown, origin?: string) => void;
  listenerCount: () => number;
}

function fakeWindow(opts: { framed: boolean }): Fake {
  const listeners = new Set<(event: { origin: string; data: unknown }) => void>();
  const posted: Fake['posted'] = [];

  const win: Record<string, unknown> = {
    location: { origin: ORIGIN, pathname: '/apps/x/staff/' },
    addEventListener: (type: string, fn: (e: { origin: string; data: unknown }) => void) => {
      if (type === 'message') listeners.add(fn);
    },
    removeEventListener: (_t: string, fn: (e: { origin: string; data: unknown }) => void) => {
      listeners.delete(fn);
    },
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (id: number) => {
      clearTimeout(id);
    },
  };
  win['parent'] = opts.framed
    ? { postMessage: (data: Record<string, unknown>, origin: string) => posted.push({ data, origin }) }
    : win;

  vi.stubGlobal('window', win);
  return {
    posted,
    deliver: (data, origin = ORIGIN) => {
      for (const fn of [...listeners]) fn({ origin, data });
    },
    listenerCount: () => listeners.size,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Answer the `hello` the moment it arrives, as a well-behaved host would. */
function autoRespond(fake: Fake, reply: Record<string, unknown>): void {
  queueMicrotask(() => fake.deliver({ type: 'adminium:host:init', ...reply }));
}

describe('no parent — the external placement', () => {
  it('never touches postMessage and reports not-embedded', async () => {
    const fake = fakeWindow({ framed: false });
    const bridge = await connectToHost('clients', 'staff', 'home');
    expect(bridge.embedded).toBe(false);
    expect(isEmbedded()).toBe(false);
    expect(fake.posted).toEqual([]);
    // No listener and no timer either: an un-framed surface must not pay the
    // 250 ms handshake on a boot path it will never use.
    expect(fake.listenerCount()).toBe(0);
  });

  it('is a no-op object, so no call site needs a null check', async () => {
    fakeWindow({ framed: false });
    const bridge = await connectToHost('clients', 'staff', 'home');
    expect(() => {
      bridge.navigated('orders');
      bridge.detach();
    }).not.toThrow();
  });
});

describe('a parent that never answers', () => {
  it('times out and falls back to the app\'s own chrome', async () => {
    vi.useFakeTimers();
    const fake = fakeWindow({ framed: true });
    const pending = connectToHost('clients', 'staff', 'home');
    // The hello went out before anything was awaited.
    expect(fake.posted[0]?.data['type']).toBe('adminium:surface:hello');
    await vi.advanceTimersByTimeAsync(300);
    const bridge = await pending;
    expect(bridge.embedded).toBe(false);
    // And it stopped listening — a late reply must not flip the app into
    // embedded chrome after it has already painted its own.
    expect(fake.listenerCount()).toBe(0);
    vi.useRealTimers();
  });
});

describe('a parent speaking the wrong version', () => {
  it('logs loudly, naming both versions, and renders full chrome', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fake = fakeWindow({ framed: true });
    autoRespond(fake, { v: BRIDGE_VERSION + 1 });
    const bridge = await connectToHost('clients', 'staff', 'home');

    // Fail OPEN to something usable — never to a blank frame.
    expect(bridge.embedded).toBe(false);
    const message = String(error.mock.calls[0]?.[0]);
    expect(message).toContain(`v${String(BRIDGE_VERSION + 1)}`);
    expect(message).toContain(`v${String(BRIDGE_VERSION)}`);
  });
});

describe('a well-behaved host', () => {
  it('handshakes, then applies lens, locale, theme and path IN THAT ORDER', async () => {
    const fake = fakeWindow({ framed: true });
    const order: string[] = [];
    autoRespond(fake, {
      v: BRIDGE_VERSION,
      persona: 'floor',
      locale: 'de-DE',
      theme: 'dark',
      path: 'orders',
    });

    const bridge = await connectToHost('clients', 'staff', 'home', {
      onPersona: (p) => order.push(`persona:${p}`),
      onLocale: (l) => order.push(`locale:${l}`),
      onTheme: (t) => order.push(`theme:${t}`),
      onPath: (p) => order.push(`path:${p}`),
    });

    expect(bridge.embedded).toBe(true);
    expect(isEmbedded()).toBe(true);
    /*
     * The order is load-bearing, not incidental: the lens can change which
     * screens exist, so applying the path first could route to a screen the
     * lens is about to remove. First paint should be right, not corrected.
     */
    expect(order).toEqual(['persona:floor', 'locale:de-DE', 'theme:dark', 'path:orders']);
  });

  it('sends the hello with the app key, side and current path', async () => {
    const fake = fakeWindow({ framed: true });
    autoRespond(fake, { v: BRIDGE_VERSION });
    await connectToHost('clients', 'staff', 'orders/open');
    expect(fake.posted[0]).toEqual({
      // Never `*` — the frame is same-origin by construction, and a wildcard
      // target would post the app's state to whatever happened to frame it.
      origin: ORIGIN,
      data: {
        type: 'adminium:surface:hello',
        v: BRIDGE_VERSION,
        appKey: 'clients',
        side: 'staff',
        path: 'orders/open',
      },
    });
  });

  it('keeps applying host:set after the handshake', async () => {
    const fake = fakeWindow({ framed: true });
    autoRespond(fake, { v: BRIDGE_VERSION });
    const themes: string[] = [];
    const paths: string[] = [];
    await connectToHost('clients', 'staff', 'home', {
      onTheme: (t) => themes.push(t),
      onPath: (p) => paths.push(p),
    });

    // A theme flip in the dashboard, and a Back press.
    fake.deliver({ type: 'adminium:host:set', theme: 'dark' });
    fake.deliver({ type: 'adminium:host:set', path: 'invoices' });
    expect(themes).toEqual(['dark']);
    expect(paths).toEqual(['invoices']);
  });

  it('reports navigation without waiting for an acknowledgement', async () => {
    const fake = fakeWindow({ framed: true });
    autoRespond(fake, { v: BRIDGE_VERSION });
    const bridge = await connectToHost('clients', 'staff', 'home');
    bridge.navigated('invoices');
    // Fire and forget: the screen already changed, and waiting on the host
    // would make every in-app navigation feel laggy for nothing visible.
    expect(fake.posted.at(-1)?.data).toEqual({
      type: 'adminium:surface:navigate',
      v: BRIDGE_VERSION,
      path: 'invoices',
    });
  });
});

describe('messages from anywhere but this origin', () => {
  it('ignores a foreign init, then times out as if nothing arrived', async () => {
    vi.useFakeTimers();
    const fake = fakeWindow({ framed: true });
    const pending = connectToHost('clients', 'staff', 'home');
    fake.deliver({ type: 'adminium:host:init', v: BRIDGE_VERSION }, 'https://evil.example.com');
    await vi.advanceTimersByTimeAsync(300);
    expect((await pending).embedded).toBe(false);
    vi.useRealTimers();
  });

  it('ignores a foreign host:set after a legitimate handshake', async () => {
    const fake = fakeWindow({ framed: true });
    autoRespond(fake, { v: BRIDGE_VERSION });
    const themes: string[] = [];
    await connectToHost('clients', 'staff', 'home', { onTheme: (t) => themes.push(t) });
    fake.deliver({ type: 'adminium:host:set', theme: 'dark' }, 'https://evil.example.com');
    expect(themes).toEqual([]);
  });

  it('ignores junk that is not a bridge message at all', async () => {
    vi.useFakeTimers();
    const fake = fakeWindow({ framed: true });
    const pending = connectToHost('clients', 'staff', 'home');
    // React DevTools, Vite HMR and every browser extension post here too.
    for (const junk of [null, 'a string', 42, { type: 'webpackHotUpdate' }, {}]) {
      fake.deliver(junk);
    }
    await vi.advanceTimersByTimeAsync(300);
    expect((await pending).embedded).toBe(false);
    vi.useRealTimers();
  });
});
