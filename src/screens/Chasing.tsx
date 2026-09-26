/**
 * Chasing: the reminders about unpaid invoices, and nothing goes out until
 * someone says so.
 *
 * Every sent invoice has three rungs — a gentle nudge, a plainer one, and the
 * one that pauses the work — which Adminium made when the invoice was sent
 * and HOLDS, each due on its day of the invoice's ladder. A held rung whose
 * time has come is ready; the banner counts them (one per invoice: a later
 * rung overtakes an earlier one) and "Send all" approves exactly those.
 *
 * On the left, every open invoice, the latest first, and what its ladder is
 * doing; on the right, the one selected: which ladder it is on, how the client
 * has paid before, its three rungs — each with its wording, which may be
 * edited while it is held, approved, sent early or skipped — then what has
 * already been tried and what pausing would stop.
 *
 * Approving a rung queues it; Adminium sends it. The third rung pausing the
 * project is Adminium's too, the moment it is sent: the desk writes nothing
 * else.
 */
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, ArrowRight, ArrowUpRight, BellRing, Check, Circle, CircleDot, CircleSlash, ClockAlert, FileSignature, Hand, History, Mail, Pause, PencilLine, Phone, ReceiptText, RotateCcw, ScrollText, Send, SkipForward, ThumbsUp, UserRound } from "lucide-react";

import { Alert, Button, Pill, UnfinishedLine, type PillTone } from "../components/ui.tsx";
import type { Id, Invoice, InvoiceLadder, Message } from "../data/types.ts";
import { daysBetween } from "../data/venueTime.ts";
import { paramFormatter, useI18n, type LocaleTag } from "../i18n/index.tsx";
import { dirFor, LOCALE_TAGS } from "../i18n/locales.ts";
import { now, studioZone, today } from "../lib/clock.ts";
import { dayLabel } from "../lib/dates.ts";
import { emailWords } from "../manifest/emails.ts";
import { approveRung, editRung, readyRungs, sendAllReady, sendRungEarly, setLadder, skipRung, type Outcome } from "../state/actions.ts";
import { loadWhere, ensureRows, useDesk, useManager, useRows } from "../state/desk.ts";
import { refusalKey, type Unfinished } from "../state/outcome.ts";
import { go, open, toast, useUi } from "../state/ui.ts";
import { dayOf, fillTemplate, invoiceIdsOf, invoiceLine, mostLateFirst, nextWake, paragraphs, payHabit, RUNG_KINDS, rungsOf, type Rung } from "./chasing/rungs.ts";
import { daysOverdue, isOpen, sumByCurrency, sumsLabel } from "./invoices/figures.ts";
import { firstName, LADDERS } from "./invoices/words.ts";

const RUNG_ICON: Record<1 | 2 | 3, LucideIcon> = { 1: Mail, 2: BellRing, 3: Pause };

export default function Chasing() {
  const { t, number, money, locale } = useI18n();
  const day = useDesk((s) => s.today) || today();
  const at = now();
  const zone = studioZone();
  const manager = useManager();
  const invoices = useRows("invoices");
  const messages = useRows("messages");
  const clients = useDesk((s) => s.rows.clients);
  const projects = useDesk((s) => s.rows.projects);
  const milestones = useRows("milestones");
  const selectedOnDesk = useUi((s) => s.selected.invoice);

  const open_ = useMemo(() => invoices.filter(isOpen).sort(mostLateFirst), [invoices]);
  const [picked, setPicked] = useState<Id | null>(selectedOnDesk);
  const inv = open_.find((i) => i.id === picked) ?? open_[0] ?? null;
  const [sendAll, setSendAll] = useState<{ busy: boolean; unfinished: Unfinished<Message[]> | null; error: string | null }>({ busy: false, unfinished: null, error: null });

  // The rungs of every open invoice (sent and skipped ones too, for the lines and the record).
  const openIds = open_.map((i) => i.id).join(",");
  useEffect(() => {
    const ids = open_.map((i) => i.id);
    if (ids.length === 0) return;
    void Promise.all([
      loadWhere("messages", { and: [{ column: "invoice_id", op: "in", value: ids }, { column: "kind", op: "in", value: [...RUNG_KINDS] }] }, "due.asc", 500),
      ensureRows(
        "projects",
        open_.map((i) => i.project_id),
      ),
      ensureRows(
        "clients",
        open_.map((i) => i.client_id),
      ),
    ]).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIds]);

  // The selected invoice's project milestones, and how its client has paid before.
  const invId = inv?.id ?? null;
  useEffect(() => {
    if (inv === null) return;
    const reads: Promise<unknown>[] = [
      loadWhere("invoices", { and: [{ column: "client_id", op: "eq", value: inv.client_id }, { column: "status", op: "eq", value: "sent" }] }, "id.desc", 200).then((theirs) =>
        theirs.length === 0 ? [] : loadWhere("payments", { column: "document_id", op: "in", value: theirs.map((i) => i.id) }, "paid_on.asc", 1000),
      ),
    ];
    if (inv.project_id !== null) reads.push(loadWhere("milestones", { column: "project_id", op: "eq", value: inv.project_id }, "position.asc"));
    void Promise.all(reads).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invId]);

  const ready = useMemo(() => readyRungs(at), [messages, at]); // eslint-disable-line react-hooks/exhaustive-deps
  const readyIds = invoiceIdsOf(ready);
  const numberOf = (id: Id) => invoices.find((i) => i.id === id)?.number ?? "";
  const list = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
  const wake = nextWake(open_, messages, at, zone);

  const runSendAll = async (run: () => Promise<Outcome<Message[]>>) => {
    setSendAll({ busy: true, unfinished: null, error: null });
    const out = await run();
    if (out.ok) {
      setSendAll({ busy: false, unfinished: null, error: null });
      toast(t("chasing.sentAll", { n: number(out.value.length) }, out.value.length), { icon: "send" });
    } else setSendAll({ busy: false, unfinished: out.unfinished, error: t(refusalKey(out.reason)) });
  };

  const tone = ready.length > 0 ? "warn" : "pos";

  return (
    <section className="screen ol-screen ch-screen" data-screen="chasing" aria-labelledby="chasing-title">
      <div>
        <h1 className="screen-title ch-title" id="chasing-title">
          {t("chasing.title")}
        </h1>
        <p className="screen-lead ch-lead">{t("chasing.lead")}</p>
      </div>

      <div className="card ch-banner" role="status">
        <span className={`ch-banner-dot ch-banner-dot--${tone}`} aria-hidden="true">
          <BellRing size={15} />
        </span>
        <span className="ch-banner-text">
          <span className="ch-banner-label">{ready.length === 0 ? t("chasing.ready.none") : t("chasing.ready.some", { n: number(ready.length) }, ready.length)}</span>
          <span className="ch-banner-sub">
            {ready.length > 0
              ? t("chasing.ready.on", { ids: list(readyIds.map(numberOf)) })
              : wake !== null
                ? t("chasing.ready.next", { day: dayLabel(wake.rung.dueDay, locale), rung: t(`chasing.rung.${wake.rung.no}`), id: wake.invoice.number ?? "" })
                : t("chasing.ready.inTerms")}
          </span>
        </span>
        <Button kind="primary" icon={Send} className="ch-banner-send" busy={sendAll.busy} disabled={ready.length === 0} onClick={() => void runSendAll(() => sendAllReady(now()))}>
          {ready.length === 0 ? t("chasing.send.nothing") : ready.length === 1 ? t("chasing.send.one") : t("chasing.send.all", { n: number(ready.length) })}
        </Button>
      </div>
      {sendAll.error !== null && sendAll.unfinished === null && <Alert>{sendAll.error}</Alert>}
      {sendAll.unfinished !== null && <UnfinishedLine unfinished={sendAll.unfinished} busy={sendAll.busy} onFinish={() => void runSendAll(() => sendAll.unfinished!.resume())} />}

      <div className="ch-cols">
        <section className="card ch-list" aria-labelledby="ch-list-h" id="ch-list">
          <div className="ch-panel-head">
            <ReceiptText size={15} aria-hidden="true" className="ch-panel-icon" />
            <h2 className="ch-panel-title" id="ch-list-h">
              {t("chasing.list.title")}
            </h2>
            <span className="ch-panel-count money">{sumsLabel(sumByCurrency(open_, (i) => i.balance), money)}</span>
          </div>
          <ul role="list" className="ch-invs">
            {open_.map((x) => {
              const late = daysOverdue(x, day);
              const line = invoiceLine(rungsOf(x, messages, at, zone));
              return (
                <li key={x.id}>
                  <button type="button" className="ch-inv ol-row" aria-current={inv?.id === x.id ? "true" : undefined} onClick={() => setPicked(x.id)}>
                    <span className="ch-inv-main">
                      <span className="ch-inv-top">
                        <span className="ch-inv-id">{x.number ?? ""}</span>
                        {late > 0 ? (
                          <Pill tone={late > 30 ? "danger" : "warn"} mono>
                            {t("chasing.list.late", { n: number(late) }, late)}
                          </Pill>
                        ) : (
                          <Pill mono>{t("chasing.list.due", { day: dayLabel(x.due_on, locale) })}</Pill>
                        )}
                      </span>
                      <span className="ch-inv-client">{clients[x.client_id]?.company ?? ""}</span>
                      <span className="ch-inv-line">
                        {line.kind === "waiting"
                          ? t("chasing.line.waiting", { rung: t(`chasing.rung.${line.rung}`) })
                          : line.kind === "queued"
                            ? t("chasing.line.queued", { rung: t(`chasing.rung.${line.rung}`) })
                            : line.kind === "allSent"
                            ? t("chasing.line.allSent")
                            : line.kind === "next"
                              ? t("chasing.line.next", { rung: t(`chasing.rung.${line.rung}`), n: number(line.wait) }, line.wait)
                              : t("chasing.line.nothing")}
                      </span>
                    </span>
                    <span className="ch-inv-bal money">{money(x.balance, x.currency)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="ch-panel-foot">{open_.length > 0 ? t("chasing.list.foot") : t("chasing.list.none")}</p>
        </section>

        {inv === null ? (
          <NothingOpen />
        ) : (
          <InvoiceLadderPanel key={inv.id} inv={inv} manager={manager} messages={messages} at={at} zone={zone} day={day} clients={clients} projects={projects} />
        )}
      </div>

      {inv !== null && (
        <div className="ch-lower">
          <Tried inv={inv} messages={messages} at={at} zone={zone} day={day} />
          <Stops inv={inv} manager={manager} project={inv.project_id === null ? null : (projects[inv.project_id] ?? null)} milestones={milestones} />
        </div>
      )}
    </section>
  );
}

function NothingOpen() {
  const { t } = useI18n();
  return (
    <section className="card ch-detail" aria-labelledby="ch-doc-h">
      <div className="ch-doc-head">
        <span className="ch-doc-titles">
          <h2 className="ch-doc-title" id="ch-doc-h">
            {t("chasing.none.title")}
          </h2>
          <span className="ch-doc-sub">{t("chasing.none.sub")}</span>
        </span>
        <Button size="small" icon={ArrowUpRight} onClick={() => go("invoices")}>
          {t("nav.invoices")}
        </Button>
      </div>
      <div className="ch-foot">
        <Check size={15} aria-hidden="true" />
        <span>{t("chasing.none.foot")}</span>
      </div>
    </section>
  );
}

interface PanelProps {
  inv: Invoice;
  manager: boolean;
  messages: readonly Message[];
  at: number;
  zone: string;
  day: string;
  clients: Record<Id, { company: string; contact_name: string; email: string; language: string | null }>;
  projects: Record<Id, { number: string | null; name: string; status: string }>;
}

/** The selected invoice: its ladder, its client's habit, its three rungs. */
function InvoiceLadderPanel({ inv, manager, messages, at, zone, day, clients, projects }: PanelProps) {
  const { t, number, money, locale } = useI18n();
  const invoices = useRows("invoices");
  const payments = useRows("payments");
  const settings = useDesk((s) => Object.values(s.rows.settings)[0] ?? null);
  const client = clients[inv.client_id];
  const project = inv.project_id === null ? null : (projects[inv.project_id] ?? null);
  const rungs = rungsOf(inv, messages, at, zone);
  const late = daysOverdue(inv, day);
  const ladder: InvoiceLadder = inv.ladder ?? "standard";
  const days = rungs.every((r) => r.day !== null) ? rungs.map((r) => number(r.day!)).join(" / ") : null;
  const habit = payHabit(inv.client_id, invoices, payments);
  const first = firstName(client?.contact_name);
  const [error, setError] = useState<string | null>(null);

  // The email's own words, in the client's language (else the page's).
  const tag: LocaleTag = (LOCALE_TAGS as readonly string[]).includes(client?.language ?? "") ? (client!.language as LocaleTag) : locale;
  const words = emailWords()[tag];
  const values: Record<string, string> = {
    "invoice.number": inv.number ?? "",
    "invoice.title": inv.title ?? "",
    "invoice.balance": money(inv.balance, inv.currency),
    "invoice.total": money(inv.total, inv.currency),
    "invoice.due_on": dayLabel(inv.due_on, tag, "long"),
    "invoice.due_on.days_since": paramFormatter(tag)(Math.max(0, late)),
    "project.name": project?.name ?? t("chasing.theWork"),
    "project.number": project?.number ?? "",
    "recipient.first_name": first,
    "client.company": client?.company ?? "",
    "client.contact_name": client?.contact_name ?? "",
    "practice.name": settings?.name ?? "",
    "practice.sign_off": settings?.sign_off ?? settings?.name ?? "",
  };

  const changeLadder = async (next: InvoiceLadder) => {
    if (next === ladder) return;
    setError(null);
    const out = await setLadder(inv.id, next);
    if (out.ok) toast(t("chasing.ladder.toast", { ladder: t(`invoices.ladder.${next}`), id: inv.number ?? "" }), { icon: "bell-ring" });
    else setError(t(refusalKey(out.reason), { id: inv.number ?? "" }));
  };

  const anyReady = rungs.some((r) => r.state === "ready");
  const allSent = rungs.every((r) => r.state === "sent");
  const foot: { icon: LucideIcon; text: string } =
    late <= 0
      ? { icon: ClockAlert, text: rungs[0]!.day === null ? t("chasing.foot.notDueNoDay", { id: inv.number ?? "", day: dayLabel(inv.due_on, locale, "long") }) : t("chasing.foot.notDue", { id: inv.number ?? "", day: dayLabel(inv.due_on, locale, "long"), n: number(rungs[0]!.day!) }, rungs[0]!.day!) }
      : anyReady
        ? { icon: Hand, text: t("chasing.foot.ready") }
        : allSent
          ? { icon: Phone, text: t("chasing.foot.allSent") }
          : { icon: BellRing, text: t("chasing.foot.carryOn") };
  const Foot = foot.icon;

  const settled = habit.settled > 0 && habit.average !== null;
  const HabitIcon = settled && habit.average! <= 0 ? ThumbsUp : settled && habit.average! > 7 ? ClockAlert : UserRound;
  const habitTone = settled && habit.average! <= 0 ? "pos" : settled && habit.average! > 7 ? "warn" : "subtle";
  const habitBody = settled
    ? habit.average! > 0
      ? t("chasing.habit.late", { settled: number(habit.settled), total: number(habit.total), n: number(habit.average!) }, habit.average!)
      : habit.average! < 0
        ? t("chasing.habit.early", { settled: number(habit.settled), total: number(habit.total), n: number(-habit.average!) }, -habit.average!)
        : t("chasing.habit.onTime", { settled: number(habit.settled), total: number(habit.total) })
    : habit.total > 1
      ? t("chasing.habit.none", { total: number(habit.total) }, habit.total)
      : t("chasing.habit.first");

  return (
    <section className="card ch-detail" aria-labelledby="ch-doc-h">
      <a className="ch-back-list" href="#ch-list">
        <ArrowLeft size={14} aria-hidden="true" />
        {t("chasing.backToList")}
      </a>
      <div className="ch-doc-head">
        <span className="ch-doc-titles">
          <h2 className="ch-doc-title" id="ch-doc-h">
            {t("chasing.doc.title", { id: inv.number ?? "", company: client?.company ?? "" })}
          </h2>
          <span className="ch-doc-sub">
            {late > 0
              ? t("chasing.doc.subLate", { balance: money(inv.balance, inv.currency), n: number(late), title: inv.title ?? "" }, late)
              : t("chasing.doc.subDue", { balance: money(inv.balance, inv.currency), day: dayLabel(inv.due_on, locale, "long"), title: inv.title ?? "" })}
          </span>
        </span>
        <Button size="small" icon={ArrowUpRight} onClick={() => open("invoice", inv.id)}>
          {t("chasing.doc.open")}
        </Button>
      </div>

      <div className="ch-ladder">
        <span className="ch-ladder-k" id="ch-ladder-k">
          {t("chasing.ladder.label")}
        </span>
        <div className="ch-seg" role="group" aria-labelledby="ch-ladder-k">
          {LADDERS.map((l) => (
            <button key={l} type="button" className="ch-seg-chip ol-chip" aria-pressed={ladder === l} onClick={() => void changeLadder(l)}>
              {t(`invoices.ladder.${l}`)}
              {ladder === l && days !== null && <span className="ch-seg-days">{days}</span>}
            </button>
          ))}
        </div>
        <span className="ch-ladder-note">{t(`chasing.ladder.note.${ladder}`)}</span>
        {manager && (
          <Button size="small" className="ch-ladder-settings" onClick={() => go("settings")}>
            {t("chasing.ladder.change")}
            <ArrowRight size={13} aria-hidden="true" className="ch-flip" />
          </Button>
        )}
      </div>
      {error !== null && <Alert>{error}</Alert>}

      <div className="ch-habit">
        <HabitIcon size={16} aria-hidden="true" className={`ch-habit-icon ch-tone--${habitTone}`} />
        <span className="ch-habit-text">
          <span className="ch-habit-title">{t("chasing.habit.title", { company: client?.company ?? "" })}</span>
          <span className="ch-habit-body">{habitBody}</span>
        </span>
      </div>

      <ol className="ch-rungs">
        {rungs.map((r, i) => (
          <RungRow key={r.no} rung={r} last={i === rungs.length - 1} inv={inv} words={words} emailTag={tag} values={values} first={first} project={project} locale={locale} />
        ))}
      </ol>

      <div className="ch-foot">
        <Foot size={15} aria-hidden="true" />
        <span>{foot.text}</span>
      </div>
    </section>
  );
}

type RungWords = ReturnType<typeof emailWords>["en-US"];

function RungRow({ rung, last, inv, words, emailTag, values, first, project, locale }: { rung: Rung; last: boolean; inv: Invoice; words: RungWords; emailTag: LocaleTag; values: Record<string, string>; first: string; project: { number: string | null; name: string; status: string } | null; locale: LocaleTag }) {
  const { t, number } = useI18n();
  const m = rung.message;
  const template = words[RUNG_KINDS[rung.no - 1]!];
  const subject = m?.subject_override ?? fillTemplate(template.subject, values);
  const body = m?.body_override != null ? paragraphs(m.body_override) : template.paras.map((p) => fillTemplate(p, values));
  const held = rung.state === "ready" || rung.state === "waiting";
  const [editing, setEditing] = useState<{ subject: string; body: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = async (name: string, run: () => Promise<Outcome<unknown>>, done: string) => {
    setBusy(name);
    setError(null);
    const out = await run();
    setBusy(null);
    if (out.ok) {
      setEditing(null);
      toast(done, { icon: name === "skip" ? "skip-forward" : "send" });
    } else setError(t(refusalKey(out.reason), { id: inv.number ?? "" }));
  };

  const edited = editing === null ? undefined : { subject: editing.subject.trim() === subject.trim() && m?.subject_override == null ? null : editing.subject, body: editing.body.trim() === body.join("\n\n").trim() && m?.body_override == null ? null : editing.body };

  const approve = () => void act("send", () => (m === null ? Promise.resolve(nope()) : approveRung(m.id, edited)), t("chasing.toast.sent", { first }));
  const early = () =>
    void act(
      "send",
      async () => {
        if (m === null) return nope();
        if (edited !== undefined) {
          const saved = await editRung(m.id, edited);
          if (!saved.ok) return saved;
        }
        return sendRungEarly(m.id, now());
      },
      t("chasing.toast.sent", { first }),
    );
  const skip = () => void act("skip", () => (m === null ? Promise.resolve(nope()) : skipRung(m.id)), t("chasing.toast.skipped"));
  const retry = () => void act("send", () => (m === null ? Promise.resolve(nope()) : approveRung(m.id)), t("chasing.toast.retry"));
  const keep = () => void act("keep", () => (m === null || edited === undefined ? Promise.resolve(nope()) : editRung(m.id, edited)), t("chasing.toast.kept"));
  const original = () => void act("keep", () => (m === null ? Promise.resolve(nope()) : editRung(m.id, { subject: null, body: null })), t("chasing.toast.original"));

  const pill: { tone: PillTone; text: string } =
    rung.state === "sent"
      ? { tone: "pos", text: t("chasing.state.sent", { day: m?.sent_at == null ? "" : dayLabel(dayOf(m.sent_at, studioZone()), locale) }) }
      : rung.state === "ready"
        ? { tone: "warn", text: t("chasing.state.ready") }
        : rung.state === "waiting"
          ? { tone: "neutral", text: t("chasing.state.waiting", { n: number(rung.wait) }, rung.wait) }
          : rung.state === "queued"
            ? { tone: "info", text: t("status.queued") }
            : rung.state === "skipped"
              ? { tone: "neutral", text: t("status.skipped") }
              : rung.state === "failed"
                ? { tone: "danger", text: t("chasing.state.failed") }
                : { tone: "neutral", text: t("chasing.state.none") };

  const metas: string[] = [];
  if (rung.state === "sent" && m !== null) metas.push(t("chasing.meta.sent", { day: m.sent_at == null ? "" : dayLabel(dayOf(m.sent_at, studioZone()), locale, "long"), to: m.to ?? "" }));
  if (rung.state === "skipped" && m !== null) metas.push(t(`chasing.meta.skipped.${m.skip_reason ?? "by-hand"}`, { n: rung.no + 1 }));
  if (rung.state === "waiting") metas.push(t("chasing.meta.waiting", { day: dayLabel(rung.dueDay, locale), n: number(rung.day ?? 0) }));
  if (rung.state === "queued") metas.push(t("chasing.meta.queued"));
  if (rung.state === "failed") metas.push(t("chasing.meta.failed", { error: m?.error ?? "" }));
  if (rung.state === "none") metas.push(t("chasing.meta.none"));
  if (rung.no === 3 && project !== null && rung.state !== "sent" && rung.state !== "skipped") {
    metas.push(project.status === "active" ? t("chasing.meta.pauses", { project: project.number ?? project.name }) : t(`chasing.meta.already.${project.status === "done" ? "done" : "paused"}`, { project: project.number ?? project.name }));
  }

  const dotTone = rung.state === "sent" ? "pos" : rung.state === "ready" ? "accent" : rung.state === "failed" ? "danger" : "muted";
  const Icon = RUNG_ICON[rung.no];
  const editorId = `ch-edit-${String(rung.no)}`;

  return (
    <li className={`ch-rung${last ? " ch-rung--last" : ""}`}>
      <span className="ch-spine" aria-hidden="true">
        <span className={`ch-dot ch-dot--${dotTone}`}>
          <Icon size={15} />
        </span>
      </span>
      <div className="ch-rung-main">
        <div className="ch-rung-top">
          <span className="ch-rung-day">{rung.day === null ? "—" : t("chasing.day", { n: number(rung.day) })}</span>
          <h3 className="ch-rung-title">{t(`chasing.rung.${rung.no}`)}</h3>
          <Pill tone={pill.tone}>{pill.text}</Pill>
        </div>
        {editing === null ? (
          <>
            <span className="ch-rung-subject" lang={emailTag} dir={dirFor(emailTag)}>
              {subject}
            </span>
            {held && (
              <div className="ch-rung-body" lang={emailTag} dir={dirFor(emailTag)}>
                <p>{fillTemplate(words.greeting, values)}</p>
                {body.map((p, k) => (
                  <p key={k}>{p}</p>
                ))}
                <p>{values["practice.sign_off"]}</p>
              </div>
            )}
          </>
        ) : (
          <div className="ch-editor">
            <label className="ch-editor-label" htmlFor={`${editorId}-s`}>
              {t("chasing.edit.subject")}
            </label>
            <input id={`${editorId}-s`} lang={emailTag} dir={dirFor(emailTag)} className="input ol-fld" value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} />
            <label className="ch-editor-label" htmlFor={`${editorId}-b`}>
              {t("chasing.edit.body")}
            </label>
            <textarea id={`${editorId}-b`} lang={emailTag} dir={dirFor(emailTag)} className="input ol-fld ch-editor-body" rows={7} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
            <span className="ch-editor-hint">{t("chasing.edit.hint")}</span>
          </div>
        )}
        {(held || rung.state === "failed") && (
          <div className="ch-rung-actions">
            {rung.state === "ready" && (
              <Button kind="primary" size="small" icon={Send} busy={busy === "send"} onClick={approve}>
                {t("chasing.act.approve")}
              </Button>
            )}
            {rung.state === "waiting" && (
              <Button size="small" icon={Send} className="ch-btn-dark" busy={busy === "send"} onClick={early}>
                {t("chasing.act.early")}
              </Button>
            )}
            {rung.state === "failed" && (
              <Button kind="primary" size="small" icon={RotateCcw} busy={busy === "send"} onClick={retry}>
                {t("common.retry")}
              </Button>
            )}
            {held &&
              (editing === null ? (
                <Button size="small" icon={PencilLine} onClick={() => setEditing({ subject, body: body.join("\n\n") })}>
                  {t("chasing.act.edit")}
                </Button>
              ) : (
                <>
                  <Button size="small" icon={Check} busy={busy === "keep"} onClick={keep}>
                    {t("chasing.act.keep")}
                  </Button>
                  <Button size="small" onClick={() => setEditing(null)}>
                    {t("common.cancel")}
                  </Button>
                </>
              ))}
            {held && editing === null && (m?.subject_override != null || m?.body_override != null) && (
              <Button size="small" icon={RotateCcw} busy={busy === "keep"} onClick={original}>
                {t("chasing.act.original")}
              </Button>
            )}
            {held && (
              <Button size="small" icon={SkipForward} className="ch-btn-dashed" busy={busy === "skip"} onClick={skip}>
                {t("chasing.act.skip")}
              </Button>
            )}
          </div>
        )}
        {error !== null && <Alert>{error}</Alert>}
        {metas.length > 0 && <span className="ch-rung-meta">{metas.join(" ")}</span>}
      </div>
    </li>
  );
}

const nope = <T,>(): Outcome<T> => ({ ok: false, reason: "gone", code: "NOT_FOUND", field: null, details: {}, unfinished: null });

/** What has already been tried on this invoice: the rungs sent and skipped. */
function Tried({ inv, messages, at, zone, day }: { inv: Invoice; messages: readonly Message[]; at: number; zone: string; day: string }) {
  const { t, number, locale } = useI18n();
  const rungs = rungsOf(inv, messages, at, zone).filter((r) => r.state === "sent" || r.state === "skipped");
  return (
    <section className="card ch-panel" aria-labelledby="ch-tried-h">
      <div className="ch-panel-head">
        <History size={15} aria-hidden="true" className="ch-panel-icon" />
        <h2 className="ch-panel-title" id="ch-tried-h">
          {t("chasing.tried.title")}
        </h2>
        <span className="ch-panel-count">{rungs.length === 0 ? t("chasing.tried.nothing") : t("chasing.tried.count", { n: number(rungs.length) })}</span>
      </div>
      {rungs.length === 0 ? (
        <p className="ch-panel-empty">{t("chasing.tried.empty", { id: inv.number ?? "" })}</p>
      ) : (
        <ul role="list" className="ch-tried">
          {rungs.map((r) => {
            const sentDay = r.message?.sent_at == null ? null : dayOf(r.message.sent_at, zone);
            const ago = sentDay === null ? 0 : Math.max(0, daysBetween(sentDay, day));
            return (
              <li key={r.no} className="ch-tried-row">
                <span className="ch-tried-on">{sentDay === null ? "—" : dayLabel(sentDay, locale)}</span>
                <span className="ch-tried-main">
                  <span className="ch-tried-what">{r.state === "skipped" ? t("chasing.tried.skipped", { rung: t(`chasing.rung.${r.no}`) }) : t(`chasing.rung.${r.no}`)}</span>
                  <span className="ch-tried-result">
                    {r.state === "skipped" ? t(`chasing.meta.skipped.${r.message?.skip_reason ?? "by-hand"}`, { n: r.no + 1 }) : ago === 0 ? t("chasing.tried.today") : t("chasing.tried.ago", { n: number(ago) }, ago)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="ch-panel-foot">{rungs.length === 0 ? t("chasing.tried.footNone") : t("chasing.tried.foot")}</p>
    </section>
  );
}

/** What pausing would stop: the project's next open milestones, or that there is nothing to pause. */
function Stops({ inv, manager, project, milestones }: { inv: Invoice; manager: boolean; project: { number: string | null; name: string } | null; milestones: readonly { project_id: Id; title: string; state: string; due_on: string | null; position: number; id: Id }[] }) {
  const { t, locale } = useI18n();
  const open = project === null ? [] : milestones.filter((m) => m.project_id === inv.project_id && m.state !== "done").sort((a, b) => a.position - b.position || a.id - b.id).slice(0, 3);
  return (
    <section className="card ch-panel" aria-labelledby="ch-stops-h">
      <div className="ch-panel-head">
        <Pause size={15} aria-hidden="true" className="ch-panel-icon" />
        <h2 className="ch-panel-title" id="ch-stops-h">
          {t("chasing.stops.title")}
        </h2>
      </div>
      <ul role="list" className="ch-stops">
        {project === null ? (
          <li className="ch-stop">
            <span className="ch-stop-dot ch-stop-dot--muted" aria-hidden="true">
              <CircleSlash size={13} />
            </span>
            <span className="ch-stop-main">
              <span className="ch-stop-title">{t("chasing.stops.noProject", { id: inv.number ?? "" })}</span>
              <span className="ch-stop-sub">{t("chasing.stops.noProjectSub")}</span>
            </span>
            <span className="ch-stop-v">—</span>
          </li>
        ) : (
          open.map((m) => (
            <li key={m.id} className="ch-stop">
              <span className={`ch-stop-dot ch-stop-dot--${m.state === "now" ? "warn" : "muted"}`} aria-hidden="true">
                {m.state === "now" ? <CircleDot size={13} /> : <Circle size={13} />}
              </span>
              <span className="ch-stop-main">
                <span className="ch-stop-title">{m.title}</span>
                <span className="ch-stop-sub">{m.state === "now" ? t("chasing.stops.inHand") : t("chasing.stops.notStarted")}</span>
              </span>
              <span className="ch-stop-v">{m.due_on === null ? "" : t("chasing.stops.due", { day: dayLabel(m.due_on, locale) })}</span>
            </li>
          ))
        )}
      </ul>
      <div className="ch-foot">
        <ScrollText size={15} aria-hidden="true" />
        <span className="ch-stops-foot">
          <span>{project === null ? t("chasing.stops.footNone") : t("chasing.stops.foot", { project: project.number ?? project.name })}</span>
          {manager && (
            <Button size="small" icon={FileSignature} onClick={() => go("terms")}>
              {t("chasing.stops.terms")}
            </Button>
          )}
        </span>
      </div>
    </section>
  );
}
