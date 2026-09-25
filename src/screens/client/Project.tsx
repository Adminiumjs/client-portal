/**
 * One of the client's projects: how far along it is, where the work is
 * (its milestones), and what the studio has shared for the client's review —
 * each with Open, Approve and Request changes while it waits for them, or
 * "Waiting for the next version" once they have asked for changes.
 *
 * A paused project says so above everything, with the studio's note.
 */
import { useCallback } from "react";
import { Check, Dot, Eye, Hourglass, Milestone as MilestoneIcon, Paperclip, Pause } from "lucide-react";

import { StatusPill } from "../../components/ui.tsx";
import type { Tables } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { studioZone } from "../../lib/clock.ts";
import { loadClientProject, usePortal, usePortalRow, usePortalRows } from "../../state/portal.ts";
import { open } from "../../state/ui.ts";
import NotFound from "./NotFound.tsx";
import { Decide } from "./review/Decide.tsx";
import { AlsoWith, Ring, Section, Tile, useDay, useDueIn, useSelected } from "./shared/bits.tsx";
import { byPosition, dayOf, milestonesOf, nextMilestone, progress, versionFile, versionsOf } from "./shared/model.ts";
import { useOpened, useSignedIn } from "./shared/page.ts";

function DeliverableCard({ d, versions, reread }: { d: Tables["deliverables"]; versions: Tables["deliverable_versions"][]; reread: () => void }) {
  const { t } = useI18n();
  const date = useDay();
  const latest = versionsOf(versions, d.id)[0];
  const file = versionFile(latest);
  const zone = studioZone();
  const status = d.status === "approved" ? "approved" : d.status === "changes" ? "changes" : "pending";
  const when =
    d.status === "approved"
      ? t("client.project.approvedOn", { date: date(d.approved_on ?? dayOf(d.reviewed_at, zone)) })
      : d.status === "changes"
        ? t("client.project.changesOn", { date: date(dayOf(d.reviewed_at, zone)) })
        : t("client.project.sharedOn", { date: date(dayOf(d.shared_at, zone)) });
  return (
    <li className="cl-deliv ol-card">
      <Tile icon={d.icon} className="cl-deliv-tile">
        {file !== "" && <span className="cl-deliv-chip">{file}</span>}
        <span className="cl-deliv-badge">
          <StatusPill status={status} />
        </span>
      </Tile>
      <div className="cl-deliv-body">
        <span className="cl-deliv-title">{d.title}</span>
        <span className="cl-deliv-when">{when}</span>
        {d.review_note !== null && d.review_note.trim() !== "" && d.status === "changes" && <span className="cl-deliv-note">{d.review_note}</span>}
        <button type="button" className="btn ol-gi cl-btn-block btn--small" aria-label={t("client.project.openFile", { file: file === "" ? d.title : file })} onClick={() => open("review", d.id)}>
          <Eye size={15} aria-hidden="true" />
          {t("client.project.open")}
        </button>
        {d.status === "changes" && (
          <span className="cl-waiting-line">
            <Hourglass size={13} aria-hidden="true" />
            {t("client.review.waiting")}
          </span>
        )}
        {d.status === "pending" && <Decide deliverableId={d.id} versionId={latest?.id ?? null} onSettled={reread} />}
      </div>
    </li>
  );
}

export default function Project() {
  const { t } = useI18n();
  const signedIn = useSignedIn();
  const id = useSelected("project");
  const project = usePortalRow("projects", id);
  const ready = useOpened(id, loadClientProject, project !== undefined);
  const studio = usePortal((s) => s.studio?.settings?.name ?? "");
  const allMilestones = usePortalRows("milestones");
  const allDeliverables = usePortalRows("deliverables");
  const versions = usePortalRows("deliverable_versions");
  const dueIn = useDueIn();
  const date = useDay();
  const reread = useCallback(() => void (id === null ? undefined : loadClientProject(id).catch(() => undefined)), [id]);

  if (!signedIn) return null;
  if (!ready) return <section className="screen ol-screen cl-page" data-screen="client-project" aria-busy="true" />;
  if (project === undefined) return <NotFound />;

  const ms = milestonesOf(allMilestones, project.id);
  const pct = progress(ms);
  const next = nextMilestone(ms);
  // Only what was shared with them: the server never sends an unshared one, and the page never draws one.
  const shared = allDeliverables.filter((d) => d.project_id === project.id && d.status !== "unshared").sort(byPosition);
  const tone = project.status === "paused" ? "warn" : project.status === "done" ? "pos" : "accent";

  return (
    <section className="screen ol-screen cl-page" data-screen="client-project" aria-labelledby="cl-project-title">
      {project.status === "paused" && (
        <div className="cl-note cl-note--quiet" role="status">
          <Pause size={16} aria-hidden="true" />
          <span>
            {t("client.project.paused")}
            {project.pause_note !== null && project.pause_note.trim() !== "" && ` ${project.pause_note}`}
          </span>
        </div>
      )}
      <div className="cl-card cl-project-head">
        <Ring pct={pct} tone={tone} />
        <div className="cl-project-titles">
          <div className="cl-row-wrap">
            <StatusPill status={project.status} />
            {project.number !== null && <span className="cl-mono-small">{project.number}</span>}
          </div>
          <h1 className="cl-doc-title" id="cl-project-title">
            {project.name}
          </h1>
          <p className="cl-muted cl-small">
            {project.started_on !== null && t("client.project.since", { studio, date: date(project.started_on, "long") })}
            {project.started_on !== null && " · "}
            {next === undefined ? t("client.project.allDelivered") : t("client.project.nextUp", { milestone: next.title, due: dueIn(next.due_on) })}
          </p>
        </div>
      </div>

      <Section icon={MilestoneIcon} title={t("client.project.where")} id="cl-project-where">
        <ol className="cl-milestones">
          {ms.map((m) => (
            <li key={m.id} className="cl-milestone">
              <span className={`cl-ms-marker cl-ms-marker--${m.state}`} aria-hidden="true">
                {m.state === "done" ? <Check size={11} /> : m.state === "now" ? <Dot size={11} /> : null}
              </span>
              <span className="cl-ms-text">
                <span className={`cl-ms-title${m.state === "now" ? " cl-ms-title--now" : m.state === "done" ? " cl-ms-title--done" : ""}`}>{m.title}</span>
                <span className="cl-ms-state">{m.state === "done" ? t("status.done") : m.state === "now" ? t("client.project.inProgress", { due: dueIn(m.due_on) }) : t("client.project.notStarted", { due: dueIn(m.due_on) })}</span>
              </span>
              {m.due_on !== null && <span className="cl-ms-due">{date(m.due_on)}</span>}
            </li>
          ))}
        </ol>
      </Section>

      <Section icon={Paperclip} title={t("client.project.review")} id="cl-project-review">
        {shared.length === 0 ? (
          <div className="cl-pad">
            <div className="cl-dashed">{t("client.project.nothing")}</div>
          </div>
        ) : (
          <ul className="cl-delivs">
            {shared.map((d) => (
              <DeliverableCard key={d.id} d={d} versions={versions} reread={reread} />
            ))}
          </ul>
        )}
      </Section>

      <AlsoWith current={{ kind: "project", id: project.id }} />
    </section>
  );
}
