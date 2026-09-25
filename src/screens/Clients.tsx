/**
 * Clients: every client on the books, as cards — their tile and name, their
 * trade, a state (Overdue, Paused, Active, Awaiting or Quiet), what is open,
 * what they have paid to date, and one line on what is happening now.
 *
 * The figures are the stored ones, added for display: "Open" the balances of
 * their sent invoices (red when some of it is overdue), "Paid to date" each
 * non-void invoice's stored paid — a void invoice and a voided payment count
 * for nothing. Sorted by open balance, paid to date, or name in the page's
 * language.
 */
import { useEffect, useMemo, useState } from "react";
import { Check, CircleDot, Clock, UserRoundPlus, UsersRound } from "lucide-react";

import { Avatar, Button, Empty, Pill, ScreenHead } from "../components/ui.tsx";
import type { Client, Id } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { decimalValue } from "../lib/money.ts";
import { loadPage, loadWhere, useDesk, useRows } from "../state/desk.ts";
import { openSheet } from "../state/sheets.ts";
import { open } from "../state/ui.ts";
import { clientFigures, progressOf, type ClientFigures } from "./clients/figures.ts";
import { CLIENT_STATE_TONE } from "./clients/state.ts";
import { sumByCurrency, sumsLabel } from "./invoices/figures.ts";

type Sort = "open" | "paid" | "name";
const SORTS: readonly Sort[] = ["open", "paid", "name"];

export default function Clients() {
  const { t, money, number, locale } = useI18n();
  const day = useDesk((s) => s.today) || today();
  const clients = useRows("clients");
  const invoices = useRows("invoices");
  const projects = useRows("projects");
  const proposals = useRows("proposals");
  const milestones = useRows("milestones");
  const [sort, setSort] = useState<Sort>("open");
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState<number | null>(null);

  // Every client (a page of them), and what their cards add up: their invoices and projects.
  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await loadPage("clients", { order: "company.asc", limit: 200, offset: 0, count: true });
        if (live) setTotal(page.total);
        const ids = page.ids;
        if (ids.length > 0) {
          await Promise.all([
            loadWhere("invoices", { and: [{ column: "client_id", op: "in", value: ids }, { column: "status", op: "neq", value: "draft" }] }, "id.desc", 2000),
            loadWhere("projects", { column: "client_id", op: "in", value: ids }, "id.desc", 1000),
          ]);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const figures = useMemo(() => {
    const byId = new Map<Id, ClientFigures>();
    for (const c of clients) byId.set(c.id, clientFigures(c.id, { invoices, projects, proposals }, day));
    return byId;
  }, [clients, invoices, projects, proposals, day]);

  const collator = useMemo(() => new Intl.Collator(locale, { sensitivity: "base" }), [locale]);
  const rows = useMemo(() => {
    const first = (c: Client, pick: (f: ClientFigures) => ReturnType<typeof sumByCurrency>) => decimalValue(pick(figures.get(c.id)!)[0]?.amount) ?? 0;
    return [...clients].sort((a, b) => {
      if (sort === "name") return collator.compare(a.company, b.company);
      const diff = sort === "paid" ? first(b, (f) => f.paid) - first(a, (f) => f.paid) : first(b, (f) => f.open) - first(a, (f) => f.open);
      return diff || collator.compare(a.company, b.company);
    });
  }, [clients, figures, sort, collator]);

  const openAll = sumByCurrency(
    invoices.filter((i) => i.status === "sent"),
    (i) => (decimalValue(i.balance) ?? 0) > 0 ? i.balance : null,
  );
  const paidAll = sumByCurrency(
    invoices.filter((i) => i.status === "sent"),
    (i) => i.paid,
  );
  const count = total ?? clients.length;

  return (
    <section className="screen ol-screen cl-screen" data-screen="clients" aria-labelledby="clients-title">
      <ScreenHead
        id="clients-title"
        title={t("nav.clients")}
        lead={t("clients.lead", { open: sumsLabel(openAll, money), paid: sumsLabel(paidAll, money), n: number(count) }, count)}
        actions={
          <Button kind="primary" icon={UserRoundPlus} onClick={() => openSheet({ kind: "add", what: "client" })}>
            {t("clients.add")}
          </Button>
        }
      />
      <div className="cl-sort" role="group" aria-labelledby="cl-sort-label">
        <span className="cl-sort-label" id="cl-sort-label">
          {t("clients.sort.label")}
        </span>
        {SORTS.map((s) => (
          <button key={s} type="button" className="cl-sort-chip ol-chip" aria-pressed={sort === s} onClick={() => setSort(s)}>
            {t(`clients.sort.${s}`)}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <div className="card">{loading ? <p className="cl-loading">{t("common.loading")}</p> : <Empty icon={UsersRound} title={t("clients.empty")} />}</div>
      ) : (
        <ul className="cl-grid" role="list">
          {rows.map((c) => {
            const f = figures.get(c.id)!;
            const current = f.projects.find((p) => p.status !== "done") ?? f.projects[0] ?? null;
            const next = current === null ? null : progressOf(current.id, milestones).next;
            const waiting = proposals.some((p) => p.client_id === c.id && p.status === "sent");
            const foot =
              current === null
                ? waiting
                  ? t("clients.card.waiting")
                  : t("clients.card.nothing")
                : current.status === "done"
                  ? t("clients.card.delivered", { title: current.name })
                  : t("clients.card.now", { title: next?.title ?? current.name });
            const FootIcon = current === null ? Clock : current.status === "done" ? Check : CircleDot;
            return (
              <li key={c.id}>
                <button type="button" className="cl-card card ol-card" onClick={() => open("client", c.id)}>
                  <span className="cl-card-head">
                    <Avatar name={c.company} tint={c.tint} />
                    <span className="cl-card-names">
                      <span className="cl-card-name">{c.company}</span>
                      {c.trade !== null && <span className="cl-card-trade">{c.trade}</span>}
                    </span>
                    <Pill tone={CLIENT_STATE_TONE[f.state]}>{t(`clients.state.${f.state}`)}</Pill>
                  </span>
                  <span className="cl-card-figures">
                    <span className="cl-card-figure">
                      <span className="cl-card-k">{t("clients.card.open")}</span>
                      <span className={`cl-card-v money${f.anyOverdue ? " cl-card-v--danger" : f.anyOpen ? "" : " cl-card-v--quiet"}`}>{sumsLabel(f.open, money)}</span>
                    </span>
                    <span className="cl-card-figure">
                      <span className="cl-card-k">{t("clients.card.paid")}</span>
                      <span className="cl-card-v money">{sumsLabel(f.paid, money)}</span>
                    </span>
                  </span>
                  <span className="cl-card-foot">
                    <FootIcon size={14} aria-hidden="true" />
                    <span className="cl-card-foot-text">{foot}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
