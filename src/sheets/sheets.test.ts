/**
 * The sheet registry is complete: every kind of sheet the desk opens has a
 * file, a component in the registry and a name in every language; the
 * clients' sheets likewise, in their own registry.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { MESSAGES } from "../i18n/messages/index.ts";
import { DESK_SHEETS, SHEET_TITLES } from "./index.ts";
import { CLIENT_SHEETS } from "./client/index.ts";

describe("the sheets", () => {
  it("name every desk sheet the plan lists, each with a component and a name in all eight languages", () => {
    expect(Object.keys(DESK_SHEETS).sort()).toEqual(
      ["add", "send", "startProject", "nextStage", "milestones", "deliverable", "version", "markApproved", "recordPayment", "voidPayment", "voidInvoice", "extend", "withdraw", "revision", "stopShare"].sort(),
    );
    expect(Object.keys(SHEET_TITLES).sort()).toEqual(Object.keys(DESK_SHEETS).sort());
    for (const key of Object.values(SHEET_TITLES)) for (const bundle of Object.values(MESSAGES)) expect(bundle[key], key).toBeTruthy();
  });

  it("keep one file per sheet", () => {
    for (const component of [...Object.values(DESK_SHEETS), ...Object.values(CLIENT_SHEETS)]) expect(typeof component).toBe("function");
    for (const name of ["Add", "Send", "StartProject", "NextStage", "Milestones", "Deliverable", "Version", "MarkApproved", "RecordPayment", "VoidPayment", "VoidInvoice", "Extend", "Withdraw", "Revision", "StopShare"]) {
      expect(existsSync(join(__dirname, `${name}.tsx`)), name).toBe(true);
    }
    expect(Object.keys(CLIENT_SHEETS).sort()).toEqual(["receipt", "terms"]);
  });
});
