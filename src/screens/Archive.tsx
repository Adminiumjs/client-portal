/**
 * Archive: finished work by year.
 *
 * Every project marked done, grouped by the year it was finished: a chip per
 * year (with how many), a search over every year, what the finished work
 * came to, and the projects themselves — the client, the day it was
 * finished, what its sent invoices came to. Each opens its handover page,
 * which keeps what went to the client.
 *
 * The page reads the finished projects, their sent invoices and their
 * clients when it opens. Every amount is an invoice total Adminium stored;
 * the page only adds them up for display (`archive/model.ts`).
 */
import { useEffect, useMemo, useState } from "react";
import { Archive as ArchiveIcon, PackageCheck, Search } from "lucide-react";

import { Avatar, Filters } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { tenantCurrency } from "../i18n/ambient.ts";
import { dayLabel } from "../lib/dates.ts";
import type { Day } from "../data/types.ts";
import { useDesk, useDeskReads } from "../state/desk.ts";
import { open } from "../state/ui.ts";
import { loadArchive } from "./archive/load.ts";
import { byYear, finished, search, worth } from "./archive/model.ts";

/** The finished projects, their sent invoices and their clients, read when the desk knows its day (and again after a reconnect). */
function useFinished(today: string): boolean {
  const [loaded, setLoaded] = useState(false);
  const reads = useDeskReads();
  useEffect(() => {
    if (today === "") return;
    let live = true;
    void loadArchive()
      .catch(() => undefined)
      .finally(() => {
        if (live) setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [today, reads]);
  return loaded;
}

export default function Archive() {
  const { t, locale, money, number } = useI18n();
  const today = useDesk((s) => s.today);
  const rows = useDesk((s) => s.rows);
  const loaded = useFinished(today);
  const [picked, setPicked] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const currency = tenantCurrency();

  const dayText = (day: Day | null) => (day === null ? "" : dayLabel(day, locale, "long"));
  const items = useMemo(() => finished(Object.values(rows.projects), Object.values(rows.invoices), rows.clients, currency), [rows.projects, rows.invoices, rows.clients, currency]);
  const years = useMemo(() => byYear(items, currency), [items, currency]);
  const thisYear = today === "" ? null : Number(today.slice(0, 4));
  const yearKey = (year: number | null) => (year === null ? "none" : String(year));
  const selected = picked ?? (years.length === 0 ? "none" : yearKey(years[0]!.year));
  const group = years.find((g) => yearKey(g.year) === selected) ?? years[0];
  const searching = query.trim() !== "";
  // The screen's own search: words are matched in the page's language, over every year.
  const shown = searching ? search(items, query, dayText) : (group?.items ?? []);
  const yearCount = years.filter((g) => g.year !== null).length;

  const lead =
    items.length === 0
      ? t("archive.leadNone")
      : t("archive.lead", {
          projects: t("archive.projects", { count: number(items.length) }, items.length),
          years: t("archive.years", { count: number(yearCount) }, yearCount),
          sum: money(worth(items, currency), currency),
        });
  const head = searching ? t("archive.matching", { query: query.trim() }) : group === undefined ? t("archive.thisYear") : group.year === thisYear ? t("archive.thisYear") : group.year === null ? t("archive.noYear") : String(group.year);

  return (
    <section className="screen ol-screen archive" data-screen="archive" aria-labelledby="archive-title">
      <div>
        <h1 className="screen-title archive-title" id="archive-title">
          {t("nav.archive")}
        </h1>
        <p className="archive-lead">{lead}</p>
      </div>

      <div className="archive-tools">
        {years.length > 0 && (
          <Filters
            label={t("archive.yearsLabel")}
            items={years.map((g) => ({ id: yearKey(g.year), label: g.year === null ? t("archive.noYear") : String(g.year), count: g.items.length }))}
            value={selected}
            onChange={(id) => {
              setPicked(id);
              setQuery("");
            }}
          />
        )}
        <div className="archive-search">
          <Search size={14} className="archive-search-icon" aria-hidden="true" />
          <input
            className="ol-fld archive-search-input"
            type="search"
            value={query}
            aria-label={t("archive.searchLabel")}
            placeholder={t("archive.searchPlaceholder", { count: number(Math.max(1, yearCount)) }, Math.max(1, yearCount))}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      {items.length > 0 && (
        <div className="archive-kinds">
          <span className="archive-kind card">
            <span className="archive-kind-name">{t("archive.kindDelivered")}</span>
            <span className="archive-kind-count">{number(items.length)}</span>
            <span className="archive-kind-value">{money(worth(items, currency), currency)}</span>
          </span>
        </div>
      )}

      <section className="card archive-panel" aria-labelledby="archive-head">
        <div className="archive-panel-head">
          <ArchiveIcon size={15} aria-hidden="true" />
          <h2 id="archive-head">{head}</h2>
          <span className="archive-sum">{t("archive.sum", { projects: t("archive.projectsShort", { count: number(shown.length) }, shown.length), sum: money(worth(shown, currency), currency) })}</span>
        </div>
        {!loaded && items.length === 0 ? (
          <div className="archive-none">{t("common.loading")}</div>
        ) : shown.length === 0 ? (
          <div className="archive-none">{searching ? t("archive.noMatch", { query: query.trim() }) : t("archive.none")}</div>
        ) : (
          <ul className="archive-list" role="list">
            {shown.map((i) => (
              <li key={i.project.id}>
                <button type="button" className="archive-row ol-row" onClick={() => open("handover", i.project.id)}>
                  <Avatar name={i.client?.company ?? i.project.name} tint={i.client?.tint} size={34} />
                  <span className="archive-row-text">
                    <span className="archive-row-title">{i.project.name}</span>
                    <span className="archive-row-sub">{t("archive.rowSub", { company: i.client?.company ?? "", day: dayText(i.day) })}</span>
                  </span>
                  <span className="archive-row-kind">{t("archive.kindDelivered")}</span>
                  <span className="archive-row-value">{money(i.value, currency)}</span>
                  <PackageCheck size={15} className="archive-row-icon" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="archive-note">{t("archive.note")}</p>
    </section>
  );
}
