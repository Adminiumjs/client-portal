/**
 * Paying an invoice online, from the client's own invoice page.
 *
 * Whether the page offers it is Adminium's answer (`payOnline`): only while
 * the studio's Adminium takes the app's invoices online. Otherwise there is
 * no "Pay now" at all, greyed or otherwise, and the page reads as it always
 * has: how to pay by bank transfer, and "I've sent a payment".
 *
 * "Pay now" asks Adminium for the invoice's pay link (the amount is what the
 * invoice still owes, never one the page sends) and opens Adminium's pay page
 * in a tab of its own. This page keeps the client's session (it lives in the
 * page, so leaving it would sign them out) and says it is checking; when the
 * client comes back to it, the invoice is read again and Adminium is asked how
 * the payment stands (`payState`). The invoice shows paid once Adminium has
 * recorded the payment, which clears "I've sent a payment" as a payment the
 * studio records does.
 *
 *   idle        Pay now, beside the other ways to pay
 *   taking      "Taking you to the secure payment page…"
 *   checking    the pay page is open in its own tab; on coming back, looked
 *               for a few times while the service has not said yet
 *   failed      no pay page opened, or the payment did not finish: "The
 *               payment didn't finish. Nothing was taken." Pay now and the
 *               other ways stay
 *   expired     the time to pay on the service's page ran out: said so, and
 *               Pay now and the other ways stay
 *   confirming  the bank is confirming it, which some ways take days for:
 *               said so, and nothing offers to pay it again (also when the
 *               invoice is opened again later, while it lasts)
 *
 * The demo's stand-in takes the payment itself (`standIn`): no tab opens and
 * no money moves; the invoice reads paid at once.
 */
import { create } from "zustand";

import type { Id } from "../data/types.ts";
import type { PayOnline, PayState } from "../data/ports.ts";
import { isOpen } from "../screens/client/shared/model.ts";
import { loadClientInvoice, portalPort, usePortal } from "./portal.ts";
import { useUi } from "./ui.ts";

export type PayFlow = "idle" | "taking" | "checking" | "failed" | "expired" | "confirming";

export interface ClientPayState {
  /** Adminium's answer; null until asked (and then the page reads as it always has). */
  online: PayOnline | null;
  /** Where each invoice's payment stands on this page. */
  flow: Record<Id, PayFlow>;
}

export const useClientPay = create<ClientPayState>(() => ({ online: null, flow: {} }));

const setFlow = (id: Id, flow: PayFlow) => useClientPay.setState((s) => ({ flow: { ...s.flow, [id]: flow } }));

/** Ask Adminium whether this client may pay online now. Never throws: no answer reads as "not online". */
export async function loadPayOnline(): Promise<void> {
  if (useUi.getState().preview !== null) {
    useClientPay.setState({ online: null });
    return;
  }
  let port;
  try {
    port = portalPort();
  } catch {
    return;
  }
  const answer = (await port.payOnline?.().catch(() => null)) ?? null;
  useClientPay.setState({ online: answer });
}

/** Whether this page offers "Pay now" for an invoice: Adminium says so, and it is not the studio's preview. */
export function useMayPayOnline(): boolean {
  const online = useClientPay((s) => s.online?.online === true);
  const preview = useUi((s) => s.preview !== null);
  return online && !preview;
}

/** The test band: someone who manages payments is rehearsing on this address. */
export const useRehearsing = (): boolean => useClientPay((s) => s.online?.online === true && s.online.test === true);

export interface PayOptions {
  /** Opens the pay page in a tab of its own, from the click (a tab opened later is blocked); false when none opened. */
  openTab: (link: () => Promise<string>) => Promise<boolean>;
}

/**
 * "Pay now": the pay page opens in its own tab, and this page checks the
 * invoice again when the client comes back. Answers how it went.
 */
export async function payNow(invoiceId: Id, opts: PayOptions): Promise<"away" | "paid" | "failed"> {
  const port = portalPort();
  if (port.payInvoice === undefined) {
    setFlow(invoiceId, "failed");
    return "failed";
  }
  const pay = port.payInvoice.bind(port);
  setFlow(invoiceId, "taking");
  if (useClientPay.getState().online?.standIn === true) {
    try {
      await pay(invoiceId);
      await loadClientInvoice(invoiceId);
      setFlow(invoiceId, "idle");
      return "paid";
    } catch {
      setFlow(invoiceId, "failed");
      return "failed";
    }
  }
  const opened = await opts.openTab(async () => {
    const { payUrl } = await pay(invoiceId);
    if (payUrl === null) throw new Error("no pay page");
    return payUrl;
  });
  if (!opened) {
    setFlow(invoiceId, "failed");
    // Paying online may have closed meanwhile: the page then offers only the other ways.
    await loadPayOnline();
    return "failed";
  }
  setFlow(invoiceId, "checking");
  return "away";
}

/** How often the page looks for a payment on coming back, and how many times: more while the money arrived and is not recorded yet. */
export const LOOK_EVERY_MS = 2_000;
const LOOKS = 6;
const LOOKS_WHILE_RECORDED = 30;

/** Adminium's word on an invoice's newest online payment; `unknown` when it did not answer. Never throws. */
async function payState(invoiceId: Id): Promise<PayState | "unknown"> {
  let port;
  try {
    port = portalPort();
  } catch {
    return "unknown";
  }
  // A port that cannot ask: the invoice alone says how it stands.
  if (port.payState === undefined) return "none";
  return port.payState(invoiceId).catch(() => "unknown" as const);
}

/**
 * What the page does with Adminium's word, the invoice as it now reads beside
 * it: nothing owed (paid, or void) or nothing started is the page as it reads;
 * the bank confirming it, didn't finish and ran out are said; a checkout still
 * open, money that arrived and is not recorded yet, or no answer, are looked
 * for again.
 */
export function afterPaying(said: PayState | "unknown", owes: boolean): PayFlow | "look" {
  if (!owes || said === "none") return "idle";
  if (said === "confirming" || said === "failed" || said === "expired") return said;
  return "look";
}

const looking = new Set<Id>();
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const owes = (invoiceId: Id): boolean => {
  const invoice = usePortal.getState().rows.invoices[invoiceId];
  return invoice !== undefined && isOpen(invoice);
};

/**
 * The client came back to this page (it has the focus again): each invoice
 * being paid is read again, Adminium is asked how its payment stands, and the
 * page says so. Run beside the page's own re-read on focus.
 */
export async function checkPayments(pause: (ms: number) => Promise<void> = wait): Promise<void> {
  const checking = Object.entries(useClientPay.getState().flow)
    .filter(([id, flow]) => flow === "checking" && !looking.has(Number(id)))
    .map(([id]) => Number(id));
  await Promise.all(checking.map((id) => lookFor(id, pause)));
}

async function lookFor(invoiceId: Id, pause: (ms: number) => Promise<void>): Promise<void> {
  looking.add(invoiceId);
  try {
    for (let look = 1; ; look += 1) {
      const [said] = await Promise.all([payState(invoiceId), loadClientInvoice(invoiceId).catch(() => undefined)]);
      // Pay now pressed again meanwhile, or signed out: that flow is the page's now.
      if (useClientPay.getState().flow[invoiceId] !== "checking") return;
      const next = afterPaying(said, owes(invoiceId));
      if (next !== "look") {
        setFlow(invoiceId, next);
        return;
      }
      if (look >= (said === "paid" ? LOOKS_WHILE_RECORDED : LOOKS)) {
        setFlow(invoiceId, "idle");
        return;
      }
      await pause(LOOK_EVERY_MS);
    }
  } finally {
    looking.delete(invoiceId);
  }
}

/**
 * The invoice opened again (or the page came back to it) while it owes and
 * online paying is offered: a payment the bank is still confirming is said,
 * and nothing offers to pay it twice; once the bank has answered, the page
 * reads as the invoice now does. Asked only of an invoice the page is not
 * already following through a payment.
 */
export async function noticeConfirming(invoiceId: Id): Promise<void> {
  const settled = (): boolean => {
    const flow = useClientPay.getState().flow[invoiceId] ?? "idle";
    return flow === "idle" || flow === "confirming";
  };
  if (useClientPay.getState().online?.online !== true || !settled()) return;
  if (!owes(invoiceId)) {
    if (useClientPay.getState().flow[invoiceId] === "confirming") setFlow(invoiceId, "idle");
    return;
  }
  const said = await payState(invoiceId);
  if (!settled() || said === "unknown") return;
  setFlow(invoiceId, said === "confirming" ? "confirming" : "idle");
}

/** Forget every invoice's flow (sign-out, a test). */
export function resetClientPay(): void {
  useClientPay.setState({ online: null, flow: {} });
}
