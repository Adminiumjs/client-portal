/**
 * "Stop this link": anyone holding the handover link — the client, their
 * printer — sees a stopped page from now on. Adminium stamps when it stopped;
 * a new link can be made after, and the old one stays stopped.
 */
import { Link2Off } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { stopShareLink } from "../state/actions.ts";
import { useRow } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";

export default function StopShare({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "stopShare" }>; onClose: () => void }) {
  const { t } = useI18n();
  const project = useRow("projects", sheet.projectId);
  const busy = useSheets((s) => s.busy);
  const refused = useSheets((s) => (typeof s.draft["refused"] === "string" ? s.draft["refused"] : null));

  const stop = async () => {
    const out = await saveFromSheet(() => stopShareLink(sheet.projectId));
    if (!out.ok) {
      if (out.code !== "BUSY") setDraft({ refused: t(refusalKey(out.reason), { id: project?.number ?? "" }) });
      return;
    }
    toast(t("handover.sheet.stop.done"), { icon: "link-2-off" });
  };

  return (
    <Sheet title={t("handover.link.stop")} sub={project === undefined ? undefined : [project.number, project.name].filter((x) => x !== null && x !== "").join(" · ")} icon={Link2Off} onClose={onClose}>
      <p className="psh-lead">{t("handover.sheet.stop.sub")}</p>
      {refused !== null && <Alert>{refused}</Alert>}
      <Button kind="primary" size="wide" icon={Link2Off} busy={busy} className="psh-danger" onClick={() => void stop()}>
        {t("handover.sheet.stop.action")}
      </Button>
      <Button size="wide" className="psh-second" onClick={onClose}>
        {t("common.cancel")}
      </Button>
    </Sheet>
  );
}
