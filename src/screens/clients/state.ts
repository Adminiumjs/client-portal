/** The tone each client state's pill is drawn in (the design's colours). */
import type { PillTone } from "../../components/ui.tsx";
import type { ClientState } from "./figures.ts";

export const CLIENT_STATE_TONE: Readonly<Record<ClientState, PillTone>> = {
  overdue: "danger",
  paused: "warn",
  active: "accent",
  awaiting: "info",
  quiet: "neutral",
};
