/**
 * Invoices: every invoice the studio has numbered, newest first, under six
 * filters — All, Open, Overdue, Draft, Paid, Void — each with its count.
 *
 * What a row says is worked out from what is stored: its number, title and
 * client; its due day ("not sent" for a draft, "void" for a void one) and,
 * when it is late, how many days; its stored total, and what is still open
 * when part of it is paid; its pill. The lead line adds the stored balances:
 * what is outstanding, how much of it is overdue, and how many invoices there
 * are in all.
 *
 * The open work (drafts, and sent invoices with a balance) is on the desk
 * already; a filter the open work does not cover reads its page from the
 * server, and "Show more" reads the next.
 */
import { useEffect, useMemo, useState } from "react";
import { FilePlus, ReceiptText } from "lucide-react";

import { Button, DayText, DocList, DocRow, Empty, Filters, Money, Pill, ScreenHead, StatusPill } from "../components/ui.tsx";
import type { Id } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { useDesk, loadPage, useRows } from "../state/desk.ts";
import { openSheet } from "../state/sheets.ts";
import { open } from "../state/ui.ts";
import { today } from "../lib/clock.ts";
import { isPositive } from "../lib/money.ts";
import { daysOverdue, filterCondition, INVOICE_FILTERS, invoiceWord, isOpen, matchesFilter, newestFirst, sumByCurrency, sumsLabel, type InvoiceFilter } from "./invoices/figures.ts";

const PAGE = 50;

export default function Invoices() {
  const { t, number, money } = useI18n();
  const day = useDesk((s) => s.today) || today();
  const invoices = useRows("invoices");
  const clients = useDesk((s) => s.rows.clients);
  const [filter, setFilter] = useState<InvoiceFilter>("all");
  const [counts, setCounts] = useState<Partial<Record<InvoiceFilter, number>>>({});
  const [paged, setPaged] = useState<{ filter: InvoiceFilter; offset: number; total: number | null; busy: boolean }>({ filter: "all", offset: 0, total: null, busy: false });

  // Every filter's count, from the server (the list may be longer than the desk holds).
  useEffect(() => {
    let live = true;
    void Promise.all(
      INVOICE_FILTERS.map(async (f) => {
        const where = filterCondition(f, day);
        const page = await loadPage("invoices", { ...(where === undefined ? {} : { where }), order: "id.desc", limit: 1, offset: 0, count: true }).catch(() => null);
        return [f, page?.total ?? null] as const;
      }),
    ).then((pairs) => {
      if (live) setCounts(Object.fromEntries(pairs.filter(([, n]) => n !== null)) as Partial<Record<InvoiceFilter, number>>);
    });
    return () => {
      live = false;
    };
  }, [day]);

  // The first page of the filter on show.
  useEffect(() => {
    let live = true;
    const where = filterCondition(filter, day);
    setPaged({ filter, offset: 0, total: null, busy: true });
    void loadPage("invoices", { ...(where === undefined ? {} : { where }), order: "id.desc", limit: PAGE, offset: 0, count: true })
      .then((page) => live && setPaged({ filter, offset: page.ids.length, total: page.total, busy: false }))
      .catch(() => live && setPaged({ filter, offset: 0, total: null, busy: false }));
    return () => {
      live = false;
    };
  }, [filter, day]);

  const more = () => {
    const where = filterCondition(filter, day);
    setPaged((p) => ({ ...p, busy: true }));
    void loadPage("invoices", { ...(where === undefined ? {} : { where }), order: "id.desc", limit: PAGE, offset: paged.offset })
      .then((page) => setPaged((p) => ({ ...p, offset: p.offset + page.ids.length, busy: false })))
      .catch(() => setPaged((p) => ({ ...p, busy: false })));
  };

  const rows = useMemo(() => invoices.filter((i) => matchesFilter(filter, i, day)).sort(newestFirst), [invoices, filter, day]);
  const open_ = useMemo(() => invoices.filter(isOpen), [invoices]);
  const overdue = useMemo(() => invoices.filter((i) => invoiceWord(i, day) === "overdue"), [invoices, day]);
  const all = counts.all ?? invoices.length;
  const shownTotal = paged.filter === filter ? paged.total : null;

  const label = (f: InvoiceFilter): string => t(`invoices.filter.${f}`);
  const company = (id: Id) => clients[id]?.company ?? "";

  return (
    <section className="screen ol-screen inv-screen" data-screen="invoices" aria-labelledby="invoices-title">
      <ScreenHead
        id="invoices-title"
        title={t("nav.invoices")}
        lead={t("invoices.lead", { open: sumsLabel(sumByCurrency(open_, (i) => i.balance), money), overdue: sumsLabel(sumByCurrency(overdue, (i) => i.balance), money), n: number(all) }, all)}
        actions={
          <Button kind="primary" icon={FilePlus} onClick={() => openSheet({ kind: "add", what: "invoice" })}>
            {t("invoices.new")}
          </Button>
        }
      />
      <Filters label={t("invoices.filter.label")} value={filter} onChange={setFilter} items={INVOICE_FILTERS.map((f) => ({ id: f, label: label(f), ...(counts[f] === undefined ? {} : { count: counts[f] }) }))} />
      <div className="inv-list">
        {rows.length === 0 ? (
          <div className="card">
            {paged.busy ? <p className="inv-loading">{t("common.loading")}</p> : <Empty icon={ReceiptText} title={t("invoices.empty.title")} body={t("invoices.empty.body")} />}
          </div>
        ) : (
          <DocList label={t("invoices.listLabel", { filter: label(filter) })}>
            {rows.map((inv) => {
              const word = invoiceWord(inv, day);
              const late = daysOverdue(inv, day);
              const partPaid = isOpen(inv) && isPositive(inv.paid);
              return (
                <DocRow
                  key={inv.id}
                  onOpen={() => open("invoice", inv.id)}
                  number={inv.number ?? t("invoices.unnumbered")}
                  title={inv.title ?? t("invoices.untitled")}
                  sub={company(inv.client_id)}
                  due={
                    <span className="inv-due">
                      <span className="inv-due-day">{inv.status === "void" ? t("invoices.due.void") : inv.status === "draft" ? t("invoices.due.notSent") : <DayText day={inv.due_on} />}</span>
                      {late > 0 && <Pill tone={late > 30 ? "danger" : "warn"} mono>{t("invoices.age.over", { count: number(late) }, late)}</Pill>}
                    </span>
                  }
                  amount={
                    <span className="inv-amount">
                      <Money value={inv.total} currency={inv.currency} />
                      {partPaid && <span className="inv-open-part money">{t("invoices.partOpen", { amount: money(inv.balance, inv.currency) })}</span>}
                    </span>
                  }
                  pill={<StatusPill status={word} />}
                />
              );
            })}
          </DocList>
        )}
        {shownTotal !== null && shownTotal > rows.length && (
          <div className="inv-more">
            <Button size="small" busy={paged.busy} onClick={more}>
              {t("common.more")}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
