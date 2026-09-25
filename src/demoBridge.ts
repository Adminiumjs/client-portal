/**
 * The demo's side of the website card's protocol (`demo-types.ts`): the card
 * picks a side and a screen, runs a screen's shortcuts, sets the language and
 * the theme, moves the clock a week on and puts it back; this answers with
 * the app's state after every change — which screen, which side, the clock as
 * the card should print it, and whether a sheet is covering the page (the
 * card hides then).
 *
 * The shortcuts act the way the studio or a client would: a client accepts
 * and signs through their own side of the demo's world, a payment is
 * recorded through the desk's door — so what follows (the stamps, the
 * fingerprint, the receipt, the notice to the studio) is the world's, as it
 * would be Adminium's. A shortcut that fills a form sends the screen a
 * signal with everything it fills (`state/demoSignal.ts`), so no screen holds
 * a word of the demo's own.
 *
 * Only the demo build contains this file (`DEMO` folds it away), and only a
 * page framed by the website's own origin speaks it.
 */
import { DEMO_APP_KEY, DEMO_CLOCK_STEP_DAYS, DEMO_LIT_BY, DEMO_SCREENS, type DemoShortcutId } from "./demo-card.ts";
import { DEMO_PROTOCOL_VERSION, isDemoMessage, type DemoMessage } from "./demo-types.ts";
import { DEMO_CLIENT_ID } from "./data/demo.ts";
import type { Id, TableRef } from "./data/types.ts";
import { venueDay } from "./data/venueTime.ts";
import { DEMO_LINK_TOKEN, demoWorld, type DemoWorld } from "./demo/world.ts";
import { demoText } from "./demo/strings.ts";
import { setHostLocale } from "./i18n/index.tsx";
import { locale as currentLocale } from "./i18n/ambient.ts";
import { formatMoney } from "./lib/money.ts";
import { DEMO_ZONE } from "./lib/clock.ts";
import type { Persona, View } from "./app/routes.ts";
import { loadDesk } from "./state/desk.ts";
import { sendDemoSignal } from "./state/demoSignal.ts";
import { loadPortal, loadStudio, resetPortal, setPortalPort } from "./state/portal.ts";
import { useSheets } from "./state/sheets.ts";
import { go, open, setPersona, toast, useUi, type Selected } from "./state/ui.ts";

export { DEMO_APP_KEY } from "./demo-card.ts";

/** The sample's rows the card's chips and shortcuts open, by number (history keeps its numbers). */
const TARGETS = {
  proposal: "QUO-S1142",
  clientProposal: "QUO-S1138",
  project: "PRJ-S01",
  pausedProject: "PRJ-S03",
  handover: "PRJ-S04",
  invoice: "INV-S2039",
  paidInvoice: "INV-S2036",
  review: "Wordmark for dark surfaces",
} as const;

/** The sample's addresses the sign-in shortcuts type. */
const AMARA = "amara@hearthandloaf.example";
const STRANGER = "someone@elsewhere.example";

let activeClient: Id = DEMO_CLIENT_ID;

const world = (): DemoWorld => {
  const found = demoWorld();
  if (found === null) throw new Error("the demo's world is not booted");
  return found;
};
const say = (key: string, vars: Record<string, string> = {}) => demoText(key, currentLocale(), vars);
const byNumber = (ref: TableRef, number: string) => world().rows[ref].find((row) => row["number"] === number);
const company = (clientId: unknown) => String(world().rows.clients.find((c) => String(c.id) === String(clientId))?.["company"] ?? "");

// ── the clock as the card prints it ─────────────────────────────────────────

/** "Tue 28 Jul" in English, the page's own weekday, day and month elsewhere; with the year for a toast. */
export function clockLabel(at: number, locale: string, zone: string = DEMO_ZONE, withYear = false): string {
  const english = locale.startsWith("en");
  const format = new Intl.DateTimeFormat(english ? "en-GB" : locale, { timeZone: zone, weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return english ? format.format(at).replace(/,/g, "") : format.format(at);
}

// ── screens ─────────────────────────────────────────────────────────────────

/** The card's screen for what is showing (a view some other chip stands for lights that chip). */
export function currentScreen(): string {
  const { view, persona } = useUi.getState();
  const lit = DEMO_LIT_BY[`${persona}:${view}`];
  if (lit !== undefined) return lit;
  return DEMO_SCREENS.find((s) => s.persona === persona && s.view === view)?.id ?? view;
}

/** The row a detail chip opens when nothing is chosen yet: one the sample makes worth seeing. */
function defaultRow(persona: Persona, view: string): { key: keyof Selected; id: Id } | null {
  const pick = (ref: TableRef, number: string) => byNumber(ref, number)?.id;
  const studio: Record<string, [keyof Selected, Id | undefined]> = {
    proposal: ["proposal", pick("proposals", TARGETS.proposal)],
    project: ["project", pick("projects", TARGETS.project)],
    handover: ["project", pick("projects", TARGETS.handover)],
    client: ["client", DEMO_CLIENT_ID],
    invoice: ["invoice", pick("invoices", TARGETS.invoice)],
    print: ["invoice", pick("invoices", TARGETS.invoice)],
    review: ["deliverable", world().rows.deliverables.find((d) => d["title"] === TARGETS.review)?.id],
  };
  const client: Record<string, [keyof Selected, Id | undefined]> = {
    proposal: ["proposal", pick("proposals", TARGETS.clientProposal)],
    project: ["project", pick("projects", TARGETS.project)],
    invoice: ["invoice", pick("invoices", TARGETS.invoice)],
  };
  const found = (persona === "studio" ? studio : client)[view];
  return found === undefined || found[1] === undefined ? null : { key: found[0], id: found[1] };
}

export function goToScreen(id: string): void {
  const screen = DEMO_SCREENS.find((s) => s.id === id);
  if (screen === undefined) return;
  if (useUi.getState().persona !== screen.persona) choosePersona(screen.persona);
  // A shared handover is opened by its link: the project's share code.
  if (screen.id === "cwrap") {
    const project = byNumber("projects", TARGETS.handover);
    useUi.setState({ token: typeof project?.["share_token"] === "string" ? project["share_token"] : null });
  }
  const chosen = defaultRow(screen.persona, screen.view);
  if (chosen !== null && useUi.getState().selected[chosen.key] === null) {
    open(screen.view as never, chosen.id);
    return;
  }
  go(screen.view as View);
}

// ── who the clients' side is ────────────────────────────────────────────────

/** The clients' side, signed in as another of the studio's clients (a shortcut about their row). */
async function signInAs(clientId: Id): Promise<void> {
  if (String(clientId) === String(activeClient) && useUi.getState().persona === "client") return;
  activeClient = clientId;
  resetPortal();
  setPortalPort(world().portal(clientId));
  await loadStudio(true);
  await loadPortal();
}

function choosePersona(persona: Persona): void {
  setPersona(persona);
  if (persona === "client") void signInAs(activeClient);
}

/** Everything read again: the desk's open work (today moved) and the client's rows. */
async function readAgain(): Promise<void> {
  await Promise.all([loadDesk(), loadPortal()]);
}

// ── the shortcuts ───────────────────────────────────────────────────────────

async function asClient(clientId: unknown, view: "proposal" | "project" | "invoice", id: Id): Promise<void> {
  await signInAs(clientId as Id);
  if (useUi.getState().persona !== "client") setPersona("client");
  open(view, id);
}

const halfOf = (balance: string): string => (Math.floor((Number(balance) * 100) / 2) / 100).toFixed(2);

function shortcuts(): Record<DemoShortcutId, () => Promise<void> | void> {
  const w = world();
  const today = () => venueDay(w.now(), DEMO_ZONE);
  /** The studio's invoice on screen (or the sample's), if it is sent with something to pay. */
  const openInvoice = () => {
    const id = useUi.getState().selected.invoice ?? byNumber("invoices", TARGETS.invoice)?.id;
    const invoice = w.rows.invoices.find((i) => String(i.id) === String(id));
    return invoice !== undefined && invoice["status"] === "sent" && Number(invoice["balance"]) > 0 ? invoice : undefined;
  };
  /** A file on the studio's project that waits on the client. */
  const waitingFile = () => {
    const id = useUi.getState().selected.project ?? byNumber("projects", TARGETS.project)?.id;
    return w.rows.deliverables.find((d) => String(d["project_id"]) === String(id) && d["status"] === "pending");
  };
  const review = async (status: "approved" | "changes") => {
    const file = waitingFile();
    if (file === undefined) return toast(say("demo.toast.openProject"), { icon: "info" });
    await w.portal(file["client_id"] as Id).review(file.id, status, status === "changes" ? say("demo.fill.changesNote") : null);
    const vars = { client: company(file["client_id"]), title: String(file["title"]) };
    toast(say(status === "changes" ? "demo.toast.changesAsked" : "demo.toast.approved", vars), { icon: status === "changes" ? "message-square" : "check" });
  };
  return {
    amara: () => sendDemoSignal("signin.fill", { email: AMARA }),
    "unknown-address": () => sendDemoSignal("signin.fill", { email: STRANGER, send: "yes" }),
    "open-link": async () => {
      await signInAs(DEMO_CLIENT_ID);
      const invoice = byNumber("invoices", TARGETS.invoice);
      if (useUi.getState().persona !== "client") setPersona("client");
      useUi.setState((s) => ({ token: DEMO_LINK_TOKEN, selected: { ...s.selected, invoice: invoice?.id ?? null } }));
      go("link");
    },
    "expire-link": () => {
      w.expireLink();
      toast(say("demo.toast.linkExpired"), { icon: "unplug" });
      if (useUi.getState().view === "link") go("link");
    },
    "out-of-date": async () => {
      const proposal = byNumber("proposals", TARGETS.proposal);
      if (proposal === undefined) return;
      // Out of date is a matter of days: the clock moves on a week at a time until it is.
      let weeks = 0;
      while (weeks < 8 && String(proposal["valid_until"] ?? "9999") >= today()) {
        w.advance(7);
        weeks += 1;
      }
      if (weeks > 0) toast(say("demo.toast.now", { day: clockLabel(w.now(), currentLocale(), DEMO_ZONE, true) }), { icon: "fast-forward" });
      await asClient(proposal["client_id"], "proposal", proposal.id);
    },
    "paused-work": async () => {
      const project = byNumber("projects", TARGETS.pausedProject);
      if (project !== undefined) await asClient(project["client_id"], "project", project.id);
    },
    "already-paid": async () => {
      const invoice = byNumber("invoices", TARGETS.paidInvoice);
      if (invoice !== undefined) await asClient(invoice["client_id"], "invoice", invoice.id);
    },
    "call-comes-in": () =>
      sendDemoSignal("enquiries.call", { name: "Rosa Lindqvist", business: "Orchard Row Cider", email: "rosa@orchardrow.example", body: say("demo.fill.callBody") }),
    "sample-proposal": () => {
      const client = w.rows.clients.find((c) => c["company"] === "Slow Signal") ?? w.rows.clients[0];
      sendDemoSignal("composer.fill", {
        client_id: String(client?.id ?? ""),
        title: say("demo.fill.proposalTitle"),
        scope: say("demo.fill.proposalScope"),
        lines: JSON.stringify([
          { description: say("demo.fill.lineEpisode"), qty: "8", rate: "180.00" },
          { description: say("demo.fill.lineKeyArt"), qty: "1", rate: "950.00" },
        ]),
      });
    },
    "accepts-and-signs": async () => {
      const proposal = byNumber("proposals", TARGETS.proposal);
      if (proposal === undefined) return;
      const inDate = proposal["valid_until"] === null || String(proposal["valid_until"]) >= today();
      if (proposal["status"] !== "sent" || !inDate) return toast(say("demo.toast.notWaiting", { number: String(proposal["number"]) }), { icon: "info" });
      const signer = w.rows.clients.find((c) => String(c.id) === String(proposal["client_id"]));
      await w.portal(proposal["client_id"] as Id).accept(proposal.id, String(signer?.["contact_name"] ?? ""));
      toast(say("demo.toast.accepted", { client: String(signer?.["contact_name"] ?? ""), number: String(proposal["number"]) }), { icon: "pen-line" });
    },
    "asks-for-changes": () => review("changes"),
    approves: () => review("approved"),
    "part-payment": async () => {
      const invoice = openInvoice();
      if (invoice === undefined) return toast(say("demo.toast.openInvoice"), { icon: "info" });
      const amount = halfOf(String(invoice["balance"]));
      await w.writes.insert("payments", { document_id: invoice.id, amount, method: "bank-transfer", paid_on: today() });
      toast(say("demo.toast.recorded", { amount: formatMoney(amount, String(invoice["currency"] ?? "USD"), currentLocale()), number: String(invoice["number"]) }), { icon: "receipt" });
    },
    "says-paid": async () => {
      const invoice = openInvoice();
      if (invoice === undefined) return toast(say("demo.toast.openInvoice"), { icon: "info" });
      await w.portal(invoice["client_id"] as Id).sentPayment(invoice.id, { on: today(), amount: String(invoice["balance"]), note: say("demo.fill.paidNote") });
      toast(say("demo.toast.saysPaid", { client: company(invoice["client_id"]), number: String(invoice["number"]) }), { icon: "hand-coins" });
    },
  };
}

/** Run one of the card's shortcuts; a refusal the world gives is shown as the app shows any. */
export async function runShortcut(id: string): Promise<void> {
  const run = (shortcuts() as Record<string, (() => Promise<void> | void) | undefined>)[id];
  if (run === undefined) return;
  try {
    await run();
  } catch (error) {
    toast(error instanceof Error ? error.message : String(error), { icon: "circle-alert", tone: "danger" });
  }
}

// ── the clock row ───────────────────────────────────────────────────────────

export function advanceClock(step: string): void {
  const days = DEMO_CLOCK_STEP_DAYS[step];
  if (days === undefined) return;
  world().advance(days);
  toast(say("demo.toast.now", { day: clockLabel(world().now(), currentLocale(), DEMO_ZONE, true) }), { icon: "fast-forward" });
}

export function resetDemo(): void {
  world().reset();
  activeClient = DEMO_CLIENT_ID;
  resetPortal();
  setPortalPort(world().portal(DEMO_CLIENT_ID));
  void Promise.all([loadStudio(true), readAgain()]);
  toast(say("demo.toast.reset", { day: clockLabel(world().now(), currentLocale()) }), { icon: "rotate-ccw" });
}

/** The page's language, and the sample's words with it. */
function language(tag: string): void {
  setHostLocale(tag);
  world().relabel(currentLocale());
}

// ── the protocol ────────────────────────────────────────────────────────────

function stateMessage(): DemoMessage {
  const ui = useUi.getState();
  return {
    type: "adminium:demo:state",
    dv: DEMO_PROTOCOL_VERSION,
    screen: currentScreen(),
    persona: ui.persona,
    mode: null,
    online: true,
    toggles: {},
    locale: currentLocale(),
    theme: ui.theme,
    clockLabel: clockLabel(world().now(), currentLocale()),
    overlay: useSheets.getState().open !== null || ui.menu,
  };
}

export function applyDemoMessage(message: DemoMessage): void {
  switch (message.type) {
    case "adminium:demo:init":
      language(message.locale);
      useUi.setState({ theme: message.theme });
      if (message.persona === "studio" || message.persona === "client") choosePersona(message.persona);
      if (message.screen !== undefined) goToScreen(message.screen);
      return;
    case "adminium:demo:go":
      goToScreen(message.screen);
      return;
    case "adminium:demo:do":
      void runShortcut(message.shortcut);
      return;
    case "adminium:demo:set":
      if (message.theme !== undefined) useUi.setState({ theme: message.theme });
      if (message.locale !== undefined) language(message.locale);
      if (message.persona === "studio" || message.persona === "client") choosePersona(message.persona);
      return;
    case "adminium:demo:clock":
      advanceClock(message.advance);
      return;
    case "adminium:demo:reset":
      resetDemo();
      return;
    default:
      return;
  }
}

export function startDemoBridge(): () => void {
  // Whatever moves the whole world (the clock, a reset, the language) is read again by every screen.
  const offReload = demoWorld()?.onReload(() => void readAgain()) ?? (() => {});
  if (typeof window === "undefined" || window.parent === window) return offReload;
  const origin = window.location.origin;
  const parent = window.parent;
  const post = (message: DemoMessage) => parent.postMessage(message, origin);
  let last = "";
  const report = () => {
    const message = stateMessage();
    const text = JSON.stringify(message);
    if (text === last) return;
    last = text;
    post(message);
  };
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== origin || event.source !== parent || !isDemoMessage(event.data)) return;
    applyDemoMessage(event.data);
    report();
    setTimeout(report, 50);
  };
  window.addEventListener("message", onMessage);
  const unsubscribe = [useUi.subscribe(report), useSheets.subscribe(report), demoWorld()?.onReload(report) ?? (() => {})];
  post({ type: "adminium:demo:hello", dv: DEMO_PROTOCOL_VERSION, appKey: DEMO_APP_KEY });
  return () => {
    window.removeEventListener("message", onMessage);
    offReload();
    for (const off of unsubscribe) off();
  };
}
