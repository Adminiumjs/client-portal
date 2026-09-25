/**
 * Move onto an invoice: what the press will write, said before it writes.
 *
 * The hours not yet invoiced (in the filter on show) go on invoices as one
 * line per entry — the entry's words, its hours, the hourly rate — on each
 * client's draft (the one for the same project first), or on a new draft for
 * a client with none. The line is the record that the hours are invoiced, and
 * Adminium lets an entry be on one line only: pressing twice, or on two
 * computers, writes nothing twice. The drafts' amounts and totals are
 * Adminium's, read back; the figures here before the press are labels.
 */
import { ReceiptText } from "lucide-react";
import { useMemo, useState } from "react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, UnfinishedLine } from "../../components/ui.tsx";
import type { Decimal, Id, Invoice, Project, TimeEntry } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { sumDecimals } from "../../lib/money.ts";
import { useDesk } from "../../state/desk.ts";
import { draftFor, type OntoDrafts } from "../../state/invoiceDrafts.ts";
import type { Unfinished } from "../../state/outcome.ts";
import { toast } from "../../state/ui.ts";
import { moveNotInvoiced } from "../../screens/time/act.ts";
import { movePreview, sumHours } from "../../screens/time/model.ts";
import { hoursLabel, refusalWords, type Words } from "../../screens/time/words.ts";

/** A new draft's title: the project's, when every line is from one. */
export function draftTitle(t: (key: "time.move.draftTitle" | "time.move.draftTitleAll", params?: Record<string, string>) => string, project: Project | undefined): string {
  return project === undefined ? t("time.move.draftTitleAll") : t("time.move.draftTitle", { project: project.name });
}

export default function MoveOntoInvoice({ entries, invoiced, rate, companyOf, onClose }: { entries: readonly TimeEntry[]; invoiced: ReadonlySet<Id>; rate: Decimal | null; companyOf: (clientId: Id) => string; onClose: () => void }) {
  const { t, number, money } = useI18n();
  const projects = useDesk((s) => s.rows.projects);
  // Held drafts decide where the lines go (the move reads them again before it writes).
  const invoices = useDesk((s) => s.rows.invoices);
  const groups = useMemo(() => movePreview(entries, invoiced, rate, (clientId, projectId) => draftFor(clientId, projectId)), [entries, invoiced, rate, invoices]);
  const hours = sumHours(groups.flatMap((g) => g.entries));
  const amount = rate === null ? null : sumDecimals(groups.map((g) => g.amount));
  // No day rate on the card: the move is refused before anything is sent, and says so now.
  const [error, setError] = useState<Words | null>(rate === null ? { key: "time.error.noDayRate", field: null } : null);
  const [busy, setBusy] = useState(false);
  const [unfinished, setUnfinished] = useState<Unfinished<OntoDrafts> | null>(null);

  const finish = async (run: () => ReturnType<typeof moveNotInvoiced>) => {
    setBusy(true);
    const out = await run();
    setBusy(false);
    if (out.ok) {
      const { lines } = out.value;
      if (lines.length === 0) toast(t("time.sheet.move.already"), { icon: "info" });
      else {
        const moved = new Set(lines.map((l) => l.time_entry_id));
        const movedHours = sumHours(entries.filter((e) => moved.has(e.id)));
        toast(t("time.sheet.move.done", { hours: hoursLabel(t, number, movedHours), amount: money(sumDecimals(lines.map((l) => l.amount))) }), { icon: "check", tone: "pos" });
      }
      onClose();
      return;
    }
    setUnfinished(out.unfinished);
    setError(refusalWords(out));
  };

  const move = () => {
    void finish(() => moveNotInvoiced(entries, invoiced, rate, (projectId) => draftTitle(t, projectId === null ? undefined : projects[projectId])));
  };

  const where = (draft: Invoice | null) => (draft === null ? t("time.sheet.move.fresh") : draft.title === null || draft.title === "" ? t("time.sheet.move.existingUntitled") : t("time.sheet.move.existing", { title: draft.title }));

  return (
    <Sheet title={t("time.sheet.move.title")} sub={`${hoursLabel(t, number, hours)}${amount === null ? "" : ` · ${money(amount)}`}`} icon={ReceiptText} onClose={onClose}>
      <div className="time-sheet">
        {rate !== null && <p className="time-sheet-lead">{t("time.sheet.move.lead", { rate: money(rate) })}</p>}
        <ul className="time-move-list" aria-label={t("time.sheet.move.title")}>
          {groups.map((g) => (
            <li key={g.clientId} className="time-move-row">
              <span className="time-move-words">
                <span className="time-move-client">{companyOf(g.clientId)}</span>
                <span className="time-move-where">
                  {t("time.sheet.move.entries", { count: number(g.entries.length) }, g.entries.length)} · {where(g.draft)}
                </span>
              </span>
              <span className="time-move-figures">
                <span className="money">{hoursLabel(t, number, g.hours)}</span>
                {g.amount !== null && <span className="money time-move-amount">{money(g.amount)}</span>}
              </span>
            </li>
          ))}
        </ul>
        {error !== null && <Alert>{t(error.key, { name: "" })}</Alert>}
        {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void finish(() => unfinished.resume())} />}
        <Button kind="primary" size="wide" icon={ReceiptText} busy={busy} disabled={rate === null || groups.length === 0} onClick={move}>
          {amount === null ? t("time.sheet.move.go", { hours: hoursLabel(t, number, hours) }) : t("time.sheet.move.goAmount", { hours: hoursLabel(t, number, hours), amount: money(amount) })}
        </Button>
      </div>
    </Sheet>
  );
}
