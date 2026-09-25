/**
 * The "markApproved" sheet — to be drawn. It opens, names itself and closes; the
 * sheet's lane replaces this file whole (same name, same props).
 */
import { CircleCheck } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { useI18n } from "../i18n/index.tsx";
import type { DeskSheet } from "../state/sheets.ts";

export default function MarkApproved({ onClose }: { sheet: Extract<DeskSheet, { kind: "markApproved" }>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("sheetName.markApproved")} icon={CircleCheck} onClose={onClose}>
      {null}
    </Sheet>
  );
}
