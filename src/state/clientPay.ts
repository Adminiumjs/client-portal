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
 * client comes back to it, the invoice is read again, and shows paid once
 * Adminium has recorded the payment, which clears "I've sent a payment" as a
 * payment the studio records does.
 *
 *   idle      Pay now, beside the other ways to pay
 *   taking    "Taking you to the secure payment page…"
 *   checking  the pay page is open in its own tab; read again on coming back
 *   failed    no pay page opened: "The payment didn't finish. Nothing was
 *             taken." Pay now and the other ways stay
 *
 * The demo's stand-in takes the payment itself (`standIn`): no tab opens and
 * no money moves; the invoice reads paid at once.
 */
import { create } from "zustand";

import type { Id } from "../data/types.ts";
import type { PayOnline } from "../data/ports.ts";
import { loadClientInvoice, portalPort } from "./portal.ts";
import { useUi } from "./ui.ts";

export type PayFlow = "idle" | "taking" | "checking" | "failed";

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

/**
 * The client came back to this page (it has the focus again): the invoices
 * being paid are read again and show as they now stand. Run beside the
 * page's own re-read on focus.
 */
export async function checkPayments(): Promise<void> {
  const checking = Object.entries(useClientPay.getState().flow).filter(([, flow]) => flow === "checking");
  for (const [id] of checking) {
    await loadClientInvoice(Number(id)).catch(() => undefined);
    setFlow(Number(id), "idle");
  }
}

/** Forget every invoice's flow (sign-out, a test). */
export function resetClientPay(): void {
  useClientPay.setState({ online: null, flow: {} });
}
