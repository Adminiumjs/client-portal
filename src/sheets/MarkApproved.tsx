/**
 * "Mark approved": the client approved outside the portal, and the studio
 * records how (by email, on a call, in person) and on which day — no earlier
 * than the version they saw was shared, no later than today.
 *
 * When the client had asked for changes, the sheet says so first and asks
 * to approve the current version anyway (the client can't do that from the
 * portal; the studio may, having heard from them).
 */
import { useMemo } from "react";
import { Check, TriangleAlert } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field } from "../components/ui.tsx";
import { useI18n, type MessageKey } from "../i18n/index.tsx";
import { today } from "../lib/clock.ts";
import { markApproved } from "../state/actions.ts";
import { useRow, useRows } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";
import { firstName } from "../screens/project/model.ts";
import { useFileInfo } from "../screens/review/files.ts";
import { dayProblem, versionsOf } from "../screens/review/model.ts";

type How = "email" | "call" | "meeting";
const HOWS: readonly { id: How; key: MessageKey }[] = [
  { id: "email", key: "review.sheet.approve.email" },
  { id: "call", key: "review.sheet.approve.call" },
  { id: "meeting", key: "review.sheet.approve.meeting" },
];

export default function MarkApproved({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "markApproved" }>; onClose: () => void }) {
  const { t } = useI18n();
  const deliverable = useRow("deliverables", sheet.deliverableId);
  const project = useRow("projects", deliverable?.project_id);
  const client = useRow("clients", project?.client_id);
  const all = useRows("deliverable_versions");
  const newest = useMemo(() => versionsOf(all, sheet.deliverableId).at(-1), [all, sheet.deliverableId]);
  const info = useFileInfo(newest?.file ?? newest?.link ?? null);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  const latest = today();
  const how: How = draft["how"] === "call" || draft["how"] === "meeting" ? draft["how"] : "email";
  const day = typeof draft["day"] === "string" ? draft["day"] : latest;
  const tried = draft["tried"] === true;
  const refused = typeof draft["refused"] === "string" ? draft["refused"] : null;
  const earliest = (newest?.posted_at ?? deliverable?.shared_at ?? null)?.slice(0, 10) ?? null;
  const problem = dayProblem(day, earliest, latest);
  const overChanges = deliverable?.status === "changes";
  const first = firstName(client?.contact_name);
  const file = info?.name ?? deliverable?.title ?? "";

  const submit = async () => {
    setDraft({ tried: true, refused: null });
    if (problem !== null) return;
    const out = await saveFromSheet(() => markApproved(sheet.deliverableId, how, day));
    if (!out.ok) {
      if (out.code !== "BUSY") setDraft({ refused: t(refusalKey(out.reason), { id: project?.number ?? "" }) });
      return;
    }
    toast(t("review.sheet.approve.done"), { icon: "check" });
  };

  const dayError = !tried || problem === null ? undefined : t(problem === "future" ? "review.sheet.approve.future" : problem === "early" ? "review.sheet.approve.early" : "review.sheet.approve.pickDay");

  return (
    <Sheet title={t("review.sheet.approve.title")} sub={[project?.number, deliverable?.title].filter((x) => x !== undefined && x !== null && x !== "").join(" · ")} icon={Check} onClose={onClose}>
      <p className="psh-lead">{t("review.sheet.approve.sub", { file })}</p>
      {overChanges && (
        <div className="alert alert--warn psh-confirm" role="note">
          <TriangleAlert size={15} aria-hidden="true" />
          <span>{t("review.sheet.approve.overChanges", { first })}</span>
        </div>
      )}
      <div className="field">
        <span className="field-label" id="psh-how-label">
          {t("review.sheet.approve.how")}
        </span>
        <div className="up-modes psh-how" role="group" aria-labelledby="psh-how-label">
          {HOWS.map((h) => (
            <button key={h.id} type="button" className="up-mode ol-chip" aria-pressed={how === h.id} onClick={() => setDraft({ how: h.id })}>
              {t(h.key)}
            </button>
          ))}
        </div>
      </div>
      <Field label={t("review.sheet.approve.when")} error={dayError}>
        {({ id, describedBy, invalid }) => <input id={id} className="input psh-date" type="date" value={day} min={earliest ?? undefined} max={latest} aria-invalid={invalid} aria-describedby={describedBy} onChange={(e) => setDraft({ day: e.target.value })} />}
      </Field>
      {refused !== null && <Alert>{refused}</Alert>}
      <Button kind="primary" size="wide" icon={Check} busy={busy} onClick={() => void submit()}>
        {overChanges ? t("review.sheet.approve.anyway") : t("sheetName.markApproved")}
      </Button>
    </Sheet>
  );
}
