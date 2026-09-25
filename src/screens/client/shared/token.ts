/**
 * The token a link carried. Boot reads it from the address's fragment once
 * and keeps it on the page's state. The demo (which has no boot of that kind)
 * reads its own address instead, and a sign-in page there without one uses
 * the demo's own sign-in link.
 */
import { DEMO } from "../../../surface.ts";

export function linkToken(fromState: string | null, kind: "sign-in" | "share"): string | null {
  if (fromState !== null) return fromState;
  if (!DEMO || typeof window === "undefined") return null;
  const raw = window.location.hash.replace(/^#/, "").split("&")[0] ?? "";
  if (raw !== "") return raw;
  return kind === "sign-in" ? "demo" : null;
}
