/**
 * "Add deliverable": a title the client will recognise, the milestone it
 * belongs to (if any), and the work itself — a file (up to 100 MB, kept in
 * Adminium's files) or a link. "Share with {first}" shares it at once; "Save
 * without sharing" keeps it on the studio's side until it is shared.
 *
 * The deliverable, its file and its first version are written in that order,
 * sharing last, so the client never sees one half-made; a step that doesn't
 * save offers to finish.
 */
import { useMemo } from "react";
import { Upload } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field, UnfinishedLine } from "../components/ui.tsx";
import type { Deliverable as DeliverableRow, Id } from "../data/types.ts";
import { useI18n } from "../i18n/index.tsx";
import { addDeliverable, type Outcome } from "../state/actions.ts";
import { useDesk, useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";
import { deliverablesOf, firstName, milestonesOf } from "../screens/project/model.ts";
import { DropZone, goodLink, ModeSwitch, type UploadMode } from "../screens/review/DropZone.tsx";
import { iconFor, rememberUpload } from "../screens/review/files.ts";

type Problem = null | "title" | "file" | "link" | "tooBig" | { refused: string };

export default function Deliverable({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "deliverable" }>; onClose: () => void }) {
  const { t } = useI18n();
  const project = useRow("projects", sheet.projectId);
  const client = useRow("clients", project?.client_id);
  const allMilestones = useRows("milestones");
  const allDeliverables = useRows("deliverables");
  const open = useMemo(() => milestonesOf(allMilestones, sheet.projectId).filter((m) => m.state !== "done"), [allMilestones, sheet.projectId]);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const unfinished = useSheets((s) => s.unfinished);
  const title = typeof draft["title"] === "string" ? draft["title"] : "";
  const milestone = typeof draft["milestone"] === "string" ? draft["milestone"] : "";
  const mode: UploadMode = draft["mode"] === "link" ? "link" : "file";
  const file = draft["file"] instanceof File ? draft["file"] : null;
  const link = typeof draft["link"] === "string" ? draft["link"] : "";
  const problem = (draft["problem"] ?? null) as Problem;
  const first = firstName(client?.contact_name);
  const number = project?.number ?? t("projects.noNumber");

  const done = (out: Outcome<DeliverableRow>, share: boolean, name: string) => {
    if (!out.ok) {
      if (out.code !== "BUSY") setDraft({ problem: { refused: t(refusalKey(out.reason), { id: number }) } });
      return;
    }
    const version = Object.values(useDesk.getState().rows.deliverable_versions).find((v) => v.deliverable_id === out.value.id);
    if (file !== null && version?.file != null) rememberUpload(version.file, file, file.name);
    toast(share ? t("projects.sheet.deliverable.shared", { file: name, first }) : t("projects.sheet.deliverable.saved", { file: name }), { icon: "upload" });
  };

  const submit = async (share: boolean) => {
    if (title.trim() === "") return setDraft({ problem: "title" });
    if (mode === "file" && file === null) return setDraft({ problem: "file" });
    if (mode === "link" && !goodLink(link)) return setDraft({ problem: "link" });
    const name = mode === "file" && file !== null ? file.name : link.trim().replace(/^https?:\/\//i, "").split("/")[0] ?? link;
    const position = deliverablesOf(allDeliverables, sheet.projectId).length;
    const content = mode === "file" && file !== null ? { file, filename: file.name } : { link: link.trim() };
    const icon = mode === "link" ? iconFor("link") : iconFor({ mime: file?.type || null, name });
    setDraft({ share, name });
    const out = await saveFromSheet(() => addDeliverable(sheet.projectId, { title, milestone_id: milestone === "" ? null : (Number(milestone) as Id), icon, position, content, note: null, share }));
    done(out, share, name);
  };

  const errorText =
    problem === null
      ? null
      : problem === "title"
        ? t("projects.sheet.deliverable.needTitle")
        : problem === "file"
          ? t("review.upload.needFile")
          : problem === "link"
            ? t("review.upload.badLink")
            : problem === "tooBig"
              ? t("review.upload.tooBig")
              : problem.refused;

  return (
    <Sheet title={t("sheetName.deliverable")} sub={project === undefined ? undefined : `${number} · ${project.name}`} icon={Upload} onClose={onClose}>
      <Field label={t("projects.sheet.deliverable.title")} error={problem === "title" ? errorText : undefined}>
        {({ id, describedBy, invalid }) => (
          <input id={id} className="input" value={title} maxLength={200} placeholder={t("projects.sheet.deliverable.titlePh")} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => setDraft({ title: e.target.value, problem: null })} />
        )}
      </Field>
      <Field label={t("projects.sheet.deliverable.milestone")}>
        {({ id }) => (
          <select id={id} className="input" value={milestone} onChange={(e) => setDraft({ milestone: e.target.value })}>
            <option value="">{t("projects.sheet.deliverable.noMilestone")}</option>
            {open.map((m) => (
              <option key={m.id} value={String(m.id)}>
                {m.title}
              </option>
            ))}
          </select>
        )}
      </Field>
      <ModeSwitch mode={mode} onMode={(m) => setDraft({ mode: m, problem: null })} />
      {mode === "file" ? (
        <DropZone file={file} invalid={problem === "file" || problem === "tooBig"} describedBy={problem === "file" || problem === "tooBig" ? "psh-dv-error" : undefined} onFile={(f) => setDraft({ file: f, problem: null })} onTooBig={() => setDraft({ file: null, problem: "tooBig" })} />
      ) : (
        <Field label={t("review.upload.link")} error={problem === "link" ? errorText : undefined}>
          {({ id, describedBy, invalid }) => (
            <input id={id} className="input up-link" type="url" inputMode="url" value={link} placeholder={t("review.upload.linkPh")} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => setDraft({ link: e.target.value, problem: null })} />
          )}
        </Field>
      )}
      {errorText !== null && problem !== "title" && problem !== "link" && (
        <div id="psh-dv-error">
          <Alert>{errorText}</Alert>
        </div>
      )}
      {unfinished !== null && <UnfinishedLine unfinished={unfinished} busy={busy} onFinish={() => void saveFromSheet(() => unfinished.resume() as Promise<Outcome<DeliverableRow>>).then((out) => done(out, draft["share"] === true, typeof draft["name"] === "string" ? draft["name"] : title))} />}
      <Button kind="primary" size="wide" icon={Upload} busy={busy} onClick={() => void submit(true)}>
        {t("projects.sheet.deliverable.share", { first })}
      </Button>
      <Button size="wide" className="psh-second" disabled={busy} onClick={() => void submit(false)}>
        {t("projects.sheet.deliverable.keep")}
      </Button>
    </Sheet>
  );
}
