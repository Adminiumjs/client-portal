/**
 * Extend a sent proposal: a later valid-until day (Adminium refuses an
 * earlier one). It says how long it holds now, offers two weeks on, and
 * refuses a day that is not later.
 */
import { CalendarPlus } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { Alert, Button, Field } from "../components/ui.tsx";
import { useI18n } from "../i18n/index.tsx";
import { dayLabel } from "../lib/dates.ts";
import { extendDefault, extendMin, extendProblem } from "../screens/proposals/sheetModel.ts";
import { extendProposal } from "../state/actions.ts";
import { useDesk, useRow } from "../state/desk.ts";
import { refusalKey } from "../state/outcome.ts";
import { saveFromSheet, setDraft, useSheets, type DeskSheet } from "../state/sheets.ts";
import { toast } from "../state/ui.ts";

export default function Extend({ sheet, onClose }: { sheet: Extract<DeskSheet, { kind: "extend" }>; onClose: () => void }) {
  const { t, locale } = useI18n();
  const p = useRow("proposals", sheet.proposalId);
  const client = useRow("clients", p?.client_id);
  const today = useDesk((s) => s.today);
  const draft = useSheets((s) => s.draft);
  const busy = useSheets((s) => s.busy);
  if (p === undefined) return null;
  const id = p.number ?? "";
  const day = typeof draft["day"] === "string" ? (draft["day"] as string) : extendDefault(p, today);
  const shown = draft["error"] === true ? extendProblem(day, p, today) : null;
  const refused = typeof draft["refused"] === "string" ? (draft["refused"] as string) : null;

  async function submit(): Promise<void> {
    if (p === undefined) return;
    if (extendProblem(day, p, today) !== null) {
      setDraft({ day, error: true });
      return;
    }
    const out = await saveFromSheet(() => extendProposal(p.id, day));
    if (out.ok) toast(t("proposals.sheet.extended", { id, date: dayLabel(day, locale, "short") }), { icon: "calendar-plus" });
    else setDraft({ refused: t(refusalKey(out.reason), { id }) });
  }

  return (
    <Sheet title={t("proposals.sheet.extendTitle", { id })} sub={client?.company} icon={CalendarPlus} onClose={onClose}>
      <p className="prop-sheet-lead">{t("proposals.sheet.extendBody", { date: dayLabel(p.valid_until, locale, "long") })}</p>
      <Field label={t("proposals.sheet.holdsUntil")} error={shown === null ? undefined : shown.key === "pickDate" ? t("proposals.sheet.pickDate") : t("proposals.sheet.pickAfter", { date: dayLabel(shown.after, locale, "short") })}>
        {({ id: fieldId, describedBy, invalid }) => (
          <input
            id={fieldId}
            className="input ol-fld prop-date"
            type="date"
            min={extendMin(p, today)}
            value={day}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            onChange={(e) => setDraft({ day: e.target.value, error: false, refused: null })}
          />
        )}
      </Field>
      {refused !== null && <Alert>{refused}</Alert>}
      <Button kind="primary" size="wide" icon={CalendarPlus} busy={busy} onClick={() => void submit()}>
        {t("proposals.sheet.extendButton")}
      </Button>
    </Sheet>
  );
}
