/**
 * The app's single store.
 *
 * One store for both shells, because the two sides act on the SAME documents:
 * a client accepting a proposal spawns a project the studio sees, and a client
 * paying an invoice moves the studio's outstanding total. Splitting them would
 * mean keeping two copies of the same ledger in step.
 *
 * Money is integer cents throughout.
 */

import { create } from "zustand";

import {
  CLIENTS,
  SEED_ACTIVITY,
  SEED_INVOICES,
  SEED_PROJECTS,
  SEED_PROPOSALS,
  TAX_RATE,
  TODAY,
} from "../data/demo.ts";
import type {
  ActivityEntry,
  DeliverableStatus,
  Invoice,
  LineItem,
  PaymentMethod,
  Persona,
  Project,
  Proposal,
  Toast,
  View,
} from "../data/types.ts";
import { t } from "../i18n/ambient.ts";
import { money } from "../lib/format.ts";
import { checkPayment, docTotals, lookup } from "../lib/invoice.ts";

const THEME_KEY = "client-portal-theme";

export type Theme = "light" | "dark";

interface State {
  view: View;
  persona: Persona;
  proposalNum: string | null;
  projectId: string | null;
  invoiceNum: string | null;

  theme: Theme;
  navOpen: boolean;
  dockOpen: boolean;
  overlayOpen: boolean;

  proposals: Proposal[];
  projects: Project[];
  invoices: Invoice[];
  activity: ActivityEntry[];

  /* --- studio filters --- */
  proposalFilter: string;
  invoiceFilter: string;

  /* --- the client portal's gate --- */
  portalEmail: string;
  portalNumber: string;
  portalError: "unknownNumber" | "wrongEmail" | "notSent" | null;
  /** Which client the portal has authenticated, once the gate is passed. */
  portalClient: string | null;

  /* --- overlays --- */
  toasts: Toast[];
  paySheetFor: string | null;
  recordFor: string | null;
  declineFor: string | null;
  changesFor: { project: string; deliverable: string } | null;

  go: (view: View) => void;
  openProposal: (num: string) => void;
  openProject: (id: string) => void;
  openInvoice: (num: string) => void;
  setPersona: (p: Persona) => void;

  initTheme: () => void;
  toggleTheme: () => void;
  setNavOpen: (open: boolean) => void;
  setDockOpen: (open: boolean) => void;
  setProposalFilter: (f: string) => void;
  setInvoiceFilter: (f: string) => void;

  setPortalEmail: (v: string) => void;
  setPortalNumber: (v: string) => void;
  submitPortal: () => void;
  leavePortal: () => void;

  sendProposal: (num: string) => void;
  acceptProposal: (num: string) => void;
  declineProposal: (num: string, note: string) => void;
  askDecline: (num: string | null) => void;

  setDeliverableStatus: (
    projectId: string,
    deliverableId: string,
    status: DeliverableStatus,
    note?: string,
  ) => void;
  askChanges: (target: { project: string; deliverable: string } | null) => void;

  askPay: (num: string | null) => void;
  askRecord: (num: string | null) => void;
  recordPayment: (num: string, cents: number, method: PaymentMethod) => void;

  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  escape: () => void;
  reset: () => void;
}

let toastSeq = 0;
let activitySeq = 0;

const cloneProposals = () =>
  SEED_PROPOSALS.map((p) => ({ ...p, scope: [...p.scope], items: p.items.map((i) => ({ ...i })) }));
const cloneProjects = () =>
  SEED_PROJECTS.map((p) => ({
    ...p,
    milestones: p.milestones.map((m) => ({ ...m })),
    deliverables: p.deliverables.map((d) => ({ ...d })),
  }));
const cloneInvoices = () =>
  SEED_INVOICES.map((i) => ({
    ...i,
    items: i.items.map((x) => ({ ...x })),
    payments: i.payments.map((x) => ({ ...x })),
  }));

export const useStore = create<State>((set, get) => ({
  view: "home",
  persona: "studio",
  proposalNum: null,
  projectId: null,
  invoiceNum: null,

  theme: "light",
  navOpen: false,
  dockOpen: true,
  overlayOpen: false,

  proposals: cloneProposals(),
  projects: cloneProjects(),
  invoices: cloneInvoices(),
  activity: SEED_ACTIVITY.map((a) => ({ ...a })),

  proposalFilter: "all",
  invoiceFilter: "all",

  portalEmail: "",
  portalNumber: "",
  portalError: null,
  portalClient: null,

  toasts: [],
  paySheetFor: null,
  recordFor: null,
  declineFor: null,
  changesFor: null,

  /**
   * Every view change scrolls back to the top — house layout rule 3, and the
   * reason a client opening an invoice lands on its header rather than
   * mid-table.
   */
  go: (view) => {
    set({ view, navOpen: false, overlayOpen: false });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  openProposal: (proposalNum) => {
    const { persona } = get();
    set({ proposalNum, view: persona === "client" ? "review" : "proposal", navOpen: false });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  openProject: (projectId) => {
    const { persona } = get();
    set({ projectId, view: persona === "client" ? "progress" : "project", navOpen: false });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  openInvoice: (invoiceNum) => {
    const { persona } = get();
    set({ invoiceNum, view: persona === "client" ? "clientinvoice" : "invoice", navOpen: false });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  /** Switching persona resets the portal gate — a new visitor is not signed in. */
  setPersona: (persona) => {
    set({
      persona,
      view: persona === "client" ? "entry" : "home",
      portalClient: null,
      portalError: null,
      navOpen: false,
      overlayOpen: false,
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  initTheme: () => {
    let stored: string | null = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      // Storage disabled — fall back to the OS preference.
    }
    const prefersDark =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    const theme: Theme =
      stored === "dark" || stored === "light" ? stored : prefersDark ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    set({ theme });
  },

  toggleTheme: () => {
    const theme: Theme = get().theme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Not remembering the choice is not a reason to refuse it.
    }
    set({ theme });
  },

  setNavOpen: (navOpen) => set({ navOpen, overlayOpen: navOpen }),
  setDockOpen: (dockOpen) => set({ dockOpen }),
  setProposalFilter: (proposalFilter) => set({ proposalFilter }),
  setInvoiceFilter: (invoiceFilter) => set({ invoiceFilter }),

  setPortalEmail: (portalEmail) => set({ portalEmail, portalError: null }),
  setPortalNumber: (portalNumber) => set({ portalNumber, portalError: null }),

  /**
   * The gate. `lib/invoice.lookup()` returns a REASON on failure, and each
   * reason gets its own honest error rather than a generic "not found".
   */
  submitPortal: () => {
    const { portalEmail, portalNumber, proposals, invoices } = get();
    const result = lookup(portalEmail, portalNumber, proposals, invoices, CLIENTS);

    if (!result.ok) {
      set({ portalError: result.reason });
      return;
    }

    const doc =
      result.kind === "proposal"
        ? proposals.find((p) => p.num === result.num)
        : invoices.find((i) => i.num === result.num);

    set({
      portalError: null,
      portalClient: doc?.client ?? null,
      ...(result.kind === "proposal"
        ? { proposalNum: result.num, view: "review" as const }
        : { invoiceNum: result.num, view: "clientinvoice" as const }),
    });
    window.scrollTo({ top: 0, behavior: "auto" });
  },

  leavePortal: () =>
    set({ view: "entry", portalClient: null, portalError: null, portalNumber: "" }),

  sendProposal: (num) => {
    set({
      proposals: get().proposals.map((p) =>
        p.num === num && p.status === "draft"
          ? { ...p, status: "sent" as const, sentAt: TODAY }
          : p,
      ),
    });
    get().toast(t("chrome.toast.proposalSent", { doc: num }), "info");
  },

  /**
   * Accepting genuinely creates the project on the studio side, from the
   * proposal's own title and client — the loop the demo exists to show.
   */
  acceptProposal: (num) => {
    const { proposals, projects } = get();
    const proposal = proposals.find((p) => p.num === num);
    if (!proposal || proposal.status !== "sent") return;

    const projectId = `pj-${num.toLowerCase()}`;
    const project: Project = {
      id: projectId,
      client: proposal.client,
      proposal: num,
      name: proposal.title,
      status: "active",
      due: TODAY + 42,
      milestones: [
        { title: "data.ms.kickoff", due: TODAY + 7, done: false },
        { title: "data.ms.moodboards", due: TODAY + 21, done: false },
        { title: "data.ms.finalHandoff", due: TODAY + 42, done: false },
      ],
      deliverables: [],
    };

    activitySeq += 1;
    set({
      proposals: proposals.map((p) =>
        p.num === num
          ? { ...p, status: "accepted" as const, decidedAt: TODAY, project: projectId }
          : p,
      ),
      projects: [project, ...projects],
      activity: [
        {
          id: `new-ac${activitySeq}`,
          icon: "sparkles",
          tone: "accent",
          text: "data.act.accepted",
          params: { doc: num },
          at: TODAY,
        },
        ...get().activity,
      ],
    });
    get().toast(t("chrome.toast.accepted"), "pos");
  },

  declineProposal: (num, note) => {
    const trimmed = note.trim();
    if (trimmed.length === 0) return;
    set({
      proposals: get().proposals.map((p) =>
        p.num === num
          ? { ...p, status: "declined" as const, decidedAt: TODAY, declineNote: trimmed }
          : p,
      ),
      declineFor: null,
      overlayOpen: false,
    });
    get().toast(t("chrome.toast.declined"), "danger");
  },

  askDecline: (declineFor) => set({ declineFor, overlayOpen: declineFor !== null }),

  setDeliverableStatus: (projectId, deliverableId, status, note = "") => {
    let file = "";
    set({
      projects: get().projects.map((p) =>
        p.id !== projectId
          ? p
          : {
              ...p,
              deliverables: p.deliverables.map((d) => {
                if (d.id !== deliverableId) return d;
                file = d.file;
                return { ...d, status, note: status === "changes" ? note.trim() : "" };
              }),
            },
      ),
      changesFor: null,
      overlayOpen: false,
    });

    get().toast(
      status === "approved"
        ? t("chrome.toast.deliverableApproved", { file })
        : t("chrome.toast.changesRequested", { file }),
      status === "approved" ? "pos" : "info",
    );
  },

  askChanges: (changesFor) => set({ changesFor, overlayOpen: changesFor !== null }),

  askPay: (paySheetFor) => set({ paySheetFor, overlayOpen: paySheetFor !== null }),
  askRecord: (recordFor) => set({ recordFor, overlayOpen: recordFor !== null }),

  /**
   * Recording a payment goes through `checkPayment` first, so an overpayment
   * is refused rather than clamped, and the invoice flips to `paid` only when
   * the balance actually reaches zero.
   */
  recordPayment: (num, cents, method) => {
    const { invoices } = get();
    const invoice = invoices.find((i) => i.num === num);
    if (!invoice) return;

    const check = checkPayment(invoice, cents);
    if (!check.ok) return;

    const total = docTotals(invoice.items, invoice.taxRate).total;
    const paidAfter =
      invoice.payments.reduce((sum, p) => sum + p.amt, 0) + check.amount;
    const settled = paidAfter >= total;

    activitySeq += 1;
    set({
      invoices: invoices.map((i) =>
        i.num === num
          ? {
              ...i,
              status: settled ? ("paid" as const) : i.status,
              payments: [...i.payments, { amt: check.amount, method, at: TODAY }],
            }
          : i,
      ),
      activity: [
        {
          id: `new-ac${activitySeq}`,
          icon: "banknote",
          tone: "pos",
          text: "data.act.payment",
          params: { amount: money(check.amount), doc: num },
          at: TODAY,
        },
        ...get().activity,
      ],
      paySheetFor: null,
      recordFor: null,
      overlayOpen: false,
    });

    get().toast(
      settled
        ? t("chrome.toast.paid", { doc: num })
        : t("chrome.toast.paymentRecorded", { amount: money(check.amount) }),
      "pos",
    );
  },

  toast: (text, tone = "info") => {
    toastSeq += 1;
    const id = toastSeq;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    window.setTimeout(() => get().dismissToast(id), 3600);
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),

  escape: () => {
    const s = get();
    if (s.paySheetFor !== null) return set({ paySheetFor: null, overlayOpen: false });
    if (s.recordFor !== null) return set({ recordFor: null, overlayOpen: false });
    if (s.declineFor !== null) return set({ declineFor: null, overlayOpen: false });
    if (s.changesFor !== null) return set({ changesFor: null, overlayOpen: false });
    if (s.navOpen) return set({ navOpen: false, overlayOpen: false });
  },

  reset: () => {
    set({
      proposals: cloneProposals(),
      projects: cloneProjects(),
      invoices: cloneInvoices(),
      activity: SEED_ACTIVITY.map((a) => ({ ...a })),
      view: get().persona === "client" ? "entry" : "home",
      proposalNum: null,
      projectId: null,
      invoiceNum: null,
      proposalFilter: "all",
      invoiceFilter: "all",
      portalEmail: "",
      portalNumber: "",
      portalError: null,
      portalClient: null,
      paySheetFor: null,
      recordFor: null,
      declineFor: null,
      changesFor: null,
      overlayOpen: false,
    });
    get().toast(t("chrome.toast.reset"), "info");
  },
}));

/** A blank line item, for the proposal composer's "add a line". */
export function blankLine(): LineItem {
  return { desc: "", qty: 1, rate: 0, disc: 0 };
}

export { CLIENTS, TAX_RATE };

/** Re-export so screens can pull the lookup wrapper's client table too. */
export function clientById(id: string | null) {
  return CLIENTS.find((c) => c.id === id) ?? null;
}
