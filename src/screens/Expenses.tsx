/**
 * Expenses: what the studio buys on a client's behalf — fonts, proofs,
 * couriers — and passing it on to them at cost.
 *
 * At the top, three sums of the stored costs: what is still to put on an
 * invoice, what is already on one, and what is the studio's own to carry;
 * then filters with their counts, and the purchases, newest first. "Add a
 * purchase" opens a form in place (what, the cost, whose it is, the day, the
 * supplier, a receipt). Each row's chip says how it stands: "Pass it on" puts
 * that one purchase on the client's draft invoice, "Passed on" opens where it
 * went, "Ours" is the studio's, "Invoice voided" opens the purchase: the
 * invoice it went on was voided, so nothing was charged for it. The foot passes every waiting purchase on at
 * once: one line per purchase, its cost as it was stored, on each client's
 * draft (a new draft when they have none) — Adminium works out the totals.
 *
 * A purchase opens in a sheet: its facts, its receipt, where it went (a line
 * comes off a draft there), changes, and removing it.
 */
import { useEffect, useMemo, useState } from "react";
import { Ban, Check, Minus, Plus, Paperclip, ReceiptText, Wallet } from "lucide-react";

import { Alert, Button, DayText, Empty, Filters, Money, ScreenHead, UnfinishedLine } from "../components/ui.tsx";
import type { Expense, Id } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { decimalValue, sumDecimals } from "../lib/money.ts";
import { ensureRows, refreshRows, useDesk, useDeskReads, useRows, useSettings } from "../state/desk.ts";
import { linesCarrying, type OntoDrafts } from "../state/invoiceDrafts.ts";
import { loadPurchases, loadSuppliers, passOn } from "../state/officeActions.ts";
import type { Outcome, Unfinished } from "../state/outcome.ts";
import { toast } from "../state/ui.ts";
import { PurchaseSheet } from "../sheets/expenses/PurchaseSheet.tsx";
import { carriersOf, expenseFigures, inFilter, newestFirst, passable, PURCHASE_FILTERS, standingOf, type PurchaseFilter, type PurchaseStanding } from "./expenses/model.ts";
import { PurchaseForm } from "./expenses/PurchaseForm.tsx";
import { passedOnWords, refusalWords } from "./expenses/words.ts";

const TAG_ICON = { "to-pass-on": Plus, "passed-on": Check, ours: Minus, voided: Ban } as const;

export default function Expenses() {
  const { t, number, money } = useI18n();
  const expenses = useRows("expenses");
  const lines = useRows("invoice_lines");
  const invoices = useDesk((s) => s.rows.invoices);
  const clients = useDesk((s) => s.rows.clients);
  const projects = useDesk((s) => s.rows.projects);
  const settings = useSettings();
  const [filter, setFilter] = useState<PurchaseFilter>("all");
  const [adding, setAdding] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sheet, setSheet] = useState<Id | null>(null);
  const [busy, setBusy] = useState<"all" | Id | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [unfinished, setUnfinished] = useState<Unfinished<OntoDrafts> | null>(null);

  // Every purchase, the lines carrying them and those lines' invoices, and the address book (again after a reconnect).
  const reads = useDeskReads();
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const rows = await loadPurchases(null);
        await loadSuppliers();
        await ensureRows("invoices", linesCarrying("expense_id", rows.map((r) => r.id)).map((l) => l.document_id));
      } catch {
        // What the desk already holds is drawn; a refusal on a later press says why.
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, [reads]);

  const carriers = useMemo(() => carriersOf(lines, invoices), [lines, invoices]);
  const figures = useMemo(() => expenseFigures(expenses, carriers), [expenses, carriers]);
  const rows = useMemo(() => expenses.filter((e) => inFilter(filter, e, carriers)).sort(newestFirst), [expenses, filter, carriers]);
  const waiting = useMemo(() => passable(expenses, carriers), [expenses, carriers]);
  /** Marked to pass on, but held by a voided invoice's line: nothing Pass on can take, and not "nothing waiting" either. */
  const onVoided = expenses.some((e) => e.rebill && standingOf(e, carriers) === "voided");

  const studio = settings?.name ?? "";
  const who = (e: Expense): string => {
    const company = e.client_id === null ? null : (clients[e.client_id]?.company ?? null);
    const project = e.project_id === null ? null : (projects[e.project_id]?.number ?? projects[e.project_id]?.name ?? null);
    if (company === null) return t("expenses.row.overhead", { studio });
    return project === null ? company : `${company} · ${project}`;
  };

  const finishPass = async (out: Outcome<OntoDrafts>, passed: readonly Expense[]) => {
    if (!out.ok) {
      setUnfinished(out.unfinished);
      setProblem(refusalWords(out, t));
      // A draft sent a moment ago: read the clients' drafts again, so the next press starts a new one.
      const drafts = Object.values(useDesk.getState().rows.invoices).filter((i) => i.status === "draft" && passed.some((e) => e.client_id === i.client_id));
      if (out.reason === "locked" || out.reason === "moved") await refreshRows("invoices", drafts.map((i) => i.id)).catch(() => undefined);
      return;
    }
    setUnfinished(null);
    setProblem(null);
    const words = passedOnWords(out.value, passed, clients);
    toast(t(words.key, { amount: money(words.amount), company: words.company, count: number(words.count) }, words.count), { icon: "wallet" });
  };

  const passAll = async () => {
    if (waiting.length === 0) {
      toast(t("expenses.foot.nothingToast"), { icon: "check" });
      return;
    }
    setBusy("all");
    const out = await passOn(
      waiting.map((e) => e.id),
      { newTitle: () => t("expenses.draftTitle") },
    );
    setBusy(null);
    await finishPass(out, waiting);
  };

  const passOne = async (e: Expense) => {
    setBusy(e.id);
    const out = await passOn([e.id], { newTitle: () => t("expenses.draftTitle") });
    setBusy(null);
    await finishPass(out, [e]);
  };

  const resume = async () => {
    if (unfinished === null) return;
    setBusy("all");
    const out = await unfinished.resume();
    setBusy(null);
    await finishPass(out, waiting);
  };

  const onTag = (e: Expense, standing: PurchaseStanding) => {
    if (standing === "ours") toast(t("expenses.oursToast"), { icon: "info" });
    else if (standing === "to-pass-on") void passOne(e);
    else setSheet(e.id);
  };

  const kpis: { key: PurchaseStanding; label: MessageKey; value: string; sub: string; tone: "warn" | "pos" | "fg" }[] = [
    {
      key: "to-pass-on",
      label: "expenses.kpi.toPassOn",
      value: figures["to-pass-on"].sum,
      sub: figures["to-pass-on"].count > 0 ? t("expenses.kpi.toPassOnSub", { count: number(figures["to-pass-on"].count) }, figures["to-pass-on"].count) : t("expenses.kpi.allPassed"),
      tone: (decimalValue(figures["to-pass-on"].sum) ?? 0) > 0 ? "warn" : "pos",
    },
    {
      key: "passed-on",
      label: "expenses.kpi.passedOn",
      value: figures["passed-on"].sum,
      sub: figures["passed-on"].count > 0 ? t("expenses.kpi.passedOnSub") : t("expenses.kpi.passedOnNone"),
      tone: "fg",
    },
    { key: "ours", label: "expenses.kpi.ours", value: figures.ours.sum, sub: t("expenses.kpi.oursSub"), tone: "fg" },
  ];

  const waitingSum = sumDecimals(waiting.map((e) => e.amount));
  const open = sheet === null ? undefined : expenses.find((e) => e.id === sheet);

  return (
    <section className="screen ol-screen ex-screen" data-screen="expenses" aria-labelledby="expenses-title">
      <ScreenHead id="expenses-title" title={t("nav.expenses")} lead={t("expenses.lead")} />

      <div className="ex-kpis">
        {kpis.map((k) => (
          <div key={k.key} className="ex-kpi" data-kpi={k.key}>
            <span className="ex-kpi-k">{t(k.label)}</span>
            <span className={`ex-kpi-v money ex-kpi-v--${k.tone}`}>{money(k.value)}</span>
            <span className="ex-kpi-sub">{k.sub}</span>
          </div>
        ))}
      </div>

      <Filters
        label={t("expenses.filter.label")}
        value={filter}
        onChange={setFilter}
        items={PURCHASE_FILTERS.map((f) => ({ id: f, label: t(`expenses.filter.${f}`), count: figures[f].count }))}
      />

      <section className="card ex-list" aria-labelledby="ex-list-title">
        <div className="ex-list-head">
          <Wallet size={15} aria-hidden="true" />
          <h2 className="ex-list-title" id="ex-list-title">
            {t("expenses.list.title")}
          </h2>
          <Button size="small" icon={Plus} className="ex-add" aria-expanded={adding} onClick={() => setAdding(true)}>
            {t("expenses.add")}
          </Button>
        </div>

        {adding && <PurchaseForm onClose={() => setAdding(false)} />}

        {rows.length === 0 ? (
          <div className="ex-empty">
            {loading ? (
              <p className="ex-loading">{t("common.loading")}</p>
            ) : expenses.length === 0 ? (
              <Empty icon={ReceiptText} title={t("expenses.empty.title")} body={t("expenses.empty.body")} />
            ) : (
              <Empty icon={ReceiptText} title={t("expenses.empty.filtered")} />
            )}
          </div>
        ) : (
          <ul className="ex-rows" aria-label={t("expenses.list.label", { filter: t(`expenses.filter.${filter}`) })}>
            {rows.map((e) => {
              const standing = standingOf(e, carriers);
              const Icon = TAG_ICON[standing];
              return (
                <li key={e.id} className="ex-row" data-number={e.number ?? undefined}>
                  <span className="ex-date">
                    <DayText day={e.date} />
                  </span>
                  <span className="ex-main">
                    <button type="button" className="ex-what" onClick={() => setSheet(e.id)}>
                      {e.what}
                      {e.receipt !== null && (
                        <span className="ex-receipt" title={t("expenses.row.receipt")}>
                          <Paperclip size={12} aria-hidden="true" />
                          <span className="ex-sr">{t("expenses.row.receipt")}</span>
                        </span>
                      )}
                    </button>
                    <span className="ex-who">{who(e)}</span>
                  </span>
                  <span className="ex-amt">
                    <Money value={e.amount} />
                  </span>
                  <button
                    type="button"
                    className={`ex-tag ol-chip ex-tag--${standing}`}
                    aria-label={t(`expenses.tag.${standing}Label`, { what: e.what })}
                    aria-busy={busy === e.id || undefined}
                    disabled={busy !== null}
                    onClick={() => onTag(e, standing)}
                  >
                    <Icon size={13} aria-hidden="true" />
                    {t(`expenses.tag.${standing}`)}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {(problem !== null || unfinished !== null) && (
          <div className="ex-problem">
            {unfinished !== null ? <UnfinishedLine unfinished={unfinished} busy={busy === "all"} onFinish={() => void resume()} /> : null}
            {problem !== null && unfinished === null && <Alert>{problem}</Alert>}
          </div>
        )}

        <div className="ex-foot">
          <span className="ex-foot-label">{waiting.length > 0 ? t("expenses.foot.waiting") : onVoided ? t("expenses.foot.voidedOnly") : t("expenses.foot.nothing")}</span>
          <span className="ex-foot-amt money">{money(waitingSum)}</span>
          <Button kind="primary" icon={ReceiptText} busy={busy === "all"} disabled={busy !== null && busy !== "all"} onClick={() => void passAll()}>
            {waiting.length > 0 ? t("expenses.foot.passOn", { count: number(waiting.length) }, waiting.length) : t("expenses.foot.clear")}
          </Button>
        </div>
      </section>

      {open !== undefined && <PurchaseSheet expense={open} onClose={() => setSheet(null)} />}
    </section>
  );
}
