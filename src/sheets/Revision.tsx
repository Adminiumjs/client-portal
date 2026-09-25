/**
 * The "revision" sheet — to be drawn. It opens, names itself and closes; the
 * sheet's lane replaces this file whole (same name, same props).
 */
import { CopyPlus } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { useI18n } from "../i18n/index.tsx";
import type { DeskSheet } from "../state/sheets.ts";

export default function Revision({ onClose }: { sheet: Extract<DeskSheet, { kind: "revision" }>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("sheetName.revision")} icon={CopyPlus} onClose={onClose}>
      {null}
    </Sheet>
  );
}
