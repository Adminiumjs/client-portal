/**
 * The "voidInvoice" sheet — to be drawn. It opens, names itself and closes; the
 * sheet's lane replaces this file whole (same name, same props).
 */
import { Ban } from "lucide-react";

import { Sheet } from "../components/Sheet.tsx";
import { useI18n } from "../i18n/index.tsx";
import type { DeskSheet } from "../state/sheets.ts";

export default function VoidInvoice({ onClose }: { sheet: Extract<DeskSheet, { kind: "voidInvoice" }>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("sheetName.voidInvoice")} icon={Ban} onClose={onClose}>
      {null}
    </Sheet>
  );
}
