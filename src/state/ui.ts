/**
 * What is on screen, as opposed to what is in the database (`desk.ts`,
 * `portal.ts`): the side, the screen and which document it shows, the theme,
 * the toasts, the phone-width menu, and the staff "preview as the client".
 *
 * Sheets and their drafts are `sheets.ts`'s.
 */
import { create } from "zustand";

import type { Id } from "../data/types.ts";
import type { ClientView, DeskView, Persona, View } from "../app/routes.ts";

export type Theme = "light" | "dark";

export type ToastTone = "fg" | "pos" | "warn" | "danger";
export interface Toast {
  id: number;
  text: string;
  /** lucide icon name. */
  icon: string;
  tone: ToastTone;
}

/**
 * Which rows the detail screens show. A detail screen reads its own id here
 * (`useUi((s) => s.selected.invoice)`); `open(view, id)` sets it.
 */
export interface Selected {
  proposal: Id | null;
  invoice: Id | null;
  project: Id | null;
  client: Id | null;
  deliverable: Id | null;
  payment: Id | null;
}

/** What the composer is writing: a proposal or an invoice, new or a draft. */
export interface ComposerTarget {
  kind: "proposal" | "invoice";
  /** The draft being edited; null for a new document. */
  id: Id | null;
  /** A new proposal started from an enquiry (the enquiry moves on its first save). */
  enquiryId?: Id | null;
  /** The client a new document is for, when known. */
  clientId?: Id | null;
  /** A new invoice against a project. */
  projectId?: Id | null;
}

/** The staff "preview as the client": desk-read rows drawn through the client screens. */
export interface Preview {
  clientId: Id;
  /** The desk screen to come back to. */
  back: DeskView;
}

export interface UiState {
  persona: Persona;
  view: View;
  selected: Selected;
  composer: ComposerTarget | null;
  theme: Theme;
  toasts: Toast[];
  /** The phone-width menu. */
  menu: boolean;
  /** The session ended: nothing more saves until the person signs in again. */
  signedOut: boolean;
  preview: Preview | null;
  /** The token a sign-in link or a share link carried (from the address's fragment). */
  token: string | null;
}

const NOTHING: Selected = { proposal: null, invoice: null, project: null, client: null, deliverable: null, payment: null };

export const useUi = create<UiState>(() => ({
  persona: "studio",
  view: "home",
  selected: NOTHING,
  composer: null,
  theme: "light",
  toasts: [],
  menu: false,
  signedOut: false,
  preview: null,
  token: null,
}));

function scrollTop(): void {
  if (typeof window !== "undefined") window.scrollTo?.({ top: 0 });
}

/** Go to a screen: the menu closes and the page starts at the top. */
export function go(view: View): void {
  useUi.setState({ view, menu: false });
  scrollTop();
}

/** Which kind of row a detail view shows. */
const DETAIL: Partial<Record<View, keyof Selected>> = {
  proposal: "proposal",
  invoice: "invoice",
  print: "invoice",
  project: "project",
  handover: "project",
  client: "client",
  review: "deliverable",
};

/** Open a detail screen on one row: `open("invoice", 12)`. */
export function open(view: DeskView | ClientView, id: Id): void {
  const key = DETAIL[view];
  useUi.setState((s) => ({ view, menu: false, selected: key === undefined ? s.selected : { ...s.selected, [key]: id } }));
  scrollTop();
}

/** Open the printed copy of a proposal or an invoice. */
export function openPrint(table: "proposals" | "invoices", id: Id): void {
  useUi.setState((s) => ({
    view: "print",
    menu: false,
    selected: { ...s.selected, invoice: table === "invoices" ? id : null, proposal: table === "proposals" ? id : s.selected.proposal },
  }));
  scrollTop();
}

/** Open the composer on a new document or a draft. */
export function openComposer(target: ComposerTarget): void {
  useUi.setState({ view: "composer", composer: target, menu: false });
  scrollTop();
}

/** Switch sides (the demo): each opens on its first screen. */
export function setPersona(persona: Persona): void {
  useUi.setState({ persona, view: persona === "client" ? "find" : "home", menu: false, preview: null });
}

/** Preview a client's side from the desk (read-only; every client action refuses). */
export function startPreview(clientId: Id, back: DeskView, view: ClientView = "home"): void {
  useUi.setState({ preview: { clientId, back }, view, menu: false });
  scrollTop();
}

export function endPreview(): void {
  const back = useUi.getState().preview?.back ?? "home";
  useUi.setState({ preview: null, view: back });
}

let toastNo = 0;
/** A short message at the foot of the screen, gone after a few seconds. */
export function toast(text: string, opts: { icon?: string; tone?: ToastTone } = {}): void {
  const id = ++toastNo;
  useUi.setState((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, icon: opts.icon ?? "check", tone: opts.tone ?? "fg" }] }));
  setTimeout(() => useUi.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3200);
}

export function toggleTheme(): void {
  useUi.setState((s) => ({ theme: s.theme === "dark" ? "light" : "dark" }));
}
