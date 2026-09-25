/**
 * The "receipt" sheet — to be drawn. It opens, names itself and closes; the
 * sheet's lane replaces this file whole (same name, same props).
 */
import { Receipt as ReceiptIcon } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { useI18n } from "../../i18n/index.tsx";
import type { ClientSheet } from "../../state/sheets.ts";

export default function Receipt({ onClose }: { sheet: Extract<ClientSheet, { kind: "receipt" }>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("sheetName.receipt")} icon={ReceiptIcon} onClose={onClose}>
      {null}
    </Sheet>
  );
}
