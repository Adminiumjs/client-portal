/**
 * The add-on this app is built on.
 *
 * Proposals, invoices, receipts and the reminders about unpaid invoices are
 * made by Invoices & Receipts: five of this app's tables are built on its
 * shapes, and its documents are what a client prints. So the app REQUIRES it —
 * installing the app installs (or connects) the add-on first, and the add-on
 * cannot be removed while the app is installed.
 *
 * The range names the add-ons' release this app was checked against. The
 * shapes arrived in 1.0.3, but 1.0.4 and 1.0.5 changed what a client prints
 * (a receipt says what the money was for; an Arabic copy keeps each amount in
 * order), so an older add-on would print copies this app never showed anyone.
 *
 * It SUGGESTS Holiday calendars: with it, the public holidays it keeps come
 * out of the days Capacity counts the studio free. Nothing else needs it, so
 * it is offered, not ticked, and the app works the same without it.
 *
 * Holiday calendars' range names the release that first attaches to this app,
 * written from the version that release actually carries.
 */
import { l } from "./labels.ts";

/** The Invoices & Receipts release the contract, the demo's copies and the shapes are held to. */
export const INVOICES_RANGE = ">=1.0.5";

/** The first Holiday calendars release that attaches to this app. */
export const HOLIDAYS_RANGE = ">=1.0.3";

export const ADD_ONS = {
  requires: [
    {
      key: "invoices",
      range: INVOICES_RANGE,
      reason: l("Proposals, invoices, receipts and payment reminders are made by this add-on."),
    },
  ],
  suggests: [
    {
      key: "holiday-calendars",
      range: HOLIDAYS_RANGE,
      reason: l("Leave public holidays out of the working days Capacity counts."),
    },
  ],
  features: [
    {
      id: "capacity-holidays",
      label: l("Public holidays in Capacity"),
      requires: ["holiday-calendars"],
    },
  ],
};
