/**
 * The add-on this app is built on.
 *
 * Proposals, invoices, receipts and the reminders about unpaid invoices are
 * made by Invoices & Receipts: five of this app's tables are built on its
 * shapes, and its documents are what a client prints. So the app REQUIRES it —
 * installing the app installs (or connects) the add-on first, and the add-on
 * cannot be removed while the app is installed.
 *
 * The range names the add-ons' release that first defines the shapes; it is
 * written from the version that release actually carries.
 */
import { l } from "./labels.ts";

/** The first Invoices & Receipts release with the `invoice@1` and `quote@1` shapes. */
export const INVOICES_RANGE = ">=1.0.3";

export const ADD_ONS = {
  requires: [
    {
      key: "invoices",
      range: INVOICES_RANGE,
      reason: l("Proposals, invoices, receipts and payment reminders are made by this add-on."),
    },
  ],
};
