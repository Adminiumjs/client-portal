/**
 * What Settings decides before it saves, and what the saves write: only what
 * changed, only the add-on's own keys, checked the way a studio manager would
 * want to hear about a slip before a round trip.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { Person, Settings } from "../../data/types.ts";
import { saveInvoiceSettings, saveStudioSettings } from "../../state/actions.ts";
import { useDesk } from "../../state/desk.ts";
import { fakeStudio, type FakeStudio } from "../../testing/fakeStudio.ts";
import {
  currencyName,
  formatNumber,
  hourlyRate,
  invoiceErrors,
  invoiceFormOf,
  invoicePatch,
  newStart,
  nextInSeries,
  NOTICES,
  noticesPatch,
  rateAmount,
  signOffOptions,
  studioErrors,
  studioPatch,
} from "./model.ts";

const settingsRow = (): Settings => Object.values(useDesk.getState().rows.settings)[0]!;

/** The add-on's settings as a studio would have them. */
const STORED = {
  business_name: "Outline Studio Ltd",
  business_lines: ["2 Bell Street, unit 4", "Portland, OR 97209"],
  tax_name: "Sales tax",
  tax_number: "93-4417205",
  default_tax_rate: 8.5,
  payment_instructions: "Sample — Bank transfer",
  default_terms: "net14",
  footer: "Part payments are fine.",
  show_payment_ledger: true,
  default_ladder: "standard",
  ladders: { gentle: [7, 21, 45], standard: [3, 14, 30], firm: [1, 7, 21] },
  number_start_invoice: 1,
};
const DECLARED = Object.keys(STORED);

let studio: FakeStudio;
beforeEach(async () => {
  studio = await fakeStudio();
});

describe("the studio card", () => {
  it("saves only what changed, trimmed, and an emptied field as nothing", async () => {
    const patch = studioPatch(settingsRow(), { name: "Outline", reply_to: "  studio@outline.example ", phone: "", hours_per_day: "7" });
    expect(patch).toEqual({ reply_to: "studio@outline.example", phone: null, hours_per_day: 7 });
    const out = await saveStudioSettings(patch);
    expect(out.ok).toBe(true);
    expect(studio.writes.at(-1)).toEqual({ op: "update", table: "settings", id: settingsRow().id, values: { reply_to: "studio@outline.example", phone: null, hours_per_day: 7 } });
    expect(settingsRow().reply_to).toBe("studio@outline.example");
  });

  it("names what is wrong: no name, an address that takes no reply, hours outside a day", () => {
    expect(studioErrors(settingsRow(), {})).toEqual({});
    expect(studioErrors(settingsRow(), { name: " ", reply_to: "hello@", hours_per_day: "25" })).toEqual({ name: "nameMissing", reply_to: "replyTo", hours_per_day: "hours" });
    expect(studioErrors(settingsRow(), { hours_per_day: "6.5" })).toEqual({ hours_per_day: "hours" });
    expect(studioErrors(settingsRow(), { reply_to: "" })).toEqual({});
  });
});

describe("the notices", () => {
  it("offers the seven the studio can be told about, and not a new enquiry yet", () => {
    expect(NOTICES).toEqual(["notify_accepted", "notify_declined", "notify_files", "notify_paid", "notify_brief", "notify_new_price", "notify_notes"]);
    expect(NOTICES).not.toContain("notify_enquiry");
  });

  it("saves the switches that moved, and none that were only flicked back", () => {
    const row = { ...settingsRow(), notify_paid: true, notify_brief: false, notify_notes: false };
    expect(noticesPatch(row, { notify_paid: false, notify_brief: false, notify_notes: true })).toEqual({ notify_paid: false, notify_notes: true });
  });
});

describe("signing off", () => {
  const people = [
    { id: 1, name: "Nadia Cole", shown_to_clients: true, position: 0 },
    { id: 2, name: "Tomas Reyes", shown_to_clients: true, position: 1 },
    { id: 3, name: "Ivo Hart", shown_to_clients: false, position: 2 },
  ] as Person[];

  it("offers each person who talks to clients, then all of them together in the page's language", () => {
    expect(signOffOptions(people, null, "en-US")).toEqual(["Nadia", "Tomas", "Nadia and Tomas"]);
    expect(signOffOptions(people, null, "de-DE")).toEqual(["Nadia", "Tomas", "Nadia und Tomas"]);
  });

  it("keeps what is stored when it is none of those", () => {
    expect(signOffOptions(people, "The Outline studio", "en-US")[0]).toBe("The Outline studio");
    expect(signOffOptions(people, "Nadia", "en-US")).toEqual(["Nadia", "Tomas", "Nadia and Tomas"]);
  });
});

describe("the rate card", () => {
  it("works the hourly line out from the first rate and the hours in a day, and saves nothing of it", () => {
    expect(hourlyRate("780.00", 6)).toBe(130);
    expect(hourlyRate("750.00", 0)).toBeNull();
    expect(hourlyRate(null, 6)).toBeNull();
  });

  it("takes an amount above zero with at most two places", () => {
    expect(rateAmount("780")).toBe("780.00");
    expect(rateAmount("1,250.5")).toBe("1250.50");
    expect(rateAmount("0")).toBeNull();
    expect(rateAmount("12.345")).toBeNull();
    expect(rateAmount("ten")).toBeNull();
  });
});

describe("the Invoices & Receipts card", () => {
  it("reads the add-on's values into the form: address lines, the ladders' days", () => {
    const form = invoiceFormOf(STORED);
    expect(form.business_lines).toBe("2 Bell Street, unit 4\nPortland, OR 97209");
    expect(form.default_tax_rate).toBe("8.5");
    expect(form.ladders.firm).toEqual(["1", "7", "21"]);
    expect(invoiceFormOf({}).default_ladder).toBe("standard");
  });

  it("sends only the settings that changed, in the add-on's own types", async () => {
    const form = invoiceFormOf(STORED);
    expect(invoicePatch(STORED, form, DECLARED)).toEqual({});
    const edited = { ...form, business_lines: "2 Bell Street\n\nPortland", default_tax_rate: "9", ladders: { ...form.ladders, gentle: ["10", "21", "45"] as [string, string, string] } };
    const patch = invoicePatch(STORED, edited, DECLARED);
    expect(patch).toEqual({ business_lines: ["2 Bell Street", "Portland"], default_tax_rate: 9, ladders: { gentle: [10, 21, 45], standard: [3, 14, 30], firm: [1, 7, 21] } });
    const out = await saveInvoiceSettings(patch);
    expect(out.ok).toBe(true);
    expect(studio.writes.at(-1)).toEqual({ op: "settings", table: "add-on", values: { key: "invoices", ...patch } });
  });

  it("never sends a key the add-on does not declare (Adminium would refuse the whole save)", () => {
    const form = { ...invoiceFormOf(STORED), footer: "New footer", show_payment_ledger: false };
    const declared = DECLARED.filter((k) => k !== "show_payment_ledger");
    expect(invoicePatch(STORED, form, declared)).toEqual({ footer: "New footer" });
  });

  it("checks the tax rate and the ladders before a round trip", () => {
    const form = invoiceFormOf(STORED);
    expect(invoiceErrors(form)).toEqual({});
    expect(invoiceErrors({ ...form, default_tax_rate: "101" })).toEqual({ default_tax_rate: "taxRate" });
    expect(invoiceErrors({ ...form, default_tax_rate: "8.1234" })).toEqual({ default_tax_rate: "taxRate" });
    expect(invoiceErrors({ ...form, default_tax_rate: "" })).toEqual({});
    expect(invoiceErrors({ ...form, ladders: { ...form.ladders, standard: ["3", "3", "30"] } })).toEqual({ standard: "ladderOrder" });
    expect(invoiceErrors({ ...form, ladders: { ...form.ladders, firm: ["1", "7.5", "21"] } })).toEqual({ firm: "ladderWhole" });
  });
});

describe("the numbers", () => {
  it("shows the next number: one after the last given, or the start when that is higher", () => {
    expect(nextInSeries(2041, 1)).toBe(2042);
    expect(nextInSeries(2041, 3000)).toBe(3000);
    expect(nextInSeries(null, undefined)).toBe(1);
    expect(formatNumber("INV-", 2042, "INV-")).toBe("INV-2042");
    expect(formatNumber(undefined, 7, "QUO-")).toBe("QUO-0007");
  });

  it("moves the start only upwards", () => {
    expect(newStart("2043", 2042)).toBe(2043);
    expect(newStart("2042", 2042)).toBeNull();
    expect(newStart("12a", 2042)).toBeNull();
  });
});

describe("the currency", () => {
  it("is named in the page's language, with its sign", () => {
    expect(currencyName("USD", "en-US")).toBe("US Dollar · $");
    expect(currencyName("EUR", "de-DE")).toBe("Euro · €");
  });
});
