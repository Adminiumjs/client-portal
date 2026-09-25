/**
 * The demo's side of the website card's protocol (`demo-types.ts`): the card
 * picks a side and a screen, sets the language and the theme, and resets; this
 * answers with the app's state after every change — which screen, which side,
 * and whether a sheet is covering the page (the card hides then).
 *
 * Only the demo build contains this file (`DEMO` folds it away), and only a
 * page framed by the website's own origin speaks it. The card's shortcuts and
 * its clock row arrive with the demo's stand-in world; a shortcut this does
 * not know is ignored.
 */
import { DEMO_PROTOCOL_VERSION, isDemoMessage, type DemoMessage } from "./demo-types.ts";
import { setHostLocale } from "./i18n/index.tsx";
import { locale as currentLocale } from "./i18n/ambient.ts";
import { CLIENT_VIEWS, DESK_VIEWS, type Persona } from "./app/routes.ts";
import { useSheets } from "./state/sheets.ts";
import { go, setPersona, useUi } from "./state/ui.ts";

export const DEMO_APP_KEY = "clients";

/** The card's id for a screen: the studio's views as they are, the clients' with a `c-` in front. */
export function currentScreen(): string {
  const { view, persona } = useUi.getState();
  return persona === "client" ? `c-${view}` : view;
}

export function goToScreen(id: string): void {
  const client = id.startsWith("c-");
  const view = client ? id.slice(2) : id;
  const persona: Persona = client ? "client" : "studio";
  if (!(client ? (CLIENT_VIEWS as readonly string[]) : (DESK_VIEWS as readonly string[])).includes(view)) return;
  if (useUi.getState().persona !== persona) setPersona(persona);
  go(view as never);
}

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
    overlay: useSheets.getState().open !== null || ui.menu,
  };
}

export function applyDemoMessage(message: DemoMessage): void {
  switch (message.type) {
    case "adminium:demo:init":
      setHostLocale(message.locale);
      useUi.setState({ theme: message.theme });
      if (message.persona === "studio" || message.persona === "client") setPersona(message.persona);
      if (message.screen !== undefined) goToScreen(message.screen);
      return;
    case "adminium:demo:go":
      goToScreen(message.screen);
      return;
    case "adminium:demo:set":
      if (message.theme !== undefined) useUi.setState({ theme: message.theme });
      if (message.locale !== undefined) setHostLocale(message.locale);
      if (message.persona === "studio" || message.persona === "client") setPersona(message.persona);
      return;
    case "adminium:demo:reset":
      // Everything back as it was: the sample studio, the pinned day.
      window.location.reload();
      return;
    default:
      return;
  }
}

export function startDemoBridge(): () => void {
  if (typeof window === "undefined" || window.parent === window) return () => {};
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
  };
  window.addEventListener("message", onMessage);
  const unsubscribe = [useUi.subscribe(report), useSheets.subscribe(report)];
  post({ type: "adminium:demo:hello", dv: DEMO_PROTOCOL_VERSION, appKey: DEMO_APP_KEY });
  return () => {
    window.removeEventListener("message", onMessage);
    for (const off of unsubscribe) off();
  };
}
