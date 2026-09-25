/**
 * "Add a file" on the handover: a file the studio adds to what the client
 * picks up (a source folder, a colour sheet), with a short note. The upload
 * goes first, then the handover's row; a step that doesn't save offers to
 * finish with the same key.
 */
import { useState } from "react";
import { FilePlus } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../../components/ui.tsx";
import type { HandoverFile, Project } from "../../data/types.ts";
import { useI18n } from "../../i18n/index.tsx";
import { addHandoverFile, type Outcome } from "../../state/actions.ts";
import { useRows } from "../../state/desk.ts";
import { refusalKey, type Unfinished } from "../../state/outcome.ts";
import { toast } from "../../state/ui.ts";
import { DropZone } from "../review/DropZone.tsx";
import { rememberUpload } from "../review/files.ts";

export function AddFileSheet({ project, company, onClose }: { project: Project; company: string; onClose: () => void }) {
  const { t } = useI18n();
  const files = useRows("handover_files");
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<null | "file" | "tooBig" | string>(null);
  const [busy, setBusy] = useState(false);
  const [unfinished, setUnfinished] = useState<Unfinished<HandoverFile> | null>(null);

  const finish = (out: Outcome<HandoverFile>, chosen: File) => {
    if (!out.ok) {
      setUnfinished(out.unfinished);
      setProblem(t(refusalKey(out.reason), { id: project.number ?? "" }));
      return;
    }
    if (out.value.file !== null) rememberUpload(out.value.file, chosen, chosen.name);
    toast(t("handover.sheet.file.added", { name: chosen.name }), { icon: "plus" });
    onClose();
  };

  const add = async () => {
    if (file === null) return setProblem("file");
    setBusy(true);
    const out = await addHandoverFile(project.id, { file, filename: file.name, note: note.trim() === "" ? null : note, position: files.filter((f) => f.project_id === project.id).length });
    setBusy(false);
    finish(out, file);
  };

  const resume = async () => {
    if (unfinished === null || file === null) return;
    setBusy(true);
    const out = await unfinished.resume();
    setBusy(false);
    finish(out, file);
  };

  const errorText = problem === null ? null : problem === "file" ? t("handover.sheet.file.needFile") : problem === "tooBig" ? t("review.upload.tooBig") : problem;

  return (
    <Sheet title={t("handover.files.add")} sub={[project.number, company].filter((x) => x !== null && x !== "").join(" · ")} icon={FilePlus} onClose={onClose}>
      <DropZone
        file={file}
        invalid={problem === "file" || problem === "tooBig"}
        describedBy={errorText === null ? undefined : "ho-add-error"}
        onFile={(f) => {
          setFile(f);
          setProblem(null);
        }}
        onTooBig={() => {
          setFile(null);
          setProblem("tooBig");
        }}
      />
      <Field label={t("handover.sheet.file.note")}>
        {({ id }) => <input id={id} className="input" value={note} maxLength={300} placeholder={t("handover.sheet.file.notePh")} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <p className="psh-quiet">{t("handover.sheet.file.seen")}</p>
      {errorText !== null && (
        <div id="ho-add-error">
          <Alert>{errorText}</Alert>
        </div>
      )}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void resume()} />}
      <Button kind="primary" size="wide" icon={FilePlus} busy={busy} onClick={() => void add()}>
        {t("handover.sheet.file.action")}
      </Button>
    </Sheet>
  );
}
