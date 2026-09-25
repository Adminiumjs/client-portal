/**
 * The one sheet open over a client's page, drawn from the clients' registry.
 */
import type { ComponentType } from "react";

import { CLIENT_SHEETS } from "../sheets/client/index.ts";
import { closeSheet, useSheets, type ClientSheet } from "../state/sheets.ts";

export default function ClientSheetHost() {
  const open = useSheets((s) => s.open);
  if (open === null || !(open.kind in CLIENT_SHEETS)) return null;
  const sheet = open as ClientSheet;
  const Component = CLIENT_SHEETS[sheet.kind] as ComponentType<{ sheet: ClientSheet; onClose: () => void }>;
  return <Component sheet={sheet} onClose={closeSheet} />;
}
