/**
 * The one sheet open over the desk, drawn from the registry (`sheets/index.ts`).
 */
import type { ComponentType } from "react";

import { DESK_SHEETS } from "../sheets/index.ts";
import { closeSheet, useSheets, type DeskSheet } from "../state/sheets.ts";

export default function SheetHost() {
  const open = useSheets((s) => s.open);
  if (open === null || !(open.kind in DESK_SHEETS)) return null;
  const sheet = open as DeskSheet;
  const Component = DESK_SHEETS[sheet.kind] as ComponentType<{ sheet: DeskSheet; onClose: () => void }>;
  return <Component sheet={sheet} onClose={closeSheet} />;
}
