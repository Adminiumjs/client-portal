/**
 * The entries themselves: who (their initials), what the hours went on,
 * client · milestone · day, the hours, and whether a line of an invoice
 * carries them — "Invoiced" opens that invoice; "Invoice voided" opens the
 * voided one (nothing was charged, and its line still holds the hours);
 * "Not invoiced" is only a word.
 * While the entries are read, a loading line; a failed read, the words and
 * "Try again"; no time at all, the empty card.
 */
import { Timer } from "lucide-react";

import { Alert, Button, Empty } from "../../components/ui.tsx";
import type { Id, TimeEntry } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { initials } from "../../lib/initials.ts";
import { useDesk } from "../../state/desk.ts";
import { open } from "../../state/ui.ts";
import { dayWithYear } from "./model.ts";
import { hoursLabel } from "./words.ts";

export function Entries({ load, rows, invoicedBy, onRetry }: { load: "loading" | "ready" | "failed"; rows: readonly TimeEntry[]; invoicedBy: ReadonlyMap<Id, Id>; onRetry: () => void }) {
  const { t, number, locale } = useI18n();
  const people = useDesk((s) => s.rows.people);
  const projects = useDesk((s) => s.rows.projects);
  const clients = useDesk((s) => s.rows.clients);
  const milestones = useDesk((s) => s.rows.milestones);
  const invoices = useDesk((s) => s.rows.invoices);
  const companyOfClient = (clientId: Id | null | undefined): string => (clientId === null || clientId === undefined ? "" : (clients[clientId]?.company ?? ""));
  const hours = (h: TimeEntry["hours"]) => hoursLabel(t, number, h);
  return (
    <>
      {load === "failed" && rows.length === 0 ? (
        <div className="time-load">
          <Alert>{t("time.loadFailed")}</Alert>
          <Button size="small" onClick={onRetry}>
            {t("common.retry")}
          </Button>
        </div>
      ) : load === "loading" && rows.length === 0 ? (
        <p className="time-loading">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <Empty icon={Timer} title={t("time.empty.title")} body={t("time.empty.body")} />
      ) : (
        <ul className="time-rows" aria-label={t("time.entries")}>
          {rows.map((entry) => {
            const person = people[entry.person_id];
            const project = projects[entry.project_id];
            const milestone = entry.milestone_id === null ? null : (milestones[entry.milestone_id]?.title ?? null);
            const invoiceId = invoicedBy.get(entry.id);
            const invoice = invoiceId === undefined ? undefined : invoices[invoiceId];
            const meta = [companyOfClient(entry.client_id ?? project?.client_id), milestone, dayWithYear(entry.date, locale)].filter((x) => x !== null && x !== "").join(" · ");
            return (
              <li key={entry.id} className="time-row" data-entry={entry.id}>
                <span className="time-who" title={person?.name}>
                  <span aria-hidden="true">{person?.initials ?? initials(person?.name ?? "")}</span>
                  <span className="ol-sr-only">{person?.name}</span>
                </span>
                <span className="time-row-words">
                  <span className="time-row-note">{entry.note}</span>
                  <span className="time-row-meta">{meta}</span>
                </span>
                <span className="time-row-hours">{hours(entry.hours)}</span>
                {invoiceId === undefined ? (
                  <span className="time-chip">{t("time.row.notInvoiced")}</span>
                ) : invoice?.status === "void" ? (
                  // Its invoice was voided: nothing was charged, and the voided line still holds the hours.
                  <button type="button" className="time-chip time-chip--void ol-chip" title={t("time.row.voidedHint")} onClick={() => open("invoice", invoiceId)}>
                    {t("time.row.voided")}
                    <span className="ol-sr-only">{` · ${invoice.number ?? ""} · ${t("time.row.voidedHint")}`}</span>
                  </button>
                ) : (
                  <button type="button" className="time-chip time-chip--on ol-chip" onClick={() => open("invoice", invoiceId)}>
                    {t("time.row.invoiced")}
                    {/* A draft shows no number; a sent invoice's number is said to a screen reader. */}
                {invoice !== undefined && invoice.status !== "draft" && invoice.number !== null && <span className="ol-sr-only">{` · ${invoice.number}`}</span>}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
