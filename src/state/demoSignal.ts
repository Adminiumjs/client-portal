/**
 * How the website demo's card reaches into a screen: a named signal, with an
 * optional payload, that the screen it names listens for.
 *
 * The card's shortcuts ("A call comes in", "Fill a sample proposal", "The
 * client accepts and signs") act on a screen's own state — a form being
 * filled — which no store holds. So the demo's bridge SENDS a signal and the
 * screen, if it is showing, does the thing. In every other build nothing ever
 * sends one: a screen's listener costs a subscription and does nothing, and
 * this file carries no demo data or words of its own.
 */
import { useEffect, useRef } from "react";
import { create } from "zustand";

interface Signal {
  name: string;
  payload: Record<string, string>;
  seq: number;
}

const useSignals = create<{ last: Signal | null }>(() => ({ last: null }));
let seq = 0;

/** Send a signal to whichever screen listens for it. */
export function sendDemoSignal(name: string, payload: Record<string, string> = {}): void {
  seq += 1;
  useSignals.setState({ last: { name, payload, seq } });
}

/** Do `handler` whenever `name` is sent while this screen is mounted. */
export function useDemoSignal(name: string, handler: (payload: Record<string, string>) => void): void {
  const latest = useRef(handler);
  latest.current = handler;
  const last = useSignals((s) => s.last);
  // Only signals sent while mounted: coming back to a screen must not replay an old one.
  const handled = useRef(seq);
  useEffect(() => {
    if (last === null || last.name !== name || last.seq === handled.current) return;
    handled.current = last.seq;
    latest.current(last.payload);
  }, [last, name]);
}
