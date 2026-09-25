/**
 * "Post v{n}": a new version of a deliverable — a file or a link — and a note
 * for the client on what changed. A shared deliverable goes back to waiting
 * for their review, and they are told; one not shared yet stays with the
 * studio until it is.
 *
 * The number is Adminium's (the next one for this deliverable); the sheet
 * names the one it expects, and the toast the one that was saved.
 */
import { useMemo } from "react";
import { Upload } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../components/ui.tsx";
import type { Deliverable, DeliverableVersion } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { postVersion, type Outcome } from "../state/actions.ts";
import { useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";
import { firstName } from "../screens/project/model.ts";
import { DropZone, goodLink, ModeSwitch, type UploadMode } from "../screens/review/DropZone.tsx";
import { rememberUpload, useFileInfo } from "../screens/review/files.ts";
import { nextVersionNumber, versionNumber, versionsOf } from "../screens/review/model.ts";

type Problem = null | "file" | "link" | "tooBig" | { refused: string };
type Posted = Outcome<{ version: DeliverableVersion; deliverable: Deliverable }>;

export default function Version({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "version" }>; onClose: () => void }) {
  const { t } = useI18n();
  const deliverable = useRow("deliverables", sheet.deliverableId);
  const project = useRow("projects", deliverable?.project_id);
  const client = useRow("clients", project?.client_id);
  const all = useRows("deliverable_versions");
  const versions = useMemo(() => versionsOf(all, sheet.deliverableId), [all, sheet.deliverableId]);
  const newest = versions.at(-1);
  const newestInfo = useFileInfo(newest?.file ?? newest?.link ?? null);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  const mode: UploadMode = draft["mode"] === "link" ? "link" : "file";
  const file = draft["file"] instanceof File ? draft["file"] : null;
  const link = typeof draft["link"] === "string" ? draft["link"] : "";
  const note = typeof draft["note"] === "string" ? draft["note"] : "";
  const problem = (draft["problem"] ?? null) as Problem;
  const first = firstName(client?.contact_name);
  const next = t("common.versionTag", { n: nextVersionNumber(versions) });
  const shared = deliverable !== undefined && deliverable.status !== "unshared";
  const fileName = newestInfo?.name ?? deliverable?.title ?? "";

  const done = (out: Posted) => {
    if (!out.ok) {
      if (out.code !== "BUSY") setDraft({ problem: { refused: t(refusalKey(out.reason), { id: project?.number ?? "" }) } });
      return;
    }
    if (file !== null && out.value.version.file !== null) rememberUpload(out.value.version.file, file, file.name);
    const saved = t("common.versionTag", { n: versionNumber(out.value.version, versionsOf(all.concat(out.value.version), sheet.deliverableId)) });
    toast(shared ? t("review.sheet.version.shared", { v: saved, first }) : t("review.sheet.version.saved", { v: saved }), { icon: "upload" });
  };

  const submit = async () => {
    if (mode === "file" && file === null) return setDraft({ problem: "file" });
    if (mode === "link" && !goodLink(link)) return setDraft({ problem: "link" });
    const content = mode === "file" && file !== null ? { file, filename: file.name } : { link: link.trim() };
    done(await saveFromSheet(() => postVersion(sheet.deliverableId, content, note.trim() === "" ? null : note)));
  };

  const errorText = problem === null ? null : problem === "file" ? t("review.upload.needFile") : problem === "link" ? t("review.upload.badLink") : problem === "tooBig" ? t("review.upload.tooBig") : problem.refused;

  return (
    <Sheet title={t("review.sheet.version.title", { v: next })} sub={[fileName, project?.number].filter((x) => x !== undefined && x !== null && x !== "").join(" · ")} icon={Upload} onClose={onClose}>
      <ModeSwitch mode={mode} onMode={(m) => setDraft({ mode: m, problem: null })} />
      {mode === "file" ? (
        <DropZone file={file} invalid={problem === "file" || problem === "tooBig"} describedBy={problem === "file" || problem === "tooBig" ? "psh-v-error" : undefined} onFile={(f) => setDraft({ file: f, problem: null })} onTooBig={() => setDraft({ file: null, problem: "tooBig" })} />
      ) : (
        <Field label={t("review.upload.link")} error={problem === "link" ? errorText : undefined}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input up-link" type="url" inputMode="url" value={link} placeholder={t("review.upload.linkPh")} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => setDraft({ link: e.target.value, problem: null })} />
          )}
        </Field>
      )}
      <Field label={t("review.sheet.version.note")}>
        {({ id }) => <textarea id={id} className="input" rows={3} value={note} maxLength={500} placeholder={t("review.sheet.version.notePh")} onChange={(e) => setDraft({ note: e.target.value })} />}
      </Field>
      {!shared && <p className="psh-quiet">{t("review.sheet.version.notShared")}</p>}
      {errorText !== null && problem !== "link" && (
        <div id="psh-v-error">
          <Alert>{errorText}</Alert>
        </div>
      )}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void saveFromSheet(() => unfinished.resume() as Promise<Posted>).then(done)} />}
      <Button kind="primary" size="wide" icon={Upload} busy={busy} onClick={() => void submit()}>
        {shared ? t("review.sheet.version.postAndTell", { v: next, first }) : t("review.sheet.version.post", { v: next })}
      </Button>
    </Sheet>
  );
}
