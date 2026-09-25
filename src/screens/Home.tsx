/**
 * The studio's Home: the day's date and one sentence of what needs doing,
 * the three figures (what is owed, what is late, the work running), the open
 * balances by how late they are, what happened lately, what is waiting on a
 * client, and what falls due this week.
 *
 * Everything is read from the rows the desk holds; opening Home also reads
 * the payments of the last month (for the activity list) and how many
 * projects are done. Each row opens the document it is about.
 */
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Ban,
  Banknote,
  CalendarDays,
  CircleCheck,
  ClockAlert,
  FileCheck,
  FileX,
  FolderKanban,
  FolderPlus,
  HandCoins,
  Hourglass,
  Inbox,
  PenLine,
  PencilLine,
  Send,
  Tag,
  Undo2,
  Upload,
  Wallet,
} from "lucide-react";

import { Kicker, Money } from "../components/ui.tsx";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { studioZone } from "../lib/clock.ts";
import { dayLabel, instantLabel } from "../lib/dates.ts";
import { addDays, venueMidnight } from "../data/venueTime.ts";
import { ensureRows, loadPage, loadWhere, useDesk } from "../state/desk.ts";
import { go, open, openInvoices } from "../state/ui.ts";
import { aging, feed, kpis, overdueInvoices, proposalsOut, waiting, week, type FeedKind, type Target } from "./home/model.ts";

const FEED_LOOK: Readonly<Record<FeedKind, { icon: LucideIcon; tone: "pos" | "info" | "warn" }>> = {
  paymentReceived: { icon: Banknote, tone: "pos" },
  invoiceSent: { icon: Send, tone: "info" },
  invoiceVoided: { icon: Ban, tone: "warn" },
  clientSaysPaid: { icon: HandCoins, tone: "info" },
  proposalSent: { icon: Send, tone: "info" },
  proposalAccepted: { icon: FileCheck, tone: "pos" },
  proposalSigned: { icon: PenLine, tone: "pos" },
  proposalDeclined: { icon: FileX, tone: "warn" },
  proposalWithdrawn: { icon: Undo2, tone: "warn" },
  newPriceAsked: { icon: Tag, tone: "info" },
  deliverableShared: { icon: Upload, tone: "info" },
  deliverableApproved: { icon: CircleCheck, tone: "pos" },
  changesRequested: { icon: PencilLine, tone: "warn" },
  projectStarted: { icon: FolderPlus, tone: "pos" },
  enquiryIn: { icon: Inbox, tone: "info" },
};

function goTo(target: Target): void {
  if (target.view === "enquiries") go("enquiries");
  else open(target.view, target.id);
}

/** Today in the page's language, with its weekday and year ("Tue 28 Jul 2026"). */
function todayLong(day: string, locale: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}

export default function Home() {
  const { t, locale, money } = useI18n();
  const rows = useDesk((s) => s.rows);
  const today = useDesk((s) => s.today);
  const zone = studioZone();
  const [done, setDone] = useState<number | null>(null);

  // What Home shows beyond the open work: last month's payments (and the
  // invoices and clients they name), the invoices sent or voided in it, and
  // how many projects are done.
  useEffect(() => {
    if (today === "") return;
    let live = true;
    const since = venueMidnight(addDays(today, -30), zone);
    void loadWhere("payments", { column: "recorded_at", op: "gte", value: since }, "recorded_at.desc", 20)
      .then(async (payments) => {
        await ensureRows("invoices", payments.map((p) => p.document_id));
        const held = useDesk.getState().rows.invoices;
        await ensureRows("clients", payments.map((p) => p.client_id ?? held[p.document_id]?.client_id ?? null));
      })
      .catch(() => undefined);
    // Invoices sent or voided lately (paid ones are not open work), for the activity list.
    void loadWhere("invoices", { or: [{ column: "sent_at", op: "gte", value: since }, { column: "voided_at", op: "gte", value: since }] }, "id.desc", 50)
      .then((invoices) => ensureRows("clients", invoices.map((i) => i.client_id)))
      .catch(() => undefined);
    void loadPage("projects", { where: { column: "status", op: "eq", value: "done" }, limit: 1, offset: 0, count: true })
      .then((page) => {
        if (live) setDone(page.total);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [today, zone]);

  const day = today === "" ? "" : today;
  const figures = useMemo(() => kpis(rows, day, done), [rows, day, done]);
  const buckets = useMemo(() => aging(rows, day), [rows, day]);
  const activity = useMemo(() => feed(rows, zone), [rows, zone]);
  const waits = useMemo(() => waiting(rows, day, zone), [rows, day, zone]);
  const due = useMemo(() => week(rows, day), [rows, day]);
  const overdue = overdueInvoices(rows, day).length;
  const out = proposalsOut(rows, day).length;

  const lead = t("home.lead", {
    chase: overdue === 0 ? t("home.leadNothingOverdue") : t("home.leadChase", {}, overdue),
    proposals: out === 0 ? t("home.leadNoProposals") : t("home.leadProposals", {}, out),
  });

  return (
    <section className="screen ol-screen home" data-screen="home" aria-labelledby="home-lead">
      <div>
        <span className="home-date">{day === "" ? "" : todayLong(day, locale)}</span>
        <h1 className="home-lead" id="home-lead">
          {lead}
        </h1>
      </div>

      <div className="home-kpis">
        <div className="card card--pad ol-card">
          <Kicker icon={Wallet}>{t("home.outstanding")}</Kicker>
          <div className="stat-value">
            <Money value={figures.outstanding} currency={figures.currency} />
          </div>
          <div className="stat-sub">{t("home.outstandingSub", {}, figures.openCount)}</div>
        </div>
        <div className="card card--pad ol-card">
          <Kicker icon={ClockAlert}>{t("home.overdue")}</Kicker>
          <div className="stat-value home-danger">{figures.overdueCount}</div>
          <div className="stat-sub">{figures.overdueCount === 0 ? t("home.overdueNone") : t("home.overdueSub", {}, figures.oldestDays)}</div>
        </div>
        <div className="card card--pad ol-card">
          <Kicker icon={FolderKanban}>{t("home.active")}</Kicker>
          <div className="stat-value">{figures.active}</div>
          <div className="stat-sub">{figures.done === null ? t("home.activeSubNoDone", { paused: figures.paused }) : t("home.activeSub", { paused: figures.paused, done: figures.done })}</div>
        </div>
      </div>

      <div className="card home-aging" role="group" aria-labelledby="home-aging">
        <div className="home-aging-head">
          <span className="kicker" id="home-aging">
            {t("home.aging")}
          </span>
          <span className="home-aging-note">{t("home.agingNote")}</span>
        </div>
        <div className="home-aging-grid">
          {buckets.map((b) => (
            <button key={b.key} type="button" className={`home-bucket ol-chip home-bucket--${b.key}${b.count === 0 ? " home-bucket--empty" : ""}`} onClick={() => openInvoices(b.key)}>
              <span className="home-bucket-label">{t(`home.aging.${b.key}` as MessageKey)}</span>
              <span className="home-bucket-amount">{money(b.amount, figures.currency)}</span>
              <span className="home-bucket-count">{t("home.agingCount", {}, b.count)}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="home-cols">
        <section className="card home-panel" aria-labelledby="home-activity">
          <div className="home-panel-head">
            <Activity size={15} aria-hidden="true" />
            <h2 id="home-activity">{t("home.activity")}</h2>
          </div>
          {activity.length === 0 ? (
            <div className="home-none">{t("home.activityNone")}</div>
          ) : (
            <ul className="home-list" role="list">
              {activity.map((item) => {
                const look = FEED_LOOK[item.kind];
                const Icon = look.icon;
                const params = { ...item.params, ...(item.amount === undefined ? {} : { amount: money(item.amount.value, item.amount.currency) }) };
                return (
                  <li key={item.key}>
                    <button type="button" className="home-feed ol-row" onClick={() => goTo(item.go)}>
                      <span className={`home-feed-icon home-tone--${look.tone}`} aria-hidden="true">
                        <Icon size={14} />
                      </span>
                      <span className="home-feed-text">
                        <span className="home-feed-title">{t(`home.feed.${item.kind}.title` as MessageKey)}</span>
                        <span className="home-feed-body">{t(`home.feed.${item.kind}.body` as MessageKey, params)}</span>
                      </span>
                      <time className="home-feed-when" dateTime={item.at}>
                        {instantLabel(item.at, zone, locale, { day: "numeric", month: "short" })}
                      </time>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="home-side">
          <section className="card home-panel" aria-labelledby="home-waiting">
            <div className="home-panel-head">
              <Hourglass size={15} aria-hidden="true" />
              <h2 id="home-waiting">{t("home.waiting")}</h2>
            </div>
            {waits.length === 0 ? (
              <div className="home-none">{t("home.waitingNone")}</div>
            ) : (
              <ul className="home-list" role="list">
                {waits.map((w) => (
                  <li key={w.key} className="home-wait">
                    <span className="home-wait-text">
                      <span className="home-wait-client">{w.client}</span>
                      <span className="home-wait-what">
                        {t(`home.waiting.${w.kind}` as MessageKey, { ref: w.ref, balance: w.balance === undefined ? "" : money(w.balance.value, w.balance.currency) })}
                      </span>
                    </span>
                    <span className={`pill pill--mono ${w.days > 30 ? "pill--danger" : "pill--warn"}`}>
                      <span aria-hidden="true">{t("home.age", { count: w.days })}</span>
                      <span className="ol-sr-only">{t("home.ageLong", {}, w.days)}</span>
                    </span>
                    <button type="button" className="btn btn--small ol-gi home-open" aria-label={t("home.openLabel", { ref: w.ref })} onClick={() => goTo(w.go)}>
                      {t("home.open")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card home-panel" aria-labelledby="home-week">
            <div className="home-panel-head">
              <CalendarDays size={15} aria-hidden="true" />
              <h2 id="home-week">{t("home.week")}</h2>
            </div>
            {due.length === 0 ? (
              <div className="home-none">{t("home.weekNone")}</div>
            ) : (
              <ul className="home-list" role="list">
                {due.map((m) => (
                  <li key={m.key}>
                    <button type="button" className="home-week ol-row" onClick={() => goTo(m.go)}>
                      <span className="home-wait-text">
                        <span className="home-wait-client">
                          {m.kind === "invoice" ? t("home.week.invoice", { ref: m.title, balance: m.balance === undefined ? "" : money(m.balance.value, m.balance.currency) }) : m.title}
                        </span>
                        <span className="home-wait-what">{m.project === null ? m.company : t("home.week.project", { company: m.company, project: m.project })}</span>
                      </span>
                      <time className="home-day" dateTime={m.due}>
                        {dayLabel(m.due, locale, "weekday")}
                      </time>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </section>
  );
}
