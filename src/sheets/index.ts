/**
 * The desk's sheets, by kind: the one place that knows them all. `SheetHost`
 * draws the open one from here; each sheet is its own file and closes itself
 * through `onClose`. A new kind is added to `DeskSheet` (state/sheets.ts),
 * here, and in `SHEET_TITLES`; `sheets.test.ts` checks the three agree.
 */
import type { ComponentType } from "react";

import type { MessageKey } from "../i18n/messages/index.ts";
import type { DeskSheet } from "../state/sheets.ts";
import Add from "./Add.tsx";
import Send from "./Send.tsx";
import StartProject from "./StartProject.tsx";
import NextStage from "./NextStage.tsx";
import Milestones from "./Milestones.tsx";
import Deliverable from "./Deliverable.tsx";
import Version from "./Version.tsx";
import MarkApproved from "./MarkApproved.tsx";
import RecordPayment from "./RecordPayment.tsx";
import VoidPayment from "./VoidPayment.tsx";
import VoidInvoice from "./VoidInvoice.tsx";
import Extend from "./Extend.tsx";
import Withdraw from "./Withdraw.tsx";
import Revision from "./Revision.tsx";
import StopShare from "./StopShare.tsx";

export type SheetComponent<K extends DeskSheet["kind"]> = ComponentType<{ sheet: Extract<DeskSheet, { kind: K }>; onClose: () => void }>;

export const DESK_SHEETS: { [K in DeskSheet["kind"]]: SheetComponent<K> } = {
  add: Add,
  send: Send,
  startProject: StartProject,
  nextStage: NextStage,
  milestones: Milestones,
  deliverable: Deliverable,
  version: Version,
  markApproved: MarkApproved,
  recordPayment: RecordPayment,
  voidPayment: VoidPayment,
  voidInvoice: VoidInvoice,
  extend: Extend,
  withdraw: Withdraw,
  revision: Revision,
  stopShare: StopShare,
};

/** Each sheet's name, as its title and the demo card say it. */
export const SHEET_TITLES: Readonly<Record<DeskSheet["kind"], MessageKey>> = {
  add: "sheetName.add",
  send: "sheetName.send",
  startProject: "sheetName.startProject",
  nextStage: "sheetName.nextStage",
  milestones: "sheetName.milestones",
  deliverable: "sheetName.deliverable",
  version: "sheetName.version",
  markApproved: "sheetName.markApproved",
  recordPayment: "sheetName.recordPayment",
  voidPayment: "sheetName.voidPayment",
  voidInvoice: "sheetName.voidInvoice",
  extend: "sheetName.extend",
  withdraw: "sheetName.withdraw",
  revision: "sheetName.revision",
  stopShare: "sheetName.stopShare",
};
