/**
 * Capacity — "Can we take this?": answering an enquiry honestly means knowing
 * how long the studio is booked for. The schedule shows dates; this answers
 * the question, and hands over the sentence to paste back.
 *
 * Who is asking (the newest open enquiries), how big the job is, and whether
 * to count the proposals still out as booked. Then the verdict — "Yes, and
 * soon", "Yes, but not yet" or "Not this quarter" — with the sentence to copy,
 * the enquiry to open and the week to hold (the "Add a date" sheet, filled
 * in). Below: the next thirteen weeks, a square per working day (used, held
 * for a proposal out, open, or not there because someone is away or it is a
 * public holiday), what fills the weeks before the start, and other honest
 * answers.
 *
 * The weeks are `state/capacity.ts`'s: each person's days a week less their
 * away days and the public holidays Holiday calendars keeps (when it is
 * attached), and the open milestones' estimated days spread over their
 * working days. Nothing here is stored but a held week, which is a studio
 * date like any other.
 */
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { CalendarPlus, Check, Circle, CircleCheck, CircleDot, CircleSlash, Clock, Copy, FileText, FolderOpen, Gauge, Hand, Inbox, Info, Phone, Plane, Printer, Scissors, Split } from "lucide-react";

import { Alert, Button } from "../components/ui.tsx";
import type { Id, StudioEvent } from "../data/types.ts";
import { addDays } from "../data/venueTime.ts";
import { useI18n } from "../i18n/index.tsx";
import { today as clockToday } from "../lib/clock.ts";
import { dayLabel } from "../lib/dates.ts";
import AddDate, { type DatePrefill } from "../sheets/schedule/AddDate.tsx";
import { capacityWeeks } from "../state/capacity.ts";
import { isInDate, loadWhere, useAddOnSettings, useCan, useDesk, useRows, useSettings } from "../state/desk.ts";
import { loadStudioDates } from "../state/officeActions.ts";
import { go, open, toast } from "../state/ui.ts";
import { afterView, enquiriesAsking, fitOf, loadBefore, proposalDays, SIZES, squaresOf, weekRows, type LoadItem, type OutProposal, type SizeKey } from "./capacity/model.ts";
import { dayMonthLabel, firstNameOf, holidaysOf, monthName } from "./schedule/model.ts";
import { showDay } from "./schedule/state.ts";

const WEEKS = 13;

/** Numbers as the page shows days: whole, or one place when it matters. */
const days1 = (n: number) => Math.round(n * 10) / 10;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export default function Capacity() {
  const { t, number, locale } = useI18n();
  const day = useDesk((s) => s.today) || clockToday();
  const settings = useSettings();
  const people = useRows("people");
  const projects = useRows("projects");
  const milestones = useRows("milestones");
  const events = useRows("events");
  const enquiries = useRows("enquiries");
  const proposals = useRows("proposals");
  const lines = useRows("proposal_lines");
  const rates = useRows("rates");
  const clients = useDesk((s) => s.rows.clients);
  const holidaySettings = useAddOnSettings("holiday-calendars");
  const canHold = useCan("events", "create");

  const [enquiryId, setEnquiryId] = useState<Id | null>(null);
  const [size, setSize] = useState<SizeKey>("medium");
  const [countOut, setCountOut] = useState(false);
  const [holding, setHolding] = useState<DatePrefill | null>(null);

  const monday = (() => {
    const w = new Date(`${day}T12:00:00Z`).getUTCDay();
    return addDays(day, w === 0 ? -6 : 1 - w);
  })();
  const lastDay = addDays(monday, WEEKS * 7 - 1);

  // The studio's dates over the weeks shown, and the lines of the proposals still out.
  const out = useMemo(() => proposals.filter((p) => isInDate(p, day)), [proposals, day]);
  const outIds = out.map((p) => p.id).join(",");
  useEffect(() => {
    void loadStudioDates(day, lastDay).catch(() => undefined);
  }, [day, lastDay]);
  useEffect(() => {
    if (out.length === 0) return;
    void loadWhere("proposal_lines", { column: "document_id", op: "in", value: out.map((p) => p.id) }, "position.asc", 1000).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outIds]);

  const studioDays = settings?.days_per_week ?? 5;
  const hoursPerDay = settings?.hours_per_day ?? 6;
  const holidays = useMemo(() => holidaysOf(holidaySettings), [holidaySettings]);

  const view = useMemo(
    () =>
      capacityWeeks({
        today: day,
        weeks: WEEKS,
        studioDaysPerWeek: studioDays,
        people: people.map((p) => ({ id: p.id, days_per_week: p.days_per_week })),
        projects: projects.map((p) => ({ id: p.id, status: p.status, started_on: p.started_on })),
        milestones: milestones.map((m) => ({ id: m.id, project_id: m.project_id, due_on: m.due_on, state: m.state, estimated_days: m.estimated_days === null ? null : String(m.estimated_days), position: m.position })),
        events: events.map((e) => ({ date: e.date, to_date: e.to_date, kind: e.kind, person_id: e.person_id })),
        holidays: holidays.map((h) => h.date),
      }),
    [day, studioDays, people, projects, milestones, events, holidays],
  );
  const squares = people.reduce((sum, p) => sum + (p.days_per_week ?? studioDays), 0);
  const outDays: OutProposal[] = out.flatMap((p) => {
    const d = proposalDays(p, lines.filter((l) => l.document_id === p.id), rates, hoursPerDay);
    return d === null ? [] : [{ id: p.id, number: p.number, days: d }];
  });
  const rows = weekRows(view, squares, outDays, countOut);
  const need = SIZES.find((s) => s.key === size)!.days;
  const fit = fitOf(rows, need);
  const small = fitOf(rows, 3);
  const heldDays = days1(rows.reduce((sum, r) => sum + r.held, 0));
  const totalOpen = Math.round(rows.reduce((sum, r) => sum + r.open, 0));
  const beyond = afterView(rows);
  const beyondMonth = beyond === null ? "" : monthName(beyond.slice(0, 7), locale);

  const asking = enquiriesAsking(enquiries);
  const enquiry = asking.find((e) => e.id === enquiryId) ?? asking[0] ?? null;
  const first = enquiry === null ? t("capacity.hello") : (enquiry.name.trim().split(/\s+/)[0] ?? enquiry.name);
  const business = enquiry === null ? null : (enquiry.business ?? enquiry.name);

  const start = fit === null ? null : rows[fit.start]!;
  const end = fit === null ? null : rows[fit.end]!;
  const soon = fit !== null && fit.start <= 1;
  const week = (d: string) => dayLabel(d, locale);
  const weekLong = (d: string) => dayMonthLabel(d, locale);

  const kicker: { icon: LucideIcon; text: string; tone: string } = fit === null ? { icon: CircleSlash, text: t("capacity.verdict.none"), tone: "none" } : soon ? { icon: CircleCheck, text: t("capacity.verdict.soon"), tone: "soon" } : { icon: Clock, text: t("capacity.verdict.later"), tone: "later" };
  const headline = fit === null ? t("capacity.headline.none", { month: beyondMonth }) : soon ? t("capacity.headline.soon", { day: week(start!.start) }) : t("capacity.headline.later", { day: week(start!.start) });
  const body =
    fit === null
      ? t("capacity.body.none", { n: number(need), weeks: number(rows.length), open: number(totalOpen) })
      : [t("capacity.body.fit", { n: number(need), start: week(start!.start), end: week(end!.start) }), enquiry !== null && enquiry.start_when !== null && enquiry.start_when.trim() !== "" ? t("capacity.body.asked", { business: business ?? "", when: enquiry.start_when }) : ""]
          .filter((s) => s !== "")
          .join(" ");
  const sentence = fit === null ? t("capacity.sentence.none", { first, month: beyondMonth }) : t("capacity.sentence.fit", { first, start: weekLong(start!.start), end: weekLong(end!.start) });

  const copy = async (text: string, ok: string, blocked: string) => {
    if (await copyText(text)) toast(ok, { icon: "copy" });
    else toast(blocked, { icon: "copy", tone: "warn" });
  };

  const hold = () => {
    if (start === null) {
      toast(t("capacity.hold.nothing", { month: beyondMonth }), { icon: "calendar-plus" });
      return;
    }
    setHolding({ date: start.start < day ? day : start.start, title: business === null ? t("capacity.hold.titleNone") : t("capacity.hold.title", { business }), kind: "call" });
  };
  const held = (event: StudioEvent) => {
    setHolding(null);
    showDay(event.date);
    toast(t("capacity.hold.done", { day: dayLabel(event.date, locale, "weekday") }), { icon: "calendar-plus" });
  };

  const toggleOut = () => {
    setCountOut(!countOut);
    toast(countOut ? t("capacity.out.toastOff") : t("capacity.out.toastOn"), { icon: "file-text" });
  };

  // What each week is filled with, in words.
  const milestoneTitle = new Map(milestones.map((m) => [m.id, m.title]));
  const whyOf = (i: number): string => {
    const r = rows[i]!;
    const w = view.weeks[i]!;
    const parts: string[] = [];
    const named = [...r.filledBy].sort((a, b) => b.days - a.days || a.milestoneId - b.milestoneId);
    parts.push(...named.slice(0, 2).map((f) => milestoneTitle.get(f.milestoneId) ?? ""));
    if (named.length > 2) parts.push(t("capacity.why.more", { n: number(named.length - 2) }));
    const weekDays = Array.from({ length: 5 }, (_, k) => addDays(w.start, k));
    const away = new Map<Id | null, number>();
    for (const e of events) {
      if (e.kind !== "away") continue;
      const last = e.to_date ?? e.date;
      const n = weekDays.filter((d) => d >= e.date && d <= last && !holidays.some((h) => h.date === d)).length;
      if (n > 0) away.set(e.person_id, (away.get(e.person_id) ?? 0) + n);
    }
    for (const [who, n] of away) {
      const name = firstNameOf(people, who);
      parts.push(name === null ? t("capacity.why.someone", { n: number(n) }, n) : t("capacity.why.away", { name, n: number(n) }, n));
    }
    for (const h of holidays) if (weekDays.includes(h.date)) parts.push(h.name);
    for (const id of r.heldFor) {
      const p = out.find((x) => x.id === id);
      parts.push(t("capacity.why.held", { number: p?.number ?? p?.title ?? "" }));
    }
    return parts.length === 0 ? t("capacity.why.open") : parts.filter((p) => p !== "").join(" · ");
  };

  const endDay = start !== null ? start.start : addDays(rows[rows.length - 1]?.start ?? day, 6);
  const load = loadBefore({ today: day, projects, milestones, events }, endDay);
  const numbersOf = new Map(projects.map((p) => [p.id, p.number]));
  const LOAD_ICON: Record<LoadItem["kind"], LucideIcon> = { now: CircleDot, milestone: Circle, away: Plane, press: Printer, call: Phone };
  const loadSub = (l: LoadItem): string => {
    if (l.kind === "away") {
      const n = l.to === null ? 1 : Math.round((Date.parse(l.to) - Date.parse(l.day)) / 86_400_000) + 1;
      return t("capacity.load.away", { n: number(n) }, n);
    }
    if (l.projectId === null) return t("capacity.load.diary");
    return `${l.clientId === null ? "" : (clients[l.clientId]?.company ?? "")} · ${numbersOf.get(l.projectId) ?? ""}`;
  };
  const openLoad = (l: LoadItem) => {
    if (l.projectId !== null) open("project", l.projectId);
    else {
      showDay(null, l.day.slice(0, 7));
      go("schedule");
    }
  };

  const alts: { key: string; icon: LucideIcon; title: string; line: string }[] = [];
  if (small !== null && (fit === null || small.start < fit.start)) {
    alts.push({ key: "small", icon: Scissors, title: t("capacity.alts.small"), line: t("capacity.alts.smallLine", { first, start: weekLong((start ?? rows[small.start]!).start), small: weekLong(rows[small.start]!.start) }) });
  }
  alts.push({ key: "no", icon: Hand, title: t("capacity.alts.no"), line: t("capacity.alts.noLine", { first, until: weekLong((start ?? rows[rows.length - 1] ?? { start: day }).start) }) });

  const evenDays = people.length > 0 && people.every((p) => (p.days_per_week ?? studioDays) === (people[0]!.days_per_week ?? studioDays));
  const foot = [
    evenDays ? t("capacity.foot.even", { total: number(squares), people: number(people.length), days: number(people[0]!.days_per_week ?? studioDays) }, people.length) : t("capacity.foot.mixed", { total: number(squares) }),
    t("capacity.foot.admin"),
    t("capacity.foot.dashed"),
    countOut ? t("capacity.foot.outlined") : "",
  ]
    .filter((s) => s !== "")
    .join(" ");

  const KickerIcon = kicker.icon;
  return (
    <section className="screen ol-screen cap-screen" data-screen="capacity" aria-labelledby="capacity-title">
      <div>
        <h1 className="cap-title" id="capacity-title">
          {t("capacity.title")}
        </h1>
        <p className="cap-lead">{t("capacity.lead")}</p>
      </div>

      <div className="cap-ask">
        <span className="cap-k" id="cap-asking">
          {t("capacity.asking")}
        </span>
        {asking.length === 0 ? (
          <span className="cap-ask-none">{t("capacity.asking.none")}</span>
        ) : (
          <div className="cap-chips" role="group" aria-labelledby="cap-asking">
            {asking.map((e) => (
              <button key={e.id} type="button" className="cap-chip ol-chip" aria-pressed={enquiry?.id === e.id} onClick={() => setEnquiryId(e.id)}>
                {e.trade !== null && e.trade.trim() !== "" ? t("capacity.asking.chip", { first: e.name.trim().split(/\s+/)[0] ?? e.name, trade: e.trade.toLocaleLowerCase(locale) }) : e.name}
              </button>
            ))}
          </div>
        )}
        <span className="cap-k cap-k--gap" id="cap-size">
          {t("capacity.size")}
        </span>
        <div className="filters" role="group" aria-labelledby="cap-size">
          {SIZES.map((s) => (
            <button key={s.key} type="button" className="filter ol-chip cap-size" aria-pressed={size === s.key} onClick={() => setSize(s.key)}>
              {t(`capacity.size.${s.key}`)}
              <span className="cap-size-note">{t(`capacity.size.${s.key}Note`, { n: number(s.days) })}</span>
            </button>
          ))}
        </div>
        <button type="button" className={`cap-out ol-chip${countOut ? " cap-out--on" : ""}`} aria-pressed={countOut} onClick={toggleOut}>
          {countOut ? <Check size={14} aria-hidden="true" /> : <FileText size={14} aria-hidden="true" />}
          {countOut ? t("capacity.out.on", { n: number(heldDays) }, heldDays) : t("capacity.out.off")}
        </button>
      </div>

      {people.length === 0 && <Alert tone="warn">{t("capacity.noPeople")}</Alert>}

      <section className="cap-verdict" aria-labelledby="cap-headline" data-verdict={kicker.tone}>
        <div className="cap-verdict-top">
          <span className="cap-kicker">
            <KickerIcon size={15} aria-hidden="true" />
            {kicker.text}
          </span>
          <h2 className="cap-headline" id="cap-headline">
            {headline}
          </h2>
          <p className="cap-body">{body}</p>
        </div>
        <div className="cap-verdict-foot">
          <span className="cap-k" id="cap-sentence-k">
            {t("capacity.sentence.label")}
          </span>
          <p className="cap-sentence" aria-labelledby="cap-sentence-k">
            {sentence}
          </p>
          <div className="cap-actions">
            <Button kind="primary" icon={Copy} onClick={() => void copy(sentence, t("capacity.copied"), t("capacity.blocked"))}>
              {t("capacity.copy")}
            </Button>
            <Button icon={Inbox} onClick={() => go("enquiries")}>
              {t("capacity.openEnquiry")}
            </Button>
            {canHold && (
              <Button icon={CalendarPlus} onClick={hold}>
                {start === null ? t("capacity.hold.later", { month: beyondMonth }) : t("capacity.hold.week", { day: week(start.start < day ? day : start.start) })}
              </Button>
            )}
          </div>
        </div>
      </section>

      <section className="card cap-weeks" aria-labelledby="cap-weeks-title">
        <div className="cap-panel-head">
          <Gauge size={15} aria-hidden="true" className="cap-panel-icon" />
          <h2 className="cap-panel-title" id="cap-weeks-title">
            {t("capacity.weeks.title")}
          </h2>
          <span className="cap-panel-count">{t("capacity.weeks.open", { n: number(totalOpen), weeks: number(rows.length) }, totalOpen)}</span>
        </div>
        <ol className="cap-rows">
          {rows.map((r, i) => {
            const inSpan = fit !== null && i >= fit.start && i <= fit.end;
            const open_ = days1(r.open);
            return (
              <li key={r.start} className={`cap-row${inSpan ? " cap-row--span" : ""}`} data-week={r.start}>
                <span className="cap-row-label">{t("capacity.week.label", { day: week(r.start) })}</span>
                <span className="cap-cells" role="img" aria-label={t("capacity.week.cells", { capacity: number(days1(r.capacity)), used: number(days1(r.used + r.held)), open: number(open_) })}>
                  {squaresOf(r).map((s, c) => (
                    <span key={c} className={`cap-cell cap-cell--${s}${s === "open" && inSpan ? " cap-cell--pick" : ""}`} />
                  ))}
                </span>
                <span className="cap-row-why">{whyOf(i)}</span>
                <span className={`cap-row-open${open_ > 0 ? (inSpan ? " cap-row-open--pick" : "") : " cap-row-open--full"}`}>{open_ > 0 ? t("capacity.week.open", { n: number(open_) }) : t("capacity.week.full")}</span>
              </li>
            );
          })}
        </ol>
        {view.unplaced.length > 0 && <p className="cap-unplaced">{t("capacity.unplaced", { n: number(view.unplaced.length) }, view.unplaced.length)}</p>}
        <div className="cap-weeks-foot">
          <Info size={15} aria-hidden="true" />
          <span>{foot}</span>
        </div>
      </section>

      <div className="cap-lower">
        <section className="card cap-load" aria-labelledby="cap-load-title">
          <div className="cap-panel-head">
            <FolderOpen size={15} aria-hidden="true" className="cap-panel-icon" />
            <h2 className="cap-panel-title" id="cap-load-title">
              {t("capacity.load.title")}
            </h2>
            <span className="cap-panel-count">{load.length > 0 ? t("capacity.load.count", { n: number(load.length) }, load.length) : t("capacity.load.none")}</span>
          </div>
          <ul role="list" className="cap-load-list">
            {load.slice(0, 8).map((l) => {
              const Icon = LOAD_ICON[l.kind];
              return (
                <li key={l.key}>
                  <button type="button" className="cap-load-row ol-row" onClick={() => openLoad(l)}>
                    <span className={`cap-load-dot${l.kind === "now" ? " cap-load-dot--now" : ""}`} aria-hidden="true">
                      <Icon size={13} />
                    </span>
                    <span className="cap-load-text">
                      <span className="cap-load-title">{l.title}</span>
                      <span className="cap-load-sub">{loadSub(l)}</span>
                    </span>
                    <span className="cap-load-when">{l.to === null ? dayLabel(l.day, locale) : `${dayLabel(l.day, locale)}–${dayLabel(l.to, locale)}`}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="cap-load-foot">{load.length > 0 ? t("capacity.load.foot") : t("capacity.load.footNone")}</p>
        </section>

        <section className="card cap-alts" aria-labelledby="cap-alts-title">
          <div className="cap-panel-head">
            <Split size={15} aria-hidden="true" className="cap-panel-icon" />
            <h2 className="cap-panel-title" id="cap-alts-title">
              {t("capacity.alts.title")}
            </h2>
          </div>
          {alts.map((a) => {
            const Icon = a.icon;
            return (
              <div key={a.key} className="cap-alt" data-alt={a.key}>
                <span className="cap-alt-title">
                  <Icon size={14} aria-hidden="true" />
                  {a.title}
                </span>
                <p className="cap-alt-line">{a.line}</p>
                <Button size="small" icon={Copy} className="cap-alt-copy" onClick={() => void copy(a.line, t("capacity.alts.copied"), t("capacity.alts.blocked"))}>
                  {t("capacity.alts.copy")}
                </Button>
              </div>
            );
          })}
        </section>
      </div>

      {holding !== null && <AddDate prefill={holding} onClose={() => setHolding(null)} onSaved={held} />}
    </section>
  );
}
