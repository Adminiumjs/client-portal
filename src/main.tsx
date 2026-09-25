/*
 * Entry point: the stylesheets in cascade order, then one of three boots,
 * chosen at build time.
 *
 *   the desk           hosted by Adminium (`build:surface:staff`): the signed-in
 *                      staff member's session, the tables' real names from the
 *                      staff config, the boot read set, live updates
 *   the clients' side  hosted by Adminium (`build:surface:customer`): the
 *                      portal's browser key, the sign-in link, the client's own
 *                      rows, a re-read on focus and on navigation
 *   the demo           the website's card (`build:demo`, and `npm run dev`):
 *                      the sample studio in memory, both sides
 *
 * `SURFACE_SIDE` and `DEMO` fold to literals, so each build carries only its
 * own boot, and the clients' bundle nothing of the desk.
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/frame.css";
import "./styles/primitives.css";
import "./styles/home.css";
import "./styles/enquiries.css";
import "./styles/proposals.css";
import "./styles/composer.css";
import "./styles/projects.css";
import "./styles/review.css";
import "./styles/handover.css";
import "./styles/clients.css";
import "./styles/invoices.css";
import "./styles/chasing.css";
import "./styles/terms.css";
import "./styles/settings.css";
import "./styles/sheets.css";
import "./styles/client.css";
import "./styles/time.css";
import "./styles/expenses.css";
import "./styles/suppliers.css";
import "./styles/scoping.css";
import "./styles/schedule.css";
import "./styles/capacity.css";
import "./styles/money.css";
import "./styles/archive.css";
import "./styles/emails.css";
import "./styles/enquire.css";

import { I18nProvider, initialLocale, setHostLocale } from "./i18n/index.tsx";
import { appName, setTenantCurrency, setTimezoneClaim } from "./i18n/ambient.ts";
import { DEMO, HOSTED, SURFACE_SIDE } from "./surface.ts";
import { DEMO_ZONE, demoClock, setClockSource, setZone } from "./lib/clock.ts";
import { setServerZone } from "./data/venueTime.ts";
import { go, open, useUi } from "./state/ui.ts";
import { showStartupFailure as drawStartupFailure, type StartupDetail } from "./startupFailure.ts";

const container = document.getElementById("root");
if (!container) throw new Error("Missing #root — check index.html");
const mount: HTMLElement = container;

/** A startup that failed: the card, in the page's language, in place of the app. */
function showStartupFailure(detail: StartupDetail, code: string | null): void {
  drawStartupFailure(mount, detail, code, initialLocale());
}

const codeOf = (error: unknown): string | null => {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
};
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function render(App: () => React.JSX.Element | null): void {
  const named = appName();
  if (named !== null) document.title = named;
  createRoot(mount).render(
    <StrictMode>
      <I18nProvider>
        <App />
      </I18nProvider>
    </StrictMode>,
  );
}

/** The theme the operating system asks for, until a host or the demo says otherwise. */
function systemTheme(): "light" | "dark" {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * URL ⇄ screen and the dashboard bridge (hosted builds only): a reload of
 * `/apps/clients/staff/invoices` opens the invoices, `invoices/12` that
 * invoice, the dashboard's address bar follows the app, and its theme and
 * language reach it.
 */
async function wireHost(side: "staff" | "customer"): Promise<void> {
  if (!HOSTED) return;
  const [{ attachUrlSync, pathUnderBase, surfaceBase }, { connectToHost }, { SURFACE_NAV, APP_KEY }, { detailFromPath, unknownPath }] = await Promise.all([
    import("./urlSync.ts"),
    import("./embed.ts"),
    import("./surface-nav.ts"),
    import("./app/deepLink.ts"),
  ]);
  const bootPath = pathUnderBase(window.location.pathname, surfaceBase(window.location.pathname, import.meta.env.BASE_URL));
  let bridge: { navigated: (path: string) => void } | null = null;
  const sync = attachUrlSync({
    nav: SURFACE_NAV,
    side,
    go: (view) => go(view),
    current: () => useUi.getState().view,
    onPath: (path) => bridge?.navigated(path),
  });
  const detail = detailFromPath(side, bootPath);
  if (detail !== null) open(detail.view, detail.id);
  // An address that names no screen is the side's 404, not its first page passed off as the right one.
  else if (unknownPath(side, bootPath)) go("notfound");
  bridge = await connectToHost(APP_KEY, side, sync.path(), {
    onTheme: (theme) => useUi.setState({ theme: theme === "dark" ? "dark" : "light" }),
    onLocale: setHostLocale,
    onPath: (path) => sync.applyPath(path),
  });
  useUi.subscribe(sync.reflect);
}

/**
 * THE CLIENTS' SIDE — served by Adminium to anyone on the internet. No desk,
 * no staff session: only the public API through the portal's browser key
 * (which Adminium serves beside the bundle) and, once a client signs in by
 * link, their own session.
 */
async function bootClients(): Promise<void> {
  const { resolveSurfaceConfig } = await import("./publicConfig.ts");
  const config = await resolveSurfaceConfig();
  if (config === null) {
    showStartupFailure({ key: "startup.noBookingKey" }, "NO_BACKEND");
    return;
  }
  const { createPublicClient } = await import("@adminiumjs/public-client");
  // Signing in by link asks for the human check first rather than being refused once.
  const client = createPublicClient({ baseUrl: config.baseUrl, publishableKey: config.publishableKey, humanCheck: true } as never);
  if (client === null) {
    showStartupFailure({ key: "startup.noServer" }, "NO_BACKEND");
    return;
  }
  // A shared handover opens on its own key, beside the portal's: the link's code is its only claim.
  const handoverKey = config.publicKeys?.["handover"];
  const handover = handoverKey === undefined ? null : createPublicClient({ baseUrl: config.baseUrl, publishableKey: handoverKey } as never);
  const [{ publicPortalPort }, portal, { linkFragment }] = await Promise.all([import("./data/publicSource.ts"), import("./state/portal.ts"), import("./app/deepLink.ts")]);
  try {
    const port = await publicPortalPort(client as never, { tables: config.tables ?? {}, handover: handover as never });
    portal.setPortalPort(port);
    setZone(port.timeZone());
    setTimezoneClaim(port.timeZone(), "operator");
    setTenantCurrency(port.currency());
  } catch (error) {
    const { isSwitchedOff } = await import("./app/switchedOff.ts");
    if (isSwitchedOff(codeOf(error))) {
      // Switched off by the studio, not broken: the clients' own "not available" page, in their language.
      portal.usePortal.setState({ loadError: codeOf(error) });
      useUi.setState({ persona: "client", view: "notavailable", theme: systemTheme() });
      const { default: App } = await import("./app/App.tsx");
      render(App);
      return;
    }
    showStartupFailure({ text: messageOf(error) }, codeOf(error));
    return;
  }
  setClockSource(() => Date.now());
  /*
   * A sign-in or share link carries its token — and where a sign-in link
   * should land (`&to=invoices/12`) — in the fragment: both are read once,
   * BEFORE the fragment is taken out of the address, and kept for the page
   * that uses them (`landing` is spent after sign-in).
   */
  const { token, landing } = linkFragment(window.location.hash);
  if (token !== null) history.replaceState(history.state, "", window.location.pathname + window.location.search);
  useUi.setState({ persona: "client", view: "find", theme: systemTheme(), token, landing });
  await wireHost("customer");
  await portal.loadStudio();
  if (portal.portalPort().signedIn()) {
    await portal.loadPortal();
    if (useUi.getState().view === "find") useUi.setState({ view: "home" });
  }
  portal.attachPortalRefresh();
  const { default: App } = await import("./app/App.tsx");
  render(App);
}

/**
 * THE DESK — the staff side, served by Adminium to the signed-in person. It
 * boots from the staff config alone: the database, the tables' real names,
 * the studio's clock and currency, who is signed in (and what they may do),
 * and the token their saves carry.
 */
async function bootDesk(): Promise<void> {
  const [{ loadStaffConfig }, { createSessionTransport }, { realTables }, { REQUIRED, sessionDeskReads }, { sessionSink }, { setStaffToken }] = await Promise.all([
    import("./staffConnection.ts"),
    import("./data/sessionSource.ts"),
    import("./data/tableOfRef.ts"),
    import("./data/adminiumSource.ts"),
    import("./data/sink.ts"),
    import("./data/staffSession.ts"),
  ]);
  const staff = await loadStaffConfig();
  if (staff === null) {
    showStartupFailure({ key: "startup.noConfig" }, "NO_BACKEND");
    return;
  }
  if (staff.serverTimezone !== null) setServerZone(staff.serverTimezone);
  const tables = realTables(staff.tables);
  let csrf = staff.csrfToken;
  const refreshToken = async () => {
    csrf = (await loadStaffConfig())?.csrfToken ?? csrf;
    return csrf;
  };
  const transport = createSessionTransport({
    tableOfRef: tables,
    ...(staff.connectionId === null ? {} : { connectionId: staff.connectionId }),
    ...(staff.csrfToken === null
      ? {}
      : {
          staff: { csrfToken: staff.csrfToken, timezone: staff.timezone, timezoneSource: staff.timezoneSource, serverTimezone: staff.serverTimezone, currency: staff.currency },
          refreshToken,
        }),
  });
  let zone = "UTC";
  try {
    const config = await transport.port.config();
    zone = config.timezone;
    setTimezoneClaim(config.timezone, config.timezoneSource ?? null);
    setTenantCurrency(config.currency ?? staff.currency ?? "USD");
    await transport.port.assertRefs(REQUIRED);
  } catch (error) {
    showStartupFailure({ text: messageOf(error) }, codeOf(error));
    return;
  }
  setZone(zone);
  setClockSource(() => Date.now());
  setStaffToken(() => csrf);

  const [desk, { onSignedOut }] = await Promise.all([import("./state/desk.ts"), import("./state/outcome.ts")]);
  desk.useDesk.setState({
    me: desk.meOf(staff.user, staff.access),
    // The attached add-ons' public settings (Holiday calendars' days …), as the staff config carries them.
    addOns: Object.fromEntries(Object.entries(staff.addOns).map(([key, addOn]) => [key, { values: addOn.settings, declared: Object.keys(addOn.settings) }])),
  });
  desk.setDeskReads(sessionDeskReads(transport, (ref) => desk.can(ref, "read")));
  desk.setDeskWrites(sessionSink(transport, tables, { csrfToken: () => csrf }));
  onSignedOut(() => useUi.setState({ signedOut: true }));
  useUi.setState({ persona: "studio", view: "home", theme: systemTheme() });
  await Promise.all([desk.loadDesk(), desk.loadAddOnSettings("invoices")]);
  if (desk.useDesk.getState().load === "failed") {
    const loadError = desk.useDesk.getState().loadError;
    showStartupFailure(loadError === null ? { key: "startup.deskUnread" } : { text: loadError }, null);
    return;
  }

  /*
   * LIVE UPDATES: other computers at the studio, and clients on the portal.
   * Off (with a warning) if the stream cannot start: the desk still works, it
   * just follows other computers only when it reads again.
   */
  const [{ startLive }, { applyFrame, resync }] = await Promise.all([import("./data/live.ts"), import("./state/live.ts")]);
  void startLive({ transport, tables, readable: (ref) => desk.can(ref, "read"), onFrame: applyFrame, onReconnect: () => void resync() }).catch((error: unknown) =>
    console.warn("[clients] live updates are off:", error),
  );

  await wireHost("staff");
  const { default: App } = await import("./app/App.tsx");
  render(App);
}

/**
 * THE DEMO — the website's card, with no server: the app's own sample,
 * added in memory at 10:00 on a pinned Tuesday, run by the same screens and
 * the same actions, with Adminium's rules played by the demo's world.
 * `DEMO` folds to a literal, so no other build contains any of it.
 */
async function bootDemo(): Promise<void> {
  const [{ createWorld }, { demoSample }, { DEMO_STAFF, DEMO_CLIENT_ID }, desk, portal, live] = await Promise.all([
    import("./demo/world.ts"),
    import("./demo/sample.ts"),
    import("./data/demo.ts"),
    import("./state/desk.ts"),
    import("./state/portal.ts"),
    import("./state/live.ts"),
  ]);
  const clock = demoClock();
  setZone(DEMO_ZONE);
  setTimezoneClaim(DEMO_ZONE, "operator");
  setTenantCurrency("USD");
  // The sample is added in the language the page opens in; the card's language changes relabel it.
  const opening = new URLSearchParams(window.location.search).get("lang") ?? "en-US";
  const world = createWorld(demoSample(opening), clock.now, DEMO_ZONE, { name: DEMO_STAFF.name });
  // The card moves the world's clock: every screen reads the time from it.
  setClockSource(world.now);
  // The printed copy opens the HTML the add-on drew at build time (no PDF: there is no server to draw one).
  desk.setDeskReads({
    ...world.reads,
    documentUrl: async (kind, ref, id, locale) => {
      const printUrl = await world.documentUrl(kind, ref, id, locale);
      return printUrl === null ? null : { printUrl, contentUrl: null };
    },
  });
  desk.setDeskWrites(world.writes);
  portal.setPortalPort(world.portal(DEMO_CLIENT_ID));
  desk.useDesk.setState({ me: { name: DEMO_STAFF.name, email: DEMO_STAFF.email, roleName: DEMO_STAFF.roleName, manager: true, access: null } });
  useUi.setState({ persona: "studio", view: "home", theme: systemTheme() });
  /*
   * The demo on its own opens where its address says:
   * `?persona=client&view=home&theme=dark&lang=ar-EG`. It is how a screenshot,
   * a test or a reviewer reaches one screen directly.
   */
  const asked = new URLSearchParams(window.location.search);
  const persona = asked.get("persona");
  if (persona === "client" || persona === "studio") useUi.setState({ persona, view: "home" });
  const view = asked.get("view");
  if (view !== null && view !== "") useUi.setState({ view: view as never });
  const theme = asked.get("theme");
  if (theme === "light" || theme === "dark") useUi.setState({ theme });
  const lang = asked.get("lang");
  if (lang !== null) setHostLocale(lang);
  await Promise.all([desk.loadDesk(), desk.loadAddOnSettings("invoices"), portal.loadStudio(), portal.loadPortal()]);
  // The world announces its changes as the live stream would: the desk follows the clients' side, and back.
  world.subscribe((frame) => {
    live.applyFrame(frame);
    void portal.refreshOpen();
  });
  const { startDemoBridge } = await import("./demoBridge.ts");
  startDemoBridge();
  const { default: App } = await import("./app/App.tsx");
  render(App);
}

async function boot(): Promise<void> {
  if (SURFACE_SIDE === "customer") {
    await bootClients();
    return;
  }
  if (HOSTED && SURFACE_SIDE === "staff") {
    await bootDesk();
    return;
  }
  if (DEMO) {
    await bootDemo();
    return;
  }
  // A developer's mistake, not an operator's: said once, in English.
  showStartupFailure(
    {
      text: "The desk saves as the person signed in to Adminium, so it runs only inside Adminium. Build it with `npm run build:surface` and open it from the Client Portal section.",
    },
    "NO_BACKEND",
  );
}

void boot();
