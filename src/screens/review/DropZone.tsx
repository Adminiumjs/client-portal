/**
 * The sheets' file picker: a dashed zone to drop a file on or click to choose
 * one ("Drop a file or choose one · up to 100 MB"), which then names the file
 * and its size ("… · choose another"); and the "Upload a file | Link" switch
 * the deliverable and version sheets put above it.
 *
 * A file over 100 MB is refused here, before anything is sent.
 */
import { useId, useState } from "react";
import { FileCheck, Link as LinkIcon, Upload } from "lucide-react";

import { useI18n } from "../../i18n/index.tsx";
import { sizeLabel } from "./files.ts";

export const MAX_BYTES = 100 * 1048576;

export function DropZone({ file, onFile, onTooBig, invalid, describedBy }: { file: File | null; onFile: (file: File) => void; onTooBig: () => void; invalid: boolean; describedBy?: string }) {
  const { t, number } = useI18n();
  const id = useId();
  const [drag, setDrag] = useState(false);
  const take = (f: File | null | undefined) => {
    setDrag(false);
    if (f === null || f === undefined) return;
    if (f.size > MAX_BYTES) onTooBig();
    else onFile(f);
  };
  return (
    <label
      htmlFor={id}
      className={`up-drop${drag ? " up-drop--over" : ""}${invalid ? " up-drop--bad" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        take(e.dataTransfer.files[0]);
      }}
    >
      <input id={id} type="file" className="up-input" aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => take(e.target.files?.[0])} />
      {file === null ? <Upload size={22} aria-hidden="true" /> : <FileCheck size={22} aria-hidden="true" />}
      {file === null ? (
        <>
          <span className="up-drop-main">
            {t("review.upload.drop", { choose: "\u0000" })
              .split("\u0000")
              .flatMap((part, i) => (i === 0 ? [part] : [<span key={i} className="up-drop-choose">{t("review.upload.choose")}</span>, part]))}
          </span>
          <span className="up-drop-sub">{t("review.upload.limit")}</span>
        </>
      ) : (
        <>
          <span className="up-drop-name">{file.name}</span>
          <span className="up-drop-sub up-drop-mono">{t("review.upload.another", { size: sizeLabel(file.size, number) })}</span>
        </>
      )}
    </label>
  );
}

export type UploadMode = "file" | "link";

export function ModeSwitch({ mode, onMode }: { mode: UploadMode; onMode: (m: UploadMode) => void }) {
  const { t } = useI18n();
  return (
    <div className="up-modes" role="group" aria-label={t("review.upload.modeLabel")}>
      <button type="button" className="up-mode ol-chip" aria-pressed={mode === "file"} onClick={() => onMode("file")}>
        <Upload size={13} aria-hidden="true" />
        {t("review.upload.file")}
      </button>
      <button type="button" className="up-mode ol-chip" aria-pressed={mode === "link"} onClick={() => onMode("link")}>
        <LinkIcon size={13} aria-hidden="true" />
        {t("review.upload.link")}
      </button>
    </div>
  );
}

/** A link worth saving: https:// (or http://) and somewhere to go. */
export const goodLink = (text: string): boolean => /^https?:\/\/[^\s./]+\.[^\s]+$/i.test(text.trim());
