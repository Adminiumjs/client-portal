import { afterEach, describe, expect, it } from "vitest";

import { normalise } from "./rows.ts";
import { setServerZone } from "./venueTime.ts";

describe("a row in the app's spelling", () => {
  it("keeps every amount as the server's own digits, whatever the database", () => {
    const pg = normalise("invoices", { id: "7", total: "1950.0000", balance: "0.0000", paid: "1950.0000" });
    expect(pg).toMatchObject({ id: 7, total: "1950.0000", balance: "0.0000" });
    const sqlite = normalise("invoices", { id: 7, total: 1950.5, balance: 0 });
    expect(sqlite).toMatchObject({ total: "1950.5", balance: "0" });
    expect(normalise("invoices", { id: 7, total: null }).total).toBeNull();
  });

  it("reads a yes/no, a day and an instant the same from every engine", () => {
    const row = normalise("payments", { id: 1, voided: "t", paid_on: "2026-07-28", recorded_at: "2026-07-28T09:00:00.000Z" });
    expect(row).toMatchObject({ voided: true, paid_on: "2026-07-28", recorded_at: "2026-07-28T09:00:00.000Z" });
    expect(normalise("payments", { id: 1, voided: 0 }).voided).toBe(false);
  });

  describe("a date, read as the day it spells wherever the page is", () => {
    afterEach(() => setServerZone(null));
    // The desk knows the server's zone (its staff config says it), a client's page does not: neither moves a day.
    for (const zone of [null, "Pacific/Kiritimati", "America/Los_Angeles", "Europe/Berlin"]) {
      it(`on a page whose server zone is ${String(zone)}`, () => {
        setServerZone(zone);
        expect(normalise("invoices", { id: 1, due_on: "2026-08-14", issued_on: "2026-07-31" })).toMatchObject({ due_on: "2026-08-14", issued_on: "2026-07-31" });
        // A day written with a time after it (what `new Date("2026-08-14")` spells, or a SQLite text with a clock) is the day it names.
        expect(normalise("invoices", { id: 1, due_on: "2026-08-14T00:00:00.000Z" }).due_on).toBe("2026-08-14");
        expect(normalise("milestones", { id: 1, due_on: "2026-08-14 00:00:00" }).due_on).toBe("2026-08-14");
        expect(normalise("invoices", { id: 1, due_on: new Date(Date.UTC(2026, 7, 14)) }).due_on).toBe("2026-08-14");
        expect(normalise("invoices", { id: 1, due_on: "soon" }).due_on).toBeNull();
      });
    }
  });

  it("reads a masked address as none and other masked text as empty", () => {
    const row = normalise("clients", { id: 3, company: "Hearth & Co", email: null, phone: null, _masked: ["email", "phone"] });
    expect(row).toMatchObject({ company: "Hearth & Co", email: null, phone: "" });
    expect(row).not.toHaveProperty("_masked");
  });
});
