/**
 * Enquiries: the studio's inbox of people who asked about work. A lead line
 * (how many are unanswered, how many came this month), "Log a call", the
 * filters with their counts and a jump to the next unanswered one; the list
 * on one side and the open enquiry on the other — who, what they said, a
 * reply drafted from its fit, and the four answers: start a proposal, send
 * the reply, park it for a month, or a polite no.
 *
 * Opening the screen reads the newest enquiries of every state (the desk's
 * open work holds only new and parked ones) and counts each filter.
 */
import { useEffect, useMemo, useState } from "react";
import { ArrowDown, CircleSlash, Clock, FilePlus, IdCard, Inbox, PhoneIncoming, Send } from "lucide-react";

import { Alert, Button, Empty, Filters, StatusPill, type FilterItem } from "../components/ui.tsx";
import type { Enquiry, EnquiryStatus, Id } from "../data/types.ts";
import type { ListCondition } from "../data/snapshotPort.ts";
import { venueDay, venueMidnight } from "../data/venueTime.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { dayLabel, instantLabel } from "../lib/dates.ts";
import { now, studioZone } from "../lib/clock.ts";
import { declineEnquiry, parkEnquiry, sendEnquiryReply } from "../state/actions.ts";
import { loadPage, useDesk, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { openSheet } from "../state/sheets.ts";
import { open, openComposer, toast } from "../state/ui.ts";
import { byReceived, ENQUIRY_FILTERS, ENQUIRY_WORD, firstName, inEnquiryFilter, nextUnanswered, replyFor, summary, type EnquiryFilter } from "./enquiries/model.ts";

/** How long ago something came in, in the page's language ("4 hours ago", "yesterday", "12 Jul"). */
function ago(at: string | null, locale: string, zone: string): string {
  if (at === null) return "";
  const ms = now() - Date.parse(at);
  if (!Number.isFinite(ms)) return "";
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return rtf.format(-Math.max(minutes, 0), "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, "hour");
  const days = Math.round(hours / 24);
  if (days < 7) return rtf.format(-days, "day");
  return instantLabel(at, zone, locale, { day: "numeric", month: "short" });
}

const COUNTED: readonly EnquiryStatus[] = ["new", "replied", "proposal", "parked", "declined"];

export default function Enquiries() {
  const { t, locale } = useI18n();
  const zone = studioZone();
  const today = useDesk((s) => s.today);
  const held = useRows("enquiries");
  const [filter, setFilter] = useState<EnquiryFilter>("all");
  const [openId, setOpenId] = useState<Id | null>(null);
  const [replies, setReplies] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<"reply" | "park" | "decline" | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Counts Adminium answered, when there are more enquiries than one page. */
  const [counts, setCounts] = useState<Partial<Record<EnquiryFilter | "month", number>> | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void loadPage("enquiries", { order: "received_at.desc", limit: 200, offset: 0, count: true })
      .then(async (page) => {
        if (!live) return;
        setTotal(page.total);
        if (page.total === null || page.total <= page.ids.length) return;
        // More than one page: each filter's count is Adminium's.
        const count = (where: ListCondition) => loadPage("enquiries", { where, limit: 1, offset: 0, count: true }).then((p) => p.total ?? 0);
        const monthStart = venueMidnight(`${today.slice(0, 7)}-01`, zone);
        const [month, ...byStatus] = await Promise.all([count({ column: "received_at", op: "gte", value: monthStart }), ...COUNTED.map((s) => count({ column: "status", op: "eq", value: s }))]);
        if (live) setCounts({ all: page.total, month, ...Object.fromEntries(COUNTED.map((s, i) => [s, byStatus[i]])) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [today, zone]);

  const list = useMemo(() => [...held].sort(byReceived), [held]);
  const shown = useMemo(() => list.filter((e) => inEnquiryFilter(e, filter)), [list, filter]);
  const monthPrefix = today.slice(0, 7);
  const heldCount = (f: EnquiryFilter) => list.filter((e) => inEnquiryFilter(e, f)).length;
  const countOf = (f: EnquiryFilter) => counts?.[f] ?? heldCount(f);
  const unanswered = countOf("new");
  const thisMonth = counts?.month ?? list.filter((e) => e.received_at !== null && venueDay(Date.parse(e.received_at), zone).startsWith(monthPrefix)).length;

  const current: Enquiry | undefined = list.find((e) => e.id === openId) ?? shown[0];
  const next = nextUnanswered(list, current?.id ?? null);

  const items: FilterItem<EnquiryFilter>[] = ENQUIRY_FILTERS.map((f) => ({ id: f, label: t(`enquiries.filter.${f}` as MessageKey), count: countOf(f) }));

  const replyText = current === undefined ? "" : (replies[current.id] ?? t(`enquiries.reply.${replyFor(current)}` as MessageKey, { first: firstName(current.name) }));

  async function act(kind: "reply" | "park" | "decline"): Promise<void> {
    if (current === undefined || busy !== null) return;
    setBusy(kind);
    setError(null);
    const first = firstName(current.name);
    if (kind === "reply") {
      const out = await sendEnquiryReply(current.id, { to: current.email ?? "", language: locale, subject: null, body: replyText });
      setBusy(null);
      if (!out.ok) return setError(t(refusalKey(out.reason), { id: current.number ?? "" }));
      toast(t("enquiries.toast.replied", { first }), { icon: "send" });
    } else if (kind === "park") {
      const out = await parkEnquiry(current.id);
      setBusy(null);
      if (!out.ok) return setError(t(refusalKey(out.reason), { id: current.number ?? "" }));
      toast(t("enquiries.toast.parked", { date: dayLabel(out.value.parked_until, locale, "short") }), { icon: "clock" });
    } else {
      const out = await declineEnquiry(current.id);
      setBusy(null);
      if (!out.ok) return setError(t(refusalKey(out.reason), { id: current.number ?? "" }));
      toast(t("enquiries.toast.declined"), { icon: "circle-slash" });
    }
  }

  const fitWord = current?.fit === "good" ? "good" : current?.fit === "maybe" ? "maybe" : current?.fit === "no" ? "no" : null;
  const noEmail = current !== undefined && (current.email === null || current.email.trim() === "");

  return (
    <section className="screen ol-screen enq" data-screen="enquiries" aria-labelledby="enq-title">
      <div className="screen-head">
        <div>
          <h1 className="screen-title enq-title" id="enq-title">
            {t("nav.enquiries")}
          </h1>
          <p className="screen-lead enq-lead">{t("enquiries.lead", { unanswered, month: thisMonth })}</p>
        </div>
        <Button kind="primary" icon={PhoneIncoming} onClick={() => openSheet({ kind: "add", what: "enquiry" })}>
          {t("enquiries.logCall")}
        </Button>
      </div>

      <div className="enq-bar">
        <Filters items={items} value={filter} onChange={(f) => setFilter(f)} label={t("enquiries.filters")} />
        <button
          type="button"
          className="btn btn--small ol-gi enq-next"
          onClick={() => {
            if (next === null) {
              toast(t("enquiries.nothingNew"), { icon: "check" });
              return;
            }
            setOpenId(next.id);
            setFilter("all");
          }}
        >
          <ArrowDown size={14} aria-hidden="true" />
          {unanswered > 0 ? t("enquiries.next", { count: unanswered }) : t("enquiries.allAnswered")}
        </button>
      </div>

      {total === 0 && list.length === 0 ? (
        <div className="card">
          <Empty icon={Inbox} title={t("enquiries.none")} body={t("enquiries.noneBody")} />
        </div>
      ) : (
        <div className="enq-cols">
          <section className="card enq-list" aria-label={t("enquiries.list")}>
            {shown.length === 0 ? (
              <Empty title={t("enquiries.empty")} body={t("enquiries.emptyBody")} />
            ) : (
              <ul role="list" className="enq-rows">
                {shown.map((e) => {
                  const on = e.id === current?.id;
                  return (
                    <li key={e.id}>
                      <button type="button" className={`enq-row ol-row${on ? " enq-row--on" : ""}`} aria-current={on ? "true" : undefined} onClick={() => setOpenId(e.id)}>
                        <span className={`enq-dot enq-dot--${e.fit ?? "none"}`} aria-hidden="true" />
                        <span className="enq-row-text">
                          <span className="enq-row-business">{e.business ?? e.name}</span>
                          <span className="enq-row-line">{summary(e)}</span>
                        </span>
                        <span className="enq-row-side">
                          <StatusPill status={ENQUIRY_WORD[e.status]} />
                          <time className="enq-row-when" dateTime={e.received_at ?? undefined}>
                            {e.received_at === null ? "" : instantLabel(e.received_at, zone, locale, { day: "numeric", month: "short" })}
                          </time>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {current !== undefined && (
            <section className="card enq-detail" aria-labelledby="enq-open">
              <div className="enq-detail-head">
                <div className="enq-detail-meta">
                  {current.number !== null && <span className="enq-number">{current.number}</span>}
                  <StatusPill status={ENQUIRY_WORD[current.status]} />
                  {fitWord !== null && <span className={`pill enq-fit enq-fit--${fitWord}`}>{t(`enquiries.fit.${fitWord}` as MessageKey)}</span>}
                  <time className="enq-ago" dateTime={current.received_at ?? undefined}>
                    {ago(current.received_at, locale, zone)}
                  </time>
                </div>
                <h2 className="enq-business" id="enq-open">
                  {current.business ?? current.name}
                </h2>
                <p className="enq-who">{[current.name, current.email].filter((x) => x !== null && x !== "").join(" · ")}</p>
              </div>
              <dl className="enq-facts">
                {(
                  [
                    ["budget", current.budget],
                    ["start", current.start_when],
                    ["source", current.source],
                  ] as const
                ).map(([key, value]) => (
                  <div key={key} className="enq-fact">
                    <dt>{t(`enquiries.${key}` as MessageKey)}</dt>
                    <dd>{value === null || value.trim() === "" ? t("enquiries.unknown") : value}</dd>
                  </div>
                ))}
              </dl>
              <div className="enq-detail-body">
                {current.body !== null && current.body.trim() !== "" && <p className="enq-body">{current.body}</p>}
                <div className="field">
                  <label className="kicker" htmlFor="enq-reply">
                    {t("enquiries.reply")}
                  </label>
                  <textarea
                    id="enq-reply"
                    className="input ol-fld enq-reply"
                    rows={4}
                    value={replyText}
                    aria-describedby={noEmail ? "enq-no-email" : undefined}
                    onChange={(e) => setReplies((r) => ({ ...r, [current.id]: e.target.value }))}
                  />
                  {noEmail && (
                    <span className="field-hint" id="enq-no-email">
                      {t("enquiries.noEmail")}
                    </span>
                  )}
                </div>
                {error !== null && <Alert>{error}</Alert>}
                <div className="enq-actions">
                  {current.status === "proposal" && current.client_id !== null ? (
                    <Button kind="primary" icon={IdCard} onClick={() => open("client", current.client_id as Id)}>
                      {t("enquiries.openClient")}
                    </Button>
                  ) : (
                    <Button kind="primary" icon={FilePlus} onClick={() => openComposer({ kind: "proposal", id: null, enquiryId: current.id })}>
                      {t("enquiries.startProposal")}
                    </Button>
                  )}
                  <Button icon={Send} busy={busy === "reply"} disabled={noEmail || replyText.trim() === "" || busy !== null} onClick={() => void act("reply")}>
                    {t("enquiries.sendReply")}
                  </Button>
                  <Button icon={Clock} busy={busy === "park"} disabled={busy !== null || current.status === "parked"} onClick={() => void act("park")}>
                    {t("enquiries.park")}
                  </Button>
                  <Button className="enq-no" icon={CircleSlash} busy={busy === "decline"} disabled={busy !== null || current.status === "declined"} onClick={() => void act("decline")}>
                    {t("enquiries.decline")}
                  </Button>
                </div>
                <p className="enq-foot">{t("enquiries.footnote")}</p>
              </div>
            </section>
          )}
        </div>
      )}
    </section>
  );
}
