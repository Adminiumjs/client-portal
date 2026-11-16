/**
 * Payments on the desk: whether the studio's Adminium takes the app's invoices
 * online, what the signed-in person may do with them, and the two things the
 * desk does about a payment taken online.
 *
 *   Copy pay link   an open, sent invoice's pay link, when clients can pay
 *                   online now (or this person is rehearsing): the link a
 *                   client already holds while it works, else a new one
 *   Refund…         on a payment taken online, for someone who may give
 *                   money back: Adminium's own two steps and words, drawn by
 *                   its kit inside the desk's sheet
 *
 * A payment taken online is told from one the studio recorded by its
 * `provider` (the service that took it, written by Adminium alone). It is
 * never voided: a refund gives its money back, and the invoice's `paid` sums
 * what is left of each payment.
 *
 * With no payments said (an older Adminium, the demo) none of this shows, and
 * the desk reads as it always has.
 */
import { create } from "zustand";

import type { Id, Payment } from "../data/types.ts";
import { madeOnline } from "../lib/money.ts";
import type { StaffKit, StaffPayments } from "../staffConnection.ts";
import { deskWrites, useCan } from "./desk.ts";

export interface DeskPaymentsState {
  /** What the staff config said; null when it said nothing. */
  state: StaffPayments | null;
  /** Adminium's kit, for the refund's two steps; null when this server has none. */
  kit: StaffKit | null;
}

export const useDeskPayments = create<DeskPaymentsState>(() => ({ state: null, kit: null }));

export function setDeskPayments(state: StaffPayments | null, kit: StaffKit | null): void {
  useDeskPayments.setState({ state, kit });
}

/** The kit's contract the desk was built against: another one is not mounted. */
export const KIT_CONTRACT = 1;

/** Whether a payment was taken online (by a payment service), not recorded at the desk. */
export function takenOnline(payment: Pick<Payment, "provider">): boolean {
  return madeOnline(payment);
}

/** What is left of a payment after its refunds. */
export function keptOf(payment: Pick<Payment, "amount" | "refunded_amount">): number {
  return Number(payment.amount) - Number(payment.refunded_amount ?? 0);
}

/** "Copy pay link" shows: clients can pay online now (or this person rehearses), and they may change invoices. */
export function useMayCopyPayLink(): boolean {
  const state = useDeskPayments((s) => s.state);
  const mayUpdate = useCan("invoices", "update");
  return state !== null && (state.online || state.test) && mayUpdate;
}

/** "Refund…" shows on a payment taken online with something left to give back, for someone who may refund. */
export function useMayRefund(payment: Pick<Payment, "provider" | "payment_ref" | "amount" | "refunded_amount" | "voided">): boolean {
  const refund = useDeskPayments((s) => s.state?.refund === true && s.kit !== null && s.kit.contract === KIT_CONTRACT);
  return refund && takenOnline(payment) && payment.payment_ref !== null && !payment.voided && keptOf(payment) > 0;
}

/** An invoice's pay link to copy, or why not (the server's code). */
export async function copyPayLink(invoiceId: Id): Promise<{ ok: true; url: string; expiresAt: number } | { ok: false; code: string }> {
  const writes = deskWrites();
  if (writes.payLink === undefined) return { ok: false, code: "UNSUPPORTED" };
  try {
    const link = await writes.payLink(invoiceId);
    return { ok: true, ...link };
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    return { ok: false, code: typeof code === "string" ? code : "FAILED" };
  }
}
