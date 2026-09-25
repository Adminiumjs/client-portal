/**
 * What is on screen, as opposed to what is in the database (`desk.ts`,
 * `portal.ts`): the side, the screen and which document it shows, the theme,
 * the toasts, the phone-width menu, and the staff "preview as the client".
 *
 * Sheets and their drafts are `sheets.ts`'s.
 */
import { create } from "zustand";

import type { Id } from "../data/types.ts";
import type { StatementPeriod } from "../data/ports.ts";
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
  /** The enquiry the Enquiries screen opens on (Capacity's "Open the enquiry"); the newest when none. */
  enquiry: Id | null;
}

/** A printed copy: the add-on's document for one row (a statement over a client, for a period). */
export type PrintTarget =
  | { kind: "invoice"; id: Id }
  | { kind: "quote"; id: Id }
  | { kind: "receipt"; id: Id }
  | { kind: "statement"; id: Id; period: StatementPeriod };

/** How far past due an open invoice is: not yet, up to 30 days, 31–60, over 60. */
export type AgingBucket = "current" | "d30" | "d60" | "d61";

export interface InvoiceFilter {
  bucket: AgingBucket;
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
  /** Where a sign-in link asked to land once signed in (`invoices/12`); spent after sign-in. */
  landing: string | null;
  /** The printed copy on show (a quote, an invoice, a receipt, a statement). */
  print: PrintTarget | null;
  /** The Invoices list's aging filter, when Home's aging chips opened it. */
  invoiceFilter: InvoiceFilter | null;
}

const NOTHING: Selected = { proposal: null, invoice: null, project: null, client: null, deliverable: null, payment: null, enquiry: null };

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
  landing: null,
  print: null,
  invoiceFilter: null,
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
  useUi.setState((s) => ({
    view,
    menu: false,
    selected: key === undefined ? s.selected : { ...s.selected, [key]: id },
    // An invoice's printed copy opened the plain way is that invoice's.
    ...(view === "print" ? { print: { kind: "invoice" as const, id } } : {}),
  }));
  scrollTop();
}

/**
 * Open the printed copy of one document: a proposal (`quote`), an invoice, a
 * payment's receipt, or a client's statement over a period. The one way in —
 * `open("print", invoiceId)` still reads as that invoice's copy.
 */
export function openPrint(target: PrintTarget): void {
  useUi.setState((s) => ({
    view: "print",
    menu: false,
    print: target,
    selected: {
      ...s.selected,
      ...(target.kind === "invoice" ? { invoice: target.id } : {}),
      ...(target.kind === "quote" ? { proposal: target.id } : {}),
      ...(target.kind === "receipt" ? { payment: target.id } : {}),
      ...(target.kind === "statement" ? { client: target.id } : {}),
    },
  }));
  scrollTop();
}

/** Change what the open printed copy shows (a statement's period). */
export function setPrintTarget(target: PrintTarget): void {
  useUi.setState({ print: target });
}

/** The printed copy on show: the one asked for, else the selected invoice's. */
export function printTargetOf(s: Pick<UiState, "print" | "selected">): PrintTarget | null {
  if (s.print !== null) return s.print;
  return s.selected.invoice === null ? null : { kind: "invoice", id: s.selected.invoice };
}

/** `printTargetOf`, as a hook. */
export function usePrintTarget(): PrintTarget | null {
  const print = useUi((s) => s.print);
  const invoice = useUi((s) => s.selected.invoice);
  return printTargetOf({ print, selected: { ...NOTHING, invoice } });
}

/** Open the Enquiries screen on one enquiry. */
export function openEnquiry(id: Id): void {
  useUi.setState((s) => ({ view: "enquiries", selected: { ...s.selected, enquiry: id }, menu: false }));
  scrollTop();
}

/** Open the Invoices list on one aging bucket (Home's aging chips). */
export function openInvoices(bucket: AgingBucket | null): void {
  useUi.setState({ view: "invoices", invoiceFilter: bucket === null ? null : { bucket }, menu: false });
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
