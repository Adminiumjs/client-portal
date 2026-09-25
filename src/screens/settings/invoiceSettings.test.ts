/**
 * Reading the add-on's settings: a desk whose door has no read says so (the
 * card then shows the settings as out of reach, never as empty fields a save
 * would write over); a read that answers nothing is an add-on not installed.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { deskWrites, setDeskWrites } from "../../state/desk.ts";
import { fakeStudio } from "../../testing/fakeStudio.ts";
import { readInvoiceSettings } from "./invoiceSettings.ts";

beforeEach(async () => {
  await fakeStudio();
});

describe("reading the Invoices & Receipts settings", () => {
  it("is unreadable on a door without the read", async () => {
    expect(await readInvoiceSettings()).toEqual({ state: "unreadable" });
  });

  it("answers the values and the declared keys, for the invoices add-on", async () => {
    const asked: string[] = [];
    setDeskWrites({
      ...deskWrites(),
      addOnSettings: async (key: string) => {
        asked.push(key);
        return { values: { business_name: "Outline" }, declared: ["business_name"] };
      },
    } as ReturnType<typeof deskWrites>);
    expect(await readInvoiceSettings()).toEqual({ state: "ready", settings: { values: { business_name: "Outline" }, declared: ["business_name"] } });
    expect(asked).toEqual(["invoices"]);
  });

  it("says when the add-on is not installed, and when the read failed", async () => {
    const base = deskWrites();
    setDeskWrites({ ...base, addOnSettings: async () => null } as ReturnType<typeof deskWrites>);
    expect(await readInvoiceSettings()).toEqual({ state: "absent" });
    setDeskWrites({
      ...base,
      addOnSettings: async () => {
        throw new Error("offline");
      },
    } as ReturnType<typeof deskWrites>);
    expect(await readInvoiceSettings()).toEqual({ state: "failed", message: "offline" });
  });
});
