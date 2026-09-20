/*
 * Entry point.
 *
 * The four global stylesheets are imported here, before `App`, so the cascade
 * order is deterministic in the built bundle: tokens (custom properties) →
 * base (reset, fonts, behaviour classes) → components (shared UI) → screens
 * (view-specific rules, which therefore always win a tie).
 */

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/components.css";
import "./styles/screens.css";

import { I18nProvider } from "./i18n/index.tsx";
import { setDataSource } from "./data/source.ts";
import { clientFromConfig, loadSnapshot, snapshotFailure, snapshotSource } from "./data/adminiumSource.ts";
import { createSessionTransport } from "./data/sessionSource.ts";
import { TABLE_OF_REF } from "./data/tableOfRef.ts";
import { resolveStaffConnectionId } from "./staffConnection.ts";

import { appName, setTenantCurrency, setTimezoneClaim } from "./i18n/ambient.ts";
import { DEMO, HOSTED, SURFACE_SIDE } from "./surface.ts";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root — check index.html");

/*
 * ONE condition decides demo vs connected: whether the API base URL and key are
 * present at build time. `createPublicClient` returns null when either is
 * missing, so the fallback is structural rather than a catch, and there is no
 * second flag to drift. The marketplace demo builds set neither and behave
 * byte-identically to before this file changed.
 *
 * The dynamic `import()` of `App` is load-bearing, not stylistic: `App` pulls
 * `state/store.ts`, which reads the seam at MODULE SCOPE:
 *   the clients, the documents, the tax rate and the clock, through data/live.ts.
 * A static import would evaluate the store during this module's own imports,
 * before the fetch below could resolve, and the app would render demo data
 * whatever the server said. The `await` has to sit between the swap and the
 * import, so the import has to be dynamic. The seam's `setDataSource` throws if
 * that ordering is ever broken, because the failure is otherwise silent and
 * looks exactly like a working app.
 */
/** This app's name, as the failure screen says it. */
const BRAND = "Client Portal";

/**
 * The headline for a startup failure, chosen by CAUSE.
 *
 * One sentence used to cover every cause: "<Brand> is not connected". It was
 * wrong for most of them and actively misleading for two — an app that reached
 * Adminium, authenticated, and refused only because two databases are serving
 * is not "not connected", and an operator who reads that goes looking for a
 * broken connection instead of the choice the app is actually waiting on.
 *
 * The DETAIL under it already says precisely what happened; this only has to
 * name the KIND of problem without contradicting it.
 */
function titleFor(code: string | null): string {
  switch (code) {
    case "AMBIGUOUS_CONNECTION":
      return `${BRAND} does not know which database to read`;
    case "CONNECTION_PAUSED":
      return `${BRAND}'s database is paused`;
    case "NO_CONNECTION":
      return `${BRAND} is not connected`;
    case "NO_BACKEND":
      return `${BRAND} has no backend configured`;
    default:
      // Reached the server and could not finish: a refused scope, a schema that
      // does not match, an expired session. "Not connected" would be a guess.
      return `${BRAND} could not load its data`;
  }
}

/**
 * The smallest honest "this is not configured" surface.
 *
 * Deliberately plain DOM and inline styles: it has to work when the data layer,
 * and possibly the locale bundle, did not. Anything richer would be one more
 * thing that can fail while reporting a failure.
 */
function showStartupFailure(mount: HTMLElement, detail: string, code: string | null): void {
  const title = titleFor(code);
  console.error(`[adminium] ${title}: ${detail}`);
  mount.innerHTML = "";
  const box = document.createElement("div");
  box.setAttribute("role", "alert");
  box.style.cssText =
    "max-width:34rem;margin:12vh auto;padding:1.5rem;font:400 15px/1.6 system-ui,sans-serif;" +
    "border:1px solid #d4d4d8;border-radius:12px;color:#18181b;background:#fff";
  const h = document.createElement("h1");
  h.textContent = title;
  h.style.cssText = "margin:0 0 .5rem;font-size:1.05rem;font-weight:600";
  const p = document.createElement("p");
  p.textContent = detail;
  // `pre-wrap`: the detail is a LIST — one problem per line, and a blank line
  // before any hint. Collapsed to a single run of prose (the CSS default) the
  // nine missing tables and the sentence that explains them read as one
  // sentence, which is how "resume it in Connections" ends up glued to a
  // column name.
  p.style.cssText = "margin:0;color:#52525b;white-space:pre-wrap";
  box.append(h, p);
  mount.append(box);
}

/**
 * The transport's code for a failure, when it carried one.
 *
 * Duck-typed rather than `instanceof`: the reason travels through
 * `snapshotFailure()` as a plain `Error`, and a build that swaps transports
 * should not have to share a class for the screen above to stay accurate.
 */
function codeOf(reason: Error | null): string | null {
  const code = (reason as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

async function boot(): Promise<void> {
  /*
   * THE TRANSPORT IS CHOSEN AT BUILD TIME, and the two are not interchangeable.
   *
   *   hosted staff  → the operator's session at this same origin. No key, no
   *                   scope, no CORS: `/api/v1/*` with the session cookie, the
   *                   same calls the dashboard makes.
   *   otherwise     → the public API with a publishable key (or, with neither
   *                   variable set, no backend at all and the seeded demo).
   *
   * `HOSTED` folds to a literal, so a standalone build does not contain the
   * session transport and a hosted one does not contain the public client.
   */
  /*
   * The staff surface asks WHICH DATABASE it belongs to before it reads one
   * (29 D9). Null — unbound, or an Adminium too old to answer — keeps the old
   * inference, so this is additive for every instance that has one connection.
   */
  const boundConnection =
    HOSTED && SURFACE_SIDE === "staff" ? await resolveStaffConnectionId() : null;

  const port =
    HOSTED && SURFACE_SIDE === "staff"
      ? createSessionTransport({
          tableOfRef: TABLE_OF_REF,
          connectionId: boundConnection ?? undefined,
        }).port
      : // Baked vars first, then — hosted customer — the SERVED config
        // (surface-config.json, 29 D10): the key an operator bound in Studio,
        // fetched at boot, so rotation is Studio + reload with no rebuild.
        await clientFromConfig();

  /*
   * A NON-DEMO BUILD NEVER RENDERS DEMO DATA.
   *
   * This used to fall through: no port, or a failed snapshot, and the seam kept
   * its `demoSource` default, so a real deployment whose backend was
   * unreachable painted a plausible studio full of invented invoices — for real
   * people, with no error. Falling back to fiction is the failure mode the
   * whole build-time split exists to remove, so it is a hard stop here instead.
   *
   * The demo build is the ONE that may use `demoSource`, and it reaches it by
   * skipping this block entirely.
   */
  if (!DEMO) {
    const failure =
      port === null
        ? "This build has no backend configured. A hosted customer surface needs " +
          "a key bound to it in Studio (or VITE_ADMINIUM_PUBLISHABLE_KEY baked at " +
          "build time); a standalone build needs that and VITE_ADMINIUM_API_BASE_URL."
        : null;

    const snap = failure === null && port !== null ? await loadSnapshot(port) : null;
    if (snap === null) {
      const reason = failure === null ? snapshotFailure() : null;
      showStartupFailure(
        container as HTMLElement,
        reason !== null
          ? // The server said WHY. Repeating a generic sentence over the top of a
            // specific one is how an operator ends up checking a key that does not
            // exist in a build that never had one.
            reason.message
          :
        failure ??
          "Could not load data from Adminium. The server may be unreachable, the " +
            "session may have expired, or this app's tables may not match what it reads.",
        // `failure` is set only on the no-backend path, which throws nothing and
        // so carries no code of its own.
        failure === null ? codeOf(reason) : "NO_BACKEND",
      );
      return;
    }

    // Before `App` mounts, so the first paint formats in the tenant's
    // currency rather than flashing dollars and correcting itself.
    setTenantCurrency(snap.currency);
    // Same timing, same reason: the zone notice must be there on the first
    // paint, not appear after one.
    setTimezoneClaim(snap.timezone, snap.timezoneSource);
    setDataSource(snapshotSource(snap));
    console.info(
      `[adminium] connected: ${String(snap.clients.length)} clients, ` +
        `${String(snap.invoices.length)} invoices`,
    );
  }

  const { default: App } = await import("./app/App.tsx");

  /*
   * A surface build IS one persona. The store still carries both — the demo is
   * one bundle telling a two-sided story and needs the switch — so a pinned
   * build sets it once here, before the first paint, rather than shipping a
   * second store. `PINNED_PERSONA` folds to `null` in the demo and standalone
   * builds, so this block is eliminated from them entirely.
   *
   * The import is dynamic for the same reason `App`'s is: `state/store.ts`
   * reads the seam at module scope, and a static import here would evaluate it
   * during THIS module's imports, before the swap above. It resolves from the
   * module cache — `App` has already pulled it — so it costs no round trip.
   */
  /*
   * The side→persona map is the ONE app-specific line here, which is why it
   * lives in this file and not in `surface.ts`: every app names its personas
   * differently (studio/client, clinic/patient, shopper/maker) and a shared
   * module that knew those names could not be shared.
   */
  const persona = SURFACE_SIDE === "staff" ? "studio" : SURFACE_SIDE === "customer" ? "client" : null;
  if (persona !== null) {
    const { useStore } = await import("./state/store.ts");
    useStore.getState().setPersona(persona);
  }

  /*
   * URL ⇄ SCREEN, and the host bridge — both hosted-only, both before the
   * first paint (29-app-surfaces.md D6/D8).
   *
   * Order matters and is not obvious:
   *
   *  1. `attachUrlSync` reads the CURRENT path and applies it, so a reload of
   *     `/apps/clients/staff/invoices` renders invoices rather than home and
   *     then correcting itself.
   *  2. `connectToHost` handshakes with the dashboard, if there is one. It is
   *     AWAITED so `isEmbedded()` is settled before any component renders —
   *     otherwise the app paints its own sidebar and removes it 250 ms later,
   *     which is worse than either placement on its own. Un-framed, it returns
   *     immediately and costs nothing: the timeout only exists once there is a
   *     parent that might not answer.
   *  3. The store subscription reflects later screen changes into the URL and
   *     tells the host, so the dashboard's address bar follows the app.
   *
   * `HOSTED` folds to a literal, so a demo or standalone build contains none of
   * this — not the bridge, not the sync, not the subscription.
   */
  if (HOSTED) {
    const { useStore } = await import("./state/store.ts");
    const { attachUrlSync } = await import("./urlSync.ts");
    const { connectToHost } = await import("./embed.ts");
    const { SURFACE_NAV, APP_KEY } = await import("./surface-nav.ts");
    const { setHostLocale } = await import("./i18n/index.tsx");

    // Forward reference on purpose: the sync reports paths TO the bridge, and
    // the bridge applies paths THROUGH the sync. Nothing fires before both
    // exist — `attachUrlSync`'s own boot read does not call `onPath`.
    let bridge: { navigated: (path: string) => void } | null = null;

    const sync = attachUrlSync({
      nav: SURFACE_NAV,
      side: SURFACE_SIDE,
      go: (view) => useStore.getState().go(view),
      current: () => useStore.getState().view,
      onPath: (path) => bridge?.navigated(path),
    });

    bridge = await connectToHost(APP_KEY, SURFACE_SIDE as "staff" | "customer", sync.path(), {
      onTheme: (theme) => useStore.getState().setHostTheme(theme),
      onLocale: setHostLocale,
      onPath: (path) => sync.applyPath(path),
    });

    useStore.subscribe(sync.reflect);
  }

  /*
   * THE BROWSER TAB carries the operator's name too.
   *
   * Everything on screen resolves through `useBrand()`, but the tab is not on
   * screen — it is the static `<title>` in index.html, which is the name this
   * app was BUILT with. Rename the app in Adminium and every heading changes
   * while the tab still says "Client Portal", which is the same half-applied
   * rename this whole change exists to remove.
   *
   * Only when an override is set: with none, index.html's own title is already
   * the right answer and rewriting it with the same string is noise.
   */
  const named = appName();
  if (named !== null) document.title = named;

  createRoot(container as HTMLElement).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}

void boot();
