/**
 * Proposals: every proposal the studio has written, newest first — a lead
 * line (how many, how many are out with a client and what they add up to),
 * "New proposal", the filters with their counts, and one row per proposal
 * (number, title, client, valid until, total, its state).
 *
 * Opening the list reads a page of every proposal (the desk's open work holds
 * only the recent ones); a draft opens straight in the composer.
 */
import { useEffect, useMemo, useState } from "react";
import { SquarePen } from "lucide-react";

import { Button, DocList, DocRow, Empty, Filters, Money, StatusPill, type FilterItem } from "../components/ui.tsx";
import type { Proposal } from "../data/types.ts";
import type { ListCondition } from "../data/snapshotPort.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { sumDecimals } from "../lib/money.ts";
import { loadPage, useDesk, useRows } from "../state/desk.ts";
import { open, openComposer } from "../state/ui.ts";
import { dayWithYear } from "./proposals/format.ts";
import { inFilter, isOutOfDate, PROPOSAL_FILTERS, proposalWord, type ProposalFilter } from "./proposals/model.ts";

/** Open a proposal: a draft in the composer, anything else on its page. */
export function openProposal(p: Pick<Proposal, "id" | "status">): void {
  if (p.status === "draft") openComposer({ kind: "proposal", id: p.id });
  else open("proposal", p.id);
}

export default function Proposals() {
  const { t, money, locale } = useI18n();
  const today = useDesk((s) => s.today);
  const proposals = useRows("proposals");
  const clients = useDesk((s) => s.rows.clients);
  const [filter, setFilter] = useState<ProposalFilter>("all");
  const [counts, setCounts] = useState<Partial<Record<ProposalFilter, number>> | null>(null);

  useEffect(() => {
    let live = true;
    void loadPage("proposals", { order: "id.desc", limit: 200, offset: 0, count: true })
      .then(async (page) => {
        if (!live || page.total === null || page.total <= page.ids.length) return;
        // More proposals than one page: every count is Adminium's.
        const sent: ListCondition = { column: "status", op: "eq", value: "sent" };
        const where: Record<Exclude<ProposalFilter, "all">, ListCondition> = {
          draft: { column: "status", op: "eq", value: "draft" },
          sent: { and: [sent, { or: [{ column: "valid_until", op: "gte", value: today }, { column: "valid_until", op: "is_null" }] }] },
          outOfDate: { and: [sent, { column: "valid_until", op: "lt", value: today }] },
          accepted: { column: "status", op: "eq", value: "accepted" },
          declined: { column: "status", op: "eq", value: "declined" },
          withdrawn: { column: "status", op: "eq", value: "withdrawn" },
        };
        const keys = Object.keys(where) as Exclude<ProposalFilter, "all">[];
        const totals = await Promise.all(keys.map((k) => loadPage("proposals", { where: where[k], limit: 1, offset: 0, count: true }).then((p) => p.total ?? 0)));
        if (live) setCounts({ all: page.total, ...Object.fromEntries(keys.map((k, i) => [k, totals[i]])) });
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [today]);

  const all = useMemo(() => [...proposals].sort((a, b) => b.id - a.id), [proposals]);
  const shown = useMemo(() => all.filter((p) => inFilter(p, filter, today)), [all, filter, today]);
  const countOf = (f: ProposalFilter) => counts?.[f] ?? all.filter((p) => inFilter(p, f, today)).length;
  const out = all.filter((p) => p.status === "sent" && !isOutOfDate(p, today));
  const currency = out.find((p) => p.currency !== null)?.currency ?? null;

  const items: FilterItem<ProposalFilter>[] = PROPOSAL_FILTERS.map((f) => ({ id: f, label: t(`proposals.filter.${f}` as MessageKey), count: countOf(f) }));

  return (
    <section className="screen ol-screen" data-screen="proposals" aria-labelledby="proposals-title">
      <div className="screen-head">
        <div>
          <h1 className="screen-title" id="proposals-title">
            {t("nav.proposals")}
          </h1>
          <p className="screen-lead">
            {t("proposals.lead", { out: counts?.sent ?? out.length, sum: money(sumDecimals(out.map((p) => p.total)), currency) }, countOf("all"))}
          </p>
        </div>
        <span className="screen-actions">
          <Button kind="primary" icon={SquarePen} onClick={() => openComposer({ kind: "proposal", id: null })}>
            {t("proposals.new")}
          </Button>
        </span>
      </div>
      <Filters items={items} value={filter} onChange={setFilter} label={t("proposals.filters")} />
      <DocList label={t("proposals.list")}>
        {shown.map((p) => (
          <DocRow
            key={p.id}
            number={p.number ?? "—"}
            title={p.title.trim() === "" ? <span className="prop-untitled">{t("proposals.untitled")}</span> : p.title}
            sub={clients[p.client_id]?.company ?? ""}
            due={<time className="when" dateTime={p.valid_until ?? undefined}>{dayWithYear(p.valid_until, locale)}</time>}
            amount={<Money value={p.total} currency={p.currency} />}
            pill={<StatusPill status={proposalWord(p, today)} />}
            onOpen={() => openProposal(p)}
          />
        ))}
        {shown.length === 0 && <Empty title={t("proposals.empty")} body={t("proposals.emptyBody")} />}
      </DocList>
    </section>
  );
}
