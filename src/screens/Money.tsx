/**
 * Money: what came in, what is owed and what it costs to open the door.
 *
 * A lead with the six months' sum and average against the monthly costs; a
 * way to the chase ladder; four figures (collected this month, open, out for
 * signature, how many months of costs the open invoices would cover); six
 * months of invoiced against collected, each month opening onto the invoices
 * and payments it adds; the open balances by how late they are (each opens
 * the Invoices list on that bucket); and the running costs, which a studio
 * manager changes here.
 *
 * Every amount is one Adminium stored — an invoice's total and balance, a
 * payment's amount, a proposal's total, a cost's monthly amount. The page
 * reads the six months' invoices and payments when it opens and only groups
 * and adds them for display (`money/model.ts`); nothing it works out is saved.
 */
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Banknote, BellRing, ChartNoAxesColumn, FileText, Hourglass, Pencil, Plus, ReceiptText, Receipt, Shield } from "lucide-react";

import { Button } from "../components/ui.tsx";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { tenantCurrency } from "../i18n/ambient.ts";
import { dayLabel } from "../lib/dates.ts";
import type { Id, Payment, RunningCost } from "../data/types.ts";
import { useCan, useDesk } from "../state/desk.ts";
import { go, open, openInvoices } from "../state/ui.ts";
import RunningCostSheet from "../sheets/money/RunningCost.tsx";
import { loadMoney } from "./money/load.ts";
import { aging, barHeights, chart, currencyOf, drill, figures, type MoneyInputs } from "./money/model.ts";

const METHOD_KEYS: Readonly<Record<Payment["method"], MessageKey>> = {
  "bank-transfer": "money.method.bank",
  card: "money.method.card",
  cheque: "money.method.cheque",
  cash: "money.method.cash",
  other: "money.method.other",
};

/** A calendar month's name in the page's language ("Jul", or with its year "July 2026"). */
function monthLabel(month: string, locale: string, style: "short" | "long" | "year"): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const opts: Intl.DateTimeFormatOptions = style === "year" ? { month: "long", year: "numeric", timeZone: "UTC" } : { month: style, timeZone: "UTC" };
  return new Intl.DateTimeFormat(locale, opts).format(new Date(Date.UTC(y, m - 1, 15)));
}

/** The six months' invoices and payments and the running costs, read when the desk knows its day. */
function useSixMonths(today: string): boolean {
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (today === "") return;
    let live = true;
    void loadMoney(today)
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [today]);
  return loaded;
}

export default function Money() {
  const { t, locale, money, number } = useI18n();
  const today = useDesk((s) => s.today);
  const rows = useDesk((s) => s.rows);
  const manager = useCan("running_costs", "update");
  const loaded = useSixMonths(today);
  const [month, setMonth] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ cost: RunningCost | null } | null>(null);

  const costs = useMemo(() => Object.values(rows.running_costs).sort((a, b) => a.position - b.position || a.id - b.id), [rows.running_costs]);
  const input = useMemo<MoneyInputs>(() => {
    const invoices = rows.invoices;
    return {
      today,
      currency: currencyOf(tenantCurrency(), Object.values(invoices)),
      invoices,
      payments: Object.values(rows.payments),
      proposals: Object.values(rows.proposals),
      costs,
    };
  }, [today, rows.invoices, rows.payments, rows.proposals, costs]);
  const f = useMemo(() => (today === "" ? null : figures(input)), [input, today]);
  const bars = useMemo(() => (today === "" ? [] : chart(input)), [input, today]);
  const heights = useMemo(() => barHeights(bars), [bars]);
  const buckets = useMemo(() => (today === "" ? [] : aging(input)), [input, today]);
  const drilled = useMemo(() => (month === null ? [] : drill(month, input)), [month, input]);
  const cur = f?.currency ?? null;
  const m = (value: string | null | undefined) => money(value, cur);
  const thisMonth = today === "" ? "" : monthLabel(today.slice(0, 7), locale, "long");

  const company = (clientId: Id | null | undefined) => (clientId === null || clientId === undefined ? "" : (rows.clients[clientId]?.company ?? ""));

  const lead =
    f === null
      ? ""
      : [
          t("money.lead", { six: m(f.sixMonths), average: m(f.average), costs: m(f.costs) }),
          f.thin && f.openThisMonth > 0 ? t("money.leadThin", { month: thisMonth, count: number(f.openThisMonth) }, f.openThisMonth) : "",
        ]
          .filter((s) => s !== "")
          .join(" ");

  const covered = f?.monthsCovered ?? null;
  const kpis: { key: string; icon: LucideIcon; label: string; value: string; sub: string; tone: "fg" | "danger" | "warn" | "pos" }[] =
    f === null
      ? []
      : [
          { key: "collected", icon: Banknote, label: t("money.kpi.collected", { month: thisMonth }), value: m(f.collectedThisMonth), sub: t("money.kpi.collectedSub", { amount: m(f.invoicedThisMonth) }), tone: "fg" },
          {
            key: "open",
            icon: Hourglass,
            label: t("money.kpi.open"),
            value: m(f.open),
            sub: f.overdue !== "" && Number(f.overdue) > 0 ? t("money.kpi.openSub", { amount: m(f.overdue) }) : t("money.kpi.openNone"),
            tone: Number(f.overdue) > 0 ? "danger" : "fg",
          },
          {
            key: "out",
            icon: FileText,
            label: t("money.kpi.out"),
            value: m(f.outForSignature),
            sub:
              f.proposalsOut === 0
                ? t("money.kpi.outNone")
                : f.proposalsOut === 1 && f.holdsUntil !== null
                  ? t("money.kpi.outOne", { day: dayLabel(f.holdsUntil, locale) })
                  : t("money.kpi.outMany", { count: number(f.proposalsOut) }, f.proposalsOut),
            tone: "fg",
          },
          {
            key: "covered",
            icon: Shield,
            label: t("money.kpi.covered"),
            value: covered === null ? t("money.kpi.coveredNoValue") : t("money.kpi.months", { n: number(covered, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) }, covered),
            sub: covered === null ? t("money.kpi.coveredNoCosts") : t("money.kpi.coveredSub"),
            tone: covered === null ? "fg" : covered < 1 ? "warn" : "pos",
          },
        ];

  const drilledBar = month === null ? undefined : bars.find((b) => b.month === month);

  return (
    <section className="screen ol-screen money-page" data-screen="money" aria-labelledby="money-title">
      <div>
        <h1 className="screen-title money-title" id="money-title">
          {t("nav.money")}
        </h1>
        <p className="money-lead">{lead}</p>
        <div className="money-links">
          <button type="button" className="money-link ol-gi" onClick={() => go("chasing")}>
            <BellRing size={15} aria-hidden="true" />
            {t("money.chase")}
          </button>
        </div>
      </div>

      <div className="money-kpis">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <div key={k.key} className="card money-kpi" data-kpi={k.key}>
              <span className="money-kpi-label">
                <Icon size={13} aria-hidden="true" />
                {k.label}
              </span>
              <span className={`money-kpi-value money-tone--${k.tone}`}>{k.value}</span>
              <span className="money-kpi-sub">{k.sub}</span>
            </div>
          );
        })}
      </div>

      <div className="money-cols">
        <section className="card money-panel" aria-labelledby="money-chart-title">
          <div className="money-panel-head">
            <ChartNoAxesColumn size={15} aria-hidden="true" />
            <h2 id="money-chart-title">{t("money.chart.title")}</h2>
            <span className="money-legend" aria-hidden="true">
              <span className="money-legend-item">
                <span className="money-swatch money-swatch--invoiced" />
                {t("money.chart.invoiced")}
              </span>
              <span className="money-legend-item">
                <span className="money-swatch money-swatch--collected" />
                {t("money.chart.collected")}
              </span>
            </span>
          </div>
          <div className="money-chart-body">
            <div className="money-bars" role="group" aria-label={t("money.chart.title")}>
              {bars.map((b, i) => {
                const on = month === b.month;
                return (
                  <button
                    key={b.month}
                    type="button"
                    className={`money-bar${on ? " money-bar--on" : ""}`}
                    aria-expanded={on}
                    aria-controls="money-drill"
                    aria-label={t("money.chart.bar", { month: monthLabel(b.month, locale, "year"), invoiced: m(b.invoiced), collected: m(b.collected) })}
                    onClick={() => setMonth(on ? null : b.month)}
                  >
                    <span className="money-bar-pair" aria-hidden="true">
                      <span className="money-bar-fill money-bar-fill--invoiced" style={{ height: `${String(heights[i]!.invoiced)}%` }} />
                      <span className="money-bar-fill money-bar-fill--collected" style={{ height: `${String(heights[i]!.collected)}%` }} />
                    </span>
                    <span className="money-bar-label" aria-hidden="true">
                      {monthLabel(b.month, locale, "short")}
                    </span>
                  </button>
                );
              })}
            </div>
            {month !== null && drilledBar !== undefined && (
              <div className="money-drill" id="money-drill">
                <div className="money-drill-head">
                  <span className="money-drill-title">{monthLabel(month, locale, "year")}</span>
                  <span className="money-drill-sum">{t("money.drill.sum", { invoiced: m(drilledBar.invoiced), collected: m(drilledBar.collected) })}</span>
                </div>
                {drilled.length === 0 ? (
                  <div className="money-drill-empty">{t("money.drill.empty", { month: monthLabel(month, locale, "year") })}</div>
                ) : (
                  <ul className="money-drill-list" role="list">
                    {drilled.map((r) =>
                      r.kind === "invoice" ? (
                        <li key={`i${String(r.invoice.id)}`}>
                          <button type="button" className="money-drill-row ol-row" onClick={() => open("invoice", r.invoice.id)}>
                            <ReceiptText size={15} className="money-drill-icon" aria-hidden="true" />
                            <span className="money-drill-text">
                              <span className="money-drill-what">{r.invoice.title ?? r.invoice.number ?? ""}</span>
                              <span className="money-drill-sub">{t("money.drill.issued", { number: r.invoice.number ?? "", day: dayLabel(r.day, locale) })}</span>
                            </span>
                            <span className="money-drill-amount">{money(r.amount, r.invoice.currency ?? cur)}</span>
                          </button>
                        </li>
                      ) : (
                        <li key={`p${String(r.payment.id)}`}>
                          <button type="button" className="money-drill-row ol-row" onClick={() => open("invoice", r.payment.document_id)}>
                            <Banknote size={15} className="money-drill-icon money-drill-icon--pos" aria-hidden="true" />
                            <span className="money-drill-text">
                              <span className="money-drill-what">{t("money.drill.paid", { company: company(r.payment.client_id ?? r.invoice?.client_id) })}</span>
                              <span className="money-drill-sub">{t("money.drill.paidSub", { number: r.invoice?.number ?? "", method: t(METHOD_KEYS[r.payment.method]), day: dayLabel(r.day, locale) })}</span>
                            </span>
                            <span className="money-drill-amount money-drill-amount--pos">{money(r.amount, r.payment.currency ?? r.invoice?.currency ?? cur)}</span>
                          </button>
                        </li>
                      ),
                    )}
                  </ul>
                )}
              </div>
            )}
            <p className="money-note">{loaded ? t("money.chart.note") : t("common.loading")}</p>
          </div>
        </section>

        <div className="money-side">
          <section className="card money-panel" aria-labelledby="money-owed-title">
            <div className="money-panel-head">
              <Hourglass size={15} aria-hidden="true" />
              <h2 id="money-owed-title">{t("money.owed.title")}</h2>
            </div>
            <div className="money-aging">
              {buckets.map((b) => (
                <button key={b.key} type="button" className={`money-bucket ol-gi money-bucket--${b.key}${b.count === 0 ? " money-bucket--empty" : ""}`} onClick={() => openInvoices(b.key)}>
                  <span className="money-bucket-label">{t(`money.aging.${b.key}` as MessageKey)}</span>
                  <span className="money-bucket-amount">{m(b.amount)}</span>
                  <span className="money-bucket-count">{t("money.aging.count", { count: number(b.count) }, b.count)}</span>
                </button>
              ))}
            </div>
          </section>

          <section className="card money-panel" aria-labelledby="money-costs-title">
            <div className="money-panel-head">
              <Receipt size={15} aria-hidden="true" />
              <h2 id="money-costs-title">{t("money.costs.title")}</h2>
              {manager && (
                <Button size="small" icon={Plus} className="money-costs-add" onClick={() => setEditing({ cost: null })}>
                  {t("money.costs.add")}
                </Button>
              )}
            </div>
            <ul className="money-costs" role="list">
              {costs.length === 0 && <li className="money-costs-none">{t("money.costs.none")}</li>}
              {costs.map((c) => (
                <li key={c.id} className="money-cost">
                  <span className="money-cost-label">{c.label}</span>
                  <span className="money-cost-amount">{m(c.monthly_amount)}</span>
                  {manager && (
                    <button type="button" className="icon-btn money-cost-edit ol-gi" aria-label={t("money.costs.editLabel", { label: c.label })} title={t("money.costs.edit")} onClick={() => setEditing({ cost: c })}>
                      <Pencil size={13} aria-hidden="true" />
                    </button>
                  )}
                </li>
              ))}
              <li className="money-cost money-cost--total">
                <span className="money-cost-label">{t("money.costs.total")}</span>
                <span className="money-cost-amount">{f === null ? "" : m(f.costs)}</span>
              </li>
            </ul>
          </section>
        </div>
      </div>
      {editing !== null && <RunningCostSheet cost={editing.cost} nextPosition={costs.reduce((most, c) => Math.max(most, c.position + 1), 0)} currency={cur} onClose={() => setEditing(null)} />}
    </section>
  );
}
