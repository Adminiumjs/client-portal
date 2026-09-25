/**
 * The clients' side's sheets, by kind. Kept apart from the desk's so the
 * clients' bundle carries none of the desk's sheets.
 */
import type { ComponentType } from "react";

import type { ClientSheet } from "../../state/sheets.ts";
import Terms from "./Terms.tsx";
import Receipt from "./Receipt.tsx";

export const CLIENT_SHEETS: { [K in ClientSheet["kind"]]: ComponentType<{ sheet: Extract<ClientSheet, { kind: K }>; onClose: () => void }> } = {
  terms: Terms,
  receipt: Receipt,
};
