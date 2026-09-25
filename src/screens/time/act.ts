/**
 * What the Time screen's buttons do, apart from drawing: each is one of the
 * time actions (`state/timeActions.ts`), called with what the screen shows.
 *
 *   Move onto an invoice   the entries the filter shows that no line carries
 *                          yet, at the rate card's hourly rate, onto each
 *                          client's draft (a new one titled for the project)
 *   Stop                   the clock stops; Adminium stamps the moment and
 *                          works the hours out from its two stamps. What Stop
 *                          alone cannot settle (a clock Adminium finds ran
 *                          past sixteen hours, a clock with nothing said about
 *                          what it is on) is handed back for the stop sheet to ask
 */
import type { Decimal, Id, TimeEntry } from "../../data/types.ts";
import type { OntoDrafts } from "../../state/invoiceDrafts.ts";
import type { Outcome } from "../../state/outcome.ts";
import { invalid } from "../../state/officeWrites.ts";
import { moveTimeOntoInvoice, stopClock } from "../../state/timeActions.ts";
import { isLogged } from "./model.ts";
import { refusalWords, type Words } from "./words.ts";

/** The entries a move takes: logged, on no line yet. */
export const toMove = (entries: readonly TimeEntry[], invoiced: ReadonlySet<Id>): TimeEntry[] => entries.filter((e) => isLogged(e) && !invoiced.has(e.id));

/**
 * Move the entries not yet invoiced onto their clients' drafts, at the day
 * rate's hourly rate. With no day rate on the card nothing is sent: the move
 * is refused (`NO_DAY_RATE`), never billed at a rate guessed from another.
 */
export function moveNotInvoiced(entries: readonly TimeEntry[], invoiced: ReadonlySet<Id>, rate: Decimal | null, titleFor: (projectId: Id | null) => string): Promise<Outcome<OntoDrafts>> {
  if (rate === null) return Promise.resolve(invalid("NO_DAY_RATE", "rate"));
  const ids = toMove(entries, invoiced).map((e) => e.id);
  return moveTimeOntoInvoice(ids, { rate, newTitle: (_client, projectId) => titleFor(projectId) });
}

export type StopAnswer = { kind: "stopped"; entry: TimeEntry } | { kind: "ask"; why: Words } | { kind: "refused"; why: Words; code: string; reason: string };

/** Stop a clock (Adminium counts its hours); what needs the person's say comes back as `ask`. */
export async function stopOrAsk(entry: TimeEntry): Promise<StopAnswer> {
  const out = await stopClock(entry.id);
  if (out.ok) return { kind: "stopped", entry: out.value };
  const why = refusalWords(out);
  if (why.field === "hours" || why.field === "note") return { kind: "ask", why };
  return { kind: "refused", why, code: out.code, reason: out.reason };
}
