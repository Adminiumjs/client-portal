/**
 * One version on the review's stage: the file itself, drawn — an image as it
 * is, a PDF's pages with pdf.js — with its pins on it. A file the page cannot
 * draw (an SVG, which is never shown inline; an archive; a link to somewhere
 * else) is a card with its name and a way to open or download it, and takes
 * no pins.
 *
 * A click on the drawing drops a pin there (percentages of the drawing, so it
 * lands in the same place at any width); the pin waits for words until
 * "Send note". A pin without words can be taken back by clicking it.
 */
import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, LoaderCircle } from "lucide-react";

import type { DeliverableVersion } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { DeliverableIcon } from "../project/DeliverableIcon.tsx";
import { drawable, iconFor, sizeLabel, useFileInfo, type FileInfo } from "./files.ts";
import { pointOf, type Pin, type Point } from "./model.ts";

export interface StageProps {
  version: DeliverableVersion;
  label: string;
  /** The pins to draw; null when this stage takes none (the older side of a compare). */
  pins: readonly Pin[] | null;
  onDrop?: (point: Point) => void;
  onTakeBack?: (pin: Pin) => void;
  compact: boolean;
  tint: string | null;
  /** Told whether this version can carry pins (its file is drawn). */
  onDrawable?: (yes: boolean) => void;
}

export function Stage({ version, label, pins, onDrop, onTakeBack, compact, onDrawable }: StageProps) {
  const { t } = useI18n();
  const info = useFileInfo(version.file ?? null);
  const isLink = (version.file ?? "") === "" && (version.link ?? "") !== "";
  const kind = isLink || info === null ? "none" : drawable(info.mime, info.name);
  const [failed, setFailed] = useState(false);
  const canDraw = kind !== "none" && info?.url != null && !failed;

  useEffect(() => {
    onDrawable?.(canDraw);
  }, [canDraw, onDrawable]);

  return (
    <div className={`rv-stage${compact ? " rv-stage--compact" : ""}`} data-version={version.id}>
      {canDraw && info !== null ? (
        <Drawing info={info} kind={kind} pins={pins} onDrop={onDrop} onTakeBack={onTakeBack} label={label} onFail={() => setFailed(true)} />
      ) : (
        <FileCard version={version} info={info} isLink={isLink} label={label} loading={!isLink && (version.file ?? "") !== "" && info === null} failed={failed} />
      )}
      <span className="rv-tag" aria-hidden="true">
        {label}
      </span>
      {pins === null ? null : <span className="ol-sr-only">{t("review.stage.pins", { count: pins.length }, pins.length)}</span>}
    </div>
  );
}

function Drawing({ info, kind, pins, onDrop, onTakeBack, label, onFail }: { info: FileInfo; kind: "image" | "pdf" | "none"; pins: readonly Pin[] | null; onDrop?: (p: Point) => void; onTakeBack?: (p: Pin) => void; label: string; onFail: () => void }) {
  const { t } = useI18n();
  const box = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"drawing" | "ready">(kind === "image" ? "ready" : "drawing");
  const [pages, setPages] = useState<{ pages: number; drawn: number } | null>(null);
  const pdfBox = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (kind !== "pdf" || info.url === null) return;
    const into = pdfBox.current;
    if (into === null) return;
    const stop = new AbortController();
    setState("drawing");
    const width = Math.max(320, Math.round(into.getBoundingClientRect().width || 720));
    void import("./pdf.ts")
      .then(({ drawPdf }) => drawPdf(info.url as string, into, width, stop.signal))
      .then((drawn) => {
        if (stop.signal.aborted) return;
        setPages(drawn);
        setState("ready");
      })
      .catch(() => {
        if (!stop.signal.aborted) onFail();
      });
    return () => stop.abort();
    // Drawn once per file: a new failure handler on each render is not a new file.
  }, [kind, info.url]);

  const drop = (event: React.MouseEvent<HTMLDivElement>) => {
    if (onDrop === undefined || box.current === null || state !== "ready") return;
    if ((event.target as HTMLElement).closest(".rv-pin") !== null) return;
    const r = box.current.getBoundingClientRect();
    const point = pointOf({ x: event.clientX, y: event.clientY }, { left: r.left, top: r.top, width: r.width, height: r.height });
    if (point !== null) onDrop(point);
  };

  return (
    <>
      <div className="rv-scroll">
        <div ref={box} className={`rv-drawing${onDrop !== undefined ? " rv-drawing--pins" : ""}`} onClick={drop} data-drawn={kind}>
          {kind === "image" ? (
            <img className="rv-image" src={info.url ?? undefined} alt={t("review.stage.alt", { name: info.name, version: label })} onError={onFail} draggable={false} />
          ) : (
            <div ref={pdfBox} className="rv-pdf" role="img" aria-label={t("review.stage.alt", { name: info.name, version: label })} />
          )}
          {state === "drawing" && (
            <span className="rv-drawing-wait">
              <LoaderCircle size={18} className="btn-spin" aria-hidden="true" />
              {t("review.stage.drawing")}
            </span>
          )}
          {pins?.map((pin) => (
            <PinMark key={`${String(pin.noteId ?? "new")}-${String(pin.n)}`} pin={pin} onTakeBack={onTakeBack} />
          ))}
        </div>
      </div>
      {pages !== null && pages.pages > pages.drawn && <p className="rv-more-pages">{t("review.stage.morePages", { shown: pages.drawn, total: pages.pages })}</p>}
    </>
  );
}

/**
 * A pin sits by the drawing's own left edge (the artwork does not turn round
 * in a right-to-left page), so the same point shows in every language.
 */
function PinMark({ pin, onTakeBack }: { pin: Pin; onTakeBack?: (p: Pin) => void }) {
  const { t } = useI18n();
  const style = { left: `${String(pin.x)}%`, top: `${String(pin.y)}%` };
  if (pin.noteId === null) {
    return (
      <button type="button" className="rv-pin rv-pin--new" style={style} onClick={() => onTakeBack?.(pin)} aria-label={t("review.pin.takeBack", { n: pin.n })} title={t("review.pin.takeBack", { n: pin.n })}>
        {pin.n}
      </button>
    );
  }
  return (
    <span className="rv-pin" style={style} title={pin.body ?? ""} aria-label={t("review.pin.said", { n: pin.n, body: pin.body ?? "" })} role="img">
      {pin.n}
    </span>
  );
}

function FileCard({ version, info, isLink, label, loading, failed = false }: { version: DeliverableVersion | null; info: FileInfo | null; isLink: boolean; label: string; loading: boolean; failed?: boolean }) {
  const { t, number } = useI18n();
  const href = isLink ? (version?.link ?? null) : (info?.download ?? null);
  const name = isLink ? (version?.link ?? "").replace(/^https?:\/\//, "") : (info?.name ?? "");
  const icon = isLink ? "link" : iconFor({ mime: info?.mime ?? null, name });
  const why = loading ? t("review.stage.reading") : failed ? t("review.stage.failed") : isLink ? t("review.stage.link") : t("review.stage.notDrawn");
  return (
    <div className="rv-card-file" aria-label={t("review.stage.cardLabel", { version: label })} role="group">
      <DeliverableIcon name={icon} className="rv-card-icon" size={40} />
      {name !== "" && <span className="rv-card-name">{name}</span>}
      {info?.size != null && <span className="rv-card-size">{sizeLabel(info.size, number)}</span>}
      <span className="rv-card-why">{why}</span>
      {href !== null && (
        <a className="btn btn--small ol-gi rv-card-open" href={href} target="_blank" rel="noopener noreferrer" {...(isLink ? {} : { download: name || undefined })}>
          {isLink ? <ExternalLink size={14} aria-hidden="true" /> : <Download size={14} aria-hidden="true" />}
          {isLink ? t("review.stage.openLink") : t("review.stage.download")}
        </a>
      )}
    </div>
  );
}
