/**
 * The scoping worksheet: the screen before a proposal. Who it is for and the
 * stage; hours against the rate card; the expenses already known to be
 * coming; how the last stages actually went, with a reserve for the usual
 * overrun; and the price that falls out of it — with three checks (studio
 * days, the effective day rate, months of running costs) and how it gets paid.
 *
 * A calculator: nothing on the sheet is stored. Every figure on it is a
 * running estimate from the studio's own rows. "Turn this into a proposal"
 * saves ONE proposal draft with a line per rate (and, with the reserve on, a
 * reserve line per rate — the same rate, a held quantity), then opens it in
 * the composer; its amounts, tax and totals are Adminium's.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, Building2, Check, Eraser, History, Minus, PenTool, Plus, Ruler, SquarePen, Timer, Wallet, X } from "lucide-react";

import { Alert, UnfinishedLine } from "../components/ui.tsx";
import type { Id, Proposal } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { useAddOnSettings, useCan, useDesk, useRows, useSettings } from "../state/desk.ts";
import { refusalKey, type Outcome, type Unfinished } from "../state/outcome.ts";
import { turnIntoProposal, workSheet, type Worksheet, type WorksheetInputs } from "../state/scoping.ts";
import { openComposer, toast } from "../state/ui.ts";
import {
  addExpense,
  addRate,
  CHIP_LIMIT,
  dayRateOnCard,
  driftPct,
  driftTone,
  dropExpense,
  dropRow,
  editExpense,
  estimateTax,
  hoursWords,
  oneDecimal,
  overPct,
  overTone,
  refusedWords,
  shown,
  SPLIT_PARTS,
  SPLITS,
  startAgain,
  stepRow,
  studioWeek,
  thinRate,
  typeRow,
} from "./scoping/model.ts";
import { loadWorksheet } from "./scoping/reads.ts";
import { editSheet, useWorksheet } from "./scoping/store.ts";

/** Where the page's own reads are: under way, done (with the finished stages the history shows), or failed. */
export type Reading = { state: "loading" } | { state: "ready"; past: Id[] } | { state: "failed" };

/** A card of the worksheet: an icon, its heading, what sits at the end of the heading, then its body. */
function ScopeCard({ icon: Icon, title, end, children, strong = false }: { icon: LucideIcon; title: ReactNode; end?: ReactNode; children: ReactNode; strong?: boolean }) {
  const id = useId();
  return (
    <section className={`scope-card${strong ? " scope-card--strong" : ""}`} aria-labelledby={id}>
      <div className="scope-card-head">
        <Icon size={15} aria-hidden="true" />
        <h2 id={id}>{title}</h2>
        {end}
      </div>
      {children}
    </section>
  );
}

/** The screen: it reads what the worksheet shows when it opens, then draws it. */
export default function Scoping() {
  const [reading, setReading] = useState<Reading>({ state: "loading" });
  const read = () => {
    setReading({ state: "loading" });
    loadWorksheet().then(
      (past) => setReading({ state: "ready", past }),
      () => setReading({ state: "failed" }),
    );
  };
  useEffect(read, []);
  return <ScopingPage reading={reading} onRetry={read} />;
}

/** The worksheet, drawn from the sheet in memory and the rows the desk holds. */
export function ScopingPage({ reading, onRetry }: { reading: Reading; onRetry: () => void }) {
  const { t, money, number } = useI18n();
  const sheet = useWorksheet((s) => s.sheet);
  const settings = useSettings();
  const rateRows = useRows("rates");
  const peopleRows = useRows("people");
  const clientRows = useRows("clients");
  const costs = useRows("running_costs");
  const milestones = useDesk((s) => s.rows.milestones);
  const timeRows = useRows("time_entries");
  const projects = useDesk((s) => s.rows.projects);
  const clientsById = useDesk((s) => s.rows.clients);
  const proposals = useRows("proposals");
  const invoices = useRows("invoices");
  const addOn = useAddOnSettings("invoices");
  const canWrite = useCan("proposals", "create");

  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished<Proposal> | null>(null);

  const rates = useMemo(() => rateRows.filter((r) => r.active).sort((a, b) => a.position - b.position || a.id - b.id), [rateRows]);
  const clients = useMemo(() => [...clientRows].sort((a, b) => a.company.localeCompare(b.company)), [clientRows]);
  const client = sheet.clientId === null ? undefined : clientsById[sheet.clientId];
  const tax = estimateTax(client, addOn, [...proposals, ...invoices], clientsById);

  const inputs: WorksheetInputs = useMemo(() => {
    const past = reading.state === "ready" ? reading.past : [];
    return {
      rates,
      settings,
      people: peopleRows,
      runningCosts: costs,
      // The history is the finished stages this page read, newest first.
      milestones: past.flatMap((id) => (milestones[id] === undefined ? [] : [milestones[id]!])),
      time: timeRows,
      taxRate: tax.rate,
    };
  }, [rates, settings, peopleRows, costs, milestones, timeRows, tax.rate, reading]);

  const f = workSheet(sheet, inputs);
  const view = shown(f, settings?.hours_per_day);
  const week = studioWeek(peopleRows, settings);
  const cardRate = dayRateOnCard(rates, settings?.hours_per_day);
  const thin = thinRate(view.dayRate, cardRate);
  const monthly = costs.reduce((sum, c) => sum + Number(c.monthly_amount), 0);
  const drift = f.drift;
  const reserveOn = f.contingency > 0;

  const hours = (h: number) => {
    const w = hoursWords(h);
    return t(w.key, { n: number(w.n) });
  };
  const days1 = (d: number) => number(oneDecimal(d));
  const change = (next: (s: Worksheet) => Worksheet) => {
    setRefused(null);
    setUnfinished(null);
    editSheet(next);
  };

  const finishTurn = async (run: () => Promise<Outcome<Proposal>>) => {
    setBusy(true);
    setRefused(null);
    const out = await run();
    setBusy(false);
    if (out.ok) {
      setUnfinished(null);
      const lines = Object.values(useDesk.getState().rows.proposal_lines).filter((l) => l.document_id === out.value.id).length;
      openComposer({ kind: "proposal", id: out.value.id });
      toast(t("scoping.toast.turned", { count: lines }, lines));
      return;
    }
    setUnfinished(out.unfinished ?? null);
    const own = refusedWords(out.code);
    setRefused(own !== null ? t(own) : t(refusalKey(out.reason), { id: "", balance: "" }));
  };
  const onTurn = () => void finishTurn(() => turnIntoProposal(sheet, inputs, { contingencyWords: (label) => t("scoping.reserveLine", { label }) }));

  const splitShares = SPLIT_PARTS[sheet.split];
  const stageAmounts = f.stages;
  const pastRows = f.past;

  return (
    <section className="screen ol-screen scope-screen" data-screen="scoping" aria-labelledby="scoping-title">
      <div className="scope-head">
        <h1 className="scope-title" id="scoping-title">
          {t("screen.scoping")}
        </h1>
        <p className="scope-lead">{t("scoping.lead")}</p>
        <p className="scope-kept">{t("scoping.kept")}</p>
      </div>

      <div className="scope-cols">
        <div className="scope-col">
          {/* Who it is for, and the stage. */}
          <ScopeCard icon={PenTool} title={t("scoping.what.title")}>
            <div className="scope-what">
              <ClientPick clients={clients} value={sheet.clientId} onPick={(id) => change((s) => ({ ...s, clientId: id }))} />
              <StageField value={sheet.stage} onChange={(stage) => change((s) => ({ ...s, stage }))} />
            </div>
          </ScopeCard>

          {/* Hours against the rate card. */}
          <ScopeCard
            icon={Timer}
            title={t("scoping.hours.title")}
            end={<span className="scope-head-mono">{f.hours > 0 ? t("scoping.hours.label", { hours: hours(f.hours), days: days1(view.days) }, oneDecimal(view.days)) : t("scoping.hours.none")}</span>}
          >
            {sheet.rows.length === 0 ? (
              <p className="scope-empty">{t("scoping.rows.empty")}</p>
            ) : (
              <ul className="scope-rows" role="list" aria-label={t("scoping.rows.list")}>
                {sheet.rows.map((row, i) => {
                  const rate = rates.find((r) => r.id === row.rateId);
                  const figure = f.rows.find((r) => r.rateId === row.rateId);
                  if (rate === undefined) return null;
                  const label = rate.label;
                  const each = money(rate.amount);
                  return (
                    <li key={`${String(row.rateId)}-${String(i)}`} className="scope-row" data-rate={rate.id}>
                      <span className="scope-row-main">
                        <span className="scope-row-title">{label}</span>
                        <span className="scope-row-sub">{figure?.hours ? t("scoping.row.each", { amount: each, hours: hours(figure.hours) }) : t("scoping.row.eachNoHours", { amount: each })}</span>
                      </span>
                      <span className="scope-stepper">
                        <button type="button" className="scope-step ol-gi" aria-label={t("scoping.row.fewer", { label })} onClick={() => change((s) => stepRow(s, i, -1))}>
                          <Minus size={13} aria-hidden="true" />
                        </button>
                        <input className="scope-qty ol-fld" dir="ltr" inputMode="decimal" value={row.qty} aria-label={t("scoping.row.qty", { label })} onChange={(e) => change((s) => typeRow(s, i, e.target.value))} />
                        <button type="button" className="scope-step ol-gi" aria-label={t("scoping.row.more", { label })} onClick={() => change((s) => stepRow(s, i, 1))}>
                          <Plus size={13} aria-hidden="true" />
                        </button>
                      </span>
                      <span className="scope-row-amount money">{money(figure?.amount ?? 0)}</span>
                      <button type="button" className="scope-drop ol-gi" aria-label={t("scoping.row.drop", { label })} onClick={() => change((s) => dropRow(s, i))}>
                        <X size={13} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="scope-foot scope-foot--sum">
              <span className="scope-foot-label">{t("scoping.fees")}</span>
              <span className="scope-foot-value money">{money(f.fees)}</span>
            </div>
          </ScopeCard>

          {/* Expenses you expect. */}
          <ScopeCard
            icon={Wallet}
            title={t("scoping.exp.title")}
            end={
              <button type="button" className="scope-head-btn ol-gi" onClick={() => change(addExpense)}>
                <Plus size={13} aria-hidden="true" />
                {t("scoping.exp.add")}
              </button>
            }
          >
            {sheet.expenses.length > 0 && (
              <ul className="scope-rows" role="list" aria-label={t("scoping.exp.list")}>
                {sheet.expenses.map((e, i) => {
                  const n = i + 1;
                  const state = t(e.passOn ? "scoping.exp.atCost" : "scoping.exp.carry");
                  return (
                    <li key={String(i)} className="scope-exp">
                      <input className="scope-exp-what ol-fld" value={e.what} placeholder={t("scoping.exp.whatPlaceholder")} aria-label={t("scoping.exp.what", { n })} onChange={(ev) => change((s) => editExpense(s, i, { what: ev.target.value }))} />
                      <input className="scope-exp-amount ol-fld" dir="ltr" inputMode="decimal" value={e.amount} placeholder="60.00" aria-label={t("scoping.exp.amount", { n })} onChange={(ev) => change((s) => editExpense(s, i, { amount: ev.target.value }))} />
                      <button type="button" className={`scope-tag ol-chip${e.passOn ? " scope-tag--on" : ""}`} aria-label={t("scoping.exp.toggle", { n, state })} onClick={() => change((s) => editExpense(s, i, { passOn: !e.passOn }))}>
                        {e.passOn ? <ArrowRight size={13} className="scope-flip" aria-hidden="true" /> : <Minus size={13} aria-hidden="true" />}
                        {state}
                      </button>
                      <button type="button" className="scope-drop ol-gi" aria-label={t("scoping.exp.drop", { n })} onClick={() => change((s) => dropExpense(s, i))}>
                        <X size={13} aria-hidden="true" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="scope-foot scope-foot--note">{t("scoping.exp.foot", { on: money(f.expensesAtCost), off: money(f.expensesCarried) })}</p>
          </ScopeCard>

          {/* How the last stages actually went. */}
          <ScopeCard
            icon={History}
            title={t("scoping.past.title")}
            end={
              drift !== null && pastRows.length > 0 ? (
                <span className={`pill pill--${driftTone(drift)} scope-pill`}>{drift > 0 ? t("scoping.past.over", { pct: number(driftPct(drift)) }) : t("scoping.past.onTheNose")}</span>
              ) : undefined
            }
          >
            {reading.state === "loading" && <p className="scope-empty">{t("common.loading")}</p>}
            {reading.state === "failed" && (
              <div className="scope-empty scope-failed">
                <span>{t("scoping.readFailed")}</span>
                <button type="button" className="scope-head-btn ol-gi" onClick={onRetry}>
                  {t("common.retry")}
                </button>
              </div>
            )}
            {reading.state === "ready" && pastRows.length === 0 && <p className="scope-empty">{t("scoping.past.none")}</p>}
            {reading.state === "ready" && pastRows.length > 0 && (
              <>
                <ul className="scope-rows" role="list" aria-label={t("scoping.past.list")}>
                  {pastRows.map((p) => {
                    const pct = overPct(p);
                    const project = projects[p.projectId];
                    const who = clientsById[project?.client_id ?? -1]?.company ?? "";
                    return (
                      <li key={p.milestoneId} className="scope-past">
                        <span className="scope-row-main">
                          <span className="scope-row-title scope-row-title--small">{p.title}</span>
                          <span className="scope-row-sub">{project?.number ? t("scoping.past.who", { client: who, project: project.number }) : who}</span>
                        </span>
                        <span className="scope-past-quoted">{t("scoping.past.quoted", { days: number(p.quotedDays) })}</span>
                        <span className="scope-past-actual">{t("scoping.past.actual", { days: number(p.actualDays) })}</span>
                        <span className={`scope-past-diff scope-tone--${overTone(pct)}`}>{pct === 0 ? t("scoping.past.asScoped") : `${pct > 0 ? "+" : "−"}${number(Math.abs(pct))}%`}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="scope-foot scope-foot--past">
                  <span className="scope-past-note">
                    {drift === null || drift <= 0
                      ? t("scoping.past.noteUnder")
                      : f.hours <= 0
                        ? t("scoping.past.noteEmpty")
                        : reserveOn
                        ? t("scoping.past.noteOn", { amount: money(f.contingency), hours: hours(view.reserveHours) })
                        : t("scoping.past.noteOff", { days: days1(view.days), budget: days1(view.budgetDays ?? view.days) }, oneDecimal(view.days))}
                  </span>
                  {drift !== null && drift > 0 && (
                    <button type="button" className={`scope-cont ol-chip${sheet.contingency ? " scope-cont--on" : ""}`} aria-pressed={sheet.contingency} onClick={() => change((s) => ({ ...s, contingency: !s.contingency }))}>
                      {sheet.contingency ? <Check size={13} aria-hidden="true" /> : <Plus size={13} aria-hidden="true" />}
                      {sheet.contingency ? t("scoping.past.on", { pct: number(driftPct(drift)) }) : t("scoping.past.add", { pct: number(driftPct(drift)) })}
                    </button>
                  )}
                </div>
              </>
            )}
          </ScopeCard>
        </div>

        <div className="scope-col">
          {/* The rate card: tap a line to put it on the sheet. */}
          <ScopeCard icon={Ruler} title={t("scoping.card.title")}>
            {rates.length === 0 ? (
              <p className="scope-empty">{t("scoping.card.empty")}</p>
            ) : (
              <ul className="scope-rows" role="list" aria-label={t("scoping.card.title")}>
                {rates.map((r) => (
                  <li key={r.id}>
                    <button type="button" className="scope-rate ol-row" data-rate={r.id} aria-label={t("scoping.card.add", { label: r.label, amount: money(r.amount) })} onClick={() => change((s) => addRate(s, r.id))}>
                      <span className="scope-row-main">
                        <span className="scope-row-title scope-row-title--small">{r.label}</span>
                        <span className="scope-row-sub scope-row-sub--small">{r.hours_per_unit !== null && Number(r.hours_per_unit) > 0 ? t("scoping.card.hours", { hours: hours(Number(r.hours_per_unit)) }) : t("scoping.card.vary")}</span>
                      </span>
                      <span className="scope-rate-amount money">{money(r.amount)}</span>
                      <Plus size={14} className="scope-rate-plus" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <p className="scope-foot scope-foot--note scope-foot--small">{t("scoping.card.foot")}</p>
          </ScopeCard>

          {/* The price, what it is made of, three checks, how it gets paid. */}
          <PriceCard>
            <div className="scope-price-head">
              <span className="kicker">{t("scoping.price.kicker")}</span>
              <span className="scope-price money" data-figure="price">
                {money(f.price)}
              </span>
              <span className="scope-price-sub">
                {view.withReserve.hours > 0
                  ? t(
                      week.kind === "same" && week.people === 2 ? "scoping.price.subTwo" : week.kind === "same" || week.kind === "mixed" ? "scoping.price.subMany" : "scoping.price.subOne",
                      {
                        hours: hours(view.withReserve.hours),
                        days: days1(view.withReserve.days),
                        each: days1(view.withReserve.days / (week.kind === "same" || week.kind === "mixed" ? week.people : 1)),
                        n: week.kind === "same" || week.kind === "mixed" ? week.people : 1,
                      },
                      oneDecimal(view.withReserve.days),
                    )
                  : t("scoping.price.empty")}
              </span>
            </div>
            <dl className="scope-break">
              <div className="scope-break-row">
                <dt>{t("scoping.fees")}</dt>
                <dd className="money">{money(f.fees)}</dd>
              </div>
              <div className="scope-break-row">
                <dt>{reserveOn && drift !== null ? t("scoping.break.contOn", { pct: number(driftPct(drift)) }) : t("scoping.break.contOff")}</dt>
                <dd className={`money${reserveOn ? " scope-tone--warn" : " scope-dim"}`}>{reserveOn ? money(f.contingency) : "—"}</dd>
              </div>
              <div className="scope-break-row">
                <dt>{t("scoping.break.expenses")}</dt>
                <dd className="money">{money(f.expensesAtCost)}</dd>
              </div>
              <div className="scope-break-row">
                <dt>{tax.rate === null ? t("scoping.break.taxUnknown") : t("scoping.break.tax", { tax: t("scoping.taxLabel", { name: tax.name ?? t("scoping.taxName"), rate: number(Number(tax.rate), { maximumFractionDigits: 2 }) }) })}</dt>
                <dd className="money scope-dim">{tax.rate === null ? "—" : money(f.tax)}</dd>
              </div>
              <div className="scope-break-row scope-break-row--total">
                <dt>{t("scoping.break.total")}</dt>
                <dd className="money" data-figure="total">
                  {money(f.priceWithTax)}
                </dd>
              </div>
            </dl>
            <ul className="scope-checks" role="list" aria-label={t("scoping.checks")}>
              <li className="scope-check">
                <Timer size={15} className="scope-check-icon" aria-hidden="true" />
                <span className="scope-check-text">
                  <span className="scope-check-value">{view.withReserve.days > 0 ? t("scoping.check.days", { days: days1(view.withReserve.days) }, oneDecimal(view.withReserve.days)) : t("scoping.check.noDays")}</span>
                  <span className="scope-check-note">{view.withReserve.days > 0 && view.weeks !== null ? weekNote(t, number, week, view.weeks) : t("scoping.check.daysEmpty")}</span>
                </span>
              </li>
              <li className="scope-check">
                <Ruler size={15} className={`scope-check-icon${thin ? " scope-tone--warn" : ""}`} aria-hidden="true" />
                <span className="scope-check-text">
                  <span className={`scope-check-value${thin ? " scope-tone--warn" : ""}`}>{view.dayRate !== null ? t("scoping.check.rate", { amount: money(view.dayRate) }) : "—"}</span>
                  <span className="scope-check-note">
                    {view.dayRate === null || cardRate === null ? t("scoping.check.rateEmpty") : thin ? t("scoping.check.rateThin", { rate: money(cardRate.amount) }) : t("scoping.check.rateOk", { rate: money(cardRate.amount) })}
                  </span>
                </span>
              </li>
              <li className="scope-check">
                <Building2 size={15} className="scope-check-icon" aria-hidden="true" />
                <span className="scope-check-text">
                  <span className="scope-check-value">{f.monthsCovered !== null && f.price > 0 ? t("scoping.check.months", { n: number(f.monthsCovered) }, f.monthsCovered) : "—"}</span>
                  <span className="scope-check-note">{monthly > 0 ? t("scoping.check.monthsNote", { amount: money(monthly) }) : t("scoping.check.monthsNone")}</span>
                </span>
              </li>
            </ul>
            <div className="scope-split">
              <span className="kicker" id="scoping-split">
                {t("scoping.split.title")}
              </span>
              <div className="scope-chips" role="group" aria-labelledby="scoping-split">
                {SPLITS.map((split) => (
                  <button key={split} type="button" className="scope-chip ol-chip" aria-pressed={sheet.split === split} onClick={() => change((s) => ({ ...s, split }))}>
                    {t(`scoping.split.${split}` as MessageKey)}
                  </button>
                ))}
              </div>
              <ul className="scope-stages" role="list">
                {splitShares.map((part, i) => (
                  <li key={part.when} className="scope-stage">
                    <span className="scope-stage-pct">{t("scoping.split.pct", { pct: number(part.share) })}</span>
                    <span className="scope-stage-when">{t(part.when)}</span>
                    <span className="scope-stage-amount money">{money(stageAmounts[i] ?? 0)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="scope-actions">
              {refused !== null && <Alert>{refused}</Alert>}
              {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void finishTurn(() => unfinished.resume())} />}
              {!canWrite && <p className="scope-cannot">{t("scoping.cannot")}</p>}
              <button type="button" className="btn btn--primary ol-btn scope-turn" disabled={busy || !canWrite || unfinished !== null} aria-busy={busy || undefined} onClick={onTurn}>
                <SquarePen size={16} aria-hidden="true" />
                {t("scoping.turn")}
              </button>
              <button
                type="button"
                className="btn ol-gi scope-again"
                onClick={() => {
                  change(startAgain);
                  toast(t("scoping.toast.blank"));
                }}
              >
                <Eraser size={15} aria-hidden="true" />
                {t("scoping.again")}
              </button>
            </div>
          </PriceCard>
        </div>
      </div>
    </section>
  );
}

function PriceCard({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  return (
    <section className="scope-card scope-card--strong" aria-label={t("scoping.price.kicker")}>
      {children}
    </section>
  );
}

function weekNote(t: ReturnType<typeof useI18n>["t"], number: ReturnType<typeof useI18n>["number"], week: ReturnType<typeof studioWeek>, weeks: number): string {
  const span = t("scoping.check.weeks", { n: number(weeks) }, weeks);
  switch (week.kind) {
    case "one":
      return t("scoping.check.weekOne", { each: number(week.each), weeks: span });
    case "same":
      return t("scoping.check.weekSame", { people: number(week.people), each: number(week.each), total: number(week.total), weeks: span });
    case "mixed":
      return t("scoping.check.weekMixed", { total: number(week.total), weeks: span });
    default:
      return t("scoping.check.daysEmpty");
  }
}

/** Who the stage is for: chips for a handful of clients, a list to pick from for more. */
function ClientPick({ clients, value, onPick }: { clients: readonly { id: Id; company: string }[]; value: Id | null; onPick: (id: Id | null) => void }) {
  const { t } = useI18n();
  const id = useId();
  if (clients.length > CHIP_LIMIT) {
    return (
      <div className="scope-field">
        <label className="scope-label" htmlFor={id}>
          {t("scoping.what.for")}
        </label>
        <select id={id} className="scope-input ol-fld" value={value ?? ""} onChange={(e) => onPick(e.target.value === "" ? null : Number(e.target.value))}>
          <option value="">{t("scoping.what.pick")}</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.company}
            </option>
          ))}
        </select>
      </div>
    );
  }
  return (
    <div className="scope-field">
      <span className="scope-label" id={id}>
        {t("scoping.what.for")}
      </span>
      <div className="scope-chips" role="group" aria-labelledby={id}>
        {clients.map((c) => (
          <button key={c.id} type="button" className="scope-chip ol-chip" aria-pressed={value === c.id} onClick={() => onPick(c.id)}>
            {c.company}
          </button>
        ))}
      </div>
    </div>
  );
}

function StageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useI18n();
  const id = useId();
  return (
    <div className="scope-field">
      <label className="scope-label" htmlFor={id}>
        {t("scoping.what.stage")}
      </label>
      <input id={id} className="scope-input ol-fld" value={value} placeholder={t("scoping.what.stagePlaceholder")} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
