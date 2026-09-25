/**
 * The chase ladder, read from the stored rungs.
 *
 * Each rung of an invoice is a `messages` row (kinds `invoice-rung-1/2/3`)
 * Adminium made when the invoice was sent, HELD for approval, due on its day
 * of the invoice's ladder. Nothing here decides a rung's state from the
 * calendar: the row says it. A held rung whose due time has come is READY
 * (it waits for someone to press send); a held rung not yet due waits its
 * days; queued is on its way; sent, skipped and failed are what they say.
 *
 *   rungsOf        the three rung slots of one invoice, each with its row
 *                  (the newest, should there be two) and its state
 *   ladderDay      the day past the due date a rung falls on, from its own
 *                  due time — the ladder's day as Adminium applied it
 *   invoiceLine    the one line the open-invoices list says of an invoice
 *   nextWake       the earliest held rung not yet due, across the open ones
 *   payHabit       how a client has paid before: of their settled invoices,
 *                  the average days from due to the last payment
 *   fillTemplate   a rung's wording as the email will read, from the app's
 *                  own templates, with the invoice's stored values
 */
import type { Day, Id, Instant, Invoice, Message, MessageKind, Payment } from "../../data/types.ts";
import { daysBetween, venueDay } from "../../data/venueTime.ts";
import { isSettled, paymentsOf } from "../invoices/figures.ts";

export const RUNG_KINDS = ["invoice-rung-1", "invoice-rung-2", "invoice-rung-3"] as const satisfies readonly MessageKind[];
export type RungNo = 1 | 2 | 3;

export type RungState = "none" | "ready" | "waiting" | "queued" | "sent" | "skipped" | "failed";

export interface Rung {
  no: RungNo;
  message: Message | null;
  state: RungState;
  /** The day of the ladder it falls on (days past the due date); null when it has no due time. */
  day: number | null;
  /** The studio's day it is due. */
  dueDay: Day | null;
  /** Days until it wakes (a waiting rung). */
  wait: number;
}

/** Whether a message is one of an invoice's rungs. */
export const isRung = (m: Message): boolean => (RUNG_KINDS as readonly string[]).includes(m.kind);

const rungNo = (kind: MessageKind): RungNo => Number(kind.slice(-1)) as RungNo;

/** The studio's day an instant falls on. */
export const dayOf = (at: Instant, zone: string): Day => venueDay(Date.parse(at), zone);

/** The state a rung row is in, at `now`. */
export function stateOf(message: Message | null, now: number): RungState {
  if (message === null) return "none";
  if (message.status === "held") return message.due === null || Date.parse(message.due) <= now ? "ready" : "waiting";
  return message.status;
}

/** One invoice's three rungs, from the messages the desk holds. */
export function rungsOf(invoice: Invoice, messages: readonly Message[], now: number, zone: string): Rung[] {
  const today = venueDay(now, zone);
  const newest = new Map<RungNo, Message>();
  for (const m of messages) {
    if (m.invoice_id !== invoice.id || !isRung(m)) continue;
    const no = rungNo(m.kind);
    const held = newest.get(no);
    if (held === undefined || m.id > held.id) newest.set(no, m);
  }
  return ([1, 2, 3] as const).map((no) => {
    const message = newest.get(no) ?? null;
    const dueDay = message?.due == null ? null : dayOf(message.due, zone);
    const state = stateOf(message, now);
    return {
      no,
      message,
      state,
      dueDay,
      day: dueDay === null || invoice.due_on === null ? null : daysBetween(invoice.due_on, dueDay),
      wait: state === "waiting" && dueDay !== null ? Math.max(1, daysBetween(today, dueDay)) : 0,
    };
  });
}

/** What the open-invoices list says of one invoice's ladder. */
export type InvoiceLine = { kind: "waiting"; rung: RungNo } | { kind: "queued"; rung: RungNo } | { kind: "allSent" } | { kind: "next"; rung: RungNo; wait: number } | { kind: "nothing" };

export function invoiceLine(rungs: readonly Rung[]): InvoiceLine {
  const ready = rungs.filter((r) => r.state === "ready").pop();
  if (ready !== undefined) return { kind: "waiting", rung: ready.no };
  const queued = rungs.filter((r) => r.state === "queued").pop();
  if (queued !== undefined) return { kind: "queued", rung: queued.no };
  if (rungs.every((r) => r.state === "sent")) return { kind: "allSent" };
  const next = rungs.find((r) => r.state === "waiting");
  if (next !== undefined) return { kind: "next", rung: next.no, wait: next.wait };
  return { kind: "nothing" };
}

/** The earliest held rung not yet due, across the open invoices. */
export function nextWake(invoices: readonly Invoice[], messages: readonly Message[], now: number, zone: string): { invoice: Invoice; rung: Rung } | null {
  let best: { invoice: Invoice; rung: Rung } | null = null;
  for (const invoice of invoices) {
    for (const rung of rungsOf(invoice, messages, now, zone)) {
      if (rung.state !== "waiting" || rung.message?.due == null) continue;
      if (best === null || Date.parse(rung.message.due) < Date.parse(best.rung.message!.due!)) best = { invoice, rung };
    }
  }
  return best;
}

/** How a client has paid before: of their settled invoices, the average and worst days from due to paid. */
export interface PayHabit {
  /** Their sent and not void invoices. */
  total: number;
  settled: number;
  /** Negative is early. */
  average: number | null;
}

export function payHabit(clientId: Id, invoices: readonly Invoice[], payments: readonly Payment[]): PayHabit {
  const theirs = invoices.filter((i) => i.client_id === clientId && i.status === "sent");
  const lates: number[] = [];
  for (const invoice of theirs.filter(isSettled)) {
    const kept = paymentsOf(payments, invoice.id).filter((p) => !p.voided);
    const last = kept[kept.length - 1];
    if (last !== undefined && invoice.due_on !== null) lates.push(daysBetween(invoice.due_on, last.paid_on));
  }
  return { total: theirs.length, settled: lates.length, average: lates.length === 0 ? null : Math.round(lates.reduce((a, b) => a + b, 0) / lates.length) };
}

/** Invoices ordered for the list: most days late first, then the soonest due. */
export const mostLateFirst = (a: Invoice, b: Invoice): number => (a.due_on ?? "9999") < (b.due_on ?? "9999") ? -1 : (a.due_on ?? "9999") > (b.due_on ?? "9999") ? 1 : a.id - b.id;

/**
 * A template's text with its `{{…}}` variables filled from `values`; a
 * variable with no value reads as nothing.
 */
export function fillTemplate(text: string, values: Readonly<Record<string, string>>): string {
  return text.replace(/\{\{\s*([A-Za-z_.]+)\s*\}\}/g, (_, name: string) => values[name] ?? "");
}

/** Body text as the editor keeps it: paragraphs split on blank lines. */
export const paragraphs = (text: string): string[] =>
  text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");

/** The invoice ids a set of ready rungs is on, in order. */
export const invoiceIdsOf = (rungs: readonly Message[]): Id[] => [...new Set(rungs.map((m) => m.invoice_id).filter((id): id is Id => id !== null))];
