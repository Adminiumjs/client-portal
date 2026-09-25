/**
 * The Invoices & Receipts add-on's settings, as the Settings screen reads
 * them: the values stored for the add-on and the keys it declares.
 *
 * Adminium keeps an add-on's settings beside the add-on (not in the app's
 * tables): they are written through `PUT /api/v1/add-ons/invoices/settings`
 * (the sink's `saveAddOnSettings`, a studio manager's grant) and read with
 * the add-on's entry of `GET /api/v1/add-ons`. The read is looked for on the
 * desk's write door beside the save; a door without it answers
 * "unreadable", and the card then shows the settings as out of reach rather
 * than as empty fields a save would write over.
 */
import { deskWrites } from "../../state/desk.ts";

export const INVOICES_ADD_ON = "invoices";

/** The stored values and the declared keys of an add-on's settings. */
export interface AddOnSettings {
  values: Record<string, unknown>;
  declared: readonly string[];
}

/** The read the card needs beside `saveAddOnSettings`. */
export interface AddOnSettingsReader {
  /** An add-on's settings, or null when it is not installed. */
  addOnSettings(addOnKey: string): Promise<AddOnSettings | null>;
}

export type InvoiceSettingsRead =
  | { state: "ready"; settings: AddOnSettings }
  /** The add-on is not installed for this studio. */
  | { state: "absent" }
  /** This desk has no way to read the add-on's settings. */
  | { state: "unreadable" }
  /** The read failed (offline, refused). */
  | { state: "failed"; message: string };

export async function readInvoiceSettings(): Promise<InvoiceSettingsRead> {
  const door = deskWrites() as ReturnType<typeof deskWrites> & Partial<AddOnSettingsReader>;
  if (typeof door.addOnSettings !== "function") return { state: "unreadable" };
  try {
    const settings = await door.addOnSettings(INVOICES_ADD_ON);
    return settings === null ? { state: "absent" } : { state: "ready", settings };
  } catch (error) {
    return { state: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}
