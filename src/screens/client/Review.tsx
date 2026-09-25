/**
 * The client's review of one shared deliverable: the latest version's file
 * (open it, or download it), the studio's note on it, the pins the studio put
 * on it (placed where they sit on the drawing, as a share of its width and
 * height), what was said so far and a box to write back, then Approve /
 * Request changes while it waits for them — and the earlier versions, folded.
 */
import { useCallback, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronUp, CircleCheck, Download, History, Hourglass, MapPin, MessagesSquare, Send } from "lucide-react";

import { Alert, Button, StatusPill, When } from "../../components/ui.tsx";
import type { Tables } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { initials } from "../../lib/initials.ts";
import { studioZone } from "../../lib/clock.ts";
import { writeBack } from "../../state/clientActions.ts";
import { loadClientDeliverable, usePortal, usePortalRow, usePortalRows } from "../../state/portal.ts";
import { open, toast } from "../../state/ui.ts";
import NotFound from "./NotFound.tsx";
import { Decide } from "./review/Decide.tsx";
import { pinsOn, thread } from "./review/model.ts";
import { Section, Tile, useDay, useSelected } from "./shared/bits.tsx";
import { dayOf, versionFile, versionLabel, versionsOf } from "./shared/model.ts";
import { portOrNull, sayRefusal, useOpened, useSignedIn } from "./shared/page.ts";

/** Where a version's file opens: a short-lived private link to the stored file, else the link the studio shared. */
export function fileHref(v: Tables["deliverable_versions"] | undefined): string | null {
  if (v === undefined) return null;
  if (v.file !== null && v.file !== "") {
    try {
      const url = portOrNull()?.fileUrl("deliverable_versions", v.id, "file");
      if (url !== undefined && url !== "") return url;
    } catch {
      // No private links on this client: fall back to the shared link, if any.
    }
  }
  return v.link !== null && v.link !== "" ? v.link : null;
}

export default function Review() {
  const { t, number } = useI18n();
  const date = useDay();
  const signedIn = useSignedIn();
  const id = useSelected("deliverable");
  const d = usePortalRow("deliverables", id);
  const ready = useOpened(id, loadClientDeliverable, d !== undefined);
  const project = usePortalRow("projects", d?.project_id ?? null);
  const studio = usePortal((s) => s.studio?.settings?.name ?? "");
  const allVersions = usePortalRows("deliverable_versions");
  const allNotes = usePortalRows("deliverable_notes");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [earlierOpen, setEarlierOpen] = useState(false);
  const reread = useCallback(() => void (id === null ? undefined : loadClientDeliverable(id).catch(() => undefined)), [id]);

  if (!signedIn) return null;
  if (!ready) return <section className="screen ol-screen cl-page" data-screen="client-review" aria-busy="true" />;
  if (d === undefined || d.status === "unshared") return <NotFound />;

  const zone = studioZone();
  const versions = versionsOf(allVersions, d.id);
  const current = versions[0];
  const earlier = versions.slice(1);
  const file = versionFile(current);
  const href = fileHref(current);
  const pins = current === undefined ? [] : pinsOn(allNotes, current.id);
  const said = thread(allNotes, d.id);
  const status = d.status === "approved" ? "approved" : d.status === "changes" ? "changes" : "pending";

  const send = async () => {
    const body = message.trim();
    if (body === "") {
      toast(t("client.review.nothingWritten"), { icon: "info" });
      return;
    }
    if (busy) return;
    setBusy(true);
    const out = await writeBack(d.id, current?.id ?? null, body);
    setBusy(false);
    if (out.ok) {
      setMessage("");
      setError(null);
      toast(t("client.review.sentTo", { studio }), { icon: "mail" });
      return;
    }
    setError(sayRefusal(t, out));
  };

  const approvedLine =
    d.approved_how === "portal" && d.approved_on !== null
      ? t("client.review.youApproved", { date: date(d.approved_on) })
      : d.approved_on !== null && d.approved_how !== null
        ? t(`client.review.approvedHow.${d.approved_how}`, { date: date(d.approved_on) })
        : t("status.approved");

  return (
    <section className="screen ol-screen cl-page" data-screen="client-review" aria-labelledby="cl-review-title">
      {project !== undefined && (
        <button type="button" className="btn ol-gi btn--small cl-back" onClick={() => open("project", project.id)}>
          <ArrowLeft size={14} aria-hidden="true" />
          {project.name}
        </button>
      )}
      <div className="cl-card cl-review">
        <div className="cl-review-head">
          <div className="cl-doc-line">
            {file !== "" && <span className="cl-doc-number">{file}</span>}
            <StatusPill status={status} />
            {current !== undefined && (
              <span className="cl-doc-dates">
                {t("client.review.versionLine", { v: versionLabel(current, versions), date: date(dayOf(d.shared_at ?? current.posted_at, zone)) })}
              </span>
            )}
          </div>
          <h1 className="cl-doc-title cl-doc-title--sm" id="cl-review-title">
            {d.title}
          </h1>
        </div>
        <div className="cl-review-body">
          <div className="cl-art">
            {href !== null ? (
              <a className="cl-art-tile ol-gi" href={href} target="_blank" rel="noopener noreferrer" aria-label={t("client.review.openFile", { file: file || d.title })}>
                <Tile icon={d.icon} size={72} />
                {pins.map((pin) => (
                  <span key={pin.id} className="cl-pin" aria-hidden="true" style={{ insetBlockStart: `${pin.y}%`, insetInlineStart: `${pin.x}%` }}>
                    {pin.n}
                  </span>
                ))}
              </a>
            ) : (
              <span className="cl-art-tile">
                <Tile icon={d.icon} size={72} />
                {pins.map((pin) => (
                  <span key={pin.id} className="cl-pin" aria-hidden="true" style={{ insetBlockStart: `${pin.y}%`, insetInlineStart: `${pin.x}%` }}>
                    {pin.n}
                  </span>
                ))}
              </span>
            )}
            {href !== null && (
              <a className="icon-btn cl-art-download ol-gi" href={href} download target="_blank" rel="noopener noreferrer" aria-label={t("client.review.download", { file: file || d.title })} title={t("client.review.download", { file: file || d.title })}>
                <Download size={16} aria-hidden="true" />
              </a>
            )}
          </div>
          {current?.note !== null && current?.note !== undefined && current.note.trim() !== "" && <span className="cl-muted cl-body">{current.note}</span>}
        </div>
      </div>

      {pins.length > 0 && (
        <Section icon={MapPin} title={t("client.review.pins")} id="cl-review-pins">
          <ol className="cl-pins">
            {pins.map((pin) => (
              <li key={pin.id} className="cl-pin-row">
                <span className="cl-pin cl-pin--static" aria-hidden="true">
                  {pin.n}
                </span>
                <span>{pin.body}</span>
              </li>
            ))}
          </ol>
        </Section>
      )}

      <Section icon={MessagesSquare} title={t("client.review.said")} end={<span className="cl-mono-count">{t("client.review.notes", { count: number(said.length) }, said.length)}</span>} id="cl-review-said">
        <div className="cl-pad cl-stack-tight">
          {said.length === 0 && <span className="cl-subtle">{t("client.review.nothingSaid")}</span>}
          {said.map((n) => (
            <div key={n.id} className={`cl-msg cl-msg--${n.side === "studio" ? "studio" : "client"}`}>
              <span className="cl-msg-head">
                <span className="cl-msg-ini" aria-hidden="true">
                  {initials(n.author)}
                </span>
                <span className="cl-msg-who">{n.author}</span>
                <span className="cl-msg-at">
                  <When at={n.at} opts={{ day: "numeric", month: "short" }} />
                </span>
              </span>
              <span className="cl-msg-body">{n.body}</span>
            </div>
          ))}
          <label className="cl-field">
            <span className="cl-label">{t("client.review.writeBack")}</span>
            <textarea className="input ol-fld" rows={3} placeholder={t("client.review.plainWords")} value={message} onChange={(e) => setMessage(e.target.value)} />
          </label>
          {error !== null && <Alert>{error}</Alert>}
          <div className="cl-row">
            <Button icon={Send} busy={busy} onClick={() => void send()}>
              {t("client.review.send")}
            </Button>
          </div>
        </div>
      </Section>

      <div className="cl-card cl-pad cl-stack-tight">
        {d.status === "pending" && <Decide deliverableId={d.id} versionId={current?.id ?? null} size="page" onSettled={reread} />}
        {d.status === "changes" && (
          <span className="cl-waiting-line cl-waiting-line--page">
            <Hourglass size={16} aria-hidden="true" />
            {t("client.review.waiting")}
          </span>
        )}
        {d.status === "approved" && (
          <span className="cl-approved-line">
            <CircleCheck size={16} aria-hidden="true" />
            {approvedLine}
          </span>
        )}
      </div>

      {earlier.length > 0 && (
        <section className="cl-card cl-section" aria-labelledby="cl-review-earlier">
          <button type="button" className="cl-fold ol-gi" aria-expanded={earlierOpen} aria-controls="cl-review-earlier-list" onClick={() => setEarlierOpen((v) => !v)}>
            <History size={15} aria-hidden="true" className="cl-section-icon" />
            <span className="cl-section-title" id="cl-review-earlier">
              {t("client.review.earlier")}
            </span>
            <span className="cl-mono-count">{earlier.length}</span>
            {earlierOpen ? <ChevronUp size={15} aria-hidden="true" className="cl-fold-chevron" /> : <ChevronDown size={15} aria-hidden="true" className="cl-fold-chevron" />}
          </button>
          {earlierOpen && (
            <ul className="cl-earlier" id="cl-review-earlier-list">
              {earlier.map((v) => (
                <li key={v.id} className="cl-earlier-row">
                  <span className="cl-mono-strong">{versionLabel(v, versions)}</span>
                  <span className="cl-earlier-text">
                    {v.note !== null && v.note.trim() !== "" && <span>{v.note}</span>}
                    <span className="cl-mono-small">{date(dayOf(v.posted_at, zone), "long")}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </section>
  );
}
