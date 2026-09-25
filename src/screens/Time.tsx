/**
 * Time: the hours the studio logs, the running clock, and moving hours onto
 * an invoice.
 *
 *   the lead      how the hours are kept, and the hourly rate — the rate
 *                 card's day rate over the hours in a working day
 *   three sums    logged this month, not yet invoiced (and at the rate),
 *                 the heaviest project
 *   filters       everything, or one project
 *   the clock     each clock still running (a stored entry with no hours, so
 *                 it is there after a reload and on another computer), and
 *                 Start when the signed-in person has none
 *   log time      the form in the card
 *   entries       who, what, client · milestone · day, hours, and whether a
 *                 line of an invoice carries it — the line is the only record
 *                 of that, and "Invoiced" opens the invoice
 *   the foot      what the filter holds not yet invoiced, and "Move onto an
 *                 invoice" (a sheet says where each client's lines will go
 *                 before anything is written)
 */
import { Plus, ReceiptText, Timer } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Button, Filters, ScreenHead } from "../components/ui.tsx";
import type { Decimal, Id, Project, TimeEntry } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { ensureRows, refreshRows, useDesk, useRows, useSettings } from "../state/desk.ts";
import { loadRunningClocks, loadTime } from "../state/timeActions.ts";
import { toast } from "../state/ui.ts";
import MoveOntoInvoice from "../sheets/time/MoveOntoInvoice.tsx";
import StartClock from "../sheets/time/StartClock.tsx";
import StopClock from "../sheets/time/StopClock.tsx";
import { Clocks, type ClockView } from "./time/Clocks.tsx";
import { Entries } from "./time/Entries.tsx";
import { LogForm, type LogDraft } from "./time/LogForm.tsx";
import { amountAt, filterChoices, filterProject, hourly, inOrder, isRunning, monthStart, openProjects, personOf, rowsFor, sumHours, timeSums, type TimeFilter } from "./time/model.ts";
import { stopOrAsk } from "./time/act.ts";
import { hoursLabel, type Words } from "./time/words.ts";

/** Every entry is read, newest first (Adminium's read cap bounds it): time not yet invoiced may be old. */
const FROM_THE_START = "2000-01-01";
/** Rows drawn at once; "Show more" draws the next. */
const PAGE = 50;
/** "Not invoiced" turns amber past this many hours. */
const MANY_HOURS = 12;

type SheetOpen = { kind: "start" } | { kind: "stop"; entry: TimeEntry; why: Words } | { kind: "move" } | null;

export default function Time() {
  const { t, number, money, locale } = useI18n();
  const day = useDesk((s) => s.today) || today();
  const heldEntries = useDesk((s) => s.rows.time_entries);
  const heldLines = useDesk((s) => s.rows.invoice_lines);
  const projects = useDesk((s) => s.rows.projects);
  const clients = useDesk((s) => s.rows.clients);
  const me = useDesk((s) => s.me);
  const people = inOrder(useRows("people"));
  const rates = useRows("rates");
  const settings = useSettings();

  const [load, setLoad] = useState<"loading" | "ready" | "failed">("loading");
  const [filter, setFilter] = useState<TimeFilter>("all");
  const [form, setForm] = useState<LogDraft | null>(null);
  const [sheet, setSheet] = useState<SheetOpen>(null);
  const [shown, setShown] = useState(PAGE);
  const [clockBusy, setClockBusy] = useState<Id | "start" | null>(null);
  const [clockError, setClockError] = useState<string | null>(null);

  const read = useCallback(async () => {
    setLoad("loading");
    try {
      const entries = await loadTime(FROM_THE_START);
      const held = useDesk.getState().rows;
      const lines = Object.values(held.invoice_lines).filter((l) => l.time_entry_id !== null);
      await Promise.all([
        ensureRows("invoices", lines.map((l) => l.document_id)),
        ensureRows("clients", [...entries.map((e) => e.client_id), ...entries.map((e) => held.projects[e.project_id]?.client_id)]),
      ]);
      setLoad("ready");
    } catch {
      setLoad("failed");
    }
  }, []);
  useEffect(() => {
    void read();
  }, [read]);

  // A reconnect reads the desk's open work again from scratch, which holds no time: read it again too.
  const heldCount = Object.keys(heldEntries).length;
  const [hadEntries, setHadEntries] = useState(false);
  useEffect(() => {
    if (heldCount > 0) setHadEntries(true);
    else if (hadEntries && load === "ready") {
      setHadEntries(false);
      void read();
    }
  }, [heldCount, hadEntries, load, read]);

  // A clock started or stopped on another computer shows when this one is looked at again.
  useEffect(() => {
    const again = () => {
      const running = Object.values(useDesk.getState().rows.time_entries).filter(isRunning).map((e) => e.id);
      void Promise.all([loadRunningClocks(), refreshRows("time_entries", running)]).catch(() => undefined);
    };
    window.addEventListener("focus", again);
    return () => window.removeEventListener("focus", again);
  }, []);

  const entries = useMemo(() => Object.values(heldEntries), [heldEntries]);
  /** The invoice each carried entry is on: a line pointing at it is the record. */
  const invoicedBy = useMemo(() => {
    const out = new Map<Id, Id>();
    for (const line of Object.values(heldLines)) if (line.time_entry_id !== null) out.set(line.time_entry_id, line.document_id);
    return out;
  }, [heldLines]);
  const invoiced = useMemo(() => new Set(invoicedBy.keys()), [invoicedBy]);

  const companyOfClient = (clientId: Id | null | undefined): string => (clientId === null || clientId === undefined ? "" : (clients[clientId]?.company ?? ""));
  const companyOf = (project: Project | undefined): string => companyOfClient(project?.client_id);

  const rate = hourly(rates, settings);
  const sums = useMemo(() => timeSums(entries, invoiced, day), [entries, invoiced, day]);
  const choices = useMemo(() => filterChoices(entries, projects, (id) => clients[id]?.company ?? null), [entries, projects, clients]);
  const current: TimeFilter = choices.some((c) => c.id === filter) ? filter : "all";
  const rows = useMemo(() => rowsFor(entries, current), [entries, current]);
  const notInvoiced = rows.filter((e) => !invoiced.has(e.id));
  const footHours = sumHours(notInvoiced);
  const selectedProject = filterProject(current);

  const openList = openProjects(Object.values(projects));
  const mePerson = personOf(people, me.email);
  const clocks: ClockView[] = entries
    .filter(isRunning)
    .sort((a, b) => (a.started_at ?? "").localeCompare(b.started_at ?? ""))
    .map((entry) => ({ entry, person: people.find((p) => p.id === entry.running_for) ?? null, company: companyOf(projects[entry.project_id]), project: projects[entry.project_id]?.name ?? null }));

  const hours = (h: Decimal | number | null) => hoursLabel(t, number, h);
  const monthName = new Intl.DateTimeFormat(locale, { month: "long", timeZone: "UTC" }).format(new Date(`${monthStart(day)}T12:00:00Z`));
  const pickProject = selectedProject !== null && openList.some((p) => p.id === selectedProject) ? selectedProject : (openList[0]?.id ?? null);

  const lead = [
    people.length > 0 ? t("time.lead.people", { count: number(people.length) }, people.length) : null,
    rate !== null && settings !== null ? t("time.lead.rate", { rate: money(rate), hours: number(settings.hours_per_day) }) : t("time.lead.noRate"),
  ]
    .filter((x) => x !== null)
    .join(" ");

  const stop = async (entry: TimeEntry) => {
    setClockBusy(entry.id);
    setClockError(null);
    const answer = await stopOrAsk(entry);
    setClockBusy(null);
    if (answer.kind === "stopped") {
      toast(t("time.clock.stopped", { hours: hours(answer.entry.hours), client: companyOf(projects[entry.project_id]) }), { icon: "check", tone: "pos" });
      return;
    }
    // What Stop alone cannot settle, the sheet asks: the real hours, or what it was on.
    if (answer.kind === "ask") {
      setSheet({ kind: "stop", entry, why: answer.why });
      return;
    }
    // Stopped elsewhere, or gone: read it again so the page says what is true.
    if (answer.code === "CLOCK_NOT_RUNNING" || answer.reason === "gone") void refreshRows("time_entries", [entry.id]).catch(() => undefined);
    setClockError(t(answer.why.key, { name: "" }));
  };

  const moveOrSay = () => {
    if (notInvoiced.length === 0) {
      toast(t("time.foot.allInvoicedToast"), { icon: "check" });
      return;
    }
    setSheet({ kind: "move" });
  };

  const sumCard = (key: string, label: string, value: string, sub: string, tone: "fg" | "warn" = "fg") => (
    <div className="time-sum" data-sum={key}>
      <span className="time-sum-label">{label}</span>
      <span className={`time-sum-value${tone === "warn" ? " time-sum-value--warn" : ""}`}>{value}</span>
      <span className="time-sum-sub">{sub}</span>
    </div>
  );

  const heaviest = sums.heaviest;
  const filterLabel = (c: (typeof choices)[number]) => (c.id === "all" ? t("time.filter.all") : [c.company, c.project].filter((x) => x !== null && x !== "").join(" · "));

  return (
    <section className="screen ol-screen time-screen" data-screen="time" aria-labelledby="time-title">
      <ScreenHead id="time-title" title={t("nav.time")} lead={lead} />

      <div className="time-sums">
        {sumCard("month", t("time.sum.month", { month: monthName }), hours(sums.month), t("time.sum.monthSub", { count: number(sums.monthProjects) }, sums.monthProjects))}
        {sumCard(
          "open",
          t("time.sum.notInvoiced"),
          hours(sums.notInvoiced),
          rate === null ? t("time.sum.noRate") : t("time.sum.notInvoicedSub", { amount: money(amountAt(sums.notInvoiced, rate)), rate: money(rate) }),
          Number(sums.notInvoiced) > MANY_HOURS ? "warn" : "fg",
        )}
        {sumCard("heaviest", t("time.sum.heaviest"), hours(heaviest?.hours ?? 0), heaviest === null ? "—" : (projects[heaviest.projectId]?.name ?? "—"))}
      </div>

      {choices.length > 1 && (
        <Filters
          label={t("time.filter.label")}
          value={current}
          onChange={(id) => {
            setFilter(id);
            setShown(PAGE);
          }}
          items={choices.map((c) => ({ id: c.id, label: filterLabel(c), count: c.count }))}
        />
      )}

      <section className="time-card" aria-labelledby="time-entries">
        <div className="time-card-head">
          <Timer size={15} aria-hidden="true" className="time-card-icon" />
          <h2 id="time-entries" className="time-card-title">
            {t("time.entries")}
          </h2>
          <Button size="small" icon={Plus} className="time-log-btn" aria-expanded={form !== null} disabled={openList.length === 0 || people.length === 0} onClick={() => setForm({ project: pickProject, hours: "", who: mePerson?.id ?? people[0]?.id ?? null, date: day, note: "" })}>
            {t("time.log")}
          </Button>
        </div>

        <Clocks clocks={clocks} me={mePerson} busy={clockBusy} onStart={() => setSheet({ kind: "start" })} onStop={(entry) => void stop(entry)} />
        {clockError !== null && (
          <div className="time-clock-error">
            <Alert>{clockError}</Alert>
          </div>
        )}

        {form !== null && <LogForm projects={openList} people={people} initial={form} companyOf={companyOf} onClose={() => setForm(null)} />}

        <Entries load={load} rows={rows.slice(0, shown)} invoicedBy={invoicedBy} onRetry={() => void read()} />
        {rows.length > shown && (
          <div className="time-more">
            <Button size="small" onClick={() => setShown((n) => n + PAGE)}>
              {t("common.more")}
            </Button>
          </div>
        )}

        <div className="time-foot">
          <span className="time-foot-label">{notInvoiced.length === 0 ? t("time.foot.none") : selectedProject === null ? t("time.foot.all") : t("time.foot.project", { project: projects[selectedProject]?.name ?? "" })}</span>
          <span className="time-foot-figures">
            {hours(footHours)}
            {rate !== null && ` · ${money(amountAt(footHours, rate))}`}
          </span>
          <Button kind="primary" icon={ReceiptText} onClick={moveOrSay}>
            {notInvoiced.length === 0 ? t("time.foot.nothing") : t("time.foot.move")}
          </Button>
        </div>
      </section>

      {sheet?.kind === "start" && (
        <StartClock
          projects={openList}
          people={people}
          project={pickProject}
          who={mePerson?.id ?? null}
          companyOf={companyOf}
          onClose={() => setSheet(null)}
          onRefused={() => void loadRunningClocks().catch(() => undefined)}
        />
      )}
      {sheet?.kind === "stop" && <StopClock entry={sheet.entry} why={sheet.why} company={companyOf(projects[sheet.entry.project_id])} onClose={() => setSheet(null)} />}
      {sheet?.kind === "move" && <MoveOntoInvoice entries={notInvoiced} invoiced={invoiced} rate={rate} companyOf={(id) => companyOfClient(id)} onClose={() => setSheet(null)} />}
    </section>
  );
}
