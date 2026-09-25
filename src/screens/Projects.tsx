/**
 * The Projects board: every running, paused and finished project, as cards in
 * three columns — the client, the project, how far along it is (a ring worked
 * out from its milestones), its number, "{done} of {n} milestones", and what
 * comes next (or when it was delivered).
 *
 * Running and paused projects are in the desk's open work already; finished
 * ones are read here, the newest first, with their milestones.
 */
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, FolderPlus } from "lucide-react";

import type { Id, Project } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { Button, ScreenHead } from "../components/ui.tsx";
import { loadPage, loadWhere, useRows } from "../state/desk.ts";
import { openSheet } from "../state/sheets.ts";
import { open } from "../state/ui.ts";
import { BOARD_GROUPS, boardGroups, doneCount, lastDue, milestonesOf, nextMilestone, progress, ringTone, type BoardGroup } from "./project/model.ts";
import { Ring } from "./project/Ring.tsx";

/** How many finished projects the board shows. */
const DONE_SHOWN = 24;

const EMPTY: Record<BoardGroup, MessageKey> = { active: "projects.board.emptyActive", paused: "projects.board.emptyPaused", done: "projects.board.emptyDone" };

export default function Projects() {
  const { t, number, locale } = useI18n();
  const projects = useRows("projects");
  const milestones = useRows("milestones");
  const clients = useRows("clients");
  const [doneTotal, setDoneTotal] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await loadPage("projects", { where: { column: "status", op: "eq", value: "done" }, order: "done_on.desc", limit: DONE_SHOWN, offset: 0, count: true });
        if (live) setDoneTotal(page.total);
        if (page.ids.length > 0) await loadWhere("milestones", { column: "project_id", op: "in", value: page.ids }, "position.asc");
      } catch {
        // The board still shows the open work; the finished ones come with the next visit.
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const groups = useMemo(() => boardGroups(projects), [projects]);
  const counts = { active: groups.active.length, paused: groups.paused.length, done: Math.max(doneTotal ?? 0, groups.done.length) };
  const companyOf = (id: Id) => clients.find((c) => c.id === id)?.company ?? "";

  return (
    <section className="screen ol-screen prj-board-screen" data-screen="projects" aria-labelledby="projects-title">
      <ScreenHead
        id="projects-title"
        title={t("nav.projects")}
        lead={t("projects.board.lead", { active: number(counts.active), paused: number(counts.paused), done: number(counts.done) })}
        actions={
          <Button kind="primary" icon={FolderPlus} onClick={() => openSheet({ kind: "add", what: "project" })}>
            {t("projects.board.new")}
          </Button>
        }
      />
      <div className="prj-board">
        {BOARD_GROUPS.map((group) => {
          const list = group === "done" ? groups.done.slice(0, DONE_SHOWN) : groups[group];
          const headId = `prj-group-${group}`;
          return (
            <section key={group} className="prj-group" aria-labelledby={headId}>
              <h2 className="prj-group-head" id={headId}>
                <span className={`prj-dot prj-dot--${group}`} aria-hidden="true" />
                <span className="prj-group-label">{t(`status.${group}`)}</span>
                <span className="prj-group-count">{number(counts[group])}</span>
              </h2>
              {list.length === 0 ? (
                <div className="prj-group-empty">{t(EMPTY[group])}</div>
              ) : (
                <ul className="prj-cards" role="list">
                  {list.map((p) => (
                    <li key={p.id}>
                      <BoardCard project={p} company={companyOf(p.client_id)} milestones={milestonesOf(milestones, p.id)} locale={locale} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

function BoardCard({ project, company, milestones, locale }: { project: Project; company: string; milestones: ReturnType<typeof milestonesOf>; locale: string }) {
  const { t, number } = useI18n();
  const pct = progress(milestones);
  const next = nextMilestone(milestones);
  const delivered = project.done_on ?? lastDue(milestones);
  const line =
    next !== undefined
      ? next.due_on === null
        ? t("projects.card.nextUndated", { title: next.title })
        : t("projects.card.next", { title: next.title, day: dayLabel(next.due_on, locale) })
      : milestones.length === 0
        ? t("projects.card.noMilestones")
        : project.status !== "done" || delivered === null
          ? t("projects.card.allDone")
          : t("projects.card.delivered", { day: dayLabel(delivered, locale) });
  const Icon = next !== undefined || milestones.length === 0 ? CalendarDays : Check;
  return (
    <button type="button" className="prj-card ol-card" onClick={() => open("project", project.id)} data-project={project.id}>
      <span className="prj-card-top">
        <span className="prj-card-names">
          <span className="prj-card-client">{company}</span>
          <span className="prj-card-title">{project.name}</span>
        </span>
        <Ring pct={pct} tone={ringTone(project, pct)} size="small" label={t("projects.ring", { pct: number(pct) })} />
      </span>
      <span className="prj-card-meta">
        <span className="prj-chip-id">{project.number ?? t("projects.noNumber")}</span>
        <span className="prj-card-ms">{t("projects.card.milestones", { done: number(doneCount(milestones)), total: number(milestones.length) }, milestones.length)}</span>
      </span>
      <span className="prj-card-next">
        <Icon size={13} aria-hidden="true" />
        {line}
      </span>
    </button>
  );
}
