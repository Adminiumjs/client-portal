/**
 * Schedule: the studio's month — every date somebody outside the studio is
 * expecting something on.
 *
 * The month opens on the studio's current month (any year), today marked
 * from the studio's own clock. On it: the milestones not done of projects not
 * finished, the open invoices' due days, the studio's own dates (a call, a
 * press check, someone away — a stretch on each of its days) and, when
 * Holiday calendars is attached, the public holidays under their own names.
 * Above it, the month's working days, what is committed and who is away;
 * below it, the next seven things from today on.
 *
 * A day opens its panel: what is on it (a milestone opens its project, a
 * payment its invoice), or a word about a clear day. "Add a date" writes one
 * `events` row through Adminium; nothing on this screen is kept in the
 * browser.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, CalendarPlus, ChevronLeft, ChevronRight, List, X } from "lucide-react";

import { Button, IconButton } from "../components/ui.tsx";
import type { Day, StudioEvent } from "../data/types.ts";
import { addDays } from "../data/venueTime.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { today as clockToday } from "../lib/clock.ts";
import { dayLabel } from "../lib/dates.ts";
import AddDate, { type DatePrefill } from "../sheets/schedule/AddDate.tsx";
import { useAddOnSettings, useCan, useDesk, useDeskReads, useRows } from "../state/desk.ts";
import { loadStudioDates } from "../state/officeActions.ts";
import { open, toast } from "../state/ui.ts";
import { daysIn, daysUntil, monthLabel, monthName, firstNameOf, holidaysOf, isWeekend, itemsByDay, monthGrid, monthOf, monthStats, nextInOrder, shiftMonth, type DayItem, type ItemKind } from "./schedule/model.ts";
import { showDay, useScheduleView } from "./schedule/state.ts";

/** The words a kind of item is tagged with. */
export const TAG: Record<ItemKind, MessageKey> = {
  now: "schedule.tag.milestone",
  milestone: "schedule.tag.milestone",
  payment: "schedule.tag.payment",
  press: "schedule.tag.press",
  call: "schedule.tag.call",
  away: "schedule.tag.away",
  holiday: "schedule.tag.holiday",
};

/** Monday … Sunday, short and one letter, in the page's language. */
function weekdayNames(locale: string): { short: string; narrow: string }[] {
  return Array.from({ length: 7 }, (_, i) => {
    const at = new Date(Date.UTC(2026, 5, 1 + i, 12)); // 1 June 2026 was a Monday
    return {
      short: new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(at),
      narrow: new Intl.DateTimeFormat(locale, { weekday: "narrow", timeZone: "UTC" }).format(at),
    };
  });
}

export default function Schedule() {
  const { t, number, money, locale } = useI18n();
  const day = useDesk((s) => s.today) || clockToday();
  const asked = useScheduleView((s) => s.month);
  const openDay = useScheduleView((s) => s.day);
  const month = asked ?? monthOf(day);
  const projects = useRows("projects");
  const milestones = useRows("milestones");
  const invoices = useRows("invoices");
  const events = useRows("events");
  const people = useRows("people");
  const clients = useDesk((s) => s.rows.clients);
  const holidays = holidaysOf(useAddOnSettings("holiday-calendars"));
  const canAdd = useCan("events", "create");
  const [adding, setAdding] = useState<DatePrefill | null>(null);

  // The studio's dates around the month shown, and from today on for the list below.
  const first = `${month}-01`;
  const last = `${month}-${String(daysIn(month)).padStart(2, "0")}`;
  const reads = useDeskReads();
  useEffect(() => {
    void loadStudioDates(first < day ? first : day, addDays(last > day ? last : day, 120)).catch(() => undefined);
  }, [first, last, day, reads]);

  const bag = useMemo(() => itemsByDay({ projects, milestones, invoices, events, holidays }), [projects, milestones, invoices, events, holidays.map((h) => h.date + h.name).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const cells = monthGrid(month);
  const stats = monthStats(month, bag);
  const next = nextInOrder(bag, day);
  const heads = weekdayNames(locale);
  const monthWord = monthName(month, locale);

  const who = (item: DayItem): string => (item.company !== null ? (clients[item.company]?.company ?? "") : item.kind === "holiday" ? t("schedule.day.holiday") : t("schedule.day.studio"));
  const titleOf = (item: DayItem): string => (item.kind === "payment" ? t("schedule.item.payment", { number: item.title }) : item.title);
  const fullOf = (item: DayItem): string => {
    if (item.kind === "payment") {
      const inv = invoices.find((i) => i.id === item.invoiceId);
      return `${item.title} · ${inv === undefined ? "" : money(inv.balance, inv.currency)}`;
    }
    return item.company === null ? item.title : `${who(item)} · ${item.title}`;
  };
  const go = (item: DayItem) => {
    if (item.opens !== null) open(item.opens.view, item.opens.id);
    else toast(item.kind === "holiday" ? t("schedule.toast.holiday") : t("schedule.toast.nothing"), { icon: "calendar-days" });
  };
  const dueIn = (target: Day): string => {
    const n = daysUntil(day, target);
    return n === 0 ? t("schedule.due.today") : n > 0 ? t("schedule.due.in", { n: number(n) }, n) : t("schedule.due.ago", { n: number(-n) }, -n);
  };

  const awayNames = stats.awayPeople.map((id) => firstNameOf(people, id)).filter((n): n is string => n !== null);
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  const statCards: { key: string; label: string; value: string; sub: string }[] = [
    {
      key: "working",
      label: t("schedule.stat.working"),
      value: number(stats.workingDays),
      sub: stats.holidays > 0 ? t("schedule.stat.workingSubHolidays", { month: monthWord, n: number(stats.holidays) }, stats.holidays) : t("schedule.stat.workingSub", { month: monthWord }),
    },
    {
      key: "committed",
      label: t("schedule.stat.committed"),
      value: number(stats.committed),
      sub: stats.committed > 0 ? t("schedule.stat.committedSub", {}, stats.committed) : t("schedule.stat.committedNone"),
    },
    {
      key: "short",
      label: t("schedule.stat.short"),
      value: stats.awayDays > 0 ? t("schedule.stat.shortDays", { n: number(stats.awayDays) }, stats.awayDays) : t("schedule.stat.shortNone"),
      sub: stats.awayDays === 0 ? t("schedule.stat.shortAllHere") : awayNames.length > 0 ? t("schedule.stat.shortAway", { names: list(awayNames) }) : t("schedule.stat.shortSomeone"),
    },
  ];

  const saved = (event: StudioEvent) => {
    setAdding(null);
    showDay(event.date);
    toast(t("schedule.sheet.done", { day: dayLabel(event.date, locale, "weekday") }), { icon: "calendar-plus" });
  };

  const selected = openDay !== null && openDay.startsWith(month) ? openDay : null;
  const selectedItems = selected === null ? [] : (bag.get(selected) ?? []);

  return (
    <section className="screen ol-screen sch-screen" data-screen="schedule" aria-labelledby="schedule-title">
      <div className="sch-head">
        <div className="sch-head-text">
          <h1 className="sch-title" id="schedule-title">
            {t("schedule.title")}
          </h1>
          <p className="sch-lead">{t("schedule.lead", { n: number(people.length) }, people.length)}</p>
        </div>
        <div className="sch-head-actions">
          <IconButton icon={ChevronLeft} className="sch-arrow sch-flip" label={t("schedule.prev")} onClick={() => showDay(null, shiftMonth(month, -1))} />
          <span className="sch-month" aria-live="polite">
            {monthLabel(month, locale)}
          </span>
          <IconButton icon={ChevronRight} className="sch-arrow sch-flip" label={t("schedule.next")} onClick={() => showDay(null, shiftMonth(month, 1))} />
          {canAdd && (
            <Button kind="primary" icon={CalendarPlus} className="sch-add" onClick={() => setAdding({ date: selected ?? (month === monthOf(day) ? addDays(day, 3) : first) })}>
              {t("schedule.add")}
            </Button>
          )}
        </div>
      </div>

      <div className="sch-stats">
        {statCards.map((s) => (
          <div key={s.key} className="card sch-stat" data-stat={s.key}>
            <span className="sch-stat-k">{s.label}</span>
            <span className="sch-stat-v">{s.value}</span>
            <span className="sch-stat-sub">{s.sub}</span>
          </div>
        ))}
      </div>

      <section className="card sch-cal" aria-label={monthLabel(month, locale)}>
        <div className="sch-heads" aria-hidden="true">
          {heads.map((h, i) => (
            <span key={i} className="sch-headcell">
              <span className="sch-head-short">{h.short}</span>
              <span className="sch-head-narrow">{h.narrow}</span>
            </span>
          ))}
        </div>
        <div className="sch-grid">
          {cells.map((c, n) => {
            if (c.day === null) return <span key={n} className={`sch-cell sch-cell--out${n >= cells.length - 7 ? " sch-cell--last" : ""}`} aria-hidden="true" />;
            const items = bag.get(c.day) ?? [];
            const isToday = c.day === day;
            const label = `${dayLabel(c.day, locale, "long")}${isToday ? ` · ${t("schedule.today")}` : ""} — ${items.length > 0 ? t("schedule.day.sub", { n: number(items.length) }, items.length) : t("schedule.day.clear")}`;
            return (
              <button
                key={c.day}
                type="button"
                className={`sch-cell${c.weekend ? " sch-cell--weekend" : ""}${n >= cells.length - 7 ? " sch-cell--last" : ""}`}
                aria-pressed={selected === c.day}
                aria-label={label}
                data-day={c.day}
                onClick={() => showDay(selected === c.day ? null : c.day, month)}
              >
                <span className={`sch-num${isToday ? " sch-num--today" : ""}`} aria-hidden="true">
                  {number(Number(c.day.slice(8)))}
                </span>
                {items.map((item) => (
                  <span key={item.key} className={`sch-item sch-tone--${item.kind}`} title={fullOf(item)} aria-hidden="true">
                    {titleOf(item)}
                  </span>
                ))}
              </button>
            );
          })}
        </div>
        {selected !== null && (
          <div className="sch-day" role="region" aria-labelledby="sch-day-title">
            <div className="sch-day-head">
              <h2 className="sch-day-title" id="sch-day-title">
                {dayLabel(selected, locale, "weekday")}
              </h2>
              <span className="sch-day-sub">{selectedItems.length > 0 ? t("schedule.day.sub", { n: number(selectedItems.length) }, selectedItems.length) : t("schedule.day.clear")}</span>
              <IconButton icon={X} className="sch-day-close" label={t("schedule.day.close")} onClick={() => showDay(null, month)} />
            </div>
            {selectedItems.map((item) => (
              <button key={item.key} type="button" className="sch-day-item ol-gi" onClick={() => go(item)}>
                <span className={`sch-dot sch-dot--${item.kind}`} aria-hidden="true" />
                <span className="sch-day-item-text">
                  <span className="sch-day-item-title">{titleOf(item)}</span>
                  <span className="sch-day-item-sub">{who(item)}</span>
                </span>
                <ChevronRight size={15} aria-hidden="true" className="sch-chev sch-flip" />
              </button>
            ))}
            {selectedItems.length === 0 && <p className="sch-day-note">{isWeekend(selected) ? t("schedule.day.weekend") : t("schedule.day.open")}</p>}
          </div>
        )}
      </section>

      <section className="card sch-next" aria-labelledby="sch-next-title">
        <div className="sch-next-head">
          <List size={15} aria-hidden="true" className="sch-next-icon" />
          <h2 className="sch-next-title" id="sch-next-title">
            {t("schedule.next.title")}
          </h2>
        </div>
        {next.length === 0 ? (
          <p className="sch-next-none">
            <CalendarDays size={15} aria-hidden="true" />
            {t("schedule.next.none")}
          </p>
        ) : (
          <ul role="list" className="sch-next-list">
            {next.map(({ day: on, item }) => (
              <li key={item.key}>
                <button type="button" className="sch-row ol-row" onClick={() => go(item)}>
                  <span className={`sch-dot sch-dot--${item.kind}`} aria-hidden="true" />
                  <span className="sch-row-when">{dayLabel(on, locale, "weekday")}</span>
                  <span className="sch-row-main">
                    <span className="sch-row-title">{titleOf(item)}</span>
                    <span className="sch-row-sub">
                      {who(item)} · {item.kind === "away" && item.to !== undefined && item.to !== item.from ? t("schedule.until", { day: dayLabel(item.to, locale) }) : dueIn(on)}
                    </span>
                  </span>
                  <span className="sch-row-tag">{t(TAG[item.kind])}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {adding !== null && <AddDate prefill={adding} onClose={() => setAdding(null)} onSaved={saved} />}
    </section>
  );
}
