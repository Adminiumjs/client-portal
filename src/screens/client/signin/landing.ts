/**
 * After signing in: the page the link was for, else Home. The link's own
 * target (`&to=invoices/12`) is read from the page's state when boot keeps it
 * there; without it the client lands on Home.
 */
import { open, go, useUi } from "../../../state/ui.ts";
import { landingOf } from "./model.ts";

export function goAfterSignIn(): void {
  const state = useUi.getState() as { landing?: string | null };
  const { view, id } = landingOf(state.landing ?? null);
  useUi.setState({ token: null, ...("landing" in state ? { landing: null } : {}) } as never);
  if (id !== null && (view === "proposal" || view === "invoice" || view === "project")) open(view, id);
  else go(view);
}
