/**
 * The "stopShare" sheet — to be drawn. It opens, names itself and closes; the
 * sheet's lane replaces this file whole (same name, same props).
 */
import { Link2Off } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { useI18n } from "../i18n/index.tsx";
import type { DeskSheet } from "../state/sheets.ts";

export default function StopShare({ onClose }: { sheet: Extract<DeskSheet, { kind: "stopShare" }>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("sheetName.stopShare")} icon={Link2Off} onClose={onClose}>
      {null}
    </Sheet>
  );
}
