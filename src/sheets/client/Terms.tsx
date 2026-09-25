/**
 * The "terms" sheet — to be drawn. It opens, names itself and closes; the
 * sheet's lane replaces this file whole (same name, same props).
 */
import { ScrollText } from "lucide-react";

import { Sheet } from "../../components/Sheet.tsx";
import { useI18n } from "../../i18n/index.tsx";
import type { ClientSheet } from "../../state/sheets.ts";

export default function Terms({ onClose }: { sheet: Extract<ClientSheet, { kind: "terms" }>; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Sheet title={t("sheetName.terms")} icon={ScrollText} onClose={onClose}>
      {null}
    </Sheet>
  );
}
