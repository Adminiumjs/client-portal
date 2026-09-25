/**
 * The deliverable review, the studio's side: the file itself on the stage with
 * the pins said on it, its versions (one at a time, or two side by side to
 * compare), what was said (the client's notes and the studio's), writing back
 * — with a pin when one was dropped — posting a new version, and what the
 * client's side stands at: mark it approved when they approved outside the
 * portal, share it when it isn't yet, or preview it as they see it.
 *
 * Pins belong to a version: a new version starts clean.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Check, ChevronRight, CircleCheck, Columns2, Eye, History, MessagesSquare, Send, Share2, Upload } from "lucide-react";

import type { DeliverableVersion, Id } from "../data/types.ts";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { Avatar, Button, Empty, When } from "../components/ui.tsx";
import { addStudioNote, shareDeliverable } from "../state/actions.ts";
import { ensureRows, loadDeliverable, useCan, useDesk, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { previewClient } from "../state/preview.ts";
import { openSheet } from "../state/sheets.ts";
import { go, open, toast, useUi } from "../state/ui.ts";
import { deliverablePill, firstName } from "./project/model.ts";
import { useFileInfo } from "./review/files.ts";
import { approvedLine, notesOf, pinForNote, pinHint, pinsOf, pinValue, reviewMoves, versionNumber, versionsOf, type Pin, type Point } from "./review/model.ts";
import { Stage } from "./review/Stage.tsx";

const HOW: Record<"email" | "call" | "meeting", MessageKey> = { email: "review.approved.byEmail", call: "review.approved.onCall", meeting: "review.approved.inPerson" };
const PILL_TONE: Record<string, string> = { notShared: "", pending: " pill--info", approved: " pill--pos", changes: " pill--warn" };

export default function Review() {
  const { t, locale, number } = useI18n();
  const id = useUi((s) => s.selected.deliverable);
  const deliverable = useRow("deliverables", id);
  const project = useRow("projects", deliverable?.project_id);
  const client = useRow("clients", project?.client_id);
  const allVersions = useRows("deliverable_versions");
  const allNotes = useRows("deliverable_notes");
  const canNote = useCan("deliverable_notes", "create");
  const canPost = useCan("deliverable_versions", "create");
  const canMove = useCan("deliverables", "update");
  const [loaded, setLoaded] = useState(false);
  const [chosen, setChosen] = useState<Id | null>(null);
  const [compare, setCompare] = useState(false);
  const [unworded, setUnworded] = useState<Record<Id, Point[]>>({});
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    if (id === null) return;
    setLoaded(false);
    setChosen(null);
    setCompare(false);
    void loadDeliverable(id)
      .then(async () => {
        const d = useDesk.getState().rows.deliverables[id];
        const p = d === undefined ? undefined : useDesk.getState().rows.projects[d.project_id];
        if (p !== undefined) await ensureRows("clients", [p.client_id]);
      })
      .finally(() => setLoaded(true));
  }, [id]);

  const versions = useMemo(() => (id === null ? [] : versionsOf(allVersions, id)), [allVersions, id]);
  const notes = useMemo(() => (id === null ? [] : notesOf(allNotes, id)), [allNotes, id]);
  const newest = versions.at(-1);
  // A version just posted is the one to look at.
  useEffect(() => {
    setChosen(null);
    setCompare(false);
  }, [versions.length]);
  const current = versions.find((v) => v.id === chosen) ?? newest;
  const at = current === undefined ? -1 : versions.indexOf(current);
  const previous = at > 0 ? versions[at - 1] : undefined;
  const comparing = compare && previous !== undefined;
  const label = (v: DeliverableVersion) => `v${String(versionNumber(v, versions))}`;
  const waiting = current === undefined ? [] : (unworded[current.id] ?? []);
  const pins = current === undefined ? [] : pinsOf(notes, current.id, waiting);
  const onDrawable = useCallback((yes: boolean) => setDrawn(yes), []);
  const newestInfo = useFileInfo(newest?.file ?? newest?.link ?? null);

  if (deliverable === undefined || id === null) {
    return (
      <section className="screen ol-screen" data-screen="review" aria-labelledby="review-title">
        <button type="button" className="prj-back ol-gi" onClick={() => go("projects")}>
          <ArrowLeft size={14} aria-hidden="true" />
          {t("projects.page.back")}
        </button>
        <h1 className="ol-sr-only" id="review-title">
          {t("screen.review")}
        </h1>
        {(id === null || loaded) && <Empty title={t("review.missing")} body={t("projects.page.missingBody")} />}
      </section>
    );
  }

  const first = firstName(client?.contact_name);
  const moves = reviewMoves(deliverable);
  const line = approvedLine(deliverable);
  const pill = deliverablePill(deliverable);
  const fileName = newestInfo?.name ?? "";
  const sharedDay = deliverable.shared_at ?? current?.posted_at ?? null;
  const meta = [client?.company, project?.name, t("review.meta.versions", { count: number(versions.length) }, versions.length), sharedDay === null ? null : t("review.meta.shared", { day: dayLabel(sharedDay.slice(0, 10), locale) })].filter(
    (x): x is string => x !== undefined && x !== null && x !== "",
  );
  const waitingCount = waiting.length;
  const hint = pinHint(waitingCount);

  const drop = (point: Point) => {
    if (current === undefined) return;
    setUnworded((u) => ({ ...u, [current.id]: [...(u[current.id] ?? []), point] }));
    toast(t("review.pin.dropped", { n: pins.length + 1 }), { icon: "map-pin" });
  };
  const takeBack = (pin: Pin) => {
    if (current === undefined) return;
    const stored = pins.filter((p) => p.noteId !== null).length;
    setUnworded((u) => ({ ...u, [current.id]: (u[current.id] ?? []).filter((_, i) => i !== pin.n - stored - 1) }));
  };

  const send = async () => {
    const body = message.trim();
    if (body === "") {
      toast(t("review.thread.nothing"), { icon: "pencil-line" });
      return;
    }
    const pin = pinForNote(waiting);
    setSending(true);
    const out = await addStudioNote(deliverable.id, { version_id: current?.id ?? null, body, pin_x: pin === null ? null : pinValue(pin.x), pin_y: pin === null ? null : pinValue(pin.y) });
    setSending(false);
    if (!out.ok) {
      toast(t(refusalKey(out.reason), { id: "" }), { icon: "circle-alert", tone: "danger" });
      return;
    }
    setMessage("");
    if (pin !== null && current !== undefined) setUnworded((u) => ({ ...u, [current.id]: (u[current.id] ?? []).slice(0, -1) }));
    toast(t("review.thread.sent", { file: fileName || deliverable.title }), { icon: "message-square" });
  };

  const share = async () => {
    setSharing(true);
    const out = await shareDeliverable(deliverable.id);
    setSharing(false);
    if (!out.ok) return toast(t(refusalKey(out.reason), { id: "" }), { icon: "circle-alert", tone: "danger" });
    toast(t("projects.deliverables.shared", { first }), { icon: "share-2" });
  };

  const preview = () => {
    if (project === undefined) return;
    useUi.setState((s) => ({ selected: { ...s.selected, project: project.id } }));
    void previewClient(project.client_id, "review", "review");
  };

  const shown = comparing && previous !== undefined && current !== undefined ? [previous, current] : current === undefined ? [] : [current];

  return (
    <section className="screen ol-screen rv-page" data-screen="review" aria-labelledby="review-title">
      <div className="rv-headline">
        <button type="button" className="prj-back ol-gi" onClick={() => (project === undefined ? go("projects") : open("project", project.id))}>
          <ArrowLeft size={14} aria-hidden="true" />
          {project?.number ?? t("projects.page.back")}
        </button>
        {fileName !== "" && <span className="rv-file">{fileName}</span>}
        <span className={`pill${PILL_TONE[pill] ?? ""}`}>{t(`status.${pill}`)}</span>
      </div>
      <div>
        <h1 className="prj-title rv-title" id="review-title">
          {deliverable.title}
        </h1>
        <p className="prj-meta">{meta.join(" · ")}</p>
      </div>

      <div className="rv-cols">
        <div className="rv-main">
          <section className="card rv-stage-card" aria-label={t("review.stage.label")}>
            <div className="rv-toolbar">
              {versions.length > 0 && (
                <div className="rv-chips" role="group" aria-label={t("review.versions.pick")}>
                  {[...versions].reverse().map((v) => (
                    <button key={v.id} type="button" className="rv-chip ol-chip" aria-pressed={v.id === current?.id} onClick={() => { setChosen(v.id); setCompare(false); }}>
                      {label(v)}
                    </button>
                  ))}
                </div>
              )}
              <button type="button" className="btn btn--small ol-gi rv-compare" aria-pressed={comparing} disabled={previous === undefined} onClick={() => setCompare((c) => !c)}>
                <Columns2 size={14} aria-hidden="true" />
                {t(comparing ? "review.versions.single" : "review.versions.compare")}
              </button>
              {current !== undefined && (
                <span className="rv-vmeta">
                  {[label(current), current.posted_by, current.posted_at === null ? null : dayLabel(current.posted_at.slice(0, 10), locale)].filter((x) => x !== null && x !== "").join(" · ")}
                </span>
              )}
            </div>
            {current !== undefined && <div className="rv-hint">{drawn ? t(`review.pin.hint.${hint}` as MessageKey, { count: number(waitingCount) }, waitingCount) : t("review.pin.hint.cannot")}</div>}
            {current === undefined ? (
              <p className="prj-panel-empty">{t("review.versions.none")}</p>
            ) : (
              <div className={`rv-stages${comparing ? " rv-stages--two" : ""}`}>
                {shown.map((v) => (
                  <figure key={v.id} className="rv-figure">
                    <Stage
                      version={v}
                      label={label(v)}
                      pins={v.id === current.id ? pins : null}
                      onDrop={v.id === current.id && canNote ? drop : undefined}
                      onTakeBack={takeBack}
                      compact={comparing}
                      tint={client?.tint ?? null}
                      onDrawable={v.id === current.id ? onDrawable : undefined}
                    />
                    <figcaption className="rv-caption">
                      <span className="rv-caption-by">{[v.posted_by, v.posted_at === null ? null : dayLabel(v.posted_at.slice(0, 10), locale)].filter((x) => x !== null && x !== "").join(" · ")}</span>
                      {v.note !== null && v.note !== "" && <span className="rv-caption-note">{v.note}</span>}
                    </figcaption>
                  </figure>
                ))}
              </div>
            )}
          </section>

          <section className="card rv-panel" aria-labelledby="rv-versions-title">
            <div className="prj-panel-head">
              <History size={15} aria-hidden="true" />
              <h2 id="rv-versions-title">{t("review.versions.title")}</h2>
            </div>
            <ul className="rv-history" role="list">
              {[...versions].reverse().map((v) => (
                <li key={v.id}>
                  <button type="button" className="rv-history-row ol-row" aria-current={v.id === current?.id ? "true" : undefined} onClick={() => { setChosen(v.id); setCompare(false); }}>
                    <span className="rv-history-v">{label(v)}</span>
                    <span className="rv-history-main">
                      <span className="rv-history-note">{v.note ?? t("review.versions.noNote")}</span>
                      <span className="rv-history-meta">
                        {[v.posted_by, v.posted_at === null ? null : dayLabel(v.posted_at.slice(0, 10), locale, "long"), v.id === newest?.id ? t("review.versions.current") : null].filter((x) => x !== null && x !== "").join(" · ")}
                      </span>
                    </span>
                    {v.id === current?.id ? <Eye size={15} aria-hidden="true" className="rv-history-eye" /> : <ChevronRight size={15} aria-hidden="true" className="rv-history-eye rv-history-go" />}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section className="card rv-panel rv-said" aria-labelledby="rv-said-title">
          <div className="prj-panel-head">
            <MessagesSquare size={15} aria-hidden="true" />
            <h2 id="rv-said-title">{t("review.thread.title")}</h2>
            <span className="rv-count">{t("review.thread.count", { count: number(notes.length) }, notes.length)}</span>
          </div>
          <div className="rv-said-body">
            {notes.length === 0 ? (
              <p className="rv-quiet">{t("review.thread.empty")}</p>
            ) : (
              <ol className="rv-thread">
                {notes.map((note) => {
                  const studio = note.side === "studio";
                  const pin = current === undefined ? undefined : pins.find((p) => p.noteId === note.id);
                  const onOther = note.version_id !== null && current !== undefined && note.version_id !== current.id ? versions.find((v) => v.id === note.version_id) : undefined;
                  return (
                    <li key={note.id} className={`rv-note${studio ? " rv-note--studio" : ""}`}>
                      <div className="rv-note-head">
                        <Avatar name={note.author ?? "?"} size={22} tint={studio ? null : (client?.tint ?? null)} />
                        <span className="rv-note-who">{note.author ?? t(studio ? "review.thread.studio" : "review.thread.client")}</span>
                        {pin !== undefined && <span className="rv-note-pin">{t("review.thread.pin", { n: pin.n })}</span>}
                        {onOther !== undefined && <span className="rv-note-pin">{label(onOther)}</span>}
                        <span className="rv-note-at">
                          <When at={note.at} opts={{ day: "numeric", month: "short" }} />
                        </span>
                      </div>
                      <p className="rv-note-body">{note.body}</p>
                    </li>
                  );
                })}
              </ol>
            )}
            {canNote && (
              <>
                <label className="ol-sr-only" htmlFor="rv-write">
                  {t("review.thread.writeLabel")}
                </label>
                <textarea id="rv-write" className="input rv-write" rows={3} value={message} maxLength={2000} placeholder={t("review.thread.placeholder")} onChange={(e) => setMessage(e.target.value)} />
              </>
            )}
            <div className="rv-row">
              {canNote && (
                <Button icon={Send} busy={sending} onClick={() => void send()}>
                  {t("review.thread.send")}
                </Button>
              )}
              {canPost && (
                <Button kind="primary" icon={Upload} onClick={() => openSheet({ kind: "version", deliverableId: deliverable.id })}>
                  {t("review.thread.newVersion")}
                </Button>
              )}
            </div>
            <div className="rv-rule" />
            <span className="rv-kicker">{t("review.side.title")}</span>
            <div className="rv-row">
              {moves.share && canMove && (
                <Button icon={Share2} busy={sharing} onClick={() => void share()}>
                  {t("review.side.share", { first })}
                </Button>
              )}
              {moves.markApproved && canMove && (
                <Button icon={Check} onClick={() => openSheet({ kind: "markApproved", deliverableId: deliverable.id })}>
                  {t("sheetName.markApproved")}
                </Button>
              )}
              {deliverable.status !== "unshared" && (
                <Button icon={Eye} onClick={preview}>
                  {t("projects.page.preview")}
                </Button>
              )}
            </div>
            {line !== null && (
              <span className="rv-approved">
                <CircleCheck size={15} aria-hidden="true" />
                {line.kind === "portal"
                  ? t("review.approved.portal", { who: line.who, day: dayLabel(line.day, locale) })
                  : t("review.approved.studio", { how: t(HOW[line.how]), day: dayLabel(line.day, locale), who: line.who })}
              </span>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}
