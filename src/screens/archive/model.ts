/**
 * The Archive, worked out from stored rows: every finished project (status
 * done), grouped by the year it was finished, with what it was worth — the
 * totals of its sent invoices (a void invoice or a draft was never worth
 * anything to the studio). Every total is the one Adminium stored; the page
 * only adds them for display.
 */
import type { Client, Day, Decimal, Id, Invoice, Project } from "../../data/types.ts";
import { minorUnits, sumDecimals } from "../../lib/money.ts";

export interface Finished {
  project: Project;
  client: Client | undefined;
  /** The day it was finished (its start when it names none). */
  day: Day | null;
  year: number | null;
  /** The totals of its sent invoices. */
  value: Decimal;
  invoices: number;
}

export interface YearGroup {
  year: number | null;
  items: Finished[];
  value: Decimal;
}

/** The finished projects, newest first, each with what its sent invoices came to. */
export function finished(projects: readonly Project[], invoices: readonly Invoice[], clients: Readonly<Record<Id, Client>>, currency: string | null): Finished[] {
  const scale = minorUnits(currency);
  return projects
    .filter((p) => p.status === "done")
    .map((project) => {
      const own = invoices.filter((i) => i.project_id === project.id && i.status === "sent");
      const day = project.done_on ?? project.started_on;
      return {
        project,
        client: clients[project.client_id],
        day,
        year: day === null ? null : Number(day.slice(0, 4)),
        value: sumDecimals(own.map((i) => i.total), scale),
        invoices: own.length,
      };
    })
    .sort((a, b) => (b.day ?? "").localeCompare(a.day ?? "") || b.project.id - a.project.id);
}

/** The finished projects by year, the newest year first. */
export function byYear(items: readonly Finished[], currency: string | null): YearGroup[] {
  const years = [...new Set(items.map((i) => i.year))].sort((a, b) => (b ?? 0) - (a ?? 0));
  return years.map((year) => {
    const own = items.filter((i) => i.year === year);
    return { year, items: own, value: sumDecimals(own.map((i) => i.value), minorUnits(currency)) };
  });
}

/** What was found by a search over every year: the project, its number, its client, its day. */
export function search(items: readonly Finished[], query: string, dayText: (day: Day | null) => string): Finished[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === "") return [...items];
  return items.filter((i) => [i.project.name, i.project.number ?? "", i.client?.company ?? "", i.client?.contact_name ?? "", dayText(i.day)].join(" ").toLocaleLowerCase().includes(q));
}

/** The sum of what a list of finished projects was worth. */
export const worth = (items: readonly Finished[], currency: string | null): Decimal => sumDecimals(items.map((i) => i.value), minorUnits(currency));
